# PRD-FF-06: LLM Pipeline Reliability

**Status:** Ready for implementation
**Priority:** High
**Effort:** ~1 day

---

## Problem

The entire value of Feature Fold is LLM-generated output. The current pipeline fails in ways that are difficult to recover from and that silently degrade output quality:

1. **No retry logic** — a single transient API failure (bad wifi, brief timeout) shows an error and requires the user to retype and restart from scratch. On conference wifi during a demo, this is a real failure mode.

2. **Fence stripping is case-sensitive** — the current strip only removes `` ```json `` (lowercase). Claude sometimes returns `` ```JSON `` (uppercase) or adds trailing text after the closing fence. When this happens, `serde_json::from_str` fails with a cryptic parse error.

3. **No post-parse schema validation** — if Claude returns structurally valid JSON that doesn't match the expected schema (empty `issues` array, missing `title` fields, etc.), the parse succeeds but the UI receives broken data silently. The user sees blank or malformed issue cards with no indication that something went wrong.

4. **No temperature control** — the API call sends no `temperature` parameter, defaulting to Anthropic's server-side default (~1.0). For structured JSON output, lower temperature (0.3) dramatically reduces schema violations, unexpected fields, and formatting deviations.

Note: `max_tokens: 8192` is already set in `generator.rs` — this is correct and does not need to change.

---

## Goals

- Add 2-attempt retry with 2-second backoff on transient failures
- Fix fence stripping to handle all Claude formatting variants
- Add schema validation after parse with clear, actionable error messages
- Set `temperature: 0.3` for consistent structured output

---

## Non-Goals

- Migrating to tool-use/structured output mode (worthwhile but a larger change; defer to future PRD)
- Adding prompt versioning
- A/B testing prompt variants

---

## Tickets

### FF-06-T1 — Set temperature and fix fence stripping in generator.rs

**File:** `src-tauri/src/generator.rs`
**Effort:** 30 minutes
**Severity:** High

**What:** Two small but impactful changes to the API call and response parsing.

**Temperature:** Add `"temperature": 0.3` to the request body. Lower temperature produces more consistent JSON structure and reduces the rate of unexpected formatting from the model.

**Fence stripping fix:** The current stripping uses `trim_start_matches("```json")` which is case-sensitive and only strips if the fence is the very first thing after trimming. Replace with a regex-based approach that handles:
- `` ```json `` and `` ```JSON `` (case-insensitive)
- Any whitespace or newlines between the fence and the JSON
- Trailing text after the closing fence
- JSON that appears without fences at all (already works, should still work)

**Implementation — request body change:**
```rust
let body = json!({
    "model": CLAUDE_MODEL,
    "max_tokens": 8192,
    "temperature": 0.3,
    "system": system,
    "messages": [{ "role": "user", "content": idea }]
});
```

**Implementation — fence stripping replacement:**
Replace the current 4-line strip chain with a function:
```rust
fn extract_json(raw: &str) -> &str {
    let trimmed = raw.trim();
    // Try to find JSON between code fences (case-insensitive)
    if let Some(start) = trimmed.to_lowercase().find("```") {
        let after_fence = &trimmed[start..];
        // Skip past the opening fence line
        if let Some(newline) = after_fence.find('\n') {
            let json_start = &after_fence[newline + 1..];
            // Find closing fence
            if let Some(end) = json_start.find("```") {
                return json_start[..end].trim();
            }
        }
    }
    // No fences — return as-is
    trimmed
}
```

**Acceptance criteria:**
- [ ] API call includes `"temperature": 0.3` in request body (verify via network log)
- [ ] Generation works when Claude returns ```` ```json ```` (lowercase, current behavior)
- [ ] Generation works when Claude returns ```` ```JSON ```` (uppercase, new fix)
- [ ] Generation works when Claude returns raw JSON without fences
- [ ] Generation works when Claude adds commentary after the closing fence

---

### FF-06-T2 — Add post-parse schema validation

**File:** `src-tauri/src/generator.rs`
**Effort:** 2-3 hours
**Severity:** High

**What:** After `serde_json::from_str` succeeds, validate that the parsed `GenerationOutput` meets minimum quality requirements. Return a clear error if validation fails rather than silently passing broken data to the frontend.

**Validation rules:**
1. `output.issues` must have at least 1 issue (prompt asks for 4-8; we accept 1+ to be permissive)
2. `output.issues` must have at most 12 issues (sanity cap)
3. Every issue must have a non-empty `title` (after trim)
4. Every issue must have a non-empty `body` (after trim)
5. `output.brief.feature_name` must be non-empty
6. `output.brief.summary` must be non-empty

**Implementation — add after the parse call:**
```rust
fn validate_output(output: &GenerationOutput) -> Result<(), String> {
    if output.brief.feature_name.trim().is_empty() {
        return Err("Generation produced an empty feature name. Please try again.".to_string());
    }
    if output.brief.summary.trim().is_empty() {
        return Err("Generation produced an empty summary. Please try again.".to_string());
    }
    if output.issues.is_empty() {
        return Err("Generation produced no issues. The model may have misunderstood the request — try being more specific.".to_string());
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
            return Err(format!("Issue {} ('{}') has an empty body. Please regenerate.", i + 1, issue.title));
        }
    }
    Ok(())
}
```

Call immediately after parse:
```rust
let output = serde_json::from_str::<GenerationOutput>(cleaned).map_err(|e| { ... })?;
validate_output(&output)?;
Ok(output)
```

**Acceptance criteria:**
- [ ] Empty `issues` array returns a clear error message
- [ ] Issues with empty titles return a clear error identifying the issue number
- [ ] Empty `feature_name` returns a clear error
- [ ] Valid output passes validation and returns normally
- [ ] Error messages are user-readable, not Rust internals

---

### FF-06-T3 — Add retry logic with exponential backoff

**File:** `src-tauri/src/generator.rs`
**Effort:** 2-3 hours
**Severity:** High

**What:** Wrap the Claude API call in a retry loop. On transient failure (network error, timeout, 5xx response), wait 2 seconds and try once more. On the second failure, return the error. Non-transient failures (401, 403, 400 bad request) should not be retried.

**Retry criteria:**
- Retry: `reqwest::Error` (network/timeout)
- Retry: HTTP 429 (rate limit — wait longer, 5 seconds)
- Retry: HTTP 5xx (server error)
- Do NOT retry: HTTP 4xx (except 429) — these are configuration/auth errors

**Implementation pattern:**
```rust
const MAX_ATTEMPTS: u32 = 2;

for attempt in 1..=MAX_ATTEMPTS {
    match call_claude_api(&client, &body, &api_key).await {
        Ok(output) => return Ok(output),
        Err(e) if is_retryable(&e) && attempt < MAX_ATTEMPTS => {
            let wait = if e.contains("429") { 5 } else { 2 };
            tokio::time::sleep(Duration::from_secs(wait)).await;
            continue;
        }
        Err(e) => return Err(e),
    }
}
```

Extract the API call into a helper `call_claude_api(client, body, api_key) -> Result<GenerationOutput, String>` to make the retry loop clean.

**Retryable error detection:**
```rust
fn is_retryable(err: &str) -> bool {
    err.contains("timed out")
        || err.contains("connection")
        || err.contains("Claude API error 429")
        || err.contains("Claude API error 5")
}
```

**Acceptance criteria:**
- [ ] On first-attempt timeout, app waits 2 seconds and retries automatically (no user action needed)
- [ ] On second-attempt failure, app returns the error to the frontend
- [ ] 401/403 errors are NOT retried (returned immediately)
- [ ] Successful first attempt still returns immediately (no added latency)
- [ ] 429 responses wait 5 seconds before retry

---

## Testing

Manual test sequence:
1. Normal generation — verify `temperature: 0.3` is in request (check Tauri network log or add temporary debug log)
2. Disconnect network during generation → verify retry happens → reconnect → verify recovery
3. Temporarily add a `\`\`\`JSON` wrapper to the system prompt and verify parsing still works
4. Verify schema validation by temporarily returning `{"brief": {...}, "issues": []}` from Claude (mock test)
