# PRD-FF-02 · FinalFold Batch Contact Export to EventFold

**Feature:** Export all enriched contacts from a FinalFold run into EventFold in one operation
**Status:** Planned
**Owner:** Foxworks Studios
**Depends on:** PRD-FF-01 (contact schema + EventFold receiving logic)

---

## Problem

PRD-FF-01 covers sending one contact at a time. In practice, a FinalFold run produces 10–30 contacts. Clicking "→ EventFold" 15 times is still friction. Batch export removes that entirely: one click sends the full filtered contact list, EventFold processes all of them, and reports how many were created vs. updated vs. skipped.

---

## Design Decision: Local File vs. Clipboard

A single contact fits comfortably in the clipboard. A batch of 25 contacts (each with notes, fit scores, hooks) is ~30–50KB — still within clipboard limits, but more fragile across OS paste operations and potentially confusing if the user accidentally pastes somewhere else.

**Decision: Local temp file written by FinalFold, read by EventFold via Tauri `fs` API.**

| Approach | FinalFold change | EventFold change | Notes |
|----------|-----------------|-----------------|-------|
| **Local temp file** | Write JSON to `$TMPDIR/finalfold_export.json` | Read file on button click | No clipboard size limit; file can be validated before import |
| Clipboard JSON array | Write array to clipboard | Parse array | Works for small batches; fragile for large ones |

**File path:** `$TMPDIR/finalfold_export.json` (platform temp directory, writable by both apps without special entitlements)

**Handshake:** FinalFold writes the file + sets `localStorage['ff_export_ready'] = timestamp`. EventFold checks `$TMPDIR/finalfold_export.json` exists and was modified within the last 5 minutes.

---

## Export File Schema

```json
{
  "__finalfold_batch": true,
  "version": 1,
  "exportedAt": "2026-03-12T20:00:00.000Z",
  "sourceRunId": 1742087412000,
  "filter": "email",
  "totalInRun": 22,
  "exportedCount": 9,
  "contacts": [
    {
      "id": "apollo_person_id",
      "name": "Sarah Chen",
      "title": "CTO",
      "company": "Acme Corp",
      "companyDomain": "acmecorp.com",
      "companySize": 120,
      "industry": "Software Development",
      "location": "San Francisco, CA",
      "email": "sarah@acmecorp.com",
      "emailStatus": "verified",
      "linkedinUrl": "https://linkedin.com/in/sarahchen",
      "photoUrl": "https://...",
      "fitScore": 83,
      "hook": "You're scaling infra at 120 people...",
      "source": "finalfold",
      "sourceRunId": 1742087412000
    }
  ]
}
```

**`filter` values:**
- `"email"` — only contacts with verified or likely email (default recommended)
- `"all"` — all contacts regardless of email status

---

## FinalFold Implementation

### UI

**Button location:** Results header, right side, alongside the filter toggle (`All` / `Has Email`).

```
[22 contacts]  [9 with email]          [All ▾] [Has Email ▾]  [Export to EventFold ↗]
```

**Export options (dropdown on button):**
- "Export with email only (9)" — default, recommended
- "Export all (22)" — includes contacts with no email

### Implementation

Add a Tauri command in `lib.rs` to write the temp file:

```rust
#[tauri::command]
fn write_export_file(json: String) -> Result<(), String> {
    let tmp = std::env::temp_dir().join("finalfold_export.json");
    std::fs::write(&tmp, json)
        .map_err(|e| format!("Failed to write export file: {}", e))
}
```

Expose it in `invoke_handler`:
```rust
tauri::generate_handler![anthropic_chat, apollo_people_search, apollo_bulk_match, open_url, write_export_file]
```

Frontend:
```js
const exportToEventFold = async (filterMode = "email") => {
  const toExport = filterMode === "email"
    ? contacts.filter(x => x.email)
    : contacts;

  const payload = JSON.stringify({
    __finalfold_batch: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceRunId: currentRunId,
    filter: filterMode,
    totalInRun: contacts.length,
    exportedCount: toExport.length,
    contacts: toExport.map(c => ({
      id:            c.id,
      name:          c.name,
      title:         c.title,
      company:       c.company,
      companyDomain: c.companyDomain,
      companySize:   c.companySize,
      industry:      c.industry,
      location:      c.location,
      email:         c.email,
      emailStatus:   c.emailStatus,
      linkedinUrl:   c.linkedinUrl,
      photoUrl:      c.photoUrl,
      fitScore:      fitScore(runQualChecks(c, checklist, targetTitles)),
      hook:          c.hook,
      source:        "finalfold",
      sourceRunId:   currentRunId,
    })),
  }, null, 2);

  await invoke("write_export_file", { json: payload });
  setExportState("ready"); // button turns green: "✓ Ready — open EventFold"
  setTimeout(() => setExportState("idle"), 8000);
};
```

### Button states

| State | Label | Color |
|-------|-------|-------|
| `idle` | "Export to EventFold ↗" | Border/muted |
| `ready` | "✓ Ready — open EventFold" | Green |
| `error` | "Export failed" | Red |

---

## EventFold Implementation

### Changes to EventFold

**File:** `src/components/ContactsPage.tsx` (or equivalent)

1. Add "Import from FinalFold" button in the page header.
2. Add `importFromFinalFold` callback:

```ts
const importFromFinalFold = useCallback(async () => {
  try {
    const tmpPath = await path.tempDir() + "/finalfold_export.json";
    const text = await fs.readTextFile(tmpPath);
    const data = JSON.parse(text);

    if (data.__finalfold_batch !== true) {
      setImportError("File is not a valid FinalFold export.");
      return;
    }

    // Check freshness — reject files older than 5 minutes
    const exportedAt = new Date(data.exportedAt).getTime();
    if (Date.now() - exportedAt > 5 * 60 * 1000) {
      setImportError("Export file is stale — re-export from FinalFold.");
      return;
    }

    let created = 0, updated = 0, skipped = 0;
    for (const c of data.contacts) {
      const existing = contacts.find(
        x => c.email && x.email?.toLowerCase() === c.email.toLowerCase()
      );
      if (existing) {
        await updateContact(existing.id, {
          prospectFitScore: c.fitScore,
          notes: c.hook ? [...(existing.notes || []), {
            body: `FinalFold hook: ${c.hook}`,
            source: "finalfold",
            createdAt: new Date().toISOString(),
          }] : existing.notes,
        });
        updated++;
      } else {
        await createContact({
          fullName:              c.name,
          jobTitle:              c.title,
          organizationName:      c.company,
          organizationDomain:    c.companyDomain,
          organizationEmployees: c.companySize,
          industry:              c.industry,
          location:              c.location,
          email:                 c.email,
          emailStatus:           c.emailStatus,
          linkedinUrl:           c.linkedinUrl,
          photoUrl:              c.photoUrl,
          leadSource:            "FinalFold",
          prospectFitScore:      c.fitScore,
          notes: c.hook ? [{
            body: `FinalFold hook: ${c.hook}`,
            source: "finalfold",
            createdAt: new Date().toISOString(),
          }] : [],
        });
        created++;
      }
    }

    setImportResult({ created, updated, skipped });
    setTimeout(() => setImportResult(null), TOAST_DURATION_MS * 2);
  } catch (e) {
    setImportError(String(e));
  }
}, [contacts]);
```

3. Add result toast: `"9 contacts imported — 7 created, 2 updated"`

**Rust entitlement needed in EventFold's `tauri.conf.json`:**
```json
"fs": {
  "readFile": true,
  "scope": ["$TEMP/*"]
}
```

---

## User Flow

```
FinalFold
  1. Run completes → 22 contacts, 9 with email
  2. Click "Export to EventFold ↗" → select "With email only (9)"
  3. File written to $TMPDIR/finalfold_export.json
  4. Button turns green: "✓ Ready — open EventFold"

EventFold
  5. Open Contacts page
  6. Click "Import from FinalFold"
  7. File read, parsed, validated
  8. 7 contacts created, 2 updated (already existed from a prior run)
  9. Toast: "9 contacts imported — 7 created, 2 updated"
```

Total time: ~5 seconds for 25 contacts

---

## Edge Cases

| Scenario | Behavior |
|----------|---------|
| No contacts with email | Export still works; exports all 0 email contacts; toast warns |
| File older than 5 minutes | EventFold shows error: "Export file is stale — re-export" |
| File not found | EventFold shows: "No export found — run FinalFold first" |
| Duplicate email in batch | First occurrence wins; subsequent skipped with `skipped++` |
| EventFold contacts store is empty | All contacts created; no update path needed |

---

## Future Improvements

- **Import history** — EventFold logs each FinalFold import with timestamp and contact count; visible in a "Sources" section
- **Conflict resolution UI** — before importing, show a diff: "7 new · 2 will update (email already exists)" — allow user to choose per-contact
- **Tag by run** — option to tag all contacts from a given FinalFold run with a shared tag (e.g., `"FF-Run-2026-03-12"`) for easy filtering
- **Auto-import on file change** — EventFold watches `$TMPDIR/finalfold_export.json` for changes and prompts when a new export is ready
