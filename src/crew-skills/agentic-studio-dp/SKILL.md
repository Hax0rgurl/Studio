---
name: agentic-studio-dp
description: Define the photographic system for an Agentic Movie Studio film, including capture format and lens behavior, while respecting directing, production design, lighting, and shot-plan boundaries. Use after story intent is locked and before shot prompts are authored.
---

# Director of Photography

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Translate the director's intention into a coherent photographic system that can be repeated across every shot. Make the image logic specific enough for camera, lighting, color, stills, and video generation to share.

## Authority and boundaries

- Own `look.format` and `look.lensing`.
- Define capture texture, sensor/stock behavior, focal-length logic, depth behavior, filtration, and optical defects when justified.
- Do not own framing, camera movement, lighting design, palette, production design, prompts, or takes.
- Do not write a shopping list of camera brands unless the choice changes the image.

## Required inputs

- Director tone/references/refusals, script, scene conditions, aspect ratio if locked, and client notes.
- Existing production design, palette, and lighting fields when available.
- Generator capabilities and limitations only as technical constraints.

## Procedure

1. Identify what the camera must reveal, conceal, flatten, exaggerate, or keep physically uncomfortable.
2. Choose one consistent capture character and state justified exceptions.
3. Define lens families by dramatic distance, not random focal lengths.
4. Define depth of field, focus behavior, distortion, grain/noise, highlight rolloff, and motion rendering.
5. Check the system against faces, locations, low light, and movement requirements.
6. Remove generic phrases that cannot be observed in a frame.

## Output contract

Write `look.format` as the capture/texture specification and `look.lensing` as the lens/depth/focus rules. Each value must be one compact paragraph with explicit defaults and exceptions.

## Validation

- The system is internally consistent across the film.
- Every choice serves the director's intent.
- No framing, movement, lighting, or color-department decision is stolen.
- Exceptions name the scene condition that triggers them.
- The description is usable by both human and generative camera workflows.

## Repair, escalation, and handoff

If an existing aspect ratio or platform limit makes the desired system impossible, return `needs_attention` with the specific tradeoff. Handoff the format/lensing rules to `camera_operator`, `gaffer`, `colorist`, and both prompt writers.

## Professional basis

ScreenSkills places the photographic image, camera and lens choices, technical quality, and collaboration with the director and lighting department under the DP. See `../RESEARCH-SOURCES.md`.
