use crate::credentials::get_credential;
use crate::generator::IssuePayload;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ── Result types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct IssueResult {
    pub title: String,
    /// "success" or "error"
    pub status: String,
    /// GitHub html_url for successfully created issues
    pub url: Option<String>,
    /// Error message for failed issues
    pub error: Option<String>,
}

// ── Label helpers ─────────────────────────────────────────────────────────────

/// Maps the `area` field from IssuePayload to a GitHub label name.
/// The label follows the convention "area:<value>" (lowercase, hyphen-separated).
fn area_label(area: &str) -> String {
    format!("area:{}", area.to_lowercase().replace(' ', "-"))
}

/// Ensures a label exists on the repo, creating it if necessary.
/// Returns silently on success; logs and continues on failure (label is optional metadata).
async fn ensure_label(
    client: &Client,
    token: &str,
    owner: &str,
    repo: &str,
    label_name: &str,
    color: &str,
) {
    let url = format!("https://api.github.com/repos/{}/{}/labels", owner, repo);

    // Attempt to create the label. GitHub returns 422 if it already exists — that's fine.
    let _ = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "feature-fold")
        .header("Content-Type", "application/json")
        .header("Accept", "application/vnd.github+json")
        .json(&json!({ "name": label_name, "color": color }))
        .send()
        .await;
}

/// Returns a hex color for each area type (without leading #).
fn area_color(area: &str) -> &'static str {
    match area.to_lowercase().as_str() {
        "backend"        => "0075ca",
        "frontend"       => "e4e669",
        "database"       => "d93f0b",
        "integration"    => "0052cc",
        "testing"        => "e11d48",
        "infrastructure" => "7057ff",
        _                => "cccccc",
    }
}

// ── Command ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_github_issues(
    owner: String,
    repo_name: String,
    issues: Vec<IssuePayload>,
) -> Result<Vec<IssueResult>, String> {
    // 1. Retrieve PAT before making any API calls
    let token = get_credential("github_pat".to_string())?
        .ok_or_else(|| "GitHub PAT not set. Open Settings and save your token.".to_string())?;

    if token.trim().is_empty() {
        return Err("GitHub PAT is empty. Open Settings and save your token.".to_string());
    }

    let client = Client::new();
    let api_url = format!(
        "https://api.github.com/repos/{}/{}/issues",
        owner, repo_name
    );
    let mut results: Vec<IssueResult> = Vec::with_capacity(issues.len());

    // 2. Pre-create all required area labels before creating issues.
    //    Failures are non-fatal — label creation is best-effort.
    let mut seen_areas: std::collections::HashSet<String> = std::collections::HashSet::new();
    for issue in &issues {
        if !issue.area.is_empty() && seen_areas.insert(issue.area.clone()) {
            let label = area_label(&issue.area);
            let color = area_color(&issue.area);
            ensure_label(&client, &token, &owner, &repo_name, &label, color).await;
        }
    }

    // 3. Sequential creation — preserves issue ordering and avoids rate-limit spikes
    for issue in &issues {
        let label_name = area_label(&issue.area);
        let body = json!({
            "title": issue.title,
            "body":  format_issue_body(issue),
            "labels": [label_name],
        });

        let response = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "feature-fold")
            .header("Content-Type", "application/json")
            .header("Accept", "application/vnd.github+json")
            .json(&body)
            .send()
            .await;

        match response {
            Err(e) => {
                results.push(IssueResult {
                    title: issue.title.clone(),
                    status: "error".to_string(),
                    url: None,
                    error: Some(format!("Network error: {}", e)),
                });
            }
            Ok(resp) => {
                let status = resp.status();
                let data: Value = resp.json().await.unwrap_or(json!({}));

                if status == 201 {
                    let url = data["html_url"].as_str().map(|s| s.to_string());
                    results.push(IssueResult {
                        title: issue.title.clone(),
                        status: "success".to_string(),
                        url,
                        error: None,
                    });
                } else {
                    let err_msg = match status.as_u16() {
                        401 => "Authentication failed — check your GitHub PAT is valid".to_string(),
                        403 => "Permission denied — ensure your PAT has 'repo' scope (issues:write)".to_string(),
                        404 => format!(
                            "Repository '{}/{}' not found or PAT lacks access",
                            owner, repo_name
                        ),
                        422 => {
                            let msg = data["message"].as_str().unwrap_or("Validation failed");
                            format!("GitHub rejected issue: {}", msg)
                        }
                        _ => {
                            let msg = data["message"].as_str().unwrap_or("Unknown error");
                            format!("GitHub error {}: {}", status, msg)
                        }
                    };
                    results.push(IssueResult {
                        title: issue.title.clone(),
                        status: "error".to_string(),
                        url: None,
                        error: Some(err_msg),
                    });
                }
            }
        }
    }

    Ok(results)
}

// ── Body formatter ────────────────────────────────────────────────────────────
// Enriches the raw body with structured acceptance criteria and dependencies
// as markdown sections, so GitHub renders them cleanly.

fn format_issue_body(issue: &IssuePayload) -> String {
    let mut body = issue.body.trim().to_string();

    if !issue.acceptance_criteria.is_empty() {
        body.push_str("\n\n## Acceptance Criteria\n");
        for criterion in &issue.acceptance_criteria {
            body.push_str(&format!("- [ ] {}\n", criterion));
        }
    }

    if !issue.dependencies.is_empty() {
        body.push_str("\n## Dependencies\n");
        for dep in &issue.dependencies {
            body.push_str(&format!("- {}\n", dep));
        }
    }

    body
}
