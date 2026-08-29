// Regenerates src/lib/wordle/answers.ts and src/lib/wordle/allowed.ts from the
// original Wordle word lists. Run: node scripts/gen-wordle-words.mjs
//
// Sources (original Wordle source-code lists, mirrored by @cfreshman):
//   answers:          https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b
//   allowed (extra):  https://gist.github.com/cfreshman/cdcdf777450c5b5301e439061d29694c

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ANSWERS_URL =
  "https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw";
const ALLOWED_URL =
  "https://gist.githubusercontent.com/cfreshman/cdcdf777450c5b5301e439061d29694c/raw";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "wordle");

const normalize = (text) =>
  text
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{5}$/.test(w));

async function fetchList(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return normalize(await res.text());
}

const header =
  "// AUTO-GENERATED - do not edit by hand.\n" +
  "// Regenerate with: node scripts/gen-wordle-words.mjs\n" +
  "// Source: original Wordle word lists (gist.github.com/cfreshman).\n\n";

const answers = [...new Set(await fetchList(ANSWERS_URL))];
const extra = await fetchList(ALLOWED_URL);
const allowed = [...new Set([...answers, ...extra])].sort();

writeFileSync(
  join(outDir, "answers.ts"),
  header +
    "/** Candidate solution words. The daily word is picked from this list. */\n" +
    `export const ANSWERS: readonly string[] = "${answers.join(" ")}".split(" ");\n`,
);

writeFileSync(
  join(outDir, "allowed.ts"),
  header +
    "/** Every word accepted as a guess (answers + extra allowed guesses). */\n" +
    `const RAW =\n  "${allowed.join(" ")}";\n\n` +
    "export const ALLOWED_GUESSES: ReadonlySet<string> = new Set(RAW.split(\" \"));\n",
);

console.log(`answers: ${answers.length}, allowed: ${allowed.length}`);
