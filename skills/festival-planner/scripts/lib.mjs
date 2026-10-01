import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A lineup file you point at, or the installed planner's lineup for --festival <slug>
// (optional when only one festival is installed).
export function loadLineup(file, festival) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const args = ["festival", "export", "lineup", ...(festival ? ["--festival", festival] : [])];
  return JSON.parse(execFileSync("bb", args, { encoding: "utf8", maxBuffer: 64 << 20 }));
}
