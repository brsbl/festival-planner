#!/usr/bin/env node
// Builds a static copy of one festival's page from its folder, so you can look at a lineup and
// theme before installing. Open <out>/index.html in a browser (file:// works); add
// ?now=YYYY-MM-DDTHH:MM to see a moment during the festival.
//
//   node preview.mjs festivals/<slug> <out> [--taste <taste.json>] [--previews <previews.json>]
//                    [--host <machine id>]   write it on another bb machine with `bb file write`
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const plain = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [festivalDir, out] = plain;
if (!festivalDir || !out || !existsSync(join(festivalDir, "lineup.json"))) {
  console.error("usage: node preview.mjs festivals/<slug> <out> [--taste <file>] [--previews <file>] [--host <id>]");
  process.exit(1);
}
const root = resolve(festivalDir, "../..");
const host = flag("--host");
const read = (path, fallback) => (path && existsSync(path) ? readFileSync(path, "utf8") : fallback);
const festival = (file, fallback) => read(join(festivalDir, file), fallback);
// with no taste yet, made-up scores fill the plan, ticker, and top 4 so the whole page can be judged
function demoTaste() {
  const { sets } = JSON.parse(festival("lineup.json"));
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const matches = {};
  for (const s of sets) {
    const key = s.name.toLowerCase();
    if (matches[key]) continue;
    const score = Math.round(rnd() ** 1.6 * 95) + 3;
    matches[key] = { score, tier: score > 70 ? "heavy" : score > 45 ? "deep" : null, known: score > 70, evidence: [], riyl: [], topTrack: null, url: null, img: null };
  }
  return JSON.stringify({ sample: true, user: { name: "" }, matches });
}
const script = (global, json) => `window.${global} = ${JSON.stringify(JSON.parse(json))};\n`;

const files = {
  "data/lineup.js": script("LINEUP", festival("lineup.json")),
  "data/theme.js": script("THEME", JSON.stringify({ ...JSON.parse(festival("theme.json", "{}")), css: existsSync(join(festivalDir, "style.css")) })),
  "data/taste.js": script("TASTE", read(flag("--taste"), festival("sample-taste.json", demoTaste()))),
  "data/previews.js": script("PREVIEWS", read(flag("--previews"), festival("sample-previews.json", "{}"))),
  "festival.css": festival("style.css", ""),
};
for (const file of ["index.html", "styles.css", "app.js", "defaults.js"]) files[file] = readFileSync(join(root, "public", file), "utf8");
const assets = join(festivalDir, "assets");
for (const file of existsSync(assets) ? readdirSync(assets) : []) files[`assets/${file}`] = readFileSync(join(assets, file));

for (const [name, body] of Object.entries(files)) {
  const path = join(out, name);
  if (!host) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); continue; }
  if (typeof body !== "string" && !name.endsWith(".svg")) { console.warn(`skipped ${name}: --host copies text files only`); continue; }
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("bb", ["file", "write", path, "--stdin", "--host", host, "--create-parents"], { input: body, stdio: ["pipe", "ignore", "pipe"] });
      break;
    } catch (error) {
      if (attempt === 4) throw new Error(`couldn't write ${name} on ${host}: ${String(error.stderr ?? error.message).trim()}`);
      execFileSync("sleep", [String(attempt * 2)]);
    }
  }
}
console.log(`preview → ${host ? `${host}:` : ""}${join(out, "index.html")}`);
