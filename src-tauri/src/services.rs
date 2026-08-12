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

const SERVICES: [ServiceSpec; 4] = [
    ServiceSpec {
        id: "ollama",
        name: "Ollama",
        port: 11_434,
        health_path: "/api/tags",
    },
    ServiceSpec {
        id: "pitchdeck",
        name: "PitchDeck",
        port: 5_179,
        health_path: "/api/status",
    },
    ServiceSpec {
        id: "phosphene",
        name: "Phosphene",
        port: 8_198,
        health_path: "/status",
    },
    ServiceSpec {
        id: "greenroom",
        name: "Greenroom",
        port: 8_830,
        health_path: "/health",
    },
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceHealth {
    id: &'static str,
    name: &'static str,
    port: u16,
    endpoint: String,
    reachable: bool,
    detail: String,
}

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

#[tauri::command]
pub(crate) fn local_services_health() -> Vec<ServiceHealth> {
    SERVICES.iter().copied().map(check_service).collect()
}

#[tauri::command]
pub(crate) fn start_local_services() -> Result<Vec<ServiceStartResult>, String> {
    let lock = START_STATE.get_or_init(|| Mutex::new(ServiceStarterState::default()));
    let mut state = lock
        .lock()
        .map_err(|_| "The local service starter lock was poisoned.".to_string())?;
    let home = home_dir()?;

    Ok(SERVICES
        .iter()
        .copied()
        .map(|service| start_service_if_needed(service, &home, &mut state))
        .collect())
}

fn check_service(service: ServiceSpec) -> ServiceHealth {
    check_service_with_timeout(service, Duration::from_millis(900))
}

fn check_service_with_timeout(service: ServiceSpec, timeout: Duration) -> ServiceHealth {
    let response = local_http::request(
        service.port,
        "GET",
        service.health_path,
        &[],
        None,
        timeout,
    );
    match response {
        Ok(response) if (200..300).contains(&response.status) => ServiceHealth {
            id: service.id,
            name: service.name,
            port: service.port,
            endpoint: format!("http://127.0.0.1:{}{}", service.port, service.health_path),
            reachable: true,
            detail: format!("HTTP {}", response.status),
        },
        Ok(response) => ServiceHealth {
            id: service.id,
            name: service.name,
            port: service.port,
            endpoint: format!("http://127.0.0.1:{}{}", service.port, service.health_path),
            reachable: false,
            detail: format!("Health endpoint returned HTTP {}", response.status),
        },
        Err(error) => ServiceHealth {
            id: service.id,
            name: service.name,
            port: service.port,
            endpoint: format!("http://127.0.0.1:{}{}", service.port, service.health_path),
            reachable: false,
            detail: error,
        },
    }
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

fn start_service_if_needed(
    service: ServiceSpec,
    home: &Path,
    state: &mut ServiceStarterState,
) -> ServiceStartResult {
    let initial = check_service_with_timeout(service, Duration::from_millis(350));
    if initial.reachable {
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

    let launch = match service.id {
        "ollama" => launch_ollama(home),
        "pitchdeck" => launch_pitchdeck(home),
        "phosphene" => launch_phosphene(home),
        "greenroom" => launch_greenroom(home),
        _ => Err("Unknown local service.".to_string()),
    };

    let (mut child, source) = match launch {
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
        if check_service_with_timeout(service, Duration::from_millis(250)).reachable {
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
    let candidates = ollama_candidates(home);
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
    spawn_detached(command, executable)
}

fn launch_greenroom(home: &Path) -> Result<(Child, PathBuf), String> {
    let candidates = greenroom_candidates(home);
    let install = greenroom_install(home).ok_or_else(|| {
        format!(
            "Greenroom is offline and no complete existing install was found in: {}",
            display_candidates(&candidates)
        )
    })?;
    let script = install.join("start.sh");
    let mut command = Command::new(&script);
    command.current_dir(&install).env("PORT", "8830");
    spawn_detached(command, script)
}

fn launch_pitchdeck(home: &Path) -> Result<(Child, PathBuf), String> {
    let install_candidates = pitchdeck_candidates(home);
    let install = first_install_with(&install_candidates, &["server/index.js", "node_modules"])
        .ok_or_else(|| {
            format!(
                "PitchDeck is offline and no complete existing install was found in: {}",
                display_candidates(&install_candidates)
            )
        })?;
    let node_candidates = pinokio_node_candidates(home);
    let node = first_existing_file(&node_candidates).ok_or_else(|| {
        format!(
            "PitchDeck exists, but no existing Node executable was found in: {}",
            display_candidates(&node_candidates)
        )
    })?;

    let mut command = Command::new(&node);
    command
        .arg(install.join("server/index.js"))
        .current_dir(&install)
        .env("PORT", "5179")
        .env("DIRECTORS_CONSOLE_STATIC", "1")
        .env("NODE_ENV", "production")
        .env("OLLAMA_URL", "http://127.0.0.1:11434")
        .env("PHOSPHENE_URL", "http://127.0.0.1:8198");
    spawn_detached(command, node)
}

fn launch_phosphene(home: &Path) -> Result<(Child, PathBuf), String> {
    let candidates = phosphene_candidates(home);
    let install = first_install_with(
        &candidates,
        &[
            "mlx_ltx_panel.py",
            "ltx-2-mlx/env/bin/python3.11",
            "ltx-2-mlx/env/lib/python3.11/site-packages/certifi/cacert.pem",
            "mlx_models/ltx-2.3-mlx-q4",
            "mlx_models/gemma-3-12b-it-4bit",
        ],
    )
    .ok_or_else(|| {
        format!(
            "Phosphene is offline and no complete existing install was found in: {}",
            display_candidates(&candidates)
        )
    })?;
    let python_candidates = [
        install.join("ltx-2-mlx/env/bin/python3.11"),
        install.join("ltx-2-mlx/env/bin/python"),
    ];
    let python = first_existing_file(&python_candidates)
        .ok_or_else(|| "Phosphene's existing Python environment is missing.".to_string())?;
    let cert_bundle = install.join("ltx-2-mlx/env/lib/python3.11/site-packages/certifi/cacert.pem");
    let ffmpeg_candidates = phosphene_ffmpeg_candidates(home);
    let ffmpeg = first_existing_file(&ffmpeg_candidates).ok_or_else(|| {
        format!(
            "Phosphene exists, but no existing ffmpeg executable was found in: {}",
            display_candidates(&ffmpeg_candidates)
        )
    })?;
    let child_path = executable_path_with_parent_first(&ffmpeg)?;

    let mut command = Command::new(&python);
    command
        .arg(install.join("mlx_ltx_panel.py"))
        .current_dir(&install)
        .env("LTX_PORT", "8198")
        .env("LTX_MODEL", install.join("mlx_models/ltx-2.3-mlx-q4"))
        .env("LTX_MODEL_HQ", install.join("mlx_models/ltx-2.3-mlx-q8"))
        .env("LTX_GEMMA", install.join("mlx_models/gemma-3-12b-it-4bit"))
        .env("LTX_MODELS_DIR", install.join("mlx_models"))
        .env("LTX_Q8_LOCAL", install.join("mlx_models/ltx-2.3-mlx-q8"))
        .env(
            "LTX_HELPER_PYTHON",
            install.join("ltx-2-mlx/env/bin/python3.11"),
        )
        .env("HF_HOME", install.join("cache/HF_HOME"))
        .env("LTX_FFMPEG", &ffmpeg)
        .env("PATH", child_path)
        .env("SSL_CERT_FILE", &cert_bundle)
        .env("REQUESTS_CA_BUNDLE", cert_bundle);
    spawn_detached(command, python)
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

fn pitchdeck_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("Documents/ CODEX BRAIN/Compiled Apps/PitchDeck"),
        home.join("Downloads/PitchDeck"),
    ]
}

fn phosphene_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("pinokio/api/phosphene.git"),
        home.join("Documents/ CODEX BRAIN/Compiled Apps/Phosphene"),
        home.join("Downloads/phosphene.git"),
    ]
}

fn pinokio_node_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("pinokio/bin/miniforge/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ]
}

fn phosphene_ffmpeg_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join("pinokio/bin/homebrew/bin/ffmpeg"),
        home.join("pinokio/bin/ffmpeg-env/bin/ffmpeg"),
        PathBuf::from("/opt/homebrew/bin/ffmpeg"),
        PathBuf::from("/usr/local/bin/ffmpeg"),
    ];
    if let Some(path) = executable_from_path("ffmpeg") {
        candidates.push(path);
    }
    candidates
}

fn executable_path_with_parent_first(executable: &Path) -> Result<OsString, String> {
    let parent = executable
        .parent()
        .ok_or_else(|| format!("Executable has no parent directory: {}", executable.display()))?;
    let mut directories = vec![parent.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&current) {
            if !directories.contains(&directory) {
                directories.push(directory);
            }
        }
    }
    std::env::join_paths(directories)
        .map_err(|error| format!("Could not build the local-service PATH: {error}"))
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
        executable_path_with_parent_first, first_install_with, greenroom_candidates,
        phosphene_ffmpeg_candidates, warming_service_result, ServiceSpec, ServiceStarterState,
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
    fn phosphene_launch_prefers_existing_pinokio_ffmpeg_and_puts_it_on_path() {
        let home = PathBuf::from("/Users/Muse");
        let candidates = phosphene_ffmpeg_candidates(&home);
        assert_eq!(
            candidates[0],
            PathBuf::from("/Users/Muse/pinokio/bin/homebrew/bin/ffmpeg")
        );
        let path = executable_path_with_parent_first(&candidates[0]).unwrap();
        assert_eq!(
            std::env::split_paths(&path).next().unwrap(),
            PathBuf::from("/Users/Muse/pinokio/bin/homebrew/bin")
        );
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
