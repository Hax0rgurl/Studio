# ADR 0003: Local, human-controlled evaluation flywheel

- Status: Accepted
- Date: 2026-08-11
- Decider: Filmmaker and project owner

## Context

NVIDIA's Data Flywheel blueprint describes a continuous loop that captures agent workloads, evaluates alternative configurations, and uses evidence to improve later inference. That pattern is useful to Agentic Movie Studio, but the reference implementation is a Kubernetes-oriented NVIDIA stack and its repository was archived in April 2026. Embedding Elasticsearch, MongoDB, Redis, NeMo microservices, and GPU training infrastructure would make this local macOS application less portable and would tie its learning layer to one vendor.

The related `Nemotron-RL-Agentic-Terminal-Pivot-v1` dataset contains terminal-agent trajectories. It can be relevant to future engineering or tool-use evaluation, but it is not evidence of this filmmaker's story, camera, performance, editing, or visual taste. It must never seed TasteOS creative rules. `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` is a possible comparison model on compatible NVIDIA systems; it is not a hard-coded application dependency or default.

Primary references:

- [NVIDIA Data Flywheel overview](https://developer.nvidia.com/blog/new-video-build-self-improving-ai-agents-with-the-nvidia-data-flywheel-blueprint/)
- [NVIDIA Data Flywheel repository](https://github.com/NVIDIA-AI-Blueprints/data-flywheel)
- [Nemotron terminal-agent dataset](https://huggingface.co/datasets/nvidia/Nemotron-RL-Agentic-Terminal-Pivot-v1)
- [Nemotron 3.5 Lightning model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)

## Decision

Agentic Movie Studio adopts the useful flywheel shape without embedding NVIDIA's deployment stack:

1. Before a local text-model call, the native app durably records a private workload intent: stable workload and run IDs, role, skill-book version, TasteOS profile revision, project/draft/production identity, model/runtime, temperature, context, thinking setting, response contract, and exact prompt.
2. A completed, failed, or cancelled receipt is appended before Studio accepts the result. If the initial intent cannot be stored, the model is not called. If the completion receipt cannot be stored, the artifact is not accepted as completed.
3. Secrets, provider headers, API keys, endpoints, credentials, and billing data are not fields in the workload schema. The ledger is local app data with directory mode `0700` and file mode `0600`. The normal TasteOS snapshot exposes only bounded summaries; full prompts and outputs require an explicit native detail request.
4. The Evaluation Lab can replay a completed workload against any model ID the user chooses on the currently connected local server. It preserves the baseline response contract and settings, stores both outputs, and runs limited deterministic checks such as completion, substantive length, structured-response parsing, and false side-effect language.
5. Objective checks do not choose a winner. The filmmaker scores baseline and candidate against the editable weighted TasteOS rubric and explicitly chooses baseline, candidate, tie, or neither. Only a human-selected candidate can be marked as a recommendation for future work.
6. A recommendation never changes the current text model, media provider, API, production setting, or in-progress film. Model/provider changes remain explicit Settings actions between workflows.
7. Learned-rule conflicts and unsafe proposals remain pending. The filmmaker must approve or dismiss the exact instruction, creative dimension, polarity, departments, scope, and lock state. TasteOS may not promote operational settings into creative rules.

## Consequences

- The app gains evidence-driven model comparison and a real feedback loop while remaining local-first, provider-independent, and open source.
- A model can be better on one department and worse on another; evidence stays attached to the workload instead of becoming a universal leaderboard.
- Creative taste remains grounded in this filmmaker's judgments, not terminal-agent datasets, generic reward models, or automatically inferred preference.
- The ledger stores sensitive creative prompts and outputs locally. Users should protect their macOS account and app-data directory; cloud synchronization of that directory is outside Studio's control.
- This is evaluation and constrained preference learning, not autonomous fine-tuning. Future Linux/server editions may add optional training adapters, but promotion into canon will still require explicit human policy.

## Rejected alternatives

- Embed the full NVIDIA blueprint: rejected for vendor lock-in, operational weight, and mismatch with a standalone Mac app.
- Train TasteOS from the Nemotron terminal dataset: rejected because technical terminal behavior is not creative taste evidence.
- Automatically choose the numerically highest-scoring model: rejected because deterministic checks and LLM graders cannot replace the filmmaker's judgment.
- Switch providers or models mid-production: rejected because it breaks provenance and visual continuity; fallback remains error handling under explicit workflow policy.
