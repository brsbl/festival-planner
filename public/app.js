(() => {
"use strict";

const L = window.LINEUP;
const T = window.TASTE;
const F = L.festival;
const merge = (base, over) => {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = base && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  return out;
};
const TH = merge(window.THEME_DEFAULTS || {}, window.THEME || {});
const C = TH.copy || {};
const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const PV = window.PREVIEWS || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- state ---------------- */
// saved per festival, so switching festivals starts clean
const PREFIX = "fp." + (F.code || F.name + F.year) + ".";
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(PREFIX + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {} },
};
const state = {
  day: store.get("day", null),
  view: store.get("view", "list"),
  filter: "all",
  sort: "match",
  open: null,
  marks: store.get("marks", {}), // setId -> "go" | "maybe" | "skip"
  order: store.get("order", {}), // setId -> sort key among the acts it overlaps (default: its start)
  theme: store.get("theme", "day"),
  slot: null,
};

/* ---------------- time ---------------- */
const fmt = (m) => { const h = Math.floor(m / 60), mm = m % 60, h12 = ((h + 11) % 12) + 1; return h12 + ":" + String(mm).padStart(2, "0"); };
const fmtAP = (m) => fmt(m) + (Math.floor(m / 60) % 24 >= 12 ? "pm" : "am");
const hm = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const DAY = Object.fromEntries(F.days.map((d) => [d.id, d]));
// a day's hours: its own doors/close if it has them, else the festival's; a close before doors is after midnight
const hours = (id) => {
  const d = DAY[id] || {}, doors = hm(d.doors || F.doors), raw = hm(d.close || F.close);
  return { doors, close: raw + (raw <= doors ? 1440 : 0), t0: Math.floor(doors / 60) * 60 };
};
const dur = (m) => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + "m");

function festNow() {
  const q = new URLSearchParams(location.search).get("now"); // e.g. ?now=2026-09-26T19:30 to preview a festival day
  let date, min;
  if (q) { const [d, t = "00:00"] = q.split("T"); date = d; const [h, m] = t.split(":").map(Number); min = h * 60 + m; }
  else {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: F.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    date = `${p.year}-${p.month}-${p.day}`; min = +p.hour * 60 + +p.minute;
  }
  // before the previous day's after-midnight close, it's still that day
  const i = F.days.findIndex((d) => d.date === date);
  const prev = F.days.find((d) => d.date === new Date(Date.parse(date + "T12:00:00Z") - 864e5).toISOString().slice(0, 10));
  if (prev && hours(prev.id).close > 1440 && min + 1440 <= hours(prev.id).close + 15) return { day: prev.id, min: min + 1440, date };
  return { day: i >= 0 ? F.days[i].id : null, min, date };
}

/* ---------------- taste lookups ---------------- */
const STAGE = Object.fromEntries(L.stages.map((s) => [s.id, s]));
const key = (name) => name.toLowerCase();
const match = (set) => (T && T.matches[key(set.name)]) || { score: 0, tier: null, evidence: [], riyl: [] };
const score = (set) => match(set).score || 0;
const TIER = Object.fromEntries(["heavy", "deep", "wild", "new"].map((k) => { const t = (C.tiers || {})[k] || {}; return [k, [t.stamp || k.toUpperCase(), t.hint || "", t.filter || k]]; }));
const tierOf = (set) => match(set).tier || "new";
const markOf = (set) => { const mk = state.marks[set.id]; return mk === "off" ? undefined : mk || (match(set).pinned ? "go" : undefined); };

/* walk minutes between stages: estimated from the venue map, crowd not included */
const WALK = L.walk || {};
const walk = (a, b) => (a === b ? 0 : WALK[a + "|" + b] ?? WALK[b + "|" + a] ?? 4);

/* ---------------- planner ----------------
   5-minute slots, Viterbi over "which set am I at". A set's worth per slot is its match score
   (curved so favourites dominate); switching stages costs the slots you spend walking plus a
   small commitment penalty. Marks override: go = must, skip = never. */
const SLOT = 5, ROAM = "roam", ROAM_V = 0.055, SWITCH = 0.22;
function worth(set) {
  const mk = markOf(set);
  if (mk === "skip") return -1;
  let v = Math.pow(score(set) / 100, 1.7);
  // an all-day room is where you go between sets, not instead of them: only beats wandering
  if (STAGE[set.stage].ambient) v = Math.min(v, 0.06);
  if (mk === "maybe") v += 0.18;
  return v;
}
/* your "go" acts always make the list. where they overlap you see them in the order you've put them
   (earliest start first until you swap), switching halfway through the time each pair shares.
   the planner only fills the time none of them are on. */
const rank = (g) => state.order[g.id] ?? g.set.start;
function turns(run) {
  if (run.length < 2) return run;
  let t = -Infinity;
  const out = run.map((g, k) => {
    const a = g.set, b = run[k + 1]?.set, from = Math.max(t, a.start);
    let to = a.end;
    if (b) { const lo = Math.max(from, b.start), hi = Math.min(a.end, b.end); if (hi > lo) to = Math.round((lo + hi) / 2 / SLOT) * SLOT; }
    t = Math.max(from, to);
    return { ...g, from, to: t };
  });
  // anything still on before the first pick or after the last one: you're there
  const first = run.reduce((a, b) => (b.set.start < a.set.start ? b : a)), last = run.reduce((a, b) => (b.set.end > a.set.end ? b : a));
  if (out[0].from - first.set.start >= 10) out.unshift({ ...first, from: first.set.start, to: out[0].from, back: true });
  if (last.set.end - t >= 10) out.push({ ...last, from: t, to: last.set.end, back: true });
  return out;
}
function plan(day) {
  const sets = L.sets.filter((s) => s.day === day);
  const goes = sets.filter((s) => markOf(s) === "go");
  const taken = (t) => goes.some((s) => s.start <= t && t < s.end);
  const fill = planWith(sets.filter((s) => markOf(s) !== "go"), taken);
  const stops = [...fill, ...goes.map((s) => ({ id: s.id, from: s.start, to: s.end, set: s }))].sort((a, b) => a.from - b.from || a.to - b.to);
  const timed = [];
  let end = -Infinity, run = [];
  const flush = () => { timed.push(...turns(run.map((g, i) => [rank(g), i, g]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]))); run = []; };
  for (const g of stops) {
    if (g.from >= end) flush();
    run.push(g);
    end = Math.max(end, g.to);
  }
  flush();
  const segs = [];
  for (const g of timed) {
    const last = segs[segs.length - 1];
    if (last && g.from > last.to) segs.push({ id: ROAM, from: last.to, to: g.from, set: null });
    segs.push(g);
  }
  return { segs, sets };
}
function planWith(sets, taken) {
  const t0 = Math.min(...sets.map((s) => s.start)), t1 = Math.max(...sets.map((s) => s.end));
  const W = new Map(sets.map((s) => [s.id, worth(s)]));
  const byId = new Map(sets.map((s) => [s.id, s]));
  let prev = new Map([[ROAM, { v: 0, back: [] }]]);
  const trail = [];
  for (let t = t0; t < t1; t += SLOT) {
    const here = taken(t) ? [] : sets.filter((s) => s.start <= t && t < s.end && W.get(s.id) >= 0).map((s) => s.id);
    const next = new Map();
    for (const id of [ROAM, ...here]) {
      const gain = id === ROAM ? ROAM_V : W.get(id);
      let best = null;
      for (const [pid, p] of prev) {
        let cost = 0;
        if (pid !== id && id !== ROAM) {
          const to = byId.get(id);
          const mins = pid === ROAM ? 2.5 : walk(byId.get(pid).stage, to.stage);
          cost = (mins / SLOT) * gain + (pid === ROAM ? SWITCH / 2 : SWITCH);
          if (pid !== ROAM && byId.get(pid).stage === to.stage) cost = 0.02;
        }
        const v = p.v - cost;
        if (!best || v > best.v) best = { v, from: pid };
      }
      next.set(id, { v: best.v + gain, from: best.from });
    }
    trail.push({ t, next });
    prev = next;
  }
  // backtrack
  let cur = [...prev.entries()].sort((a, b) => b[1].v - a[1].v)[0][0];
  const picks = [];
  for (let i = trail.length - 1; i >= 0; i--) { picks[i] = { t: trail[i].t, id: cur }; cur = trail[i].next.get(cur).from; }
  // compress to segments
  const segs = [];
  for (const p of picks) {
    const last = segs[segs.length - 1];
    if (last && last.id === p.id) last.to = p.t + SLOT;
    else segs.push({ id: p.id, from: p.t, to: p.t + SLOT });
  }
  // trim trailing roam, drop leading roam before first set
  while (segs.length && segs[segs.length - 1].id === ROAM) segs.pop();
  while (segs.length && segs[0].id === ROAM) segs.shift();
  // a 5-minute drive-by isn't a stop; hand it back to wandering
  for (const g of segs) if (g.id !== ROAM && g.to - g.from < 10) g.id = ROAM;
  // a 5-minute taste of an act you return to later isn't a stop either: stay where you were
  for (let i = 1; i < segs.length; i++) {
    const g = segs[i], p = segs[i - 1];
    if (g.id === ROAM || g.to - g.from >= 10 || !segs.some((h) => h !== g && h.id === g.id)) continue;
    g.id = p.id !== ROAM && byId.get(p.id).end >= g.to ? p.id : ROAM;
  }
  for (let i = segs.length - 1; i > 0; i--) if (segs[i].id === segs[i - 1].id) { segs[i - 1].to = segs[i].to; segs.splice(i, 1); }
  return segs.filter((g) => g.id !== ROAM).map((g) => ({ ...g, set: byId.get(g.id) }));
}

/* ---------------- tiny svg kit ---------------- */
const GLYPH = {
  pier: '<path d="M2 8h16M4 8v9M8 8v9M12 8v9M16 8v9M2 8c3-4 13-4 16 0"/>',
  crane: '<path d="M5 18V3M5 3h12M5 6l4-3M17 3v6M15 9h4v3h-4zM2 18h6"/>',
  warehouse: '<path d="M2 18V9l5-4v4l5-4v4l6-4v13zM8 18v-5h4v5"/>',
  ship: '<path d="M2 13h16l-3 5H5zM5 13V9h9v4M8 9V5h3v4"/>',
  ball: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3v14M4.5 6.5h11M4.5 13.5h11M6.8 3.8c-2 4-2 8.4 0 12.4M13.2 3.8c2 4 2 8.4 0 12.4"/>',
  tent: '<path d="M2 17L10 3l8 14zM10 3v14M7 17l3-5 3 5"/>',
  stage: '<path d="M2 17h16M3 17V8h14v9M5 8V5h10v3M7 12h6"/>',
};
const glyph = (id) => `<svg class="glyph" viewBox="0 0 20 20" aria-hidden="true">${GLYPH[STAGE[id]?.icon] || GLYPH.stage}</svg>`;
const ICON = {
  play: '<path d="M6 4l10 6-10 6z"/>',
  pause: '<path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z"/>',
  go: '<path d="M4 10.5l4 4 8-9" fill="none"/>',
  maybe: '<path d="M7 7.5a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.9v.6M10 15.6v.4" fill="none"/>',
  skip: '<path d="M5 5l10 10M15 5L5 15" fill="none"/>',
};
const icon = (id) => `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true">${ICON[id]}</svg>`;
const GLYPHS = { bars: ["▮", "▮"], dots: ["●", "○"], number: ["", ""] }[(TH.style || {}).meter] || ["▮", "▮"];
const meter = (v) => { const on = Math.round(v / 10); return `<span class="meter" aria-label="match ${v} of 100">${`<i>${GLYPHS[0]}</i>`.repeat(GLYPHS[0] ? on : 0)}${`<i class="off">${GLYPHS[1]}</i>`.repeat(GLYPHS[0] ? 10 - on : 0)}<b>${String(v).padStart(2, "0")}</b></span>`; };
const stamp = (t) => `<span class="stamp stamp--${t}" title="${esc(TIER[t][1])}">${TIER[t][0]}</span>`;
const serifish = (set) => { if ((TH.style || {}).alternate === false) return ""; const i = parseInt(set.pos.slice(1), 10); return i % 3 === 2 ? " serif" : ""; };
function discoBall(svg) {
  const R = 46, out = [];
  out.push(`<circle r="${R}" fill="var(--knock-bg)"/>`);
  const rows = 13, cols = 20; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < rows; i++) {
    const la0 = -Math.PI / 2 + (i / rows) * Math.PI, la1 = -Math.PI / 2 + ((i + 1) / rows) * Math.PI;
    for (let j = 0; j < cols; j++) {
      const lo0 = -Math.PI / 2 + (j / cols) * Math.PI, lo1 = -Math.PI / 2 + ((j + 1) / cols) * Math.PI;
      const P = (la, lo) => [(Math.sin(lo) * Math.cos(la) * R).toFixed(2), (Math.sin(la) * R).toFixed(2)];
      const pts = [P(la0, lo0), P(la0, lo1), P(la1, lo1), P(la1, lo0)];
      const lit = rnd(), light = lit > 0.26 ? (lit > 0.9 ? "var(--cream)" : "var(--knock-fg)") : "var(--knock-bg)";
      out.push(`<polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="${light}" stroke="var(--knock-bg)" stroke-width="1.1"/>`);
    }
  }
  out.push(`<circle r="${R}" fill="none" stroke="var(--knock-bg)" stroke-width="3"/>`);
  const star = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -12 C1 -3 3 -1 12 0 C3 1 1 3 0 12 C-1 3 -3 1 -12 0 C-3 -1 -1 -3 0 -12Z" fill="var(--cream)" stroke="var(--knock-bg)" stroke-width="1.5"/>`;
  out.push(star(-30, -30, 0.9), star(34, 28, 0.6));
  svg.innerHTML = out.join("");
  svg.style.filter = "url(#xerox)";
}
function skyline(svg) {
  const parts = [];
  parts.push('<rect x="0" y="80" width="1200" height="10"/>');
  // container cranes
  const crane = (x, h, flip) => {
    const d = flip ? -1 : 1;
    return `<path d="M${x} 80 L${x} ${80 - h} L${x + 6} ${80 - h} L${x + 6} 80 Z M${x + 30} 80 L${x + 30} ${80 - h} L${x + 36} ${80 - h} L${x + 36} 80 Z M${x - 10} ${80 - h} L${x + 46} ${80 - h} L${x + 46} ${86 - h} L${x - 10} ${86 - h} Z M${x - 10 + (d < 0 ? 56 : 0)} ${82 - h} L${x - 10 + d * 110 + (d < 0 ? 56 : 0)} ${82 - h} L${x - 10 + d * 110 + (d < 0 ? 56 : 0)} ${86 - h} L${x - 10 + (d < 0 ? 56 : 0)} ${86 - h} Z"/><path class="line" d="M${x + 3} ${80 - h - 18} L${x + 3} ${80 - h} M${x + 3} ${80 - h - 18} L${x + 33 + d * 60} ${82 - h} M${x + 3} ${80 - h - 18} L${x - 40 * d} ${82 - h}"/>`;
  };
  parts.push(crane(90, 44, false), crane(330, 52, true), crane(760, 46, false), crane(1030, 40, true));
  // bay bridge suspension
  parts.push('<path class="line" d="M460 80 L460 30 M620 80 L620 30 M380 70 Q460 66 460 30 Q540 70 620 30 Q660 60 700 70 M370 70 L710 70"/>');
  for (let x = 470; x < 620; x += 10) parts.push(`<path class="line" style="stroke-width:1" d="M${x} 70 L${x} ${Math.max(34, 70 - Math.abs(540 - x) * 0.0 - (38 - Math.pow((x - 540) / 80, 2) * 38))}"/>`);
  // stacked containers
  let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 1200; x += 26) { const n = 1 + Math.floor(rnd() * 3); if (x > 440 && x < 640) continue; for (let k = 0; k < n; k++) parts.push(`<rect x="${x}" y="${80 - (k + 1) * 9}" width="24" height="8"/>`); }
  svg.innerHTML = parts.join("");
}

/* ---------------- render: masthead / taste ---------------- */
function renderTaste() {
  const all = L.sets.filter((s) => !STAGE[s.stage].ambient);
  const uniq = [...new Map(all.map((s) => [key(s.name), s])).values()];
  const ranked = [...uniq].sort((a, b) => score(b) - score(a));
  const tasted = Object.keys(T.matches).length > 0;
  $("#compiled-for").textContent = !tasted ? C.noTaste : T.sample ? C.sampleTaste : fill(C.compiledFor, { name: (T.user.name || "you").toLowerCase() });
  $("#taste").hidden = !tasted;
  $(".ticker").hidden = !tasted;
  [...document.querySelectorAll(".sect")].filter((x) => !x.hidden).forEach((x, i) => { x.querySelector(".sect__head .mono").textContent = `${String(i + 1).padStart(2, "0")} /`; });

  $("#shelf").innerHTML = ranked.slice(0, 4).map((s, i) => {
    const m = match(s);
    return `<li><span class="sticker">${i + 1}</span><button type="button" data-jump="${s.id}">
      <div class="sleeve ${m.img ? "" : "sleeve--blank"}">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : esc(s.name[0])}</div>
      <div class="cap">${esc(s.name)}<small>${DAY[s.day].label} ${fmt(s.start)} · ${STAGE[s.stage].short}</small></div></button></li>`;
  }).join("");

  const tick = ranked.filter((s) => score(s) >= 40).map((s) => `<span>${esc(s.name)} ${meterText(score(s))}</span>`);
  $("#ticker").innerHTML = (tick.join("") + tick.join(""));
}
const meterText = (v) => GLYPHS[0] ? GLYPHS[0].repeat(Math.round(v / 10)) + (GLYPHS[0] === "▮" ? "▯" : GLYPHS[1]).repeat(10 - Math.round(v / 10)) : String(v);

/* ---------------- render: plan ---------------- */
function renderPlan() {
  const now = festNow();
  const day = DAY[state.day] ? state.day : now.day || F.days[0].id;
  state.day = day;
  document.querySelectorAll("[data-day]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.day === day)));
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
  const P = plan(day);
  const setSegs = P.segs.filter((g) => g.set);
  let mins = 0, upTo = -Infinity;
  for (const g of [...setSegs].sort((a, b) => a.from - b.from)) { mins += Math.max(0, g.to - Math.max(g.from, upTo)); upTo = Math.max(upTo, g.to); }
  $("#plan-stats").innerHTML = `<span><b>${setSegs.length}</b> stop${setSegs.length === 1 ? "" : "s"}</span><span><b>${dur(mins)}</b></span>`;
  $("#plan-body").innerHTML = state.view === "grid" ? gridView(day, P, now) : listView(day, P, now);
  drawRoute();
  syncPlay();
}

/* ---------------- add between recs ----------------
   every act not in the plan sits between the recs where its set starts; adding marks them "go". */
function slotRows(k, note, acts) {
  const open = state.slot === k;
  const btn = acts.length ? `<button type="button" class="gap__add" data-slot="${k}" aria-expanded="${open}">${open ? "×" : "+ " + acts.length + " more"}</button>` : "";
  const head = note ? note.replace("</li>", btn + "</li>") : btn ? `<li class="note-row note-row--add">${btn}</li>` : "";
  if (!open) return head;
  return head + `<li class="slot"><ol class="adder__list">${acts.map((s) => `<li class="adder__row">${playBtn(s) || '<span class="play play--none"></span>'}
    <span class="adder__nm">${esc(s.name)}</span>
    <span class="adder__when">${fmt(s.start)}–${fmt(s.end)} · ${STAGE[s.stage].short}</span>
    <button type="button" class="adder__add" data-add="${s.id}" aria-label="add ${esc(s.name)}">+</button></li>`).join("")}</ol></li>`;
}
function addAct(id) {
  state.marks[id] = "go";
  store.set("marks", state.marks);
  state.slot = null;
  rerender();
  const el = document.getElementById("row-" + id);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("is-added"); }
}

function markButtons(set) {
  const mk = markOf(set);
  return `<span class="marks" role="group" aria-label="mark ${esc(set.name)}">${["go", "maybe", "skip"].map((m) => `<button type="button" data-mark="${m}" data-id="${set.id}" aria-pressed="${mk === m}" aria-label="${m}" title="${m}">${icon(m)}</button>`).join("")}</span>`;
}

/* ---------------- snippets ----------------
   one shared <audio>: plays SNIP seconds of each of an act's top tracks, then stops. */
const SNIP = 12;
const audio = new Audio();
audio.preload = "none";
const player = { k: null, i: 0 };
const playBtn = (set) => (PV[key(set.name)] ? `<button type="button" class="play" data-play="${esc(key(set.name))}" aria-label="play ${esc(set.name)}">${icon("play")}</button>` : "");
function playTrack(k, i) {
  const t = PV[k]?.[i];
  if (!t) return stopPlay();
  Object.assign(player, { k, i });
  audio.src = t.url;
  audio.play().catch(stopPlay);
  syncPlay();
}
function stopPlay() { audio.pause(); player.k = null; syncPlay(); }
function togglePlay(k) { if (player.k === k) stopPlay(); else playTrack(k, 0); }
audio.addEventListener("timeupdate", () => {
  if (!player.k) return;
  const p = Math.min(1, audio.currentTime / SNIP);
  document.querySelectorAll(".play.is-on").forEach((b) => b.style.setProperty("--p", (player.i + p) / PV[player.k].length));
  if (audio.currentTime >= SNIP) playTrack(player.k, player.i + 1);
});
audio.addEventListener("ended", () => player.k && playTrack(player.k, player.i + 1));
function syncPlay() {
  document.querySelectorAll(".play:not(.play--none)").forEach((b) => {
    const on = b.dataset.play === player.k;
    b.classList.toggle("is-on", on);
    b.innerHTML = icon(on ? "pause" : "play");
    if (!on) b.style.removeProperty("--p");
    let np = b.parentElement.querySelector(":scope > .np");
    if (on && !np) b.parentElement.append(np = Object.assign(document.createElement("span"), { className: "np" }));
    if (on) np.textContent = "♪ " + PV[player.k][player.i].n.toLowerCase();
    else if (np) np.remove();
  });
}

function listView(day, P, now) {
  const out = [];
  let last = null, notes = [], k = 0, lo = -Infinity;
  const picks = P.segs.filter((g) => g.set);
  const inPlan = new Set(picks.map((g) => g.set.id));
  const pool = P.sets.filter((s) => !STAGE[s.stage].ambient && !inPlan.has(s.id)).sort((a, b) => a.start - b.start || score(b) - score(a));
  const flush = (lo, hi) => {
    const note = notes.pop();
    out.push(...notes, slotRows(day + k++, note, pool.filter((s) => s.start >= lo && s.start < hi)));
    notes = [];
  };
  P.segs.forEach((g, i) => {
    if (!g.set) {
      const len = g.to - g.from;
      if (len >= 15) notes.push(`<li class="note-row gap"><span class="hand">free</span> ${len < 60 ? len + " min" : dur(len)}</li>`);
      return;
    }
    const s = g.set;
    if (last && last.set) {
      const w = walk(last.set.stage, s.stage), p = last.set;
      if (s.start < p.end && p.start < s.end && markOf(s) === "go" && markOf(p) === "go" && !g.back && !last.back) notes.push(`<li class="note-row">${w ? `↓ ${w} min · ` : ""}overlap<button type="button" class="ov-swap" data-swap="${p.id}|${s.id}" aria-label="see ${esc(s.name)} before ${esc(p.name)}" title="swap order">⇅</button></li>`);
      else if (w) notes.push(`<li class="note-row">↓ ${w} min</li>`);
    }
    const hi = Math.max(lo, g.from);
    flush(lo, hi);
    lo = hi;
    const full = g.from <= s.start && g.to >= s.end;
    const live = now.day === day && now.min >= g.from && now.min < g.to;
    const cls = [markOf(s) === "go" || score(s) >= 50 ? "is-pick" : "", score(s) < 20 && !markOf(s) ? "is-filler" : "", live ? "is-live" : ""].join(" ");
    out.push(`<li class="row ${cls}" id="row-${s.id}" data-stage="${esc(s.stage)}">
      <span class="row__pos">${s.pos}</span>
      <span class="row__time">${fmt(g.from)}–${fmt(g.to)}${full ? "" : `<small>of ${fmt(s.start)}–${fmt(s.end)}</small>`}</span>
      <div class="row__name">${playBtn(s)}<span class="nm${serifish(s)}">${esc(s.name)}</span>${s.qualifier ? `<span class="q">${esc(s.qualifier)}</span>` : ""}</div>
      <span class="row__stage">${glyph(s.stage)}${STAGE[s.stage].name}</span>
      <span class="meter-cell">${meter(score(s))}</span>
      <span class="stamp-cell">${stamp(tierOf(s))}</span>
      <span class="marks-cell">${markButtons(s)}</span>
    </li>`);
    last = g;
  });
  flush(lo, Infinity);
  if (!out.some(Boolean)) return `<p class="empty">—</p>`;
  return `<ol class="tl">${out.join("")}</ol>`;
}

const PX = 1.5; // px per minute in grid view
function gridView(day, P, now) {
  const { t0, close } = hours(day), sets = P.sets, t1 = close + 5;
  const top = (m) => (m - t0) * PX;
  const H = top(t1);
  const planned = new Map();
  for (const g of P.segs) if (g.set) (planned.get(g.set.id) || planned.set(g.set.id, []).get(g.set.id)).push(g);
  const marks = []; for (let m = t0; m <= close; m += 60) marks.push(m);
  const cols = L.stages.map((st) => {
    const boxes = sets.filter((s) => s.stage === st.id).map((s) => {
      const segs = planned.get(s.id) || [];
      const mk = markOf(s);
      const cls = segs.length ? "is-pick" : mk === "skip" ? "is-skip" : "";
      const slices = segs.filter((g) => g.from > s.start || g.to < s.end).map((g) => `<span class="slice" style="top:${top(g.from) - top(s.start)}px;height:${(g.to - g.from) * PX}px"></span>`).join("");
      const h = (s.end - s.start) * PX - 4;
      return `<div class="gbox ${cls}" data-cycle="${s.id}" data-stage="${esc(s.stage)}" style="top:${top(s.start) + 2}px;height:${h}px" title="${esc(s.name)} · tap to cycle go / maybe / skip">
        ${slices}<span>${esc(s.name)}</span>${h > 44 ? `<small>${fmt(s.start)}–${fmt(s.end)}</small>` : ""}${h > 64 && !STAGE[s.stage].ambient ? `<span class="m">${meterText(score(s))}</span>` : ""}${mk ? `<small>[${mk}]</small>` : ""}</div>`;
    }).join("");
    return `<div class="gridv__col" data-stage="${esc(st.id)}" style="height:${H}px">${boxes}</div>`;
  }).join("");
  const heads = L.stages.map((st) => `<div class="gridv__head" data-stage="${esc(st.id)}">${glyph(st.id)}${esc(st.name)}</div>`).join("");
  const rail = marks.map((m) => `<span style="top:${top(m)}px">${fmt(m)}${m === t0 ? (m >= 720 ? "pm" : "am") : ""}</span>`).join("");
  const lines = marks.map((m) => `<i style="top:${top(m)}px"></i>`).join("");
  const nowLine = now.day === day && now.min >= t0 && now.min <= t1 ? `<div class="gridv__now" style="top:${top(now.min)}px"></div>` : "";
  return `<div class="gridv" id="gridv" style="--stages:${L.stages.length}"><div class="gridv__head"></div>${heads}
    <div class="gridv__rail" style="height:${H}px">${rail}</div>${cols}
    <div class="gridv__hours" style="top:var(--headH,36px);height:${H}px">${lines}${nowLine}</div>
    <svg class="gridv__route" id="route"></svg></div>`;
}
function drawRoute() {
  const g = $("#gridv"), svg = $("#route");
  if (!g || !svg) return;
  const head = g.querySelector(".gridv__head");
  g.querySelector(".gridv__hours").style.setProperty("--headH", head.offsetHeight + "px");
  g.querySelector(".gridv__hours").style.top = head.offsetHeight + "px";
  const P = plan(state.day);
  const gr = g.getBoundingClientRect();
  const pts = [];
  for (const s of P.segs) {
    if (!s.set) continue;
    const box = g.querySelector(`[data-cycle="${s.set.id}"]`); if (!box) continue;
    const r = box.getBoundingClientRect(), br = box.parentElement.getBoundingClientRect();
    const y0 = br.top - gr.top + g.scrollTop + (s.from - hours(state.day).t0) * PX, y1 = br.top - gr.top + g.scrollTop + (s.to - hours(state.day).t0) * PX;
    const x = r.left - gr.left + g.scrollLeft + r.width / 2;
    pts.push([x, y0 + 6], [x, y1 - 6]);
  }
  svg.setAttribute("width", g.scrollWidth); svg.setAttribute("height", g.scrollHeight);
  svg.style.width = g.scrollWidth + "px"; svg.style.height = g.scrollHeight + "px";
  if (!pts.length) { svg.innerHTML = ""; return; }
  svg.innerHTML = `<path d="M${pts.map((p) => p.map((n) => n.toFixed(1)).join(" ")).join(" L")}"/>` + `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4"/>`;
}

/* ---------------- render: catalog ---------------- */
function renderCatalog() {
  const all = L.sets;
  const counts = { all: all.length };
  for (const s of all) counts[tierOf(s)] = (counts[tierOf(s)] || 0) + 1;
  const FILTERS = [["all", "all"], ...["heavy", "deep", "wild", "new"].map((k) => [k, TIER[k][2]])];
  $("#filters").innerHTML = FILTERS.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-selected="${state.filter === k}">${l}<span class="n">${counts[k] || 0}</span></button>`).join("");
  $("#sorts").innerHTML = [["match", "by match"], ["time", "by time"], ["az", "a–z"]].map(([k, l]) => `<button class="chip" data-sort="${k}" aria-selected="${state.sort === k}">${l}</button>`).join("");
  let rows = all.filter((s) => state.filter === "all" || tierOf(s) === state.filter);
  rows = [...rows].sort(state.sort === "time" ? (a, b) => a.cat.localeCompare(b.cat) : state.sort === "az" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => score(b) - score(a) || a.cat.localeCompare(b.cat));
  const rankOf = new Map([...all].sort((a, b) => score(b) - score(a)).map((s, i) => [s.id, i + 1]));
  $("#index").innerHTML = rows.map((s) => {
    const m = match(s), open = state.open === s.id;
    const ev = (m.evidence || []).map((e, i) => `<li>${e}</li>`).join("") ;
    return `<li class="irow ${open ? "is-open" : ""}" id="cat-${s.id}" data-stage="${esc(s.stage)}">
      <div class="irow__head">${playBtn(s) || '<span class="play play--none"></span>'}<button class="irow__main" type="button" data-open="${s.id}" aria-expanded="${open}">
        <span class="rank">${rankOf.get(s.id)}</span>
        <span class="cat">${s.cat}<br>${s.pos}</span>
        <span><span class="nm${serifish(s)}">${esc(s.name)}</span><span class="tags">${s.tags.map((t) => t === "?" ? `<span class="tag tag--q">unverified</span>` : `<span class="tag">${esc(t)}</span>`).join("")}</span></span>
        <span class="when">${glyph(s.stage)}${DAY[s.day].label} · ${STAGE[s.stage].name.toUpperCase()}<br>${fmt(s.start)}–${fmt(s.end)}</span>
        <span class="meter-cell">${meter(score(s))}</span>
        <span class="stamp-cell">${stamp(tierOf(s))}</span>
      </button></div>
      <div class="irow__notes">
        ${m.img ? `<div class="photo"><img src="${esc(m.img)}" alt="${esc(s.name)}" loading="lazy"></div>` : ""}
        <div class="liner"${ev ? "" : " hidden"}><h4>${esc(C.linerNotes)}</h4><ol>${ev}</ol></div>
        <div class="credits"><h4>${esc(C.credits)}</h4>
          ${m.riyl && m.riyl.length ? `<p class="riyl"><b>RIYL:</b> ${esc(m.riyl.join(", ").toLowerCase())}</p>` : ""}
          ${m.topTrack ? `<p>▶ <em>${esc(m.topTrack)}</em></p>` : ""}
          <p>${markButtons(s)} ${m.url ? `&nbsp; <a class="spotlink" href="${esc(m.url)}" target="_blank" rel="noopener">spotify ↗</a>` : ""}</p>
        </div>
      </div></li>`;
  }).join("");
  syncPlay();
}

/* ---------------- render: map ---------------- */
function renderMap() {
  const Wd = 620, Hd = 330, M = F.map || {};
  const st = L.stages;
  const pos = (s) => [30 + s.x * (Wd - 60), 20 + s.y * (Hd - 60)];
  const S = Object.fromEntries(st.map((s) => [s.id, s]));
  const walks = (M.paths || []).filter(([a, b]) => S[a] && S[b]).map(([a, b]) => { const [x1, y1] = pos(S[a]), [x2, y2] = pos(S[b]); return `<path class="walk" d="M${x1} ${y1} L${x2} ${y2}"/><text class="walk-t" x="${(x1 + x2) / 2 + 4}" y="${(y1 + y2) / 2 - 4}">${walk(a, b)}m</text>`; }).join("");
  const boxes = st.map((s) => { const [x, y] = pos(s); const w = s.wide ? 150 : 96, h = s.wide ? 46 : 40; return `<g class="stg" data-stage="${esc(s.id)}"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}"/><text x="${x}" y="${y + 5}" text-anchor="middle">${esc((s.name.length > (s.wide ? 20 : 12) ? s.short : s.name).toUpperCase())}</text></g>`; }).join("");
  const ground = M.ground ? `<path class="ground" d="${esc(M.ground)}"/>` : `<rect class="ground" x="20" y="18" width="580" height="282"/>`;
  const water = (M.water || []).map(([x, y, w, h]) => `<rect class="water" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
  const labels = (M.labels || []).map(([x, y, t]) => `<text class="ent" x="${x}" y="${y}">${esc(t)}</text>`).join("");
  const svg = `<svg class="map" viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="simplified ${esc(F.venue || F.name)} layout with estimated walk times">
    ${ground}${water}${walks}${boxes}${labels}</svg>`;
  const ids = st.map((s) => s.id);
  const table = `<table class="walktable"><thead><tr><th></th>${ids.map((i) => `<th>${esc(S[i].short)}</th>`).join("")}</tr></thead><tbody>${ids.map((a) => `<tr><th>${esc(S[a].short)}</th>${ids.map((b) => `<td class="${a === b ? "self" : ""}">${a === b ? "·" : `${walk(a, b)}<small> min</small>`}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $("#mapwrap").innerHTML = `<div>${svg}</div><div>${table}</div>`;
}

/* ---------------- now / next ---------------- */
function renderNow() {
  const bar = $("#nowbar"), now = festNow();
  if (!now.day) { bar.hidden = true; return; }
  const { doors, close } = hours(now.day);
  if (now.min < doors - 120 || now.min > close + 15) { bar.hidden = true; return; }
  const P = plan(now.day), segs = P.segs.filter((g) => g.set);
  const cur = segs.find((g) => now.min >= g.from && now.min < g.to);
  const nxt = segs.find((g) => g.from > now.min && (!cur || g.set.id !== cur.set.id));
  bar.hidden = false;
  if (!cur) {
    bar.innerHTML = `<span class="live"><i></i>${now.min < doors ? "DOORS " + fmtAP(doors).replace(":00", "").toUpperCase() : "BETWEEN SETS"}</span><span class="now">${nxt ? `next: <b>${esc(nxt.set.name)}</b>` : "—"}</span><span class="next">${nxt ? `${fmt(nxt.from)} · ${STAGE[nxt.set.stage].short.toLowerCase()}` : ""}</span>`;
    return;
  }
  const left = cur.to - now.min;
  bar.innerHTML = `<span class="live"><i></i>NOW</span><span class="now"><b>${esc(cur.set.name)}</b> · ${STAGE[cur.set.stage].name.toLowerCase()}</span>
    <span class="next">${nxt ? `in ${left} min → <b>${esc(nxt.set.name)}</b> · ${STAGE[nxt.set.stage].short.toLowerCase()} ↓${walk(cur.set.stage, nxt.set.stage)}m` : `${left} min left`}</span>`;
}

/* ---------------- events ---------------- */
function swapOrder(a, b) {
  const run = plan(state.day).segs.filter((g) => g.set);
  const i = run.findIndex((g, j) => g.id === a && run[j + 1]?.id === b);
  if (i < 0) return;
  const ka = rank(run[i]), kb = rank(run[i + 1]);
  state.order[b] = ka;
  state.order[a] = kb > ka ? kb : ka + 0.5;
  store.set("order", state.order);
  rerender();
}
function rerender() { renderTaste(); renderPlan(); renderCatalog(); renderNow(); }
function setMark(id, m) {
  const set = L.sets.find((s) => s.id === id);
  if (markOf(set) === m) { if (match(set).pinned) state.marks[id] = "off"; else delete state.marks[id]; } else state.marks[id] = m;
  store.set("marks", state.marks);
  rerender();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-cycle]");
  if (!b) return;
  if (b.dataset.day) { state.day = b.dataset.day; store.set("day", state.day); renderPlan(); }
  else if (b.dataset.view) { state.view = b.dataset.view; store.set("view", state.view); renderPlan(); }
  else if (b.dataset.play) togglePlay(b.dataset.play);
  else if (b.dataset.slot) { state.slot = state.slot === b.dataset.slot ? null : b.dataset.slot; renderPlan(); }
  else if (b.dataset.add) addAct(b.dataset.add);
  else if (b.dataset.swap) swapOrder(...b.dataset.swap.split("|"));
  else if (b.dataset.mark) { e.stopPropagation(); setMark(b.dataset.id, b.dataset.mark); }
  else if (b.dataset.cycle) {
    const order = [undefined, "go", "maybe", "skip"]; const id = b.dataset.cycle;
    const set = L.sets.find((s) => s.id === id);
    const nx = order[(order.indexOf(markOf(set)) + 1) % order.length];
    if (nx) state.marks[id] = nx; else if (match(set).pinned) state.marks[id] = "off"; else delete state.marks[id];
    store.set("marks", state.marks); rerender();
  }
  else if (b.dataset.filter) { state.filter = b.dataset.filter; renderCatalog(); }
  else if (b.dataset.sort) { state.sort = b.dataset.sort; renderCatalog(); }
  else if (b.dataset.open) { state.open = state.open === b.dataset.open ? null : b.dataset.open; renderCatalog(); }
  else if (b.dataset.jump) {
    state.filter = "all"; state.open = b.dataset.jump; renderCatalog();
    document.getElementById("cat-" + b.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  else if (b.id === "theme-toggle") { state.theme = state.theme === "night" ? "day" : "night"; store.set("theme", state.theme); applyTheme(); }
});
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("#theme-toggle").setAttribute("aria-pressed", String(state.theme === "night"));
  $("#theme-toggle").textContent = state.theme === "night" ? C.lightsOn : C.lightsOff;
  document.querySelector('meta[name="theme-color"]').content = (TH[state.theme] || {}).paper || "#DFDCDF";
}
addEventListener("resize", () => drawRoute());

/* ---------------- masthead from the festival ---------------- */
function renderMast() {
  const side = (i) => fill(C.side, { letter: String.fromCharCode(65 + i), n: i + 1 });
  const mmdd = (d) => d.date.slice(5).replace("-", ".");
  document.title = fill(C.title, { name: F.name.toLowerCase(), Name: F.name, year: F.year });
  const wcase = (TH.wordmark || {}).case;
  const letters = [...(wcase === "lower" ? F.name.toLowerCase() : wcase === "as-is" ? F.name : F.name.toUpperCase())];
  const ball = TH.wordmark && TH.wordmark.ball ? letters.findIndex((c) => c === "O" || c === "o") : -1;
  const wm = $("#wordmark");
  wm.setAttribute("aria-label", `${F.name} ${F.year}`);
  wm.style.setProperty("--n", String(letters.length + 1));
  const tile = (c, i) => i === ball
    ? '<span class="knock knock--ball" aria-hidden="true"><svg class="ball" viewBox="-50 -50 100 100" id="wordmark-ball"></svg></span>'
    : `<span class="knock" aria-hidden="true">${esc(c)}</span>`;
  // a multi-word name keeps each word's letters together, so a narrow screen breaks it between words
  let at = 0;
  const words = letters.join("").split(" ").map((w) => { const html = [...w].map((c) => tile(c, at++)).join(""); at++; return html; });
  wm.innerHTML = (words.length > 1 ? words.map((w) => `<span class="word">${w}</span>`).join('<span class="gap" aria-hidden="true"></span>') : words[0])
    + `<span class="yearstack" aria-hidden="true">${[...String(F.year)].map((d) => `<b>${d}</b>`).join("")}</span>`;
  $("#mast-days").innerHTML = F.days.map((d, i) => `<span class="label${i ? "" : " label--ink"}">${side(i) ? side(i) + " · " : ""}${esc(d.label)} ${mmdd(d)}</span>`).join("");
  $("#day-tabs").innerHTML = F.days.map((d, i) => `<button class="label label--btn" role="tab" data-day="${esc(d.id)}">${side(i) ? side(i) + " · " : ""}${esc(d.label)}</button>`).join("");
  $("#map-title").textContent = C.map || (F.map && F.map.title) || "THE GROUNDS";
  for (const el of document.querySelectorAll("[data-copy]")) el.textContent = C[el.dataset.copy] ?? el.textContent;
  $("#foot-source").textContent = C.footer + (F.source ? " · times via " + F.source : "");
}

/* ---------------- look: colors, fonts, texture from the festival's theme ---------------- */
function applyLook() {
  const ROLE = { display: "sans-serif", wordmark: "sans-serif", serif: "serif", body: "sans-serif", mono: "monospace", hand: "cursive" };
  const fonts = TH.fonts || {};
  // shades a theme leaves out come from its own ink and paper, not from Portola's palette
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + rgb(a).map((x, i) => Math.round(x * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
  const shades = (c, dark) => {
    if (!c || !c.ink || !c.paper) return c;
    const derived = {
      "ink-70": mix(c.ink, c.paper, 0.7), "ink-50": mix(c.ink, c.paper, 0.5), "ink-30": mix(c.ink, c.paper, 0.3),
      "ink-deep": mix(c.ink, dark ? "#ffffff" : "#000000", 0.75),
      "paper-2": mix(c.paper, c.ink, 0.92), "paper-3": mix(c.paper, dark ? "#000000" : "#ffffff", 0.6),
      black: mix(c.ink, "#000000", 0.25), grey: mix(c.ink, c.paper, 0.6), cream: dark ? mix(c.ink, "#ffffff", 0.5) : "#ffffff",
      "knock-bg": c.ink, "knock-fg": c.paper,
    };
    return { ...derived, ...c };
  };
  const vars = (tokens) => Object.entries(tokens || {}).map(([k, v]) => `--${k}:${v};`).join("");
  const face = (r) => fonts[r] || (r === "serif" && fonts.display);
  const faces = Object.keys(ROLE).filter(face).map((r) => `--f-${r}:"${face(r)}",${ROLE[r]};`).join("");
  const style = document.createElement("style");
  style.textContent = `:root{${vars(shades(TH.day, false))}${faces}}[data-theme="night"]{${vars(shades(TH.night, true))}}`;
  document.head.append(style);
  if (fonts.google) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${fonts.google}&display=swap`;
    document.head.append(link);
  }
  document.documentElement.classList.toggle("no-texture", TH.texture === false);
  for (const [k, v] of Object.entries(TH.style || {})) document.documentElement.dataset[k] = String(v);
  for (const k of ["live", "now", "sep"]) if (C[k] !== undefined) document.documentElement.style.setProperty(`--copy-${k}`, JSON.stringify(C[k]));
  // the two-tone photo filter takes the theme's ink and paper
  const hex = (c) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3));
  const day = TH.day || {};
  if (day.ink && day.paper) {
    const [a, b] = [hex(day.ink), hex(day.paper)];
    ["R", "G", "B"].forEach((ch, i) => document.querySelector(`#duotone feFunc${ch}`)?.setAttribute("tableValues", `${a[i]} ${b[i]}`));
  }
  if (TH.css) {
    const custom = document.createElement("link");
    custom.rel = "stylesheet";
    custom.href = "festival.css";
    document.head.append(custom);
  }
}

/* ---------------- boot ---------------- */
applyLook();
renderMast();
applyTheme();
if ($("#wordmark-ball")) discoBall($("#wordmark-ball"));
if (TH.skyline === "port") skyline($("#skyline")); else $("#skyline").remove();
rerender();
renderMap();
setInterval(renderNow, 30000);
if (document.fonts) document.fonts.ready.then(drawRoute);
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
