# Festival Planner

Customized festival planner, built from your Spotify history. Paste one prompt into [bb](https://getbb.app) and an agent:
- finds the festival's set times;
- themes the planner in the festival's own look;
- ranks every act by how well it fits what you listen to.

You get a plan for each day with walking times between stages, song previews for artists you may not know, and a banner of who's on now vs next for when you're on the grounds.

![Five festivals set up from this template: Austin City Limits, Coachella, Bonnaroo, Outside Lands, and Portola 2026](docs/social-preview.jpg)

## Start

1. **Get bb.** [Download it](https://getbb.app) for a Mac with Apple silicon and open it. On Linux, Windows (through WSL), or an Intel Mac, install it with `npx bb-app@latest` instead.
2. **Start a thread** with Claude Code or Codex, and paste:

   > Set up the festival planner from https://github.com/brsbl/festival-planner for **&lt;festival&gt; &lt;year&gt;**, and make it mine from my Spotify.

New to Claude Code? You need a Claude plan. When bb says **Claude Code not installed**, click **Install Claude Code**. Then sign in once: open a terminal (in bb, **Start terminal**; or the Terminal app), run `claude`, and follow its sign-in. Codex works too, with a ChatGPT plan, if you already have it.

The agent does the rest, and installs what's missing along the way, like Node. When it needs you (to approve a macOS prompt, sign in to Spotify, or pick the acts you won't miss), it asks one step at a time and waits for you. It also checks in with the lineup it found, screenshots of the look, and your ranked acts.

A festival already in **Examples** below takes under half an hour, most of it reading your Spotify. A new one takes an hour or two, mostly finding set times and designing its look. When it's done, open the festival from bb's sidebar.

**Agents:** follow [`skills/festival-planner/SKILL.md`](skills/festival-planner/SKILL.md) from step 0.

**More festivals:** ask *"Add &lt;festival&gt; &lt;year&gt; to my festival planner."* Each gets its own sidebar entry and its own ranking.

### Spotify

The agent reads your liked songs and what you play most (your top artists and tracks for the last month, six months, and all time) in bb's browser. Any of these works:

- **Copy your sign-in** from Chrome, Arc, Brave, Edge, Firefox, or Safari, if you're signed in to Spotify there. You quit that browser while it copies. Chrome, Arc, Brave, and Edge make macOS ask for your password once; Safari needs Full Disk Access for bb. This copies all of that browser's cookies into bb's browser, not just Spotify's.
- **Sign in once** at open.spotify.com in a bb browser tab.
- **Share public playlists** instead, if you'd rather not sign in: your own, or your Liked Songs copied into a playlist.
- **Just tell the agent** the artists you love. It ranks from that, with less to go on.

There's no Spotify app to authorise: `spotify.mjs` reuses the Spotify web player's own (unofficial) requests in bb's browser, and `fetch-previews.mjs` reads Spotify's public song embed pages for preview clips.

Your songs and scores stay in bb's plugin storage on your machine. They're never written into the repository or sent anywhere else.

## Examples

Each of these was set up from this template by an agent following its instructions, from the festival's real set times and its own site and posters. Ask for one by name and it's copied in finished.

| Austin City Limits 2026 | Portola 2026 | Coachella 2026 | Bonnaroo 2026 | Outside Lands 2026 |
| --- | --- | --- | --- | --- |
| ![ACL: outlined wordmark on bubblegum pink with weekend-one and weekend-two day buttons](docs/examples/acl-2026-day.jpg) | ![Portola: photocopied record-zine masthead with a disco-ball O](docs/examples/portola-2026-day.jpg) | ![Coachella: desert sky over orange mountains, palms, and the Ferris wheel](docs/examples/coachella-2026-day.jpg) | ![Bonnaroo: green bubble wordmark over rolling hills and a checkerboard path](docs/examples/bonnaroo-2026-day.jpg) | ![Outside Lands: pink bubble letters over the Golden Gate in fog](docs/examples/outside-lands-2026-day.jpg) |
| ![ACL day plan with both weekends](docs/examples/acl-2026-plan.jpg) | ![Portola day plan with walking times between stages](docs/examples/portola-2026-plan.jpg) | ![Coachella day plan with dot meters and stage colours](docs/examples/coachella-2026-plan.jpg) | ![Bonnaroo day plan with yellow pill markers](docs/examples/bonnaroo-2026-plan.jpg) | ![Outside Lands day plan in ticket-style cards](docs/examples/outside-lands-2026-plan.jpg) |
| ![ACL at night](docs/examples/acl-2026-night.jpg) | ![Portola at night](docs/examples/portola-2026-night.jpg) | ![Coachella at night, with a lit Ferris wheel](docs/examples/coachella-2026-night.jpg) | ![Bonnaroo After Hours in neon](docs/examples/bonnaroo-2026-night.jpg) | ![Outside Lands at night](docs/examples/outside-lands-2026-night.jpg) |

The screenshots use a made-up listener. These are unofficial fan planners, not affiliated with the festivals, and their set times may have changed.

## Use

- **The plan** picks a route through each day. Mark acts ✓ go, ? maybe, or ✕ skip and it replans. **+ more** between stops adds any act.
- **Overlaps** between acts you've marked go show ⇅. Swap to choose who you see first; the times follow.
- **Grid** puts every stage side by side; tap a set to cycle go, maybe, skip.
- **The catalogue** lists every act with its match, why it matched, a Spotify link, and ▶ previews.

**On your phone:** sign bb in to your bb account to turn on remote access, then open `https://<your handle>.getbb.app` on your phone and pick the festival from the sidebar. bb has to stay running on your computer.

## How it's built

`festivals/` holds the festivals you have installed, one folder each; `examples/` holds finished ones to copy. A folder has:

| File | What it holds |
| --- | --- |
| `lineup.json` | Name, dates, hours, stages, walking times, map, and every set |
| `theme.json` | Style switches, day and night colours, fonts, and wording |
| `style.css`, `assets/` | The festival's signature look |
| `icon.svg` | Its sidebar icon |
| `artists.json` | Each act's photo and Spotify link |

`skills/festival-planner/SKILL.md` is the agent's guide, and `reference.md` beside it documents every field. To add a festival by hand:

```bash
node skills/festival-planner/scripts/new-festival.mjs outside-lands-2026   # copies the example, or starts a blank folder
node skills/festival-planner/scripts/build-lineup.mjs festivals/outside-lands-2026/lineup.json
npm run brand                                                                # sidebar entries; checks colours and fonts
bb plugin install "path:$PWD" --yes                                          # keeps every festival's ranking
```

To keep your copy on GitHub, click **Use this template** on this repository.

### Commands

`--festival <slug>` picks a festival when you have more than one.

| Command | What it does |
| --- | --- |
| `bb festival list [--json]` | Installed festivals |
| `bb festival status [--festival <slug>] [--json]` | Each festival's folder and whose taste it's using |
| `bb festival export <lineup\|theme\|taste\|previews>` | Print what's in use |
| `bb festival import <taste\|previews> <json>` | Load a taste; `--part i/n` and `--base64` split large files |
| `bb festival reset [taste\|previews\|all]` | Clear a festival's taste |

### Develop

```bash
npm install
npm run typecheck && npm test
bb plugin install "path:$PWD" --yes
```

The page is plain HTML, CSS, and JavaScript in `public/`. `server.ts` serves it once per festival with that festival's data. `app.tsx` adds a sidebar entry for each festival in `festivals/index.json`, which `npm run brand` writes.
