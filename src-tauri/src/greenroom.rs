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
        project_repo, project_tag, resolve_member, secure_credential_file,
        thread_belongs_to_project, validate_identifier, CrewMember, CrewState, GreenroomContext,
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
                        },
                    ),
                    (
                        "director".to_string(),
                        CrewMember {
                            credential: "secret-director".to_string(),
                            handle: "agt_director".to_string(),
                            role: "director".to_string(),
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
