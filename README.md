# Agentic Movie Studio

Agentic Movie Studio is a local-first macOS filmmaking system that can take an idea or an existing screenplay through breakdown, visual development, shot planning, prompt writing, storyboard generation, video rendering, review, and final assembly.

It is being rebuilt and expanded by **Abandoned Muse** as one connected application rather than a loose collection of tools.

## What it does

- Builds or imports a screenplay and keeps every revision in a local project library.
- Breaks scenes into cast, locations, props, continuity bibles, and planned shots.
- Runs a role-based movie crew with a user-selectable local Ollama model.
- Gives every department a real Greenroom producer handoff and one bounded ChatDev-style peer seminar before it writes or renders; exact requests and replies appear live in Studio Town and the Client Room and enter the agent's canonical evidence packet.
- Loads a researched, versioned skill book for every crew agent and lets the filmmaker inspect the exact manual in the Crew room.
- Maintains a single canonical project across Cards, Script, Boards, Slate, Prompts, and Takes.
- Generates storyboard stills through an independently selected image provider and preserves provider/model provenance on the exact shot.
- Sends the approved storyboard still plus its authored motion prompt to an independently selected video provider; Phosphene is the built-in local option, not a hard-coded ceiling.
- Polls real render jobs and returns the completed clip to the same storyboard card.
- Displays the film shot-by-shot in the Storyboard Movie grid.
- Persists render and assembly receipts so interrupted productions can resume safely.
- Assembles completed shots into an ordered movie through the local PitchDeck bridge.

## Studio Town

Studio Town is a first-class view inside the same macOS application. It places all 23 canonical crew agents on the approved studio map and exposes the production as a readable, explorable town without creating a second simulation state.

- The Canvas playfield draws the validated full-body source sprites with bottom-center anchors; DOM controls beside it keep every role, status, action, and message accessible.
- Agents move only for a real routing, assignment, review, or rework transition. There is no ambient chatter, random wandering, fabricated progress, or decorative completion.
- The open Greenroom panel shows the exact authenticated producer handoffs, peer questions, replies, causal links, and acknowledgments. Sprite talking and travel are derived from those events rather than invented animation.
- Agent status is derived from the active `S.production` checkpoint, Greenroom-backed role work, current model activity, human review, and durable media jobs.
- Clicking an agent opens its exact role, ownership, skill book, current checkpoint, provider, artifact, review controls, and targeted direction box.
- Buildings open the canonical Studio pages they represent. The Production Dashboard remains the operational control surface, and the dedicated Client Room remains the filmmaker’s conversation, approval, and rework surface.
- The checked-in map and 92 sprite frames are reproducibly validated and staged by `script/build_studio_town_assets.mjs`; clipped or edge-touching frames fail the build step.

## Settings

The gear in the top bar opens the one app-wide Settings center. It controls the text-model server and freely selectable model ID, temperature/context, separate storyboard-photo and video providers/models, local service addresses, workflow defaults, and every configuration field declared by an installed trusted media adapter. The same provider state drives the Make a Film dropdowns; there is no second hidden copy.

Model IDs are discovered from the configured Ollama/OpenAI-compatible server and may also be typed directly. Agentic Movie Studio does not compile a preferred model name into the application. Provider secrets are sent only to the loopback PitchDeck gateway, stored in its private settings file, and never returned to the browser or written into an `.ams` project.

## Review and TasteOS

Every department saves its actual canonical artifact into the Client Room. The filmmaker can inspect that work in its native page while production continues, give direction, Keep/Circle/Flag/Revise/Kill an artifact, and queue focused rework. Storyboard prompts receive an independent script-supervisor craft/continuity verdict and a TasteOS verdict before an image provider can be called. Automated video submission requires the real reviewed storyboard photo; it does not silently fall back to text-to-video.

TasteOS is a native, revisioned learning control plane rather than a hidden score. It stores exact human evidence, an editable weighted rubric, scoped learned rules, confidence, locks, and revision history. One reaction stays project-scoped; repeated evidence may promote a rule. Pending changes expose their exact wording, dimension, departments, scope, and lock state for explicit approval or dismissal.

Its **Evaluation Lab** records durable model-work receipts and can replay one completed department workload against any model ID the filmmaker selects on the connected local server. Objective checks and side-by-side outputs are shown before the filmmaker scores both results with the TasteOS rubric. A candidate can be recommended for future work only after that human review; comparisons never switch the current model, provider, API, or film. This adapts the useful evaluation loop from NVIDIA's Data Flywheel work without installing its server/GPU stack or treating terminal-agent data as creative taste. See the [TasteOS decision](docs/decisions/0002-taste-os-learning-control-plane.md) and [local evaluation flywheel decision](docs/decisions/0003-local-evaluation-flywheel.md).

## Local production services

Agentic Movie Studio coordinates four loopback-only services:

- **Ollama** — user-selectable local language and vision models.
- **Greenroom** — durable agent assignments, exclusive claims, stable crew identities, and production conversation. The Studio integration uses the open-source [Greenroom local-model fork](https://github.com/Hax0rgurl/greenroomlocalmodels/tree/codex/agentic-movie-studio-greenroom) and the [durable agent-work protocol](docs/decisions/0004-greenroom-agent-work-protocol.md).
- **Functional seminars** — a bounded adaptation of the open-source [ChatDev 1.0 role-playing phase](https://github.com/OpenBMB/ChatDev/tree/chatdev1.0) carried through real Greenroom deliveries. See the [Greenroom functional-seminar decision](docs/decisions/0005-greenroom-functional-seminars.md).
- **PitchDeck** — the provider registry, media bridge, render receipts, status recovery, and assembly.
- **Phosphene** — the built-in local image-to-video and text-to-video provider.

The application has no hosted account, analytics service, or required cloud model API. Optional trusted adapters can add local engines, paid APIs, or adapter-managed MCP-backed image/video tools; image and video providers are selected separately, model IDs remain user-controlled, and paid calls require explicit approval. Installed adapters expose their endpoint and credential fields in Settings. A universal native MCP discovery/OAuth host and graphical package installer are explicitly not yet turnkey. See the [media-provider and MCP decision](docs/decisions/0001-extensible-media-providers-and-mcp.md).

## Crew skill books

The 23 agent manuals live in [`src/crew-skills`](src/crew-skills). Each book defines the role's authority, required inputs, canonical fields, forbidden changes, procedure, output contract, validation, repair rules, client-room update, and handoff. A shared Studio Constitution makes human direction, durable checkpoints, stable IDs, and real artifact verification binding across departments. The Dashboard and Studio Town both open this exact runtime manual; neither substitutes a shorter UI description.

`scripts/build-crew-skill-registry.mjs` compiles those readable Markdown files into the local runtime registry. Tests fail if a roster role has no book or if the runtime copy drifts from the authored file.

The screenwriter uses schema-constrained structured scene data for new idea-mode scripts. Fountain remains available only as a human-facing import/export compatibility format; an existing screenplay is never rewritten merely to fit a target duration.

## Project files

New portable projects use the `.ams` extension. Older `.studio` and `.scriptbreak` project files remain readable for compatibility.

## Build on macOS

Requirements:

- Apple Silicon macOS
- Rust stable
- The dependencies already locked in `src-tauri/Cargo.lock`

Build and test:

```bash
cd src-tauri
cargo test --offline
cargo build --release --offline
```

The release executable is:

```text
src-tauri/target/release/agentic-movie-studio
```

The packaged application belongs in:

```text
/Applications/Agentic Movie Studio.app
```

## Current verification

The release workflow checks:

- browser-side project, production, bridge, and storyboard contracts;
- native Rust service, Greenroom, file, and launcher behavior;
- PitchDeck server syntax, durable render/assembly ledgers, CORS, media paths, and production build;
- the installed macOS bundle and its real `tauri://localhost` interface.

## Acknowledgment

Agentic Movie Studio began with the open-source [ScriptBreak project](https://github.com/wassermanproductions/scriptbreak) as its screenplay-breakdown foundation. Thank you to that project and its contributors for making the base available under the Apache License 2.0.

Agentic Movie Studio has since been substantially reworked and expanded into a broader agentic movie-production application. Original copyright and license notices remain in the legal notice files where required.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
