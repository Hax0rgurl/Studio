use crate::{local_http, services};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const GREENROOM_PORT: u16 = 8_830;
const HTTP_TIMEOUT: Duration = Duration::from_secs(4);
const PRODUCTION_TAG: &str = "studio-production";
const PROJECT_REPO_PREFIX: &str = "studio-project:";

static THREAD_OPEN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenProductionThreadRequest {
    project_id: String,
    title: String,
    summary: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProductionThreadRequest {
    project_id: String,
    thread_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PostRoleStepRequest {
    project_id: String,
    thread_id: String,
    role_id: String,
    step_id: String,
    summary: String,
    details: String,
    #[serde(default)]
    artifacts: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimRoleWorkRequest {
    project_id: String,
    thread_id: String,
    role_id: String,
    work_id: String,
    summary: String,
    details: String,
    action_requested: String,
    model: String,
    #[serde(default)]
    tool_worker: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FinishRoleWorkRequest {
    project_id: String,
    thread_id: String,
    role_id: String,
    work_id: String,
    delivery_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SendConversationRequest {
    project_id: String,
    thread_id: String,
    event_id: String,
    from_role_id: String,
    to_role_id: String,
    event_type: String,
    intent: String,
    summary: String,
    details: String,
    action_requested: String,
    #[serde(default)]
    caused_by_event_id: String,
    #[serde(default)]
    artifacts: Vec<String>,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FinishConversationRequest {
    project_id: String,
    thread_id: String,
    event_id: String,
    role_id: String,
    delivery_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaimedRoleWorkResponse {
    host_id: String,
    reused: bool,
    delivery: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationDeliveryResponse {
    host_id: String,
    reused: bool,
    message: Value,
    delivery: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenProductionThreadResponse {
    project_id: String,
    created: bool,
    thread: Value,
}

#[derive(Deserialize)]
struct CrewState {
    greenroom: String,
    members: HashMap<String, CrewMember>,
}

#[derive(Deserialize)]
struct CrewMember {
    credential: String,
    handle: String,
    role: String,
    #[serde(default)]
    display_name: String,
}

#[derive(Deserialize)]
struct CrewDefinition {
    departments: Vec<CrewDepartment>,
}

#[derive(Deserialize)]
struct CrewDepartment {
    roles: Vec<CrewRole>,
}

#[derive(Deserialize)]
struct CrewRole {
    id: String,
}

struct GreenroomContext {
    state: CrewState,
    canonical_roles: HashSet<String>,
}

#[tauri::command]
pub(crate) fn greenroom_open_production_thread(
    request: OpenProductionThreadRequest,
) -> Result<OpenProductionThreadResponse, String> {
    let lock = THREAD_OPEN_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "The Greenroom production-thread lock was poisoned.".to_string())?;

    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let title = validate_text(&request.title, "title", 185)?;
    let summary = validate_text(&request.summary, "summary", 500)?;
    let context = load_context()?;
    let muse = resolve_member(&context, "muse", true)?;
    let repo = project_repo(&project_id);
    let project_tag_value = project_tag(&project_id);

    let list_path = format!("/threads?repo={}&limit=200", percent_encode_query(&repo));
    let existing = greenroom_json(&context, muse, "GET", &list_path, None)?;
    let threads = existing
        .as_array()
        .ok_or_else(|| "Greenroom returned an invalid thread list.".to_string())?;
    if let Some(thread) = threads
        .iter()
        .find(|thread| thread_belongs_to_project(thread, &repo, &project_tag_value))
    {
        return Ok(OpenProductionThreadResponse {
            project_id,
            created: false,
            thread: thread.clone(),
        });
    }

    let body = json!({
        "topic": format!("[Agentic Movie Studio] {title}"),
        "summary": summary,
        "repo": repo,
        "tags": [PRODUCTION_TAG, project_tag_value],
    });
    let thread = greenroom_json(&context, muse, "POST", "/threads", Some(&body))?;
    if !thread_belongs_to_project(&thread, &project_repo(&project_id), &project_tag(&project_id)) {
        return Err("Greenroom created a thread without the requested project provenance.".to_string());
    }

    Ok(OpenProductionThreadResponse {
        project_id,
        created: true,
        thread,
    })
}

#[tauri::command]
pub(crate) fn greenroom_post_role_step(request: PostRoleStepRequest) -> Result<Value, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let role_id = validate_identifier(&request.role_id, "role id", 64)?;
    let step_id = validate_identifier(&request.step_id, "step id", 80)?;
    let summary = validate_text(&request.summary, "step summary", 400)?;
    let details = validate_text(&request.details, "step details", 500_000)?;
    validate_artifacts(&request.artifacts)?;

    let context = load_context()?;
    // Authenticate this read as Muse and verify project ownership before the
    // role credential is allowed to write to the caller-supplied thread id.
    fetch_verified_thread(&context, &project_id, &thread_id)?;
    let role = resolve_member(&context, &role_id, false)?;
    let body = json!({
        "summary": format!("[studio:{step_id}] {summary}"),
        "details": format!(
            "Agentic Movie Studio project: {project_id}\nPipeline step: {step_id}\nCanonical role: {role_id}\n\n{details}"
        ),
        "artifacts": request.artifacts,
        "intent": "fyi",
    });
    greenroom_json(
        &context,
        role,
        "POST",
        &format!("/threads/{thread_id}/messages"),
        Some(&body),
    )
}

#[tauri::command]
pub(crate) fn greenroom_fetch_production_thread(
    request: ProductionThreadRequest,
) -> Result<Value, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let context = load_context()?;
    fetch_verified_thread(&context, &project_id, &thread_id)
}

/// Send one real role-to-role Greenroom message and claim the delivery for the
/// recipient's Studio worker. The sender is authenticated with its seeded role
/// identity; the webview never receives either role's credential. Reusing the
/// same event id recovers the original delivery instead of posting duplicate
/// dialogue after a crash or reload.
#[tauri::command]
pub(crate) fn greenroom_send_conversation(
    request: SendConversationRequest,
) -> Result<ConversationDeliveryResponse, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let event_id = validate_identifier(&request.event_id, "conversation event id", 40)?;
    let from_role_id = validate_identifier(&request.from_role_id, "sender role id", 64)?;
    let to_role_id = validate_identifier(&request.to_role_id, "recipient role id", 64)?;
    if from_role_id == to_role_id {
        return Err("A Greenroom conversation must name a different recipient.".to_string());
    }
    let event_type = validate_conversation_event_type(&request.event_type)?;
    let intent = validate_conversation_intent(&request.intent)?;
    let summary = validate_text(&request.summary, "conversation summary", 400)?;
    let details = validate_text(&request.details, "conversation details", 120_000)?;
    let action_requested =
        validate_text(&request.action_requested, "conversation action", 420)?;
    let caused_by_event_id = if request.caused_by_event_id.trim().is_empty() {
        String::new()
    } else {
        validate_identifier(
            &request.caused_by_event_id,
            "causal conversation event id",
            40,
        )?
    };
    let model = validate_text(&request.model, "model", 200)?;
    validate_artifacts(&request.artifacts)?;

    let context = load_context()?;
    fetch_verified_thread(&context, &project_id, &thread_id)?;
    let sender = resolve_member(&context, &from_role_id, false)?;
    let recipient = resolve_member(&context, &to_role_id, false)?;
    let preferred_host_id = conversation_host_id(&project_id, &to_role_id, &event_id)?;
    let marker = conversation_marker(&event_id);

    heartbeat_conversation_host(
        &context,
        recipient,
        &preferred_host_id,
        &to_role_id,
        &model,
    )?;

    if let Some(existing) = find_conversation_delivery(
        &context,
        recipient,
        &thread_id,
        &marker,
        &["acknowledged", "claimed", "pending"],
    )? {
        let delivery = claim_conversation_delivery_if_pending(
            &context,
            recipient,
            &thread_id,
            &marker,
            existing,
        )?;
        let host_id = verify_conversation_delivery(&delivery, &thread_id, &marker)?;
        let message = conversation_message_for_delivery(
            &context,
            &project_id,
            &thread_id,
            &delivery,
        )?;
        return Ok(ConversationDeliveryResponse {
            host_id,
            reused: true,
            message,
            delivery,
        });
    }

    // Greenroom routes @mentions by the seeded identity's display name, which
    // is not necessarily the canonical Studio role id. TasteOS is the real
    // example: its canonical role is `taste`, while the seeded Greenroom
    // identity is `the-eye`. Keep role ids for authorization and delivery
    // ownership, but address the actual seeded identity in the message.
    let recipient_mention = member_mention(&to_role_id, recipient);
    let body = conversation_message_body(
        &marker,
        &event_type,
        &intent,
        &recipient_mention,
        &summary,
        &details,
        &action_requested,
        &caused_by_event_id,
        &request.artifacts,
    );
    let message = greenroom_json(
        &context,
        sender,
        "POST",
        &format!("/threads/{thread_id}/messages"),
        Some(&body),
    )?;
    // Greenroom reports every unresolved @name in the whole message. Studio
    // may include a human-facing alias for a synthetic department (for
    // example @stills-prompt is executed by the canonical prompt_writer
    // identity). That alias must not make us reject a handoff which Greenroom
    // actually routed to @prompt-writer. Only the requested canonical
    // recipient is an integrity failure here; the delivery verification below
    // remains the source of truth that the right identity received the work.
    if unresolved_mentions_include(&message, &recipient_mention) {
        return Err(format!(
            "Greenroom could not resolve the canonical recipient @{}.",
            recipient_mention
        ));
    }

    let pending = find_conversation_delivery(
        &context,
        recipient,
        &thread_id,
        &marker,
        &["pending"],
    )?
    .ok_or_else(|| {
        "Greenroom recorded the conversation but did not create its recipient delivery."
            .to_string()
    })?;
    let delivery = claim_conversation_delivery_if_pending(
        &context,
        recipient,
        &thread_id,
        &marker,
        pending,
    )?;
    let host_id = verify_conversation_delivery(&delivery, &thread_id, &marker)?;
    Ok(ConversationDeliveryResponse {
        host_id,
        reused: false,
        message,
        delivery,
    })
}

/// A conversation delivery is acknowledged only after Studio has durably
/// saved the fact that the recipient read and used it. This is the same
/// integrity rule as department artifacts, applied to agent dialogue.
#[tauri::command]
pub(crate) fn greenroom_ack_conversation(
    request: FinishConversationRequest,
) -> Result<Value, String> {
    finish_conversation(request, "ack")
}

/// Release a claimed conversational turn when the recipient model fails
/// before Studio can persist a reply. Greenroom can then redeliver it safely.
#[tauri::command]
pub(crate) fn greenroom_release_conversation(
    request: FinishConversationRequest,
) -> Result<Value, String> {
    finish_conversation(request, "release")
}

/// Register the canonical role as a real Greenroom host, recover any durable
/// delivery already assigned to this exact Studio work id, or enqueue and
/// exclusively claim a new one. The webview never receives role credentials.
#[tauri::command]
pub(crate) fn greenroom_claim_role_work(
    request: ClaimRoleWorkRequest,
) -> Result<ClaimedRoleWorkResponse, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let role_id = validate_identifier(&request.role_id, "role id", 64)?;
    let work_id = validate_identifier(&request.work_id, "work id", 48)?;
    let summary = validate_text(&request.summary, "work summary", 500)?;
    let details = validate_text(&request.details, "work packet", 500_000)?;
    let action_requested = validate_text(&request.action_requested, "requested action", 420)?;
    let model = validate_text(&request.model, "model", 200)?;
    let context = load_context()?;
    fetch_verified_thread(&context, &project_id, &thread_id)?;
    let muse = resolve_member(&context, "muse", true)?;
    let role = resolve_member(&context, &role_id, false)?;
    let host_id = role_host_id(&project_id, &role_id, &work_id)?;
    let marker = role_work_marker(&work_id);

    let (host_type, metadata) = if request.tool_worker {
        (
            "mcp-stdio",
            json!({
                "adapter": "agentic-movie-studio-native-tools",
                "transport": "in_process",
                "role": role_id,
                "worker": "agentic-movie-studio"
            }),
        )
    } else {
        (
            "ollama",
            json!({
                "endpoint": "http://127.0.0.1:11434",
                "model": model,
                "role": role_id,
                "worker": "agentic-movie-studio"
            }),
        )
    };
    let heartbeat = json!({
        "host_id": host_id,
        "host_type": host_type,
        "display_name": format!("Agentic Movie Studio @{}", role_id),
        "capabilities": ["notify", "claim", "acknowledge"],
        "metadata": metadata,
        "priority": 10
    });
    greenroom_json(
        &context,
        role,
        "POST",
        &format!("/identities/{}/hosts/heartbeat", role.handle),
        Some(&heartbeat),
    )?;

    if let Some(delivery) = find_role_delivery(
        &context,
        role,
        &host_id,
        &thread_id,
        &marker,
        &["claimed", "acknowledged"],
    )? {
        return Ok(ClaimedRoleWorkResponse {
            host_id,
            reused: true,
            delivery,
        });
    }

    let mut reused = true;
    if find_role_delivery(
        &context,
        role,
        &host_id,
        &thread_id,
        &marker,
        &["pending"],
    )?
    .is_none()
    {
        reused = false;
        let notify = json!({
            "reason": "studio-agent-work",
            "summary": summary,
            "details": details,
            "action_requested": format!("{marker} {action_requested}"),
            "thread_id": thread_id,
            "required_capabilities": ["claim", "acknowledge"],
            "intent": "handoff",
            "fanout": "best"
        });
        let result = greenroom_json(
            &context,
            muse,
            "POST",
            &format!("/identities/{}/notify", role.handle),
            Some(&notify),
        )?;
        let assigned = result
            .get("deliveries")
            .and_then(Value::as_array)
            .is_some_and(|deliveries| {
                deliveries.iter().any(|delivery| {
                    delivery.get("host_id").and_then(Value::as_str) == Some(host_id.as_str())
                })
            });
        if !assigned {
            return Err("Greenroom did not assign the role work to its registered Studio host.".to_string());
        }
    }

    let claim_path = format!(
        "/identities/{}/deliveries/claim?host_id={}",
        role.handle,
        percent_encode_query(&host_id)
    );
    let delivery = greenroom_json(&context, role, "POST", &claim_path, Some(&json!({})))?;
    verify_role_delivery(&delivery, &host_id, &thread_id, &marker)?;
    Ok(ClaimedRoleWorkResponse {
        host_id,
        reused,
        delivery,
    })
}

/// Acknowledge a role delivery only after the frontend has durably committed
/// the role's canonical artifact. Repeated finalization is idempotent.
#[tauri::command]
pub(crate) fn greenroom_ack_role_work(request: FinishRoleWorkRequest) -> Result<Value, String> {
    finish_role_work(request, "ack")
}

/// Release is reserved for work that never reached a canonical checkpoint.
#[tauri::command]
pub(crate) fn greenroom_release_role_work(request: FinishRoleWorkRequest) -> Result<Value, String> {
    finish_role_work(request, "release")
}

/// Extend a long-running role's exclusive delivery lease. A screenplay or
/// feature render may legitimately outlive Greenroom's short dead-host TTL.
#[tauri::command]
pub(crate) fn greenroom_renew_role_work(request: FinishRoleWorkRequest) -> Result<Value, String> {
    finish_role_work(request, "renew")
}

fn load_context() -> Result<GreenroomContext, String> {
    let home = services::home_dir()?;
    let install = services::greenroom_install(&home).ok_or_else(|| {
        format!(
            "No complete Greenroom install was found in: {}",
            services::greenroom_candidates(&home)
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;
    load_context_from(&install)
}

fn load_context_from(install: &Path) -> Result<GreenroomContext, String> {
    let state_path = install.join("filmcrew/crew.state.json");
    let definition_path = install.join("filmcrew/crew.json");
    secure_credential_file(&state_path)?;
    let state: CrewState = serde_json::from_str(
        &fs::read_to_string(&state_path)
            .map_err(|error| format!("Could not read {}: {error}", state_path.display()))?,
    )
    .map_err(|error| format!("Could not parse {}: {error}", state_path.display()))?;
    if state.greenroom.trim_end_matches('/') != "http://127.0.0.1:8830" {
        return Err("Greenroom crew state does not target the fixed loopback service.".to_string());
    }
    let definition: CrewDefinition = serde_json::from_str(
        &fs::read_to_string(&definition_path)
            .map_err(|error| format!("Could not read {}: {error}", definition_path.display()))?,
    )
    .map_err(|error| format!("Could not parse {}: {error}", definition_path.display()))?;
    let canonical_roles = definition
        .departments
        .into_iter()
        .flat_map(|department| department.roles)
        .map(|role| role.id)
        .collect();
    Ok(GreenroomContext {
        state,
        canonical_roles,
    })
}

fn resolve_member<'a>(
    context: &'a GreenroomContext,
    role_id: &str,
    allow_muse: bool,
) -> Result<&'a CrewMember, String> {
    let is_canonical = context.canonical_roles.contains(role_id) || (allow_muse && role_id == "muse");
    if !is_canonical || (!allow_muse && role_id == "muse") {
        return Err(format!("Unknown canonical film-crew role: {role_id}"));
    }
    let member = context
        .state
        .members
        .get(role_id)
        .ok_or_else(|| format!("Greenroom has no seeded identity for role: {role_id}"))?;
    if member.role != role_id {
        return Err(format!("Greenroom identity role mismatch for: {role_id}"));
    }
    if member.handle.is_empty()
        || member.credential.is_empty()
        || member.handle.contains(['\r', '\n'])
        || member.credential.contains(['\r', '\n'])
    {
        return Err(format!("Greenroom identity is invalid for role: {role_id}"));
    }
    Ok(member)
}

fn fetch_verified_thread(
    context: &GreenroomContext,
    project_id: &str,
    thread_id: &str,
) -> Result<Value, String> {
    let muse = resolve_member(context, "muse", true)?;
    let detail = greenroom_json(
        context,
        muse,
        "GET",
        &format!("/threads/{thread_id}"),
        None,
    )?;
    let thread = detail
        .get("thread")
        .ok_or_else(|| "Greenroom returned an invalid thread detail.".to_string())?;
    if !thread_belongs_to_project(thread, &project_repo(project_id), &project_tag(project_id)) {
        return Err("The Greenroom thread does not belong to this Agentic Movie Studio project.".to_string());
    }
    Ok(detail)
}

fn greenroom_json(
    _context: &GreenroomContext,
    identity: &CrewMember,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    let encoded = body
        .map(serde_json::to_vec)
        .transpose()
        .map_err(|error| format!("Could not encode Greenroom request: {error}"))?;
    let headers = [
        ("X-Identity-Handle", identity.handle.as_str()),
        ("X-Identity-Token", identity.credential.as_str()),
    ];
    let response = local_http::request(
        GREENROOM_PORT,
        method,
        path,
        &headers,
        encoded.as_deref(),
        HTTP_TIMEOUT,
    )?;
    if !(200..300).contains(&response.status) {
        // Do not relay arbitrary server response bodies across the native
        // boundary: authentication failures must never echo credential data.
        return Err(format!(
            "Greenroom rejected the {method} request with HTTP {}.",
            response.status
        ));
    }
    response.json()
}

fn role_host_id(project_id: &str, role_id: &str, work_id: &str) -> Result<String, String> {
    let host_id = format!("studio.{project_id}.{role_id}.{work_id}");
    if host_id.len() > 200 {
        return Err("The Studio role host id is too long for Greenroom.".to_string());
    }
    Ok(host_id)
}

fn role_work_marker(work_id: &str) -> String {
    format!("[studio-work:{work_id}]")
}

fn role_mention(role_id: &str) -> String {
    role_id.replace('_', "-")
}

fn member_mention(role_id: &str, member: &CrewMember) -> String {
    let display_name = member.display_name.trim();
    if display_name.is_empty() {
        role_mention(role_id)
    } else {
        display_name.to_string()
    }
}

fn unresolved_mentions_include(message: &Value, recipient_mention: &str) -> bool {
    message
        .get("unresolved_mentions")
        .and_then(Value::as_array)
        .is_some_and(|mentions| {
            mentions.iter().any(|mention| {
                mention
                    .as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case(recipient_mention))
            })
        })
}

fn conversation_host_id(
    project_id: &str,
    role_id: &str,
    event_id: &str,
) -> Result<String, String> {
    let host_id = format!("studio.chat.{project_id}.{role_id}.{event_id}");
    if host_id.len() > 200 {
        return Err("The Studio conversation host id is too long for Greenroom.".to_string());
    }
    Ok(host_id)
}

fn conversation_marker(event_id: &str) -> String {
    format!("[studio-event:{event_id}]")
}

fn validate_conversation_event_type(value: &str) -> Result<String, String> {
    const ALLOWED: &[&str] = &[
        "request", "reply", "handoff", "artifact", "decision", "blocker", "review",
        "rework", "approval",
    ];
    if ALLOWED.contains(&value) {
        Ok(value.to_string())
    } else {
        Err("Unknown Studio conversation event type.".to_string())
    }
}

fn validate_conversation_intent(value: &str) -> Result<String, String> {
    if matches!(value, "fyi" | "question" | "handoff") {
        Ok(value.to_string())
    } else {
        Err("Greenroom conversation intent must be fyi, question, or handoff.".to_string())
    }
}

#[allow(clippy::too_many_arguments)]
fn conversation_message_body(
    marker: &str,
    event_type: &str,
    intent: &str,
    recipient_mention: &str,
    summary: &str,
    details: &str,
    action_requested: &str,
    caused_by_event_id: &str,
    artifacts: &[String],
) -> Value {
    let causal = if caused_by_event_id.is_empty() {
        "none"
    } else {
        caused_by_event_id
    };
    json!({
        "summary": format!("{marker} {summary}"),
        "details": format!(
            "{marker}\nStudio event type: {event_type}\nRecipient: @{recipient_mention}\nCaused by: {causal}\n\n{details}"
        ),
        "action_requested": format!("{marker} @{recipient_mention} {action_requested}"),
        "artifacts": artifacts,
        "intent": intent,
    })
}

fn heartbeat_conversation_host(
    context: &GreenroomContext,
    recipient: &CrewMember,
    host_id: &str,
    role_id: &str,
    model: &str,
) -> Result<(), String> {
    let heartbeat = json!({
        "host_id": host_id,
        "host_type": "ollama",
        "display_name": format!("Agentic Movie Studio @{} conversation worker", role_id),
        "capabilities": ["notify", "claim", "acknowledge"],
        "metadata": {
            "endpoint": "http://127.0.0.1:11434",
            "model": model,
            "role": role_id,
            "worker": "agentic-movie-studio-chatdev"
        },
        // A conversational turn must win over a recipient's already-live
        // department host. The exact delivery is still discovered and
        // verified by its durable event marker because Greenroom is free to
        // route to any compatible live host.
        "priority": 20
    });
    greenroom_json(
        context,
        recipient,
        "POST",
        &format!("/identities/{}/hosts/heartbeat", recipient.handle),
        Some(&heartbeat),
    )?;
    Ok(())
}

fn claim_conversation_delivery_if_pending(
    context: &GreenroomContext,
    recipient: &CrewMember,
    thread_id: &str,
    marker: &str,
    delivery: Value,
) -> Result<Value, String> {
    let host_id = verify_conversation_delivery(&delivery, thread_id, marker)?;
    if delivery.get("status").and_then(Value::as_str) != Some("pending") {
        return Ok(delivery);
    }
    let expected_delivery_id = delivery
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "The Greenroom conversation delivery has no id.".to_string())?
        .to_string();
    let claimed = greenroom_json(
        context,
        recipient,
        "POST",
        &format!(
            "/identities/{}/deliveries/claim?host_id={}",
            recipient.handle,
            percent_encode_query(&host_id)
        ),
        Some(&json!({})),
    )?;
    if claimed.get("id").and_then(Value::as_str) != Some(expected_delivery_id.as_str())
        || verify_conversation_delivery(&claimed, thread_id, marker).is_err()
    {
        // Claiming is FIFO per host. If an unrelated older packet appeared
        // between discovery and claim, put it back instead of stealing it.
        if let Some(claimed_id) = claimed.get("id").and_then(Value::as_str) {
            let _ = greenroom_json(
                context,
                recipient,
                "POST",
                &format!(
                    "/identities/{}/deliveries/{}/release?host_id={}",
                    recipient.handle,
                    claimed_id,
                    percent_encode_query(&host_id)
                ),
                Some(&json!({})),
            );
        }
        return Err(
            "Greenroom assigned another pending packet ahead of this conversation; retry safely."
                .to_string(),
        );
    }
    Ok(claimed)
}

fn conversation_message_for_delivery(
    context: &GreenroomContext,
    project_id: &str,
    thread_id: &str,
    delivery: &Value,
) -> Result<Value, String> {
    let message_id = delivery
        .get("message_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "The Greenroom conversation delivery has no source message.".to_string())?;
    let detail = fetch_verified_thread(context, project_id, thread_id)?;
    detail
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        })
        .cloned()
        .ok_or_else(|| "Greenroom could not recover the source conversation message.".to_string())
}

fn verify_role_delivery(
    delivery: &Value,
    host_id: &str,
    thread_id: &str,
    marker: &str,
) -> Result<(), String> {
    let matches = delivery.get("host_id").and_then(Value::as_str) == Some(host_id)
        && delivery.get("thread_id").and_then(Value::as_str) == Some(thread_id)
        && delivery
            .get("action_requested")
            .and_then(Value::as_str)
            .is_some_and(|action| action.starts_with(marker));
    if !matches {
        return Err("Greenroom returned a delivery that does not match this Studio role work packet.".to_string());
    }
    Ok(())
}

fn verify_conversation_delivery(
    delivery: &Value,
    thread_id: &str,
    marker: &str,
) -> Result<String, String> {
    let host_id = delivery
        .get("host_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "The Greenroom conversation delivery has no host.".to_string())?;
    let host_id = validate_identifier(host_id, "Greenroom conversation host id", 200)?;
    let matches = delivery.get("thread_id").and_then(Value::as_str) == Some(thread_id)
        && delivery
            .get("action_requested")
            .and_then(Value::as_str)
            .is_some_and(|action| action.starts_with(marker));
    if !matches {
        return Err(
            "Greenroom returned a delivery that does not match this Studio conversation event."
                .to_string(),
        );
    }
    Ok(host_id)
}

fn find_conversation_delivery(
    context: &GreenroomContext,
    role: &CrewMember,
    thread_id: &str,
    marker: &str,
    statuses: &[&str],
) -> Result<Option<Value>, String> {
    for status in statuses {
        let path = format!(
            "/identities/{}/deliveries?status={}",
            role.handle,
            percent_encode_query(status)
        );
        let value = greenroom_json(context, role, "GET", &path, None)?;
        let deliveries = value
            .as_array()
            .ok_or_else(|| "Greenroom returned an invalid delivery list.".to_string())?;
        if let Some(delivery) = deliveries.iter().find(|delivery| {
            verify_conversation_delivery(delivery, thread_id, marker).is_ok()
        }) {
            return Ok(Some(delivery.clone()));
        }
    }
    Ok(None)
}

fn find_role_delivery(
    context: &GreenroomContext,
    role: &CrewMember,
    host_id: &str,
    thread_id: &str,
    marker: &str,
    statuses: &[&str],
) -> Result<Option<Value>, String> {
    for status in statuses {
        let path = format!(
            "/identities/{}/deliveries?status={}&host_id={}",
            role.handle,
            percent_encode_query(status),
            percent_encode_query(host_id)
        );
        let value = greenroom_json(context, role, "GET", &path, None)?;
        let deliveries = value
            .as_array()
            .ok_or_else(|| "Greenroom returned an invalid delivery list.".to_string())?;
        if let Some(delivery) = deliveries.iter().find(|delivery| {
            verify_role_delivery(delivery, host_id, thread_id, marker).is_ok()
        }) {
            return Ok(Some(delivery.clone()));
        }
    }
    Ok(None)
}

fn finish_role_work(request: FinishRoleWorkRequest, action: &str) -> Result<Value, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let role_id = validate_identifier(&request.role_id, "role id", 64)?;
    let work_id = validate_identifier(&request.work_id, "work id", 48)?;
    let delivery_id = validate_identifier(&request.delivery_id, "delivery id", 64)?;
    let context = load_context()?;
    fetch_verified_thread(&context, &project_id, &thread_id)?;
    let role = resolve_member(&context, &role_id, false)?;
    let host_id = role_host_id(&project_id, &role_id, &work_id)?;
    let marker = role_work_marker(&work_id);

    let statuses: &[&str] = match action {
        "ack" => &["acknowledged", "claimed", "pending"],
        "release" => &["claimed", "pending"],
        "renew" => &["claimed"],
        _ => return Err("Unknown Greenroom role-work transition.".to_string()),
    };
    let existing = find_role_delivery(
        &context,
        role,
        &host_id,
        &thread_id,
        &marker,
        statuses,
    )?
    .ok_or_else(|| "The Greenroom role delivery is no longer available.".to_string())?;
    if existing.get("id").and_then(Value::as_str) != Some(delivery_id.as_str()) {
        return Err("The Greenroom delivery id does not match this Studio work packet.".to_string());
    }
    if action == "ack"
        && existing.get("status").and_then(Value::as_str) == Some("acknowledged")
    {
        return Ok(existing);
    }
    if action == "release" && existing.get("status").and_then(Value::as_str) == Some("pending") {
        return Ok(existing);
    }

    greenroom_json(
        &context,
        role,
        "POST",
        &format!(
            "/identities/{}/deliveries/{}/{}?host_id={}",
            role.handle,
            delivery_id,
            action,
            percent_encode_query(&host_id)
        ),
        Some(&json!({})),
    )
}

fn finish_conversation(
    request: FinishConversationRequest,
    action: &str,
) -> Result<Value, String> {
    let project_id = validate_identifier(&request.project_id, "project id", 80)?;
    let thread_id = validate_identifier(&request.thread_id, "thread id", 64)?;
    let event_id = validate_identifier(&request.event_id, "conversation event id", 40)?;
    let role_id = validate_identifier(&request.role_id, "recipient role id", 64)?;
    let delivery_id = validate_identifier(&request.delivery_id, "delivery id", 64)?;
    if !matches!(action, "ack" | "release") {
        return Err("Unknown Greenroom conversation transition.".to_string());
    }

    let context = load_context()?;
    fetch_verified_thread(&context, &project_id, &thread_id)?;
    let role = resolve_member(&context, &role_id, false)?;
    let marker = conversation_marker(&event_id);
    let mut existing = find_conversation_delivery(
        &context,
        role,
        &thread_id,
        &marker,
        if action == "ack" {
            &["acknowledged", "claimed", "pending"]
        } else {
            &["claimed", "pending"]
        },
    )?
    .ok_or_else(|| "The Greenroom conversation delivery is no longer available.".to_string())?;
    if existing.get("id").and_then(Value::as_str) != Some(delivery_id.as_str()) {
        return Err("The Greenroom conversation delivery id does not match this event.".to_string());
    }
    if action == "ack"
        && existing.get("status").and_then(Value::as_str) == Some("acknowledged")
    {
        return Ok(existing);
    }
    if action == "release"
        && existing.get("status").and_then(Value::as_str) == Some("pending")
    {
        return Ok(existing);
    }
    if action == "ack" && existing.get("status").and_then(Value::as_str) == Some("pending") {
        existing = claim_conversation_delivery_if_pending(
            &context,
            role,
            &thread_id,
            &marker,
            existing,
        )?;
        if existing.get("id").and_then(Value::as_str) != Some(delivery_id.as_str()) {
            return Err(
                "Greenroom claimed a different conversation delivery than the saved event."
                    .to_string(),
            );
        }
    }
    let host_id = verify_conversation_delivery(&existing, &thread_id, &marker)?;

    greenroom_json(
        &context,
        role,
        "POST",
        &format!(
            "/identities/{}/deliveries/{}/{}?host_id={}",
            role.handle,
            delivery_id,
            action,
            percent_encode_query(&host_id)
        ),
        Some(&json!({})),
    )
}

fn thread_belongs_to_project(thread: &Value, repo: &str, project_tag: &str) -> bool {
    thread.get("repo").and_then(Value::as_str) == Some(repo)
        && thread
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| {
                tags.iter().any(|tag| tag.as_str() == Some(PRODUCTION_TAG))
                    && tags.iter().any(|tag| tag.as_str() == Some(project_tag))
            })
}

fn project_repo(project_id: &str) -> String {
    format!("{PROJECT_REPO_PREFIX}{project_id}")
}

fn project_tag(project_id: &str) -> String {
    format!("studio-project-{project_id}")
}

fn validate_identifier(value: &str, label: &str, max: usize) -> Result<String, String> {
    if value.is_empty()
        || value.len() > max
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err(format!(
            "Invalid {label}; use 1-{max} ASCII letters, digits, dots, dashes, or underscores."
        ));
    }
    Ok(value.to_string())
}

fn validate_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    if value.trim().is_empty() || value.chars().count() > max_chars {
        return Err(format!("{label} must contain 1-{max_chars} characters."));
    }
    Ok(value.to_string())
}

fn secure_credential_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect Greenroom crew state permissions: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Greenroom crew state must be a regular, non-symlink file.".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        if metadata.mode() & 0o077 != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
                format!("Could not restrict Greenroom crew state to owner-only access: {error}")
            })?;
        }
        let secured = fs::symlink_metadata(path).map_err(|error| {
            format!("Could not verify Greenroom crew state permissions: {error}")
        })?;
        if secured.mode() & 0o077 != 0 {
            return Err(
                "Greenroom crew state is not owner-only; refusing to read credentials."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_artifacts(artifacts: &[String]) -> Result<(), String> {
    if artifacts.len() > 100 {
        return Err("A Greenroom step can reference at most 100 artifacts.".to_string());
    }
    if artifacts.iter().any(|artifact| {
        artifact.is_empty()
            || artifact.chars().count() > 1_000
            || artifact.chars().any(char::is_control)
    }) {
        return Err("Greenroom artifact references must be 1-1000 printable characters.".to_string());
    }
    Ok(())
}

fn percent_encode_query(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        conversation_host_id, conversation_marker, conversation_message_body, project_repo,
        member_mention, project_tag, resolve_member, role_host_id, role_mention, role_work_marker,
        unresolved_mentions_include,
        secure_credential_file, thread_belongs_to_project, validate_conversation_event_type,
        validate_conversation_intent, validate_identifier, verify_conversation_delivery,
        verify_role_delivery, CrewMember, CrewState, GreenroomContext,
    };
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

    fn context() -> GreenroomContext {
        GreenroomContext {
            state: CrewState {
                greenroom: "http://127.0.0.1:8830".to_string(),
                members: HashMap::from([
                    (
                        "muse".to_string(),
                        CrewMember {
                            credential: "secret-muse".to_string(),
                            handle: "agt_muse".to_string(),
                            role: "muse".to_string(),
                            display_name: "muse".to_string(),
                        },
                    ),
                    (
                        "director".to_string(),
                        CrewMember {
                            credential: "secret-director".to_string(),
                            handle: "agt_director".to_string(),
                            role: "director".to_string(),
                            display_name: "director".to_string(),
                        },
                    ),
                ]),
            },
            canonical_roles: HashSet::from(["director".to_string()]),
        }
    }

    #[test]
    fn resolves_only_seeded_canonical_roles() {
        let context = context();
        assert_eq!(
            resolve_member(&context, "director", false).unwrap().handle,
            "agt_director"
        );
        assert!(resolve_member(&context, "muse", false).is_err());
        assert!(resolve_member(&context, "invented_role", false).is_err());
        assert_eq!(
            resolve_member(&context, "muse", true).unwrap().handle,
            "agt_muse"
        );
    }

    #[test]
    fn rejects_role_key_and_seeded_role_mismatch() {
        let mut context = context();
        context.state.members.get_mut("director").unwrap().role = "writer".to_string();
        assert!(resolve_member(&context, "director", false).is_err());
    }

    #[test]
    fn validates_identifiers_without_normalizing_them() {
        assert_eq!(
            validate_identifier("project-42.alpha", "project id", 80).unwrap(),
            "project-42.alpha"
        );
        assert!(validate_identifier("../project", "project id", 80).is_err());
        assert!(validate_identifier(" project ", "project id", 80).is_err());
    }

    #[test]
    fn verifies_both_repo_and_project_tags() {
        let project_id = "project-42";
        let thread = json!({
            "repo": project_repo(project_id),
            "tags": ["studio-production", project_tag(project_id)],
        });
        assert!(thread_belongs_to_project(
            &thread,
            &project_repo(project_id),
            &project_tag(project_id)
        ));
        assert!(!thread_belongs_to_project(
            &thread,
            &project_repo("other"),
            &project_tag("other")
        ));
    }

    #[test]
    fn role_work_host_and_delivery_are_bound_to_the_exact_project_job() {
        let host = role_host_id("project-42", "director", "work-7").unwrap();
        let marker = role_work_marker("work-7");
        let delivery = json!({
            "id": "delivery-1",
            "host_id": host,
            "thread_id": "thread-9",
            "action_requested": format!("{marker} Direct the next film pass.")
        });
        assert!(verify_role_delivery(
            &delivery,
            "studio.project-42.director.work-7",
            "thread-9",
            &marker
        )
        .is_ok());
        assert!(verify_role_delivery(
            &delivery,
            "studio.other.director.work-7",
            "thread-9",
            &marker
        )
        .is_err());
        assert!(verify_role_delivery(
            &delivery,
            "studio.project-42.director.work-7",
            "other-thread",
            &marker
        )
        .is_err());
    }

    #[test]
    fn conversation_identity_is_deterministic_and_role_mentions_are_canonical() {
        let host = conversation_host_id("project-42", "story_editor", "chat-7").unwrap();
        assert_eq!(host, "studio.chat.project-42.story_editor.chat-7");
        assert!(host.len() <= 200);
        assert_eq!(conversation_marker("chat-7"), "[studio-event:chat-7]");
        assert_eq!(role_mention("story_editor"), "story-editor");
        let taste = CrewMember {
            credential: "secret".to_string(),
            handle: "agt_taste".to_string(),
            role: "taste".to_string(),
            display_name: "the-eye".to_string(),
        };
        assert_eq!(member_mention("taste", &taste), "the-eye");
    }

    #[test]
    fn an_unresolved_studio_alias_does_not_hide_a_resolved_canonical_recipient() {
        let response = json!({"unresolved_mentions":["stills-prompt"]});
        assert!(!unresolved_mentions_include(&response, "prompt-writer"));
        assert!(unresolved_mentions_include(&response, "stills-prompt"));
    }

    #[test]
    fn conversation_body_routes_a_real_greenroom_delivery() {
        let marker = conversation_marker("chat-7");
        let body = conversation_message_body(
            &marker,
            "request",
            "question",
            "story-editor",
            "The director needs a story ruling.",
            "Does scene two make the premise visible?",
            "Reply with a concrete scene-specific recommendation.",
            "handoff-3",
            &["studio://scene/2".to_string()],
        );
        assert_eq!(body.get("intent").and_then(serde_json::Value::as_str), Some("question"));
        assert!(body.get("summary").and_then(serde_json::Value::as_str).unwrap().starts_with(&marker));
        assert!(body.get("details").and_then(serde_json::Value::as_str).unwrap().contains("Recipient: @story-editor"));
        assert!(body.get("details").and_then(serde_json::Value::as_str).unwrap().contains("Caused by: handoff-3"));
        assert!(body.get("action_requested").and_then(serde_json::Value::as_str).unwrap().contains("@story-editor"));
        assert_eq!(body.get("artifacts").and_then(serde_json::Value::as_array).unwrap().len(), 1);

        let delivery = json!({
            "id": "delivery-7",
            "host_id": "studio.chat.project-42.story_editor.chat-7",
            "thread_id": "thread-9",
            "action_requested": body.get("action_requested").unwrap()
        });
        assert!(verify_role_delivery(
            &delivery,
            "studio.chat.project-42.story_editor.chat-7",
            "thread-9",
            &marker
        )
        .is_ok());

        // Greenroom may prefer an already-live department worker. Dialogue is
        // bound by recipient credentials, thread and the exact durable event
        // marker, while department work remains bound to its exact host.
        let routed_to_work_host = json!({
            "id": "delivery-8",
            "host_id": "studio.project-42.story_editor.work-2",
            "thread_id": "thread-9",
            "action_requested": body.get("action_requested").unwrap()
        });
        assert_eq!(
            verify_conversation_delivery(&routed_to_work_host, "thread-9", &marker).unwrap(),
            "studio.project-42.story_editor.work-2"
        );
        assert!(verify_role_delivery(
            &routed_to_work_host,
            "studio.chat.project-42.story_editor.chat-7",
            "thread-9",
            &marker
        )
        .is_err());
    }

    #[test]
    fn conversation_envelopes_reject_fake_types_and_intents() {
        assert_eq!(validate_conversation_event_type("reply").unwrap(), "reply");
        assert_eq!(validate_conversation_intent("handoff").unwrap(), "handoff");
        assert!(validate_conversation_event_type("small-talk").is_err());
        assert!(validate_conversation_intent("chat").is_err());
    }

    #[test]
    #[ignore = "requires the user's live loopback Greenroom service"]
    fn live_greenroom_routes_and_acknowledges_a_two_agent_exchange() {
        let project_id = "studio-live-collaboration-v1";
        let opened = super::greenroom_open_production_thread(
            super::OpenProductionThreadRequest {
                project_id: project_id.to_string(),
                title: "Studio internal collaboration protocol verification".to_string(),
                summary: "Idempotent request, reply, delivery, and acknowledgment proof.".to_string(),
            },
        )
        .unwrap();
        let thread_id = opened
            .thread
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap()
            .to_string();

        let request = super::greenroom_send_conversation(super::SendConversationRequest {
            project_id: project_id.to_string(),
            thread_id: thread_id.clone(),
            event_id: "live-request-v1".to_string(),
            from_role_id: "director".to_string(),
            to_role_id: "story_editor".to_string(),
            event_type: "request".to_string(),
            intent: "question".to_string(),
            summary: "The director requests a story ruling.".to_string(),
            details: "Which visible action should carry the premise before the director locks the visual intent?".to_string(),
            action_requested: "Return one scene-specific recommendation and one binding constraint.".to_string(),
            caused_by_event_id: String::new(),
            artifacts: vec!["studio://protocol/request".to_string()],
            model: "muse-glimmer:30b-q4_K_M".to_string(),
        })
        .unwrap();
        let request_delivery = request
            .delivery
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap()
            .to_string();
        super::greenroom_ack_conversation(super::FinishConversationRequest {
            project_id: project_id.to_string(),
            thread_id: thread_id.clone(),
            event_id: "live-request-v1".to_string(),
            role_id: "story_editor".to_string(),
            delivery_id: request_delivery,
        })
        .unwrap();

        let reply = super::greenroom_send_conversation(super::SendConversationRequest {
            project_id: project_id.to_string(),
            thread_id: thread_id.clone(),
            event_id: "live-reply-v1".to_string(),
            from_role_id: "story_editor".to_string(),
            to_role_id: "director".to_string(),
            event_type: "reply".to_string(),
            intent: "fyi".to_string(),
            summary: "The story editor returns the requested ruling.".to_string(),
            details: "Use the established doorway obstruction because it makes the premise visible without explanatory dialogue.".to_string(),
            action_requested: "Bind the visible obstruction into the director's canonical intent.".to_string(),
            caused_by_event_id: "live-request-v1".to_string(),
            artifacts: vec!["studio://protocol/reply".to_string()],
            model: "muse-glimmer:30b-q4_K_M".to_string(),
        })
        .unwrap();
        let reply_delivery = reply
            .delivery
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap()
            .to_string();
        super::greenroom_ack_conversation(super::FinishConversationRequest {
            project_id: project_id.to_string(),
            thread_id: thread_id.clone(),
            event_id: "live-reply-v1".to_string(),
            role_id: "director".to_string(),
            delivery_id: reply_delivery,
        })
        .unwrap();

        let detail = super::greenroom_fetch_production_thread(super::ProductionThreadRequest {
            project_id: project_id.to_string(),
            thread_id,
        })
        .unwrap();
        let messages = detail
            .get("messages")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        assert!(messages.iter().any(|message| message
            .get("summary")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|summary| summary.starts_with("[studio-event:live-request-v1]"))));
        assert!(messages.iter().any(|message| message
            .get("summary")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|summary| summary.starts_with("[studio-event:live-reply-v1]"))));

        let context = super::load_context().unwrap();
        let muse = super::resolve_member(&context, "muse", true).unwrap();
        super::greenroom_json(
            &context,
            muse,
            "POST",
            &format!("/threads/{}/resolve", opened.thread.get("id").unwrap().as_str().unwrap()),
            Some(&json!({"resolution_note":"Agentic Movie Studio live collaboration protocol verified."})),
        )
        .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn credential_file_is_restricted_before_reading() {
        use std::fs;
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let path = std::env::temp_dir().join(format!(
            "studio-greenroom-credential-test-{}",
            std::process::id()
        ));
        fs::write(&path, "test-only-placeholder").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        secure_credential_file(&path).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        fs::remove_file(path).unwrap();
    }
}
