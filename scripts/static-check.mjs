/**
 * Static guards for the DSH plugin bundle.
 *
 * These checks encode the rules a DSH UI plugin must follow (from the
 * cordis-plugin-development skill): the bundle manifest, the patch file, the
 * client module contract, allowed theme tokens and locale metadata. Run them
 * before every release: `npm run check`.
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
let checks = 0;

function pass(name) {
  checks += 1;
  console.log(`PASS ${name}`);
}
function fail(name, detail) {
  checks += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, condition, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}
function read(rel) {
  return readFileSync(root + rel, "utf8");
}

// --- 1. package manifest -----------------------------------------------------
const pkg = JSON.parse(read("package.json"));
check("package name", pkg.name === "dsh-task-progress", String(pkg.name));
check("package version", /^\d+\.\d+\.\d+$/.test(pkg.version), String(pkg.version));
check("license MIT", pkg.license === "MIT");
check("type module", pkg.type === "module");
check("node engine set", typeof pkg.engines?.node === "string");
check("repository url", /^git\+https:\/\/github\.com\/[^/]+\/dsh-task-progress\.git$/.test(pkg.repository?.url ?? ""));
check("exports client", pkg.exports?.["./client"] === "./client.js");
check("exports locale glob", Boolean(pkg.exports?.["./locale/*.json"]));
check("dsh bundle patch", pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
check("dsh client platform web", pkg.dsh?.client?.platform === "web");
check("dsh client immediately", pkg.dsh?.client?.immediately === true);
for (const dep of [
  "@deepseek-ai/dsh-api-job-controller",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-conversation",
]) {
  check(`dsh client inject ${dep}`, (pkg.dsh?.client?.inject ?? []).includes(dep));
}
check("published from git, not npm", pkg.private === true);
for (const file of ["index.js", "client.js", "cordis.patch.yml", "icon.svg", "README.md", "LICENSE"]) {
  try {
    statSync(root + file);
    pass(`file ${file} exists`);
  } catch {
    fail(`file ${file} exists`);
  }
}
for (const entry of pkg.files) {
  const normalized = entry.replace(/\*\*?.*$/, "");
  if (normalized === "") continue;
  try {
    statSync(root + normalized);
    pass(`files entry ${entry} resolves`);
  } catch {
    fail(`files entry ${entry} resolves`);
  }
}

// --- 2. host half ------------------------------------------------------------
const index = read("index.js");
check("index exports apply()", /export\s+function\s+apply\s*\(/.test(index));
check("index has no fs/network access", !/node:(fs|net|http|https)|require\(|process\.env/.test(index));

// --- 3. cordis patch ---------------------------------------------------------
const patch = read("cordis.patch.yml");
check("patch inserts task-progress", /-\s*insert:/.test(patch) && /id:\s*task-progress\b/.test(patch));
check("patch name matches package", new RegExp(`name:\\s*['"]?${pkg.name}['"]?`).test(patch));

// --- 4. client module contract ----------------------------------------------
const client = read("client.js");
check("client uses ModuleLoader", client.includes("window.__ModuleLoader__.load"));
check("client factory id matches package", new RegExp(`id:\\s*["']${pkg.name}["']`).test(client));
check("client requires react only", !/require\((["'])(?!react\1)[^)]*\)/.test(client));
check("client avoids harness client packages", !/@deepseek-ai\/dsh-client-/.test(client));
check("client registers floating overlay slot", client.includes('"conversation.input.overlay"'));
check("client registers id task-progress", client.includes('id: "task-progress"'));
check("client uses jobs stream (list/follow)", client.includes("ctx.jobs.state") && client.includes("watchRows"));
check("client has two-step kill confirmation", client.includes("killJob") && client.includes("KILL_ARM_MS"));
check("client cleans up subscriptions", client.includes("return () =>") || client.includes("clearInterval"));
check("no iframe/html embedding", !/<iframe|<!doctype|<html[\s>]/i.test(client));
check("no document.body writes", !/document\.body|document\.head\.appendChild/.test(client));
check("no external fetch/cdn", !/fetch\(|https?:\/\//.test(client.replace(/\[\s*"[^"]*"\]/g, "")));
check("no hardcoded local paths", !/[A-Za-z]:\\{1,2}(Users|Program Files|agent-file)/i.test(client));

// --- 5. theme tokens ---------------------------------------------------------
const tokenPattern = /var\((--[a-zA-Z0-9-]+)/g;
const allowedTokenPrefix = /^--dsw-(alias|specific|elevation|menu|radius|font)-/;
const tokens = new Set();
for (const match of client.matchAll(tokenPattern)) tokens.add(match[1]);
check("theme tokens found", tokens.size > 0);
for (const token of tokens) {
  check(`theme token ${token}`, allowedTokenPrefix.test(token));
}

// --- 6. locale metadata + dictionaries --------------------------------------
for (const locale of ["en", "zh"]) {
  const dict = JSON.parse(read(`locale/${locale}.json`));
  check(`locale ${locale} meta.title`, typeof dict.meta?.title === "string" && dict.meta.title.length > 0);
  check(`locale ${locale} meta.description`, typeof dict.meta?.description === "string" && dict.meta.description.length > 0);
}

// --- 7. icon size budget -----------------------------------------------------
const iconSize = statSync(root + "icon.svg").size;
check("icon.svg within 256 KiB", iconSize > 0 && iconSize <= 256 * 1024, `${iconSize} bytes`);

// --- 8. docs present ---------------------------------------------------------
for (const doc of ["README.md", "INSTALL.md", "CONTRACT.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md"]) {
  statSync(root + doc);
  const body = read(doc);
  check(`${doc} non-trivial`, body.length > 200, `${body.length} bytes`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} guard(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`\nSTATIC CHECK PASS (${checks} guards)`);
