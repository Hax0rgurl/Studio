use crate::local_http;
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

#[derive(Clone, Copy)]
struct ServiceSpec {
    id: &'static str,
    name: &'static str,
    port: u16,
    health_path: &'static str,
}

const LOCAL_MODEL: ServiceSpec = ServiceSpec {
    id: "ollama",
    name: "Ollama",
    port: 11_434,
    health_path: "/api/tags",
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceStartResult {
    id: &'static str,
    name: &'static str,
    outcome: &'static str,
    reachable: bool,
    source: Option<String>,
    detail: String,
}

#[derive(Default)]
struct ServiceStarterState {
    warming: HashMap<&'static str, WarmingProcess>,
}

struct WarmingProcess {
    child: Child,
    source: PathBuf,
}

static START_STATE: OnceLock<Mutex<ServiceStarterState>> = OnceLock::new();

fn reachable(service: ServiceSpec, timeout: Duration) -> bool {
    local_http::request(service.port, "GET", service.health_path, &[], None, timeout)
        .is_ok_and(|response| (200..300).contains(&response.status))
}

fn warming_service_result(
    service: ServiceSpec,
    state: &mut ServiceStarterState,
) -> Option<ServiceStartResult> {
    let (status, source) = {
        let process = state.warming.get_mut(service.id)?;
        (process.child.try_wait(), process.source.clone())
    };
    match status {
        Ok(None) => Some(ServiceStartResult {
            id: service.id,
            name: service.name,
            outcome: "warming",
            reachable: false,
            source: Some(source.display().to_string()),
            detail: "The previously launched process is still warming up; Agentic Movie Studio did not launch a duplicate."
                .to_string(),
        }),
        Ok(Some(_)) => {
            state.warming.remove(service.id);
            None
        }
        Err(error) => {
            state.warming.remove(service.id);
            Some(ServiceStartResult {
                id: service.id,
                name: service.name,
                outcome: "error",
                reachable: false,
                source: Some(source.display().to_string()),
                detail: format!("Could not inspect the warming process: {error}"),
            })
        }
    }
}

fn start_local_model_if_needed(
    home: &Path,
    state: &mut ServiceStarterState,
) -> ServiceStartResult {
    let service = LOCAL_MODEL;
    if reachable(service, Duration::from_millis(350)) {
        state.warming.remove(service.id);
        return ServiceStartResult {
            id: service.id,
            name: service.name,
            outcome: "already",
            reachable: true,
            source: None,
            detail: "Service is already reachable.".to_string(),
        };
    }

    if let Some(result) = warming_service_result(service, state) {
        return result;
    }

    let (mut child, source) = match launch_ollama(home) {
        Ok(value) => value,
        Err(error) => {
            return ServiceStartResult {
                id: service.id,
                name: service.name,
                outcome: "error",
                reachable: false,
                source: None,
                detail: error,
            }
        }
    };

    for _ in 0..16 {
        thread::sleep(Duration::from_millis(150));
        match child.try_wait() {
            Ok(Some(status)) => {
                return ServiceStartResult {
                    id: service.id,
                    name: service.name,
                    outcome: "error",
                    reachable: false,
                    source: Some(source.display().to_string()),
                    detail: format!("Process exited before becoming reachable ({status})."),
                }
            }
            Err(error) => {
                return ServiceStartResult {
                    id: service.id,
                    name: service.name,
                    outcome: "error",
                    reachable: false,
                    source: Some(source.display().to_string()),
                    detail: format!("Could not inspect the launched process: {error}"),
                }
            }
            Ok(None) => {}
        }
        if reachable(service, Duration::from_millis(250)) {
            return ServiceStartResult {
                id: service.id,
                name: service.name,
                outcome: "started",
                reachable: true,
                source: Some(source.display().to_string()),
                detail: "Service started and passed its health check.".to_string(),
            };
        }
    }

    // Retain the child while it warms. Dropping Child would leave the process
    // alive but forget its identity, allowing the next Start/Resume call to
    // launch a second worker before the first one binds its port.
    state.warming.insert(
        service.id,
        WarmingProcess {
            child,
            source: source.clone(),
        },
    );
    ServiceStartResult {
        id: service.id,
        name: service.name,
        outcome: "warming",
        reachable: false,
        source: Some(source.display().to_string()),
        detail: "Process launched and is still warming up; check health again shortly.".to_string(),
    }
}

fn launch_ollama(home: &Path) -> Result<(Child, PathBuf), String> {
    let mut candidates = ollama_candidates(home);
    let resources = std::env::current_exe().ok().and_then(|exe|exe.parent().map(|p|p.join("../Resources")));
    if let Some(bundle)=resources.as_ref(){
        candidates.insert(0,bundle.join("engine/ollama"));
    }
    let executable = first_existing_file(&candidates).ok_or_else(|| {
        format!(
            "Ollama is offline and no existing executable was found in: {}",
            display_candidates(&candidates)
        )
    })?;
    let mut command = Command::new(&executable);
    command
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434");
    if let Some(bundle)=resources.filter(|bundle|executable==bundle.join("engine/ollama")){
        command.env("OLLAMA_MODELS",bundle.join("models")).env("OLLAMA_ORIGINS","tauri://localhost");
    }
    spawn_detached(command, executable)
}

#[tauri::command]
pub(crate) async fn studio_local_brain()->Result<ServiceStartResult,String>{
    tauri::async_runtime::spawn_blocking(||{
        let lock = START_STATE.get_or_init(|| Mutex::new(ServiceStarterState::default()));
        let mut state = lock.lock().map_err(|_| "The model starter is busy.".to_string())?;
        Ok(start_local_model_if_needed(&home_dir()?,&mut state))
    }).await.map_err(|e|e.to_string())?
}

fn spawn_detached(mut command: Command, source: PathBuf) -> Result<(Child, PathBuf), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|child| (child, source.clone()))
        .map_err(|error| format!("Could not launch {}: {error}", source.display()))
}

pub(crate) fn greenroom_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("Documents/ CODEX BRAIN/Compiled Apps/Greenroom"),
        home.join("Downloads/Greenroom"),
        home.join("Downloads/greenroomlocalmodels"),
    ]
}

pub(crate) fn greenroom_install(home: &Path) -> Option<PathBuf> {
    first_install_with(
        &greenroom_candidates(home),
        &[
            "start.sh",
            "filmcrew/crew.state.json",
            "filmcrew/crew.json",
        ],
    )
}

fn ollama_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/usr/local/bin/ollama"),
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
        PathBuf::from("/Applications/Ollama.app/Contents/MacOS/Ollama"),
        home.join(".local/bin/ollama"),
    ];
    if let Some(path) = executable_from_path("ollama") {
        candidates.insert(0, path);
    }
    candidates
}

fn executable_from_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

fn first_existing_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn first_install_with(candidates: &[PathBuf], required: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|root| root.is_dir() && required.iter().all(|path| root.join(path).exists()))
        .cloned()
}

fn display_candidates(candidates: &[PathBuf]) -> String {
    candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn home_dir() -> Result<PathBuf, String> {
    let home: OsString = std::env::var_os("HOME")
        .ok_or_else(|| "The current user's home directory is unavailable.".to_string())?;
    let path = PathBuf::from(home);
    if !path.is_absolute() {
        return Err("The current user's home directory is not absolute.".to_string());
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{
        first_install_with, greenroom_candidates,
        warming_service_result, ServiceSpec, ServiceStarterState,
        WarmingProcess,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    const TEST_SERVICE: ServiceSpec = ServiceSpec {
        id: "test-service",
        name: "Test service",
        port: 65_534,
        health_path: "/health",
    };

    #[test]
    fn greenroom_path_resolution_prefers_codex_brain_then_downloads() {
        let candidates = greenroom_candidates(PathBuf::from("/Users/Muse").as_path());
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Users/Muse/Documents/ CODEX BRAIN/Compiled Apps/Greenroom"),
                PathBuf::from("/Users/Muse/Downloads/Greenroom"),
                PathBuf::from("/Users/Muse/Downloads/greenroomlocalmodels"),
            ]
        );
    }

    #[test]
    fn install_resolution_requires_every_marker_and_preserves_order() {
        let root = std::env::temp_dir().join(format!(
            "studio-service-path-test-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("unnamed")
        ));
        let incomplete = root.join("incomplete");
        let complete = root.join("complete");
        fs::create_dir_all(&incomplete).unwrap();
        fs::create_dir_all(complete.join("filmcrew")).unwrap();
        fs::write(complete.join("start.sh"), "#!/bin/sh\n").unwrap();
        fs::write(complete.join("filmcrew/crew.state.json"), "{}").unwrap();

        let resolved = first_install_with(
            &[incomplete, complete.clone()],
            &["start.sh", "filmcrew/crew.state.json"],
        );
        assert_eq!(resolved, Some(complete));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn desktop_registers_only_the_local_model_launcher() {
        let commands = include_str!("main.rs");
        let services: Vec<_> = commands.lines().map(str::trim)
            .filter(|line| line.starts_with("services::")).collect();
        assert_eq!(services, ["services::studio_local_brain,"]);
    }

    #[test]
    fn a_live_warming_child_suppresses_duplicate_launches() {
        let child = Command::new("/bin/sleep").arg("5").spawn().unwrap();
        let child_id = child.id();
        let mut state = ServiceStarterState::default();
        state.warming.insert(
            TEST_SERVICE.id,
            WarmingProcess {
                child,
                source: PathBuf::from("/bin/sleep"),
            },
        );

        let result = warming_service_result(TEST_SERVICE, &mut state).unwrap();
        assert_eq!(result.outcome, "warming");
        assert!(!result.reachable);
        assert_eq!(state.warming[TEST_SERVICE.id].child.id(), child_id);

        let process = state.warming.get_mut(TEST_SERVICE.id).unwrap();
        process.child.kill().unwrap();
        process.child.wait().unwrap();
    }

    #[test]
    fn an_exited_warming_child_is_cleared_for_a_real_retry() {
        let mut child = Command::new("/usr/bin/true").spawn().unwrap();
        child.wait().unwrap();
        let mut state = ServiceStarterState::default();
        state.warming.insert(
            TEST_SERVICE.id,
            WarmingProcess {
                child,
                source: PathBuf::from("/usr/bin/true"),
            },
        );

        assert!(warming_service_result(TEST_SERVICE, &mut state).is_none());
        assert!(!state.warming.contains_key(TEST_SERVICE.id));
    }
}
