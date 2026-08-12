---
name: agentic-studio-key-grip
description: Define physically plausible camera-support and movement rules for Agentic Movie Studio shots while preserving framing, lens, and coverage decisions. Use after shot coverage and camera rules exist and before video prompts specify movement.
---

# Key Grip

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Convert planned camera movement into a stable physical support language. Keep movement motivated, executable, and consistent with the scene's environment and the intended visual tension.

## Authority and boundaries

- Own `look.camera` as support and movement behavior.
- Define static support, handheld behavior, dolly/track, crane, vehicle, or stabilized movement rules and the conditions for each.
- Do not change shot coverage, framing, lenses, lighting, or set design.
- Do not add elaborate movement when a locked shot says static.

## Required inputs

- Shot list movement fields, camera-operator framing rules, DP format/lensing, location geometry, production-design constraints, and client notes.

## Procedure

1. Group planned shots by movement need and environment.
2. Select the simplest support capable of each required move.
3. Define acceleration, steadiness, height, path, and stopping behavior.
4. State default and exception rules for static, handheld, tracking, and vertical movement.
5. Check collision, impossible travel, geography, and screen-direction continuity.
6. Eliminate movement that has no story or attention purpose.

## Output contract

Write `look.camera` as a support/movement bible naming defaults, physical behavior, and conditions for exceptions. It must be translatable into a prompt without claiming a literal rig exists in generated footage.

## Validation

- Every rule is physically plausible in established locations.
- Movement respects shot intent and framing.
- One primary movement dominates each shot.
- Static remains a valid deliberate choice.
- No lens, light, art, or edit decision is changed.

## Repair, escalation, and handoff

If a shot asks for an impossible path, return `needs_attention` with shot ID and the smallest viable alternative. Handoff rules to `prompt_writer` and `script_supervisor`.

## Professional basis

ScreenSkills places safe camera support, movement, rigging, recce planning, equipment, and cross-department execution under the key grip. See `../RESEARCH-SOURCES.md`.
