import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin, { artistsSchema, lineupSchema, loadFestivals, themeSchema } from "./server";

const run = promisify(execFile);

function host() {
  const { bb, harness } = createFakePluginHost({ pluginId: "festival-planner" });
  plugin(bb);
  return harness;
}

const [first] = loadFestivals();
const festival = first.lineup.festival;
const hasSample = existsSync(`festivals/${first.slug}/sample-taste.json`);

async function served(harness: ReturnType<typeof host>, name: string) {
  const res = await harness.behavior.fetchHttp("GET", `/${first.slug}/data/${name}.js`);
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;$/, ""));
}

const taste = { user: { name: "Sam" }, matches: { robyn: { score: 90, tier: "heavy", known: true, evidence: [], riyl: [], topTrack: null, url: null, img: null } } };
const on = ["--festival", first.slug];

describe("festival planner server", () => {
  it("serves each festival folder at its own address, with the sample taste until you import yours", async () => {
    const harness = host();
    expect((await harness.behavior.fetchHttp("GET", `/${first.slug}/index.html`)).status).toBe(200);
    expect((await served(harness, "lineup")).festival.name).toBe(festival.name);
    expect(typeof (await served(harness, "theme")).css).toBe("boolean");
    expect(typeof (await served(harness, "artists"))).toBe("object");
    expect(JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout).map((f: { slug: string }) => f.slug)).toContain(first.slug);
    expect(JSON.parse((await harness.behavior.runCli(["status", ...on, "--json"])).stdout)).toMatchObject({ festival: `${festival.name} ${festival.year}`, taste: hasSample ? "sample" : "none yet" });

    const data = Buffer.from(JSON.stringify(taste)).toString("base64");
    const half = Math.ceil(data.length / 2);
    expect((await harness.behavior.runCli(["import", "taste", ...on, "--base64", "--part", "1/2", data.slice(0, half)])).exitCode).toBe(0);
    expect((await harness.behavior.runCli(["import", "taste", ...on, "--base64", "--part", "2/2", data.slice(half)])).stdout).toContain("saved taste");
    expect((await served(harness, "taste")).user.name).toBe("Sam");

    await harness.behavior.runCli(["reset", ...on]);
    expect((await served(harness, "taste")).user.name).not.toBe("Sam");
    await harness.lifecycle.dispose();
  });

  it("refuses data that would break the page and keeps what was there", async () => {
    const harness = host();
    const before = await served(harness, "taste");
    const bad = await harness.behavior.runCli(["import", "taste", ...on, JSON.stringify({ user: { name: "x" } })]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("matches");
    expect((await harness.behavior.runCli(["import", "taste", ...on, "{not json"])).stderr).toContain("not valid JSON");
    expect((await harness.behavior.runCli(["import", "taste", ...on, "--part", "2/2", "{}"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["import", "lineup", ...on, "{}"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["import", "toString", ...on, "{}"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["export", "lineup", "--festival", "nowhere-1999"])).stderr).toContain('no festival "nowhere-1999"');
    expect(await served(harness, "taste")).toEqual(before);
    await harness.lifecycle.dispose();
  });

  it("every example's lineup and theme are valid", () => {
    for (const slug of readdirSync("examples")) {
      expect(lineupSchema.safeParse(JSON.parse(readFileSync(`examples/${slug}/lineup.json`, "utf8"))).success, `${slug} lineup`).toBe(true);
      expect(themeSchema.safeParse(JSON.parse(readFileSync(`examples/${slug}/theme.json`, "utf8"))).success, `${slug} theme`).toBe(true);
      if (existsSync(`examples/${slug}/artists.json`)) expect(artistsSchema.safeParse(JSON.parse(readFileSync(`examples/${slug}/artists.json`, "utf8"))).success, `${slug} artists`).toBe(true);
    }
  });

  it("accepts a partial theme and refuses typos", () => {
    expect(themeSchema.safeParse({ copy: { plan: "YOUR ROUTE", tiers: { wild: { stamp: "SEEDLING" } } }, style: { shape: "soft" } }).success).toBe(true);
    expect(themeSchema.safeParse({ style: { shape: "round" } }).success).toBe(false);
    expect(themeSchema.safeParse({ colours: {} }).success).toBe(false);
    expect(themeSchema.safeParse(JSON.parse(readFileSync(`festivals/${first.slug}/theme.json`, "utf8"))).success).toBe(true);
  });
});

describe("template scripts", () => {
  const scripts = "skills/festival-planner/scripts";

  it("build-lineup fills in ids and handles sets past midnight", async () => {
    const dir = await mkdtemp(join(tmpdir(), "festival-lineup-"));
    try {
      const file = join(dir, "lineup.json");
      await writeFile(file, JSON.stringify({
        festival: { name: "Night Garden", year: 2027, timeZone: "America/New_York", doors: "16:00", close: "02:00", days: [{ id: "fri", label: "FRI", date: "2027-06-04" }] },
        stages: [{ id: "main", name: "Main Stage" }, { id: "grove", name: "The Grove", icon: "tent" }],
        sets: [
          { name: "Late Night DJ", day: "fri", stage: "grove", start: "23:30", end: "01:30" },
          { name: "Opening Act", day: "fri", stage: "main", start: "16:30", end: "17:30" },
        ],
      }));
      await run("node", [`${scripts}/build-lineup.mjs`, file]);
      const first = await readFile(file, "utf8");
      const out = JSON.parse(first);
      expect(out.festival.code).toBe("NIG-27");
      expect(out.stages.map((s: { short: string; icon: string }) => [s.short, s.icon])).toEqual([["MAIN", "stage"], ["GROVE", "tent"]]);
      expect(out.walk).toEqual({ "grove|main": 5 });
      expect(out.sets.map((s: { id: string; pos: string; start: number; end: number }) => [s.id, s.pos, s.start, s.end])).toEqual([
        ["opening-act-fri", "A1", 990, 1050],
        ["late-night-dj-fri", "A2", 1410, 1530],
      ]);
      await run("node", [`${scripts}/build-lineup.mjs`, file]);
      expect(await readFile(file, "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("new-festival and brand give each festival its own sidebar entry, and leave out one that won't load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "festival-brand-"));
    try {
      await run("cp", ["-r", "festivals", "examples", "package.json", dir]);
      expect((await run("node", [`${scripts}/new-festival.mjs`, "Bad Name", dir]).catch((e) => e)).code).toBe(1);
      await run("node", [`${scripts}/new-festival.mjs`, "acl-2026", dir]);
      await run("node", [`${scripts}/new-festival.mjs`, "night-garden-2027", dir]);
      const lineup = JSON.parse(await readFile(join(dir, "festivals", "night-garden-2027", "lineup.json"), "utf8"));
      expect(lineup.festival).toMatchObject({ name: "Night Garden", year: 2027 });
      const unbuilt = await run("node", [`${scripts}/brand.mjs`, dir]).catch((e) => e);
      expect(unbuilt.code).toBe(1);
      expect(unbuilt.stderr).toContain("night-garden-2027: lineup.json");
      const index = JSON.parse(await readFile(join(dir, "festivals", "index.json"), "utf8"));
      expect(index.map((f: { slug: string }) => f.slug)).toEqual([...loadFestivals().map((f) => f.slug), "acl-2026"].sort());
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      expect(pkg.bb.name).toBe("Festival Planner");
      expect(pkg.bb.branding.experimental_icons.festival).toBe("./assets/icon.svg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a festival folder that won't load is skipped and the rest still serve", async () => {
    const dir = await mkdtemp(join(tmpdir(), "festival-skip-"));
    try {
      await run("cp", ["-r", `examples/${first.slug}`, join(dir, "good")]);
      await run("cp", ["-r", `examples/${first.slug}`, join(dir, "bad-theme")]);
      await writeFile(join(dir, "bad-theme", "theme.json"), JSON.stringify({ colours: {} }));
      await run("cp", ["-r", `examples/${first.slug}`, join(dir, "bad-json")]);
      await writeFile(join(dir, "bad-json", "lineup.json"), "{");
      const skipped: string[] = [];
      expect(loadFestivals((message) => skipped.push(message), dir).map((f) => f.slug)).toEqual(["good"]);
      expect(skipped.join("\n")).toContain("festivals/bad-theme: bad-theme/theme.json doesn't match");
      expect(skipped.join("\n")).toContain("festivals/bad-json: bad-json/lineup.json is not valid JSON");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
