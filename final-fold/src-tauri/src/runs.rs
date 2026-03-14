use crate::generator::{FeatureBrief, IssuePayload};
use crate::repos::DbConn;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

// ── Data types ────────────────────────────────────────────────────────────────

/// Summary shown in the History panel — no heavy JSON blobs.
#[derive(Debug, Serialize, Deserialize)]
pub struct FeatureRunSummary {
    pub id: i64,
    pub repo_owner: String,
    pub repo_name: String,
    /// Truncated to 80 chars for display.
    pub idea_preview: String,
    pub prospect_name: String,
    pub created_at: i64,
}

/// Full run record returned when re-opening a history entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct FeatureRun {
    pub id: i64,
    pub repo_owner: String,
    pub repo_name: String,
    pub idea: String,
    pub prospect_name: String,
    pub prospect_notes: String,
    pub brief: FeatureBrief,
    pub issues: Vec<IssuePayload>,
    pub published_urls: Vec<String>,
    pub created_at: i64,
}

/// Input shape for saving a run.
#[derive(Debug, Serialize, Deserialize)]
pub struct SaveRunInput {
    pub repo_owner: String,
    pub repo_name: String,
    pub idea: String,
    pub prospect_name: String,
    pub prospect_notes: String,
    pub brief: FeatureBrief,
    pub issues: Vec<IssuePayload>,
}

// ── Schema init ───────────────────────────────────────────────────────────────

pub fn init_runs_table(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Create table if it doesn't exist (without published_urls for compat)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS feature_runs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_owner      TEXT NOT NULL,
            repo_name       TEXT NOT NULL,
            idea            TEXT NOT NULL,
            prospect_name   TEXT NOT NULL DEFAULT '',
            prospect_notes  TEXT NOT NULL DEFAULT '',
            brief_json      TEXT NOT NULL,
            issues_json     TEXT NOT NULL,
            published_urls  TEXT NOT NULL DEFAULT '[]',
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );",
    )?;
    // Migration: add column to existing DBs — ignore error if already present
    let _ = conn.execute_batch(
        "ALTER TABLE feature_runs ADD COLUMN published_urls TEXT NOT NULL DEFAULT '[]';",
    );
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Saves a completed generation run to SQLite. Returns the new row id.
/// Called automatically by the frontend after every successful generation.
#[tauri::command]
pub fn save_feature_run(
    db: State<DbConn>,
    input: SaveRunInput,
) -> Result<i64, String> {
    let brief_json =
        serde_json::to_string(&input.brief).map_err(|e| format!("Failed to serialize brief: {}", e))?;
    let issues_json = serde_json::to_string(&input.issues)
        .map_err(|e| format!("Failed to serialize issues: {}", e))?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO feature_runs
            (repo_owner, repo_name, idea, prospect_name, prospect_notes, brief_json, issues_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.repo_owner,
            input.repo_name,
            input.idea,
            input.prospect_name,
            input.prospect_notes,
            brief_json,
            issues_json,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

/// Lists the 50 most recent runs for the History panel.
/// Returns lightweight summaries (no JSON blobs).
#[tauri::command]
pub fn list_feature_runs(db: State<DbConn>) -> Result<Vec<FeatureRunSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, repo_owner, repo_name, idea, prospect_name, created_at
             FROM feature_runs
             ORDER BY created_at DESC
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let idea: String = row.get(3)?;
            let preview = if idea.len() > 80 {
                format!("{}…", &idea[..80])
            } else {
                idea
            };
            Ok(FeatureRunSummary {
                id: row.get(0)?,
                repo_owner: row.get(1)?,
                repo_name: row.get(2)?,
                idea_preview: preview,
                prospect_name: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

/// Loads a full run by id, deserializing brief and issues from JSON.
/// Used when re-opening a history entry in Preview mode.
#[tauri::command]
pub fn load_feature_run(db: State<DbConn>, id: i64) -> Result<FeatureRun, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, repo_owner, repo_name, idea, prospect_name, prospect_notes,
                    brief_json, issues_json, published_urls, created_at
             FROM feature_runs WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let run = stmt
        .query_row(params![id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?, // brief_json
                row.get::<_, String>(7)?, // issues_json
                row.get::<_, String>(8).unwrap_or_else(|_| "[]".to_string()), // published_urls
                row.get::<_, i64>(9)?,
            ))
        })
        .map_err(|e| format!("Run not found: {}", e))?;

    let brief: FeatureBrief = serde_json::from_str(&run.6)
        .map_err(|e| format!("Failed to deserialize brief: {}", e))?;
    let issues: Vec<IssuePayload> = serde_json::from_str(&run.7)
        .map_err(|e| format!("Failed to deserialize issues: {}", e))?;
    let published_urls: Vec<String> = serde_json::from_str(&run.8)
        .unwrap_or_default();

    Ok(FeatureRun {
        id: run.0,
        repo_owner: run.1,
        repo_name: run.2,
        idea: run.3,
        prospect_name: run.4,
        prospect_notes: run.5,
        brief,
        issues,
        published_urls,
        created_at: run.9,
    })
}

/// Updates the published GitHub issue URLs for a run after successful creation.
#[tauri::command]
pub fn update_feature_run_urls(
    db: State<DbConn>,
    id: i64,
    urls: Vec<String>,
) -> Result<(), String> {
    let urls_json = serde_json::to_string(&urls)
        .map_err(|e| format!("Failed to serialize URLs: {}", e))?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE feature_runs SET published_urls = ?1 WHERE id = ?2",
        params![urls_json, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
