use reqwest::Client;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Mutex;

mod credentials;
mod generator;
mod github;
mod gmail;
mod repos;
mod runs;

pub use repos::DbConn;

// ── Anthropic Chat ───────────────────────────────────────────────────────────
// Calls Anthropic /v1/messages and returns the first text content block.

#[tauri::command]
async fn anthropic_chat(
    api_key: String,
    model: String,
    system: String,
    user_message: String,
    max_tokens: u32,
) -> Result<String, String> {
    let client = Client::new();

    let body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !status.is_success() {
        let msg = data["error"]["message"]
            .as_str()
            .unwrap_or("Unknown Anthropic error");
        return Err(format!("Anthropic API error {}: {}", status, msg));
    }

    let text = data["content"][0]["text"]
        .as_str()
        .ok_or_else(|| "No text content in Anthropic response".to_string())?
        .to_string();

    Ok(text)
}

// ── Apollo People Search ─────────────────────────────────────────────────────

#[tauri::command]
async fn apollo_people_search(
    api_key: String,
    filters: Value,
    person_titles: Vec<String>,
    seniority_levels: Vec<String>,
    page: u32,
    per_page: u32,
) -> Result<Value, String> {
    let client = Client::new();

    let mut body = match filters {
        Value::Object(map) => map,
        _ => return Err("Filters must be a JSON object".to_string()),
    };

    body.insert("person_titles".to_string(), json!(person_titles));
    body.insert("page".to_string(), json!(page));
    body.insert("per_page".to_string(), json!(per_page));

    if !seniority_levels.is_empty() {
        body.insert("person_seniorities".to_string(), json!(seniority_levels));
    }

    let response = client
        .post("https://api.apollo.io/v1/people/search")
        .header("X-Api-Key", &api_key)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-cache")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Apollo request failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Apollo response: {}", e))?;

    if !status.is_success() {
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|data| {
                data["error"].as_str()
                    .or_else(|| data["message"].as_str())
                    .or_else(|| data["error"]["message"].as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.chars().take(400).collect());
        return Err(format!("Apollo API error {}: {}", status, msg));
    }

    let data: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse Apollo response: {} — body: {}", e, &text.chars().take(200).collect::<String>()))?;

    Ok(data)
}

// ── Apollo Bulk Match ─────────────────────────────────────────────────────────

#[tauri::command]
async fn apollo_bulk_match(
    api_key: String,
    details: Vec<Value>,
) -> Result<Value, String> {
    if details.is_empty() {
        return Ok(json!({ "matches": [] }));
    }
    let client = Client::new();
    let clean_details: Vec<Value> = details.into_iter().map(|mut d| {
        if let Some(obj) = d.as_object_mut() {
            obj.retain(|_, v| !v.is_null());
        }
        d
    }).collect();
    let body = json!({
        "details": clean_details,
        "reveal_personal_emails": true,
    });

    let response = client
        .post("https://api.apollo.io/v1/people/bulk_match")
        .header("X-Api-Key", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Apollo bulk_match failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read bulk_match response: {}", e))?;

    if !status.is_success() {
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|data| {
                data["error"].as_str()
                    .or_else(|| data["message"].as_str())
                    .or_else(|| data["error"]["message"].as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.chars().take(400).collect());
        return Err(format!("Apollo bulk_match error {}: {}", status, msg));
    }

    let data: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse bulk_match response: {} — body: {}", e, &text.chars().take(200).collect::<String>()))?;

    Ok(data)
}

// ── Open URL in system browser ───────────────────────────────────────────────

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

// ── Credential verification ───────────────────────────────────────────────────

/// Verifies an Anthropic API key by making a minimal /v1/models request.
/// Returns Ok("valid") or Err(reason).
#[tauri::command]
async fn verify_anthropic_key(api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No API key provided".to_string());
    }
    let client = Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if resp.status().is_success() {
        Ok("valid".to_string())
    } else if resp.status().as_u16() == 401 {
        Err("Invalid API key — check your Anthropic key".to_string())
    } else {
        Err(format!("API returned {}", resp.status()))
    }
}

/// Verifies a GitHub PAT by calling /user.
/// Returns Ok("valid") or Err(reason).
#[tauri::command]
async fn verify_github_pat(token: String) -> Result<String, String> {
    if token.trim().is_empty() {
        return Err("No token provided".to_string());
    }
    let client = Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "feature-fold")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if resp.status().is_success() {
        let data: Value = resp.json().await.unwrap_or(json!({}));
        let login = data["login"].as_str().unwrap_or("unknown");
        Ok(format!("valid:{}", login))
    } else if resp.status().as_u16() == 401 {
        Err("Invalid token — check your GitHub PAT".to_string())
    } else {
        Err(format!("GitHub returned {}", resp.status()))
    }
}

// ── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            // Resolve OS app data dir (e.g. ~/Library/Application Support/dev.foxworks.finalfold)
            let db_path = app
                .path()
                .app_data_dir()
                .map(|p| p.join("finalfold.db"))
                .unwrap_or_else(|_| std::path::PathBuf::from("finalfold.db"));

            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            let conn = Connection::open(&db_path)
                .unwrap_or_else(|_| {
                    Connection::open_in_memory().expect("Failed to open in-memory SQLite")
                });

            repos::init_db(&conn).expect("Failed to initialize database schema");
            runs::init_runs_table(&conn).expect("Failed to initialize feature_runs table");

            app.manage(DbConn(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Existing Intel pipeline commands
            anthropic_chat,
            apollo_people_search,
            apollo_bulk_match,
            open_url,
            verify_anthropic_key,
            verify_github_pat,
            // Feature Request Generator — credentials (OS keychain)
            credentials::save_credential,
            credentials::get_credential,
            // Feature Request Generator — saved repo list (SQLite)
            repos::list_saved_repos,
            repos::upsert_saved_repo,
            repos::delete_saved_repo,
            // Feature Request Generator — generation + GitHub publishing
            generator::generate_feature_request,
            github::create_github_issues,
            // Feature Request Generator — run history (SQLite)
            runs::save_feature_run,
            runs::list_feature_runs,
            runs::load_feature_run,
            runs::update_feature_run_urls,
            // Gmail integration
            gmail::gmail_oauth_start,
            gmail::gmail_check_connection,
            gmail::gmail_disconnect,
            gmail::gmail_save_draft,
            gmail::gmail_send_message,
            gmail::gmail_save_sequence_drafts,
            gmail::gmail_check_reply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FinalFold");
}
