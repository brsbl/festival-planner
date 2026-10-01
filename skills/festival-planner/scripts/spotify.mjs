#!/usr/bin/env node
// Reads Spotify through a bb browser-automation session.
// Writes <work>/spotify/liked.json (your songs, newest first), <work>/spotify/top.json (your top
// artists and tracks over the last month, six months, and all time; signed in only), and
// <work>/spotify/artists.json (each act's Spotify profile, top tracks and "fans also like").
//
//   node spotify.mjs <work> --session <id> [--page <name>] [--only liked|top|artists]
//                    [--playlist <url> …] [--festival <slug> | --lineup <file>]
//
// Liked songs need the page to be signed in to Spotify. Without a sign-in, pass one or more
// public playlists with --playlist instead; artist lookups work signed out too.
// The lineup is the installed festival's (--festival <slug> when more than one is installed),
// or a lineup file with --lineup.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLineup } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const work = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const lineupFile = flag("--lineup");
const session = flag("--session");
const page = flag("--page") ?? "main";
const only = flag("--only");
const playlists = args.flatMap((a, i) => (a === "--playlist" ? [args[i + 1]] : [])).map((url) => /playlist[/:]([A-Za-z0-9]+)/.exec(url ?? "")?.[1]);
if (playlists.some((id) => !id)) {
  console.error("--playlist needs a Spotify playlist link like https://open.spotify.com/playlist/37i9dQZF1DX…");
  process.exit(1);
}
if (!work || !session) {
  console.error("usage: node spotify.mjs <work> --session <id> [--page <name>] [--only liked|top|artists]");
  process.exit(1);
}
const out = join(work, "spotify");
mkdirSync(out, { recursive: true });

// bb can be briefly unreachable; a call that never reached it is safe to repeat
// bb's browser panel otherwise gets Spotify's mobile player, which lacks the profile's top lists
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
function run(body, timeout = "120s") {
  const script = `const p = await browser.getPage(${JSON.stringify(page)});\ntry { await p.setUserAgent(${JSON.stringify(DESKTOP)}); } catch {}\n${body}`;
  let raw;
  for (let attempt = 1; ; attempt++) {
    try {
      raw = execFileSync("bb", ["browser-automation", "run", session, "--script", script, "--timeout", timeout, "--json"], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
      break;
    } catch (error) {
      const out = String(error.stdout ?? "") + String(error.stderr ?? "");
      if (attempt < 5 && /server_unreachable|did not respond/.test(out)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000 * attempt); continue; }
      throw error;
    }
  }
  const result = JSON.parse(raw);
  if (result.ok === false) throw new Error(result.error?.message ?? raw);
  try { return JSON.parse(result.text); } catch { return result.text; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(field) {
  for (let i = 0; i < 120; i++) {
    const state = run(`return await p.evaluate(() => { const F = window.__fp || {}; return { done: F.${field}Done, error: F.${field}Error, n: F.${field} ? Object.keys(F.${field}).length : 0 }; });`, "30s");
    if (state.error) throw new Error(state.error);
    if (state.done) return state.n;
    if (process.stdout.isTTY) process.stdout.write(`\r${field}: ${state.n}…`);
    await sleep(3000);
  }
  throw new Error(`${field} didn't finish in 6 minutes`);
}

function pageOut(expr, size) {
  const rows = [];
  for (let i = 0; ; i += size) {
    const chunk = run(`return await p.evaluate((i) => JSON.stringify(${expr}.slice(i, i + ${size})), ${i});`, "30s");
    const part = typeof chunk === "string" ? JSON.parse(chunk) : chunk;
    rows.push(...part);
    if (part.length < size) return rows;
  }
}

// 1. Load the web player, note the API headers and the current query names it uses.
const setup = run(`
const PLAYLIST = ${JSON.stringify(playlists[0] ?? null)};
const ops = {}; let cap = null; let search = null; let overview = null; let likedQuery = null; let playlistQuery = null;
const sniff = (req) => {
  if (!req.url().includes("api-partner.spotify.com/pathfinder")) return;
  const hd = req.headers();
  if (hd.authorization) cap = { auth: hd.authorization, ctok: hd["client-token"], app: hd["app-platform"], ver: hd["spotify-app-version"] };
  try {
    const b = JSON.parse(req.postData() || "null");
    if (b?.operationName && b.extensions?.persistedQuery) {
      ops[b.operationName] = b.extensions.persistedQuery.sha256Hash;
      const vars = JSON.stringify(b.variables || {});
      if (/LikedSongs|LibraryTracks/.test(b.operationName) && !likedQuery) likedQuery = { op: b.operationName, vars: b.variables || {} };
      if (PLAYLIST && vars.includes(PLAYLIST) && !playlistQuery) playlistQuery = { op: b.operationName, vars: b.variables };
      // signed in, the player drops the query from the search URL, so recognise these by name and fill in the query later
      const isSearch = /^(searchDesktop|findTopResults|searchTopResultsList|searchAll)$/.test(b.operationName);
      if (isSearch && (!search || (b.operationName === "searchDesktop" && search.op !== "searchDesktop"))) search = { op: b.operationName, vars: b.variables || {} };
      if (/ArtistOverview/.test(b.operationName) && !overview) overview = { op: b.operationName, vars: b.variables || {} };
    }
  } catch {}
};
p.on("request", sniff);
await p.goto(PLAYLIST ? "https://open.spotify.com/playlist/" + PLAYLIST : "https://open.spotify.com/collection/tracks", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 7000));
const signedIn = Boolean(likedQuery) || await p.evaluate(() => !document.querySelector('[data-testid="login-button"]'));
await p.goto("https://open.spotify.com/search/" + encodeURIComponent("daft punk"), { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 6000));
await p.goto("https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 6000));
p.off("request", sniff);
await p.evaluate((F) => { window.__fp = F; }, { cap, ops, search, overview, likedQuery, playlistQuery, signedIn });
return { signedIn, auth: !!cap, liked: likedQuery?.op ?? null, playlist: playlistQuery?.op ?? null, search: search?.op ?? null, overview: overview?.op ?? null };
`);
console.log("spotify:", JSON.stringify(setup));
if (!setup.auth) throw new Error("the page never called Spotify's API; is open.spotify.com loading in this session?");

// 2. Your songs, newest first: liked songs when signed in, otherwise the playlists you passed.
if (only === undefined || only === "liked") {
  if (!playlists.length && !setup.signedIn) throw new Error("this page isn't signed in to Spotify. Sign in to open.spotify.com in the browser (or import cookies with `bb browser import-cookies`), or pass public playlists with --playlist");
  if (playlists.length && !setup.playlist) throw new Error("couldn't see how the web player loads a playlist; check the link opens in the browser");
  run(`await p.evaluate((playlists) => {
    const F = window.__fp; F.liked = []; F.likedDone = false; F.likedError = null;
    const query = async (spec, hash, variables) => {
      const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", { method: "POST", headers: { "content-type": "application/json;charset=UTF-8", authorization: F.cap.auth, "client-token": F.cap.ctok, "app-platform": F.cap.app || "WebPlayer", "spotify-app-version": F.cap.ver || "" }, body: JSON.stringify({ variables, operationName: spec, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }) });
      if (!res.ok) throw new Error(spec + " returned " + res.status);
      return res.json();
    };
    const listOf = (j) => { let hit = null; const walk = (o) => { if (hit || !o || typeof o !== "object") return; if (Array.isArray(o.items) && o.items.some((x) => x?.track || x?.itemV2)) { hit = o; return; } for (const k in o) walk(o[k]); }; walk(j); return hit; };
    const seen = new Set();
    const take = (x) => {
      const d = x.track?.data || x.track || x.itemV2?.data;
      if (!d?.name || d.__typename === "Episode") return;
      const artists = d.artists?.items ?? [];
      const row = { name: d.name, artists: artists.map((a) => a.profile?.name), ids: artists.map((a) => a.uri?.split(":")[2]), album: d.albumOfTrack?.name ?? "" };
      const key = row.name + "|" + row.artists.join("|");
      if (!seen.has(key)) { seen.add(key); F.liked.push(row); }
    };
    const pages = async (spec, hash, base, size) => {
      for (let offset = 0; ; offset += size) {
        const page = listOf(await query(spec, hash, { ...base, offset, limit: size }));
        const items = page?.items ?? [];
        items.forEach(take);
        if (items.length < size || (page.totalCount && offset + size >= page.totalCount)) break;
      }
    };
    (async () => {
      if (playlists.length) {
        const spec = F.playlistQuery;
        const sample = JSON.stringify(spec.vars);
        const first = sample.match(/playlist:([A-Za-z0-9]+)/)?.[1];
        for (const id of playlists) await pages(spec.op, F.ops[spec.op], JSON.parse(sample.split(first).join(id)), 100);
      } else {
        const op = F.likedQuery?.op || "getLikedSongs";
        await pages(op, F.ops[op] || "c2c53c28f71da143c0753c22dc84d98b315cb4275472ea5a597c29338ae20b23", F.likedQuery?.vars || {}, 50);
      }
    })().then(() => { F.likedDone = true; }, (e) => { F.likedError = String(e); });
  }, ${JSON.stringify(playlists)}); return "started";`);
  await waitFor("liked");
  const liked = pageOut("window.__fp.liked", 150);
  writeFileSync(join(out, "liked.json"), JSON.stringify(liked));
  writeFileSync(join(out, "source.json"), JSON.stringify({ kind: playlists.length ? "playlists" : "liked", playlists }));
  console.log(`\r${playlists.length ? "playlist songs" : "liked songs"}: ${liked.length}       `);
}

// 3. What you actually play: top artists and tracks for each time range, read with the web player's
// own profile query. Its query id ships in the profile page's script, so find it there.
if (!playlists.length && setup.signedIn && (only === undefined || only === "top")) {
  run(`await p.evaluate(() => {
    const F = window.__fp; F.top = null; F.topDone = false; F.topError = null;
    const grab = (t) => (t.match(/"userTopContent","query","([0-9a-f]{64})"/) || [])[1];
    const findHash = async () => {
      if (F.ops.userTopContent) return F.ops.userTopContent;
      const srcs = [...new Set([...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.scripts].map((x) => x.src)])].filter((x) => /spotifycdn\\.com.*\\.js/.test(x));
      let main = null;
      for (const src of srcs) {
        let t; try { t = await (await fetch(src)).text(); } catch { continue; }
        const h = grab(t); if (h) return h;
        if (t.includes('"xpui-routes-profile"')) main = { src, t };
      }
      if (!main) return null;
      const id = (main.t.match(/(\\d+):"xpui-routes-profile"/) || [])[1];
      for (const m of main.t.matchAll(new RegExp("[,{]" + id + ':"([0-9a-f]{8})"', "g"))) {
        try { const h = grab(await (await fetch(main.src.replace(/[^/]+$/, "xpui-routes-profile." + m[1] + ".js"))).text()); if (h) return h; } catch {}
      }
      return null;
    };
    (async () => {
      const hash = await findHash();
      if (!hash) throw new Error("couldn't find the web player's top-content query");
      const top = {};
      for (const [range, value] of [["month", "SHORT_TERM"], ["sixMonths", "MID_TERM"], ["allTime", "LONG_TERM"]]) {
        const input = { offset: 0, limit: 50, sortBy: "AFFINITY", timeRange: value };
        const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", { method: "POST", headers: { "content-type": "application/json;charset=UTF-8", authorization: F.cap.auth, "client-token": F.cap.ctok, "app-platform": F.cap.app || "WebPlayer", "spotify-app-version": F.cap.ver || "" }, body: JSON.stringify({ variables: { includeTopArtists: true, topArtistsInput: input, includeTopTracks: true, topTracksInput: input }, operationName: "userTopContent", extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }) });
        if (!res.ok) throw new Error("top " + range + " returned " + res.status);
        const me = (await res.json()).data?.me?.profile ?? {};
        top[range] = {
          artists: (me.topArtists?.items ?? []).map((x) => ({ name: x.data?.profile?.name, id: x.data?.uri?.split(":")[2] })).filter((x) => x.name),
          tracks: (me.topTracks?.items ?? []).map((x) => ({ name: x.data?.name, artists: (x.data?.artists?.items ?? []).map((a) => a.profile?.name) })).filter((x) => x.name),
        };
      }
      F.top = top;
    })().then(() => { F.topDone = true; }, (e) => { F.topError = String(e); });
  }); return "started";`);
  await waitFor("top");
  const top = {};
  for (const range of ["month", "sixMonths", "allTime"]) {
    const part = run(`return await p.evaluate((r) => JSON.stringify(window.__fp.top[r]), ${JSON.stringify(range)});`, "30s");
    top[range] = typeof part === "string" ? JSON.parse(part) : part;
  }
  writeFileSync(join(out, "top.json"), JSON.stringify(top, null, 1));
  console.log(`\rtop artists: ${["month", "sixMonths", "allTime"].map((r) => `${r} ${top[r].artists.length}`).join(", ")}; top tracks: ${["month", "sixMonths", "allTime"].map((r) => top[r].tracks.length).join("/")}`);
}

// 4. Each act: search, then read its artist page.
if (only === undefined || only === "artists") {
  const lineup = loadLineup(lineupFile, flag("--festival"));
  // an act playing twice may list different artists each time; look all of them up. artists: [] means don't look it up
  const queries = new Map();
  for (const s of lineup.sets) queries.set(s.name, [...new Set([...(queries.get(s.name) ?? []), ...(Array.isArray(s.artists) ? s.artists : [s.name])])]);
  const acts = [...queries.entries()].filter(([, q]) => q.length);
  if (!setup.search) throw new Error("couldn't see how the web player searches; check open.spotify.com loads in the page and rerun");
  run(`await p.evaluate((acts) => {
    const F = window.__fp; F.artists = {}; F.artistsDone = false; F.artistsError = null;
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const query = async (spec, set) => {
      const variables = { ...spec.vars, ...set(spec.vars) };
      const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", { method: "POST", headers: { "content-type": "application/json;charset=UTF-8", authorization: F.cap.auth, "client-token": F.cap.ctok, "app-platform": F.cap.app || "WebPlayer", "spotify-app-version": F.cap.ver || "" }, body: JSON.stringify({ variables, operationName: spec.op, extensions: { persistedQuery: { version: 1, sha256Hash: F.ops[spec.op] } } }) });
      if (!res.ok) throw new Error(spec.op + " returned " + res.status);
      return res.json();
    };
    // under load Spotify sometimes answers a search with nothing, so an empty answer is retried
    const search = async (q) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const found = []; const walk = (o) => { if (!o || typeof o !== "object") return; if (o.__typename === "Artist" && o.profile?.name && o.uri) found.push(o); for (const k in o) walk(o[k]); };
        try { walk(await query(F.search, (v) => ("searchTerm" in v ? { searchTerm: q } : { query: q }))); } catch (e) { if (attempt === 3) throw e; }
        const uniq = [...new Map(found.map((a) => [a.uri, a])).values()];
        if (uniq.length) return uniq.find((a) => norm(a.profile.name) === norm(q)) || uniq[0];
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
      return null;
    };
    // the desktop player asks for an artist's overview; the mobile one (which bb's browser panel gets)
    // embeds the same data in the page as base64 initialState
    const fromPage = async (id) => {
      const html = await (await fetch("/artist/" + id)).text();
      const m = html.match(/<script id="initialState" type="text\\/plain">([^<]+)<\\/script>/);
      if (!m) return null;
      const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))));
      return state.entities?.items?.["spotify:artist:" + id] ?? null;
    };
    const profile = async (id) => {
      const a = F.overview ? (await query(F.overview, () => ({ uri: "spotify:artist:" + id }))).data?.artistUnion : await fromPage(id);
      if (!a) return {};
      const img = (a.visuals?.avatarImage?.sources || []).slice().sort((x, y) => Math.abs((x.width || 640) - 320) - Math.abs((y.width || 640) - 320))[0]?.url ?? null;
      return {
        listeners: a.stats?.monthlyListeners ?? null,
        img,
        top: (a.discography?.topTracks?.items || []).slice(0, 5).map((t) => ({ n: t.track?.name, id: t.track?.uri?.split(":")[2] })).filter((t) => t.n && t.id),
        related: [...new Set((a.relatedContent?.relatedArtists?.items || []).map((r) => r.profile?.name).filter(Boolean))],
      };
    };
    const one = async ([act, queries]) => {
      const hits = [];
      for (const q of queries) {
        try {
          const pick = await search(q);
          if (!pick) { hits.push({ q, id: null }); continue; }
          const id = pick.uri.split(":")[2];
          hits.push({ q, id, name: pick.profile.name, exact: norm(pick.profile.name) === norm(q), url: "https://open.spotify.com/artist/" + id, ...(await profile(id)) });
        } catch (e) { hits.push({ q, id: null, error: String(e) }); }
      }
      F.artists[act] = hits;
    };
    (async () => { for (let i = 0; i < acts.length; i += 4) await Promise.all(acts.slice(i, i + 4).map(one)); })()
      .then(() => { F.artistsDone = true; }, (e) => { F.artistsError = String(e); });
  }, ${JSON.stringify(acts)}); return "started";`);
  await waitFor("artists");
  const artists = Object.fromEntries(pageOut("Object.entries(window.__fp.artists)", 8));
  writeFileSync(join(out, "artists.json"), JSON.stringify(artists, null, 1));
  const misses = Object.entries(artists).filter(([, hits]) => !hits.some((h) => h.id)).map(([act]) => act);
  const loose = Object.entries(artists).flatMap(([act, hits]) => hits.filter((h) => h.id && (!h.exact || (h.listeners ?? 0) < 1000)).map((h) =>
    h.exact ? `${act}: "${h.name}" has only ${h.listeners ?? 0} monthly listeners; a small local act, or a namesake` : `${act}: searched "${h.q}", got "${h.name}"`));
  console.log(`\rartists: ${Object.keys(artists).length}       `);
  if (misses.length) console.log("not found on spotify:", misses.join(", "));
  if (loose.length) console.log("check these matches. Different names are ignored unless only a typo apart; if one is right, put its Spotify name in the act's \"artists\" in the lineup. A same-name artist that's wrong goes in \"skip\" in lanes.json:\n  " + loose.join("\n  "));
}
