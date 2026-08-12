---
name: agentic-studio-stills-prompt-writer
description: Write a single-frame storyboard prompt for each stable shot using canon, composition, lens, light, color, art, character, wardrobe, and prop constraints. Use after video prompts pass review or when a human requests a focused board-frame revision.
---

# Stills Prompt Writer

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Specify the exact still frame that will become the storyboard and, when approved, the visual starting condition for image-to-video. It is a photograph, not a clip.

## Authority and boundaries

- Own `scenes[].shots[].board.desc` and still-prompt provenance.
- Do not change shot specs, video prompts, bibles, Look, images, or takes.
- Do not describe a timeline, multiple moments, camera travel, dialogue delivery, music, or sound.
- Do not use generic cinematic adjectives in place of visible facts.

## Required inputs

- Stable scene/shot ID, shot purpose/spec, exact story moment, all approved bibles and Look fields, continuity/taste verdicts, aspect, and client notes.

## Procedure

1. Select one decisive instant that expresses the shot's purpose.
2. Lock subject identities, poses, gaze, hand/object state, wardrobe, and spatial relationships.
3. State location geometry, materials, background facts, framing, lens behavior, lighting, palette, and texture.
4. State exclusions only when they prevent a known production error.
5. Check that this frame can serve as the first frame of the video prompt.
6. Repair only the failed visual clause once.

## Output contract

Return the exact structured photographic blocks Studio requests:

- `shot`: a complete sentence naming the shot size/angle and the exact frozen instant, never a shot ID or slug;
- `subject`: physical identity, material/appearance, state, pose, and position;
- `physicalState`: mass, gravity, supporting surface, contact points, deformation, and any load-bearing relationship at this instant;
- `environment`: authorized geometry, surfaces, background facts, and spatial anchors;
- `lighting`: only the approved source, direction, quality, contrast, and practical state;
- `camera`: only the approved framing, height/angle, lens behavior, depth, and aspect facts;
- `filmStock`, `colorGrade`, `composition`, and `imperfection`: complete reproducible photographic decisions;
- `aestheticRefusals` and `avoid`: production-specific exclusions that prevent known errors.

Studio, not the agent, attaches the stable scene ID, shot ID, skill version, provenance, and validation receipts after the blocks pass.

## Validation

- Exactly one instant is described.
- `shot` is descriptive production direction, not an identifier such as `s1_wide_static`.
- Every positive block contains enough physical information to reproduce the frame; no one-word labels or checklist summaries pass.
- Mass and support are explicit. Nothing hovers, floats, glows, or deforms unless canon authorizes that exact state.
- No motion sequence, timing, cut, dialogue delivery, or audio appears.
- Every person, location, prop, garment, and visible event is authorized.
- Composition matches shot size/angle and the camera-operator rules.
- The image is a valid starting state for the corresponding video prompt.
- Continuity and taste both pass.

## Repair, escalation, and handoff

If the shot's exact instant is ambiguous, return `needs_attention` with two literal candidate instants. Handoff approved board-prompt IDs to `stills`; on revision preserve prior prompt provenance.

## Professional basis

MFLUX and Qwen Image Edit support local generation and controlled editing. Still-image standards emphasize stable metadata, identifiers, and preserved image characteristics. See `../RESEARCH-SOURCES.md`.
