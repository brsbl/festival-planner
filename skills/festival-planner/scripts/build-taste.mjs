#!/usr/bin/env node
// Scores every act against your Spotify likes and listening, and writes <work>/out/taste.json.
//
//   node build-taste.mjs <work> --profile           print what your library says, to write lanes.json from
//   node build-taste.mjs <work> --name "<first name>"
//
// Inputs: spotify/artists.json, spotify/liked.json and spotify/top.json (if read), lanes.json, and the
// installed festival's lineup (--festival <slug> when more than one is installed), or --lineup <file>.
// Score (0–98, tapering above 70) = direct (the stronger of: songs you've liked by the act, recent likes counting extra;
//                         or how high the act is in your top artists and top tracks)
//               + neighbour (how many of Spotify's "fans also like" artists you like or play)
//               + lane (0–40, your judgment of how well the act fits the lanes the library shows).
//
// lanes.json, keyed by act name (any case):
//   { "robyn": { "lane": 30, "why": "…", "pin": true }, "despacio": { "lane": 15, "cap": 55 }, … }
//   lane   0–40, required for every act
//   why    a note to yourself on the call; the planner doesn't show it
//   tier   "wild" to flag a stretch pick
//   pin    true for acts the person said they won't miss: they start marked "go"
//   cap    upper bound on the score
//   "*"    an entry under this key applies to every act you don't list, e.g. { "*": { "lane": 6 } }
//   credit extra artist names that count as liking this act (members, aliases)
//   told   how many of the act's songs the person says they like that aren't in these likes
//   skip   Spotify search queries whose match is the wrong artist
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLineup, trustedHit } from "./lib.mjs";

const args = process.argv.slice(2);
const work = args[0];
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!work) {
  console.error('usage: node build-taste.mjs <work> [--profile | --name "<name>"]');
  process.exit(1);
}
const read = (...p) => JSON.parse(readFileSync(join(work, ...p), "utf8"));
const lineup = loadLineup(flag("--lineup"), flag("--festival"));
const liked = (existsSync(join(work, "spotify", "liked.json")) ? read("spotify", "liked.json") : []).map((t, i) => ({ ...t, i }));
const harvest = read("spotify", "artists.json");
let lanes = {};
try { lanes = Object.fromEntries(Object.entries(read("lanes.json")).map(([k, v]) => [k.toLowerCase(), v])); } catch {}

const low = (s) => String(s ?? "").toLowerCase();
// a playlist's order is its curator's, not when you liked things, so only liked songs count as recent
let fromPlaylists = false;
try { fromPlaylists = read("spotify", "source.json").kind === "playlists"; } catch {}
const RECENT = fromPlaylists ? 0 : Math.min(300, Math.ceil(liked.length / 4));
const RELATED = 8; // the "fans also like" row Spotify shows on an artist page
const count = new Map(), recent = new Map();
for (const t of liked) for (const a of t.artists) {
  count.set(low(a), (count.get(low(a)) || 0) + 1);
  if (t.i < RECENT) recent.set(low(a), (recent.get(low(a)) || 0) + 1);
}
const nameOf = new Map(liked.flatMap((t) => t.artists).map((a) => [low(a), a]));

// listening: top artists by range (rank 0 is first) and how many top tracks credit each artist
const RANGES = [["month", "this month", 1], ["sixMonths", "past six months", 0.95], ["allTime", "all time", 0.9]];
let top = null;
try { top = read("spotify", "top.json"); } catch {}
const topRank = new Map(RANGES.map(([r]) => [r, new Map((top?.[r]?.artists ?? []).map((a, i) => [low(a.name), i]))]));
const topTracks = new Map();
for (const [r] of RANGES) for (const t of top?.[r]?.tracks ?? []) for (const a of t.artists) {
  const names = topTracks.get(low(a)) ?? new Set();
  topTracks.set(low(a), names.add(t.name));
}
const played = new Set(RANGES.flatMap(([r]) => [...topRank.get(r).keys()]));
for (const [r] of RANGES) for (const a of top?.[r]?.artists ?? []) if (!nameOf.has(low(a.name))) nameOf.set(low(a.name), a.name);
const ambient = new Set(lineup.stages.filter((s) => s.ambient).map((s) => s.id));
const acts = [...new Map(lineup.sets.map((s) => [low(s.name), s])).values()];

function signals(set) {
  const key = low(set.name), lane = { ...(lanes["*"] ?? {}), ...(lanes[key] ?? {}) };
  const skip = new Set((lane.skip ?? []).map(low));
  const all = (harvest[set.name] ?? []).filter((h) => h.id && !skip.has(low(h.q)));
  const hits = all.filter(trustedHit);
  const guesses = all.filter((h) => !trustedHit(h));
  const credit = new Set([key, ...hits.map((h) => low(h.name)), ...(lane.credit ?? []).map(low)]);
  const mine = liked.filter((t) => t.artists.some((a) => credit.has(low(a))));
  // best placing in any range's top artists (1 = first this month), and distinct top tracks by the act
  let heard = 0;
  const ranks = [];
  for (const [r, label, weight] of RANGES) {
    const best = Math.min(...[...credit].map((c) => topRank.get(r).get(c) ?? Infinity));
    if (best === Infinity) continue;
    ranks.push(`#${best + 1} ${label}`);
    heard = Math.max(heard, weight * (1 - best / 50));
  }
  const tracksPlayed = [...new Set([...credit].flatMap((c) => [...(topTracks.get(c) ?? [])]))];
  let neighbour = 0, near = [];
  for (const h of hits) {
    const found = (h.related ?? []).slice(0, RELATED).filter((n) => count.get(low(n)) || played.has(low(n))).map((n) => [n, (count.get(low(n)) || 0) + (played.has(low(n)) ? 3 : 0)]);
    const v = found.reduce((sum, [, c]) => sum + Math.min(1, Math.log2(1 + c) / 3.5), 0) * 12;
    if (v > neighbour) { neighbour = v; near = found; }
  }
  return { key, lane, hits, guesses, mine, heard, ranks, tracksPlayed, neighbour: Math.min(24, neighbour), near };
}

const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));

if (args.includes("--profile")) {
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a, c]) => `${nameOf.get(a)} (${c})`).join(", ");
  console.log(`${liked.length} liked songs, ${count.size} artists.\n`);
  console.log(`most liked: ${top(count, 40)}\n`);
  if (RECENT) console.log(`lately (newest ${RECENT}): ${top(recent, 25)}\n`);
  for (const [r, label] of RANGES) if (topRank.get(r).size) console.log(`top artists ${label}: ${[...topRank.get(r).keys()].slice(0, 25).map((a) => nameOf.get(a) ?? a).join(", ")}\n`);
  console.log("act | your likes | top artists and tracks | fans-also-like you like or play | spotify match (listeners) | lane");
  for (const set of acts) {
    const s = signals(set);
    const match = [...s.hits.map((h) => `${h.name}${h.exact ? "" : ` [searched "${h.q}"]`} (${h.listeners ? fmtN(h.listeners) : "?"})`), ...s.guesses.map((h) => `IGNORED "${h.q}" → ${h.name}`)].join(" + ") || "not found";
    const near = s.near.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} ${c}`).join(", ");
    const playing = [s.ranks.join(", "), s.tracksPlayed.length ? `${s.tracksPlayed.length} top tracks` : ""].filter(Boolean).join("; ");
    console.log(`${set.name} | ${s.mine.length} | ${playing || "-"} | ${near || "-"} | ${match} | ${s.lane.lane ?? "MISSING"}`);
  }
  process.exit(0);
}

const missing = lanes["*"]?.lane !== undefined ? [] : acts.filter((s) => lanes[low(s.name)]?.lane === undefined).map((s) => s.name);
if (missing.length) console.warn(`no lane for ${missing.length} acts (scored as lane 0): ${missing.join(", ")}`);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const matches = {};
for (const set of acts) {
  const { key, lane, hits, mine, heard, ranks, tracksPlayed, neighbour, near } = signals(set);
  const primary = hits[0];
  const n = mine.length || lane.told || 0;
  const fromLikes = n ? 28 + 7 * (Math.min(n, 4) - 1) + (mine[0]?.i < RECENT ? 8 : 0) : 0;
  const fromPlays = heard || tracksPlayed.length ? (heard ? 26 + 20 * heard : 26) + 3 * Math.min(tracksPlayed.length, 3) : 0;
  // the stronger signal counts in full and the other adds a little, so liking and playing beats either alone
  const direct = Math.max(fromLikes, fromPlays) + 0.25 * Math.min(fromLikes, fromPlays);
  const known = n > 0 || fromPlays > 0;
  // above 70 the score tapers instead of hitting a cap, so favourites stay in order rather than tying
  const raw = direct + neighbour + (lane.lane ?? 0);
  let score = Math.round(clamp(raw <= 70 ? raw : 70 + 28 * (1 - Math.exp(-(raw - 70) / 35)), 3, 98));
  if (lane.cap !== undefined) score = Math.min(score, lane.cap);
  else if (ambient.has(set.stage)) score = Math.min(score, 55);
  const tier = known && score >= 45 ? "heavy" : known ? "deep" : lane.tier === "wild" ? "wild" : score >= 40 ? "deep" : null;

  const evidence = [];
  if (ranks.length) evidence.push(`▶ in your top artists: ${esc(ranks.join(", "))}`);
  if (tracksPlayed.length) evidence.push(`▶ <em>${esc(low(tracksPlayed[0]))}</em> is in your top tracks${tracksPlayed.length > 1 ? ` <small>+ ${tracksPlayed.length - 1} more</small>` : ""}`);
  for (const t of mine.slice(0, 3)) evidence.push(`♥ <em>${esc(low(t.name))}</em> — ${esc(low(t.artists.join(", ")))}${t.i < RECENT ? " <small>· liked recently</small>" : ""}`);
  if (!mine.length && lane.told) evidence.push("♥ in your likes, just not on this spotify account");
  if (mine.length > 3) evidence.push(`+ ${mine.length - 3} more in your liked songs`);
  if (near.length) evidence.push(`fans also like ${near.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => `<b>${esc(low(name))}</b>${count.get(low(name)) ? ` (${count.get(low(name))} saved)` : " (you play them)"}`).join(", ")}`);
  if (primary?.listeners) evidence.push(`${fmtN(primary.listeners)} monthly listeners on spotify`);

  const riyl = [...(primary?.related ?? [])].sort((a, b) => (count.get(low(b)) || 0) - (count.get(low(a)) || 0)).slice(0, 3);
  matches[key] = {
    score, tier, known,
    ...(lane.pin ? { pinned: true } : {}),
    evidence,
    riyl,
    topTrack: primary?.top?.[0]?.n ? low(primary.top[0].n) : null,
    tracks: (primary?.top ?? []).slice(0, 3),
    url: primary?.url ?? null,
    img: primary?.img ?? null,
  };
}

const taste = { user: { name: flag("--name") ?? "" }, matches };
mkdirSync(join(work, "out"), { recursive: true });
writeFileSync(join(work, "out", "taste.json"), JSON.stringify(taste, null, 1) + "\n");
const ranked = Object.entries(matches).sort((a, b) => b[1].score - a[1].score);
for (const [k, m] of ranked) console.log(String(m.score).padStart(3), (m.tier ?? "-").padEnd(6), k);
console.log(`→ out/taste.json (${ranked.length} acts)`);
