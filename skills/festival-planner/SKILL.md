---
name: festival-planner
description: Set up festivals in the festival planner bb plugin (lineup, look, name) and make each schedule someone's own from their Spotify. Use when someone asks to set up, add, restyle, remove, or personalize a festival in their festival planner.
---

The planner is a bb plugin built from a template. One install holds any number of festivals; each gets its own sidebar entry named after it, its own look, and its own taste. Two kinds of data, kept apart:

- **Festivals** are folders, `festivals/<slug>/`, in the person's copy of the template: lineup, theme, signature styles, icon. You edit them and reinstall.
- **Taste** (their Spotify scores) lives in bb's plugin storage, one per festival, never in a folder. You load it with `bb festival import`.

Field-by-field formats are in [reference.md](reference.md). Scripts are in `scripts/` next to this file and need Node 20+; below, `$S` means that folder, which is `skills/festival-planner/scripts` inside a copy.

Tell them up front what the whole job involves: for a festival in `examples/`, under half an hour, most of it reading their Spotify; for a new one, an hour or two, mostly finding set times and designing the look. Check in with them at the three marked points rather than at the end.

**Do what you can; walk them through the rest.** They may never have used bb or a terminal. Do every step you can yourself, and say what you're about to install or change before you do it. When only they can do something (click a system dialog, sign in, approve a prompt, choose), give one short numbered instruction at a time, say exactly what they'll see, and wait for them to say it's done before the next one.

## 0. Get ready

**Node first.** bb's own command line (`bb …`) is a Node script, and the bb app doesn't put Node on the PATH, so check `node -v` before any `bb` command. If it's there and 22.19 or later (bb's minimum), move on. Otherwise tell them you're installing Node into their home folder, just for them, with no password, and run:

```sh
os=$(uname -s | tr A-Z a-z); arch=$(uname -m | sed "s/x86_64/x64/;s/aarch64/arm64/")
base=https://nodejs.org/dist/latest-v24.x; tmp=$(mktemp -d)
curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/sums" && file=$(grep -o "node-v[0-9.]*-$os-$arch.tar.gz" "$tmp/sums") \
  && curl -fsSL "$base/$file" -o "$tmp/$file" && (cd "$tmp" && grep " $file\$" sums | shasum -a 256 -c -) \
  && mkdir -p ~/.local/node && tar -xzf "$tmp/$file" -C ~/.local/node --strip-components 1 && rm -rf "$tmp"
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zprofile   # ~/.profile on Linux
```

It's the official build from nodejs.org, checked against its published checksum; no Homebrew or admin rights needed. Your shell may not keep the PATH between commands, so start each command with `export PATH="$HOME/.local/node/bin:$PATH";` for the rest of the job.

**Their copy.** If `bb festival status` works, it shows each festival's folder; if those are in a copy they own, work there. Otherwise make one at `~/festival-planner`:

- With git: `git clone https://github.com/brsbl/festival-planner ~/festival-planner`. On a Mac, check `xcode-select -p` before using git: when it fails, git isn't really installed, and running `git` opens a system dialog.
- Without git, download it instead; nothing to click:
  ```sh
  mkdir -p ~/festival-planner && curl -fsSL https://github.com/brsbl/festival-planner/archive/refs/heads/main.tar.gz | tar -xz -C ~/festival-planner --strip-components 1
  ```
  Install git only if they want their copy on GitHub. Walk them through it: run `xcode-select --install`; they'll see a dialog asking to install the command line developer tools; they click **Install**, then **Agree**, and wait a few minutes for it to finish. Then have them click **Use this template** on the repository and clone theirs.

Then `cd ~/festival-planner && npm install --ignore-scripts`. bb builds the plugin from this folder and needs its packages there; `--ignore-scripts` skips building the test tools, which would need Xcode's compilers. Run everything on the machine bb's server runs on, because `path:` installs are read there.

**Browser automation.** Steps 1 and 2 use `bb browser-automation`. If `bb browser-automation --help` fails, run `bb plugin install builtin:browser-automation --yes`, then `bb plugin enable browser-automation` if it's still off. It installs its own browser runtime with the `npm` bb started with; if it says npm is missing because you just installed Node, ask them to quit bb (bb menu → Quit, or ⌘Q) and open it again, then continue in this thread.

The template installs `festivals/portola-2026` so there's something to see. When you set up their first festival and they didn't ask for Portola, delete `festivals/portola-2026`; it's kept in `examples/`.

## 1. Add a festival

```sh
node $S/new-festival.mjs <slug>          # e.g. coachella-2026; starts festivals/<slug>/
```

`examples/` holds finished festivals (Austin City Limits, Portola, Coachella, Bonnaroo, and Outside Lands 2026). When the slug matches one, `new-festival` copies it, and you can skip to **Install**. Check its source first: if the festival hasn't happened yet, compare with the official schedule for late changes. Otherwise read one or two examples before you start; they show what a finished lineup, theme, and `style.css` look like.

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
- **Weekends.** A festival with two weekends can have both: give each its own day ids and labels, as `examples/acl-2026` does. Ask whether they want one weekend or both.

Then `node $S/build-lineup.mjs festivals/<slug>/lineup.json` fills in ids and catalogue numbers in place. Fix what it reports. Set each stage's `short` label yourself; the automatic one just cuts the name.

With no venue map to work from, leave out `festival.map`, place the stages roughly, estimate walks from distances, and tell them those are guesses.

### Artist photos

Look up every act on Spotify so the page has photos and links before anyone connects their account. This works signed out, in a headless session (`bb browser-automation open --backend local --headless --machine <host>`; its page is `main`):

```sh
node $S/spotify.mjs <work> --session <id> --only artists --lineup festivals/<slug>/lineup.json
node $S/photos.mjs <work> festivals/<slug> [--skip "<act>"]    # skip acts matched to the wrong artist
```

Use the same `<work>` folder in step 2, so you don't look the acts up twice.

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

**Spotify.** Say what you'll read: their liked songs, and their top artists and tracks for the last month, six months, and all time. Then use the first of these that fits. Every way except playlists needs the bb desktop app.

- **bb's browser is already signed in.** Ask them to open a browser tab in bb and go to open.spotify.com. If they see their library, use that tab.
- **Copy their everyday browser's sign-in (the usual way).** Most people are already signed in to Spotify in Chrome, Arc, Brave, Edge, Firefox, or Safari. Before asking, tell them plainly: this copies *every* cookie in that browser profile into bb's browser, not only Spotify's, so bb's browser will be signed in wherever that browser is. If they'd rather not, use the next option. Then, one step at a time:
  1. You run `bb browser instances --host <host>` for the window's `--instance` and `--generation`, then `bb browser import-sources --host <host> --instance <id> --generation <gen>`, which lists the browsers and profiles it can copy from. Ask which one they use for Spotify if there's more than one.
  2. They quit that browser completely (its menu → Quit, or ⌘Q; closing the window isn't enough). The copy refuses while it's running.
  3. You run `bb browser import-cookies --host <host> --instance <id> --generation <gen> --from <source> --profile <dir>`. Tell them what will pop up first: for Chrome, Arc, Brave, or Edge, macOS asks for their login password to let bb read that browser's "Safe Storage" key in Keychain, and they click **Allow**. Firefox asks nothing. Safari needs Full Disk Access: walk them through System Settings → Privacy & Security → Full Disk Access, turning on bb, then run it again.
  4. They open a browser tab in bb and go to open.spotify.com. Ask them to confirm they see their library, not a sign-in button. They can reopen their own browser now.
- **Sign in once in bb's browser.** Ask them to open a browser tab in bb, go to open.spotify.com, click **Log in**, and tell you when they see their library.
- **Public playlists, no sign-in.** Ask for public playlists that sound like them: their own, or Liked Songs copied into a playlist. A few hundred songs is enough; a single editorial playlist isn't. Use a headless session (`bb browser-automation open --backend local --headless --machine <host>`), whose page is `main`. This is the only way when they use bb on the web or a phone.
- **No Spotify.** Run only `--only artists`, ask which acts and artists they love, and record it in `lanes.json` with `pin` and `told`.

With a signed-in tab, hand it to a desktop automation session; the `browser-automation` skill covers `--backend desktop … --tab <tab-id>`. Get the page name with `bb browser-automation pages <session>`.

`<work>` is a scratch folder outside any repository, one per festival (e.g. `~/festival-work/<slug>`). Browser sessions close after 5 idle minutes or 30 in total, so run this right after opening one:

```sh
node $S/spotify.mjs <work> --session <id> --festival <slug> [--page <name>] [--playlist <url> …]
```

With a few hundred acts it can take up to 15 minutes. It reads their songs and each act's Spotify page into `<work>/spotify/`. When they're signed in, it also reads what they actually play: their top artists and top tracks for the last month, six months, and all time (`top.json`). These count alongside likes, so an artist they play constantly but never liked still ranks. Then it lists acts it couldn't find, inexact matches, and same-name artists with under 1,000 listeners. Check each one:
- a hit with a different name is ignored automatically, unless it's only a typo or accent away. Signed in, Spotify's search falls back to artists they play, and a guess like that would hand an unrelated act their listening. The profile marks these as `IGNORED`;
- a same-name artist that's the wrong one goes in `skip` in `lanes.json`;
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

**On their phone, if they want it.** `bb connect status` shows whether remote access is on. If it isn't, walk them through it: in bb, open **Settings → Remote access** and follow it to sign in and pick a handle. Then they open `https://<handle>.getbb.app` on their phone and pick the festival in the sidebar. bb has to stay open on the computer.

## Later

- **Another festival:** step 1 again, in the same copy. Existing festivals and tastes stay.
- **Change one:** edit its folder, then `npm run brand` and reinstall.
- **Remove one:** `bb festival reset --festival <slug>` to drop its taste, then delete its folder, `npm run brand`, and reinstall.
- **Redo a taste:** `bb festival reset taste --festival <slug>`, then step 2.
