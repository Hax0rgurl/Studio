# Decision 0004: Greenroom owns durable agent work

Date: 2026-08-13  
Status: accepted

## Decision

Agentic Movie Studio will use Greenroom as the durable work broker for every crew department.
Greenroom is no longer a transcript written after a fixed JavaScript model call.

For each exact `(production id, canonical role, work id)` assignment, Studio must:

1. save the work intent in the canonical project;
2. open or verify the production's tagged Greenroom thread;
3. register the role's deterministic host with honest capabilities and engine metadata;
4. enqueue a self-contained `handoff` delivery containing the role skill book, filmmaker direction,
   TasteOS constraints, predecessor evidence, allowed write, and validation condition;
5. claim the delivery exclusively before invoking a model, media provider, or assembly tool;
6. renew the exclusive claim throughout any long model or tool operation;
7. validate and checkpoint the returned artifact in the active Studio draft;
8. post the role result under its canonical Greenroom identity; and
9. acknowledge the delivery only after the canonical checkpoint succeeds.

The same work id is reused after a crash or lost response. A new work id is created only for a
real retry or revision after the prior delivery has been finalized.

Department execution is driven by a canonical readiness graph. When several departments are legally
ready, a Greenroom-claimed producer agent may select exactly one value from the ready-role enum. That
choice and its prerequisite explanation are checkpointed before execution. The producer cannot add a
role, waive a gate, change provider/model/billing settings, write another role's artifact, or declare
the production complete. Deterministic validation remains authoritative.

## Authority boundaries

- Greenroom owns identities, conversations, assignments, claims, and acknowledgments.
- The user-selected Ollama model owns department reasoning. The model id is metadata, not a hard-coded choice.
- Trusted media adapters own image/video job execution and return durable receipts.
- Studio owns canonical project mutation and validation.
- TasteOS supplies bounded learned constraints and human judgment; it cannot silently change providers,
  models, billing approval, or locked filmmaker rules.

A Greenroom message is evidence that an agent spoke. It is never enough to mark a Studio step complete.
Completion requires the matching canonical artifact checkpoint.

## Recovery and failure

- A delivery claimed without a saved receipt is released or allowed to return to pending after its lease.
- Active jobs renew at 15 seconds against Greenroom's 60-second claim timeout. Two consecutive
  renewal failures stop the worker before another host may take the job.
- A saved artifact whose Greenroom result or acknowledgment was interrupted is finalized on Resume without
  rerunning the department.
- A delivery failure is checkpointed and acknowledged as a failed attempt; a later retry receives a new work id.
- Credentials remain in the Rust broker and never enter browser storage or model context.
- Every active department registers the selected Ollama host for its bounded functional seminar. Image,
  video, and assembly execution still goes through the separately selected trusted media adapter after the
  seminar and canonical gates pass.

## Current limitation

The trusted executor is presently the open Studio desktop process because the canonical project graph is
stored in the app's WebKit project database. Deliveries survive an app restart and Resume reclaims them. A
fully headless server worker requires moving canonical project writes behind a native revisioned broker. It
must reuse this protocol and compare-and-swap the project revision before acknowledging work.
