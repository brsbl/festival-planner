import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return basename(here) === "dist" && !existsSync(join(here, "public")) ? dirname(here) : here;
})();

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  woff2: "font/woff2",
};
const PUBLIC_FILES = ["index.html", "styles.css", "app.js", "sw.js", "defaults.js"];

const clock = z.string().regex(/^\d{1,2}:\d{2}$/);
export const lineupSchema = z.object({
  festival: z.object({
    name: z.string().min(1),
    year: z.number().int(),
    code: z.string().min(1),
    venue: z.string().min(1),
    timeZone: z.string().min(1),
    source: z.string(),
    doors: clock,
    close: clock,
    days: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), doors: clock.optional(), close: clock.optional() })).min(1),
    map: z.object({
      title: z.string(),
      ground: z.string().optional(),
      water: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(),
      labels: z.array(z.tuple([z.number(), z.number(), z.string()])).optional(),
      paths: z.array(z.tuple([z.string(), z.string()])).optional(),
    }).optional(),
  }),
  stages: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    short: z.string().min(1),
    icon: z.string(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    wide: z.boolean().optional(),
    ambient: z.boolean().optional(),
  })).min(1),
  walk: z.record(z.string(), z.number().nonnegative()),
  sets: z.array(z.object({
    id: z.string().min(1),
    cat: z.string(),
    pos: z.string().regex(/^[A-Z]\d+$/),
    name: z.string().min(1),
    qualifier: z.string().nullable(),
    billing: z.string(),
    day: z.string(),
    stage: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    blurb: z.string(),
    tags: z.array(z.string()),
    artists: z.array(z.string()).optional(),
  })).min(1),
}).superRefine((value, ctx) => {
  const days = new Set(value.festival.days.map((d) => d.id));
  const stages = new Set(value.stages.map((s) => s.id));
  value.sets.forEach((set, index) => {
    if (!days.has(set.day)) ctx.addIssue({ code: "custom", path: ["sets", index, "day"], message: `unknown day "${set.day}"` });
    if (!stages.has(set.stage)) ctx.addIssue({ code: "custom", path: ["sets", index, "stage"], message: `unknown stage "${set.stage}"` });
    if (set.end <= set.start) ctx.addIssue({ code: "custom", path: ["sets", index, "end"], message: "ends before it starts" });
  });
});

export const tasteSchema = z.object({
  sample: z.boolean().optional(),
  user: z.object({ name: z.string() }),
  matches: z.record(z.string(), z.object({
    score: z.number().min(0).max(100),
    tier: z.enum(["heavy", "deep", "wild"]).nullable(),
    known: z.boolean(),
    pinned: z.boolean().optional(),
    evidence: z.array(z.string()),
    riyl: z.array(z.string()),
    topTrack: z.string().nullable(),
    tracks: z.array(z.object({ n: z.string(), id: z.string() })).optional(),
    url: z.string().nullable(),
    img: z.string().nullable(),
  })),
});

export const artistsSchema = z.record(z.string(), z.object({ img: z.string().nullable(), url: z.string().nullable() }));

export const previewsSchema = z.record(z.string(), z.array(z.object({ n: z.string(), url: z.string().url() })));

// Validation only: public/defaults.js fills in whatever a theme leaves out, so a preview built
// straight from festival/theme.json looks the same as the installed page.
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const palette = z.record(z.string().regex(/^[a-z0-9-]+$/), color);
const words = z.string().max(80);
export const themeSchema = z.object({
  fonts: z.object({
    display: z.string(), wordmark: z.string(), serif: z.string(), body: z.string(), mono: z.string(), hand: z.string(), google: z.string(),
  }).partial().optional(),
  day: palette.optional(),
  night: palette.optional(),
  texture: z.boolean().optional(),
  wordmark: z.object({ ball: z.boolean(), case: z.enum(["upper", "lower", "as-is"]) }).partial().optional(),
  skyline: z.enum(["port", "none"]).optional(),
  style: z.object({
    shape: z.enum(["print", "soft", "flat"]),
    wordmark: z.enum(["tiles", "solid", "outline"]),
    photos: z.enum(["duotone", "color", "mono"]),
    rules: z.enum(["dashed", "solid", "dotted", "none"]),
    meter: z.enum(["bars", "dots", "number"]),
    marker: z.enum(["highlighter", "underline", "none"]),
    catalog: z.enum(["on", "off"]),
    ticker: z.boolean(),
    numbers: z.enum(["on", "off"]),
    case: z.enum(["upper", "natural"]),
    alternate: z.boolean(),
  }).partial().optional(),
  copy: z.object({
    title: words, side: words, compiledFor: words, sampleTaste: words, noTaste: words, lightsOff: words, lightsOn: words,
    taste: words, top: words, plan: words, catalog: words, list: words, grid: words,
    linerNotes: words, credits: words, footer: words, map: words, live: words, now: words, sep: words,
    tiers: z.object(Object.fromEntries(["heavy", "deep", "wild", "new"].map((k) => [k, z.object({ stamp: words, filter: words, hint: z.string().max(160) }).partial()]))).partial(),
  }).partial().optional(),
}).strict();

type Lineup = z.infer<typeof lineupSchema>;
type Taste = z.infer<typeof tasteSchema>;
type Previews = z.infer<typeof previewsSchema>;
type Theme = z.infer<typeof themeSchema>;

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const FESTIVALS = join(ROOT, "festivals");

function readJson<T>(dir: string, file: string, schema: z.ZodType<T>, fallback?: T): T {
  const path = join(dir, file);
  if (fallback !== undefined && !existsSync(path)) return fallback;
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`${dir.slice(ROOT.length + 1)}/${file} doesn't match the expected shape:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

const emptyTaste: Taste = { sample: true, user: { name: "" }, matches: {} };

interface Festival {
  slug: string;
  dir: string;
  lineup: Lineup;
  theme: Theme;
  sample: { taste: Taste; previews: Previews };
  artists: z.infer<typeof artistsSchema>;
  css: boolean;
  assets: string[];
}

// every festivals/<slug>/ folder with a lineup.json is a festival with its own page and taste
export function loadFestivals(): Festival[] {
  if (!existsSync(FESTIVALS)) return [];
  return readdirSync(FESTIVALS)
    .filter((slug) => SLUG.test(slug) && statSync(join(FESTIVALS, slug)).isDirectory() && existsSync(join(FESTIVALS, slug, "lineup.json")))
    .sort()
    .map((slug) => {
      const dir = join(FESTIVALS, slug);
      const assetDir = join(dir, "assets");
      return {
        slug,
        dir,
        lineup: readJson(dir, "lineup.json", lineupSchema),
        theme: readJson(dir, "theme.json", themeSchema, {}),
        sample: {
          taste: readJson(dir, "sample-taste.json", tasteSchema, emptyTaste),
          previews: readJson<Previews>(dir, "sample-previews.json", previewsSchema, {}),
        },
        artists: readJson(dir, "artists.json", artistsSchema, {}),
        css: existsSync(join(dir, "style.css")),
        assets: existsSync(assetDir) ? readdirSync(assetDir).filter((file) => /^[\w.-]+$/.test(file)) : [],
      };
    });
}

const PERSONAL = {
  taste: { schema: tasteSchema, global: "TASTE" },
  previews: { schema: previewsSchema, global: "PREVIEWS" },
} as const;
type Personal = keyof typeof PERSONAL;
const PERSONAL_NAMES = Object.keys(PERSONAL) as Personal[];
const isPersonal = (value: string | undefined): value is Personal => value !== undefined && Object.hasOwn(PERSONAL, value);
const kvKey = (slug: string, kind: Personal) => `${slug}:${kind}`;

const USAGE = `Usage:
  bb festival list [--json]
  bb festival status [--festival <slug>] [--json]
  bb festival export <lineup|theme|taste|previews> [--festival <slug>]
  bb festival import <taste|previews> <json> [--festival <slug>] [--part <i>/<n>] [--base64]
  bb festival reset [taste|previews|all] [--festival <slug>]

--festival is needed when more than one festival is installed. Festivals are the plugin's
festivals/<slug>/ folders; add or edit one, run \`npm run brand\`, and reinstall.`;

export default function plugin(bb: BbPluginApi): void {
  const kv = bb.storage.kv;
  const festivals = loadFestivals();
  const bySlug = new Map(festivals.map((f) => [f.slug, f]));
  const pending = new Map<string, Buffer[]>();

  async function stored<K extends Personal>(slug: string, kind: K): Promise<z.infer<(typeof PERSONAL)[K]["schema"]> | null> {
    const value = await kv.get<unknown>(kvKey(slug, kind));
    if (value === undefined) return null;
    const parsed = PERSONAL[kind].schema.safeParse(value);
    if (parsed.success) return parsed.data as z.infer<(typeof PERSONAL)[K]["schema"]>;
    bb.log.warn("ignoring invalid stored data", { slug, kind });
    return null;
  }

  async function current(f: Festival) {
    const [taste, previews] = await Promise.all([stored(f.slug, "taste"), stored(f.slug, "previews")]);
    return {
      lineup: f.lineup,
      theme: f.theme,
      taste: taste ?? f.sample.taste,
      previews: previews ?? f.sample.previews,
      custom: { taste: taste !== null, previews: previews !== null },
    };
  }

  const file = async (path: string, type: string) =>
    new Response(await readFile(path), { headers: { "content-type": type, "cache-control": "no-cache" } });
  const script = (global: string, data: unknown) =>
    new Response(`window.${global} = ${JSON.stringify(data)};\n`, { headers: { "content-type": TYPES.js, "cache-control": "no-store" } });

  for (const f of festivals) {
    const base = `/${f.slug}`;
    bb.http.route("GET", `${base}/`, () => file(join(ROOT, "public", "index.html"), TYPES.html));
    for (const name of PUBLIC_FILES) bb.http.route("GET", `${base}/${name}`, () => file(join(ROOT, "public", name), TYPES[name.slice(name.lastIndexOf(".") + 1)]));
    bb.http.route("GET", `${base}/data/lineup.js`, () => script("LINEUP", f.lineup));
    bb.http.route("GET", `${base}/data/artists.js`, () => script("ARTISTS", f.artists));
    bb.http.route("GET", `${base}/data/theme.js`, () => script("THEME", { ...f.theme, css: f.css }));
    for (const kind of PERSONAL_NAMES) bb.http.route("GET", `${base}/data/${kind}.js`, async () => script(PERSONAL[kind].global, (await current(f))[kind]));
    bb.http.route("GET", `${base}/festival.css`, async () =>
      f.css ? file(join(f.dir, "style.css"), TYPES.css) : new Response("", { headers: { "content-type": TYPES.css } }));
    for (const asset of f.assets) {
      const type = TYPES[asset.slice(asset.lastIndexOf(".") + 1).toLowerCase()];
      if (type) bb.http.route("GET", `${base}/assets/${asset}`, () => file(join(f.dir, "assets", asset), type));
    }
  }
  bb.log.info("festivals", { slugs: festivals.map((f) => f.slug) });

  async function importPart(f: Festival, kind: Personal, text: string, part: string | undefined, base64: boolean): Promise<{ done: boolean; message: string }> {
    const key = kvKey(f.slug, kind);
    let index = 1, count = 1;
    if (part !== undefined) {
      const match = /^(\d+)\/(\d+)$/.exec(part);
      if (!match) throw new Error("--part must look like 2/5");
      index = Number(match[1]);
      count = Number(match[2]);
      if (index < 1 || index > count) throw new Error("--part index is out of range");
    }
    const parts: Buffer[] | undefined = index === 1 ? [] : pending.get(key);
    if (!parts || parts.length !== index - 1) {
      pending.delete(key);
      throw new Error(`expected part ${parts ? parts.length + 1 : 1} of ${kind}; start again from 1/${count}`);
    }
    parts.push(Buffer.from(text, base64 ? "base64" : "utf8"));
    if (index < count) {
      pending.set(key, parts);
      return { done: false, message: `received ${kind} part ${index}/${count}` };
    }
    pending.delete(key);
    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new Error(`${kind} is not valid JSON`);
    }
    const parsed = PERSONAL[kind].schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 8).map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
      throw new Error(`${kind} doesn't match the expected shape:\n${issues.join("\n")}`);
    }
    await kv.set(key, parsed.data);
    return { done: true, message: `saved ${kind} for ${f.lineup.festival.name} ${f.lineup.festival.year}` };
  }

  // pulls --festival <slug> out of the arguments; with one festival installed it's optional
  function pick(args: string[]): { festival: Festival; rest: string[] } {
    const at = args.indexOf("--festival");
    const slug = at >= 0 ? args[at + 1] : undefined;
    const rest = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
    if (slug !== undefined) {
      const festival = bySlug.get(slug);
      if (!festival) throw new Error(`no festival "${slug}"; installed: ${festivals.map((f) => f.slug).join(", ") || "none"}`);
      return { festival, rest };
    }
    if (festivals.length === 1) return { festival: festivals[0], rest };
    throw new Error(festivals.length ? `more than one festival is installed; add --festival ${festivals.map((f) => f.slug).join("|")}` : "no festivals installed");
  }

  async function status(f: Festival) {
    const { taste, custom } = await current(f);
    return {
      slug: f.slug,
      festival: `${f.lineup.festival.name} ${f.lineup.festival.year}`,
      sets: f.lineup.sets.length,
      folder: f.dir,
      taste: custom.taste ? `yours (${taste.user.name || "unnamed"}, ${Object.keys(taste.matches).length} acts)` : Object.keys(taste.matches).length ? "sample" : "none yet",
      previews: custom.previews ? "yours" : Object.keys(f.sample.previews).length ? "sample" : "none yet",
    };
  }

  bb.cli.register({
    name: "festival",
    summary: "Load your Spotify taste into the festival planner, and inspect its festivals",
    commands: [
      { name: "list", summary: "List the installed festivals", usage: "bb festival list [--json]" },
      { name: "status", summary: "Show each festival's folder and whose taste it's using", usage: "bb festival status [--festival <slug>] [--json]" },
      { name: "export", summary: "Print a festival's lineup, theme, taste, or previews JSON", usage: "bb festival export <lineup|theme|taste|previews> [--festival <slug>]" },
      { name: "import", summary: "Replace a festival's taste or previews with your own JSON, in parts if it's large", usage: "bb festival import <taste|previews> <json> [--festival <slug>] [--part <i>/<n>] [--base64]" },
      { name: "reset", summary: "Clear your taste for a festival", usage: "bb festival reset [taste|previews|all] [--festival <slug>]" },
    ],
    async run(argv) {
      const [command, ...args] = argv;
      const json = args.includes("--json");
      try {
        if (command === "list") {
          const rows = festivals.map((f) => ({ slug: f.slug, festival: `${f.lineup.festival.name} ${f.lineup.festival.year}`, dates: `${f.lineup.festival.days[0].date} – ${f.lineup.festival.days.at(-1)?.date}` }));
          return { exitCode: 0, stdout: json ? JSON.stringify(rows) : rows.map((r) => `${r.slug}\t${r.festival}\t${r.dates}`).join("\n") };
        }
        if (command === "status") {
          const chosen = args.includes("--festival") ? [pick(args).festival] : festivals;
          const rows = await Promise.all(chosen.map(status));
          if (json) return { exitCode: 0, stdout: JSON.stringify(args.includes("--festival") ? rows[0] : rows) };
          return { exitCode: 0, stdout: rows.map((row) => Object.entries(row).map(([key, value]) => `${key}\t${value}`).join("\n")).join("\n\n") };
        }
        if (command === "export") {
          const { festival, rest } = pick(args);
          const kind = rest[0];
          if (kind !== "lineup" && kind !== "theme" && !isPersonal(kind)) return { exitCode: 1, stderr: USAGE };
          return { exitCode: 0, stdout: JSON.stringify((await current(festival))[kind]) };
        }
        if (command === "import") {
          const { festival, rest } = pick(args);
          const [kind, ...more] = rest;
          if (!isPersonal(kind)) return { exitCode: 1, stderr: USAGE };
          const at = more.indexOf("--part");
          const part = at >= 0 ? more[at + 1] : undefined;
          const base64 = more.includes("--base64");
          const text = more.filter((arg, i) => arg !== "--base64" && (at < 0 || (i !== at && i !== at + 1))).join(" ");
          if (!text) return { exitCode: 1, stderr: USAGE };
          const result = await importPart(festival, kind, text, part, base64);
          return { exitCode: 0, stdout: result.message + (result.done ? ". Reload its page to see it." : "") };
        }
        if (command === "reset") {
          const { festival, rest } = pick(args);
          const target = rest[0] ?? "all";
          if (target !== "all" && !isPersonal(target)) return { exitCode: 1, stderr: USAGE };
          const kinds = target === "all" ? PERSONAL_NAMES : [target];
          for (const kind of kinds) await kv.delete(kvKey(festival.slug, kind));
          return { exitCode: 0, stdout: `cleared your ${kinds.join(" and ")} for ${festival.lineup.festival.name} ${festival.lineup.festival.year}` };
        }
        const help = command === undefined || command === "--help" || command === "-h";
        return { exitCode: help ? 0 : 1, stdout: USAGE };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
