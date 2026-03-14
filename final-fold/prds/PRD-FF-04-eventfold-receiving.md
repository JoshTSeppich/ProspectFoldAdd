# PRD-FF-04 · EventFold Receiving Layer (FinalFold Integration)

**Feature:** All EventFold-side changes required to receive contacts, deals, and intel from FinalFold and ProspectFold
**Status:** Planned
**Owner:** Foxworks Studios
**Depends on:** PRD-FF-01, PRD-FF-02, PRD-FF-03, PRD-02 (ProspectFold bridge)

---

## Purpose

PRD-FF-01–03 describe the FinalFold side of each integration. This document consolidates **all EventFold-side changes** into a single implementation spec — so the EventFold developer has one reference rather than hunting across three PRDs.

It also establishes the shared data model (contact schema, deal schema, toast system) that all three integrations rely on.

---

## Overview of Inbound Signals

EventFold receives data from two upstream tools:

| Source | Mechanism | Payload flag | Receiver location |
|--------|-----------|-------------|-----------------|
| **ProspectFold** | Clipboard JSON | `__prospect_intel: true` | Apollo Search page (already shipped) |
| **FinalFold (single contact)** | Clipboard JSON | `__finalfold_contact: true` | Contacts / People page |
| **FinalFold (batch)** | Local temp file `$TMPDIR/finalfold_export.json` | `__finalfold_batch: true` | Contacts / People page |

All three use the same "Paste / Import" UI pattern. ProspectFold is already implemented. This PRD covers the FinalFold receivers.

---

## Shared Contact Schema (EventFold internal)

All contacts created or updated by FinalFold use this schema. Fields map to whatever EventFold's internal contact store uses (SQLite table via Tauri, local JSON, or in-memory state):

```ts
interface EFContact {
  id:                   string;      // EventFold-internal UUID
  apolloId?:            string;      // Apollo person ID (for dedup across runs)
  fullName:             string;
  firstName?:           string;      // Split from fullName
  lastName?:            string;
  jobTitle:             string;
  organizationName:     string;
  organizationDomain?:  string;
  organizationEmployees?: number;
  industry?:            string;
  location?:            string;
  email?:               string;
  emailStatus?:         "verified" | "likely to engage" | "unknown";
  linkedinUrl?:         string;
  photoUrl?:            string;
  leadSource:           "FinalFold" | "ProspectFold" | "Manual" | string;
  prospectFitScore?:    number;       // 0–100; null = no checklist available
  notes:                EFNote[];
  createdAt:            string;       // ISO timestamp
  updatedAt:            string;
}

interface EFNote {
  id:        string;
  body:      string;
  source:    "finalfold" | "manual" | string;
  createdAt: string;
}
```

**Deduplication key:** `email` (case-insensitive). If `email` is null, fall back to `apolloId`. If both are null, always create a new record (no dedup possible).

---

## Shared Deal Schema (EventFold internal)

```ts
interface EFDeal {
  id:            string;      // EventFold-internal UUID
  name:          string;      // e.g. "Acme Corp — CTO"
  contactId:     string;      // FK → EFContact.id
  stage:         "prospect" | "outreach" | "replied" | "meeting" | "closed_won" | "closed_lost" | "cold";
  angle?:        string;      // Prospecting angle name from FinalFold
  hook?:         string;      // One-line outreach hook
  fitScore?:     number;      // 0–100
  qualChecklist?: QualCheck[]; // Serialized from FinalFold
  source:        "finalfold" | "manual" | string;
  sourceRunId?:  string;
  naicsCode?:    string;
  naicsLabel?:   string;
  createdAt:     string;
  updatedAt:     string;
}

interface QualCheck {
  criterion:  string;
  checkable:  boolean;
  passed:     boolean | null;
  note:       string;
}
```

---

## UI Changes Required in EventFold

### 1. Contacts / People Page

**Add to page header (right side):**

```
[+ New Contact]   [Paste from FinalFold ↓]   [Import from FinalFold ↗]
```

- **"Paste from FinalFold ↓"** — reads clipboard, handles single contact + optional deal (PRD-FF-01 + FF-03)
- **"Import from FinalFold ↗"** — reads `$TMPDIR/finalfold_export.json`, handles batch (PRD-FF-02)

Both buttons appear only when EventFold is in "Contacts" or "People" view — not on the Apollo Search page (which has the existing ProspectFold bridge).

### 2. Deal Card Display

On each Deal card in the pipeline view, surface FinalFold data:

```
┌──────────────────────────────────────────────────────┐
│ Acme Corp — CTO                    [Fit: 83%]  [●]  │
│ Sarah Chen · sarah@acmecorp.com                      │
│                                                       │
│ ❝ You're scaling infra at 120 people — we can        │
│   cut deploy time by 40% before your next round. ❞   │
│                                                       │
│ [Infrastructure Scale]  [541511 · Custom Software]   │
│                                                       │
│ ▸ Qual Checklist                                      │
│   ✓ Decision-maker matched    ✓ 120 employees         │
│   ✓ Email verified            ✓ LinkedIn found        │
│   — US-based (manual check)                          │
│                                                       │
│ Sourced via FinalFold · Mar 12, 2026                 │
└──────────────────────────────────────────────────────┘
```

**Fit score color bands:**
- 80–100: green (`#22c55e`)
- 60–79: amber (`#f59e0b`)
- 0–59: red (`#ef4444`)
- null: hidden

### 3. Toast System

All FinalFold-triggered actions use the existing EventFold toast infrastructure. Add these toast variants:

| Action | Toast text |
|--------|-----------|
| Single contact created | "Sarah Chen added to contacts" |
| Single contact updated | "Sarah Chen updated (already exists)" |
| Deal created | "Deal created — Acme Corp · CTO" |
| Deal updated | "Deal updated — hook + fit score refreshed" |
| Batch import success | "9 contacts imported — 7 created, 2 updated" |
| Batch file stale | "Export file is stale — re-export from FinalFold" |
| Batch file not found | "No export found — run FinalFold first" |
| Clipboard not FinalFold | _(silently ignored — no toast)_ |

All toasts use the existing `TOAST_DURATION_MS` constant.

---

## Paste Handler (Consolidated)

Combine the single-contact + deal logic into one `pasteFromFinalFold` callback. This is the complete EventFold-side implementation for PRD-FF-01 and FF-03 combined:

```ts
const pasteFromFinalFold = useCallback(async () => {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text) as Record<string, unknown>;
    if (data.__finalfold_contact !== true) return;
    if (!data.contact || typeof data.contact !== "object") return;

    const c = data.contact as FinalFoldContact;
    const d = data.deal as FinalFoldDeal | undefined;

    // 1. Upsert contact
    const dedupeKey = c.email?.toLowerCase().trim();
    const apolloKey = c.id;
    let contactId: string;

    const existing = contacts.find(x =>
      (dedupeKey && x.email?.toLowerCase() === dedupeKey) ||
      (apolloKey && x.apolloId === apolloKey)
    );

    if (existing) {
      await updateContact(existing.id, {
        prospectFitScore: c.fitScore ?? existing.prospectFitScore,
        notes: c.hook
          ? [...(existing.notes || []), { id: uuid(), body: `FinalFold hook: ${c.hook}`, source: "finalfold", createdAt: new Date().toISOString() }]
          : existing.notes,
        updatedAt: new Date().toISOString(),
      });
      contactId = existing.id;
      setPasteToast({ type: "contact_updated", name: c.name });
    } else {
      const [firstName, ...rest] = (c.name || "").split(" ");
      const newContact = await createContact({
        apolloId:              c.id,
        fullName:              c.name,
        firstName,
        lastName:              rest.join(" "),
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
        notes: c.hook ? [{ id: uuid(), body: `FinalFold hook: ${c.hook}`, source: "finalfold", createdAt: new Date().toISOString() }] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      contactId = newContact.id;
      setPasteToast({ type: "contact_created", name: c.name });
    }

    // 2. Optionally create/update deal
    if (d?.createDeal) {
      const existingDeal = deals.find(x =>
        x.contactId === contactId && x.stage === "prospect"
      );
      if (!existingDeal) {
        await createDeal({
          id:            uuid(),
          name:          d.name,
          contactId,
          stage:         d.stage ?? "prospect",
          angle:         d.angle,
          hook:          d.hook,
          fitScore:      d.fitScore,
          qualChecklist: d.qualChecklist,
          source:        "finalfold",
          sourceRunId:   String(d.intelRunId),
          naicsCode:     d.naicsCode,
          naicsLabel:    d.naicsLabel,
          createdAt:     new Date().toISOString(),
          updatedAt:     new Date().toISOString(),
        });
        setPasteToast({ type: "deal_created", name: d.name });
      } else {
        await updateDeal(existingDeal.id, {
          hook:          d.hook,
          fitScore:      d.fitScore,
          qualChecklist: d.qualChecklist,
          updatedAt:     new Date().toISOString(),
        });
        setPasteToast({ type: "deal_updated", name: d.name });
      }
    }

    setTimeout(() => setPasteToast(null), TOAST_DURATION_MS);
  } catch { /* clipboard empty or non-JSON */ }
}, [contacts, deals]);
```

---

## Tauri Permissions Required

Add to EventFold's `tauri.conf.json` capabilities for batch import:

```json
{
  "identifier": "finalfold-import",
  "description": "Read FinalFold batch export from temp directory",
  "permissions": [
    "fs:allow-read-text-file",
    "fs:allow-temp-dir"
  ]
}
```

Or as a scope entry in `capabilities/default.json`:

```json
{
  "permissions": [
    { "identifier": "fs:scope", "allow": [{ "path": "$TEMP/**" }] }
  ]
}
```

**No other Rust/Cargo changes required.** `fs` read access via the Tauri v2 `fs` plugin is sufficient.

---

## File Summary: What Changes in EventFold

| File | Change |
|------|--------|
| `src/components/ContactsPage.tsx` | Add "Paste from FinalFold" + "Import from FinalFold" buttons; `pasteFromFinalFold` callback; `importFromFinalFold` callback; toast state |
| `src/components/DealCard.tsx` | Add fit score badge; hook quote block; qual checklist expandable; angle + NAICS tags; FinalFold source footer |
| `src/types/contact.ts` | Add `apolloId`, `leadSource`, `prospectFitScore`, `notes` to contact type |
| `src/types/deal.ts` | Add `angle`, `hook`, `fitScore`, `qualChecklist`, `source`, `sourceRunId`, `naicsCode`, `naicsLabel` |
| `src-tauri/capabilities/default.json` | Add `$TEMP/**` fs read scope |
| _(no other files)_ | |

**No changes to:** Cargo.toml, tauri.conf.json (other than capabilities), lib.rs, Apollo Search page

---

## ProspectFold Bridge (Already Shipped — Reference Only)

The existing ProspectFold bridge lives in `ApolloSearch.tsx`. It is independent of the FinalFold bridge and does not need modification. For reference, the full data flow across all three tools:

```
ProspectFold (Electron)
  └─ "→ EventFold" on Apollo SearchCard
       └─ clipboard: { __prospect_intel: true, industry, titles, seniority }
            └─ EventFold ApolloSearch.tsx: "Paste from Prospect Intel"
                 └─ fills Apollo Search filters

FinalFold (Tauri)
  └─ "→ EventFold" on ContactCard (single)
       └─ clipboard: { __finalfold_contact: true, contact: {...}, deal: {...} }
            └─ EventFold ContactsPage.tsx: "Paste from FinalFold"
                 └─ creates/updates contact + deal

FinalFold (Tauri)
  └─ "Export to EventFold ↗" (batch)
       └─ $TMPDIR/finalfold_export.json: { __finalfold_batch: true, contacts: [...] }
            └─ EventFold ContactsPage.tsx: "Import from FinalFold"
                 └─ bulk upserts contacts
```
