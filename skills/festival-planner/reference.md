# Festival planner reference

Formats for a festival folder, `festivals/<slug>/`, and for `lanes.json`. `festivals/portola-2026` uses nearly every field and is the best example.

## Folder

| File | Holds |
| --- | --- |
| `lineup.json` | The festival, its stages, walking times, and every set |
| `theme.json` | Style switches, colours, fonts, and wording |
| `style.css` | The festival's signature, loaded after the planner's own styles |
| `assets/` | Images and fonts for `style.css`, used as `url(assets/<file>)` |
| `icon.svg` | The sidebar icon: one colour, lines, `currentColor` |
| `sample-taste.json`, `sample-previews.json` | Optional demo listener shown until someone imports a taste |

## Lineup

```json
{
  "festival": { "name": "Outside Lands", "year": 2026, "venue": "Golden Gate Park", "timeZone": "America/Los_Angeles",
    "source": "sfoutsidelands.com", "doors": "11:00", "close": "22:00",
    "days": [{ "id": "fri", "label": "FRI", "date": "2026-08-07" }] },
  "stages": [{ "id": "lands-end", "name": "Lands End", "icon": "stage", "x": 0.2, "y": 0.6 }],
  "walk": { "lands-end|sutro": 9 },
  "sets": [{ "name": "Some Act", "day": "fri", "stage": "lands-end", "start": "20:30", "end": "22:00", "tags": ["indie"], "artists": ["Some Act"] }]
}
```

**Festival**
- **Hours.** `doors` is when the first set starts and `close` when the last ends. A `close` earlier than `doors` means after midnight (`"06:30"` for an all-nighter). A day with different hours gets its own `doors`/`close`.
- `source` is shown in the footer. `code` (optional) is the catalogue prefix, like `"CCH-26"`.
- `map` (optional) is drawn in a 620×330 box:
  - `title`: the section name;
  - `ground`: an SVG path;
  - `water`: a list of `[x, y, w, h]`;
  - `labels`: a list of `[x, y, text]`;
  - `paths`: pairs of stage ids to draw walking lines between.

  There's no rotation, so draw it the way people orient themselves on site.

**Stages**
- `icon`: one of `stage`, `tent`, `pier`, `crane`, `warehouse`, `ship`, or `ball`.
- `x`/`y` (0–1) place the stage's centre on the map: 0 is the left or top edge and 1 the right or bottom, inside a 30-unit margin of the 620×330 box (so x=0.5 is at 310). `map` labels and water use the box's units directly. Boxes are 96×40, or 150×46 with `wide: true`; check the preview for overlaps.
- `short`: a label of at most 5 characters, for the walking table and now bar.
- `ambient: true` marks a drop-in stage: an all-day room, bingo, screenings. The plan only sends you there when nothing better is on, and its acts' scores are capped at 55.

**Walk** gives minutes between pairs of stages, estimated from the venue map. Pairs you leave out count as 5.

**Sets**
- **Times.** `start`/`end` are `"HH:MM"`. After midnight, use `"00:30"` or `"24:30"`. A start more than 3 hours before its day's doors counts as after midnight.
- `artists`: who to look up on Spotify, for b2b sets, duos, and aliases. Defaults to the set name; `[]` means don't look it up (drag shows, bingo, talks). An act with two sets can list different artists for each, and all of them are looked up.
- Optional: `qualifier` (shown small, e.g. `"DJ Set"`), `billing` (the poster's full name), `blurb` (one line), `tags`. The tag `"?"` shows as "unverified".
- `build-lineup.mjs` fills in `id`, `cat`, and `pos`. Running it again changes nothing.

## Theme

Anything left out falls back to a plain, neutral planner (`public/defaults.js`), never to Portola.

**`style`**

| Switch | Values | What it changes |
| --- | --- | --- |
| `shape` | `print`, `soft`, `flat` | Offset shadows, tilt, and xerox edges; rounded with no tilt; square and clean |
| `wordmark` | `tiles`, `solid`, `outline` | Knockout letter tiles, plain letters, or outlined letters |
| `photos` | `duotone`, `color`, `mono` | Duotone uses the theme's ink and paper |
| `rules` | `dashed`, `solid`, `dotted`, `none` | Lines between rows |
| `meter` | `bars`, `dots`, `number` | Match score display |
| `marker` | `highlighter`, `underline`, `none` | How picked acts are marked |
| `case` | `upper`, `natural` | Act names |
| `catalog` | `on`, `off` | Record-style numbers (A1, PRT-26-001) |
| `numbers` | `on`, `off` | "01 /" before section names |
| `ticker` | `true`, `false` | Scrolling band of top acts |
| `alternate` | `true`, `false` | Every third act name in the serif font |

**Colours.** Both `day` and `night` need at least:
- `ink`: text;
- `paper`: background;
- `highlighter` and `alert`: accents;
- `knock-bg`/`knock-fg`: wordmark tiles, plus picked grid sets and the now bar at night.

`ink-70`, `ink-50`, `ink-30`, `ink-deep`, `paper-2`, `paper-3`, `black`, `grey`, and `cream` are mixed from ink and paper unless you set them. `spotify` is the link underline.

**Fonts.**
- Roles: `display`, `body`, `mono`, `hand`, plus optional `serif` (defaults to display) and `wordmark` (the festival name).
- `google` holds the matching Google Fonts query; only Google Fonts load.
- The layout narrows `display` text to 68–112% width at weights 800–900. Pick a family with a `wdth` axis (Archivo, Anybody, Bricolage Grotesque, Fredoka) and request its full range. A rounded family that stops at 700 is fine.

**Portola motifs**, all off by default:
- `texture`: copier grain;
- `wordmark.ball`: a disco ball for the first O;
- `skyline`: `port`.

`wordmark.case` (`upper`, `lower`, `as-is`) sets how the festival name is written.

**`copy`** holds the wording. Placeholders: in `title`, `{name}` is the festival name in lower case, `{Name}` as written, and `{year}` the year. In `compiledFor`, `{name}` is the person's name. `side` takes `{letter}` (A, B…) or `{n}` (1, 2…).

| Key | Where it shows |
| --- | --- |
| `title` | Browser tab |
| `side` | Day prefix (`{letter}` or `{n}`) |
| `taste`, `top`, `plan`, `catalog` | Section names |
| `map` | Map section name (overrides `festival.map.title`) |
| `list`, `grid` | Plan view toggles |
| `lightsOff`, `lightsOn` | Day/night toggle |
| `linerNotes`, `credits` | Catalogue detail headings |
| `compiledFor` (`{name}`), `sampleTaste`, `noTaste` | Header line |
| `footer` | Footer |
| `live`, `now`, `sep` | Playing-set badge, grid now line, ticker separator |
| `tiers.heavy`, `deep`, `wild`, `new` | Each with `stamp`, `filter`, and `hint` |

## Signature: style.css

- **Hooks.**
  - Masthead: `.mast`, `.mast__meta`, `.wordmark`, `.knock` (each letter), `.yearstack`, `.label` (day buttons), `.chip`.
  - Sections: `.sect`, `.sect__head`, `.ticker`, `.shelf` / `.sleeve` (top 4).
  - Plan: `.row`, `.row__name .nm`, `.stamp`, `.meter`.
  - Grid: `.gridv__head`, `.gridv__col`, `.gbox`.
  - Everything else: `.irow` (catalogue), `.nowbar`, `.map`, `.walktable`, `.foot`, `.foot__body`.
- **Per stage.** Plan rows, grid columns and boxes, catalogue rows, and map stages carry `data-stage="<stage id>"`.
- **Modes and switches.** Night is `html[data-theme="night"]`, and each style switch is an attribute on `html` (`html[data-shape="soft"]`). Switch rules are fairly specific, so start a selector with `html[data-theme]` when it doesn't take.
- **Gotchas.**
  - `shape: soft` turns `.label`, `.chip`, and other buttons into pills. Set your own `border-radius` if the festival's buttons are squarer.
  - The footer band, `.foot__body`, is `paper` on `ink` by day and `ink` on `paper-2` at night; restyle it if that clashes.
  - A multi-word name groups each word's letters in a `.word` inside `.wordmark`, with a `.gap` between words, so narrow screens break between words.
- **Images.** Put them in `assets/`. SVG previews everywhere; other formats only preview on the same machine.
- **Scope.** Keep to styling rather than layout surgery, and check phone width in both modes.
- **Contrast.** `npm run brand` only checks `theme.json` colours, so check anything you colour here yourself.

## Lanes

`<work>/lanes.json`, keyed by act name in any case:

```json
{ "*": { "lane": 6 }, "robyn": { "lane": 30, "pin": true }, "despacio": { "lane": 15, "cap": 55, "credit": ["lcd soundsystem"] }, "erika b2b sf cowboy": { "lane": 8, "skip": ["Erika"] } }
```

- **`lane` (0–40)** is your judgement of how well the act fits the lanes their library shows, which likes alone can't see:
  - 30 and up: squarely in a lane they love;
  - about 20: adjacent;
  - about 10: a stretch;
  - under 6: not their thing.
- `"*"` sets the default for every act you don't list, which helps with big lineups.
- `pin: true` starts the act marked go, for acts they won't miss.
- `tier: "wild"` flags a stretch worth taking.
- `credit` adds member or alias names that count as liking the act.
- `told` counts songs they say they like that aren't in this data.
- `cap` limits the score.
- `skip` lists Spotify search queries whose match is the wrong artist.
- `why` is a note to yourself about the call. The planner doesn't show it.

The score (0–100) adds three parts:
- songs they've liked by the act, with recent likes counting extra (playlists have no "recent");
- "fans also like" artists already in their likes;
- the lane.
