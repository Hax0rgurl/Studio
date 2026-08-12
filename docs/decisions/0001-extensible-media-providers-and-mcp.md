# ADR 0001: Extensible media providers and MCP connectors

- Status: Accepted; provider foundation implemented, MCP client host still planned
- Date: 2026-08-11
- Decision owner: Abandoned Muse
- Scope: Agentic Movie Studio and the PitchDeck media gateway

## Context

Agentic Movie Studio cannot be tied forever to one still generator, one video generator, or one vendor's model names. A filmmaker may use a local engine for both, a photo API and a different video API, or an MCP server that exposes one or both capabilities. Providers, models, prices, authentication systems, and result formats will change faster than the Studio project format should.

The existing Phosphene integration already has valuable safety properties: stable shot identity, pending intent before submission, restart reconciliation, terminal-job persistence, local media serving, and idempotent assembly. Those properties must survive the provider abstraction. The system must not become a thin "send prompt" switch that can double-charge a remote account, lose an expiring result URL, or bypass canon and taste review.

## Decision

PitchDeck is the local media gateway. It owns a runtime provider registry. Phosphene and PitchDeck stills are built-in adapters; additional trusted adapters are loaded from the application-data provider directory without changing Studio or its canonical project schema.

Image and video choices are independent:

```text
Studio approved shot
  |-- still-image selection --> image-capable provider --> durable board frame
  `-- video selection -------> video-capable provider --> durable clip/take
```

A single adapter may advertise `mediaKinds: ["image", "video"]` and therefore appear in both selectors. An image-only or video-only adapter appears only where it is valid. Studio discovers model IDs from the adapter and also permits a custom model ID when the adapter declares that capability. Model names are never compiled into Studio.

The selected provider and model are copied into the production manifest only when a run starts. This is recovery metadata, not a mid-run switching feature. All jobs in one automated render manifest use the same video provider. A different provider means a new render run or an explicit new take.

## Provider contract

Every adapter has a stable lowercase `id`, a public descriptor, and one or more operations:

| Capability | Adapter operation | Normalized result |
|---|---|---|
| Still image | `generateImage` | `imageDataUrl`, durable `outputPath`, provider/model provenance |
| Submit clips | `queueBatch` | stable Studio shot ID, attempt, external job ID, reuse/recovery flags |
| Poll clips | `getJobs` | `queued`, `running`, `done`, `failed`, local output path/error |
| Serve clip | `getMedia` | a locally materialized regular file, never only an expiring vendor URL |
| Finish movie | `assemble` | ordered, idempotent local cut receipt and playable URL |

Adapters may use a REST API, SDK, command-line engine, or MCP tool behind that contract. They own provider-specific authentication, request shape, status mapping, idempotency/reconciliation, and result download. They may not expose keys or tokens in their public descriptor.

Normalized gateway routes are:

```text
GET  /api/media/providers
GET  /api/image/providers
GET  /api/video/providers
POST /api/image/generate
POST /api/video/queue-batch
POST /api/video/jobs
GET  /api/video/providers/:providerId/jobs/:id/media
POST /api/video/assemble
```

The old Phosphene and mflux routes remain as compatibility routes behind the built-in adapters. Existing projects and receipts therefore remain readable.

## Canon and taste are above providers

The provider does not decide what the film should look like. Before either a still or clip can be submitted, Studio creates `studio/video-review@1` containing:

- a fingerprint of the exact prompt;
- deterministic off-script findings;
- the craft review verdict and score when available;
- the TasteOS verdict, confidence, and evidence summary when available;
- one gate result.

An off-script invention, explicit craft `reject`, or taste `kill` blocks submission before the provider is called. A project with no taste history is labelled `untrained`; it is not given a fabricated approval. Provider-side prompt expansion or rewriting must default off, because it can silently undo canon and taste decisions. A provider may translate transport fields but not change semantic prompt content unless a future explicit, reviewed transformation creates a new fingerprint and review receipt.

Rendered takes retain provider ID, model ID, job ID, review receipt, output path, and run ID. Human circle/kill decisions continue feeding the cross-project taste library regardless of which service produced the take.

## Paid APIs and durable work

A provider descriptor can require billing approval. Studio must receive explicit approval for that provider before queueing; the gateway rejects paid submissions without it. Prices are not hard-coded because vendors change them. A future cost estimator may be supplied by each adapter, but an unknown estimate must remain visibly unknown.

Remote adapters must persist submission intent before contacting the vendor. If a crash occurs after possible acceptance but before an external task ID is durable, the attempt becomes `unproven` and is not automatically resubmitted. The user can explicitly authorize a new attempt after seeing the duplicate-charge warning. Successful remote files must be downloaded immediately to local durable storage; a vendor URL is provenance, not the movie asset.

Alibaba Model Studio is one example of why this rule exists, not a special case in the architecture. Its current Wan API is asynchronous, task IDs and result URLs expire after 24 hours, and the documentation instructs clients to poll rather than create duplicate tasks and to save successful video promptly. An Alibaba adapter therefore belongs in the provider directory and obeys the same contract as every other vendor.

## MCP connector layer

MCP is a transport and capability-discovery option, not permission to write arbitrary Studio state.

The planned native connector host will:

1. support stdio and Streamable HTTP transports;
2. validate each tool's JSON input and output schema;
3. use environment-provided credentials for stdio and OAuth 2.1 with PKCE/resource indicators for HTTP;
4. store secrets in the native credential store, never project JSON, localStorage, chat, or provider catalogs;
5. bind a discovered tool explicitly to `generateImage`, `queueBatch`, `getJobs`, `getMedia`, or another named Studio capability;
6. require human confirmation for paid, destructive, or external side effects;
7. normalize MCP task/poll results into the same durable job state machine;
8. return proposed artifacts to Studio validators instead of directly mutating the canonical project.

An MCP connector advertising both image and video bindings appears in both selectors. It is not assumed to have both merely because its server name mentions media. Tool annotations are treated as hints, not trusted authorization facts.

## Security boundaries

- PitchDeck binds to loopback and rejects non-local browser origins.
- Provider plug-ins are executable code and load only from explicitly trusted local directories.
- Public provider metadata may expose only whether credentials are configured, never their values.
- Remote media must be materialized and path-validated before the local gateway serves it.
- HTTP MCP authorization must use audience-bound tokens; token passthrough is forbidden.
- An adapter cannot bypass the Studio review envelope or paid-provider approval through the normalized route.

## Options considered

### Hard-code each vendor in Studio

Rejected. It couples UI, project data, auth, polling, and vendor models. Every API change would require a new Studio release and would recreate the present Phosphene dependency under another name.

### One fully declarative arbitrary-HTTP form

Rejected as the only extension mechanism. Authentication, uploads, async task recovery, webhooks, expiring URLs, moderation errors, and idempotency differ too much to represent safely as URL plus a few JSON paths. A manifest may help simple adapters later, but it cannot replace executable validation and durable state handling.

### Trusted adapters behind one normalized gateway

Accepted. It preserves the proven local workflow, keeps vendor code out of Studio, permits API/SDK/MCP implementations, and gives every provider the same safety and taste rules.

## Current implementation and remaining work

Implemented now:

- media provider registry and trusted plug-in discovery;
- combined, image-only, and video-only capability descriptors;
- dynamic provider/model catalogs with custom model IDs;
- independent Studio still/video selectors;
- provider/model frozen in production, job, board-frame, take, and cut provenance;
- generic image/video gateway routes with legacy Phosphene/mflux compatibility;
- the app-wide Settings center for every configuration field declared by an installed adapter;
- private `0600` provider credential storage whose secret values are never returned to Studio;
- pre-dispatch canon, independent craft, and TasteOS gates plus explicit paid-provider approval;
- an automated image-to-video invariant: every video shot must carry its real reviewed storyboard photo.

Still required before calling external connectors turnkey:

- a graphical install and trust-review flow for new adapter packages (configuration of installed adapters is implemented);
- the native MCP client/authorization host described above;
- production adapters for each chosen external API, with fake-server contract tests and opt-in live billing tests;
- signed adapter packages or an explicit trust-review workflow.

## References

- [MCP base protocol, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP task utility](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [Alibaba Model Studio Wan image-to-video reference](https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference)
- [Alibaba Model Studio Wan text-to-video reference](https://www.alibabacloud.com/help/en/model-studio/text-to-video-api-reference)
