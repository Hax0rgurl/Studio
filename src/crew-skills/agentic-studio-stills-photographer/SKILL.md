---
name: agentic-studio-stills-photographer
description: Generate, ingest, verify, and provenance a real storyboard frame for each approved still prompt using the local PitchDeck and MFLUX image pipeline. Use only after a shot has an approved still prompt or when a human flags a board for a new controlled attempt.
---

# Stills Photographer

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Turn an approved still prompt into an actual, resolvable storyboard image while preserving shot identity, prompt provenance, generation settings, and prior attempts. A model response or queue acknowledgement is not a photograph.

## Authority and boundaries

- Own `scenes[].shots[].board.frame`, image-attempt history, and image provenance.
- Do not rewrite the prompt, shot spec, bibles, Look, or video prompt.
- Do not replace a human-approved board without an explicit new attempt.
- Do not claim generation when the output file or data URL cannot be resolved.

## Required inputs

- Stable run/scene/shot IDs, approved still-prompt record, required source/reference images, chosen local image backend/model, aspect/dimensions, and client flags.

## Procedure

1. Verify the local image service and model capability without downloading or changing models silently.
2. Checkpoint the attempt intent before submitting.
3. Submit the approved prompt and bounded references with stable IDs.
4. Persist the receipt immediately.
5. Resolve the finished image bytes/data URL and verify format, dimensions, nonzero size, and shot mapping.
6. Attach the frame as a new attempt with full provenance.
7. Run continuity and taste review; never delete the prior attempt.

## Output contract

Write an image attempt containing `id`, `sceneId`, `shotId`, `promptId`, `backend`, `model`, `settings`, `sourceImageIds`, `createdAt`, `outputPath` or `imageDataUrl`, dimensions, status, validation, human-review state, and skill version.

## Validation

- The image is actually retrievable and decodable.
- Stable shot/prompt identity matches the submission.
- Dimensions/aspect are valid and metadata is recorded.
- The frame contains the approved canonical people, place, props, wardrobe, composition, light, and palette.
- Prior attempts remain available.

## Repair, escalation, and handoff

Retry only as a new attempt after a terminal failure or explicit human review. If the model or weights are unavailable, return `blocked` with the discovered path/status; do not download. Handoff the approved frame ID to `second_unit` and the board grid.

## Professional basis

MFLUX provides local MLX image generation/editing, Qwen Image Edit supports controlled semantic and appearance edits, and IPTC/Library of Congress guidance supports stable descriptive/provenance metadata and valid image characteristics. See `../RESEARCH-SOURCES.md`.
