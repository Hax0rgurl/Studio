use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

static START: Mutex<()> = Mutex::new(());
const WORKER: &str = include_str!("../double-feature/crew.py");

fn studio_python() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("Missing Studio resources")?.join("../Resources/python/bin/python3"))
}

fn library() -> Result<PathBuf, String> {
    let dir = PathBuf::from(std::env::var_os("HOME").ok_or("Missing home directory")?)
        .join("Movies/Agentic Movie Studio/Double Features");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn double_feature_library() -> Result<Vec<Value>, String> {
    let mut runs = Vec::new();
    for entry in fs::read_dir(library()?)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if let Ok(bytes) = fs::read(entry.path().join("run.json")) {
            if let Ok(mut run) = serde_json::from_slice::<Value>(&bytes) {
                run["id"] = json!(entry.file_name().to_string_lossy());
                run["modified"]=json!(entry.path().join("run.json").metadata().ok().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_millis() as u64).unwrap_or(0));
                let mut clips=Vec::new();
                for film in 1..=2 {
                    for shot in 1..=2 {
                        if entry.path().join(format!("film-{film}-shot-{shot}.mp4")).is_file(){
                            clips.push(json!({"film":film,"shot":shot}));
                        }
                    }
                }
                run["clips"]=json!(clips);
                run["folder"]=json!(entry.path());
                if let Ok(bytes)=fs::read(entry.path().join("screening-chat.json")){
                    if let Ok(extra)=serde_json::from_slice::<Vec<Value>>(&bytes){
                        let mut chat=run["chat"].as_array().cloned().unwrap_or_default();
                        chat.extend(extra);run["chat"]=json!(chat);
                    }
                }
                runs.push(run);
            }
        }
    }
    runs.sort_by(|a, b| b["id"].as_str().cmp(&a["id"].as_str()));
    Ok(runs)
}

#[derive(Deserialize)]
pub struct Play {
    name: String,
    text: String,
}

#[tauri::command]
pub fn double_feature_start(
    plays: Vec<Play>,
    text_model: String,
    retry: Option<String>,
    renderer: Option<Value>,
) -> Result<String, String> {
    let _guard = START.lock().map_err(|e| e.to_string())?;
    let dir = library()?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let ff = exe
        .parent()
        .ok_or("Missing executable folder")?
        .join("../Resources/ffmpeg");
    if !ff.is_file() {
        return Err("This build requires the bundled film editor (ffmpeg).".into());
    }
    let new = retry.is_none();
    let id = retry.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string()
    });
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || id.is_empty() {
        return Err("Invalid screening ID".into());
    }
    let folder = dir.join(&id);
    if new {
        if double_feature_library()?.iter().any(|r| {
            let s = r["status"].as_str().unwrap_or("");
            s != "Complete" && !s.starts_with("Stopped")
        }) {
            return Err("A double feature is already in progress.".into());
        }
        if text_model.trim().is_empty() {
            return Err("Select a local vision-capable text model first.".into());
        }
        fs::create_dir(&folder).map_err(|e| e.to_string())?;
        let shelf: Vec<Value> = plays
            .into_iter()
            .map(|p| json!({"name":p.name,"text":p.text}))
            .collect();
        fs::write(
            folder.join("settings.json"),
            json!({"plays":shelf,"textModel":text_model,"renderer":renderer}).to_string(),
        )
        .map_err(|e| e.to_string())?;
        fs::write(
            folder.join("run.json"),
            r#"{"status":"Starting","films":[]}"#,
        )
        .map_err(|e| e.to_string())?;
    }
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(folder.join("worker.log"))
        .map_err(|e| e.to_string())?;
    Command::new(studio_python()?)
        .arg("-c")
        .arg(WORKER)
        .arg(&folder)
        .arg(ff)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn double_feature_play(id: String, number: u8) -> Result<(), String> {
    if id.is_empty()
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        || !(1..=2).contains(&number)
    {
        return Err("Invalid screening".into());
    }
    let path = library()?.join(id).join(format!("Film {number}.mp4"));
    if !path.is_file() {
        return Err("This movie is still in production.".into());
    }
    Command::new("/usr/bin/open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn double_feature_key(token: String, endpoint: Option<String>) -> Result<(), String> {
    use std::io::Write;
    if (endpoint.is_none() && !token.starts_with("sk-sp-")) || token.is_empty() || token.len() > 8192 || token.chars().any(char::is_whitespace) {
        return Err("Enter a Qwen personal Token Plan key.".into());
    }
    let mut child = Command::new(studio_python()?)
        .args(["-c", r#"import ctypes as c, sys
s=c.CDLL('/System/Library/Frameworks/Security.framework/Security')
service=sys.argv[1].encode()
account=b'Studio'
data=sys.stdin.buffer.read()
item=c.c_void_p()
args=(None,len(service),service,len(account),account)
rc=s.SecKeychainFindGenericPassword(*args,None,None,c.byref(item))
if rc==0: rc=s.SecKeychainItemModifyAttributesAndData(item,None,len(data),data)
elif rc==-25300: rc=s.SecKeychainAddGenericPassword(*args,len(data),data,None)
sys.exit(0 if rc==0 else 1)"#]).arg(endpoint.map(|url|format!("Studio.MCP.{url}")).unwrap_or_else(||"Studio.QwenTokenPlan".into()))
        .stdin(Stdio::piped()).spawn().map_err(|e|e.to_string())?;
    child.stdin.take().ok_or("Missing private input")?.write_all(token.as_bytes()).map_err(|e|e.to_string())?;
    if child.wait().map_err(|e|e.to_string())?.success() {Ok(())} else {Err("Could not save the key in Mac Keychain.".into())}
}

fn keychain_action(action: &str) -> Result<bool, String> {
    let status = Command::new("/usr/bin/security")
        .args([action,"-s","Studio.QwenTokenPlan","-a","Studio"])
        .stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|e|e.to_string())?;
    match status.code() {
        Some(0) => Ok(true),
        Some(44) => Ok(false),
        _ => Err("Mac Keychain could not complete the request.".into()),
    }
}
#[tauri::command]
pub fn double_feature_key_saved() -> Result<bool,String> {
    keychain_action("find-generic-password")
}
#[tauri::command]
pub fn double_feature_key_remove() -> Result<(),String> {
    keychain_action("delete-generic-password").map(|_| ())
}

#[tauri::command]
pub async fn studio_mcp_tools(endpoint:String, token:Option<String>, kind:Option<String>, instructions:Option<String>) -> Result<Value,String> {
    use std::io::Write;
    tauri::async_runtime::spawn_blocking(move || {
        let mut child=Command::new(studio_python()?).args(["-c",WORKER,"--tools"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|e|e.to_string())?;
        let data=json!({"url":endpoint,"token":token,"kind":kind,"instructions":instructions,"guide":include_str!("../../src/crew-skills/PROVIDER-SETUP.md")}).to_string();
        child.stdin.take().ok_or("Missing input")?.write_all(data.as_bytes()).map_err(|e|e.to_string())?;
        let output=child.wait_with_output().map_err(|e|e.to_string())?;
        let value:Value=serde_json::from_slice(&output.stdout).map_err(|_|"Plugin discovery failed")?;
        if let Some(error)=value.get("error"){return Err(error.as_str().unwrap_or("Plugin discovery failed").into())}
        Ok(value)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn studio_mcp_forget(endpoint:String)->Result<(),String>{
    let status=Command::new("/usr/bin/security").args(["delete-generic-password","-a","Studio","-s",&format!("Studio.MCP.{endpoint}")]).output().map_err(|e|e.to_string())?.status;
    if status.success()||status.code()==Some(44){Ok(())}else{Err("Could not remove plugin key".into())}
}

#[tauri::command]
pub async fn studio_shot_preview(id:String, film:u8, shot:u8)->Result<String,String>{
    if id.is_empty() || !id.chars().all(|c|c.is_ascii_alphanumeric() || c=='-') || !(1..=2).contains(&film) || !(1..=2).contains(&shot){
        return Err("Invalid shot".into());
    }
    tauri::async_runtime::spawn_blocking(move ||{
        let source=library()?.join(id).join(format!("film-{film}-shot-{shot}.mp4"));
        let ff=std::env::current_exe().map_err(|e|e.to_string())?.parent().ok_or("Missing Studio")?.join("../Resources/ffmpeg");
        let preview=Command::new(ff).arg("-i").arg(source).args(["-loglevel","error","-t","5","-an","-vf","scale=640:-2","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-movflags","frag_keyframe+empty_moov","-f","mp4","pipe:1"]).output().map_err(|e|e.to_string())?;
        if !preview.status.success(){return Err("Could not decode the shot preview.".into());}
        use std::io::Write;
        let mut encoder=Command::new("/usr/bin/base64").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|e|e.to_string())?;
        let mut input=encoder.stdin.take().ok_or("Missing preview stream")?;
        let writer=std::thread::spawn(move||input.write_all(&preview.stdout));
        let output=encoder.wait_with_output().map_err(|e|e.to_string())?;
        writer.join().map_err(|_|"Preview interrupted")?.map_err(|e|e.to_string())?;
        if !output.status.success(){return Err("Preview encoding failed".into());}
        Ok(format!("data:video/mp4;base64,{}",String::from_utf8_lossy(&output.stdout).trim()))
    }).await.map_err(|e|e.to_string())?
}
