# Festival Planner

Customized festival planner, built from your Spotify history. Paste one prompt into [bb](https://getbb.app) and an agent:
- finds the festival's set times;
- themes the planner in the festival's own look;
- ranks every act by how well it fits what you listen to.

You get a plan for each day with walking times between stages, song previews for artists you may not know, and a banner of who's on now vs next for when you're on the grounds.

![Five festivals set up from this template: Austin City Limits, Coachella, Bonnaroo, Outside Lands, and Portola 2026](docs/social-preview.jpg)

## Start

1. [Download bb](https://getbb.app).
2. Paste this into a new thread:

```text
Set up the festival planner from https://github.com/brsbl/festival-planner for <festival> <year>, and make it mine from my Spotify.
```

For phone access, keep your computer on and plugged in, with bb open.

**Agents:** follow [`skills/festival-planner/SKILL.md`](skills/festival-planner/SKILL.md) from step 0.

## Spotify

Sign in at [open.spotify.com](https://open.spotify.com) in a bb browser tab when the agent asks. Your data stays on your machine.

## Examples

| Austin City Limits 2026 | Portola 2026 | Coachella 2026 | Bonnaroo 2026 | Outside Lands 2026 |
| --- | --- | --- | --- | --- |
| ![ACL: outlined wordmark on bubblegum pink with weekend-one and weekend-two day buttons](docs/examples/acl-2026-day.jpg) | ![Portola: photocopied record-zine masthead with a disco-ball O](docs/examples/portola-2026-day.jpg) | ![Coachella: desert sky over orange mountains, palms, and the Ferris wheel](docs/examples/coachella-2026-day.jpg) | ![Bonnaroo: green bubble wordmark over rolling hills and a checkerboard path](docs/examples/bonnaroo-2026-day.jpg) | ![Outside Lands: pink bubble letters over the Golden Gate in fog](docs/examples/outside-lands-2026-day.jpg) |
| ![ACL day plan with both weekends](docs/examples/acl-2026-plan.jpg) | ![Portola day plan with walking times between stages](docs/examples/portola-2026-plan.jpg) | ![Coachella day plan with dot meters and stage colours](docs/examples/coachella-2026-plan.jpg) | ![Bonnaroo day plan with yellow pill markers](docs/examples/bonnaroo-2026-plan.jpg) | ![Outside Lands day plan in ticket-style cards](docs/examples/outside-lands-2026-plan.jpg) |
| ![ACL at night](docs/examples/acl-2026-night.jpg) | ![Portola at night](docs/examples/portola-2026-night.jpg) | ![Coachella at night, with a lit Ferris wheel](docs/examples/coachella-2026-night.jpg) | ![Bonnaroo After Hours in neon](docs/examples/bonnaroo-2026-night.jpg) | ![Outside Lands at night](docs/examples/outside-lands-2026-night.jpg) |

## How to use

- Mark acts ✓ go, ? maybe, or ✕ skip and the plan reroutes.
- **Grid** shows every stage; the **catalogue** lists every act with previews.
- **On your phone:** the agent will walk you through how to get this set up on your phone at the end.

## Develop

```bash
npm install
npm run typecheck && npm test
bb plugin install "path:$PWD" --yes
```

Festival file format: [`reference.md`](skills/festival-planner/reference.md).
