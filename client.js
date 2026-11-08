/**
 * dsh-task-progress — Client half.
 *
 * Renders a live progress card in `conversation.input.overlay`, floating just
 * above the composer card, for the jobs that are currently running in this
 * session. Data comes from the shipped `jobs` client service (`job.list`
 * snapshot + `job.follow` live stream), so nothing is polled over HTTP and the
 * Host half stays empty.
 *
 * Progress is derived from the job's output tail (pip / tqdm / epoch / step
 * lines); when the tail carries no numbers the card falls back to a stage label,
 * an indeterminate bar and the elapsed time.
 */
window.__ModuleLoader__.load({
  id: "dsh-task-progress",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = "task-progress";
    const MAX_VISIBLE_JOBS = 2;
    const KILL_ARM_MS = 3000;
    const KILL_FAILED_MS = 4000;
    const TICK_MS = 1000;
    const TAIL_CHARS = 12000;
    const DETAIL_MAX = 220;

    // ---------------------------------------------------------------------
    // i18n
    // ---------------------------------------------------------------------
    const zh = {
      "meta.title": "任务进度",
      title: "任务进度",
      "count.live": "运行中 {n} 项",
      "count.more": "还有 {n} 个任务",
      "count.less": "收起",
      collapse: "收起",
      expand: "展开",
      untitled: "未命名任务",
      "state.running": "运行中",
      "state.stopping": "停止中…",
      stop: "停止",
      "stop.armed": "确认停止",
      "stop.failed": "停止失败",
      "stop.hint": "停止这个任务",
      waiting: "等待输出…",
      frac: "{n} / {total} {unit}",
      remain: "剩余 {n}",
      percent: "{v}%",
      "label.speed": "实时速度",
      "label.eta": "预计剩余",
      "label.elapsed": "已用时长",
      "dur.s": "{n}秒",
      "dur.m": "{m}分{s}秒",
      "dur.h": "{h}小时{m}分",
      "dur.d": "{d}天{h}小时",
      "eta.s": "{n}秒",
      "eta.m": "{n}分",
      "eta.hm": "{h}小时{m}分",
      "eta.d": "{n}天",
      "rate.itps": "{n} it/s",
      "rate.perMin": "{n} 项/分",
      "unit.item": "项",
      "unit.step": "步",
      "unit.epoch": "轮",
      "stage.resolving": "解析依赖…",
      "stage.collecting": "收集依赖…",
      "stage.downloading": "下载中…",
      "stage.installing": "安装中…",
      "stage.building": "构建中…",
      "stage.preparing": "准备中…",
      "stage.fetching": "拉取中…",
    };

    const en = {
      "meta.title": "Task Progress",
      title: "Task progress",
      "count.live": "{n} running",
      "count.more": "{n} more tasks",
      "count.less": "Show fewer",
      collapse: "Collapse",
      expand: "Expand",
      untitled: "Untitled job",
      "state.running": "Running",
      "state.stopping": "Stopping…",
      stop: "Stop",
      "stop.armed": "Confirm stop",
      "stop.failed": "Stop failed",
      "stop.hint": "Stop this job",
      waiting: "Waiting for output…",
      frac: "{n} / {total} {unit}",
      remain: "{n} left",
      percent: "{v}%",
      "label.speed": "Speed",
      "label.eta": "ETA",
      "label.elapsed": "Elapsed",
      "dur.s": "{n}s",
      "dur.m": "{m}m {s}s",
      "dur.h": "{h}h {m}m",
      "dur.d": "{d}d {h}h",
      "eta.s": "{n}s",
      "eta.m": "{n}m",
      "eta.hm": "{h}h {m}m",
      "eta.d": "{n}d",
      "rate.itps": "{n} it/s",
      "rate.perMin": "{n} items/min",
      "unit.item": "items",
      "unit.step": "steps",
      "unit.epoch": "epochs",
      "stage.resolving": "Resolving dependencies…",
      "stage.collecting": "Collecting…",
      "stage.downloading": "Downloading…",
      "stage.installing": "Installing…",
      "stage.building": "Building…",
      "stage.preparing": "Preparing…",
      "stage.fetching": "Fetching…",
    };

    // ---------------------------------------------------------------------
    // Output parsing helpers
    // ---------------------------------------------------------------------
    const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
    const TQDM_PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%\s*\|/;
    const TQDM_FRAC_RE = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*\[/;
    const TQDM_REMAIN_RE = /<\s*(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\s*,/;
    const TQDM_RATE_RE = /[, ]\s*([\d.]+)\s*(it\/s|s\/it|batch\/s|bat\/s|b\/s|epochs?\/s|items?\/s|项\/s|步\/s)/i;
    const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/;
    const FRACTION_RE = /(\d[\d,]{0,9})\s*\/\s*(\d[\d,]{0,9})/;
    const LABELED_FRACTION_RE =
      /(epoch|step|iter|iteration|batch|sample|item|file|轮|步|项|句)\s*[:#]?\s*\[?\(?\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i;
    const LABELED_FRACTION_ALL_RE = new RegExp(LABELED_FRACTION_RE.source, "gi");
    const DATE_RE = /\d{4}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}/;

    const STAGE_RULES = [
      [/resolving dependencies|resolved \d+ packages/i, "stage.resolving"],
      [/collecting\s/i, "stage.collecting"],
      [/downloading\s/i, "stage.downloading"],
      [/installing collected packages|installing\s/i, "stage.installing"],
      [/building wheel|building\s/i, "stage.building"],
      [/preparing metadata|preparing\s/i, "stage.preparing"],
      [/(fetching|cloning|pulling)\s/i, "stage.fetching"],
    ];

    function stripAnsi(text) {
      return String(text).replace(ANSI_RE, "");
    }

    function toInt(value) {
      const n = Number.parseInt(String(value).replace(/[,_\s]/g, ""), 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }

    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value;
    }

    function trimNumber(value) {
      if (!Number.isFinite(value)) return "";
      const abs = Math.abs(value);
      if (abs >= 100) return String(Math.round(value));
      if (abs >= 10) return String(Math.round(value * 10) / 10);
      return String(Math.round(value * 100) / 100);
    }

    function formatPercent(value) {
      if (value >= 99.95) return "100";
      if (value <= 0) return "0";
      if (value < 10) return trimNumber(value);
      return String(Math.round(value));
    }

    function truncate(text, max) {
      const value = String(text).replace(/\s+/g, " ").trim();
      return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function tailLines(text, maxChars) {
      if (!text) return [];
      const raw = String(text);
      const slice = raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw;
      const lines = [];
      for (const line of slice.split(/\r\n|\r|\n/)) {
        if (line.trim().length > 0) lines.push(line);
      }
      return lines;
    }

    function stageOf(raw) {
      const line = stripAnsi(raw);
      for (const [pattern, key] of STAGE_RULES) {
        if (pattern.test(line)) return key;
      }
      return undefined;
    }

    function unitFromLabel(label) {
      if (!label) return "item";
      if (/epoch|轮/i.test(label)) return "epoch";
      if (/step|iter|batch|步/i.test(label)) return "step";
      return "item";
    }

    function fractionResult(n, total, label, line) {
      if (!Number.isFinite(n) || !Number.isFinite(total)) return null;
      if (total < 2 || n > total) return null;
      return {
        n,
        total,
        unitKind: unitFromLabel(label),
        percent: clamp((n / total) * 100, 0, 100),
        source: "fraction",
        text: line,
      };
    }

    /** All labeled fractions on a line, e.g. "Epoch 1/5 | step 18/40" -> epoch + step. */
    function labeledFractions(line) {
      const found = [];
      LABELED_FRACTION_ALL_RE.lastIndex = 0;
      let match;
      while ((match = LABELED_FRACTION_ALL_RE.exec(line)) !== null) {
        if (match.index === LABELED_FRACTION_ALL_RE.lastIndex) LABELED_FRACTION_ALL_RE.lastIndex += 1;
        const n = toInt(match[2]);
        const total = toInt(match[3]);
        if (!Number.isFinite(n) || !Number.isFinite(total) || total < 2 || n > total) continue;
        found.push({ n, total, label: match[1], text: match[0].replace(/\s+/g, " ").trim() });
      }
      return found;
    }

    /** Prefer the finest counter on the line (step/item over epoch) and keep epoch as context. */
    function pickLabeledFraction(line) {
      const all = labeledFractions(line);
      if (all.length === 0) return null;
      const fine = all.filter((entry) => unitFromLabel(entry.label) !== "epoch");
      const chosen = fine.length > 0 ? fine[fine.length - 1] : all[all.length - 1];
      const epoch = all.find((entry) => unitFromLabel(entry.label) === "epoch");
      const context = epoch && epoch !== chosen ? epoch.text : undefined;
      return context ? { ...chosen, context } : chosen;
    }

    function parseRemainingSeconds(match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const third = match[3] === undefined ? undefined : Number(match[3]);
      if (third === undefined) return second === 0 && first === 0 ? undefined : first * 60 + second;
      return first * 3600 + second * 60 + third;
    }

    function parseRate(rawValue, unit) {
      const value = Number.parseFloat(rawValue);
      if (!Number.isFinite(value) || value <= 0) return undefined;
      if (/^s\/it$/i.test(unit)) return { unit: "spt", value };
      return { unit: "itps", value };
    }

    /** Parse a single output line into a progress sample, or null. */
    function parseProgressLine(raw) {
      const line = stripAnsi(raw).trim();
      if (!line) return null;

      const tqdm = TQDM_PERCENT_RE.exec(line);
      if (tqdm) {
        const percent = clamp(Number.parseFloat(tqdm[1]), 0, 100);
        const frac = TQDM_FRAC_RE.exec(line) || FRACTION_RE.exec(line);
        const remain = TQDM_REMAIN_RE.exec(line);
        const rate = TQDM_RATE_RE.exec(line);
        return {
          percent,
          ...(frac ? { n: toInt(frac[1]), total: toInt(frac[2]) } : {}),
          ...(remain ? { remainingSec: parseRemainingSeconds(remain) } : {}),
          ...(rate ? { rate: parseRate(rate[1], rate[2]) } : {}),
          unitKind: "item",
          source: "tqdm",
          text: line,
        };
      }

      const labeled = pickLabeledFraction(line);
      if (labeled) {
        const result = fractionResult(labeled.n, labeled.total, labeled.label, line);
        if (result) return labeled.context ? { ...result, context: labeled.context } : result;
      }

      if (!DATE_RE.test(line)) {
        const frac = FRACTION_RE.exec(line);
        if (frac) {
          const result = fractionResult(toInt(frac[1]), toInt(frac[2]), undefined, line);
          if (result) return result;
        }
      }

      const pct = PERCENT_RE.exec(line);
      if (pct) {
        const percent = Number.parseFloat(pct[1]);
        if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
          return { percent, unitKind: "item", source: "percent", text: line };
        }
      }
      return null;
    }

    function formatDuration(totalSeconds, t) {
      const sec = Math.max(0, Math.round(totalSeconds));
      if (sec < 60) return t("dur.s", { n: sec });
      const min = Math.floor(sec / 60);
      if (min < 60) return t("dur.m", { m: min, s: sec % 60 });
      const hour = Math.floor(min / 60);
      if (hour < 24) return t("dur.h", { h: hour, m: min % 60 });
      return t("dur.d", { d: Math.floor(hour / 24), h: hour % 24 });
    }

    function formatEta(totalSeconds, t) {
      const sec = Math.max(0, Math.round(totalSeconds));
      if (sec < 60) return t("eta.s", { n: sec });
      if (sec < 3600) return t("eta.m", { n: Math.ceil(sec / 60) });
      if (sec < 86400) return t("eta.hm", { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) });
      return t("eta.d", { n: Math.floor(sec / 86400) });
    }

    /** Derive everything the card shows from a JobView plus its observed output. */
    function analyzeJob(job, outputText, now, t) {
      const lines = tailLines(outputText, TAIL_CHARS);

      let sample = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 240; i -= 1) {
        sample = parseProgressLine(lines[i]);
        if (sample) break;
      }
      if (!sample && job && typeof job.progress === "string" && job.progress.trim().length > 0) {
        sample = parseProgressLine(job.progress);
      }

      let stageKey;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 80; i -= 1) {
        stageKey = stageOf(lines[i]);
        if (stageKey) break;
      }

      const startedAt = Number(job && job.startedAt);
      const finishedAt = Number(job && job.finishedAt);
      const endAt = Number.isFinite(finishedAt) ? finishedAt : now;
      const elapsedSec = Number.isFinite(startedAt) ? Math.max(0, (endAt - startedAt) / 1000) : undefined;

      const percent = sample && Number.isFinite(sample.percent) ? clamp(sample.percent, 0, 100) : undefined;
      const n = sample ? sample.n : undefined;
      const total = sample ? sample.total : undefined;
      const remaining = n !== undefined && total !== undefined ? Math.max(0, total - n) : undefined;
      const unitKind = sample ? sample.unitKind : "item";

      let etaSec = sample ? sample.remainingSec : undefined;
      if (etaSec === undefined && percent !== undefined && percent > 0 && percent < 100 && elapsedSec !== undefined && elapsedSec >= 3) {
        etaSec = (elapsedSec * (100 - percent)) / percent;
      }
      if (etaSec === undefined && n !== undefined && n > 0 && total !== undefined && elapsedSec !== undefined && elapsedSec >= 3) {
        etaSec = (elapsedSec * (total - n)) / n;
      }

      let speed = sample ? sample.rate : undefined;
      if (!speed && n !== undefined && n >= 1 && elapsedSec !== undefined && elapsedSec >= 3) {
        speed = { unit: "perMin", value: (n / elapsedSec) * 60 };
      }

      let speedText;
      if (speed) {
        if (speed.unit === "itps") speedText = t("rate.itps", { n: trimNumber(speed.value) });
        else if (speed.unit === "perMin") speedText = t("rate.perMin", { n: trimNumber(speed.value) });
      }

      const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
      const lastLineIsProgress = lastLine.length > 0 && parseProgressLine(lastLine) !== null;
      const lastLineText = lastLineIsProgress ? "" : truncate(stripAnsi(lastLine), DETAIL_MAX);
      const stageText = stageKey ? t(stageKey) : "";
      const contextText = sample && sample.context ? truncate(sample.context, 40) : "";
      const infoText = [contextText, stageText, lastLineText].filter(Boolean).join(" · ");
      const detail = infoText || (percent === undefined ? t("waiting") : "");

      return {
        percent,
        n,
        total,
        remaining,
        unitKey: unitKind === "epoch" ? "unit.epoch" : unitKind === "step" ? "unit.step" : "unit.item",
        etaSec,
        speedText,
        elapsedSec,
        detail,
      };
    }

    // ---------------------------------------------------------------------
    // Presentation helpers
    // ---------------------------------------------------------------------
    function isLive(job) {
      return job && (job.status === "running" || job.status === "stopping");
    }

    function useNow(active) {
      const [now, setNow] = useState(() => Date.now());
      useEffect(() => {
        if (!active) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(timer);
      }, [active]);
      return now;
    }

    function StyleTag() {
      return h("style", null, CSS);
    }

    function JobRow({ sessionId, job, useJobs, observe, killJob, t, now }) {
      const observed = useJobs((state) => state.observed[String(job.id)]);
      useEffect(() => observe(sessionId, job.id), [sessionId, job.id, observe]);

      const [killState, setKillState] = useState("idle"); // idle | armed | stopping | failed
      const armTimer = useRef(null);
      const failTimer = useRef(null);
      useEffect(
        () => () => {
          if (armTimer.current) clearTimeout(armTimer.current);
          if (failTimer.current) clearTimeout(failTimer.current);
        },
        [],
      );

      const onStop = useCallback(async () => {
        if (killState === "stopping") return;
        if (killState !== "armed") {
          setKillState("armed");
          if (armTimer.current) clearTimeout(armTimer.current);
          armTimer.current = setTimeout(() => {
            armTimer.current = null;
            setKillState((current) => (current === "armed" ? "idle" : current));
          }, KILL_ARM_MS);
          return;
        }
        if (armTimer.current) {
          clearTimeout(armTimer.current);
          armTimer.current = null;
        }
        setKillState("stopping");
        let ok = false;
        try {
          ok = await killJob(sessionId, job.id);
        } catch {
          ok = false;
        }
        if (!ok) {
          setKillState("failed");
          if (failTimer.current) clearTimeout(failTimer.current);
          failTimer.current = setTimeout(() => {
            failTimer.current = null;
            setKillState("idle");
          }, KILL_FAILED_MS);
        }
      }, [killState, sessionId, job.id, killJob]);

      const view = analyzeJob(job, observed ? observed.text : "", now, t);
      const stopping = job.status === "stopping" || killState === "stopping";
      const stopLabel =
        killState === "failed"
          ? t("stop.failed")
          : stopping
            ? t("state.stopping")
            : killState === "armed"
              ? t("stop.armed")
              : t("stop");

      return h(
        "div",
        { className: "dsh-tp-job", "data-job-id": String(job.id) },
        h(
          "div",
          { className: "dsh-tp-job-head" },
          h("span", { className: "dsh-tp-kind" }, job.kind || "job"),
          h("span", { className: "dsh-tp-label", title: job.label || undefined }, job.label || t("untitled")),
          view.n !== undefined && view.total !== undefined
            ? h("span", { className: "dsh-tp-frac" }, t("frac", { n: view.n, total: view.total, unit: t(view.unitKey) }))
            : null,
          h("span", { className: "dsh-tp-state", "data-stopping": stopping ? "true" : "false" }, t(stopping ? "state.stopping" : "state.running")),
          h(
            "button",
            {
              type: "button",
              className: "dsh-tp-stop",
              "data-armed": killState === "armed" ? "true" : "false",
              disabled: stopping,
              title: t("stop.hint"),
              onClick: onStop,
            },
            stopLabel,
          ),
        ),
        view.percent !== undefined
          ? h(
              "div",
              { className: "dsh-tp-gauge" },
              h("span", { className: "dsh-tp-percent" }, t("percent", { v: formatPercent(view.percent) })),
              view.remaining !== undefined
                ? h("span", { className: "dsh-tp-remain" }, t("remain", { n: view.remaining }))
                : null,
            )
          : null,
        h(
          "div",
          {
            className: "dsh-tp-bar",
            "data-indeterminate": view.percent === undefined ? "true" : "false",
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            ...(view.percent !== undefined ? { "aria-valuenow": Math.round(view.percent) } : {}),
          },
          h(
            "span",
            {
              className: "dsh-tp-bar-fill",
              style: view.percent !== undefined ? { width: `${Math.max(view.percent, 1)}%` } : undefined,
            },
          ),
        ),
        view.speedText || view.etaSec !== undefined || view.elapsedSec !== undefined
          ? h(
              "div",
              { className: "dsh-tp-stats" },
              view.speedText ? h("span", { className: "dsh-tp-stat" }, h("b", null, view.speedText), h("i", null, t("label.speed"))) : null,
              view.etaSec !== undefined
                ? h("span", { className: "dsh-tp-stat" }, h("b", null, formatEta(view.etaSec, t)), h("i", null, t("label.eta")))
                : null,
              view.elapsedSec !== undefined
                ? h("span", { className: "dsh-tp-stat" }, h("b", null, formatDuration(view.elapsedSec, t)), h("i", null, t("label.elapsed")))
                : null,
            )
          : null,
        view.detail ? h("div", { className: "dsh-tp-detail", title: view.detail }, view.detail) : null,
      );
    }

    function TaskProgressDock({ sessionId, useJobs, watchRows, observe, killJob, t }) {
      const rows = useJobs((state) => (sessionId === undefined ? undefined : state.rows[String(sessionId)]));
      useEffect(() => {
        if (sessionId === undefined) return undefined;
        return watchRows(sessionId);
      }, [sessionId, watchRows]);

      const live = useMemo(() => {
        const all = Array.isArray(rows) ? rows.filter(isLive) : [];
        return all.slice().sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
      }, [rows]);

      const [expanded, setExpanded] = useState(true);
      const [showAll, setShowAll] = useState(false);
      const now = useNow(live.length > 0 && expanded);

      if (live.length === 0) return null;

      const visible = showAll ? live : live.slice(0, MAX_VISIBLE_JOBS);
      const hidden = live.length - visible.length;

      return h(
        "div",
        { className: "dsh-tp-card", "data-dsh-task-progress": "", "data-expanded": expanded ? "true" : "false" },
        h(StyleTag),
        h(
          "div",
          { className: "dsh-tp-head" },
          h(
            "button",
            {
              type: "button",
              className: "dsh-tp-toggle",
              "aria-expanded": expanded,
              onClick: () => setExpanded((value) => !value),
            },
            h("span", { className: "dsh-tp-pulse", "aria-hidden": true }),
            h("span", { className: "dsh-tp-title" }, t("title")),
            h("span", { className: "dsh-tp-count" }, t("count.live", { n: live.length })),
            h("span", { className: "dsh-tp-caret", "aria-hidden": true }, expanded ? "▾" : "▸"),
          ),
        ),
        expanded
          ? h(
              "div",
              { className: "dsh-tp-body" },
              visible.map((job) =>
                h(JobRow, {
                  key: String(job.id),
                  sessionId,
                  job,
                  useJobs,
                  observe,
                  killJob,
                  t,
                  now,
                }),
              ),
              hidden > 0
                ? h("button", { type: "button", className: "dsh-tp-more", onClick: () => setShowAll(true) }, t("count.more", { n: hidden }))
                : null,
              showAll && live.length > MAX_VISIBLE_JOBS
                ? h("button", { type: "button", className: "dsh-tp-more", onClick: () => setShowAll(false) }, t("count.less"))
                : null,
            )
          : null,
      );
    }

    // ---------------------------------------------------------------------
    // Styles (theme tokens only; mounted with the card so it disappears with it)
    // ---------------------------------------------------------------------
    const CSS = `
.dsh-tp-card{box-sizing:border-box;position:absolute;left:12px;right:12px;bottom:10px;z-index:5;display:flex;flex-direction:column;max-height:min(320px,42vh);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-panel,0 6px 24px rgba(0,0,0,.06));overflow:hidden;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px;text-align:left;animation:dsh-tp-rise .16s ease-out}
.dsh-tp-head{display:flex;align-items:center;gap:8px;padding:3px 12px}
.dsh-tp-toggle{appearance:none;-webkit-appearance:none;flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;border:0;background:transparent;padding:1px 0;margin:0;color:inherit;font:inherit;cursor:pointer;border-radius:8px;text-align:left}
.dsh-tp-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6feb);outline-offset:2px}
.dsh-tp-pulse{position:relative;flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary,#2f6feb)}
.dsh-tp-pulse::after{content:"";position:absolute;inset:-3px;border:1px solid var(--dsw-alias-brand-primary,#2f6feb);border-radius:50%;opacity:0;animation:dsh-tp-ping 1.8s ease-out infinite}
.dsh-tp-title{flex:none;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,inherit)}
.dsh-tp-count{flex:1 1 auto;min-width:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-tp-caret{flex:none;font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-tp-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;padding:0 12px 8px;overflow-y:auto}
.dsh-tp-job{display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dsh-tp-job:first-child{border-top:0}
.dsh-tp-job-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-tp-kind{flex:none;max-width:88px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary,inherit);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-tp-label{flex:1 1 auto;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-tp-frac{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);font-variant-numeric:tabular-nums}
.dsh-tp-state{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap}
.dsh-tp-state[data-stopping="true"]{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsh-tp-stop{appearance:none;-webkit-appearance:none;flex:none;padding:1px 10px;border:1px solid var(--dsw-alias-state-error-primary,#d33);border-radius:8px;background:transparent;color:var(--dsw-alias-state-error-primary,#d33);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.dsh-tp-stop:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.dsh-tp-stop[data-armed="true"]{background:var(--dsw-alias-state-error-primary,#d33);color:#fff}
.dsh-tp-stop:disabled{opacity:.55;cursor:default}
.dsh-tp-gauge{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0}
.dsh-tp-percent{font-size:20px;line-height:24px;font-weight:800;color:var(--dsw-alias-brand-primary,#2f6feb);font-variant-numeric:tabular-nums}
.dsh-tp-remain{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit);font-variant-numeric:tabular-nums}
.dsh-tp-bar{position:relative;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.18));overflow:hidden}
.dsh-tp-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-brand-primary,#2f6feb);background:linear-gradient(90deg,var(--dsw-alias-brand-primary,#2f6feb),color-mix(in srgb,var(--dsw-alias-brand-primary,#2f6feb) 45%,#22d3ee));transition:width .35s ease}
.dsh-tp-bar[data-indeterminate="true"] .dsh-tp-bar-fill{width:30% !important;animation:dsh-tp-indeterminate 1.4s ease-in-out infinite}
.dsh-tp-stats{display:flex;flex-wrap:wrap;gap:2px 18px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-tp-stat{white-space:nowrap}
.dsh-tp-stat b{font-weight:600;color:var(--dsw-alias-label-primary,inherit);font-variant-numeric:tabular-nums}
.dsh-tp-stat i{font-style:normal;margin-left:4px;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh-tp-detail{min-width:0;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-tp-more{appearance:none;-webkit-appearance:none;align-self:flex-start;border:0;background:transparent;padding:0;margin:0;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-tp-more:hover{color:var(--dsw-alias-label-primary,inherit)}
.dsh-tp-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6feb);outline-offset:2px;border-radius:6px}
@keyframes dsh-tp-ping{0%{transform:scale(.55);opacity:.7}70%,100%{transform:scale(1.7);opacity:0}}
@keyframes dsh-tp-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes dsh-tp-indeterminate{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}
@media (prefers-reduced-motion: reduce){.dsh-tp-card,.dsh-tp-pulse::after,.dsh-tp-bar-fill{animation:none !important;transition:none !important}}
`;

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------
    return {
      inject: ["jobs", "slots", "locale"],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-task-progress: dictionaries");
        // Registered in the composer's floating overlay (height:0 anchor above the
        // input card), so expanding the card never changes the composer layout.
        ctx.slots.inject("conversation.input.overlay", () =>
          ctx.slots.register(
            {
              name: "conversation.input.overlay",
              id: "task-progress",
              order: 5,
              locale: NS,
              inject: () => ({
                hooks: { jobs: ctx.jobs.state },
                watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
                observe: (sessionId, id) => ctx.jobs.observe(sessionId, id),
                killJob: async (sessionId, jobId) => (await ctx.jobs.kill(sessionId, jobId)).ok,
              }),
            },
            TaskProgressDock,
          ),
        );
      },
    };
  },
});
