// ─── Gmail Integration ────────────────────────────────────────────────────────
// OAuth 2.0 desktop flow (loopback redirect), draft creation, message sending,
// sequence draft batch, and thread reply detection.
//
// Setup: user provides their own Google Cloud OAuth 2.0 "Desktop app" client
// credentials (client_id + client_secret) in Settings. Tokens are stored in
// the OS keychain under the same service as other FinalFold credentials.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const SERVICE: &str = "dev.foxworks.finalfold";
const KEY_CLIENT_ID: &str = "gmail_client_id";
const KEY_CLIENT_SECRET: &str = "gmail_client_secret";
const KEY_REFRESH_TOKEN: &str = "gmail_refresh_token";
const KEY_USER_EMAIL: &str = "gmail_user_email";

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v1/userinfo";

// ── Keychain helpers ──────────────────────────────────────────────────────────

fn kc_get(key: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, key)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|v| !v.is_empty())
}

fn kc_set(key: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, key)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

fn kc_del(key: &str) {
    if let Ok(e) = keyring::Entry::new(SERVICE, key) {
        let _ = e.delete_credential();
    }
}

// ── Token management ──────────────────────────────────────────────────────────

async fn get_access_token() -> Result<String, String> {
    let client_id = kc_get(KEY_CLIENT_ID)
        .ok_or("Gmail not connected — open Settings and connect Gmail")?;
    let client_secret = kc_get(KEY_CLIENT_SECRET)
        .ok_or("Gmail client secret missing — reconnect in Settings")?;
    let refresh_token = kc_get(KEY_REFRESH_TOKEN)
        .ok_or("Gmail refresh token missing — reconnect in Settings")?;

    let client = Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Token refresh parse failed: {}", e))?;

    if let Some(err) = data["error"].as_str() {
        return Err(format!(
            "Token refresh error: {} — {}",
            err,
            data["error_description"].as_str().unwrap_or("")
        ));
    }

    data["access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "No access_token in refresh response".to_string())
}

// ── RFC 2822 message builder ──────────────────────────────────────────────────
// Encodes an email as base64url for Gmail API's `raw` field.

fn build_raw(to: &str, from_email: &str, subject: &str, body: &str) -> String {
    let to_header = if to.is_empty() {
        String::new()
    } else {
        format!("To: {}\r\n", to)
    };
    let mime = format!(
        "From: {}\r\n{}Subject: {}\r\nContent-Type: text/plain; charset=UTF-8\r\nMIME-Version: 1.0\r\n\r\n{}",
        from_email, to_header, subject, body
    );
    URL_SAFE_NO_PAD.encode(mime.as_bytes())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Start the OAuth 2.0 loopback flow.
/// Opens the user's browser to the Google consent screen, spins up a local
/// HTTP listener to catch the redirect, exchanges the code for tokens, stores
/// the refresh token in the OS keychain, and returns the connected email.
/// Blocks until auth completes or times out (5 minutes).
#[tauri::command]
pub async fn gmail_oauth_start(
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    // Bind to an OS-assigned free port
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    // Build consent URL
    let scopes = "https://www.googleapis.com/auth/gmail.compose \
                  https://www.googleapis.com/auth/gmail.readonly \
                  https://www.googleapis.com/auth/userinfo.email";

    let auth_url = reqwest::Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/auth",
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("scope", scopes),
            ("response_type", "code"),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;

    // Open browser
    open::that(auth_url.as_str()).map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait for callback (5 minute timeout)
    let (mut stream, _) = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        listener.accept(),
    )
    .await
    .map_err(|_| "OAuth timeout — no browser response within 5 minutes".to_string())?
    .map_err(|e| format!("Failed to accept OAuth callback: {}", e))?;

    // Read HTTP request
    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read OAuth callback: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Extract path from "GET /callback?... HTTP/1.1"
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("Malformed OAuth callback request")?;

    // Check for access_denied
    if path.contains("error=access_denied") {
        let html = "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2 style='color:#ef4444'>Access Denied</h2><p>You can close this tab.</p></body></html>";
        let _ = stream
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                )
                .as_bytes(),
            )
            .await;
        return Err("Google OAuth access was denied".to_string());
    }

    // Parse code from query string using reqwest's URL parser
    let fake_url = format!("http://localhost{}", path);
    let parsed = reqwest::Url::parse(&fake_url).map_err(|_| "Failed to parse OAuth callback URL")?;
    let code = parsed
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or("No authorization code in OAuth callback")?;

    // Send success page to close the browser tab
    let html = "<html><body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:80px 40px;background:#080c14;color:#dde8f5\"><div style=\"font-size:52px;margin-bottom:20px\">✓</div><h2 style=\"color:#22c55e;font-size:22px;margin-bottom:10px;font-weight:700\">Gmail Connected</h2><p style=\"color:#7a8fa6;font-size:15px\">You can close this tab and return to FinalFold.</p></body></html>";
    let _ = stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            )
            .as_bytes(),
        )
        .await;
    drop(stream);

    // Exchange code for tokens
    let client = Client::new();
    let token_resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    let token_data: Value = token_resp
        .json()
        .await
        .map_err(|e| format!("Token exchange parse failed: {}", e))?;

    if let Some(err) = token_data["error"].as_str() {
        return Err(format!(
            "Token exchange error: {} — {}",
            err,
            token_data["error_description"].as_str().unwrap_or("")
        ));
    }

    let refresh_token = token_data["refresh_token"]
        .as_str()
        .ok_or("No refresh_token in response — ensure prompt=consent is set")?;
    let access_token = token_data["access_token"]
        .as_str()
        .ok_or("No access_token in response")?;

    // Fetch user email
    let user_resp = client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Userinfo request failed: {}", e))?;
    let user_data: Value = user_resp.json().await.unwrap_or(json!({}));
    let user_email = user_data["email"]
        .as_str()
        .unwrap_or("connected@gmail.com");

    // Persist to OS keychain
    kc_set(KEY_CLIENT_ID, &client_id)?;
    kc_set(KEY_CLIENT_SECRET, &client_secret)?;
    kc_set(KEY_REFRESH_TOKEN, refresh_token)?;
    kc_set(KEY_USER_EMAIL, user_email)?;

    Ok(user_email.to_string())
}

/// Returns the connected Gmail address, or None if not connected.
#[tauri::command]
pub fn gmail_check_connection() -> Option<String> {
    // Both refresh token AND email must be present
    kc_get(KEY_REFRESH_TOKEN).and(kc_get(KEY_USER_EMAIL))
}

/// Removes stored Gmail tokens (keeps client_id/secret for easy reconnect).
#[tauri::command]
pub fn gmail_disconnect() {
    kc_del(KEY_REFRESH_TOKEN);
    kc_del(KEY_USER_EMAIL);
}

// ── Draft / Send result types ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DraftResult {
    pub draft_id: String,
    pub message_id: String,
    pub gmail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendResult {
    pub message_id: String,
    pub thread_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SequenceStep {
    pub label: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SequenceDraftResult {
    pub step: String,
    pub draft_id: String,
    pub message_id: String,
    pub gmail_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplyDetail {
    pub has_reply: bool,
    pub reply_subject: String,
    pub reply_snippet: String,
    pub is_unsubscribe: bool,
}

// ── Gmail API helpers ─────────────────────────────────────────────────────────

async fn create_draft(
    client: &Client,
    access_token: &str,
    to: &str,
    from_email: &str,
    subject: &str,
    body: &str,
) -> Result<DraftResult, String> {
    let raw = build_raw(to, from_email, subject, body);

    let resp = client
        .post(format!("{}/drafts", GMAIL_API))
        .bearer_auth(access_token)
        .json(&json!({ "message": { "raw": raw } }))
        .send()
        .await
        .map_err(|e| format!("Gmail draft request failed: {}", e))?;

    let status = resp.status();
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Gmail draft parse failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Gmail API {} for draft: {}",
            status,
            data["error"]["message"].as_str().unwrap_or("unknown error")
        ));
    }

    let draft_id = data["id"].as_str().unwrap_or("").to_string();
    let message_id = data["message"]["id"].as_str().unwrap_or("").to_string();
    let gmail_url = format!("https://mail.google.com/mail/#drafts/{}", draft_id);

    Ok(DraftResult {
        draft_id,
        message_id,
        gmail_url,
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Save a single email as a Gmail draft.
#[tauri::command]
pub async fn gmail_save_draft(
    to: String,
    subject: String,
    body: String,
) -> Result<DraftResult, String> {
    let token = get_access_token().await?;
    let from_email = kc_get(KEY_USER_EMAIL).unwrap_or_default();
    let client = Client::new();
    create_draft(&client, &token, &to, &from_email, &subject, &body).await
}

/// Send an email immediately via Gmail.
#[tauri::command]
pub async fn gmail_send_message(
    to: String,
    subject: String,
    body: String,
) -> Result<SendResult, String> {
    if to.is_empty() {
        return Err("Recipient email is required to send via Gmail".to_string());
    }
    let token = get_access_token().await?;
    let from_email = kc_get(KEY_USER_EMAIL).unwrap_or_default();
    let raw = build_raw(&to, &from_email, &subject, &body);

    let client = Client::new();
    let resp = client
        .post(format!("{}/messages/send", GMAIL_API))
        .bearer_auth(&token)
        .json(&json!({ "raw": raw }))
        .send()
        .await
        .map_err(|e| format!("Gmail send request failed: {}", e))?;

    let status = resp.status();
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Gmail send parse failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Gmail API {} sending message: {}",
            status,
            data["error"]["message"].as_str().unwrap_or("unknown error")
        ));
    }

    Ok(SendResult {
        message_id: data["id"].as_str().unwrap_or("").to_string(),
        thread_id: data["threadId"].as_str().unwrap_or("").to_string(),
    })
}

/// Save all steps of a 4-step outreach sequence as Gmail drafts in one call.
/// Steps are created sequentially (not parallel) to respect Gmail rate limits.
#[tauri::command]
pub async fn gmail_save_sequence_drafts(
    steps: Vec<SequenceStep>,
    to: String,
) -> Result<Vec<SequenceDraftResult>, String> {
    let token = get_access_token().await?;
    let from_email = kc_get(KEY_USER_EMAIL).unwrap_or_default();
    let client = Client::new();

    let mut results = Vec::with_capacity(steps.len());

    for step in &steps {
        let draft =
            create_draft(&client, &token, &to, &from_email, &step.subject, &step.body).await?;
        results.push(SequenceDraftResult {
            step: step.label.clone(),
            draft_id: draft.draft_id,
            message_id: draft.message_id,
            gmail_url: draft.gmail_url,
        });
        // Small delay between drafts to be polite to the API
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    Ok(results)
}

/// Check whether a Gmail thread has received a reply.
/// Returns true if the thread contains more than one message (i.e. someone replied).
#[tauri::command]
pub async fn gmail_check_reply(thread_id: String) -> Result<bool, String> {
    if thread_id.is_empty() {
        return Ok(false);
    }
    let token = get_access_token().await?;
    let client = Client::new();

    let resp = client
        .get(format!("{}/threads/{}", GMAIL_API, thread_id))
        .query(&[("format", "minimal"), ("fields", "messages.id")])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Thread check failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Thread parse failed: {}", e))?;

    let msg_count = data["messages"]
        .as_array()
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(msg_count > 1)
}

/// Detailed reply check: returns subject/snippet of the reply message and whether
/// it looks like an unsubscribe request.
#[tauri::command]
pub async fn gmail_check_reply_detail(thread_id: String) -> Result<ReplyDetail, String> {
    let empty = ReplyDetail {
        has_reply: false,
        reply_subject: String::new(),
        reply_snippet: String::new(),
        is_unsubscribe: false,
    };
    if thread_id.is_empty() {
        return Ok(empty);
    }
    let token = get_access_token().await?;
    let client = Client::new();

    let resp = client
        .get(format!("{}/threads/{}", GMAIL_API, thread_id))
        .query(&[("format", "metadata"), ("metadataHeaders", "Subject")])
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Thread detail check failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Thread detail parse failed: {}", e))?;

    let messages = match data["messages"].as_array() {
        Some(m) => m,
        None => return Ok(empty),
    };

    if messages.len() <= 1 {
        return Ok(empty);
    }

    // Last message in thread is the reply
    let reply = &messages[messages.len() - 1];
    let headers = reply["payload"]["headers"].as_array();

    let reply_subject = headers
        .and_then(|hs| {
            hs.iter().find(|h| {
                h["name"]
                    .as_str()
                    .map(|n| n.eq_ignore_ascii_case("Subject"))
                    .unwrap_or(false)
            })
        })
        .and_then(|h| h["value"].as_str())
        .unwrap_or("")
        .to_string();

    let reply_snippet = reply["snippet"].as_str().unwrap_or("").to_string();

    let subj_lc = reply_subject.to_lowercase();
    let snip_lc = reply_snippet.to_lowercase();
    let is_unsubscribe = subj_lc.contains("unsubscribe")
        || snip_lc.contains("unsubscribe")
        || snip_lc.contains("opt out")
        || snip_lc.contains("opt-out")
        || snip_lc.contains("remove me")
        || snip_lc.contains("stop emailing");

    Ok(ReplyDetail {
        has_reply: true,
        reply_subject,
        reply_snippet,
        is_unsubscribe,
    })
}

/// Idempotent label creation. Returns the label_id whether it was created or already existed.
#[tauri::command]
pub async fn gmail_ensure_label(name: String) -> Result<String, String> {
    let token = get_access_token().await?;
    let client = Client::new();

    // List existing labels
    let resp = client
        .get(format!("{}/labels", GMAIL_API))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Label list request failed: {}", e))?;

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Label list parse failed: {}", e))?;

    // Return existing label_id if found
    if let Some(labels) = data["labels"].as_array() {
        for label in labels {
            if label["name"]
                .as_str()
                .map(|n| n.eq_ignore_ascii_case(&name))
                .unwrap_or(false)
            {
                return Ok(label["id"].as_str().unwrap_or("").to_string());
            }
        }
    }

    // Create new label
    let create_resp = client
        .post(format!("{}/labels", GMAIL_API))
        .bearer_auth(&token)
        .json(&json!({
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show"
        }))
        .send()
        .await
        .map_err(|e| format!("Label create request failed: {}", e))?;

    let status = create_resp.status();
    let create_data: Value = create_resp
        .json()
        .await
        .map_err(|e| format!("Label create parse failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Label create error {}: {}",
            status,
            create_data["error"]["message"]
                .as_str()
                .unwrap_or("unknown")
        ));
    }

    Ok(create_data["id"].as_str().unwrap_or("").to_string())
}

/// Apply a label (by id) to a message. Idempotent — safe to call multiple times.
#[tauri::command]
pub async fn gmail_apply_label(message_id: String, label_id: String) -> Result<(), String> {
    if message_id.is_empty() || label_id.is_empty() {
        return Ok(());
    }
    let token = get_access_token().await?;
    let client = Client::new();

    let resp = client
        .post(format!("{}/messages/{}/modify", GMAIL_API, message_id))
        .bearer_auth(&token)
        .json(&json!({ "addLabelIds": [label_id] }))
        .send()
        .await
        .map_err(|e| format!("Apply label request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let data: Value = resp.json().await.unwrap_or(json!({}));
        return Err(format!(
            "Apply label error {}: {}",
            status,
            data["error"]["message"].as_str().unwrap_or("unknown")
        ));
    }

    Ok(())
}
