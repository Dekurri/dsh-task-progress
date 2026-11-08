/**
 * Parser tests — extract the parsing section out of the real shipped
 * `client.js` and exercise it in a vm sandbox (no bundler, no deps).
 *
 * Run: node test/parse.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const CLIENT_PATH = fileURLToPath(new URL("../client.js", import.meta.url));
const src = readFileSync(CLIENT_PATH, "utf8");

// The parser block lives between these two markers; tests fail loudly if the
// markers move, so refactors cannot silently skip the tests.
const start = src.indexOf("const ANSI_RE = ");
const end = src.indexOf("function isLive(job)");
if (start < 0 || end < 0) throw new Error("parser markers not found in client.js");
const section = `const TAIL_CHARS = 12000; const DETAIL_MAX = 220;\n${src.slice(start, end)}`;

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(section, sandbox, { filename: "parser-section.js" });
const { parseProgressLine, analyzeJob, tailLines, stageOf, formatDuration, formatEta } = sandbox;

const t = (key, params = {}) => `[${key}]` + (Object.keys(params).length ? JSON.stringify(params) : "");

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS ${name} -> ${a}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

// 1. tqdm with rate + remaining
check(
  "tqdm full",
  parseProgressLine("  45%|████▎     | 450/1000 [00:12<00:15, 1.20it/s]"),
  {
    percent: 45,
    n: 450,
    total: 1000,
    remainingSec: 15,
    rate: { unit: "itps", value: 1.2 },
    unitKind: "item",
    source: "tqdm",
    text: "45%|████▎     | 450/1000 [00:12<00:15, 1.20it/s]",
  },
);

// 2. tqdm at start (unknown rate)
const tqdmStart = parseProgressLine("  0%|          | 0/132 [00:00<?, ?it/s]");
check("tqdm start percent", tqdmStart && tqdmStart.percent, 0);
check("tqdm start fraction", tqdmStart && [tqdmStart.n, tqdmStart.total], [0, 132]);
check("tqdm start no rate", tqdmStart && tqdmStart.rate, undefined);

// 3. epoch line
check(
  "epoch",
  parseProgressLine("Epoch 3/10: loss=0.123 val_loss=0.234"),
  { n: 3, total: 10, unitKind: "epoch", percent: 30, source: "fraction", text: "Epoch 3/10: loss=0.123 val_loss=0.234" },
);

// 4. chinese item fraction
check("item fraction", parseProgressLine("翻译进度 1/132 项"), {
  n: 1,
  total: 132,
  unitKind: "item",
  percent: 0.7575757575757576,
  source: "fraction",
  text: "翻译进度 1/132 项",
});

// 5. step line
check("step", parseProgressLine("[step 120/1000] lr=1e-4"), {
  n: 120,
  total: 1000,
  unitKind: "step",
  percent: 12,
  source: "fraction",
  text: "[step 120/1000] lr=1e-4",
});

// 5b. epoch + step on one line: the finest counter wins, the epoch stays as context
const both = parseProgressLine("Epoch 1/5 | step 18/40 | loss 2.2840 | elapsed 7s");
check("epoch+step pick step", both && [both.n, both.total, both.unitKind, both.percent], [18, 40, "step", 45]);
check("epoch+step context", both && both.context, "Epoch 1/5");

// 6. bare percent
check("percent", parseProgressLine("Building wheel for torch (45%)"), {
  percent: 45,
  unitKind: "item",
  source: "percent",
  text: "Building wheel for torch (45%)",
});

// 7. pip stage lines must not parse as progress, but stageOf must label them
check("pip collect stage", typeof parseProgressLine("Collecting torch>=2.0"), "object");
check("pip installing stage", stageOf("Installing collected packages: numpy, scipy"), "stage.installing");
check("pip wheel stage", stageOf("  Building wheel for tokenizers (pyproject.toml)"), "stage.building");

// 8. dates are not fractions
check("date line", parseProgressLine("Log file written 2026/11/09 12:00:00"), null);

// 9. ANSI codes are stripped
check("ansi", parseProgressLine("\u001b[32m70%\u001b[0m done"), {
  percent: 70,
  unitKind: "item",
  source: "percent",
  text: "70% done",
});

// 10. analyzeJob ETA / speed / elapsed on an epoch tail
const now = 1_700_000_000_000;
const job = { startedAt: now - 14_000, status: "running", label: "python train.py" };
const text = ["Epoch 1/10 loss=1.2", "Epoch 2/10 loss=0.8", "Epoch 3/10 loss=0.5"].join("\n");
const view = analyzeJob(job, text, now, t);
check("analyze percent", view.percent, 30);
check("analyze n/total", [view.n, view.total, view.unitKey], [3, 10, "unit.epoch"]);
check("analyze elapsed", view.elapsedSec, 14);
check("analyze eta", Math.round(view.etaSec), 33);
check("analyze speed", view.speedText, '[rate.perMin]{"n":"12.9"}');

// 11. analyzeJob with tqdm text
const tqdmView = analyzeJob(job, " 45%|███| 450/1000 [00:12<00:15, 1.20it/s]", now, t);
check("tqdm analyze percent", tqdmView.percent, 45);
check("tqdm analyze eta", tqdmView.etaSec, 15);
check("tqdm analyze speed", tqdmView.speedText, '[rate.itps]{"n":"1.2"}');
check("tqdm analyze remaining", tqdmView.remaining, 550);

// 11b. training log with both epoch and step: counter = step, detail carries epoch
const epochStep = analyzeJob(job, "Epoch 1/5 | step 18/40 | loss 2.2840", now, t);
check("epoch+step analyze percent", epochStep.percent, 45);
check("epoch+step analyze unit", epochStep.unitKey, "unit.step");
check("epoch+step analyze detail", epochStep.detail, "Epoch 1/5");

// 12. no numbers -> stage / waiting detail
const quiet = analyzeJob({ startedAt: now - 5_000, status: "running" }, "Collecting torch\nDownloading torch", now, t);
check("quiet percent", quiet.percent, undefined);
check("quiet detail", quiet.detail, "[stage.downloading] · Downloading torch");
const empty = analyzeJob({ startedAt: now - 1_000, status: "running" }, "", now, t);
check("empty detail", empty.detail, "[waiting]");

// 13. durations
check("duration seconds", formatDuration(14, (k, p) => `${k}:${JSON.stringify(p)}`), 'dur.s:{"n":14}');
check("eta minutes", formatEta(725, (k, p) => `${k}:${JSON.stringify(p)}`), 'eta.m:{"n":13}');

// 14. tailLines handles \r progress bars
check("tailLines cr", tailLines("a\rb\r\nc\n", 100), ["a", "b", "c"]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
