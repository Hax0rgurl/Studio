# Agentic Movie Studio — one local movie system

**Agentic Movie Studio accepts an idea or the screenplay already open, then runs one resumable production
over one shared project.** The inherited screenplay parser and breakdown remain the canon; the real
Cork Board and Slate run as connected modules; Ollama supplies the role-scoped creative
work; the Agentic Movie Studio taste layer reviews it; PitchDeck routes approved work to independently
selected still and video providers (with Phosphene as the built-in video adapter); Greenroom
owns durable role assignments, exclusive execution claims, stable crew identity, and the production record.

That sentence is the design, and it has two halves that are easy to confuse:

- **Modules stay whole applications.** A module is not a reimplementation and not a view
  written to look like the original — it is the actual app, its own real frontend, running
  in its own frame inside the shell. Cork Board is its real 4,065-line frontend with a thin
  host-persistence adapter. Slate is its real built renderer with the Electron bridge
  swapped for a shim and a small store-adoption hook.
- **They read and write one project.** Instead of five private stores stitched together by
  loose string ids, every module works on the same project object.

Both halves matter and they are complementary. **Both are now built for Cork Board and
Slate.** They run as independent modules, while a source-validated `postMessage` adapter
maps their native shapes onto the active Agentic Movie Studio draft. See *Honest status* for the remaining
limits; the other five suite apps are not hosted yet and are not required for the core
idea-or-script-to-cut path.

Built and expanded by Abandoned Muse from an Apache-2.0 screenplay-breakdown foundation,
then extended by mounting the other suite apps inside it as modules — the apps themselves,
not ports of them. The original foundation is acknowledged in the README.

---

## The problem the shared project solves

This half is a diagnosis of the old suite, not the original concept — it is why the modules
need a common project underneath them, not why they are modules.

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

## Make a Film — the automated production path

The primary workflow is the **Make a Film** view, not a manual export/import chain.

The execution controller is a durable readiness graph, not a fixed department loop. Deterministic
code derives the only departments whose prerequisites have passed. When more than one department is
ready, the Greenroom-claimed producer agent chooses exactly one from that bounded enum, explains the
handoff, and checkpoints the decision in `S.production.orchestration`. The producer cannot invent a
role, waive a validation or human-review gate, change the chosen model/provider/billing approval, or
write another department's artifact. After every canonical checkpoint the graph is recalculated, so
Resume continues from evidence already saved instead of replaying a memorized checklist.

1. **Idea mode** creates a new Agentic Movie Studio project, asks the director and story editor for the
   creative spine, then saves a duration-aware whole-film plan before screenplay pages exist.
   The writer produces one schema-validated scene at a time and checkpoints each scene so a
   long feature can resume without discarding completed work. The story editor returns as a
   separate claimed Greenroom job, reviews the assembled screenplay without rewriting it, and
   may send only cited scenes back for at most two targeted revision passes. A passing draft is
   installed into the same project and receives the inherited deterministic breakdown. Fountain
   is compatibility for human import/export, not the agent's control format.
2. **Current-script mode** preserves the screenplay already open and starts from its parsed
   scenes. A bundled demo or unrelated draft is never substituted for the user's idea.
3. Department roles fill the existing bibles, Look, coverage and Prompt modules. They do not
   invent parallel project formats.
4. The craft critic and library-wide taste layer review the prompts. Either can request one
   guarded rewrite.
5. PitchDeck asks the production's selected still-image provider for a board frame for every
   prompted shot. If that provider is unavailable, the run records that honestly and stops
   before video admission. The automated movie path never substitutes text-to-video for the
   required reviewed storyboard photograph.
6. Every shot is queued with its stable Studio shot id plus an explicit render attempt.
   Agentic Movie Studio first checkpoints the attempt intent; PitchDeck then persists a pending record.
   The built-in Phosphene adapter embeds its deterministic marker in the job label before submission;
   any external adapter must provide an equivalent durable reconciliation strategy before committing the exact
   `(run, shot, attempt) -> job` receipt. If acceptance cannot be proved, that attempt fails
   safely instead of risking a duplicate; a known failed job can advance to a fresh attempt.
   Queue receipts live in `S.production.jobs`; they are not takes.
7. The resumable poller attaches a take only after the selected provider reports `done`, retaining
   provider/model provenance, the real job id, review receipt, output path and playable loopback media URL.
8. When every clip is complete, PitchDeck assembles them with the existing Pinokio ffmpeg in
   canonical shot order and returns a protected playable final-cut URL. It persists pending
   assembly intent first, renders to a deterministic partial path, atomically renames the final,
   and repairs/reuses the receipt on restart. The same run/order is idempotent rather than
   creating orphan duplicate cuts after a lost response.

`S.production` checkpoints the run, step results, job ids, errors and final cut after every
safe boundary. Closing and reopening Agentic Movie Studio can therefore resume polling instead of starting
the film over. A `starting`/`running` checkpoint whose webview disappeared is converted to an
explicitly resumable pause on launch; rendering/assembly checkpoints restart their known local
services and re-arm the owned poller. Once render receipts exist, the active draft's canonical
graph is read-only until the render is reconciled. Even an expected-shot manifest whose queue
response was lost is locked, because external acceptance may already exist. A render can be
archived for revision: its immutable manifest and receipts move into read-only production
history, while the active execution slot is cleared. The filmmaker can still use Projects to
move to another draft without stranding either production. External queueing and assembly fail
closed if the local project checkpoint cannot be written.

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

An app whose renderer has no privileged dependencies mostly drops in. Cork Board's preload
says it outright — *"Intentionally minimal. Cork Board is fully local-first and needs no
privileged bridge."* Its real UI remains intact; when embedded, a small adapter bypasses the
AVA/private project boot and exchanges its native project shape with Studio.

An app that does use a bridge needs a shim: a script that defines the same global its
preload defined, backed by browser and shell services instead of Electron IPC. Slate's
`window.slate` is 20 methods; `src/modules/slate/slate-shim.js` preserves that API, uses
the Studio project bridge for embedded project persistence, and uses the local model server
for the whole `brain*` family, so Slate's AI runs on Ollama with no API key. Standalone mode
retains Slate's original private local store and byte-compatible project factory.

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

## Review — two reviewers, one rewrite

A prompt can be correct and still be one you would never keep. Those are different
questions, so they get different reviewers, and either one can send a prompt back.

**The craft critic** (`critique`) is a second model reading the prompt against a 19-check
rubric — contiguous timeline, one camera move, canon-locked, present tense, no negatives.
It is handed `criticFacts()` first: the findings from `plCanonAudit()` and the timeline
check, already computed in code and marked VERIFIED, so it reports them instead of
re-deriving them and arguing with itself.

**Your eye** (`critiqueTaste`) asks the other question. There is no fine-tuning job here.
Every take you circle or kill in the Takes log is already a labelled preference attached to
the prompt that produced it, so `tasteExamples()` reads deduplicated evidence across the
whole Studio library as few-shot examples. The written taste statement is stored globally
and copied into project state for portability. A `good` rating is skipped on purpose — it is
a shrug, not a signal.

Both are advisory, both can fail without stopping the run, and both write their verdict onto
`shot.prompt` so the judgement travels with the prompt rather than scrolling away.

### The rewrite

`plRun` makes one repair pass, and **either reviewer can call for it** — the critic when the
prompt did not pass, your eye when it named a pattern the prompt breaks. Their notes
(`critiqueToNote`, `tasteToNote`) go into the same regeneration, so one rewrite answers both.

The revision is re-judged on both axes and kept only when:

- the reviewer that asked for it got what it asked for — the craft score did not drop, or
  the taste verdict did not fall in rank (`tasteRank`: keep > maybe > kill); **and**
- neither reviewer fell off its own cliff — a passing prompt may not come back rejected, and
  one you would have kept may not come back killed.

So a taste fix is allowed to cost a craft point or two, and a craft fix is not allowed to
quietly hand back something you would bin. If a re-check fails to parse, that verdict is
stored as null rather than left in place: the old verdict described the old text, and a
stale badge is worse than no badge.

`shot.prompt.revised` records who sent it back — `craft`, `taste`, or `craft+taste`.

## TasteOS evaluation flywheel

Every native text-model request used by the production crew is wrapped in a private, append-only workload record. Studio saves the intent before inference and saves completion, failure, or cancellation before accepting the artifact. Each run carries the exact private prompt, response contract, role skill-book version, TasteOS revision, model configuration, and project/draft/production identity; provider credentials and headers are intentionally absent. Normal snapshots return bounded excerpts, while full replay material stays behind native detail commands.

The TasteOS **Evaluation Lab** replays a completed workload against a user-entered or discovered model ID on the connected local server. It restores the original temperature, context, thinking mode, and structured-output contract for that comparison, then restores the app's active settings. Deterministic checks report objective defects but cannot select a winner. The filmmaker scores both outputs against the current weighted rubric and explicitly selects baseline, candidate, tie, or neither. Even a selected candidate is evidence for future work only; it cannot mutate the active provider/model or an in-flight production.

This is the small local seam inspired by NVIDIA's Data Flywheel pattern. It deliberately does not embed the archived Kubernetes/GPU blueprint, download Nemotron, train on terminal-agent trajectories, or automate deployment. The full decision and source boundaries are in [`docs/decisions/0003-local-evaluation-flywheel.md`](docs/decisions/0003-local-evaluation-flywheel.md).

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

### Future module priority

The five unhosted suite apps are enhancements, not blockers for the automated production
path. Circle Take is the most valuable next integration because its ffprobe, identity,
temporal and anatomy gates can automatically grade generated clips. Storyboard Reference
Studio can add curated references and stronger character continuity. Blockout, Motion Previs
and Stem Studio bring useful specialist tools but also carry the heaviest native dependencies.

## Local services and contracts

Modules are the boxes inside the box. Services are the engines behind it. Studio's native
backend checks and starts only known loopback installs; it does not download replacements or
accept caller-supplied executable paths.

| Service | Port | Responsibility | Current integration |
|---|---:|---|---|
| Ollama | 11434 | script, role work, prompts, critic and taste | direct, required for AI steps |
| PitchDeck | 5179 | provider registry, stable media-job API and ffmpeg assembly | direct, fixed port |
| Phosphene | 8198 | built-in local image/video engine | called through PitchDeck's adapters |
| Greenroom | 8830 | stable role identities and durable production thread | called through native Rust commands |

The media contract is deliberately job-based:

```
GET  /api/media/providers
GET  /api/image/providers
GET  /api/video/providers

POST /api/image/generate
  { providerId, model?, billingApproval?, review, prompt, imageDataUrls?, label, width, height, ... }
  -> { imageDataUrl, outputPath, backend }

POST /api/video/queue-batch
  { providerId, model?, billingApproval?, runId, shots: [{ studioShotId, attempt, prompt, review, imageDataUrl?, ... }] }
  -> { jobs: [{ studioShotId, attempt, id, reused }], errors }

POST /api/video/jobs
  { providerId, ids: [jobId] }
  -> { jobs: [{ id, status, outputPath, error }], missingIds }

GET  /api/video/providers/:providerId/jobs/:id/media
POST /api/video/assemble
  { providerId, runId, ids: [completedJobId in playback order], outputName? }
  -> { ids, outputPath, mediaUrl, bytes, mode, reused }
GET  /api/video/phosphene/assembled/:fileName/media
```

Photo and video providers are separate selections. One adapter may advertise both capabilities,
including an MCP-backed adapter, but Studio never assumes that it does. Provider/model choices are
copied into the run only for restart integrity; switching providers in the middle of one render
manifest is not a workflow. The old Phosphene and mflux URLs remain compatibility routes behind
their built-in adapters. See
[`docs/decisions/0001-extensible-media-providers-and-mcp.md`](docs/decisions/0001-extensible-media-providers-and-mcp.md)
for the adapter, billing, MCP, and taste-boundary decision.

PitchDeck permits only Tauri and loopback browser origins, binds to `127.0.0.1`, preserves
terminal job information while it is running, persists pending/accepted jobs and pending/final
assembly receipts atomically with mode `0600` (including file and directory `fsync`), serves
completed media with Range support, and rejects generated-media path traversal. Studio polls
long productions in bounded chunks; a persisted poll epoch makes Pause invalidate an already
fired status or assembly request without losing its backend receipt; final
assembly accepts up to 5,000 ordered clips. Still generation first uses Phosphene, which supports
zero-reference text-to-image; direct mflux is a discovered fallback for reference-guided
editing. The old hard-coded `~/.local` binary and obsolete model paths are no longer the only
choices.

Greenroom's seeded crew identities are reused instead of minting `role-randomsuffix`
identities in browser storage. One native-only credential broker opens or reuses a tagged
thread for each production, verifies that the thread belongs to the project, and registers a
deterministic host for each exact `(production, role, work)` assignment. The role receives a
self-contained delivery containing its versioned skill book, filmmaker direction, TasteOS
constraints, predecessor evidence, and allowed canonical write. It must claim that delivery
exclusively before Ollama or a media tool runs. Studio acknowledges the delivery only after the
role result passes validation and the canonical project checkpoint succeeds. Lost responses are
recovered by the deterministic host and work ids instead of creating a second role job.
Long jobs renew their exclusive delivery lease every 15 seconds; two consecutive renewal
failures abort model work before Greenroom's 60-second dead-host timeout can assign it elsewhere.
Credentials never enter the webview. Greenroom owns durable work and conversation; Ollama owns
inference; Studio alone owns canonical screenplay, bible, Look, shot, prompt, take, and cut writes.
Fetched message prose remains display-only because a message by itself cannot prove that the active
snapshot contains the corresponding mutation. See
[`docs/decisions/0004-greenroom-agent-work-protocol.md`](docs/decisions/0004-greenroom-agent-work-protocol.md).

The separate project called TasteOS (`Compiled Apps/hackathon-upscale-conf`) is a fixed
Magnific hackathon demonstration with in-memory feedback and no learned model or durable
taste store. Its demo data is not used. Agentic Movie Studio's real library-wide taste evidence and written
statement are the active taste layer.

## Legacy project migration

Agentic Movie Studio has a new bundle id, so WebKit gives it its own localStorage. The prior
Studio build and the new app do not use the same directory:

    ~/Library/WebKit/<prior-bundle-id>/.../LocalStorage/localstorage.sqlite3
    ~/Library/WebKit/com.abandonedmuse.agenticmoviestudio/.../LocalStorage/localstorage.sqlite3

Both are WebKit localStorage with the same `ItemTable(key, value)` schema and the same
`tauri://localhost` origin, so the library copies straight across with both apps closed:

```bash
sqlite3 "$SB/localstorage.sqlite3" "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 "$STUDIO/localstorage.sqlite3" \
  "ATTACH '$SB/localstorage.sqlite3' AS sb;
   INSERT OR REPLACE INTO main.ItemTable (key,value) SELECT key,value FROM sb.ItemTable;"
```

Agentic Movie Studio still reads the legacy `scriptbreak.*` storage keys deliberately, so
migrated data works untouched. Both apps must be closed and the WAL checkpointed before the
active data is moved into the new bundle-id directory.

## Honest status

This is a working integrated vertical slice, not a claim that local generative filmmaking is
solved.

- **The automated path is implemented end to end in code.** Idea and current-script modes,
  same-project parsing, breakdown, role steps, library-wide taste review, all-shot still/video
  dispatch, resumable polling, completed-take ingestion and ordered final-cut assembly are
  connected. Queue ids are never shown as finished clips. Contract and fake-service tests
  exercise the full job/media seam; a long real multi-shot render has not been run as part of
  this implementation pass.
- **Local model readiness is mixed.** Ollama has working local Qwen models and Phosphene's
  LTX/Gemma video weights occupy about 63 GB locally. The discovered Qwen Image Edit tree is
  a 25.39 GB logical iCloud placeholder with 0 bytes allocated, so direct mflux still editing
  reports `hydrated:false`. The pipeline records a skipped still stage and continues through
  stops the automated movie path instead of lying that a frame exists or silently falling
  back to Phosphene text-to-video.
- **Greenroom now owns the crew work lifecycle.** Every department is a registered host with a
  durable delivery, exclusive claim, thread handoff, and post-checkpoint acknowledgment. Studio
  currently acts as the trusted executor while the desktop app is open because canonical project
  state still lives in its WebKit project store. Closing the app preserves the Greenroom delivery
  and Studio work receipt for Resume. A future headless executor can use the same protocol after
  canonical project storage is moved behind a native compare-and-swap broker; it must not bypass
  Studio validation or acknowledge prose as an artifact.
- **The current editor is deterministic assembly.** It concatenates completed clips in shot
  order and preserves any audio already present. It does not yet generate or mix dialogue,
  score, Foley or ambience, and the composer role currently contributes creative direction
  rather than a mastered soundtrack.

- **Two of seven suite apps run as independent modules.** Cards (Cork Board) and Slate are
  the real applications, hosted. Nothing was reimplemented and nothing was dropped from them.
  Circle Take, Storyboard Reference Studio, Blockout, Motion Previs and Stem Studio are the
  five still to come. The other tabs — Script, Elements, Bibles, Look, Timeline, Boards,
  Shot List, Prompts, Takes, Export — are the shell's own native code, inherited from
  ScriptBreak, which is the app Studio was forked from; they were never separate apps to host.
- **Cork Board and Slate now share the active Agentic Movie Studio draft.** The bridge maps canonical cards
  into Cork Board's card map/columns and maps its edits back; linked card title, synopsis,
  status and cast changes update the canonical card, while synopsis and cast stay linked to
  the canonical scene without treating a beat-card title as a screenplay slugline. Slate
  receives the same canonical scenes, shots, specs, prompts and takes, and its edits write
  back to those entities. Module-specific data is retained under `S.moduleState`, inside the
  Studio draft. Messages are accepted only from the expected iframe `contentWindow`; hosted
  modules do not boot AVA or read the old Slate project key. Focused contract tests cover
  both directions. Each inbound update must also carry the exact active draft's module-project
  id, so Cork's debounced save or Slate's delayed save cannot spill into a newly opened draft.
- **The old native Cards editor remains as fallback/import plumbing.** `cardsFromScenes()`
  now seeds missing scene cards for the real Cork Board, and Cork Board imports written to
  `S.cards` appear in the hosted wall. `editCard()` is not the primary UI.
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

Then bundle as `/Applications/Agentic Movie Studio.app` — copy the
`agentic-movie-studio` binary into `Contents/MacOS`, install the generated icon and current
`Info.plist`, run `xattr -cr`, and ad-hoc sign with `codesign --force --deep --sign -`.

Node, if needed for a future frontend build step, lives inside Pinokio:
`export PATH="$HOME/pinokio/bin/miniforge/bin:$PATH"`.

## Licensing

Agentic Movie Studio is Apache-2.0. `LICENSE` and `NOTICE` must travel with every
distribution; the README contains the requested acknowledgment and link to the original
foundation. Required third-party copyright notices remain intact in legal files.
