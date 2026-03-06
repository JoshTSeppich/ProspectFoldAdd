# PRD 02 — EventFold CRM: Apollo Search Auto-Fill
**Status:** Ready to design
**Owner:** Foxworks Studios
**Depends on:** PRD 01 (ProspectCrafter App built and bundled)

---

## Problem

The Apollo Search interface in EventFold CRM requires manual field entry every time a new prospecting campaign starts. When ProspectCrafter generates an ICP package (titles, industries, seniority, signals), that data sits in a separate tool and has to be manually re-typed into Apollo. This is friction that kills the workflow.

---

## Goal

When a user runs ProspectCrafter and gets an ICP result, they can push the Apollo-specific fields directly into the EventFold Apollo Search form with one click — no copy-paste, no manual entry.

---

## User Story

> As a Foxworks sales rep, after generating a prospect intel package in ProspectCrafter, I want to click "Load into Apollo" and have the Apollo Search fields in EventFold pre-filled with the ICP data, so I can go straight to searching without re-entering anything.

---

## Scope

### In scope
- "Load into Apollo" button in ProspectCrafter results (Apollo tab)
- EventFold Apollo Search fields that get auto-filled:
  - Title / Role
  - Industry
  - Seniority
  - Company Name (optional, from `company_types` if specific enough)
  - Keywords (from `signals`)
- IPC/postMessage bridge between ProspectCrafter webview and EventFold main process

### Out of scope
- Auto-submitting the Apollo search (user clicks Search themselves)
- LinkedIn or Google search auto-fill (separate feature)
- Saving/loading multiple ICP profiles (separate PRD)
- Apollo API integration (EventFold uses Apollo's UI, not the API)

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| F1 | ProspectCrafter Apollo tab shows a "Load into EventFold →" button when results are present |
| F2 | Clicking the button sends the Apollo ICP fields to EventFold via `window.postMessage` or Electron IPC |
| F3 | EventFold receives the payload and populates the Apollo Search fields without user input |
| F4 | Fields that have no ICP data are left blank (no overwriting with empty strings) |
| F5 | A toast/confirmation appears in EventFold: "Apollo fields loaded from ProspectCrafter" |
| F6 | The user can still manually edit any field after auto-fill before searching |

---

## Data Contract

ProspectCrafter sends this payload to EventFold:

```ts
interface ApolloAutoFillPayload {
  source: "prospect-crafter";
  version: 1;
  fields: {
    title?: string;        // e.g. "Head of AI, Director of AI, VP Engineering"
    industry?: string;     // e.g. "Computer Software, Internet"
    seniority?: string;    // e.g. "director, vp, c_suite"
    company?: string;      // optional
    keywords?: string;     // from buying signals, comma-separated
  };
}
```

---

## IPC / Bridge Options

| Option | When to use |
|--------|-------------|
| `window.postMessage` | ProspectCrafter runs in an Electron webview, EventFold listens on the parent frame |
| Electron `ipcRenderer` → `ipcMain` → EventFold window | If ProspectCrafter is a separate BrowserWindow |
| Local REST endpoint (EventFold exposes port) | If ProspectCrafter runs as a separate web process |

Decision: **default to `postMessage`** if webview, fall back to IPC if separate window. EventFold team to confirm architecture.

---

## Apollo Field Mapping

| ProspectCrafter field | Apollo Search field | Notes |
|---|---|---|
| `icp.titles` (array → join) | Title / Role | Join with ", " |
| Apollo search `filters.industry` | Industry | From first Apollo search entry |
| Apollo search `filters.company_size` | — | Not a visible field in current UI |
| `icp.signals` (first 3, joined) | Keywords (if field exists) | Truncate to 100 chars |
| — | Seniority | From Apollo filters object |

---

## Acceptance Criteria

- [ ] "Load into EventFold →" button appears in ProspectCrafter when Apollo results exist
- [ ] Clicking the button with EventFold open populates all mapped fields
- [ ] Clicking with EventFold closed shows a user-friendly error: "EventFold is not open"
- [ ] Auto-filled fields are editable before search
- [ ] Toast confirmation appears in EventFold within 500ms of receiving payload
- [ ] No fields are cleared if the ICP data for that field is empty/missing
