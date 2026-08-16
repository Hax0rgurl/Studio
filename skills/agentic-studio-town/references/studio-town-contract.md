# Studio Town Contract

Use this reference for architectural work, behavior mapping, review, and release decisions.

## Source of truth

- Canonical repository: `/Users/muse/Documents/ CODEX BRAIN/Compiled Apps/Studio`
- Installed test application: `/Applications/Agentic Movie Studio.app`
- Product identity: Agentic Movie Studio
- Planned town milestone: verify the repository version before choosing or changing the next version number.
- Existing Studio project state, production state, and stable role IDs remain authoritative.
- Existing Dashboard and Client Room remain supported product surfaces.

The town is a projection and controller. It never becomes the film-project database.

## Experience contract

Provide three sibling modes:

1. `Studio Town`: spatial overview, real crew activity, meetings, and navigation.
2. `Dashboard`: dense operational controls, services, steps, queues, and errors.
3. `Client Room`: complete durable conversation and user direction.

Opening a running production may default to Studio Town. Switching modes must not pause work or change project state. Read-only module navigation remains available while production is active. Mutating controls still obey run ownership and persistence locks.

### Building responsibilities

| Place | Purpose |
| --- | --- |
| Production Office | Run ownership, producer state, services, schedule, overall blockers |
| Writers' Room | Direction, story development, screenplay writing, continuity |
| Casting and Rehearsal | Characters, casting, performance requirements |
| Art Department | Production design, locations, props, costume, visual references |
| Camera and Lighting | DP, camera, grip, lighting, capture language, color intent |
| Storyboard Room | Shot design, prompt writing, still generation, shot review |
| Soundstage | Image and video generation jobs using the configured provider |
| Post House | Editing, assembly, music, color, export |
| Screening Theater | Human approval, judgment, flagged artifacts, final cut review |
| Taste Library | Rubric, evidence, preference proposals, accepted taste profile |

Map the current canonical roster to these places by stable role ID. Do not fork or rename role identities solely for presentation.

## Suggested module boundary

Keep the implementation directly mounted inside Studio and split responsibilities:

```text
src/modules/studio-town/
  town-model.js       pure canonical-state and event derivation
  town-events.js      normalized event types and causal links
  town-layout.js      buildings, anchors, waypoints, paths
  town-simulation.js  deterministic destinations and interpolation
  town-renderer.js    Canvas drawing only
  town-controller.js  DOM and existing Studio command bindings
  town.css            HUD, transcript, drawer, accessibility
  town-assets.json    versioned source-frame and atlas manifest
```

Adapt this shape to the current source layout without introducing an iframe or a second application runtime.

## View-model boundary

Derive a serializable view-model that can be fixture-tested without Canvas:

```text
TownVM
  projectId
  runId
  productionStatus
  selectedRoleId
  buildings[]
  agents[]
    roleId
    displayName
    buildingId
    activity
    taskId
    artifactRef
    provider
    progress
    lastEventId
    blocker
  events[]
  humanCheckpoints[]
```

Renderer objects, timers, textures, paths, and DOM references do not belong in persisted film state.

## Durable event envelope

Use structured metadata around Greenroom coordination:

```text
StudioTownEvent
  id
  projectId
  runId
  type
  fromRoleId
  toRoleIds[]
  taskId
  artifactRef
  status
  causedByEventId
  createdAt
  acknowledgedAt
```

Supported event types:

- request
- reply
- handoff
- artifact
- decision
- blocker
- review
- rework
- approval

Messages may explain an event. The structured event supplies identity, ownership, status, and causality. Only a verified Studio/native command mutates the film project.

## Activity derivation

Use precedence so one agent never displays contradictory states:

1. persisted blocker or failed owned task -> `blocked`
2. waiting human checkpoint -> `review`
3. claimed model/media task -> `work`
4. current durable conversation event -> `talk`
5. active handoff with destination -> `walk`
6. acknowledged finished artifact -> `complete`
7. otherwise -> `idle`

Animate travel from authored waypoint graphs. Persist the causative event and destination, not every animation frame. Reconstruct position deterministically after reload.

## Conversation rules

- Display exact real messages with sender, recipients, time, task, and artifact context.
- Filter by production, room, agent, or artifact.
- Never display model chain-of-thought. Show concise task-relevant conclusions, requests, and decisions.
- Never synthesize filler conversation.
- Persist user direction before showing it as delivered.
- Confirm the intended agent or department received the direction in its next task context.

## Human review and rework

For every reviewable artifact provide:

- approve or keep;
- flag for rework;
- reason and rubric dimensions;
- optional direct instruction;
- destination department;
- cost-impact disclosure when a rerender is required;
- original and replacement provenance.

A rework request creates a durable event and task. The replacement must update the canonical artifact relationship and downstream consumer without deleting the original evidence.

## TasteOS constraints

Taste evidence includes:

- artifact type and identifier;
- project and run context;
- accepted, rejected, or revised outcome;
- numeric rubric dimensions when supplied;
- human rationale;
- comparison alternatives;
- responsible departments;
- timestamp and provenance.

Learning produces a bounded proposal. Show affected preference keys, old values, proposed values, supporting evidence, and confidence. Require approval for operational changes. Never allow TasteOS to change provider credentials, spending limits, active-run model/provider selection, file locations, or security settings.

## Media-provider neutrality

The town displays whichever configured image or video adapter owns the real job. It must handle local engines, REST APIs, SDK adapters, and MCP adapters through the existing media catalogue. Do not bake Phosphene, PitchDeck, Codex, Ollama, Alibaba, or another provider into the visual state model. Provider-specific details remain behind adapter contracts.

## Sprite contract

- Include exactly one manifest entry per canonical role.
- Store stable role ID, frame keys, source dimensions, anchor, scale, and supported states.
- Use bottom-center anchors based on true visible alpha bounds.
- Keep feet and body parts inside every frame with transparent padding.
- Validate matching canvas sizes and no unexpected opaque border pixels.
- Use crisp nearest-neighbor scaling.
- Mirror only when asymmetry and labels remain correct; otherwise provide explicit left/right frames.
- Use source frames or atlases in the app. Keep presentation GIF/APNG files out of runtime when they inflate the bundle or introduce frame-composition artifacts.

## Performance and accessibility budgets

- Run `requestAnimationFrame` only while Studio Town is visible.
- Suspend animation when the window is backgrounded.
- Keep the canonical event/model update path independent of frame rate.
- Batch texture loads and surface an honest fallback if an asset fails.
- Offer reduced motion.
- Expose every building, agent, status, conversation, and action through keyboard-operable DOM.
- Do not encode status by color alone.

## Test matrix

### Pure tests

- exact roster-to-manifest coverage;
- unique role and event IDs;
- activity precedence;
- room assignment;
- handoff destination and deterministic replay;
- project/run ownership rejection;
- TasteOS proposal constraints;
- provider-neutral job mapping.

### Dynamic UI tests

- mode switching while work continues;
- building and agent navigation;
- real message appearance;
- user direction persistence and delivery;
- approve and flag/rework behavior;
- pause/resume during model and media calls;
- reload recovery;
- cross-project delayed-event rejection;
- reduced-motion and keyboard paths;
- Canvas failure fallback to Dashboard.

### Integration tests

- Greenroom delivery -> worker/model execution -> canonical mutation -> persistence -> downstream view and prompt;
- media queue -> real job identity -> storyboard state -> completed output -> review/rework;
- Taste judgment -> proposal -> human acceptance -> later agent context;
- application quit/restart during handoff and long-running media work without duplication.

### Installed-app gate

- build from the tested source;
- replace `/Applications/Agentic Movie Studio.app` without creating rollback clutter;
- verify signing and bundle launch;
- reproduce core town, conversation, direction, rework, and restart tests in the installed bundle;
- for a full product release, produce and verify a real movie file in the expected output folder.

## Handoff language

Report these separately:

- implemented in source;
- unit/static tests passed;
- dynamic browser tests passed;
- native tests passed;
- packaged;
- installed in `/Applications`;
- installed bundle tested;
- committed;
- pushed with verified remote branch and SHA;
- released.

Never collapse these into a single claim such as "done" unless every required state is actually true.
