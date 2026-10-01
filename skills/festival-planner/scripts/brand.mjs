#!/usr/bin/env node
// Run after adding, removing, or editing a festival. It checks every festivals/<slug>/ folder,
// gives each one a sidebar entry named after it (festivals/index.json) with its own icon, and
// warns about colours too close to read and fonts that won't load. A folder the planner would
// refuse to load is left out and reported, and the script exits 1. Reinstall afterwards.
//
//   node brand.mjs [<plugin folder>]        defaults to the folder this skill lives in
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const festivalsDir = join(root, "festivals");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const problems = [];
const broken = [];

// the same shapes server.ts checks with zod, kept dependency-free so this runs before npm install
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.length > 0;
const clock = (v) => typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v);
const oneOf = (...values) => (v) => values.includes(v);
const bool = (v) => typeof v === "boolean";
function lineupErrors(l) {
  const errors = [];
  const check = (ok, path) => { if (!ok) errors.push(path); };
  const f = isObject(l) && isObject(l.festival) ? l.festival : {};
  check(isObject(l?.festival), "festival");
  for (const key of ["name", "code", "venue", "timeZone"]) check(text(f[key]), `festival.${key}`);
  check(Number.isInteger(f.year), "festival.year");
  check(typeof f.source === "string", "festival.source");
  check(clock(f.doors) && clock(f.close), "festival.doors/close (HH:MM)");
  const days = Array.isArray(f.days) ? f.days : [];
  check(days.length > 0, "festival.days");
  days.forEach((d, i) => check(text(d?.id) && text(d?.label) && /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? ""), `festival.days.${i}`));
  const stages = Array.isArray(l?.stages) ? l.stages : [];
  check(stages.length > 0, "stages");
  stages.forEach((s, i) => check(text(s?.id) && text(s?.name) && text(s?.short) && typeof s?.icon === "string"
    && [s?.x, s?.y].every((n) => typeof n === "number" && n >= 0 && n <= 1), `stages.${i}`));
  check(isObject(l?.walk) && Object.values(l.walk).every((n) => typeof n === "number" && n >= 0), "walk");
  const sets = Array.isArray(l?.sets) ? l.sets : [];
  check(sets.length > 0, "sets");
  const dayIds = new Set(days.map((d) => d?.id));
  const stageIds = new Set(stages.map((s) => s?.id));
  sets.forEach((s, i) => check(text(s?.id) && text(s?.name) && /^[A-Z]\d+$/.test(s?.pos ?? "") && typeof s?.cat === "string"
    && (s?.qualifier === null || typeof s?.qualifier === "string") && typeof s?.billing === "string" && typeof s?.blurb === "string"
    && Array.isArray(s?.tags) && dayIds.has(s?.day) && stageIds.has(s?.stage)
    && Number.isInteger(s?.start) && Number.isInteger(s?.end) && s.end > s.start, `sets.${i}${text(s?.name) ? ` (${s.name})` : ""}`));
  return errors.slice(0, 8).map((path) => `lineup.json ${path} is missing or malformed; run build-lineup.mjs on it`);
}
const STYLE = {
  shape: oneOf("print", "soft", "flat"), wordmark: oneOf("tiles", "solid", "outline"), photos: oneOf("duotone", "color", "mono"),
  rules: oneOf("dashed", "solid", "dotted", "none"), meter: oneOf("bars", "dots", "number"), marker: oneOf("highlighter", "underline", "none"),
  catalog: oneOf("on", "off"), ticker: bool, numbers: oneOf("on", "off"), case: oneOf("upper", "natural"), alternate: bool,
};
const COPY = ["title", "side", "compiledFor", "sampleTaste", "noTaste", "lightsOff", "lightsOn", "taste", "top", "plan", "catalog", "list", "grid",
  "linerNotes", "credits", "footer", "map", "live", "now", "sep", "tiers"];
function themeErrors(t) {
  if (!isObject(t)) return ["theme.json isn't an object"];
  const errors = [];
  const allowed = ["fonts", "day", "night", "texture", "wordmark", "skyline", "style", "copy"];
  for (const key of Object.keys(t)) if (!allowed.includes(key)) errors.push(`theme.json has an unknown key "${key}"`);
  if (t.fonts !== undefined && !(isObject(t.fonts) && Object.values(t.fonts).every((v) => typeof v === "string"))) errors.push("theme.json fonts must be strings");
  for (const mode of ["day", "night"]) {
    if (t[mode] === undefined) continue;
    if (!isObject(t[mode])) { errors.push(`theme.json ${mode} must be an object`); continue; }
    for (const [name, value] of Object.entries(t[mode])) {
      if (!/^[a-z0-9-]+$/.test(name) || !/^#[0-9a-fA-F]{6}$/.test(value)) errors.push(`theme.json ${mode}.${name} must be a #rrggbb colour`);
    }
  }
  if (t.texture !== undefined && !bool(t.texture)) errors.push("theme.json texture must be true or false");
  if (t.skyline !== undefined && !oneOf("port", "none")(t.skyline)) errors.push('theme.json skyline must be "port" or "none"');
  if (t.wordmark !== undefined && !(isObject(t.wordmark) && (t.wordmark.ball === undefined || bool(t.wordmark.ball))
    && (t.wordmark.case === undefined || oneOf("upper", "lower", "as-is")(t.wordmark.case)))) errors.push("theme.json wordmark has a bad ball or case");
  if (t.style !== undefined) {
    if (!isObject(t.style)) errors.push("theme.json style must be an object");
    else for (const [key, value] of Object.entries(t.style)) if (STYLE[key] && !STYLE[key](value)) errors.push(`theme.json style.${key} can't be ${JSON.stringify(value)}`);
  }
  if (t.copy !== undefined) {
    if (!isObject(t.copy)) errors.push("theme.json copy must be an object");
    else for (const [key, value] of Object.entries(t.copy)) {
      if (!COPY.includes(key)) continue;
      if (key === "tiers") {
        for (const [tier, words] of Object.entries(isObject(value) ? value : {})) for (const [k, v] of Object.entries(isObject(words) ? words : {})) {
          if (typeof v !== "string" || v.length > (k === "hint" ? 160 : 80)) errors.push(`theme.json copy.tiers.${tier}.${k} must be text up to ${k === "hint" ? 160 : 80} characters`);
        }
      } else if (typeof value !== "string" || value.length > 80) errors.push(`theme.json copy.${key} must be text up to 80 characters`);
    }
  }
  return errors;
}

const slugs = readdirSync(festivalsDir).filter((s) => statSync(join(festivalsDir, s)).isDirectory()).sort();
const index = [];
for (const slug of slugs) {
  const dir = join(festivalsDir, slug);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { problems.push(`${slug}: folder names must be lowercase letters, digits, and dashes`); continue; }
  if (!existsSync(join(dir, "lineup.json"))) { problems.push(`${slug}: no lineup.json, so it's skipped`); continue; }
  const errors = [];
  const read = (file, fallback) => {
    if (!existsSync(join(dir, file))) return fallback;
    try { return readJson(join(dir, file)); } catch { errors.push(`${file} is not valid JSON`); return fallback; }
  };
  const lineup = read("lineup.json", null);
  const theme = read("theme.json", {});
  for (const file of ["artists.json", "sample-taste.json", "sample-previews.json"]) read(file, null);
  if (lineup) errors.push(...lineupErrors(lineup));
  errors.push(...themeErrors(theme));
  if (errors.length) { broken.push(...errors.map((e) => `${slug}: ${e}`)); continue; }
  const { name, year } = lineup.festival;
  index.push({ slug, title: `${name} ${year}`, icon: existsSync(join(dir, "icon.svg")) ? slug : "festival" });

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = (hex) => { const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const mode of ["day", "night"]) {
    const c = theme[mode] ?? {};
    if (!c.ink || !c.paper) problems.push(`${slug}: ${mode}.ink and ${mode}.paper aren't both set, so ${mode} mode keeps the planner's default colours`);
    // day mode also puts cream on ink (picked grid sets) and on black (the now bar)
    const pairs = [["ink", "paper", 4.5], ["ink-70", "paper", 3], ["knock-fg", "knock-bg", 3], ["ink", "highlighter", 3]]
      .concat(mode === "day" ? [["cream", "black", 4.5], ["cream", "ink", 4.5]] : []);
    for (const [fg, bg, min] of pairs) {
      if (!c[fg] || !c[bg]) continue;
      const ratio = contrast(c[fg], c[bg]);
      if (ratio < min) problems.push(`${slug} ${mode}: ${fg} on ${bg} is ${ratio.toFixed(1)}:1, needs ${min}:1`);
    }
  }
  const google = decodeURIComponent(theme.fonts?.google ?? "").replace(/\+/g, " ");
  for (const role of ["display", "wordmark", "serif", "body", "mono", "hand"]) {
    const family = theme.fonts?.[role];
    if (family && !google.includes(`family=${family}`)) problems.push(`${slug}: fonts.${role} "${family}" isn't in fonts.google, so it won't load`);
  }
}
if (!index.length) problems.push("no festivals: add a festivals/<slug>/ folder with node new-festival.mjs <slug>");
writeFileSync(join(festivalsDir, "index.json"), JSON.stringify(index, null, 2) + "\n");

const pkg = readJson(join(root, "package.json"));
const one = index.length === 1 ? index[0].title : null;
pkg.description = `Your ${one ? `${one} schedule` : "festival schedules"}, ranked by what you like and play on Spotify.`;
pkg.bb.name = one ?? "Festival Planner";
pkg.bb.description = pkg.description;
pkg.bb.branding.experimental_icons = { festival: "./assets/icon.svg", ...Object.fromEntries(index.filter((f) => f.icon !== "festival").map((f) => [f.slug, `./festivals/${f.slug}/icon.svg`])) };
writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

for (const f of index) console.log(`${f.slug}\t${f.title}`);
if (problems.length) console.log("needs a look:\n  " + problems.join("\n  "));
if (broken.length) {
  console.error("won't load until fixed, so it's left out of the sidebar:\n  " + broken.join("\n  "));
  process.exit(1);
}
console.log(`next: bb plugin install "path:${root}" --yes`);
