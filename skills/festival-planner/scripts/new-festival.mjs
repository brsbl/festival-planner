#!/usr/bin/env node
// Starts a festival folder, festivals/<slug>/. If examples/<slug>/ exists it's copied, finished;
// otherwise you get a lineup and theme to fill in. The slug becomes the page's address, so use the
// festival and year: coachella-2026.
//
//   node new-festival.mjs <slug> [<plugin folder>]
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [slug, folder] = process.argv.slice(2);
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("usage: node new-festival.mjs <slug> [<plugin folder>]   (slug: lowercase letters, digits, dashes, e.g. outside-lands-2026)");
  process.exit(1);
}
const root = resolve(folder ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const dir = join(root, "festivals", slug);
if (existsSync(dir)) {
  console.error(`festivals/${slug} already exists`);
  process.exit(1);
}
const example = join(root, "examples", slug);
if (existsSync(example)) {
  cpSync(example, dir, { recursive: true });
  console.log(`copied examples/${slug} to festivals/${slug}: check its lineup is still current, then brand and install`);
  process.exit(0);
}
mkdirSync(join(dir, "assets"), { recursive: true });
const year = Number(/(\d{4})$/.exec(slug)?.[1] ?? new Date().getFullYear());
const name = slug.replace(/-?\d{4}$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
writeFileSync(join(dir, "lineup.json"), JSON.stringify({
  festival: { name, year, venue: "", timeZone: "", source: "", doors: "12:00", close: "23:00", days: [{ id: "day1", label: "FRI", date: `${year}-01-01` }] },
  stages: [{ id: "main", name: "Main Stage", icon: "stage" }],
  walk: {},
  sets: [],
}, null, 2) + "\n");
writeFileSync(join(dir, "theme.json"), JSON.stringify({ style: {}, day: {}, night: {}, fonts: {}, copy: {} }, null, 2) + "\n");
writeFileSync(join(dir, "style.css"), `/* ${name} ${year}: the festival's signature. Loads after the planner's own styles. */\n`);
const examples = existsSync(join(root, "examples")) ? readdirSync(join(root, "examples")) : [];
console.log(`started festivals/${slug}: fill in lineup.json, theme.json, style.css, and icon.svg${examples.length ? ` (finished examples to learn from: ${examples.join(", ")})` : ""}`);
