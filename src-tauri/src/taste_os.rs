use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

const PROFILE_SCHEMA: &str = "studio/taste-os-profile@1";
const EVENT_SCHEMA: &str = "studio/taste-os-feedback@1";
const WORKLOAD_SCHEMA: &str = "studio/taste-os-workload@1";
const EXPERIMENT_SCHEMA: &str = "studio/taste-os-experiment@1";
const MAX_EVENTS_RETURNED: usize = 100;
const MAX_WORKLOADS_RETURNED: usize = 80;
const MAX_EXPERIMENTS_RETURNED: usize = 40;
const MAX_RULES: usize = 80;
const MAX_PENDING: usize = 100;
const MAX_PROCESSED_EVENTS: usize = 10_000;
const MAX_CANDIDATES_PER_EVENT: usize = 3;
const MAX_CONFIDENCE_DELTA: f64 = 0.12;

static TASTE_OS_LOCK: Mutex<()> = Mutex::new(());
static EVENT_COUNTER: AtomicU64 = AtomicU64::new(1);

const ALLOWED_DIMENSIONS: &[&str] = &[
    "story",
    "direction",
    "performance",
    "camera",
    "lighting",
    "color",
    "production_design",
    "wardrobe",
    "sound",
    "editing",
    "prompting",
    "continuity",
    "stills",
    "video",
];

const ALLOWED_ROLES: &[&str] = &[
    "producer",
    "director",
    "story_editor",
    "writer",
    "script_supervisor",
    "casting_director",
    "location_scout",
    "prop_master",
    "first_ad",
    "dp",
    "camera_operator",
    "gaffer",
    "key_grip",
    "production_designer",
    "costume_designer",
    "colorist",
    "composer",
    "prompt_writer",
    "stills_prompt",
    "taste",
    "stills",
    "second_unit",
    "editor",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterion {
    pub id: String,
    pub label: String,
    pub question: String,
    pub weight: u8,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteRule {
    pub id: String,
    pub dimension: String,
    pub polarity: String,
    pub instruction: String,
    pub scope: String,
    #[serde(default)]
    pub project_ids: Vec<String>,
    #[serde(default)]
    pub roles: Vec<String>,
    pub confidence: f64,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "default_true")]
    pub active: bool,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingProposal {
    pub id: String,
    pub event_id: String,
    pub reason: String,
    pub candidate: LearningCandidate,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteProfile {
    pub schema: String,
    pub revision: u64,
    pub foundation: String,
    pub rubric: Vec<RubricCriterion>,
    pub rules: Vec<TasteRule>,
    pub pending: Vec<PendingProposal>,
    pub feedback_count: u64,
    #[serde(default)]
    pub processed_event_ids: Vec<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEvent {
    pub schema: String,
    pub id: String,
    pub kind: String,
    pub source: String,
    pub project_id: String,
    pub draft_id: String,
    pub artifact_type: String,
    pub artifact_id: String,
    pub role: String,
    pub verdict: String,
    pub note: String,
    pub prompt_excerpt: String,
    pub output_excerpt: String,
    pub scope_hint: String,
    pub occurred_at: String,
    pub recorded_at: String,
    pub profile_revision: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub artifact_type: String,
    #[serde(default)]
    pub artifact_id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub prompt_excerpt: String,
    #[serde(default)]
    pub output_excerpt: String,
    #[serde(default)]
    pub scope_hint: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningCandidate {
    #[serde(default = "default_new_effect")]
    pub effect: String,
    #[serde(default)]
    pub match_rule_id: String,
    #[serde(default)]
    pub dimension: String,
    #[serde(default)]
    pub polarity: String,
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub evidence_quote: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyLearningRequest {
    pub event_id: String,
    #[serde(default)]
    pub candidates: Vec<LearningCandidate>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundationRequest {
    pub foundation: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricRequest {
    pub rubric: Vec<RubricCriterion>,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRuleRequest {
    pub rule_id: String,
    pub instruction: String,
    pub polarity: String,
    #[serde(default)]
    pub roles: Vec<String>,
    pub active: bool,
    pub locked: bool,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadConfig {
    #[serde(default)]
    pub model_id: String,
    #[serde(default)]
    pub runtime: String,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub context_window: u64,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default)]
    pub response_format: String,
    #[serde(default)]
    pub response_schema: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadRun {
    pub schema: String,
    pub id: String,
    pub workload_id: String,
    pub role: String,
    pub project_id: String,
    pub draft_id: String,
    pub production_id: String,
    pub skill_name: String,
    pub skill_version: String,
    pub profile_revision: u64,
    pub phase: String,
    pub config: WorkloadConfig,
    pub system_prompt: String,
    pub user_prompt: String,
    pub output: String,
    pub error: String,
    pub duration_ms: u64,
    pub validation_status: String,
    pub artifact_type: String,
    pub artifact_id: String,
    pub started_at: String,
    pub completed_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub human_verdict: String,
    #[serde(default)]
    pub human_note: String,
    #[serde(default)]
    pub feedback_event_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadSummary {
    pub id: String,
    pub workload_id: String,
    pub role: String,
    pub project_id: String,
    pub draft_id: String,
    pub production_id: String,
    pub skill_name: String,
    pub skill_version: String,
    pub profile_revision: u64,
    pub phase: String,
    pub config: WorkloadConfig,
    pub duration_ms: u64,
    pub validation_status: String,
    pub artifact_type: String,
    pub artifact_id: String,
    pub output_excerpt: String,
    pub error: String,
    pub started_at: String,
    pub completed_at: String,
    pub human_verdict: String,
    pub human_note: String,
    pub feedback_event_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadRequest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub workload_id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub production_id: String,
    #[serde(default)]
    pub skill_name: String,
    #[serde(default)]
    pub skill_version: String,
    #[serde(default)]
    pub config: WorkloadConfig,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub user_prompt: String,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub validation_status: String,
    #[serde(default)]
    pub artifact_type: String,
    #[serde(default)]
    pub artifact_id: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveCheck {
    pub id: String,
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionScore {
    pub criterion_id: String,
    pub score: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationExperiment {
    pub schema: String,
    pub id: String,
    pub source_workload_id: String,
    pub workload_id: String,
    pub role: String,
    pub project_id: String,
    pub draft_id: String,
    pub baseline_config: WorkloadConfig,
    pub candidate_config: WorkloadConfig,
    pub baseline_output: String,
    pub candidate_output: String,
    pub candidate_error: String,
    pub candidate_duration_ms: u64,
    pub status: String,
    pub baseline_objective_checks: Vec<ObjectiveCheck>,
    pub candidate_objective_checks: Vec<ObjectiveCheck>,
    #[serde(default)]
    pub baseline_scores: Vec<CriterionScore>,
    #[serde(default)]
    pub candidate_scores: Vec<CriterionScore>,
    pub baseline_weighted_score: f64,
    pub candidate_weighted_score: f64,
    pub winner: String,
    pub review_note: String,
    #[serde(default)]
    pub selected_for_future_work: bool,
    pub created_at: String,
    pub reviewed_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSummary {
    pub id: String,
    pub source_workload_id: String,
    pub workload_id: String,
    pub role: String,
    pub project_id: String,
    pub baseline_config: WorkloadConfig,
    pub candidate_config: WorkloadConfig,
    pub baseline_output_excerpt: String,
    pub candidate_output_excerpt: String,
    pub candidate_error: String,
    pub status: String,
    pub baseline_objective_checks: Vec<ObjectiveCheck>,
    pub candidate_objective_checks: Vec<ObjectiveCheck>,
    pub baseline_weighted_score: f64,
    pub candidate_weighted_score: f64,
    pub winner: String,
    pub review_note: String,
    pub selected_for_future_work: bool,
    pub created_at: String,
    pub reviewed_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRequest {
    #[serde(default)]
    pub source_workload_id: String,
    #[serde(default)]
    pub candidate_config: WorkloadConfig,
    #[serde(default)]
    pub candidate_output: String,
    #[serde(default)]
    pub candidate_error: String,
    #[serde(default)]
    pub candidate_duration_ms: u64,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewExperimentRequest {
    #[serde(default)]
    pub experiment_id: String,
    #[serde(default)]
    pub baseline_scores: Vec<CriterionScore>,
    #[serde(default)]
    pub candidate_scores: Vec<CriterionScore>,
    #[serde(default)]
    pub winner: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub selected_for_future_work: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProposalRequest {
    #[serde(default)]
    pub proposal_id: String,
    #[serde(default)]
    pub decision: String,
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub dimension: String,
    #[serde(default)]
    pub polarity: String,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub draft_id: String,
    #[serde(default)]
    pub occurred_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadDetailRequest {
    #[serde(default)]
    pub workload_run_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDetailRequest {
    #[serde(default)]
    pub experiment_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteSnapshot {
    pub profile: TasteProfile,
    pub recent_events: Vec<FeedbackEvent>,
    pub recent_workloads: Vec<WorkloadSummary>,
    pub recent_experiments: Vec<ExperimentSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReceipt {
    pub event_id: String,
    pub snapshot: TasteSnapshot,
}

fn default_true() -> bool {
    true
}

fn default_new_effect() -> String {
    "new".to_string()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn clean(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn unique_clean(values: &[String], allowed: &[&str], max: usize) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let item = clean(value, 80).to_lowercase();
        if item.is_empty() {
            continue;
        }
        if !allowed.contains(&item.as_str()) {
            return Err(format!("unsupported value: {item}"));
        }
        if seen.insert(item.clone()) {
            out.push(item);
        }
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

fn default_rubric() -> Vec<RubricCriterion> {
    vec![
        RubricCriterion {
            id: "direction".into(),
            label: "My direction".into(),
            question: "Does it visibly follow my latest explicit direction?".into(),
            weight: 5,
            locked: true,
        },
        RubricCriterion {
            id: "specificity".into(),
            label: "Specificity".into(),
            question: "Are the choices concrete and particular instead of generic or templated?".into(),
            weight: 4,
            locked: false,
        },
        RubricCriterion {
            id: "authorship".into(),
            label: "Authorship".into(),
            question: "Does it feel deliberately authored rather than like default AI output?".into(),
            weight: 4,
            locked: false,
        },
        RubricCriterion {
            id: "physical_truth".into(),
            label: "Physical truth".into(),
            question: "Do bodies, objects, space, light, time, and cause-and-effect behave coherently?".into(),
            weight: 3,
            locked: false,
        },
        RubricCriterion {
            id: "approved_evidence".into(),
            label: "Approved evidence".into(),
            question: "Does it preserve the patterns I approved and avoid the patterns I rejected?".into(),
            weight: 4,
            locked: false,
        },
        RubricCriterion {
            id: "purpose".into(),
            label: "Purpose".into(),
            question: "Does every noticeable choice serve this film rather than merely decorate it?".into(),
            weight: 4,
            locked: false,
        },
    ]
}

impl Default for TasteProfile {
    fn default() -> Self {
        Self {
            schema: PROFILE_SCHEMA.into(),
            revision: 0,
            foundation: String::new(),
            rubric: default_rubric(),
            rules: Vec::new(),
            pending: Vec::new(),
            feedback_count: 0,
            processed_event_ids: Vec::new(),
            updated_at: now_iso(),
        }
    }
}

fn next_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        Utc::now().timestamp_millis(),
        EVENT_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn taste_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("taste-os"))
        .map_err(|error| format!("TasteOS application-data path is unavailable: {error}"))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create TasteOS data directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("could not secure TasteOS data directory: {error}"))?;
    }
    Ok(())
}

fn open_private(path: &Path, append: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("could not open private TasteOS file: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not secure TasteOS file: {error}"))?;
    }
    Ok(file)
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "TasteOS path has no parent".to_string())?;
    ensure_dir(parent)?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("taste-os"),
        next_id("write")
    ));
    let result = (|| {
        let mut file = open_private(&temp, false)?;
        serde_json::to_writer_pretty(&mut file, value)
            .map_err(|error| format!("could not serialize TasteOS state: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("could not finish TasteOS state: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not sync TasteOS state: {error}"))?;
        fs::rename(&temp, path)
            .map_err(|error| format!("could not commit TasteOS state: {error}"))?;
        #[cfg(unix)]
        {
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("could not sync TasteOS directory: {error}"))?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn read_events(dir: &Path) -> Result<Vec<FeedbackEvent>, String> {
    let path = dir.join("events.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(&path)
        .map_err(|error| format!("could not read TasteOS feedback log: {error}"))?;
    let mut out = Vec::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| format!("could not read TasteOS event: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let event: FeedbackEvent = serde_json::from_str(&line).map_err(|error| {
            format!("TasteOS feedback log is invalid at line {}: {error}", index + 1)
        })?;
        out.push(event);
    }
    Ok(out)
}

fn append_event(dir: &Path, event: &FeedbackEvent) -> Result<(), String> {
    ensure_dir(dir)?;
    let path = dir.join("events.jsonl");
    let mut file = open_private(&path, true)?;
    serde_json::to_writer(&mut file, event)
        .map_err(|error| format!("could not serialize TasteOS feedback: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("could not append TasteOS feedback: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("could not sync TasteOS feedback: {error}"))
}

fn read_json_lines<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(path).map_err(|error| format!("could not read {label}: {error}"))?;
    let mut out = Vec::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| format!("could not read {label}: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        out.push(serde_json::from_str(&line).map_err(|error| {
            format!("{label} is invalid at line {}: {error}", index + 1)
        })?);
    }
    Ok(out)
}

fn append_json_line<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} path has no parent"))?;
    ensure_dir(parent)?;
    let mut file = open_private(path, true)?;
    serde_json::to_writer(&mut file, value)
        .map_err(|error| format!("could not serialize {label}: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("could not append {label}: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("could not sync {label}: {error}"))
}

fn clean_workload_config(config: WorkloadConfig) -> WorkloadConfig {
    WorkloadConfig {
        model_id: clean(&config.model_id, 240),
        runtime: clean(&config.runtime, 40).to_lowercase(),
        temperature: if config.temperature.is_finite() {
            config.temperature.clamp(0.0, 2.0)
        } else {
            0.0
        },
        context_window: config.context_window.min(2_000_000),
        thinking: config.thinking,
        response_format: clean(&config.response_format, 40).to_lowercase(),
        response_schema: clean(&config.response_schema, 32_000),
    }
}

fn clean_workload_request(request: WorkloadRequest, profile_revision: u64) -> Result<WorkloadRun, String> {
    let phase = clean(&request.phase, 20).to_lowercase();
    if !["started", "completed", "failed", "cancelled"].contains(&phase.as_str()) {
        return Err("workload phase must be started, completed, failed, or cancelled".into());
    }
    let role = clean(&request.role, 80).to_lowercase();
    if !role.is_empty() && !ALLOWED_ROLES.contains(&role.as_str()) {
        return Err("workload named an unknown crew role".into());
    }
    let workload_id = clean(&request.workload_id, 240).to_lowercase();
    if workload_id.is_empty() {
        return Err("workload requires a stable workloadId".into());
    }
    let id = if request.id.trim().is_empty() {
        next_id("workload")
    } else {
        clean(&request.id, 240)
    };
    let now = if request.occurred_at.trim().is_empty() {
        now_iso()
    } else {
        clean(&request.occurred_at, 80)
    };
    Ok(WorkloadRun {
        schema: WORKLOAD_SCHEMA.into(),
        id,
        workload_id,
        role,
        project_id: clean(&request.project_id, 240),
        draft_id: clean(&request.draft_id, 240),
        production_id: clean(&request.production_id, 240),
        skill_name: clean(&request.skill_name, 240),
        skill_version: clean(&request.skill_version, 80),
        profile_revision,
        phase,
        config: clean_workload_config(request.config),
        system_prompt: clean(&request.system_prompt, 160_000),
        user_prompt: clean(&request.user_prompt, 160_000),
        output: clean(&request.output, 160_000),
        error: clean(&request.error, 8_000),
        duration_ms: request.duration_ms.min(86_400_000),
        validation_status: clean(&request.validation_status, 40).to_lowercase(),
        artifact_type: clean(&request.artifact_type, 80).to_lowercase(),
        artifact_id: clean(&request.artifact_id, 240),
        started_at: if request.phase == "started" { now.clone() } else { String::new() },
        completed_at: if request.phase == "started" { String::new() } else { now.clone() },
        updated_at: now,
        human_verdict: String::new(),
        human_note: String::new(),
        feedback_event_id: String::new(),
    })
}

fn read_workload_events(dir: &Path) -> Result<Vec<WorkloadRun>, String> {
    read_json_lines(&dir.join("workloads.jsonl"), "TasteOS workload log")
}

fn fold_workloads(events: Vec<WorkloadRun>) -> Vec<WorkloadRun> {
    let mut order = Vec::new();
    let mut runs: HashMap<String, WorkloadRun> = HashMap::new();
    for event in events {
        if !runs.contains_key(&event.id) {
            order.push(event.id.clone());
        }
        runs.entry(event.id.clone())
            .and_modify(|current| {
                if current.started_at.is_empty() && !event.started_at.is_empty() {
                    current.started_at = event.started_at.clone();
                }
                if !event.completed_at.is_empty() {
                    current.completed_at = event.completed_at.clone();
                }
                current.phase = event.phase.clone();
                current.updated_at = event.updated_at.clone();
                current.duration_ms = event.duration_ms;
                if !event.output.is_empty() { current.output = event.output.clone(); }
                if !event.error.is_empty() { current.error = event.error.clone(); }
                if !event.validation_status.is_empty() { current.validation_status = event.validation_status.clone(); }
                if !event.artifact_type.is_empty() { current.artifact_type = event.artifact_type.clone(); }
                if !event.artifact_id.is_empty() { current.artifact_id = event.artifact_id.clone(); }
                if !event.human_verdict.is_empty() { current.human_verdict = event.human_verdict.clone(); }
                if !event.human_note.is_empty() { current.human_note = event.human_note.clone(); }
                if !event.feedback_event_id.is_empty() { current.feedback_event_id = event.feedback_event_id.clone(); }
            })
            .or_insert(event);
    }
    order.into_iter().filter_map(|id| runs.remove(&id)).collect()
}

fn record_workload_at(dir: &Path, request: WorkloadRequest) -> Result<WorkloadRun, String> {
    ensure_dir(dir)?;
    let profile = load_profile(dir)?;
    let mut event = clean_workload_request(request, profile.revision)?;
    let existing = fold_workloads(read_workload_events(dir)?)
        .into_iter()
        .find(|run| run.id == event.id);
    if event.phase != "started" && existing.is_none() {
        return Err("workload completion references an unknown run".into());
    }
    if let Some(previous) = existing {
        if previous.workload_id != event.workload_id || previous.role != event.role {
            return Err("workload completion does not match its started identity".into());
        }
        event.project_id = previous.project_id;
        event.draft_id = previous.draft_id;
        event.production_id = previous.production_id;
        event.skill_name = previous.skill_name;
        event.skill_version = previous.skill_version;
        event.profile_revision = previous.profile_revision;
        event.config = previous.config;
        event.system_prompt = previous.system_prompt;
        event.user_prompt = previous.user_prompt;
        event.started_at = previous.started_at;
    }
    append_json_line(&dir.join("workloads.jsonl"), &event, "TasteOS workload")?;
    Ok(fold_workloads(read_workload_events(dir)?)
        .into_iter()
        .find(|run| run.id == event.id)
        .unwrap_or(event))
}

fn objective_checks(workload: &WorkloadRun, output: &str, error: &str) -> Vec<ObjectiveCheck> {
    let text = output.trim();
    let mut checks = vec![
        ObjectiveCheck { id: "completed".into(), label: "Model returned an artifact".into(), passed: error.trim().is_empty() && !text.is_empty(), detail: clean(error, 500) },
        ObjectiveCheck { id: "not_boilerplate".into(), label: "Artifact is substantive".into(), passed: text.chars().count() >= 40, detail: format!("{} characters", text.chars().count()) },
        ObjectiveCheck { id: "no_fake_side_effect".into(), label: "No invented file/tool completion".into(), passed: !contains_fake_side_effect(text), detail: String::new() },
    ];
    if workload.config.response_format == "json" || workload.config.response_format == "json_schema" {
        let parsed = serde_json::from_str::<serde_json::Value>(text).is_ok();
        checks.push(ObjectiveCheck { id: "valid_json".into(), label: "Structured response parses".into(), passed: parsed, detail: String::new() });
    }
    checks
}

fn contains_fake_side_effect(value: &str) -> bool {
    let lower = value.to_lowercase();
    ["file created", "saved to /", "wrote the file", "downloaded to", "uploaded to"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn read_experiments(dir: &Path) -> Result<Vec<EvaluationExperiment>, String> {
    let path = dir.join("experiments.json");
    if !path.exists() { return Ok(Vec::new()); }
    let bytes = fs::read(&path).map_err(|error| format!("could not read TasteOS experiments: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("TasteOS experiments are invalid: {error}"))
}

fn save_experiments(dir: &Path, experiments: &[EvaluationExperiment]) -> Result<(), String> {
    atomic_write_json(&dir.join("experiments.json"), &experiments)
}

fn record_experiment_at(dir: &Path, request: ExperimentRequest) -> Result<EvaluationExperiment, String> {
    ensure_dir(dir)?;
    let workload = fold_workloads(read_workload_events(dir)?)
        .into_iter()
        .find(|run| run.id == request.source_workload_id)
        .ok_or_else(|| "experiment references an unknown workload".to_string())?;
    if !["completed", "reviewed"].contains(&workload.phase.as_str()) || workload.output.trim().is_empty() {
        return Err("only a completed workload with an artifact can be evaluated".into());
    }
    let candidate_config = clean_workload_config(request.candidate_config);
    if candidate_config.model_id.is_empty() {
        return Err("experiment requires a candidate model".into());
    }
    let now = if request.occurred_at.trim().is_empty() { now_iso() } else { clean(&request.occurred_at, 80) };
    let experiment = EvaluationExperiment {
        schema: EXPERIMENT_SCHEMA.into(), id: next_id("experiment"),
        source_workload_id: workload.id.clone(), workload_id: workload.workload_id.clone(), role: workload.role.clone(),
        project_id: workload.project_id.clone(), draft_id: workload.draft_id.clone(), baseline_config: workload.config.clone(),
        candidate_config, baseline_output: workload.output.clone(), candidate_output: clean(&request.candidate_output, 160_000),
        candidate_error: clean(&request.candidate_error, 8_000), candidate_duration_ms: request.candidate_duration_ms.min(86_400_000),
        status: "awaiting_review".into(),
        baseline_objective_checks: objective_checks(&workload, &workload.output, &workload.error),
        candidate_objective_checks: objective_checks(&workload, &request.candidate_output, &request.candidate_error),
        baseline_scores: Vec::new(), candidate_scores: Vec::new(), baseline_weighted_score: 0.0, candidate_weighted_score: 0.0,
        winner: String::new(), review_note: String::new(), selected_for_future_work: false,
        created_at: now.clone(), reviewed_at: String::new(), updated_at: now,
    };
    let mut experiments = read_experiments(dir)?;
    experiments.push(experiment.clone());
    if experiments.len() > 500 { let drain = experiments.len() - 500; experiments.drain(0..drain); }
    save_experiments(dir, &experiments)?;
    Ok(experiment)
}

fn score_experiment(rubric: &[RubricCriterion], scores: &[CriterionScore]) -> Result<f64, String> {
    let mut seen = HashSet::new();
    let mut total = 0.0;
    let mut weight = 0.0;
    for score in scores {
        if score.score > 5 || !seen.insert(score.criterion_id.clone()) {
            return Err("experiment scores must be unique values from 0 to 5".into());
        }
        let criterion = rubric.iter().find(|row| row.id == score.criterion_id)
            .ok_or_else(|| "experiment score names an unknown rubric criterion".to_string())?;
        total += f64::from(score.score) * f64::from(criterion.weight);
        weight += 5.0 * f64::from(criterion.weight);
    }
    if weight == 0.0 { return Err("experiment review needs at least one weighted rubric score".into()); }
    Ok(total / weight)
}

fn review_experiment_at(dir: &Path, request: ReviewExperimentRequest) -> Result<EvaluationExperiment, String> {
    let mut experiments = read_experiments(dir)?;
    let index = experiments.iter().position(|row| row.id == request.experiment_id)
        .ok_or_else(|| "TasteOS experiment was not found".to_string())?;
    if !["baseline", "candidate", "tie", "neither"].contains(&request.winner.as_str()) {
        return Err("experiment winner must be baseline, candidate, tie, or neither".into());
    }
    let profile = load_profile(dir)?;
    let baseline = score_experiment(&profile.rubric, &request.baseline_scores)?;
    let candidate = score_experiment(&profile.rubric, &request.candidate_scores)?;
    if request.selected_for_future_work && request.winner != "candidate" {
        return Err("only a human-selected candidate winner can be recommended for future work".into());
    }
    let row = &mut experiments[index];
    row.baseline_scores = request.baseline_scores;
    row.candidate_scores = request.candidate_scores;
    row.baseline_weighted_score = baseline;
    row.candidate_weighted_score = candidate;
    row.winner = request.winner;
    row.review_note = clean(&request.note, 8_000);
    row.selected_for_future_work = request.selected_for_future_work;
    row.status = "reviewed".into();
    row.reviewed_at = now_iso(); row.updated_at = row.reviewed_at.clone();
    let result = row.clone();
    save_experiments(dir, &experiments)?;
    Ok(result)
}

fn load_profile(dir: &Path) -> Result<TasteProfile, String> {
    let path = dir.join("profile.json");
    if !path.exists() {
        return Ok(TasteProfile::default());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("could not read TasteOS profile: {error}"))?;
    let mut profile: TasteProfile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("TasteOS profile is invalid: {error}"))?;
    if profile.schema != PROFILE_SCHEMA {
        return Err(format!("unsupported TasteOS profile schema: {}", profile.schema));
    }
    if profile.rubric.is_empty() {
        profile.rubric = default_rubric();
    }
    Ok(profile)
}

fn save_profile(dir: &Path, profile: &TasteProfile) -> Result<(), String> {
    let revisions = dir.join("revisions");
    ensure_dir(&revisions)?;
    atomic_write_json(
        &revisions.join(format!("revision-{:08}.json", profile.revision)),
        profile,
    )?;
    atomic_write_json(&dir.join("profile.json"), profile)
}

fn snapshot_from_dir(dir: &Path) -> Result<TasteSnapshot, String> {
    ensure_dir(dir)?;
    let mut profile = load_profile(dir)?;
    let events = read_events(dir)?;
    profile.feedback_count = events.len() as u64;
    let start = events.len().saturating_sub(MAX_EVENTS_RETURNED);
    let workloads = fold_workloads(read_workload_events(dir)?);
    let workload_start = workloads.len().saturating_sub(MAX_WORKLOADS_RETURNED);
    let experiments = read_experiments(dir)?;
    let experiment_start = experiments.len().saturating_sub(MAX_EXPERIMENTS_RETURNED);
    Ok(TasteSnapshot {
        profile,
        recent_events: events[start..].to_vec(),
        recent_workloads: workloads[workload_start..].iter().map(workload_summary).collect(),
        recent_experiments: experiments[experiment_start..].iter().map(experiment_summary).collect(),
    })
}

fn workload_summary(run: &WorkloadRun) -> WorkloadSummary {
    WorkloadSummary {
        id: run.id.clone(), workload_id: run.workload_id.clone(), role: run.role.clone(), project_id: run.project_id.clone(),
        draft_id: run.draft_id.clone(), production_id: run.production_id.clone(), skill_name: run.skill_name.clone(),
        skill_version: run.skill_version.clone(), profile_revision: run.profile_revision, phase: run.phase.clone(),
        config: WorkloadConfig { response_schema: String::new(), ..run.config.clone() }, duration_ms: run.duration_ms,
        validation_status: run.validation_status.clone(), artifact_type: run.artifact_type.clone(), artifact_id: run.artifact_id.clone(),
        output_excerpt: clean(&run.output, 2_000), error: clean(&run.error, 1_000), started_at: run.started_at.clone(),
        completed_at: run.completed_at.clone(), human_verdict: run.human_verdict.clone(), human_note: clean(&run.human_note, 1_000),
        feedback_event_id: run.feedback_event_id.clone(),
    }
}

fn experiment_summary(row: &EvaluationExperiment) -> ExperimentSummary {
    ExperimentSummary {
        id: row.id.clone(), source_workload_id: row.source_workload_id.clone(), workload_id: row.workload_id.clone(),
        role: row.role.clone(), project_id: row.project_id.clone(),
        baseline_config: WorkloadConfig { response_schema: String::new(), ..row.baseline_config.clone() },
        candidate_config: WorkloadConfig { response_schema: String::new(), ..row.candidate_config.clone() },
        baseline_output_excerpt: clean(&row.baseline_output, 8_000),
        candidate_output_excerpt: clean(&row.candidate_output, 8_000),
        candidate_error: clean(&row.candidate_error, 1_000),
        status: row.status.clone(), baseline_objective_checks: row.baseline_objective_checks.clone(),
        candidate_objective_checks: row.candidate_objective_checks.clone(), baseline_weighted_score: row.baseline_weighted_score,
        candidate_weighted_score: row.candidate_weighted_score, winner: row.winner.clone(), review_note: row.review_note.clone(),
        selected_for_future_work: row.selected_for_future_work, created_at: row.created_at.clone(), reviewed_at: row.reviewed_at.clone(),
    }
}

fn validate_feedback(request: &FeedbackRequest) -> Result<(), String> {
    let kind = clean(&request.kind, 60);
    let verdict = clean(&request.verdict, 60);
    let note = clean(&request.note, 8_000);
    if kind.is_empty() {
        return Err("TasteOS feedback requires a kind".into());
    }
    if note.is_empty() && verdict.is_empty() {
        return Err("TasteOS feedback requires the filmmaker's words or a verdict".into());
    }
    if !request.role.trim().is_empty()
        && !ALLOWED_ROLES.contains(&request.role.trim().to_lowercase().as_str())
    {
        return Err("TasteOS feedback named an unknown crew role".into());
    }
    Ok(())
}

fn feedback_event(request: FeedbackRequest, revision: u64) -> Result<FeedbackEvent, String> {
    validate_feedback(&request)?;
    let recorded_at = now_iso();
    Ok(FeedbackEvent {
        schema: EVENT_SCHEMA.into(),
        id: next_id("feedback"),
        kind: clean(&request.kind, 60).to_lowercase(),
        source: clean(&request.source, 80).to_lowercase(),
        project_id: clean(&request.project_id, 240),
        draft_id: clean(&request.draft_id, 240),
        artifact_type: clean(&request.artifact_type, 80).to_lowercase(),
        artifact_id: clean(&request.artifact_id, 240),
        role: clean(&request.role, 80).to_lowercase(),
        verdict: clean(&request.verdict, 60).to_lowercase(),
        note: clean(&request.note, 8_000),
        prompt_excerpt: clean(&request.prompt_excerpt, 4_000),
        output_excerpt: clean(&request.output_excerpt, 4_000),
        scope_hint: clean(&request.scope_hint, 40).to_lowercase(),
        occurred_at: if request.occurred_at.trim().is_empty() {
            recorded_at.clone()
        } else {
            clean(&request.occurred_at, 80)
        },
        recorded_at,
        profile_revision: revision,
    })
}

fn push_pending(
    profile: &mut TasteProfile,
    event_id: &str,
    candidate: LearningCandidate,
    reason: impl Into<String>,
) {
    profile.pending.push(PendingProposal {
        id: next_id("proposal"),
        event_id: event_id.to_string(),
        reason: reason.into(),
        candidate,
        created_at: now_iso(),
    });
    if profile.pending.len() > MAX_PENDING {
        let drain = profile.pending.len() - MAX_PENDING;
        profile.pending.drain(0..drain);
    }
}

fn normalize_instruction(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn contains_forbidden_setting_language(value: &str) -> bool {
    let lower = value.to_lowercase();
    [
        "api key",
        "password",
        "credential",
        "billing",
        "provider",
        "model setting",
        "temperature setting",
        "filesystem",
        "system prompt",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

fn candidate_problem(candidate: &LearningCandidate, event: &FeedbackEvent) -> Result<(), String> {
    if !["new", "reinforce", "contradict"].contains(&candidate.effect.as_str()) {
        return Err("effect must be new, reinforce, or contradict".into());
    }
    if !ALLOWED_DIMENSIONS.contains(&candidate.dimension.as_str()) {
        return Err("dimension is outside the creative TasteOS allow-list".into());
    }
    if !["prefer", "avoid", "require"].contains(&candidate.polarity.as_str()) {
        return Err("polarity must be prefer, avoid, or require".into());
    }
    let instruction = clean(&candidate.instruction, 500);
    if instruction.chars().count() < 8 {
        return Err("instruction is too short to be meaningful".into());
    }
    if contains_forbidden_setting_language(&instruction) {
        return Err("proposal attempts to change operational settings rather than taste".into());
    }
    unique_clean(&candidate.roles, ALLOWED_ROLES, 12)?;
    let quote = clean(&candidate.evidence_quote, 800);
    if event.note.trim().is_empty() {
        return Err("a verdict without the filmmaker's reason cannot create an automatic rule".into());
    }
    if quote.is_empty() || !event.note.contains(&quote) {
        return Err("evidence quote is not an exact excerpt of the filmmaker's recorded words".into());
    }
    Ok(())
}

fn rules_match(existing: &TasteRule, candidate: &LearningCandidate, roles: &[String]) -> bool {
    existing.dimension == candidate.dimension
        && existing.polarity == candidate.polarity
        && existing.roles == roles
        && normalize_instruction(&existing.instruction)
            == normalize_instruction(&candidate.instruction)
}

fn add_unique(values: &mut Vec<String>, value: &str, max: usize) {
    if !value.is_empty() && !values.iter().any(|item| item == value) {
        values.push(value.to_string());
    }
    if values.len() > max {
        let drain = values.len() - max;
        values.drain(0..drain);
    }
}

fn apply_candidate(
    profile: &mut TasteProfile,
    event: &FeedbackEvent,
    mut candidate: LearningCandidate,
) {
    candidate.effect = clean(&candidate.effect, 30).to_lowercase();
    candidate.match_rule_id = clean(&candidate.match_rule_id, 240);
    candidate.dimension = clean(&candidate.dimension, 80).to_lowercase();
    candidate.polarity = clean(&candidate.polarity, 30).to_lowercase();
    candidate.instruction = clean(&candidate.instruction, 500);
    candidate.scope = clean(&candidate.scope, 30).to_lowercase();
    candidate.evidence_quote = clean(&candidate.evidence_quote, 800);
    candidate.reason = clean(&candidate.reason, 1_000);
    candidate.roles = match unique_clean(&candidate.roles, ALLOWED_ROLES, 12) {
        Ok(roles) => roles,
        Err(error) => {
            push_pending(profile, &event.id, candidate, error);
            return;
        }
    };

    if let Err(reason) = candidate_problem(&candidate, event) {
        push_pending(profile, &event.id, candidate, reason);
        return;
    }

    let matched_index = if !candidate.match_rule_id.is_empty() {
        profile
            .rules
            .iter()
            .position(|rule| rule.id == candidate.match_rule_id)
    } else {
        profile
            .rules
            .iter()
            .position(|rule| rules_match(rule, &candidate, &candidate.roles))
    };

    if candidate.effect != "new" && matched_index.is_none() {
        push_pending(
            profile,
            &event.id,
            candidate,
            "proposal tried to modify a rule that does not exist",
        );
        return;
    }

    if let Some(index) = matched_index {
        let locked = profile.rules[index].locked;
        if locked {
            push_pending(
                profile,
                &event.id,
                candidate,
                "locked rules can be changed only by the filmmaker",
            );
            return;
        }
        let mut conflict = None;
        {
            let rule = &mut profile.rules[index];
            add_unique(&mut rule.evidence_ids, &event.id, 200);
            add_unique(&mut rule.project_ids, &event.project_id, 100);
            if candidate.effect == "contradict" {
                rule.confidence = (rule.confidence - MAX_CONFIDENCE_DELTA).max(0.0);
                if rule.confidence <= 0.25 {
                    rule.active = false;
                }
                conflict = Some(candidate.clone());
            } else {
                let delta = if event.note.trim().is_empty() {
                    0.05
                } else {
                    MAX_CONFIDENCE_DELTA
                };
                rule.confidence = (rule.confidence + delta).min(0.95);
                rule.active = true;
                if rule.source == "learned"
                    && rule.evidence_ids.len() >= 3
                    && rule.project_ids.len() >= 2
                {
                    rule.scope = "global".into();
                }
            }
            rule.updated_at = now_iso();
        }
        if let Some(copy) = conflict {
            push_pending(
                profile,
                &event.id,
                copy,
                "conflicting evidence never silently reverses a learned rule",
            );
        }
        return;
    }

    if profile.rules.len() >= MAX_RULES {
        push_pending(
            profile,
            &event.id,
            candidate,
            "active rule limit reached; the filmmaker must consolidate rules",
        );
        return;
    }

    let explicit_global = matches!(event.kind.as_str(), "explicit_rule" | "foundation")
        && event.scope_hint == "global";
    if event.project_id.is_empty() && !explicit_global {
        push_pending(
            profile,
            &event.id,
            candidate,
            "a learned rule needs a project identity before it can affect agents",
        );
        return;
    }
    let created_at = now_iso();
    profile.rules.push(TasteRule {
        id: next_id("rule"),
        dimension: candidate.dimension,
        polarity: candidate.polarity,
        instruction: candidate.instruction,
        scope: if explicit_global {
            "global".into()
        } else {
            "project".into()
        },
        project_ids: if event.project_id.is_empty() {
            Vec::new()
        } else {
            vec![event.project_id.clone()]
        },
        roles: candidate.roles,
        confidence: if explicit_global { 1.0 } else { 0.35 },
        evidence_ids: vec![event.id.clone()],
        locked: explicit_global,
        active: true,
        source: if explicit_global {
            "explicit".into()
        } else {
            "learned".into()
        },
        created_at: created_at.clone(),
        updated_at: created_at,
    });
}

fn persist_feedback(
    dir: &Path,
    profile: &mut TasteProfile,
    request: FeedbackRequest,
) -> Result<FeedbackEvent, String> {
    let next_revision = profile.revision + 1;
    let event = feedback_event(request, next_revision)?;
    // Evidence is durable before anything can learn from it.
    append_event(dir, &event)?;
    profile.revision = next_revision;
    profile.feedback_count += 1;
    profile.updated_at = now_iso();
    save_profile(dir, profile)?;
    Ok(event)
}

fn load_event(dir: &Path, event_id: &str) -> Result<FeedbackEvent, String> {
    read_events(dir)?
        .into_iter()
        .find(|event| event.id == event_id)
        .ok_or_else(|| "TasteOS learning references an unknown feedback event".into())
}

fn record_feedback_at(dir: &Path, request: FeedbackRequest) -> Result<FeedbackReceipt, String> {
    ensure_dir(dir)?;
    let mut profile = load_profile(dir)?;
    let event = persist_feedback(dir, &mut profile, request)?;
    attach_feedback_to_workload(dir, &event)?;
    Ok(FeedbackReceipt {
        event_id: event.id,
        snapshot: snapshot_from_dir(dir)?,
    })
}

fn apply_learning_at(dir: &Path, request: ApplyLearningRequest) -> Result<TasteSnapshot, String> {
    if request.candidates.len() > MAX_CANDIDATES_PER_EVENT {
        return Err(format!(
            "TasteOS accepts at most {MAX_CANDIDATES_PER_EVENT} candidate changes from one input"
        ));
    }
    ensure_dir(dir)?;
    let mut profile = load_profile(dir)?;
    if profile
        .processed_event_ids
        .iter()
        .any(|event_id| event_id == &request.event_id)
    {
        return snapshot_from_dir(dir);
    }
    let event = load_event(dir, &request.event_id)?;
    for candidate in request.candidates {
        apply_candidate(&mut profile, &event, candidate);
    }
    add_unique(
        &mut profile.processed_event_ids,
        &event.id,
        MAX_PROCESSED_EVENTS,
    );
    profile.revision += 1;
    profile.updated_at = now_iso();
    save_profile(dir, &profile)?;
    snapshot_from_dir(dir)
}

fn validate_rubric(rubric: &[RubricCriterion]) -> Result<Vec<RubricCriterion>, String> {
    if rubric.is_empty() || rubric.len() > 12 {
        return Err("TasteOS rubric must contain between 1 and 12 criteria".into());
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for criterion in rubric {
        let id = clean(&criterion.id, 80).to_lowercase();
        let label = clean(&criterion.label, 120);
        let question = clean(&criterion.question, 500);
        if id.is_empty() || label.is_empty() || question.chars().count() < 8 {
            return Err("each TasteOS rubric criterion needs an id, label, and real question".into());
        }
        if criterion.weight > 5 {
            return Err("TasteOS rubric weights must be between 0 and 5".into());
        }
        if !seen.insert(id.clone()) {
            return Err("TasteOS rubric criterion ids must be unique".into());
        }
        out.push(RubricCriterion {
            id,
            label,
            question,
            weight: criterion.weight,
            locked: criterion.locked,
        });
    }
    Ok(out)
}

fn review_proposal_at(dir: &Path, request: ReviewProposalRequest) -> Result<FeedbackReceipt, String> {
    let mut profile = load_profile(dir)?;
    let index = profile.pending.iter().position(|row| row.id == request.proposal_id)
        .ok_or_else(|| "TasteOS proposal was not found".to_string())?;
    let decision = clean(&request.decision, 20).to_lowercase();
    if !["approve", "dismiss"].contains(&decision.as_str()) {
        return Err("proposal decision must be approve or dismiss".into());
    }
    let pending = profile.pending[index].clone();
    let original_event = load_event(dir, &pending.event_id)?;
    let mut candidate = pending.candidate.clone();
    let instruction = clean(&request.instruction, 500);
    if !instruction.is_empty() { candidate.instruction = instruction; }
    let dimension = clean(&request.dimension, 80).to_lowercase();
    if !dimension.is_empty() { candidate.dimension = dimension; }
    let polarity = clean(&request.polarity, 30).to_lowercase();
    if !polarity.is_empty() { candidate.polarity = polarity; }
    let scope = clean(&request.scope, 20).to_lowercase();
    let mut roles = Vec::new();
    let mut selected_scope = "project".to_string();
    let mut matched = None;
    if decision == "approve" {
        if !request.roles.is_empty() { candidate.roles = unique_clean(&request.roles, ALLOWED_ROLES, 12)?; }
        if !ALLOWED_DIMENSIONS.contains(&candidate.dimension.as_str()) {
            return Err("proposal dimension is outside the creative TasteOS allow-list".into());
        }
        if !["prefer", "avoid", "require"].contains(&candidate.polarity.as_str()) {
            return Err("proposal polarity must be prefer, avoid, or require".into());
        }
        if candidate.instruction.chars().count() < 8 {
            return Err("proposal instruction is too short to be meaningful".into());
        }
        if contains_forbidden_setting_language(&candidate.instruction) {
            return Err("TasteOS proposals cannot change operational settings".into());
        }
        if !scope.is_empty() && !["project", "global"].contains(&scope.as_str()) {
            return Err("proposal scope must be project or global".into());
        }
        roles = unique_clean(&candidate.roles, ALLOWED_ROLES, 12)?;
        selected_scope = if scope.is_empty() { "project".to_string() } else { scope };
        matched = if !candidate.match_rule_id.is_empty() {
            profile.rules.iter().position(|rule| rule.id == candidate.match_rule_id)
        } else {
            profile.rules.iter().position(|rule| rules_match(rule, &candidate, &roles))
        };
        if matched.is_none() && profile.rules.len() >= MAX_RULES {
            return Err("active rule limit reached; consolidate rules before approving this proposal".into());
        }
    }
    let next_revision = profile.revision + 1;
    let event = feedback_event(FeedbackRequest {
        kind: "proposal_review".into(), source: "taste_os_page".into(), project_id: request.project_id,
        draft_id: request.draft_id, artifact_type: "taste_proposal".into(), artifact_id: request.proposal_id.clone(),
        role: "taste".into(), verdict: if decision == "approve" { "approved".into() } else { "dismissed".into() },
        note: if decision == "approve" { candidate.instruction.clone() } else { pending.reason.clone() },
        prompt_excerpt: original_event.prompt_excerpt.clone(), output_excerpt: original_event.output_excerpt.clone(),
        scope_hint: selected_scope.clone(), occurred_at: request.occurred_at,
    }, next_revision)?;
    // The human decision is durable before it can alter the active rule set.
    append_event(dir, &event)?;
    profile.pending.remove(index);
    if decision == "approve" {
        let now = now_iso();
        if let Some(rule_index) = matched {
            let rule = &mut profile.rules[rule_index];
            rule.instruction = candidate.instruction;
            rule.polarity = candidate.polarity;
            rule.roles = roles;
            rule.scope = selected_scope;
            rule.active = true;
            rule.locked = request.locked;
            rule.source = "explicit".into();
            rule.confidence = 1.0;
            rule.updated_at = now;
            add_unique(&mut rule.evidence_ids, &original_event.id, 200);
            add_unique(&mut rule.evidence_ids, &event.id, 200);
            add_unique(&mut rule.project_ids, &original_event.project_id, 100);
        } else {
            profile.rules.push(TasteRule {
                id: next_id("rule"), dimension: candidate.dimension, polarity: candidate.polarity,
                instruction: candidate.instruction, scope: selected_scope.clone(),
                project_ids: if original_event.project_id.is_empty() { Vec::new() } else { vec![original_event.project_id.clone()] },
                roles, confidence: 1.0, evidence_ids: vec![original_event.id, event.id.clone()], locked: request.locked,
                active: true, source: "explicit".into(), created_at: now.clone(), updated_at: now,
            });
        }
    }
    profile.revision = next_revision;
    profile.feedback_count += 1;
    profile.updated_at = now_iso();
    save_profile(dir, &profile)?;
    Ok(FeedbackReceipt { event_id: event.id, snapshot: snapshot_from_dir(dir)? })
}

fn attach_feedback_to_workload(dir: &Path, event: &FeedbackEvent) -> Result<(), String> {
    if event.artifact_id.is_empty() { return Ok(()); }
    let workloads = fold_workloads(read_workload_events(dir)?);
    let match_run = workloads.into_iter().rev().find(|run| {
        run.artifact_id == event.artifact_id
            || (!run.production_id.is_empty() && event.artifact_id == format!("{}:{}", run.production_id, run.role))
    });
    if let Some(mut run) = match_run {
        run.phase = "reviewed".into();
        run.human_verdict = event.verdict.clone();
        run.human_note = event.note.clone();
        run.feedback_event_id = event.id.clone();
        run.updated_at = now_iso();
        append_json_line(&dir.join("workloads.jsonl"), &run, "TasteOS workload review")?;
    }
    Ok(())
}

#[tauri::command]
pub fn taste_os_snapshot(app: tauri::AppHandle) -> Result<TasteSnapshot, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    snapshot_from_dir(&taste_dir(&app)?)
}

#[tauri::command]
pub fn taste_os_record_feedback(
    app: tauri::AppHandle,
    request: FeedbackRequest,
) -> Result<FeedbackReceipt, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    record_feedback_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_set_foundation(
    app: tauri::AppHandle,
    request: FoundationRequest,
) -> Result<FeedbackReceipt, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    let dir = taste_dir(&app)?;
    ensure_dir(&dir)?;
    let mut profile = load_profile(&dir)?;
    let foundation = clean(&request.foundation, 12_000);
    let event = persist_feedback(
        &dir,
        &mut profile,
        FeedbackRequest {
            kind: "foundation".into(),
            source: "taste_os_page".into(),
            project_id: request.project_id,
            draft_id: request.draft_id,
            artifact_type: "taste_profile".into(),
            artifact_id: "foundation".into(),
            role: "taste".into(),
            verdict: "direction".into(),
            note: foundation.clone(),
            prompt_excerpt: String::new(),
            output_excerpt: String::new(),
            scope_hint: "global".into(),
            occurred_at: request.occurred_at,
        },
    )?;
    profile.foundation = foundation;
    profile.revision += 1;
    profile.updated_at = now_iso();
    save_profile(&dir, &profile)?;
    Ok(FeedbackReceipt {
        event_id: event.id,
        snapshot: snapshot_from_dir(&dir)?,
    })
}

#[tauri::command]
pub fn taste_os_set_rubric(
    app: tauri::AppHandle,
    request: RubricRequest,
) -> Result<FeedbackReceipt, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    let dir = taste_dir(&app)?;
    ensure_dir(&dir)?;
    let rubric = validate_rubric(&request.rubric)?;
    let mut profile = load_profile(&dir)?;
    let summary = serde_json::to_string(&rubric)
        .map_err(|error| format!("could not serialize TasteOS rubric: {error}"))?;
    let event = persist_feedback(
        &dir,
        &mut profile,
        FeedbackRequest {
            kind: "rubric".into(),
            source: "taste_os_page".into(),
            project_id: request.project_id,
            draft_id: request.draft_id,
            artifact_type: "taste_profile".into(),
            artifact_id: "rubric".into(),
            role: "taste".into(),
            verdict: "edited".into(),
            note: "The filmmaker edited the TasteOS judgment rubric.".into(),
            prompt_excerpt: String::new(),
            output_excerpt: summary,
            scope_hint: "global".into(),
            occurred_at: request.occurred_at,
        },
    )?;
    // The learner never owns this field. Only this explicit filmmaker command does.
    profile.rubric = rubric;
    profile.revision += 1;
    profile.updated_at = now_iso();
    save_profile(&dir, &profile)?;
    Ok(FeedbackReceipt {
        event_id: event.id,
        snapshot: snapshot_from_dir(&dir)?,
    })
}

#[tauri::command]
pub fn taste_os_apply_learning(
    app: tauri::AppHandle,
    request: ApplyLearningRequest,
) -> Result<TasteSnapshot, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    apply_learning_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_review_rule(
    app: tauri::AppHandle,
    request: ReviewRuleRequest,
) -> Result<FeedbackReceipt, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    let dir = taste_dir(&app)?;
    ensure_dir(&dir)?;
    let mut profile = load_profile(&dir)?;
    let index = profile
        .rules
        .iter()
        .position(|rule| rule.id == request.rule_id)
        .ok_or_else(|| "TasteOS rule was not found".to_string())?;
    let instruction = clean(&request.instruction, 500);
    let polarity = clean(&request.polarity, 30).to_lowercase();
    if instruction.chars().count() < 8 {
        return Err("TasteOS rule needs a meaningful instruction".into());
    }
    if !["prefer", "avoid", "require"].contains(&polarity.as_str()) {
        return Err("TasteOS rule polarity must be prefer, avoid, or require".into());
    }
    if contains_forbidden_setting_language(&instruction) {
        return Err("TasteOS rules cannot change operational settings".into());
    }
    let roles = unique_clean(&request.roles, ALLOWED_ROLES, 12)?;
    let scope_hint = profile.rules[index].scope.clone();
    let event = persist_feedback(
        &dir,
        &mut profile,
        FeedbackRequest {
            kind: "rule_review".into(),
            source: "taste_os_page".into(),
            project_id: request.project_id,
            draft_id: request.draft_id,
            artifact_type: "taste_rule".into(),
            artifact_id: request.rule_id.clone(),
            role: "taste".into(),
            verdict: if request.active { "approved" } else { "disabled" }.into(),
            note: instruction.clone(),
            prompt_excerpt: String::new(),
            output_excerpt: String::new(),
            scope_hint,
            occurred_at: request.occurred_at,
        },
    )?;
    let rule = &mut profile.rules[index];
    rule.instruction = instruction;
    rule.polarity = polarity;
    rule.roles = roles;
    rule.active = request.active;
    rule.locked = request.locked;
    rule.source = "explicit".into();
    rule.confidence = 1.0;
    rule.updated_at = now_iso();
    add_unique(&mut rule.evidence_ids, &event.id, 200);
    profile.revision += 1;
    profile.updated_at = now_iso();
    save_profile(&dir, &profile)?;
    Ok(FeedbackReceipt {
        event_id: event.id,
        snapshot: snapshot_from_dir(&dir)?,
    })
}

#[tauri::command]
pub fn taste_os_record_workload(
    app: tauri::AppHandle,
    request: WorkloadRequest,
) -> Result<WorkloadRun, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    record_workload_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_record_experiment(
    app: tauri::AppHandle,
    request: ExperimentRequest,
) -> Result<EvaluationExperiment, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    record_experiment_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_review_experiment(
    app: tauri::AppHandle,
    request: ReviewExperimentRequest,
) -> Result<EvaluationExperiment, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    review_experiment_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_review_proposal(
    app: tauri::AppHandle,
    request: ReviewProposalRequest,
) -> Result<FeedbackReceipt, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    review_proposal_at(&taste_dir(&app)?, request)
}

#[tauri::command]
pub fn taste_os_workload_detail(
    app: tauri::AppHandle,
    request: WorkloadDetailRequest,
) -> Result<WorkloadRun, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    fold_workloads(read_workload_events(&taste_dir(&app)?)?)
        .into_iter()
        .find(|run| run.id == request.workload_run_id)
        .ok_or_else(|| "TasteOS workload was not found".to_string())
}

#[tauri::command]
pub fn taste_os_experiment_detail(
    app: tauri::AppHandle,
    request: ExperimentDetailRequest,
) -> Result<EvaluationExperiment, String> {
    let _guard = TASTE_OS_LOCK
        .lock()
        .map_err(|_| "TasteOS state lock is poisoned".to_string())?;
    read_experiments(&taste_dir(&app)?)?
        .into_iter()
        .find(|row| row.id == request.experiment_id)
        .ok_or_else(|| "TasteOS experiment was not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agentic-movie-studio-taste-os-{name}-{}",
            next_id("test")
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn feedback(project: &str, note: &str) -> FeedbackRequest {
        FeedbackRequest {
            kind: "take_judgment".into(),
            source: "takes".into(),
            project_id: project.into(),
            draft_id: "draft-1".into(),
            artifact_type: "take".into(),
            artifact_id: "take-1".into(),
            role: "taste".into(),
            verdict: "kill".into(),
            note: note.into(),
            prompt_excerpt: "generic glossy camera move".into(),
            output_excerpt: String::new(),
            scope_hint: "project".into(),
            occurred_at: now_iso(),
        }
    }

    fn candidate(effect: &str, rule_id: &str, quote: &str) -> LearningCandidate {
        LearningCandidate {
            effect: effect.into(),
            match_rule_id: rule_id.into(),
            dimension: "camera".into(),
            polarity: "avoid".into(),
            instruction: "Avoid decorative camera movement that has no story purpose.".into(),
            scope: "global".into(),
            roles: vec!["director".into(), "camera_operator".into()],
            evidence_quote: quote.into(),
            reason: "The filmmaker rejected purposeless movement.".into(),
        }
    }

    #[test]
    fn one_feedback_event_stays_project_scoped() {
        let dir = temp_dir("project-scope");
        let note = "The camera move is decorative and has no purpose.";
        let receipt = record_feedback_at(&dir, feedback("project-a", note)).unwrap();
        let snapshot = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: receipt.event_id,
                candidates: vec![candidate("new", "", "decorative and has no purpose")],
            },
        )
        .unwrap();
        assert_eq!(snapshot.profile.rules.len(), 1);
        assert_eq!(snapshot.profile.rules[0].scope, "project");
        assert_eq!(snapshot.profile.rules[0].confidence, 0.35);
        assert!(!snapshot.profile.rules[0].locked);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn repeated_cross_project_evidence_promotes_but_never_jumps_confidence() {
        let dir = temp_dir("promote");
        let note = "The camera move is decorative and has no purpose.";
        let first = record_feedback_at(&dir, feedback("project-a", note)).unwrap();
        let first_snapshot = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: first.event_id,
                candidates: vec![candidate("new", "", "decorative and has no purpose")],
            },
        )
        .unwrap();
        let rule_id = first_snapshot.profile.rules[0].id.clone();
        for project in ["project-a", "project-b"] {
            let receipt = record_feedback_at(&dir, feedback(project, note)).unwrap();
            apply_learning_at(
                &dir,
                ApplyLearningRequest {
                    event_id: receipt.event_id,
                    candidates: vec![candidate(
                        "reinforce",
                        &rule_id,
                        "decorative and has no purpose",
                    )],
                },
            )
            .unwrap();
        }
        let snapshot = snapshot_from_dir(&dir).unwrap();
        let rule = &snapshot.profile.rules[0];
        assert_eq!(rule.scope, "global");
        assert_eq!(rule.evidence_ids.len(), 3);
        assert_eq!(rule.project_ids.len(), 2);
        assert!((rule.confidence - 0.59).abs() < 0.001);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn learning_cannot_change_locked_rule_or_operational_settings() {
        let dir = temp_dir("constraints");
        let note = "Do not touch the provider or API key.";
        let receipt = record_feedback_at(&dir, feedback("project-a", note)).unwrap();
        let mut forbidden = candidate("new", "", "provider or API key");
        forbidden.instruction = "Change the provider and API key for this style.".into();
        let snapshot = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: receipt.event_id,
                candidates: vec![forbidden],
            },
        )
        .unwrap();
        assert!(snapshot.profile.rules.is_empty());
        assert_eq!(snapshot.profile.pending.len(), 1);

        let explicit = FeedbackRequest {
            kind: "explicit_rule".into(),
            source: "taste_os_page".into(),
            project_id: "project-a".into(),
            draft_id: "draft-1".into(),
            artifact_type: "taste_rule".into(),
            artifact_id: "new".into(),
            role: "taste".into(),
            verdict: "direction".into(),
            note: "Never announce the emotion in camera language.".into(),
            prompt_excerpt: String::new(),
            output_excerpt: String::new(),
            scope_hint: "global".into(),
            occurred_at: now_iso(),
        };
        let receipt = record_feedback_at(&dir, explicit).unwrap();
        let mut locked_candidate = candidate("new", "", "announce the emotion");
        locked_candidate.instruction = "Avoid announcing the emotion in camera language.".into();
        let snapshot = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: receipt.event_id,
                candidates: vec![locked_candidate],
            },
        )
        .unwrap();
        let locked_id = snapshot.profile.rules[0].id.clone();
        assert!(snapshot.profile.rules[0].locked);

        let conflict = record_feedback_at(
            &dir,
            feedback(
                "project-b",
                "This time I want the camera to announce the emotion.",
            ),
        )
        .unwrap();
        let mut contradiction = candidate("contradict", &locked_id, "announce the emotion");
        contradiction.instruction = "Avoid announcing the emotion in camera language.".into();
        let snapshot = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: conflict.event_id,
                candidates: vec![contradiction],
            },
        )
        .unwrap();
        assert_eq!(snapshot.profile.rules[0].confidence, 1.0);
        assert!(snapshot.profile.rules[0].active);
        assert!(snapshot.profile.pending.len() >= 2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exact_human_quote_is_required_and_apply_is_idempotent() {
        let dir = temp_dir("quote");
        let note = "The frame looks like a generic stock advertisement.";
        let receipt = record_feedback_at(&dir, feedback("project-a", note)).unwrap();
        let bad = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: receipt.event_id.clone(),
                candidates: vec![candidate("new", "", "words I never said")],
            },
        )
        .unwrap();
        assert!(bad.profile.rules.is_empty());
        assert_eq!(bad.profile.pending.len(), 1);
        let again = apply_learning_at(
            &dir,
            ApplyLearningRequest {
                event_id: receipt.event_id,
                candidates: vec![candidate("new", "", "generic stock advertisement")],
            },
        )
        .unwrap();
        assert!(again.profile.rules.is_empty());
        assert_eq!(again.profile.pending.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    fn workload_request(id: &str, phase: &str) -> WorkloadRequest {
        WorkloadRequest {
            id: id.into(), phase: phase.into(), workload_id: "department.production_designer".into(),
            role: "production_designer".into(), project_id: "project-a".into(), draft_id: "draft-1".into(),
            production_id: "production-a".into(), skill_name: "agentic-studio-production-designer".into(),
            skill_version: "1.1.0".into(), config: WorkloadConfig { model_id: "model-a".into(), runtime: "ollama".into(),
                temperature: 0.4, context_window: 8192, thinking: false, response_format: "json".into(), response_schema: "{}".into() },
            system_prompt: "full skill book".into(), user_prompt: "design the established room".into(),
            output: if phase == "completed" { "{\"design\":\"Worn oak and matte plaster define the room.\"}".into() } else { String::new() },
            error: String::new(), duration_ms: if phase == "completed" { 1_250 } else { 0 },
            validation_status: if phase == "completed" { "passed".into() } else { String::new() },
            artifact_type: "look".into(), artifact_id: "production-a:production_designer".into(), occurred_at: now_iso(),
        }
    }

    #[test]
    fn every_canonical_studio_role_including_the_producer_can_record_evidence() {
        assert_eq!(ALLOWED_ROLES.len(), 23);
        assert!(ALLOWED_ROLES.contains(&"producer"));
        let mut request = workload_request("producer-run", "started");
        request.role = "producer".into();
        request.workload_id = "department.producer.route".into();
        request.skill_name = "agentic-studio-producer".into();
        assert_eq!(clean_workload_request(request, 1).unwrap().role, "producer");
    }

    #[test]
    fn workload_ledger_folds_started_and_completed_events_without_secrets() {
        let dir = temp_dir("workloads");
        record_workload_at(&dir, workload_request("run-a", "started")).unwrap();
        let run = record_workload_at(&dir, workload_request("run-a", "completed")).unwrap();
        assert_eq!(run.phase, "completed");
        assert_eq!(run.duration_ms, 1_250);
        assert!(run.started_at.len() > 10);
        assert!(run.output.contains("Worn oak"));
        assert!(!fs::read_to_string(dir.join("workloads.jsonl")).unwrap().contains("api key"));
        let snapshot = snapshot_from_dir(&dir).unwrap();
        assert_eq!(snapshot.recent_workloads.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn experiments_are_offline_until_a_human_scores_and_selects_them() {
        let dir = temp_dir("experiments");
        record_workload_at(&dir, workload_request("run-a", "started")).unwrap();
        record_workload_at(&dir, workload_request("run-a", "completed")).unwrap();
        let experiment = record_experiment_at(&dir, ExperimentRequest {
            source_workload_id: "run-a".into(), candidate_config: WorkloadConfig { model_id: "model-b".into(), runtime: "ollama".into(),
                temperature: 0.4, context_window: 8192, thinking: false, response_format: "json".into(), response_schema: "{}".into() },
            candidate_output: "{\"design\":\"Scuffed oak boards and nicotine-stained plaster carry the room's neglect.\"}".into(),
            candidate_error: String::new(), candidate_duration_ms: 900, occurred_at: now_iso(),
        }).unwrap();
        assert_eq!(experiment.status, "awaiting_review");
        assert!(!experiment.selected_for_future_work);
        let score = |id: &str, value: u8| CriterionScore { criterion_id: id.into(), score: value };
        assert!(review_experiment_at(&dir, ReviewExperimentRequest {
            experiment_id: experiment.id.clone(), baseline_scores: vec![score("direction", 3)], candidate_scores: vec![score("direction", 5)],
            winner: "baseline".into(), note: "Baseline remains canon.".into(), selected_for_future_work: true,
        }).is_err());
        let reviewed = review_experiment_at(&dir, ReviewExperimentRequest {
            experiment_id: experiment.id, baseline_scores: vec![score("direction", 3), score("specificity", 2)],
            candidate_scores: vec![score("direction", 5), score("specificity", 5)], winner: "candidate".into(),
            note: "The candidate is more physically specific.".into(), selected_for_future_work: true,
        }).unwrap();
        assert_eq!(reviewed.status, "reviewed");
        assert!(reviewed.candidate_weighted_score > reviewed.baseline_weighted_score);
        assert!(reviewed.selected_for_future_work);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pending_proposals_require_an_explicit_human_decision() {
        let dir = temp_dir("proposal-review");
        let note = "The camera move is decorative and has no purpose.";
        let receipt = record_feedback_at(&dir, feedback("project-a", note)).unwrap();
        let mut bad_candidate = candidate("contradict", "missing-rule", "decorative and has no purpose");
        bad_candidate.instruction = "Avoid decorative camera movement without story purpose.".into();
        let snapshot = apply_learning_at(&dir, ApplyLearningRequest { event_id: receipt.event_id, candidates: vec![bad_candidate] }).unwrap();
        let proposal_id = snapshot.profile.pending[0].id.clone();
        let reviewed = review_proposal_at(&dir, ReviewProposalRequest {
            proposal_id, decision: "approve".into(), instruction: "Avoid decorative camera movement without story purpose.".into(),
            dimension: "camera".into(), polarity: "avoid".into(), roles: vec!["camera_operator".into()], scope: "global".into(), locked: true,
            project_id: "project-a".into(), draft_id: "draft-1".into(), occurred_at: now_iso(),
        }).unwrap();
        assert!(reviewed.snapshot.profile.pending.is_empty());
        assert_eq!(reviewed.snapshot.profile.rules.len(), 1);
        assert!(reviewed.snapshot.profile.rules[0].locked);
        assert_eq!(reviewed.snapshot.profile.rules[0].source, "explicit");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn profile_and_event_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("permissions");
        record_feedback_at(&dir, feedback("project-a", "This is too generic.")).unwrap();
        let profile_mode = fs::metadata(dir.join("profile.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let events_mode = fs::metadata(dir.join("events.jsonl"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(profile_mode, 0o600);
        assert_eq!(events_mode, 0o600);
        let _ = fs::remove_dir_all(dir);
    }
}
