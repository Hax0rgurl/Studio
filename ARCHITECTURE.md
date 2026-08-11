# Studio — one app, one project, modules on top

**3.5 MB. Replaces roughly 2.1 GB of separate applications.**

Built 2026-08-10 by forking ScriptBreak (Tauri) and pulling the other suite apps'
behaviour in as modules over a shared project.

---

## The problem this solves

The suite was nine applications. Seven of them were Electron, each shipping its own copy
of Chromium — **six different Electron builds across seven apps**, 2.4 GB installed. But
disk was the least of it.

Three separate apps each defined their own `Shot`:

- **ScriptBreak** — size, angle, movement, lens, description
- **Slate** — spec, prompt, variants, prompt history, takes
- **Circle Take** — expected format, character ids, gate verdicts, takes

Circle Take carried this, which is the whole problem written down in one line:

```ts
refs?: { scriptbreakScene?: string; blockoutShot?: string; boardFrame?: string }
```

Three apps trying to re-link the same shot to each other by loose string id, across three
storage formats, with no guarantee any of them agreed. Meanwhile a project wasn't a thing
you could point at — it was a `.scriptbreak` file in Downloads, a Slate folder under
Application Support, and a pile of `Creative_Project_035_storyboard_report.md` in Documents.

Call Sheet existed to launch the nine and scrape their private stores for a recents list.
A launcher for your own suite is a symptom.

## The shape now

One project object. Modules are views over it, not owners of it.

```
project
  ├─ cards[]     an index card; may point at a scene       (was Cork Board)
  ├─ scenes[]    screenplay text, cast, tagged elements    (was ScriptBreak)
  │    └─ shots[]  ONE shot entity, which owns:
  │         ├─ size / angle / move / lens   the spec       (was ScriptBreak)
  │         ├─ prompt                       video prompt   (was Slate)
  │         └─ takes[]                      rated renders  (was Slate + Circle Take)
  ├─ bibles      characters / locations / props
  └─ look        the film's visual language
```

`allShots()` returns every shot with its scene. The Shot List, the Prompt List and the Take
log are three renderers over that one array — which is why a prompt written in one module
shows up on the take in another with no import step, no id mapping, and nothing to keep in
sync. Shots get a stable `id` enforced in `persist()`, so every creation path (auto-coverage,
manual add, AI, import) satisfies the invariant without each one having to remember.

## Modules

Two kinds. Some are **hosted**: the other app's real, built frontend runs inside a pane in
this shell, unmodified. Some are **native**: they render directly against the shared project.

| Module | Came from | Kind | State |
|---|---|---|---|
| Cards | Cork Board | **hosted** | the real app, verbatim — 4,065 lines of `app.js`, cork wall, acts, cast arcs, outline, presets, history, export |
| Slate | Slate | **hosted** | the real app, built from source; its Electron bridge replaced by a shim |
| Script | ScriptBreak | native | fountain/FDX/PDF parsing, scenes, elements |
| Script Doctor | *(new)* | native | local-model rewriting with diffs |
| Elements / Bibles / Look / Timeline | ScriptBreak | native | ported whole |
| Shot List | ScriptBreak | native | ported whole |
| Prompts | *(new)* | native | per-shot Seedance 2.5 / six-block prompts |
| Takes | Slate + Circle Take | native | take log, circling, provenance |
| Export | ScriptBreak | native | packs, CSVs, schedule, DOOD |

### How hosting works

An app whose renderer has no privileged dependencies just drops in. Cork Board's preload
says it outright — *"Intentionally minimal. Cork Board is fully local-first and needs no
privileged bridge."* — so it needed nothing but its files copied and three absolute asset
paths made relative.

An app that does use a bridge needs a shim: a script that defines the same global its
preload defined, backed by browser and shell services instead of Electron IPC. Slate's
`window.slate` is 20 methods; `src/modules/slate/slate-shim.js` implements them against
localStorage (projects) and the local model server (the whole `brain*` family), so Slate's
AI now runs on Ollama with no API key. Its `createProject` returns a byte-compatible
project because the factory is copied from `src/main/projects.ts`.

Capabilities that genuinely needed a Node host — file dialogs, ffmpeg frame extraction,
audio fingerprinting — resolve empty rather than throwing, so the app degrades instead of
white-screening.

One real upstream fix came out of this: Slate's `Home.tsx` gated its "no brain found"
warning on `!claude.available && !codex.available`, ignoring the `local` backend entirely,
so a working local model still showed as missing. Fixed in the fork's source and rebuilt.

### Recipe for the remaining apps

```bash
export PATH="$HOME/pinokio/bin/miniforge/bin:$PATH"
cd <app> && npm install && npm run build      # produces out/renderer or dist
cp -R out/renderer/* Studio/src/modules/<app>/
# then, if it has a preload: write modules/<app>/<app>-shim.js implementing the
# global its preload exposed, and inject it before the app's module script.
# relax the bundled CSP's connect-src if the app talks to a local server.
```

Remaining bridge surfaces, measured: **Circle Take** 43 functions (`window.circletake`,
heavy — ffprobe and gate engine), **Blockout** 26 (`window.blockout`), **Storyboard
Reference Studio** 24 (`window.sbr`), **Stem Studio** 15 (`window.stemstudio`, needs native
audio separation), **Motion Previs** 9 (`window.motionPrevis`, but bundles ffmpeg and depth
backends).

## Import

Open a file and Studio works out what it is:

- `.studio` / `.scriptbreak` → opens as a project
- `.ctake` → Circle Take shots and takes merge into the open project, honouring
  `refs.scriptbreakScene` to land on the right scene
- Slate project JSON → shots with their prompts, specs and takes
- Cork Board export → cards with their columns

So the scattered data comes home rather than being retyped.

## Still to host

**Circle Take**, **Storyboard Reference Studio**, **Blockout**, **Motion Previs Studio** and
**Stem Studio** are not in yet. They are the same job as Slate — build the renderer, write
the shim — but with larger bridges, and three of them (Blockout's 3D, Motion Previs' depth
backends, Stem Studio's audio separation) lean on native binaries that a shim cannot fake.
Those three may end up hosted for their UI while their heavy work stays out of process.

**Sam PDF Studio** is Swift and 6 MB — it is already the cheap thing it should be.

## Migrating from ScriptBreak

Studio has its own bundle id, so WebKit gives it its own localStorage — a fresh install
starts empty even though ScriptBreak is full of projects. They are not in the same place:

    ~/Library/WebKit/com.wasserman.scriptbreak/.../LocalStorage/localstorage.sqlite3
    ~/Library/WebKit/com.wasserman.studio/.../LocalStorage/localstorage.sqlite3

Both are WebKit localStorage with the same `ItemTable(key, value)` schema and the same
`tauri://localhost` origin, so the library copies straight across with both apps closed:

```bash
sqlite3 "$SB/localstorage.sqlite3" "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 "$STUDIO/localstorage.sqlite3" \
  "ATTACH '$SB/localstorage.sqlite3' AS sb;
   INSERT OR REPLACE INTO main.ItemTable (key,value) SELECT key,value FROM sb.ItemTable;"
```

Studio still reads the `scriptbreak.*` storage keys deliberately, so migrated data works
untouched. Back the target up first; checkpoint the WAL or you will copy a stale snapshot.

## Honest status

This is a working v0.1, not a finished replacement.

- Cards and Slate are the real applications, hosted. Nothing was reimplemented and nothing
  was dropped from them.
- Takes is still a native reimplementation of Slate's and Circle Take's take log, not a port.
  Circle Take's automated gates (ffprobe, identity/temporal/anatomy checks) are not here —
  Takes records human verdicts, it does not compute them. Hosting the real Circle Take is the
  next job, and it is the largest shim of the set at 43 functions.
- Slate's file-dialog, still-extraction and audio-analysis features are inert in the shim.
- The importers were written twice. The first pass guessed at the formats and was wrong in
  all three: Slate nests shots inside `scenes[]` rather than at the top level; Circle Take
  uses `circled: boolean` plus a 0-3 `rating`, not a verdict string; Cork Board keys cards in
  a project-level map with columns holding ids. They are now written against the repos' own
  type definitions and exercised against fixtures built from those types — including a
  Circle Take shot whose `refs.scriptbreakScene` correctly routes it to that scene. They have
  still not been run against a large real project.
- The frontend is still one large `src/index.html`. That was right for getting here — zero
  build step, 3.5 MB output — but it is now ~250 KB of app code and the next module should
  come with a split into a bundled multi-file frontend. Node is available (see below).

## Building

```bash
source ~/.cargo/env
cd src-tauri && cargo build --release
```

Then bundle by hand into `Studio.app` (no `tauri-cli` installed) — copy the binary into
`Contents/MacOS/studio`, keep the `Info.plist`, `xattr -cr`, and `codesign --force --sign -`.
`/Applications` is `root:admin` and this user is not in `admin`, so install to
`~/Applications`.

Node, if needed for a future frontend build step, lives inside Pinokio:
`export PATH="$HOME/pinokio/bin/miniforge/bin:$PATH"`.

## Licensing

Fork of Apache-2.0 work by Sam Wasserman. `LICENSE` and `NOTICE` must travel with it.
If the shared project format proves out, the useful thing to send upstream is the format
itself — that is the part that helps the suite whether or not the apps ever merge.
