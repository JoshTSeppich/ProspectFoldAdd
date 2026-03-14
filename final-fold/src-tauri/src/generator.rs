use crate::credentials::get_credential;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_SECS: u64 = 60;
const MAX_ATTEMPTS: u32 = 2;
const RETRY_DELAY_SECS: u64 = 2;
const RETRY_DELAY_RATELIMIT_SECS: u64 = 5;

// ── Output types ──────────────────────────────────────────────────────────────
// IssuePayload is the shared contract consumed by the preview editor (frontend)
// and by create_github_issues (github.rs). Any changes here must be reflected
// in both the frontend IssuePreviewPanel and the GitHub command.

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeatureBrief {
    pub feature_name: String,
    pub summary: String,
    pub problem: String,
    pub goals: Vec<String>,
    pub non_goals: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssuePayload {
    pub title: String,
    pub body: String,
    pub area: String,
    pub acceptance_criteria: Vec<String>,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerationOutput {
    pub brief: FeatureBrief,
    pub issues: Vec<IssuePayload>,
}

// ── System prompt ─────────────────────────────────────────────────────────────

fn build_system_prompt(
    owner: &str,
    repo_name: &str,
    prospect_name: &str,
    prospect_notes: &str,
) -> String {
    let context_block = if !prospect_name.is_empty() || !prospect_notes.is_empty() {
        format!(
            "\n\nCLIENT CONTEXT:\nClient: {}\nNotes: {}\n\nUse this context to make generated issues specific to this client's stack, team size, and pain points. Reference the client's actual technology choices and constraints where relevant.",
            prospect_name, prospect_notes
        )
    } else {
        String::new()
    };

    format!(
        r#"You are a senior software architect and technical writer generating GitHub Issues for the repository {owner}/{repo_name}.{context_block}

The user will provide a rough feature idea. Your task is to:
1. Write a concise feature brief summarizing the idea
2. Break it into 4–8 actionable implementation tickets ordered by dependency

CRITICAL: Return ONLY a valid JSON object. No markdown, no code fences, no explanation before or after the JSON.

The JSON must match this exact schema:
{{
  "brief": {{
    "feature_name": "string — short name for the feature",
    "summary": "string — 1–2 sentence summary",
    "problem": "string — what problem this solves",
    "goals": ["string", "..."],
    "non_goals": ["string", "..."]
  }},
  "issues": [
    {{
      "title": "string — concise issue title (50–80 chars)",
      "body": "string — detailed implementation description in markdown. Include: what to build, why, technical approach, and any gotchas. Self-contained enough for another engineer or AI to implement without follow-up.",
      "area": "string — one of: Backend, Frontend, Database, Integration, Testing, Infrastructure",
      "acceptance_criteria": ["string — specific, testable condition", "..."],
      "dependencies": ["string — title of another issue this depends on, or empty array if none"]
    }}
  ]
}}

Rules:
- Issue titles should be specific and action-oriented (e.g. "Implement OAuth token refresh" not "Fix auth")
- Issue bodies must be detailed — minimum 3 paragraphs covering what, why, and how
- acceptance_criteria must be concrete and verifiable (not "the feature works")
- Order issues from foundational (no deps) to dependent (requires others)
- 4–8 issues total; prefer fewer well-scoped issues over many thin ones
- Target repo context: {owner}/{repo_name}"#,
        owner = owner,
        repo_name = repo_name,
        context_block = context_block,
    )
}

// ── JSON extraction ───────────────────────────────────────────────────────────
// Handles all known Claude output variants:
//   - Raw JSON (no fences)
//   - ```json ... ``` (lowercase)
//   - ```JSON ... ``` (uppercase)
//   - Fences with leading/trailing whitespace
//   - Commentary before or after fences (extracts only the fenced block)

fn extract_json(raw: &str) -> &str {
    let trimmed = raw.trim();

    // Find opening fence (case-insensitive search on a lowercased copy)
    let lower = trimmed.to_lowercase();
    if let Some(fence_start) = lower.find("```") {
        let after_fence = &trimmed[fence_start..];
        // Skip past the opening fence line (everything up to and including the first newline)
        if let Some(newline_pos) = after_fence.find('\n') {
            let json_candidate = &after_fence[newline_pos + 1..];
            // Find the closing fence
            if let Some(close_pos) = json_candidate.find("```") {
                return json_candidate[..close_pos].trim();
            }
        }
    }

    // No fences found — return raw (Claude correctly returned bare JSON)
    trimmed
}

// ── Schema validation ─────────────────────────────────────────────────────────

fn validate_output(output: &GenerationOutput) -> Result<(), String> {
    if output.brief.feature_name.trim().is_empty() {
        return Err(
            "Generation produced an empty feature name. Please try again.".to_string(),
        );
    }
    if output.brief.summary.trim().is_empty() {
        return Err(
            "Generation produced an empty summary. Please try again.".to_string(),
        );
    }
    if output.issues.is_empty() {
        return Err(
            "Generation produced no issues. Try being more specific about the feature.".to_string(),
        );
    }
    if output.issues.len() > 12 {
        return Err(format!(
            "Generation produced {} issues (max 12). Try narrowing the feature scope.",
            output.issues.len()
        ));
    }
    for (i, issue) in output.issues.iter().enumerate() {
        if issue.title.trim().is_empty() {
            return Err(format!("Issue {} has an empty title. Please regenerate.", i + 1));
        }
        if issue.body.trim().is_empty() {
            return Err(format!(
                "Issue {} has an empty body. Please regenerate.",
                i + 1
            ));
        }
    }
    Ok(())
}

// ── Retry helpers ─────────────────────────────────────────────────────────────

fn is_retryable(err: &str) -> bool {
    err.contains("timed out")
        || err.contains("connection")
        || err.contains("Claude API error 429")
        || err.starts_with("Claude API error 5")
}

fn retry_delay_secs(err: &str) -> u64 {
    if err.contains("429") {
        RETRY_DELAY_RATELIMIT_SECS
    } else {
        RETRY_DELAY_SECS
    }
}

// ── Core API call ─────────────────────────────────────────────────────────────

async fn call_claude(
    client: &Client,
    api_key: &str,
    system: &str,
    idea: &str,
) -> Result<GenerationOutput, String> {
    let body = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": 8192,
        "temperature": 0.3,
        "system": system,
        "messages": [
            { "role": "user", "content": idea }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Claude API timed out. The model may be slow — please try again.".to_string()
            } else {
                format!("Claude API request failed: {}", e)
            }
        })?;

    let status = response.status();
    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    if !status.is_success() {
        let msg = data["error"]["message"]
            .as_str()
            .unwrap_or("Unknown Claude API error");
        return Err(format!("Claude API error {}: {}", status, msg));
    }

    let raw = data["content"][0]["text"]
        .as_str()
        .ok_or_else(|| "No text content in Claude response".to_string())?;

    let cleaned = extract_json(raw);

    let output = serde_json::from_str::<GenerationOutput>(cleaned).map_err(|e| {
        format!(
            "Failed to parse generation output ({}). Raw response: {}",
            e,
            &cleaned.chars().take(500).collect::<String>()
        )
    })?;

    validate_output(&output)?;

    Ok(output)
}

// ── Command ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_feature_request(
    owner: String,
    repo_name: String,
    idea: String,
    prospect_name: Option<String>,
    prospect_notes: Option<String>,
) -> Result<GenerationOutput, String> {
    // 1. Retrieve API key from keychain
    let api_key = get_credential("anthropic_key".to_string())?
        .ok_or_else(|| {
            "Anthropic API key not set. Open Settings and save your API key.".to_string()
        })?;

    if api_key.trim().is_empty() {
        return Err(
            "Anthropic API key is empty. Open Settings and save your API key.".to_string(),
        );
    }

    let pname = prospect_name.unwrap_or_default();
    let pnotes = prospect_notes.unwrap_or_default();
    let system = build_system_prompt(&owner, &repo_name, &pname, &pnotes);

    // 2. Build shared HTTP client
    let client = Client::builder()
        .timeout(Duration::from_secs(CLAUDE_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // 3. Call with retry
    let mut last_err = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        match call_claude(&client, &api_key, &system, &idea).await {
            Ok(output) => return Ok(output),
            Err(e) if is_retryable(&e) && attempt < MAX_ATTEMPTS => {
                let delay = retry_delay_secs(&e);
                last_err = e;
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
            Err(e) => return Err(e),
        }
    }

    Err(last_err)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_issue(title: &str, body: &str) -> IssuePayload {
        IssuePayload {
            title: title.to_string(),
            body: body.to_string(),
            area: "Backend".to_string(),
            acceptance_criteria: vec!["criterion".to_string()],
            dependencies: vec![],
        }
    }

    fn make_brief(name: &str, summary: &str) -> FeatureBrief {
        FeatureBrief {
            feature_name: name.to_string(),
            summary: summary.to_string(),
            problem: "problem".to_string(),
            goals: vec!["goal".to_string()],
            non_goals: vec![],
        }
    }

    // ── extract_json ──────────────────────────────────────────────────────────

    #[test]
    fn extract_json_bare() {
        let raw = r#"{"brief": {}, "issues": []}"#;
        assert_eq!(extract_json(raw), raw);
    }

    #[test]
    fn extract_json_lowercase_fence() {
        let raw = "```json\n{\"key\": \"value\"}\n```";
        assert_eq!(extract_json(raw), r#"{"key": "value"}"#);
    }

    #[test]
    fn extract_json_uppercase_fence() {
        let raw = "```JSON\n{\"key\": \"value\"}\n```";
        assert_eq!(extract_json(raw), r#"{"key": "value"}"#);
    }

    #[test]
    fn extract_json_trailing_commentary() {
        let raw = "```json\n{\"key\": \"value\"}\n```\nSome trailing text Claude added.";
        assert_eq!(extract_json(raw), r#"{"key": "value"}"#);
    }

    #[test]
    fn extract_json_leading_whitespace() {
        let raw = "\n\n```json\n{\"key\": \"value\"}\n```";
        assert_eq!(extract_json(raw), r#"{"key": "value"}"#);
    }

    // ── validate_output ───────────────────────────────────────────────────────

    #[test]
    fn validate_ok() {
        let output = GenerationOutput {
            brief: make_brief("Feature", "Summary"),
            issues: vec![make_issue("Title", "Body text here")],
        };
        assert!(validate_output(&output).is_ok());
    }

    #[test]
    fn validate_empty_issues() {
        let output = GenerationOutput {
            brief: make_brief("Feature", "Summary"),
            issues: vec![],
        };
        let err = validate_output(&output).unwrap_err();
        assert!(err.contains("no issues"));
    }

    #[test]
    fn validate_too_many_issues() {
        let issues: Vec<_> = (0..13).map(|i| make_issue(&format!("T{}", i), "body")).collect();
        let output = GenerationOutput {
            brief: make_brief("Feature", "Summary"),
            issues,
        };
        let err = validate_output(&output).unwrap_err();
        assert!(err.contains("13 issues"));
    }

    #[test]
    fn validate_empty_feature_name() {
        let output = GenerationOutput {
            brief: make_brief("", "Summary"),
            issues: vec![make_issue("Title", "Body")],
        };
        let err = validate_output(&output).unwrap_err();
        assert!(err.contains("feature name"));
    }

    #[test]
    fn validate_empty_issue_title() {
        let output = GenerationOutput {
            brief: make_brief("Feature", "Summary"),
            issues: vec![make_issue("", "Body text")],
        };
        let err = validate_output(&output).unwrap_err();
        assert!(err.contains("Issue 1") && err.contains("empty title"));
    }

    #[test]
    fn validate_empty_issue_body() {
        let output = GenerationOutput {
            brief: make_brief("Feature", "Summary"),
            issues: vec![make_issue("Title", "")],
        };
        let err = validate_output(&output).unwrap_err();
        assert!(err.contains("Issue 1") && err.contains("empty body"));
    }

    // ── is_retryable ──────────────────────────────────────────────────────────

    #[test]
    fn retryable_timeout() {
        assert!(is_retryable("Claude API timed out"));
    }

    #[test]
    fn retryable_429() {
        assert!(is_retryable("Claude API error 429: rate limit exceeded"));
    }

    #[test]
    fn retryable_500() {
        assert!(is_retryable("Claude API error 500: internal server error"));
    }

    #[test]
    fn not_retryable_401() {
        assert!(!is_retryable("Claude API error 401: unauthorized"));
    }

    #[test]
    fn not_retryable_400() {
        assert!(!is_retryable("Claude API error 400: bad request"));
    }
}
