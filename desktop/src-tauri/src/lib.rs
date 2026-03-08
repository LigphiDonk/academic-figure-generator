use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SecureSettings {
    claude_api_key: String,
    claude_base_url: String,
    claude_model: String,
    nanobanana_api_key: String,
    nanobanana_base_url: String,
    #[serde(default = "default_nanobanana_model")]
    nanobanana_model: String,
    ocr_server_url: String,
    ocr_token: String,
}

fn default_nanobanana_model() -> String {
    "gemini-2.0-flash-exp-image-generation".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPaths {
    mode: String,
    app_data_dir: String,
    documents_dir: String,
    images_dir: String,
}

fn ensure_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(app_data_dir.join("documents")).map_err(|err| err.to_string())?;
    fs::create_dir_all(app_data_dir.join("images")).map_err(|err| err.to_string())?;
    Ok(app_data_dir)
}

fn secure_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_app_data_dir(app)?.join("secure_settings.json"))
}

#[tauri::command]
fn get_app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    let app_data_dir = ensure_app_data_dir(&app)?;
    Ok(AppPaths {
        mode: "tauri".to_string(),
        app_data_dir: app_data_dir.display().to_string(),
        documents_dir: app_data_dir.join("documents").display().to_string(),
        images_dir: app_data_dir.join("images").display().to_string(),
    })
}

#[tauri::command]
fn load_secure_settings(app: tauri::AppHandle) -> Result<SecureSettings, String> {
    let path = secure_settings_path(&app)?;
    if !path.exists() {
        return Ok(SecureSettings {
            claude_base_url: "https://api.anthropic.com".to_string(),
            claude_model: "claude-sonnet-4-20250514".to_string(),
            nanobanana_base_url: "https://api.keepgo.icu".to_string(),
            nanobanana_model: default_nanobanana_model(),
            ..SecureSettings::default()
        });
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_secure_settings(app: tauri::AppHandle, settings: SecureSettings) -> Result<bool, String> {
    let path = secure_settings_path(&app)?;
    let serialized = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(path, serialized).map_err(|err| err.to_string())?;
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_app_paths,
            load_secure_settings,
            save_secure_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running academic figure generator desktop");
}
