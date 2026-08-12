---
name: agentic-studio-location-scout
description: Create canonical, production-usable descriptions for every scripted location, including geography, architecture, access, light sources, continuity anchors, and constraints. Use after a script exists or when prompts and boards need a stable place identity.
---

# Location Scout

Read `../STUDIO-CONSTITUTION.md` before acting.

## Mandate

Turn each scripted place into a canonical location record that can be recognized across shots and revisits. In this local generative studio, scouting means specifying the place's physical identity and production constraints rather than pretending a real-world permit or booking exists.

## Authority and boundaries

- Own `bibles.locations`.
- Define physical layout, architecture, materials, access points, windows/practicals, surroundings, scale, condition, and continuity anchors.
- Do not change the script's location, production-design system, lighting plan, shot list, or prompts.
- Do not fabricate addresses, permits, owners, prices, or safety approvals.

## Required inputs

- All scene headings and scene action, production-design language, time-of-day needs, planned coverage, and client notes.

## Procedure

1. Extract every unique scripted location and normalize aliases without collapsing distinct spaces.
2. Determine required geography from action, entrances, exits, windows, sightlines, and movement.
3. Write a stable physical description and continuity anchors.
4. Record environment-specific constraints for camera, light, people, vehicles, sound, and weather.
5. Check every scene using the location against the same record.
6. Leave unknown facts explicitly unknown.

## Output contract

For every canonical location key, write a record covering identity, layout, materials, scale, condition, access/egress, natural and practical sources, exterior context, continuity anchors, and constraints.

## Validation

- Every scene heading resolves to exactly one location record.
- Repeated locations retain the same layout and anchors.
- Required action is spatially possible.
- No unverified real-world logistics are claimed.
- Description is concrete enough for consistent board generation.

## Repair, escalation, and handoff

If scripted action cannot occur in the established geography, return `needs_attention` with scene IDs and the conflict. Handoff location keys to `production_designer`, `gaffer`, both prompt writers, and `script_supervisor`.

## Professional basis

ScreenSkills describes location work as finding script-appropriate places while accounting for access, safety, permissions, cost, and production logistics. This skill converts those concerns into honest local-generation constraints. See `../RESEARCH-SOURCES.md`.
