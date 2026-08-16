---
name: agentic-studio-town
description: Build, revise, test, or review the Agentic Movie Studio Town experience inside the macOS Tauri app. Use for work involving the ChatDev or SimTown-style production map, crew sprites and animation, live agent activity, Greenroom conversations and handoffs, Client Room direction, human review and rework, TasteOS learning, storyboard or media-job visualization, canonical Studio state integration, app packaging in /Applications, or the verified GitHub handoff. Also use when diagnosing whether the town shows real autonomous work or merely decorative simulation.
---

# Agentic Studio Town

Build the town as a live view and control surface over the real Agentic Movie Studio. Preserve the existing Dashboard and Client Room. Treat the town as part of the same Tauri application, never as a separate webpage, game, project store, or fabricated agent simulation.

Read [references/studio-town-contract.md](references/studio-town-contract.md) before changing architecture, Greenroom behavior, TasteOS behavior, state ownership, sprite assets, review controls, packaging, or release status.

## Work from current evidence

1. Inspect the current Studio worktree, applicable instructions, version, tests, installed app, services, configured remote, and dirty files before editing.
2. Preserve unrelated user changes. Never restore, delete, or overwrite them to simplify the task.
3. Reuse the existing Studio state, crew roster, Greenroom integration, media gateway, settings, review controls, modules, and build scripts.
4. Verify behavior in the current source before relying on an older plan or line number.
5. Apply the game UI and sprite-pipeline skills as well when their capabilities are available and the task touches rendering or sprite assets.

## Enforce canonical ownership

- Keep the canonical film project in Studio's existing project state. Derive a serializable town view-model from it.
- Keep Greenroom as the durable coordination, identity, delivery, acknowledgment, and decision-lineage layer.
- Keep Ollama or the user-selected text provider as the reasoning engine.
- Keep the media gateway and configured local, REST, SDK, or MCP adapters as the image and video execution layer.
- Route mutations through existing Studio commands or trusted native commands. Never let a speech message mutate canonical state by implication.
- Never introduce a private iframe store, parallel town database, duplicate crew roster, or browser-held crew credentials.
- Never hardcode a text, image, or video model. Read the provider and model selected in Settings for the active production.

## Make every visible action truthful

Map visible town behavior only from durable events:

- `idle`: no claimed work or pending handoff.
- `walk`: a real request, handoff, artifact delivery, meeting, or review transition.
- `work`: a department delivery, model call, media job, or artifact mutation is actually running.
- `talk`: a real Greenroom or Client Room message exists.
- `review`: a durable human checkpoint is waiting.
- `blocked`: a persisted error, missing dependency, or service failure exists.
- `complete`: the required artifact and acknowledgment are both durable.

Do not invent ambient dialogue, meetings, progress, or successful output to make the town look alive. Optional cosmetic idle motion must be visually distinguishable from production activity and must never alter status.

## Preserve the complete experience

- Provide `Studio Town`, `Dashboard`, and `Client Room` as sibling production modes.
- Keep read-only navigation available while production runs so the user can watch Script, Look, Cards, Storyboard, Takes, and other pages update.
- Let buildings open the corresponding existing Studio surface.
- Let an agent selection expose its role, status, current task, skill book, dependencies, recent real messages, artifact, errors, and controls.
- Connect `Give direction`, `Open artifact`, `Approve`, `Flag for rework`, and `Pause after task` to durable existing workflows.
- Preserve all 23 canonical crew identities. Drive location and appearance from stable role IDs rather than display names.
- Show the actual configured provider and job identity for image and video work.

## Build autonomy through bounded events

Represent interdepartmental activity with structured events containing project, production run, sender, recipients, type, artifact, status, causal parent, and timestamp. Support request, reply, handoff, artifact, decision, blocker, review, rework, and approval events.

Allow agents to request appropriate departmental help, provide artifacts, recommend revisions, and resolve bounded dependencies. Require explicit commands for project mutations. Limit recursive peer calls and revision loops, retain provenance, and escalate expensive renders, creative conflicts, or exhausted retries to the user.

Never treat a Greenroom message alone as completed integration. Verify the intended Studio state mutation, persistence, and downstream consumption.

## Treat TasteOS as constrained learning

- Attach user judgments to the exact script passage, look field, prompt, still, shot, take, or cut being judged.
- Store rubric scores, freeform rationale, chosen/rejected alternatives, production context, and provenance.
- Let TasteOS propose bounded preference-profile adjustments with visible before-and-after values.
- Require acceptance for operational setting changes. Never silently rewrite provider settings, costs, model choices, or an active production.
- Make accepted taste evidence available to the relevant agents before they act.
- Send a flagged artifact and its failed rubric dimensions back through the real rework path.

## Render efficiently and accessibly

- Use Canvas 2D for the playfield unless verified requirements outgrow it. Keep text, transcript, controls, and accessibility in the DOM.
- Separate simulation state, event derivation, layout/path data, rendering, and user controls.
- Use the corrected source frames only. Normalize every sprite to a consistent bottom-center foot anchor and validate alpha bounds before building atlases.
- Render pixel art without smoothing. Pause animation when the town is hidden or the app is backgrounded.
- Honor reduced motion by replacing traversal animation with immediate state changes.
- Provide a keyboard-operable DOM list and meaningful text equivalent for every agent state and control.
- Degrade to the existing Dashboard if town assets or rendering fail.

## Implement in vertical slices

1. Validate and import the original town art and corrected 23-role sprite set.
2. Add the directly mounted town shell, map navigation, building hotspots, and accessible DOM equivalent.
3. Derive live agent state from canonical Studio, Greenroom, and media jobs.
4. Add real conversation, direction, approval, and rework controls.
5. Add durable handoffs, bounded meetings, and deterministic event-driven movement.
6. Add TasteOS evidence and screening-room review.
7. Harden persistence, restart, accessibility, performance, services, and installed-app behavior.

Complete and test each slice through a real event-to-state-to-view path before layering on the next one.

## Verify before claiming completion

At minimum, prove:

- every canonical role appears exactly once;
- a real task changes the correct agent's state and location;
- a real Greenroom message appears in the town transcript;
- user direction persists and reaches the intended department;
- an approved artifact mutates canonical Studio state and reaches its downstream consumer;
- a flagged shot follows the rework path and updates the storyboard or cut;
- pause, resume, quit, relaunch, and project switching preserve ownership and do not duplicate work;
- missing services, missing assets, model errors, job errors, and persistence failures remain honest and recoverable;
- the existing Dashboard and Client Room still work;
- Town controls never bypass production locks or cross into another project;
- the installed macOS app reproduces the tested source behavior.

Use deterministic fixtures for view-model and event mapping, dynamic browser tests for interaction and persistence, native tests for trusted commands, and an installed-bundle test for final verification. A full Studio release also requires a real end-to-end movie output in the expected output folder; a queued job or mock video is insufficient.

## Package and hand off honestly

- Keep source work in `/Users/muse/Documents/ CODEX BRAIN/Compiled Apps/Studio` unless the user changes the canonical workspace.
- Install test builds in `/Applications/Agentic Movie Studio.app`, never `~/Applications`.
- Do not retain obsolete app copies or rollback bundles when replacing the installed test build.
- Label interim packages as test builds. Do not call the app final until the acceptance gates pass and the user approves it.
- After a completed, verified milestone, commit and push source to the configured GitHub feature branch, then verify and report the exact remote branch and SHA.
- Do not publish a release, merge a protected branch, or upload generated app bundles without separate authorization.
- Distinguish source-complete, tests-passing, browser-tested, installed-app-tested, pushed, and released states in every handoff.

## Stop on integrity failures

Fail closed before external media work or irreversible state changes when canonical persistence, run ownership, project identity, credentials, or idempotency cannot be proven. Report the exact blocker. Never hide it with animation, optimistic status, fabricated dialogue, or an unverified success claim.
