use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static NEXT_PREVIEW: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub async fn open_print_preview(
    window: WebviewWindow,
    title: String,
    html: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Open print previews from Studio’s Export tab.".into());
    }
    use tauri::Manager;
    let label = format!("print-{}", NEXT_PREVIEW.fetch_add(1, Ordering::Relaxed));
    let document = serde_json::to_string(&html).map_err(|error| error.to_string())?;
    WebviewWindowBuilder::new(
        window.app_handle(),
        label,
        WebviewUrl::App("print-preview.html".into()),
    )
    .title(title)
    .inner_size(900.0, 800.0)
    .initialization_script(format!("window.studioPrintDocument={document};"))
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn print_preview(window: WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("print-") {
        return Err("Choose a document in Export first.".into());
    }
    window.print().map_err(|error| error.to_string())
}
