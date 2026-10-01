#!/usr/bin/env node
// Loads out/taste.json and out/previews.json (whichever exist) into the installed planner
// with `bb festival import`, in parts small enough for a command line.
//
//   node import.mjs <work> [--festival <slug>]      --festival is needed when more than one is installed
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
const at = process.argv.indexOf("--festival");
const festival = at >= 0 ? ["--festival", process.argv[at + 1]] : [];
if (!work) {
  console.error("usage: node import.mjs <work>");
  process.exit(1);
}
const PART = 48_000;
let any = false;
for (const kind of ["taste", "previews"]) {
  const file = join(work, "out", `${kind}.json`);
  if (!existsSync(file)) continue;
  any = true;
  const data = Buffer.from(JSON.stringify(JSON.parse(readFileSync(file, "utf8")))).toString("base64");
  const parts = Math.ceil(data.length / PART);
  for (let i = 0; i < parts; i++) {
    const out = execFileSync("bb", ["festival", "import", kind, ...festival, "--base64", "--part", `${i + 1}/${parts}`, data.slice(i * PART, (i + 1) * PART)], { encoding: "utf8" });
    if (i === parts - 1) process.stdout.write(out.endsWith("\n") ? out : out + "\n");
  }
}
if (!any) {
  console.error(`nothing to import: run the build scripts first (looked in ${join(work, "out")})`);
  process.exit(1);
}
