# PRD-FF-03 · FinalFold → EventFold Deal Pre-fill

**Feature:** Convert a FinalFold contact directly into a pre-filled EventFold Deal record, including hook, fit score, angle, and company context
**Status:** Planned
**Owner:** Foxworks Studios
**Depends on:** PRD-FF-01 (contact bridge), EventFold Deals module

---

## Problem

PRD-FF-01 moves a contact into EventFold's People/Contacts store. But the goal is not just to store contacts — it's to work them. A contact only matters when there's a Deal attached: a tracked opportunity with a stage, a hook, and a next action.

Currently, converting a contact to a Deal in EventFold requires the user to:
1. Find the contact record
2. Click "New Deal"
3. Manually fill in company, title, stage, and notes
4. Dig back into FinalFold to copy the hook and fit rationale

Deal Pre-fill eliminates all of that. When a FinalFold contact is sent to EventFold with "Convert to Deal" enabled, EventFold creates the Deal record pre-loaded with everything needed to send the first outreach message.

---

## Clipboard Payload Extension

Deal pre-fill extends the PRD-FF-01 contact payload with a `deal` block:

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
    "fitScore": 83,
    "hook": "You're scaling infra at 120 people — we can cut deploy time by 40% before your next funding round.",
    "source": "finalfold",
    "sourceRunId": 1742087412000
  },
  "deal": {
    "createDeal": true,
    "name": "Acme Corp — CTO",
    "stage": "prospect",
    "angle": "Infrastructure Scale",
    "hook": "You're scaling infra at 120 people — we can cut deploy time by 40% before your next funding round.",
    "fitScore": 83,
    "qualChecklist": [
      { "criterion": "Decision-maker / budget authority", "passed": true, "note": "CTO matches target titles" },
      { "criterion": "Company size 50–500 employees", "passed": true, "note": "120 employees" },
      { "criterion": "Has verified email", "passed": true, "note": "verified" },
      { "criterion": "LinkedIn profile found", "passed": true, "note": "LinkedIn found" },
      { "criterion": "US-based company", "passed": null, "note": "Location: San Francisco, CA" }
    ],
    "intelRunId": 1742087412000,
    "naicsCode": null,
    "naicsLabel": null
  }
}
```

**`deal.stage`** is always set to `"prospect"` (the earliest pipeline stage). EventFold handles promotion to later stages.

**`deal.qualChecklist`** serializes `runQualChecks()` output so EventFold can display the fit rationale on the deal card — no re-computation needed.

**`deal.naicsCode` / `deal.naicsLabel`** are null when the intel came from a raw company table input (Table Mode). When the intel pack came from ProspectFold and includes NAICS metadata, these will be populated if FinalFold parses them from the markdown header.

---

## FinalFold Implementation

### UI

**"→ EventFold" button** on each ContactCard gains a split-button affordance:

```
[ → EventFold  ▾ ]
                 ↕
         ┌──────────────────────┐
         │ Contact only         │  (PRD-FF-01)
         │ Contact + Deal  ✓    │  (this PRD)
         └──────────────────────┘
```

Default selection persists in `localStorage['ff_send_mode']` — most users will always want "Contact + Deal".

### Implementation

```jsx
const sendToEventFold = async (contact, withDeal = true) => {
  const checks = runQualChecks(contact, checklist, targetTitles);
  const score  = fitScore(checks);

  const payload = {
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
      fitScore:      score,
      hook:          contact.hook,
      source:        "finalfold",
      sourceRunId:   currentRunId,
    },
  };

  if (withDeal) {
    payload.deal = {
      createDeal:    true,
      name:          `${contact.company} — ${contact.title}`,
      stage:         "prospect",
      angle:         contact.angle || null,
      hook:          contact.hook,
      fitScore:      score,
      qualChecklist: checks,
      intelRunId:    currentRunId,
      naicsCode:     parsedNaicsCode || null,
      naicsLabel:    parsedNaicsLabel || null,
    };
  }

  await navigator.clipboard.writeText(JSON.stringify(payload));
};
```

### Parsing NAICS from Intel Pack Markdown

FinalFold accepts free-form markdown. When the markdown includes a ProspectFold-generated header like:

```markdown
# Prospect Intel: Custom Software Development (541511)
```

FinalFold should extract `naicsCode: "541511"` and `naicsLabel: "Custom Software Development"` using a regex on the first H1 line and pass them into the deal payload. This enables EventFold to group deals by NAICS vertical.

```js
function parseNaicsFromMarkdown(md) {
  const match = md.match(/^#\s+Prospect Intel:\s+(.+?)\s+\((\d{4,6})\)/m);
  if (!match) return { naicsCode: null, naicsLabel: null };
  return { naicsCode: match[2], naicsLabel: match[1] };
}
```

---

## EventFold Implementation

### Changes to EventFold

**File:** `src/components/PeopleSearch.tsx` (or equivalent contacts page), updated `pasteFromFinalFold` callback.

Extend the existing PRD-FF-01 `pasteFromFinalFold` handler:

```ts
const pasteFromFinalFold = useCallback(async () => {
  try {
    const text = await navigator.clipboard.readText();
    const data = JSON.parse(text);
    if (data.__finalfold_contact !== true) return;

    const c = data.contact;
    const d = data.deal;

    // --- Contact upsert (same as PRD-FF-01) ---
    let contactId: string;
    const existing = contacts.find(
      x => c.email && x.email?.toLowerCase() === c.email.toLowerCase()
    );
    if (existing) {
      await updateContact(existing.id, { prospectFitScore: c.fitScore, /* ... */ });
      contactId = existing.id;
    } else {
      const created = await createContact({ /* ... all fields from PRD-FF-01 ... */ });
      contactId = created.id;
    }

    // --- Deal creation ---
    if (d?.createDeal) {
      const existingDeal = deals.find(x =>
        x.contactId === contactId && x.stage === "prospect"
      );

      if (!existingDeal) {
        await createDeal({
          name:             d.name,
          contactId,
          stage:            d.stage,          // "prospect"
          angle:            d.angle,
          hook:             d.hook,
          fitScore:         d.fitScore,
          qualChecklist:    d.qualChecklist,   // serialized JSON, displayed on deal card
          source:           "finalfold",
          sourceRunId:      String(d.intelRunId),
          naicsCode:        d.naicsCode,
          naicsLabel:       d.naicsLabel,
        });
        setDealToast({ type: "created", name: d.name });
      } else {
        // Deal already exists — update hook + score
        await updateDeal(existingDeal.id, {
          hook:          d.hook,
          fitScore:      d.fitScore,
          qualChecklist: d.qualChecklist,
        });
        setDealToast({ type: "updated", name: d.name });
      }
    }

    setTimeout(() => setDealToast(null), TOAST_DURATION_MS);
  } catch { /* ignore */ }
}, [contacts, deals]);
```

### Deal Card in EventFold

The deal record should surface the following FinalFold-sourced data on the deal card:

| Field | Display |
|-------|---------|
| `fitScore` | Score badge: "Fit: 83%" with green/amber/red color band |
| `hook` | Indigo quote block below the deal name |
| `angle` | Small tag below the company name |
| `qualChecklist` | Expandable checklist: ✓ Decision-maker matched · ✓ 120 employees · ✗ Email missing |
| `naicsCode` / `naicsLabel` | Small tag: "541511 · Custom Software Dev" |
| `source` | Footer: "Sourced via FinalFold" with timestamp |

### Deal Pipeline Stage Auto-Assignment

FinalFold always sends `stage: "prospect"`. EventFold can apply a promotion rule:

- `fitScore >= 80` → stage stays `"prospect"` but gets a "High Fit" label
- `fitScore >= 60` → standard prospect
- `fitScore < 60` → `"cold"` stage (or discard prompt)

This rule is configurable in EventFold settings and does not require FinalFold changes.

---

## User Flow

```
FinalFold
  1. Run completes → 14 contacts
  2. ContactCard: "Sarah Chen · CTO · Acme Corp · Fit: 83% · ✓ verified"
  3. Click "→ EventFold ▾" → select "Contact + Deal"
  4. Clipboard written, button flashes "✓ Sent"

EventFold
  5. Open Contacts or Deals page
  6. Click "Paste from FinalFold"
  7. Sarah Chen contact created (or updated)
  8. Deal created: "Acme Corp — CTO"
     Stage: Prospect · Fit: 83%
     Hook: "You're scaling infra at 120 people..."
     Qual: ✓ Decision-maker ✓ 120 employees ✓ Email verified ✓ LinkedIn
  9. Toast: "Deal created — Acme Corp · CTO"
```

---

## Edge Cases

| Scenario | Behavior |
|----------|---------|
| Contact exists, deal does not | Create deal linked to existing contact |
| Contact exists, deal exists (same stage) | Update hook + fitScore on deal; do not duplicate |
| No email on contact | Create contact + deal without email; fitScore reflects missing email |
| `deal.naicsCode` is null (table mode input) | Deal created without NAICS tag |
| `fitScore` is null (no qual checklist) | Score badge hidden; checklist section empty |

---

## Future Improvements

- **One-click sequence enqueue** — when a Deal is created, optionally enqueue the contact into an EventFold outreach sequence using the hook as the opening line
- **NAICS grouping in Deals view** — EventFold groups deal cards by `naicsCode` so all "541511" deals appear together in a vertical-scoped view
- **Hook iteration** — EventFold allows editing the hook in-line on the deal card; the edit propagates back to a "used hook" log
- **Fit score decay** — if a deal sits in "prospect" for 30+ days without activity, the fit score visually decays (grayed out) to signal stale intelligence
