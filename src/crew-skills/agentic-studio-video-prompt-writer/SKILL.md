---
name: agentic-studio-video-prompt-writer
description: Write one complete, backend-aware image-to-video or text-to-video prompt per stable shot, binding screenplay action, shot spec, bibles, Look, timing, motion, and sound. Use after coverage and creative department fields are complete or for a focused flagged-shot revision.
---

# Video Prompt Writer

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Translate one planned shot into one executable moving-image instruction. Preserve canon and visual continuity while describing the action, camera behavior, temporal beats, and sound Phosphene/LTX must generate.

## Authority and boundaries

- Own `scenes[].shots[].prompt` and prompt provenance.
- Do not change screenplay, shot specs, bibles, Look, board image, take, or review decisions.
- Do not reference another shot vaguely; restate all required identity and continuity facts.
- Do not claim a rendered video exists.

## Required inputs

- Stable scene/shot ID and shot purpose/spec.
- Exact scripted beat and dialogue for the shot.
- Character, location, prop, wardrobe, Look, continuity verdict, taste evidence, client direction, target seconds, and optional board frame.
- Active backend capability: text-to-video or image-to-video.

## Procedure

1. Determine whether the shot is T2V or I2V from the actual board-frame receipt.
2. Lock subject identity, starting state, location, props, wardrobe, light, palette, lens/framing, and aspect.
3. Describe one primary camera move and objective subject action.
4. For I2V, emphasize motion and change instead of redescribing the still.
5. Allocate a feasible sequence of beats, roughly one meaningful beat per two to three seconds.
6. Include exact dialogue only when scripted and needed; include observable sound behavior.
7. Add only production-specific negatives.
8. Run continuity and taste checks; repair only failed clauses once.

## Output contract

Write a prompt record with `text`, `seconds`, `mode`, `sourceBoardId`, `continuityFacts`, `audio`, `negative`, `model`, `skillVersion`, and validation verdicts. The prose must be self-contained and use concrete present-tense instructions.

## Validation

- Every prompted shot has a stable ID and exact duration.
- Prompt content is authorized by script, bibles, and Look.
- I2V starts from the actual board state; T2V fully establishes the frame.
- Motion, action, camera, and sound fit the duration.
- Adjacent entrances/exits, props, wardrobe, light, and direction match.
- No timestamps or cuts appear unless the backend and shot design explicitly require them.

## Repair, escalation, and handoff

If required canon or a board receipt is missing, return `blocked` with exact paths. If continuity or taste fails, preserve the prior prompt and create a new revision. Handoff only approved prompt IDs to `second_unit`.

## Professional basis

Phosphene exposes local T2V/I2V queueing and LTX guidance emphasizes motion for I2V, objective action, camera, and sound. See `../RESEARCH-SOURCES.md`.
