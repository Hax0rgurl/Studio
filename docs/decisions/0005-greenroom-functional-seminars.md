# Decision 0005: Greenroom carries real functional crew seminars

Date: 2026-08-16  
Status: accepted

## Problem

A sequential list of department results is not an agent studio. It can prove that work happened, but the
agents cannot request missing expertise, answer one another, or carry a peer ruling into the next canonical
artifact. Animated sprites must never pretend that this conversation exists.

## Decision

Every non-empty department job runs one bounded functional seminar before it mutates the project or calls a
media provider. The pattern adapts the useful role-playing phase from the open-source
[ChatDev 1.0](https://github.com/OpenBMB/ChatDev/tree/chatdev1.0) to the durable identities, threads,
deliveries, claims, and acknowledgments supplied by
[Greenroom](https://github.com/madeit-build/greenroom).

For each department work id:

1. The producer sends a real authenticated Greenroom `handoff` to the canonical role.
2. Studio checkpoints the Greenroom message and delivery receipt before execution.
3. The recipient checkpoints that it consumed the handoff, then acknowledges the delivery.
4. The selected text model reads the role's complete versioned skill book and current canonical project
   evidence. It may ask one other canonical department one precise production question, or explicitly
   proceed when no cross-department dependency remains.
5. A peer request is posted by the requesting role's Greenroom identity with `intent=question` and an
   explicit `@recipient` mention. The recipient host claims the resulting delivery.
6. The peer model reads its own full skill book and the same project evidence. It returns an operational
   answer, recommendations, constraints, and blockers without taking ownership of the requesting role's
   artifact.
7. The reply is posted by the peer's Greenroom identity and causally linked to the request event.
8. Studio saves the complete seminar and injects the exact handoff/request/reply text into the requesting
   department's evidence packet.
9. Only after that durable save does Studio acknowledge both conversation deliveries and allow the
   department to commit its canonical artifact.

The Client Room and Studio Town render these exact typed events. They never synthesize dialogue from status
labels or animation state.

## Bounds and recovery

- One peer request maximum per department work id. No nested seminars, ambient chatter, or recursive debate.
- The current user-selected model is used. No runtime model id is hard-coded.
- Event ids are saved before sending. Replaying the same event id recovers the same Greenroom delivery after
  a crash instead of posting duplicate dialogue.
- A recipient failure releases the claimed request. Resume reclaims the same event before trying again.
- If a reasoning template says `proceed` while also naming a valid peer and concrete question, Studio treats
  the substantive target and question as an `ask`; it does not silently discard them.
- Greenroom speech is provenance and context. It cannot mark a department complete. Only validated Studio
  state mutation can do that.
- Private identity credentials stay in the native Rust broker and never enter the webview, model prompt, or
  project file.

## Runtime event envelope

Conversation state is stored under `S.production.collaboration` using
`studio/greenroom-collaboration@1`. Each event records its type, intent, authenticated sender, canonical
recipient, exact text, requested action, causal event id, Greenroom message id, delivery id, host id, and
acknowledgment time. A seminar records the department work id, the bounded peer decision, and the exact reply
that entered the canonical artifact context.

