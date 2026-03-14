use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct DbConn(pub Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedRepo {
    pub id: i64,
    pub owner: String,
    pub repo_name: String,
    pub display_label: String,
}

/// Initializes the SQLite database, creating tables if they don't exist.
pub fn init_db(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_repos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            owner         TEXT NOT NULL,
            repo_name     TEXT NOT NULL,
            display_label TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            UNIQUE(owner, repo_name)
        );",
    )
}

#[tauri::command]
pub fn list_saved_repos(db: State<DbConn>) -> Result<Vec<SavedRepo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, owner, repo_name, display_label FROM saved_repos ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([], |row| {
            Ok(SavedRepo {
                id: row.get(0)?,
                owner: row.get(1)?,
                repo_name: row.get(2)?,
                display_label: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut rows = Vec::new();
    for r in mapped {
        rows.push(r.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

#[tauri::command]
pub fn upsert_saved_repo(
    db: State<DbConn>,
    owner: String,
    repo_name: String,
    display_label: Option<String>,
) -> Result<(), String> {
    let label = display_label.unwrap_or_else(|| format!("{}/{}", owner, repo_name));
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO saved_repos (owner, repo_name, display_label, created_at)
         VALUES (?1, ?2, ?3, strftime('%s','now'))
         ON CONFLICT(owner, repo_name) DO UPDATE SET
             display_label = excluded.display_label,
             created_at    = excluded.created_at",
        params![owner, repo_name, label],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_saved_repo(db: State<DbConn>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM saved_repos WHERE id = ?1", params![id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}
