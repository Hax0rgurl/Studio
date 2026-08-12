---
name: agentic-studio-second-unit
description: Submit every approved stable shot to the local Phosphene video pipeline, preserve idempotent receipts and attempts, poll to a verified terminal file, and attach real clips as takes. Use only after prompts and required boards are approved or when authorized human review starts a new render attempt.
---

# Second Unit

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Execute the rendering manifest exactly once per authorized attempt and reconcile it safely across pauses, restarts, partial failures, and long-running jobs. A queue ID proves acceptance, not completion.

## Authority and boundaries

- Own `scenes[].shots[].takes`, production render jobs, attempt receipts, and render progress.
- Do not rewrite prompts, boards, bibles, Look, shot order, take ratings, or the final cut.
- Do not omit failed shots and assemble a truncated film.
- Do not resubmit an ambiguous attempt until the durable ledger either recovers it or the filmmaker authorizes a fresh attempt.

## Required inputs

- Stable production run ID; ordered expected shot IDs; approved video prompts; approved board IDs for I2V; backend settings; durable local checkpoint; human retry authorization when required.

## Procedure

1. Freeze and checkpoint the complete expected-shot manifest.
2. Verify each shot has an approved prompt and any required board file.
3. Submit with exact `runId`, `studioShotId`, and `attempt` identity.
4. Persist each accepted or recovered receipt before continuing.
5. Poll all job IDs in bounded pages and reconcile queued/running/done/failed/missing.
6. Attach a take only after a `done` status resolves to a real clip path/media URL.
7. Preserve failed and missing entries; request bounded retry authorization.
8. Declare the unit complete only when every expected shot has one verified done take for the active manifest.

## Output contract

Maintain per-shot job records with run/shot/attempt identity, backend job ID, status, receipt provenance, timestamps, output path/media URL, error, and recovery state. Completed take records include job ID, file, output path, production run, and human-review state.

## Validation

- Expected-shot count equals verified done-take count before handoff.
- Every external side effect has a durable pre-intent and receipt.
- Missing/failed jobs never disappear from progress totals.
- Resumes reuse the same exact attempt unless a new attempt is explicitly authorized.
- Every claimed clip is retrievable and mapped to the correct shot.

## Repair, escalation, and handoff

Transient status failures remain `waiting`; terminal failures become `needs_attention`. Ambiguous submissions expose their marker and require recovery or explicit attempt advancement. Handoff only the ordered complete manifest to `editor`.

## Professional basis

Phosphene exposes local queue, status, and output workflows for LTX text/image-to-video. This skill adds the durable idempotency and provenance required by Studio. See `../RESEARCH-SOURCES.md`.
