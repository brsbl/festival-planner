import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A lineup file you point at, or the installed planner's lineup for --festival <slug>
// (optional when only one festival is installed).
export function loadLineup(file, festival) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const args = ["festival", "export", "lineup", ...(festival ? ["--festival", festival] : [])];
  return JSON.parse(execFileSync("bb", args, { encoding: "utf8", maxBuffer: 64 << 20 }));
}

// A Spotify search hit counts only when its name is the act's name, give or take a typo or accent:
// signed in, search falls back to artists you play, which would hand an act your listening.
export function trustedHit(hit) {
  if (!hit.id) return false;
  if (hit.exact) return true;
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const [a, b] = [norm(hit.q), norm(hit.name)];
  if (a.length < 5 || b.length < 5) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
