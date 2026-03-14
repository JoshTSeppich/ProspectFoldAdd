# PRD-FF-07: Persistence & Prospect Context

**Status:** Ready for implementation
**Priority:** High (growth-enabling)
**Effort:** ~2-3 days

---

## Problem

Feature Fold loses all generated work when the app closes. This kills trust in the tool as a daily-use instrument. If someone generates a great issue set during a client call and closes their laptop, that work is gone.

Additionally, every generation is context-free — Claude has no knowledge of who the client is, what stack they use, or what pain they described. This means generated issues are generic. A React/Postgres fintech client gets the same kind of output as a Rails/Redis healthcare company, unless the user manually describes the stack in their feature idea text every time.

Both issues are solvable in a single PRD:
1. Persist every successful generation to SQLite automatically
2. Add a "prospect context" field that enriches the prompt and is persisted per-run

---

## Goals

- Auto-save every successful generation to SQLite (no user action required)
- Display a "History" panel listing past runs, reopenable in Preview mode
- Add a prospect context field to the generation form (client name, stack, context notes)
- Inject prospect context into the Claude system prompt to improve issue relevance
- Add a "Copy Proposal Draft" action to the Preview view that generates a client-readable scope document

---

## Non-Goals

- Full client workspace / CRM functionality (tracked as future PRD)
- Export to PDF or Notion (future)
- History search or filtering (future)

---

## Data Model

### New SQLite table: `feature_runs`

```sql
CREATE TABLE IF NOT EXISTS feature_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_owner      TEXT NOT NULL,
    repo_name       TEXT NOT NULL,
    idea            TEXT NOT NULL,
    prospect_name   TEXT NOT NULL DEFAULT '',
    prospect_notes  TEXT NOT NULL DEFAULT '',
    brief_json      TEXT NOT NULL,   -- serialized FeatureBrief as JSON
    issues_json     TEXT NOT NULL,   -- serialized Vec<IssuePayload> as JSON
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

### New Rust structs

```rust
pub struct FeatureRun {
    pub id: i64,
    pub repo_owner: String,
    pub repo_name: String,
    pub idea: String,
    pub prospect_name: String,
    pub prospect_notes: String,
    pub brief_json: String,
    pub issues_json: String,
    pub created_at: i64,
}

pub struct SaveRunInput {
    pub repo_owner: String,
    pub repo_name: String,
    pub idea: String,
    pub prospect_name: String,
    pub prospect_notes: String,
    pub brief: FeatureBrief,      // serialized internally
    pub issues: Vec<IssuePayload>, // serialized internally
}
```

---

## Tickets

### FF-07-T1 — Add feature_runs table and Tauri commands

**File:** `src-tauri/src/repos.rs` (extend existing), or new `src-tauri/src/runs.rs`
**Effort:** 3-4 hours
**Severity:** High

**What:** Add the `feature_runs` table to the SQLite init, and expose three new Tauri commands: `save_feature_run`, `list_feature_runs`, and `load_feature_run`.

**Commands to implement:**

`save_feature_run(input: SaveRunInput) -> Result<i64, String>`
- Serializes `brief` and `issues` to JSON strings via `serde_json::to_string`
- Inserts into `feature_runs`
- Returns the new row `id`

`list_feature_runs() -> Result<Vec<FeatureRunSummary>, String>`
- Returns id, repo_owner, repo_name, idea (truncated to 80 chars), prospect_name, created_at
- Ordered by `created_at DESC`
- Max 50 rows (LIMIT 50)

`load_feature_run(id: i64) -> Result<FeatureRun, String>`
- Returns full run by id including brief_json and issues_json
- Frontend deserializes these back into `FeatureBrief` and `IssuePayload[]`

**Register all three in `lib.rs` invoke_handler.**

**Acceptance criteria:**
- [ ] `feature_runs` table is created on first app launch
- [ ] `save_feature_run` stores a run and returns its id
- [ ] `list_feature_runs` returns runs newest-first, truncated idea text
- [ ] `load_feature_run` returns full run data including brief and issues JSON
- [ ] All commands registered in `lib.rs`

---

### FF-07-T2 — Auto-save runs after successful generation

**File:** `src/App.jsx`
**Effort:** 1-2 hours
**Severity:** High

**What:** After a successful `generate_feature_request` call, immediately call `save_feature_run` to persist the result. Store the returned run `id` in state so it can be used for re-loading.

**State additions:**
```js
const [currentRunId, setCurrentRunId] = useState(null);
const [prospectName, setProspectName] = useState("");
const [prospectNotes, setProspectNotes] = useState("");
```

**After successful generation:**
```js
const runId = await invoke("save_feature_run", {
  input: {
    repo_owner: selectedRepo.owner,
    repo_name: selectedRepo.repo_name,
    idea: featureIdea,
    prospect_name: prospectName,
    prospect_notes: prospectNotes,
    brief: generatedBrief,
    issues: generatedIssues,
  }
});
setCurrentRunId(runId);
```

**Acceptance criteria:**
- [ ] Every successful generation is saved to SQLite automatically
- [ ] Run is saved before transitioning to Preview view
- [ ] Save failure does not block the user from seeing the Preview (log error, continue)

---

### FF-07-T3 — Add History panel to UI

**File:** `src/App.jsx`
**Effort:** 3-4 hours
**Severity:** High

**What:** Add a "History" section accessible from the Feature Request view. Lists past runs. Clicking a run loads it back into Preview mode.

**UI location:** A collapsible "History" panel below the generation input form in the Input view. Shows the last 10 runs as cards: date, repo, idea snippet, prospect name (if set).

**Load behavior:**
1. User clicks a history card
2. App calls `load_feature_run(id)`
3. Deserializes `brief_json` and `issues_json` back into state
4. Transitions directly to Preview view with that run's data

**History card display:**
```
[repo owner/name]  [prospect name if set]  [relative time]
[idea truncated to 60 chars]
```

**State additions:**
```js
const [featureRuns, setFeatureRuns] = useState([]);
```

Load runs on component mount and after each save:
```js
const runs = await invoke("list_feature_runs");
setFeatureRuns(runs);
```

**Acceptance criteria:**
- [ ] History panel shows last 10 runs
- [ ] Clicking a run loads it into Preview without re-generating
- [ ] Runs persist across app restarts
- [ ] Empty state shows "No previous runs" message
- [ ] History refreshes after each new generation

---

### FF-07-T4 — Add prospect context field to generation form

**File:** `src/App.jsx`, `src-tauri/src/generator.rs`
**Effort:** 3-4 hours
**Severity:** Medium-High (growth leverage)

**What:** Add a collapsible "Client Context" section to the generation Input view. Captures client name and context notes. This data is injected into the Claude system prompt to make generated issues client-specific.

**Frontend — new form section:**
A collapsible panel below the feature idea textarea, labeled "Client Context (optional)":
- "Client name" — single-line text input (e.g., "Acme Corp")
- "Context" — multi-line textarea (e.g., "React frontend, Rails API, Postgres. Struggling with manual weekly reporting. 30 employees, Series A.")

These fields are remembered in state but not persisted between sessions independently — they're saved as part of each run automatically via FF-07-T2.

**Rust — inject context into system prompt:**

Update `generate_feature_request` to accept `prospect_name: String` and `prospect_notes: String` parameters.

Update `build_system_prompt` to include context when provided:

```rust
fn build_system_prompt(owner: &str, repo_name: &str, prospect_name: &str, prospect_notes: &str) -> String {
    let context_block = if !prospect_name.is_empty() || !prospect_notes.is_empty() {
        format!(
            "\n\nCLIENT CONTEXT:\nClient: {}\nNotes: {}\n\nUse this context to make generated issues specific to this client's stack, team size, and pain points. Reference the client's actual technology choices and constraints where relevant.",
            prospect_name, prospect_notes
        )
    } else {
        String::new()
    };

    format!(
        r#"You are a senior software architect...{context_block}

Target repo context: {owner}/{repo_name}"#,
        // ... rest of existing prompt
        context_block = context_block,
        owner = owner,
        repo_name = repo_name
    )
}
```

**Acceptance criteria:**
- [ ] Client Context panel is collapsible (defaults to collapsed)
- [ ] Client name and notes fields accept free text
- [ ] When context is provided, generated issues reference the client's stack/context
- [ ] When context is empty, generation works exactly as before (no regression)
- [ ] Context is saved with each run via `save_feature_run`

---

### FF-07-T5 — Add "Copy Proposal Draft" to Preview view

**File:** `src/App.jsx`, `src-tauri/src/generator.rs`
**Effort:** 2-3 hours
**Severity:** Medium (sales leverage)

**What:** Add a "Copy Proposal Draft" button to the Preview view. Clicking it generates a client-readable 1-page scope document as markdown from the current `FeatureBrief` + `IssuePayload[]`, then copies it to the clipboard.

The proposal draft is generated client-side (no additional API call needed) by formatting the existing data into a structured markdown template. No new Claude call is required.

**Template:**
```markdown
# [feature_name] — Scope Summary

**Client:** [prospect_name or "—"]
**Repository:** [owner/repo_name]
**Date:** [today]

## What We're Building

[brief.summary]

## Problem Being Solved

[brief.problem]

## Goals

[brief.goals as bullet list]

## What's Not Included

[brief.non_goals as bullet list]

## Proposed Work Breakdown

| # | Issue | Area | Est. Complexity |
|---|-------|------|----------------|
| 1 | [title] | [area] | — |
...

## Acceptance Criteria (Selected)

[acceptance_criteria from first 3 issues]

## Next Steps

1. Review this scope and confirm the priority order
2. Identify any missing requirements or out-of-scope items
3. Proceed with implementation planning

---
*Generated by Feature Fold — Foxworks*
```

**Implementation:**
Pure JavaScript string template using `generatedBrief`, `generatedIssues`, `selectedRepo`, `prospectName`.
Use `navigator.clipboard.writeText(markdown)` to copy.
Show a "Copied!" toast for 2 seconds.

**Acceptance criteria:**
- [ ] "Copy Proposal Draft" button visible in Preview view
- [ ] Clicking copies markdown to clipboard
- [ ] Markdown renders correctly when pasted into Notion, GitHub, or a markdown editor
- [ ] "Copied!" confirmation appears for 2 seconds
- [ ] Prospect name is included if set; shows "—" if not

---

## Testing

Manual test sequence:
1. Generate an issue set → verify run appears in SQLite (`select * from feature_runs`)
2. Close app → reopen → verify History panel shows previous run
3. Click a history run → verify it loads into Preview correctly
4. Add client context → generate → verify issues reference the client's stack
5. Click "Copy Proposal Draft" → paste into a markdown editor → verify formatting
6. Generate with empty client context → verify no regression in issue quality
