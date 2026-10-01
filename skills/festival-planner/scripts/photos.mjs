#!/usr/bin/env node
// Writes festivals/<slug>/artists.json, each act's Spotify photo and link, from a Spotify artist
// lookup (`spotify.mjs <work> --only artists`, which works signed out). These are facts about the
// festival, so the page shows them before anyone connects Spotify.
//
//   node photos.mjs <work> festivals/<slug> [--skip "<act>"…]     skip acts whose match is wrong
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { trustedHit } from "./lib.mjs";

const args = process.argv.slice(2);
const [work, folder] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--skip");
if (!work || !folder) {
  console.error('usage: node photos.mjs <work> festivals/<slug> [--skip "<act>"…]');
  process.exit(1);
}
const skip = new Set(args.flatMap((a, i) => (a === "--skip" ? [args[i + 1].toLowerCase()] : [])));
const harvest = JSON.parse(readFileSync(join(work, "spotify", "artists.json"), "utf8"));
const artists = {};
for (const [act, hits] of Object.entries(harvest)) {
  if (skip.has(act.toLowerCase())) continue;
  const hit = hits.find((h) => h.id && h.exact) ?? hits.find(trustedHit);
  if (hit) artists[act.toLowerCase()] = { img: hit.img ?? null, url: hit.url ?? null };
}
writeFileSync(join(folder, "artists.json"), JSON.stringify(artists, null, 1) + "\n");
console.log(`${Object.keys(artists).length} of ${Object.keys(harvest).length} acts have a photo or link → ${join(folder, "artists.json")}`);
