---
name: festival-planner
description: Set up festivals in the festival planner bb plugin (lineup, look, name) and make each schedule someone's own from their Spotify. Use when someone asks to set up, add, restyle, remove, or personalize a festival in their festival planner.
---

The planner is a bb plugin built from a template. One install holds any number of festivals; each gets its own sidebar entry named after it, its own look, and its own taste. Two kinds of data, kept apart:

- **Festivals** are folders, `festivals/<slug>/`, in the person's copy of the template: lineup, theme, signature styles, icon. You edit them and reinstall.
- **Taste** (their Spotify scores) lives in bb's plugin storage, one per festival, never in a folder. You load it with `bb festival import`.

Field-by-field formats are in [reference.md](reference.md). Scripts are in `scripts/` next to this file and need Node 20+; below, `$S` means that folder, which is `skills/festival-planner/scripts` inside a copy.

Tell them up front what the whole job involves: about an hour, mostly research. Check in with them at the three marked points rather than at the end.

## 0. Find their copy

`bb festival list` shows what's installed and `bb festival status` shows each festival's folder. If those folders are in a copy they own, work there. Otherwise, or if `bb festival` doesn't exist yet:

```sh
git clone https://github.com/brsbl/festival-planner ~/festival-planner && cd ~/festival-planner && npm install
```

If they want it on their own GitHub, have them click **Use this template** on the repository and clone theirs instead. Run everything on the machine bb's server runs on, because `path:` installs are read there.

The template installs `festivals/portola-2026` so there's something to see. When you set up their first festival and they didn't ask for Portola, delete `festivals/portola-2026`; it's kept in `examples/`.

## 1. Add a festival

```sh
node $S/new-festival.mjs <slug>          # e.g. coachella-2026; starts festivals/<slug>/
```

`examples/` holds finished festivals (Portola, Coachella, Bonnaroo, and Outside Lands 2026). When the slug matches one, `new-festival` copies it, and you can skip to **Install**. Check its source first: if the festival hasn't happened yet, compare with the official schedule for late changes. Otherwise read one or two examples before you start; they show what a finished lineup, theme, and `style.css` look like.

### Lineup

Find the official set times and write `festivals/<slug>/lineup.json` (format in [reference.md](reference.md#lineup)).
- **Sources.** Use the festival's own site, app, and set-time graphics first, and cross-check with a second source. Where times disagree, the official ones win.
  - Clashfinder is often the most complete, but its pages are fan-made, and some are early predictions or mock-ups. Check the page's title and date, and trust it only where it agrees with the official poster.
  - Festival sites often embed their schedule from a third-party service; the page's network requests lead to the data.
  - Once a festival is over, its site usually moves on to next year. The Wayback Machine (web.archive.org) has the old pages.
- **Gaps and changes.**
  - Tag an act found in only one source `"?"`.
  - A set with only a start time ends when the next set on that stage starts.
  - Drop-in programming (screenings, bingo, talks, an all-day room) goes on its own stage marked `ambient`. Give non-music acts `"artists": []` so they aren't looked up on Spotify.
  - Drop exact duplicates (the same act and slot listed twice). If a stage's name changes by day, keep one stage and note the partner in each set's `blurb`.
  - Before the festival, keep the published schedule. After it, leave cancelled sets out.
- **Weekends.** For a festival with two weekends, ask which one.

Then `node $S/build-lineup.mjs festivals/<slug>/lineup.json` fills in ids and catalogue numbers in place. Fix what it reports. Set each stage's `short` label yourself; the automatic one just cuts the name.

With no venue map to work from, leave out `festival.map`, place the stages roughly, estimate walks from distances, and tell them those are guesses.

**Check in:** sets, stages, and days, your sources, what you inferred or left out, and anything cancelled.

### Look and language

The planner shouldn't look like Portola or like a generic app; it should look like this festival.
1. **Name the look in one line.** Study the festival's site (fetch its CSS for exact colours and font names), poster, set-time graphics, merch, and photos of the grounds. For example: "golden-hour desert in felt" for Coachella, "candy-coloured farm psychedelia" for Bonnaroo.
2. **Make every choice serve that line.** In `theme.json`, set:
   - the `style` switches (shapes, wordmark, photos, rules, meter, markers);
   - `day` and `night` colours, at least `ink` and `paper` for each;
   - `fonts`, from Google Fonts only; substitute the closest families and say so;
   - `copy`, in the festival's own voice; the defaults are plain, so replace them.
3. **Give it a signature** in `style.css`: the thing a fan would recognise, like a sky behind the masthead, a pattern, a badge, or the stripe. Images and fonts go in `assets/`. Hooks and gotchas are in [reference.md](reference.md#signature-stylecss).
4. **Draw `icon.svg`.** A single-colour line icon for the sidebar.

Look at it as you go. This builds a static copy of the page; open it in a headless browser:

```sh
node $S/preview.mjs festivals/<slug> <out> [--taste <work>/out/taste.json] [--host <machine id>]
```

- **The page.** Open `<out>/index.html?now=<a moment during the festival>` at phone width (390×844). Before there's a taste, the preview makes one up so the plan, ticker, and top 4 have something in them.
- **Screenshots.** Capture day and night (the toggle is `#theme-toggle`), the plan, the grid, the catalogue, the map, and the footer. Up to 4 fit in one run; slow pages need `--timeout 120s`, and a run that times out ends the session.
- **A past festival.** Compare with the site as archived, since the live one may already show next year.
- **Other machines.** If the browser is on another machine, `--host` writes the copy there.

Keep labels short enough for a phone, and check for sideways scrolling.

**Check in:** screenshots beside the festival's own site. If someone could mistake it for Portola, or for a template, keep going.

### Install

```sh
npm run brand                                  # sidebar entries, icons; warns on unreadable colours and fonts that won't load
bb plugin install "path:<copy folder>" --yes   # reinstalling keeps every festival's taste
```

If the planner was installed from git rather than from a copy, run `bb plugin remove festival-planner` before that install. Removing it clears their tastes, so do it before step 2.

## 2. Make it theirs

**Spotify.** Say what you'll read, then offer these in order:

- **Sign in once in bb's browser (default).** Ask them to open open.spotify.com in a bb browser tab and sign in, unless one is already signed in. Hand that tab to a desktop automation session; the `browser-automation` skill covers `--backend desktop … --tab <tab-id>`. Get the page name with `bb browser-automation pages <session>`. No system permissions are needed.
- **Public playlists, no sign-in.** Ask for public playlists that sound like them: their own, or Liked Songs copied into a playlist. A few hundred songs is enough; a single editorial playlist isn't. Use a headless session (`bb browser-automation open --backend local --headless --machine <host>`), whose page is `main`. This is the only way when they use bb on the web or a phone.
- **No Spotify.** Run only `--only artists`, ask which acts and artists they love, and record it in `lanes.json` with `pin` and `told`.
- **Copy an existing sign-in, only if they ask.**
  - `bb browser import-sources --host <host>` lists browsers already signed in to Spotify.
  - They quit that browser, then you run `bb browser import-cookies --host <host> --from <id> --profile <dir>`.
  - macOS will ask them for Keychain or Full Disk Access, so tell them first.

`<work>` is a scratch folder outside any repository, one per festival (e.g. `~/festival-work/<slug>`). Browser sessions close after 5 idle minutes or 30 in total, so run this right after opening one:

```sh
node $S/spotify.mjs <work> --session <id> --festival <slug> [--page <name>] [--playlist <url> …]
```

It takes a few minutes. It reads their songs and each act's Spotify page into `<work>/spotify/`. Then it lists acts it couldn't find, inexact matches, and same-name artists with under 1,000 listeners. Check each one:
- a wrong artist goes in `skip` in `lanes.json`;
- a b2b or renamed act gets `artists` in the lineup, since that's a fact about the festival. While you're fixing those, pass `--lineup festivals/<slug>/lineup.json` to `spotify.mjs` and `build-taste.mjs` so they read the copy rather than the installed lineup, and rerun `spotify.mjs --only artists`. Reinstall once you're done.
- small local acts often have very few listeners, so a low count alone doesn't make a match wrong; check the genre and neighbours.

If a Spotify step fails, read the script. It copies the web player's own requests, so the fix is usually in what it listens for.

**Judge the lanes.** `node $S/build-taste.mjs <work> --festival <slug> --profile` prints their library: top and recent artists. For each act it shows their likes, the "fans also like" artists they've saved, and the match. Write `<work>/lanes.json` from it (format in [reference.md](reference.md#lanes)). Ask which acts they won't miss (`pin`) and what name to show on their page.

**Build and load.**

```sh
node $S/build-taste.mjs <work> --festival <slug> --name "<the name they gave>"
node $S/fetch-previews.mjs <work>      # rerun later to pick up tracks Spotify rate-limited
node $S/import.mjs <work> --festival <slug>
```

**Check in:** have them reload the festival's page, show the top of the ranked list, and ask what looks off. Adjust `lanes.json` and rerun these three. Offer to delete `<work>/spotify` when they're happy; it holds their song list.

## Later

- **Another festival:** step 1 again, in the same copy. Existing festivals and tastes stay.
- **Change one:** edit its folder, then `npm run brand` and reinstall.
- **Remove one:** `bb festival reset --festival <slug>` to drop its taste, then delete its folder, `npm run brand`, and reinstall.
- **Redo a taste:** `bb festival reset taste --festival <slug>`, then step 2.
