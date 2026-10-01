#!/usr/bin/env node
// Finds 30-second previews for each act's top tracks on Spotify's public embed pages.
// Reads out/taste.json and writes out/previews.json, keeping previews found on earlier runs.
// Spotify rate-limits fast requests, so this goes one at a time and waits when told to;
// rerun it to pick up tracks that were still limited.
//
//   node fetch-previews.mjs <work>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
if (!work) {
  console.error("usage: node fetch-previews.mjs <work>");
  process.exit(1);
}
const file = join(work, "out", "previews.json");
const taste = JSON.parse(readFileSync(join(work, "out", "taste.json"), "utf8"));
const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const previews = {};
let found = 0, missing = 0;
const jobs = Object.entries(taste.matches).flatMap(([key, m]) => (m.tracks ?? []).map((t) => ({ key, ...t })));
for (const [i, job] of jobs.entries()) {
  const known = (before[job.key] ?? []).find((p) => p.n === job.n);
  if (known) { (previews[job.key] ||= []).push(known); found++; continue; }
  let url = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://open.spotify.com/embed/track/${job.id}`, { headers: { "user-agent": UA } }).catch(() => null);
    if (res?.status === 429) { await sleep(Number(res.headers.get("retry-after")) * 1000 || 15000 * (attempt + 1)); continue; }
    url = res?.ok ? (await res.text()).match(/"audioPreview":\{"url":"([^"]+)"/)?.[1] ?? null : null;
    break;
  }
  if (url) { (previews[job.key] ||= []).push({ n: job.n, url }); found++; } else missing++;
  if (process.stdout.isTTY) process.stdout.write(`\r${i + 1}/${jobs.length}`);
  await sleep(350);
}
writeFileSync(file, JSON.stringify(previews, null, 1) + "\n");
console.log(`\r${found} of ${jobs.length} tracks have previews, across ${Object.keys(previews).length} acts → out/previews.json`);
if (missing) console.log(`${missing} had no preview or were still rate-limited; rerunning later keeps what's found and retries the rest`);
