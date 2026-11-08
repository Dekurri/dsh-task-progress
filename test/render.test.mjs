/**
 * Render tests — load the real shipped `client.js` in a vm sandbox, apply it to
 * a fake client context and render the dock component with React server
 * rendering, asserting the produced markup, the slot registration and the
 * locale dictionaries.
 *
 * Run: node test/render.test.mjs   (needs the devDependencies: react/react-dom)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const CLIENT_PATH = fileURLToPath(new URL("../client.js", import.meta.url));
const source = readFileSync(CLIENT_PATH, "utf8");

// --- 1. load the client module in a sandbox and capture the plugin factory ----
let captured;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (spec) => {
        captured = spec;
      },
    },
  },
  console,
  Date,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "client.js" });

const fails = [];
function ok(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else {
    fails.push(name);
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

ok("factory id", captured && captured.id === "dsh-task-progress");
const plugin = captured.factory((name) => {
  if (name === "react") return React;
  throw new Error(`unexpected require(${name})`);
});
ok(
  "inject list",
  Array.isArray(plugin.inject) && ["jobs", "slots", "locale"].every((k) => plugin.inject.includes(k)),
  JSON.stringify(plugin.inject),
);

// --- 2. fake client context (no Host, no real DSH) ---------------------------
const dictionaries = {};
const listeners = new Set();
let snapshot = { rows: {}, observed: {} };
const model = {
  getSnapshot: () => snapshot,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
function translate(dict, key, params = {}) {
  const template = dict[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (_, token) =>
    params[token] === undefined ? `{${token}}` : String(params[token]),
  );
}
const registrations = [];
const ctx = {
  effect: (fn) => {
    const dispose = fn();
    return typeof dispose === "function" ? dispose : () => {};
  },
  locale: {
    register: (ns, dicts) => {
      dictionaries[ns] = dicts;
      return () => {};
    },
    bind: (ns) => (key, params) => translate(dictionaries[ns].zh, key, params),
  },
  slots: {
    inject: (name, fn) => fn(),
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
  },
  jobs: {
    state: model,
    watchRows: () => () => {},
    observe: () => () => {},
    kill: async () => ({ ok: true, value: {} }),
  },
};
plugin.apply(ctx);

ok("one slot registration", registrations.length === 1);
const { options, component } = registrations[0];
ok("slot name", options.name === "conversation.input.overlay");
ok("slot id", options.id === "task-progress");
ok("slot order", options.order === 5);
ok("slot locale", options.locale === "task-progress");
ok("zh dict registered", Boolean(dictionaries["task-progress"] && dictionaries["task-progress"].zh));
ok("en dict registered", Boolean(dictionaries["task-progress"] && dictionaries["task-progress"].en));

const injected = options.inject();
ok("inject hooks.jobs", injected.hooks && injected.hooks.jobs === model);
ok("inject watchRows", typeof injected.watchRows === "function");
ok("inject observe", typeof injected.observe === "function");
ok("inject killJob", typeof injected.killJob === "function");
ok("inject killJob returns ok bool", (await injected.killJob("s", "j")) === true);

// --- 3. useJobs shim with the same shape as the renderer's selector hook -----
const useJobs = (selector) =>
  React.useSyncExternalStore(
    model.subscribe,
    () => selector(model.getSnapshot()),
    () => selector(model.getSnapshot()),
  );
const t = (key, params) => translate(dictionaries["task-progress"].zh, key, params);
const baseProps = {
  sessionId: "sess-1",
  useJobs,
  watchRows: injected.watchRows,
  observe: injected.observe,
  killJob: injected.killJob,
  t,
};
const render = () => renderToStaticMarkup(React.createElement(component, baseProps));

// 3a. no live jobs -> nothing at all
ok("empty rows render nothing", render() === "");

// 3b. one live tqdm job
const now = Date.now();
const job = {
  id: "job-abc",
  kind: "bash",
  label: "python train.py",
  status: "running",
  startedAt: now - 14_000,
  output: { total: 120, earliest: 0 },
};
snapshot = {
  rows: { "sess-1": [job] },
  observed: {
    "job-abc": { jobId: "job-abc", text: "epoch 0\r 45%|███| 450/1000 [00:12<00:15, 1.20it/s]\r", streaming: true },
  },
};
let html = render();
console.log("\n--- tqdm markup ---\n" + html.replace(/></g, ">\n<") + "\n");
for (const needle of [
  "data-dsh-task-progress",
  "任务进度",
  "运行中 1 项",
  "45%",
  "450 / 1000 项",
  "1.2 it/s",
  "15秒",
  "14秒",
  "剩余 550",
  ">停止<",
  'aria-valuenow="45"',
  "python train.py",
  'class="dsh-tp-kind">bash<',
]) {
  ok(`tqdm markup contains ${JSON.stringify(needle)}`, html.includes(needle));
}
ok("tqdm determinate", html.includes('data-indeterminate="false"'));
ok("tqdm progress width", html.includes("width:45%"));

// 3c. pip stage, no numbers -> indeterminate + stage label
const pipJob = { ...job, id: "job-pip", label: "pip install torch", startedAt: now - 5_000 };
snapshot = {
  rows: { "sess-1": [pipJob] },
  observed: {
    "job-pip": { jobId: "job-pip", text: "Collecting torch\n  Downloading torch-2.1.0.whl (1.2 MB)\n", streaming: true },
  },
};
html = render();
ok("pip indeterminate", html.includes('data-indeterminate="true"'));
ok("pip stage label", html.includes("下载中…"));
ok("pip no percent gauge", !html.includes('class="dsh-tp-percent"'));
ok("pip waiting frac absent", !html.includes('class="dsh-tp-frac"'));

// 3d. stopping job
snapshot = {
  rows: { "sess-1": [{ ...job, status: "stopping" }] },
  observed: {},
};
html = render();
ok("stopping label", html.includes("停止中…"));
ok("stopping disables button", html.includes("disabled"));

// --- 4. dictionary coverage for every statically used key --------------------
const used = new Set();
for (const match of source.matchAll(/\bt\("([^"]+)"\)/g)) used.add(match[1]);
const zhDict = dictionaries["task-progress"].zh;
const enDict = dictionaries["task-progress"].en;
const missingZh = [...used].filter((key) => zhDict[key] === undefined);
const missingEn = [...used].filter((key) => enDict[key] === undefined);
ok("all literal zh keys present", missingZh.length === 0, JSON.stringify(missingZh));
ok("all literal en keys present", missingEn.length === 0, JSON.stringify(missingEn));
for (const key of ["unit.item", "unit.step", "unit.epoch", "state.running", "state.stopping"]) {
  ok(`dynamic key ${key} present`, zhDict[key] !== undefined && enDict[key] !== undefined);
}

console.log(fails.length === 0 ? "\nALL PASS" : `\n${fails.length} FAILURE(S)`);
process.exit(fails.length === 0 ? 0 : 1);
