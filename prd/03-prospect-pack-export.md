# PRD 03 — Prospect Pack Export
**Status:** Backlog (build after PRD 01 + 02)
**Owner:** Foxworks Studios
**Depends on:** PRD 01

---

## Problem

After ProspectCrafter generates an ICP package, the output lives only in the browser session. There's no way to save, share, or hand off the prospect intel — not to a teammate, not to a CRM note, not to a follow-up session. The work gets lost on close.

---

## Goal

Let users export the full prospect intel package as a structured, shareable artifact so it can be saved, referenced, and handed off.

---

## Export Formats

### Priority 1: JSON
- Raw structured output — useful for piping into other tools or EventFold
- One click, downloads as `prospect-pack-[slug]-[date].json`

### Priority 2: Markdown
- Human-readable summary of the full package
- Good for dropping into Notion, Linear, or a sales playbook
- Renders: summary, ICP table, angles, search queries (as code blocks), email openers, red flags

### Priority 3: Copy to Clipboard (already partially done)
- Individual section copy buttons exist — extend to "Copy All as Markdown"

### Out of scope (this version)
- PDF export
- Google Docs / Notion direct integration
- CRM record creation

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| F1 | "Export" button appears in ProspectCrafter when results are rendered |
| F2 | Dropdown offers: Download JSON, Download Markdown, Copy Markdown |
| F3 | JSON export is the raw parsed API response with a metadata wrapper (target, sector, sizes, generated_at) |
| F4 | Markdown export renders all sections in clean, copy-pasteable format |
| F5 | Filename includes a slug of the target description (first 5 words, kebab-case) and ISO date |
| F6 | Export works entirely client-side — no server required |

---

## JSON Export Schema

```json
{
  "meta": {
    "generated_at": "2026-03-05T14:22:00Z",
    "target": "Head of AI at Series A SaaS companies...",
    "sector": "SaaS / Software",
    "sizes": ["51–200", "201–500"],
    "model": "claude-sonnet-4-6",
    "version": "1.0"
  },
  "intel": {
    /* full ProspectCrafter output */
  }
}
```

---

## Markdown Export Template

```markdown
# Prospect Pack — [target slug]
Generated: [date]

## ICP Summary
[summary]

## Ideal Customer Profile
**Company Types:** ...
**Sizes:** ...
**Target Titles:** ...

## Buying Signals
- signal 1
- signal 2

## Prospecting Angles
### Angle 1: [name]
**Why it works:** [hypothesis]
**Hook:** "[hook]"

## Search Queries
### Apollo
**[label]**
```
[query]
```

### Google
...

### LinkedIn
...

## Cold Email Openers
**Subject:** [subject]
[opening]

## Red Flags
- flag 1

## Where to Find Them
- [label]: [url] — [why]
```

---

## UI Placement

```
[Prospect Intelligence]          [Export ▾]
                                  ├ Download JSON
                                  ├ Download Markdown
                                  └ Copy Markdown
```

Export button sits in the top-right of the results area, same row as the ICP Summary header.

---

## Acceptance Criteria

- [ ] Export button only appears when `result` is non-null
- [ ] JSON download includes `meta` wrapper with correct fields
- [ ] Markdown download renders all sections with no `undefined` or `[object Object]` leakage
- [ ] Filename is correctly slugified and dated
- [ ] Copy Markdown writes to clipboard and shows "✓ COPIED" for 1.8s (consistent with existing CopyButton)
- [ ] Works in both browser and Electron webview context
