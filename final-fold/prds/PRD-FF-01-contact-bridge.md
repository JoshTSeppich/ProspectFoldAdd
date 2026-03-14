# PRD-FF-01 · FinalFold → EventFold Single Contact Bridge

**Feature:** One-click transfer of a single enriched contact from FinalFold into EventFold's People/Contacts store
**Status:** Planned
**Owner:** Foxworks Studios
**Depends on:** EventFold contacts/people module

---

## Problem

FinalFold finds real, enriched contacts — name, title, company, verified email, LinkedIn, fit score, personalized hook. EventFold is where those contacts turn into tracked deals. Without a bridge, the user has to manually copy each field from FinalFold and retype it into EventFold, which is slow and error-prone.

The bridge makes it one click: FinalFold writes the contact to the clipboard, EventFold reads it and creates or updates the contact record.

---

## Design Decision: Clipboard over Direct IPC

FinalFold and EventFold are separate Tauri apps with separate processes. Options evaluated:

| Approach | Complexity | Requires co-install | Notes |
|----------|-----------|--------------------|----|
| **Clipboard JSON** | Low | No | Same pattern as ProspectFold → EventFold bridge; already proven |
| Named pipe / local socket | Medium | Yes (both must be running + listening) | Fragile across app restarts |
| Shared local file | Low | No | Works but requires EventFold to poll/watch a file |
| Tauri deep link (`eventfold://`) | High | Yes (OS URL scheme registration) | Requires build + install changes on EventFold side |

**Clipboard chosen.** Zero OS-level registration, zero new dependencies, consistent with the existing ProspectFold bridge pattern, and just as fast from a UX standpoint.

---

## Clipboard Payload

FinalFold writes the following JSON when "→ EventFold" is clicked on a ContactCard:

```json
{
  "__finalfold_contact": true,
  "version": 1,
  "contact": {
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
    "hook": "You're scaling infra at 120 people — we can cut deploy time by 40% before your next funding round.",
    "source": "finalfold",
    "sourceRunId": 1742087412000
  }
}
```

**The `__finalfold_contact: true` flag** is a namespace guard. EventFold silently ignores clipboard content that doesn't have this flag set to `true`. This prevents accidental form fills from unrelated clipboard content.

**Field mapping to EventFold's contact schema:**

| Payload field | EventFold field | Notes |
|-------------|---------------|-------|
| `name` | `full_name` | Split into first/last on EventFold side |
| `title` | `job_title` | |
| `company` | `organization_name` | |
| `companyDomain` | `organization_domain` | Used for company record lookup/creation |
| `companySize` | `organization_num_employees` | |
| `industry` | `industry` | |
| `location` | `city` / `country` | Parse if EventFold splits location |
| `email` | `email` | Primary email |
| `emailStatus` | `email_status` | `"verified"` / `"likely to engage"` |
| `linkedinUrl` | `linkedin_url` | |
| `photoUrl` | `photo_url` | Optional avatar |
| `fitScore` | _(custom field or tag)_ | Store as `prospect_fit_score` tag or custom field |
| `hook` | _(contact note)_ | Auto-created note on contact record: "FinalFold hook: ..." |
| `source` | `lead_source` | Set to `"FinalFold"` |

---

## FinalFold Implementation

### Trigger
"→ EventFold" button on each ContactCard in the results grid.

### Button location
Bottom-right of each ContactCard, alongside the existing copy-email button.

### Source data
The `contact` object already exists in FinalFold's state. Add `fitScore` (from `runQualChecks` + `fitScore()`) and `hook` (already on `contact.hook`) to the payload.

```jsx
const sendToEventFold = async (contact) => {
  const payload = JSON.stringify({
    __finalfold_contact: true,
    version: 1,
    contact: {
      id:            contact.id,
      name:          contact.name,
      title:         contact.title,
      company:       contact.company,
      companyDomain: contact.companyDomain,
      companySize:   contact.companySize,
      industry:      contact.industry,
      location:      contact.location,
      email:         contact.email,
      emailStatus:   contact.emailStatus,
      linkedinUrl:   contact.linkedinUrl,
      photoUrl:      contact.photoUrl,
      fitScore:      fitScore(runQualChecks(contact, checklist, targetTitles)),
      hook:          contact.hook,
      source:        "finalfold",
      sourceRunId:   currentRunId,
    },
  });
  await navigator.clipboard.writeText(payload);
};
```

### Visual feedback
Button flashes from current accent "→ EventFold" to green "✓ Sent" for 2 seconds, then reverts. Per-card state — clicking one card's button does not affect others.

---

## EventFold Implementation

### Changes to EventFold (single file, TSX only)

**File:** `src/components/PeopleSearch.tsx` (or equivalent contacts list page)

1. Add "Paste from FinalFold" button in the page header (alongside existing actions).
2. Add `pasteFromFinalFold` callback:

```ts
const pasteFromFinalFold = useCallback(async () => {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    if (data.__finalfold_contact !== true) return;
    const c = data.contact;

    // Deduplication: check if contact with this email already exists
    const existing = contacts.find(x =>
      x.email?.toLowerCase() === c.email?.toLowerCase()
    );

    if (existing) {
      // Update hook note + fit score on existing contact
      updateContact(existing.id, {
        prospectFitScore: c.fitScore,
        notes: [...(existing.notes || []), {
          body: `FinalFold hook: ${c.hook}`,
          source: "finalfold",
          createdAt: new Date().toISOString(),
        }],
      });
      setPasteToast({ type: "updated", name: c.name });
    } else {
      // Create new contact
      createContact({
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
      setPasteToast({ type: "created", name: c.name });
    }

    setTimeout(() => setPasteToast(null), TOAST_DURATION_MS);
  } catch { /* clipboard empty or non-JSON */ }
}, [contacts]);
```

3. Add toast:
   - On create: `"Sarah Chen added to contacts"`
   - On update: `"Sarah Chen updated (already exists)"`

**No changes to:** Cargo.toml, tauri.conf.json, lib.rs, capabilities, package.json

---

## User Flow

```
FinalFold
  1. Paste intel pack → Run Intel Brief
  2. Pipeline completes → 14 contacts found, 9 with email
  3. ContactCard: "Sarah Chen · CTO · Acme Corp · ✓ verified"
     fitScore: 83 · hook: "You're scaling infra..."
  4. Click "→ EventFold" → button flashes "✓ Sent"

EventFold
  5. Open People / Contacts
  6. Click "Paste from FinalFold"
  7. Contact record created: Sarah Chen, CTO, Acme Corp
     Email: sarah@acmecorp.com (verified), FitScore: 83
     Note: "FinalFold hook: You're scaling infra..."
  8. Toast: "Sarah Chen added to contacts"
```

Total time: ~3 seconds per contact

---

## Edge Cases

| Scenario | Behavior |
|----------|---------|
| No email on contact | Contact created without email; hook + fitScore still stored |
| Contact already exists (same email) | Update-only: add note + update fitScore; do not duplicate |
| Clipboard is not FinalFold JSON | Silently ignored (flag check fails) |
| FitScore is null (no qual checklist) | Omit field; EventFold stores null |
| `hook` is null | No note created |

---

## Future Improvements

- **"Convert to Deal" toggle** — inline option on the EventFold paste to simultaneously create a Deal record linked to the contact (PRD-FF-03)
- **Batch paste** — paste multiple contacts at once from FinalFold's batch export (PRD-FF-02)
- **Payload versioning** — `"version": 1` field enables schema evolution; EventFold checks this before parsing
- **Source run linking** — `sourceRunId` enables EventFold to eventually display "sourced from FinalFold run: [date]"
