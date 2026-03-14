# PRD-FF-09: Reliability & Trust

**Status:** Ready for implementation
**Priority:** High
**Effort:** ~1 day

---

## Problem

Three gaps that erode trust in the tool during real use:

1. The Apollo API key removal introduced a regression: if the key isn't set in the keychain, the Intel pipeline runs all its AI stages and then silently returns empty contact results with no explanation. Users assume something is wrong with the search, not their credentials.

2. GitHub issue URLs are shown in the Confirmation view but lost the moment the user clicks Done. There's no way to retrieve links to issues created in a past session.

3. Credential errors (bad API key, wrong PAT scope) are only discovered at runtime — mid-generation or mid-publish. A "Verify" button in Settings would catch bad credentials before they waste a user's time.

---

## Tickets

### FF-09-T1 — Apollo key missing → clear error before Intel pipeline runs

**File:** `src/App.jsx`
**Effort:** 20 minutes

Before running the Intel pipeline (`run` callback), check `_apolloKey`. If empty, abort with a user-readable error that links to Settings.

```js
if (!_apolloKey.trim()) {
  setError("Apollo API key not set. Open Settings and save your Apollo key to run the Intel pipeline.");
  setRunning(false);
  return;
}
```

Show this error in the same error panel as other pipeline errors, with a "Open Settings →" button.

**Acceptance criteria:**
- [ ] Intel pipeline aborts immediately if Apollo key is not set
- [ ] Error message is shown before any AI stages run
- [ ] "Open Settings →" button opens the Settings modal
- [ ] Pipeline runs normally when key is set

---

### FF-09-T2 — Persist published issue URLs to SQLite

**Files:** `src-tauri/src/runs.rs`, `src-tauri/src/lib.rs`, `src/App.jsx`
**Effort:** 1.5 hours

Add an `update_feature_run_urls` command that stores the GitHub issue URLs after a successful publish. Add a `published_urls` column to `feature_runs`.

**Schema migration** (additive, safe):
```sql
ALTER TABLE feature_runs ADD COLUMN published_urls TEXT NOT NULL DEFAULT '';
```

Run in `init_runs_table` after the CREATE TABLE — SQLite ignores `ALTER TABLE ADD COLUMN` if the column already exists when wrapped in a `CREATE TABLE IF NOT EXISTS` context. Use a separate `execute` with error suppression.

**New Rust command:**
```rust
#[tauri::command]
pub fn update_feature_run_urls(
    db: State<DbConn>,
    id: i64,
    urls: Vec<String>,
) -> Result<(), String>
```
Serializes `urls` to JSON string, updates `published_urls` column for that run id.

**Frontend call** — after successful `create_github_issues`, collect successful URLs and call:
```js
const successUrls = results.filter(r => r.status === "success" && r.url).map(r => r.url);
if (currentRunId && successUrls.length) {
  invoke("update_feature_run_urls", { id: currentRunId, urls: successUrls }).catch(() => {});
}
```

**History display** — in the history panel, runs with `published_urls` show a `• published` badge and the URLs are accessible when loading the run.

**Acceptance criteria:**
- [ ] After publish, issue URLs saved to SQLite for that run
- [ ] Reloading a past run from history shows previously created issue URLs
- [ ] Runs without published URLs show no badge (backward compatible)
- [ ] Column addition is safe on existing databases

---

### FF-09-T3 — Credential verify buttons in Settings

**File:** `src/App.jsx`
**Effort:** 1.5 hours

Add a "Verify" button next to each credential field in Settings. On click, makes a lightweight API call and shows a green "Valid ✓" or red "Invalid ✗" inline result.

**Anthropic verify:** `POST /v1/messages` with `max_tokens: 1` and a trivial message. Success = 200. Failure = 401.

**GitHub verify:** `GET https://api.github.com/user` with the PAT. Success = 200 with login field. Failure = 401 (bad token) or 403 (fine-grained token without user scope).

Since verifying requires making API calls with credentials that may not yet be saved to keychain (user is mid-edit), pass the current field value directly to a new Rust command rather than reading from keychain.

**New Rust commands:**
```rust
#[tauri::command]
pub async fn verify_anthropic_key(api_key: String) -> Result<String, String>
// Returns "Valid" or Err with message

#[tauri::command]
pub async fn verify_github_pat(pat: String) -> Result<String, String>
// Returns GitHub login username or Err with message
```

Register both in `lib.rs`.

**UI:** Small "Verify" link button next to each credential input. Shows spinner while verifying, then inline colored result. Result clears when the input changes.

**Acceptance criteria:**
- [ ] Anthropic verify returns success for valid key, clear error for invalid
- [ ] GitHub verify returns the authenticated username on success
- [ ] Verify works on unsaved values (tests what's in the input, not what's in keychain)
- [ ] Spinner shown while verifying
- [ ] Result resets when input value changes
