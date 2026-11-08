/**
 * Secret / local-path guard.
 *
 * Scans every file that would be committed or packed and fails on credential
 * patterns (API keys, tokens, private keys, password assignments) and on
 * machine-specific absolute paths that would break other people's installs.
 *
 * Run: node scripts/secret-scan.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".tmp", "coverage", ".plugin-manager"]);
const MAX_BYTES = 512 * 1024;

const findings = [];
let scanned = 0;

function walk(dir, rel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, relPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (relPath === "package-lock.json") continue;
    const size = statSync(full).size;
    if (size > MAX_BYTES) continue;
    scan(full, relPath);
  }
}

const RULES = [
  {
    name: "private key block",
    // Split so this file does not match its own pattern.
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  { name: "openai-style key", regex: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "github token", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  { name: "github fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: "aws access key", regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "slack token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google api key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "bearer token", regex: /Bearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  {
    name: "credential assignment",
    regex: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  },
  { name: "windows user path", regex: /[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s]+/ },
  { name: "unix user path", regex: /(^|[\s"'(])\/home\/[a-z0-9._-]+\//i },
  { name: "macos user path", regex: /(^|[\s"'(])\/Users\/[A-Za-z0-9._-]+\// },
];

function scan(full, relPath) {
  scanned += 1;
  const text = readFileSync(full, "utf8");
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.length > 2000) continue;
    for (const rule of RULES) {
      const match = rule.regex.exec(line);
      if (match === null) continue;
      const start = Math.max(0, match.index - 12);
      const snippet = line
        .slice(start, match.index + match[0].length + 12)
        .replace(/[A-Za-z0-9_-]{16,}/g, "***");
      findings.push(`${relPath}:${index + 1} [${rule.name}] ${snippet}`);
    }
  }
}

walk(root, "");

if (findings.length > 0) {
  console.error(`secret-scan found ${findings.length} issue(s) in ${scanned} file(s):`);
  for (const finding of findings) console.error(` - ${finding}`);
  process.exit(1);
}
console.log(`SECRET SCAN PASS (${scanned} files scanned, 0 findings)`);
