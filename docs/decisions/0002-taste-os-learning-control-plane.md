# ADR 0002: TasteOS as the constrained learning control plane

- Status: Accepted for source implementation
- Date: 2026-08-11
- Decision owner: Abandoned Muse
- Scope: Agentic Movie Studio, every crew role, and every human review surface

## Context

TasteOS is not a take-rating widget and it is not a generic model fine-tune. It is the persistent back-end that learns how Abandoned Muse judges creative work. Every direct instruction, approval, rejection, revision note, circled take, killed take, and flagged shot is evidence. TasteOS turns that evidence into a versioned preference profile and gives each agent only the relevant part before it works.

The existing Studio implementation stores one free-form statement and retrieves a small set of circled/killed examples. That is useful evidence, but it does not learn settings, preserve an audit trail, distinguish a project note from a durable preference, expose uncertainty, or constrain what an inference is allowed to change.

The central risk is over-learning. One rejected shot must not become “never use close-ups,” a production-specific direction must not silently become a global law, and an agent must never reinterpret taste feedback as permission to change canon, providers, credentials, billing, or application settings.

## Decision

TasteOS is a local, durable, event-sourced control plane with four layers:

```text
Human judgment
  -> immutable feedback event
  -> bounded learner proposal
  -> deterministic policy validator
  -> versioned taste profile
  -> role-filtered brief injected into every agent
```

The local model may propose a preference update, but it never writes the profile directly. A deterministic native validator decides whether the proposal is safe to apply, must stay project-scoped, or must wait for the filmmaker.

### Evidence events

Every event records:

- stable event, project, draft, artifact, shot, take, and role identifiers where available;
- the filmmaker's exact words and explicit verdict;
- the prompt/output excerpt that was judged;
- whether the input was production direction, a take decision, a shot flag, a rubric edit, or an explicit TasteOS rule;
- timestamp and source;
- the profile revision resulting from processing it.

Events are append-only. Correcting a judgment creates another event; it does not rewrite history.

### Taste profile

The current profile contains:

- the filmmaker's explicit foundation statement;
- a user-owned judgment rubric;
- active learned rules;
- pending or disputed proposals;
- confidence, scope, applicable roles, evidence IDs, and lock state for every rule;
- the current revision and processed event IDs.

Rules are instructions such as “avoid emotion-announcing camera language” or “for performance, prefer one restrained involuntary action over a named emotion.” They are not free access to application configuration.

### Learning scope

- The filmmaker's current instruction always outranks learned history.
- An explicit global TasteOS rule applies globally immediately and can be locked.
- A normal correction may create a low-confidence project rule immediately.
- A learned rule becomes global only after independent supporting evidence, normally at least three events across at least two projects.
- Conflicting evidence lowers confidence or creates a disputed proposal. It never silently reverses a rule.
- A bare Circle/Kill decision is evidence, but a reason teaches more and receives more weight.

### Hard constraints

The learner may update only approved creative dimensions and role-specific taste instructions. It may not:

- change screenplay canon, bibles, shot identity, or approved human artifacts;
- change models, providers, API keys, MCP permissions, billing approval, filesystem paths, or network settings;
- edit the filmmaker-owned rubric;
- modify or delete a locked rule;
- infer a protected trait or personal fact;
- create more than three candidate changes from one event;
- raise or lower a rule's confidence by more than a bounded amount from one event;
- claim evidence it cannot quote from the recorded human input;
- erase prior evidence or revisions.

The profile injected into an agent is role-filtered and size-bounded. The agent receives explicit direction, applicable locked rules, the strongest relevant learned rules, known avoidances, confidence, and evidence identifiers. Low-confidence inference is labelled as inference, never presented as a command from the filmmaker.

## Storage and reliability

The desktop back-end owns a private TasteOS directory in application data:

- `profile.json`: current versioned profile, written atomically;
- `events.jsonl`: append-only feedback evidence;
- `revisions/`: compact profile revisions used to inspect or undo a mistaken learned setting.

Files are local, mode `0600` on Unix, and fsynced before success is returned. Raw feedback must be durable before learning starts. If persistence fails, the profile is not changed and the UI reports the failure.

The raw HTML development view may use an explicitly labelled local-storage fallback, but the packaged desktop application uses the native store as canonical.

## Human controls

TasteOS is a first-class Studio page, not hidden inside Takes. It shows:

- what the system currently believes;
- which rules are explicit, learned, pending, disputed, locked, or inactive;
- confidence and the exact evidence behind each rule;
- the editable judgment rubric;
- recent feedback events;
- controls to lock, edit, disable, or correct a rule.

Circle, Kill, Revise, shot flags, Client Room direction, and explicit TasteOS edits all write through the same event path. Human judgment is never overwritten by an agent verdict.

## Agent contract

Every crew system prompt receives a `TASTE OS` section after the role's skill book and before the current assignment. The section contains only rules relevant to that role and project. Agents must:

1. cite the applicable TasteOS rule IDs in their validation/handoff;
2. obey explicit and locked rules before learned rules;
3. state uncertainty when evidence is thin or contradictory;
4. request human attention rather than inventing a preference;
5. leave a structured artifact that can be judged and fed back into TasteOS.

## Options considered

### Keep free-form notes plus Circle/Kill examples

Rejected as the complete design. It supplies few-shot context but has no durable learning policy, rule scope, audit trail, conflict handling, or controlled settings.

### Let the LLM rewrite its own system prompt or settings

Rejected. It is unbounded, unauditable, and can turn one example into a permanent rule or modify operational settings outside taste.

### Fine-tune a model after each input

Rejected for the current local application. Per-event fine-tuning is slow, opaque, difficult to undo, model-specific, and unnecessary for learning explicit preferences. The evidence/profile layer remains portable across whichever model the filmmaker selects.

### Event log plus constrained profile compiler

Accepted. It learns on every input, remains inspectable and reversible, travels across models, and keeps the filmmaker in control.

## Consequences

- Agents gain an accumulated, evidence-backed understanding of the filmmaker instead of receiving one generic note.
- The same taste survives model changes because it belongs to Studio, not to a particular model.
- The system can explain why a rule exists and can recover from a bad inference.
- Some ambiguous feedback will remain project-scoped or pending until more evidence exists. That is deliberate restraint, not a failure to learn.
- Every creative output and human review surface must carry stable artifact identity and use the shared feedback path.

## Implementation sequence

1. Add the native event/profile store and deterministic validator.
2. Add the browser bridge and migrate `studio.taste.v1` without losing existing notes.
3. Route Client Room direction and take/shot judgments into evidence events.
4. Inject role-filtered TasteOS briefs into every crew prompt and media review.
5. Add the first-class TasteOS page, editable rubric, evidence inspection, and rule controls.
6. Add crash, conflict, over-learning, locked-rule, and prompt-injection regression tests.
7. Package only after the complete workflow is accepted by the filmmaker.
