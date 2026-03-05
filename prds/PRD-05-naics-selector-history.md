# PRD-05 · NAICS Selector & Session History

**Feature:** Industry selection UI and persistent run history
**Status:** Shipped v1
**Owner:** Foxworks Studios

---

## Overview

Two supporting features that are foundational to ProspectFold's usability as a daily-use tool rather than a one-off generator:

1. **NAICS Selector** — a searchable, grouped dropdown covering 300+ industry codes
2. **Session History** — a persistent log of the last 15 runs, with one-click restore

---

## Part A: NAICS Selector

### Problem

NAICS codes are not intuitive. Telling a user to "enter a NAICS code" is unusable — they'd need to cross-reference a government database. The selector needs to be explorable without prior NAICS knowledge, fast for power users who know the code, and scoped to verticals that are actually relevant for B2B AI/software sales.

### Selector Behavior

**When nothing is selected:**
- Search input with placeholder: "Search by industry, sector, or NAICS code..."
- On focus or typing: dropdown opens
- Search matches on: code number, label text, sector name (case-insensitive)
- Grouped by sector when browsing; grouped by sector with match highlighting when searching

**Dropdown structure (no search query):**
```
SUGGESTED FOR AI / SOFTWARE SALES
541511  Custom Software Development
511210  Software Publishers / SaaS
541512  Computer Systems Design
...

ALL INDUSTRIES — type to search
TECHNOLOGY
511210  Software Publishers / SaaS
518210  Cloud Hosting & Data Processing
...
FINANCE & INSURANCE
522110  Commercial Banking
...
```

**Dropdown structure (with search query "fintech"):**
```
FINANCE & INSURANCE
522320  Financial Transaction Processing (Fintech)
522110  Commercial Banking
...
```

**When a code is selected:**
- Input replaced by a chip showing code (indigo monospace) + label
- "✕ Change" button to clear and re-open search
- Chip style matches EventFold's selected state design language

**Click-outside behavior:** Dropdown closes when focus leaves the dropdown container (tracked via `useRef` + `mousedown` event listener on `document`)

### NAICS Coverage

**~300 codes across 22 sectors:**

| Sector | # Codes |
|--------|---------|
| Technology | 15 |
| Finance & Insurance | 19 |
| Legal | 3 |
| Professional Services | 22 |
| Marketing & Advertising | 8 |
| Healthcare | 25 |
| Real Estate | 9 |
| Construction | 19 |
| Logistics & Transportation | 18 |
| HR & Staffing | 12 |
| Education | 11 |
| Hospitality & Food Service | 13 |
| Manufacturing | 44 |
| Wholesale Trade | 13 |
| E-commerce & Retail | 23 |
| Media & Publishing | 15 |
| Energy & Cleantech | 17 |
| Agriculture | 16 |
| Mining & Resources | 8 |
| Arts & Entertainment | 13 |
| Other Services | 14 |
| Government & Public Sector | 17 |

**Suggested codes** (surfaced at top, curated for B2B AI sales):
- 541511 — Custom Software Development
- 511210 — Software Publishers / SaaS
- 541512 — Computer Systems Design
- 541519 — IT Consulting & Services
- 518210 — Cloud Hosting & Data Processing
- 541611 — Management Consulting
- 522320 — Financial Transaction Processing (Fintech)
- 523110 — Investment Banking & Securities

### Company Size Filter

Multi-select toggle buttons: `1–10`, `11–50`, `51–200`, `201–500`, `500–1000`, `1000+`

- Active state: indigo background + border
- Multiple can be selected simultaneously
- Appended to the AI prompt as: "Company sizes: {sizes} employees"
- Omitted from prompt entirely if nothing selected

---

## Part B: Session History

### Problem

Generating a fresh intel package takes ~15 seconds. If a user runs ProspectFold for Custom Software Development today, they shouldn't have to re-run it tomorrow unless the market has changed. The history log is the v1 answer to this — fast access to recent packages without regeneration.

### Behavior

- **Storage:** `localStorage` key `"prospect_history"`, JSON array
- **Capacity:** Last 15 entries (older entries dropped)
- **Persistence:** Survives app restarts and Electron window refreshes

**Each entry stores:**
```js
{
  id: Date.now(),        // unique ID (timestamp)
  naicsCode: string,
  naicsLabel: string,
  sizes: string[],
  context: string,
  result: object,        // full intel package JSON
  timestamp: number,     // Unix ms
}
```

**Display:**

```
RECENT RUNS
┌────────────────────────────────────────────────────────┐
│ 541511  Custom Software Development    51–200   3h ago  Load → │
│ 523110  Investment Banking             200–500  2d ago  Load → │
│ 721110  Hotels & Motels                         1w ago  Load → │
└────────────────────────────────────────────────────────┘
```

- NAICS code (indigo monospace, fixed width)
- Label (full width, flex-1)
- Selected sizes if any (muted)
- Relative timestamp: "just now", "3m ago", "2h ago", "1d ago"
- "Load →" indicator

**On click:** Restores `naicsCode`, `naicsLabel`, `sizes`, `context`, and `result` to state, switches to Apollo tab, scrolls to top. The user is immediately back in the results view as if they just generated it.

**Hidden when empty** — the history section doesn't render at all on a fresh install.

---

## Future Improvements

- **Named packages** — allow the user to name a run ("Q1 Fintech Campaign") for searchability; currently all entries are anonymous
- **Pin / favorite** — pin important packages so they don't get evicted when the 15-entry cap is reached
- **Search history** — full-text search across all stored packages (searching the summary, angles, etc.)
- **Sync / backup** — export the full history to JSON; import from JSON to restore on a new machine
- **Staleness warning** — show a yellow indicator when a package is > 30 days old, suggesting regeneration
- **Capacity increase** — 15 is arbitrary and localStorage can handle much more; could expand to 100+ or move to IndexedDB for larger payloads
- **Context preview** — show a snippet of the additional context in the history row so users can distinguish two runs for the same NAICS
