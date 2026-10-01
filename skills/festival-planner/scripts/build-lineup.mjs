#!/usr/bin/env node
// Checks a lineup you wrote and puts it in the planner's format, in place unless you give an output.
// Times may be "HH:MM" or minutes after midnight; sets that run past midnight can use "00:30" or "24:30".
// Missing ids, catalogue numbers, stage icons, map positions, and walk times are filled in.
// Running it again on its own output changes nothing.
//
//   node build-lineup.mjs festival/lineup.json [<out.json>]
import { readFileSync, writeFileSync } from "node:fs";

const [input, output = input] = process.argv.slice(2);
if (!input) {
  console.error("usage: node build-lineup.mjs <lineup.json> [<out.json>]");
  process.exit(1);
}
const src = JSON.parse(readFileSync(input, "utf8"));
const problems = [];
const need = (value, what) => { if (value === undefined || value === null || value === "") problems.push(`missing ${what}`); return value; };
const minutes = (t, what) => {
  if (typeof t === "number") return t;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ""));
  if (!m) { problems.push(`${what}: "${t}" isn't HH:MM`); return 0; }
  return Number(m[1]) * 60 + Number(m[2]);
};
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const f = src.festival ?? {};
need(f.name, "festival.name"); need(f.year, "festival.year"); need(f.timeZone, "festival.timeZone");
need(f.doors, "festival.doors"); need(f.close, "festival.close");
if (!Array.isArray(f.days) || !f.days.length) problems.push("festival.days needs at least one { id, label, date }");
const code = f.code || `${String(f.name ?? "FEST").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${String(f.year ?? "").slice(-2)}`;
const doors = minutes(f.doors, "festival.doors");
const festival = {
  name: f.name, year: f.year, code, venue: f.venue || f.name, timeZone: f.timeZone, source: f.source ?? "",
  doors: f.doors, close: f.close, days: f.days ?? [], ...(f.map ? { map: f.map } : {}),
};

const ICONS = new Set(["pier", "crane", "warehouse", "ship", "ball", "tent", "stage"]);
const stagesIn = src.stages ?? [];
if (!stagesIn.length) problems.push("stages is empty");
const stages = stagesIn.map((s, i) => ({
  id: need(s.id, `stages[${i}].id`),
  name: need(s.name, `stages[${i}].name`),
  short: s.short || String(s.name ?? "").toUpperCase().replace(/^THE /, "").slice(0, 5).trim(),
  icon: ICONS.has(s.icon) ? s.icon : "stage",
  x: s.x ?? (stagesIn.length === 1 ? 0.5 : 0.1 + (0.8 * i) / (stagesIn.length - 1)),
  y: s.y ?? (i % 2 ? 0.7 : 0.3),
  ...(s.wide ? { wide: true } : {}),
  ...(s.ambient ? { ambient: true } : {}),
}));
const stageIds = new Set(stages.map((s) => s.id));
const dayIds = new Set(festival.days.map((d) => d.id));

const walk = { ...(src.walk ?? {}) };
for (const a of stages) for (const b of stages) {
  if (a.id >= b.id) continue;
  if (walk[`${a.id}|${b.id}`] === undefined && walk[`${b.id}|${a.id}`] === undefined) walk[`${a.id}|${b.id}`] = 5;
}

const raw = (src.sets ?? []).map((s, i) => {
  const what = `sets[${i}] (${s.name ?? "?"})`;
  need(s.name, `${what}.name`);
  if (!dayIds.has(s.day)) problems.push(`${what}: day "${s.day}" isn't in festival.days`);
  if (!stageIds.has(s.stage)) problems.push(`${what}: stage "${s.stage}" isn't in stages`);
  let start = minutes(s.start, `${what}.start`), end = minutes(s.end, `${what}.end`);
  const opens = minutes(festival.days.find((d) => d.id === s.day)?.doors ?? f.doors, `${what} day doors`);
  if (start < opens - 180) start += 1440;
  if (end <= start) end += 1440;
  if (end - start > 16 * 60) problems.push(`${what}: ${s.start}–${s.end} is longer than 16 hours`);
  return { ...s, start, end };
});
const days = festival.days.map((d) => d.id);
raw.sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.start - b.start);
const perDay = new Map();
const seen = new Set();
const sets = raw.map((s, i) => {
  const d = days.indexOf(s.day);
  const n = (perDay.get(s.day) ?? 0) + 1;
  perDay.set(s.day, n);
  let id = s.id || `${slug(s.name)}-${slug(s.day)}`;
  for (let n = 2; seen.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
  seen.add(id);
  return {
    id,
    cat: `${code}-${String(i + 1).padStart(3, "0")}`,
    pos: String.fromCharCode(65 + Math.max(0, d)) + n,
    name: s.name,
    qualifier: s.qualifier ?? null,
    billing: s.billing ?? s.name,
    day: s.day,
    stage: s.stage,
    start: s.start,
    end: s.end,
    blurb: s.blurb ?? "",
    tags: s.tags ?? [],
    ...(Array.isArray(s.artists) ? { artists: s.artists } : {}),
  };
});
if (!sets.length) problems.push("sets is empty");

if (problems.length) {
  console.error("lineup.json needs fixing:\n  " + problems.join("\n  "));
  process.exit(1);
}
writeFileSync(output, JSON.stringify({ festival, stages, walk, sets }, null, 1) + "\n");
console.log(`${festival.name} ${festival.year}: ${sets.length} sets on ${stages.length} stages over ${days.length} days → ${output}`);
