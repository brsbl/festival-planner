#!/usr/bin/env node
// Run after adding, removing, or editing a festival. It checks every festivals/<slug>/ folder,
// gives each one a sidebar entry named after it (festivals/index.json) with its own icon, and
// warns about colours too close to read and fonts that won't load. Reinstall afterwards.
//
//   node brand.mjs [<plugin folder>]        defaults to the folder this skill lives in
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const festivalsDir = join(root, "festivals");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const problems = [];

const slugs = readdirSync(festivalsDir).filter((s) => statSync(join(festivalsDir, s)).isDirectory()).sort();
const index = [];
for (const slug of slugs) {
  const dir = join(festivalsDir, slug);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { problems.push(`${slug}: folder names must be lowercase letters, digits, and dashes`); continue; }
  if (!existsSync(join(dir, "lineup.json"))) { problems.push(`${slug}: no lineup.json, so it's skipped`); continue; }
  const { name, year } = readJson(join(dir, "lineup.json")).festival;
  index.push({ slug, title: `${name} ${year}`, icon: existsSync(join(dir, "icon.svg")) ? slug : "festival" });

  const theme = existsSync(join(dir, "theme.json")) ? readJson(join(dir, "theme.json")) : {};
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
pkg.description = one ? `Your ${one} schedule, built from your Spotify likes.` : "Your festival schedules, built from your Spotify likes.";
pkg.bb.name = one ?? "Festival Planner";
pkg.bb.description = pkg.description;
pkg.bb.branding.experimental_icons = { festival: "./assets/icon.svg", ...Object.fromEntries(index.filter((f) => f.icon !== "festival").map((f) => [f.slug, `./festivals/${f.slug}/icon.svg`])) };
writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

for (const f of index) console.log(`${f.slug}\t${f.title}`);
if (problems.length) console.log("needs a look:\n  " + problems.join("\n  "));
console.log(`next: bb plugin install "path:${root}" --yes`);
