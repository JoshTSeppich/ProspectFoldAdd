# PRD-07 · Intelligence Package → EventFold Company List Pipeline

**Feature:** Full-package export from ProspectFold to EventFold — run all Apollo company searches at once and save results as Company records, tagged by vertical
**Status:** Planned
**Owner:** Foxworks Studios
**Depends on:** PRD-02 (EventFold Bridge), PRD-04 (Apollo Live Search)

---

## Problem

The existing EventFold bridge (PRD-02) transfers **one search's person filters** at a time — industry, titles, seniority. A typical intel package has five Apollo searches, each with different company size and keyword combinations. Running all five requires:

1. Clicking "→ EventFold" on search 1 → switch to EventFold → paste → search people
2. Back to ProspectFold → click "→ EventFold" on search 2 → switch → paste → search people
3. Repeat × 5

That's 10–15 minutes of context-switching per vertical, with no company records created — the research stays ephemeral. EventFold's Apollo Search page also searches **people only** (`mixed_people/search`). There is no company-level search in the CRM at all, so even running a single search produces contacts without any parent Company records to anchor them in the pipeline.

---

## Solution

Replace the per-search, people-only flow with a full-package, company-first flow:

1. **ProspectFold**: new "→ EventFold (Full Package)" button exports the entire intel package — summary, NAICS, and all Apollo search configs — as a v2 clipboard payload.
2. **EventFold**: detects the v2 payload and enters **Intel Mode** — runs all company searches sequentially, deduplicates by domain, shows aggregated results, bulk-saves selected companies tagged with the NAICS vertical.
3. Optional next step within EventFold: "Find Contacts at These Companies" pre-fills the existing people-search form with the saved company domains.

---

## Clipboard Payload v2

ProspectFold writes the following JSON when "→ EventFold (Full Package)" is clicked:

```json
{
  "__prospect_intel_v2": true,
  "naicsCode": "522320",
  "naicsLabel": "Financial Transaction Processing (Fintech)",
  "summary": "Series A–C fintech companies ($5M–$80M ARR) under pressure to add AI-powered fraud detection and compliance automation.",
  "apollo_searches": [
    {
      "label": "Series B Fintech Building Payment Infrastructure",
      "query": "Fintech companies 50-300 employees, raised Series B, using Stripe or Plaid",
      "filters": {
        "industry": "Financial Services, Fintech",
        "employee_count": "51-200",
        "keywords": "payments, embedded finance, transaction processing",
        "technologies": "Stripe, Plaid, Marqeta",
        "person_titles": "CTO, VP Engineering, Head of Data",
        "seniority": "director, vp, c_suite"
      }
    }
  ]
}
```

**Backward compatibility:** The existing v1 payload (`__prospect_intel: true`) continues to work unchanged in EventFold. The v2 flag (`__prospect_intel_v2: true`) is detected separately and activates Intel Mode. The two flows are independent.

**Field mapping — `filters` object:**

| Field | Apollo API parameter | Notes |
|-------|---------------------|-------|
| `industry` | `organization_industries` | Comma-split, same as ProspectFold IPC |
| `employee_count` | `organization_num_employees_ranges` | Range-mapped (e.g. "51-200" → ["51,200"]) |
| `keywords` | `q_organization_keyword_tags` | Comma-split |
| `technologies` | _(not sent to company search)_ | Available for future tech-stack filtering |
| `person_titles` | _(passed to follow-on people search only)_ | Used when user clicks "Find Contacts" |
| `seniority` | _(passed to follow-on people search only)_ | Same |

---

## ProspectFold Implementation

### New button: "→ EventFold (Full Package)"

**Location:** Export controls row at the top of the results panel (alongside the existing "↓ JSON" and "⊞ Copy Markdown" buttons)

**Source data:** `result.searches.apollo` — the full array of AI-generated Apollo search objects

**Behaviour:**
- Builds the v2 payload from `result`, `naicsCode`, `naicsLabel`
- Copies to clipboard via `navigator.clipboard.writeText()`
- Flashes button green for 2 seconds ("✓ Package Copied"), then reverts — same pattern as `CopyButton`
- Only renders when `result` is non-null

```js
const [copiedPackage, setCopiedPackage] = useState(false);

const exportFullPackage = async () => {
  const payload = JSON.stringify({
    __prospect_intel_v2: true,
    naicsCode,
    naicsLabel,
    summary: result.summary,
    apollo_searches: (result.searches?.apollo || []).map(s => ({
      label: s.label,
      query: s.query,
      filters: s.filters || {},
    })),
  });
  await navigator.clipboard.writeText(payload);
  setCopiedPackage(true);
  setTimeout(() => setCopiedPackage(false), 2000);
};
```

**Visual:** Styled like the existing export buttons — white background, border, `T.textSub` text. On success: green border + green text + "✓ Package Copied".

```
[ ↓ JSON ]  [ ⊞ Copy Markdown ]  [ → EventFold (Full Package) ]
```

---

## EventFold Implementation

### New Tauri command: `search_apollo_companies`

Accepts the filter fields from the v2 payload and maps them to Apollo's `mixed_companies/search` endpoint. Mirrors the existing `search_apollo` command architecture.

**Input:**
```ts
{
  industry?: string;       // comma-separated
  employee_count?: string; // single range string e.g. "51-200"
  keywords?: string;       // comma-separated
}
```

**Output:** `ApolloCompanySearchResponse { companies: ApolloCompanyResult[], total: number }`

**New types to add to `apollo.rs`:** `ApolloCompanyFilters`, `ApolloCompanyResult`, `ApolloCompanySearchResponse`, `search_companies()` function posting to `mixed_companies/search`.

**New types to add to `api/types.ts`:** `ApolloCompanyResult`, `ApolloCompanySearchResponse`, `IntelApolloSearch`, `ProspectIntelV2Payload`

**New mutation to add to `api/mutations.ts`:** `useSearchApolloCompanies()`

### Intel Mode in `ApolloSearch.tsx`

When `pasteFromProspect()` detects `__prospect_intel_v2: true`, it:
1. Stores the package in `intelPackage` state
2. Sets `intelMode = true`
3. Hides the filter panel

**Intel Mode replaces the filter panel with an Intel Panel:**

```
┌─────────────────────────────────────────────────────────────┐
│  Intel Package                                          [✕] │
│  522320 — Financial Transaction Processing (Fintech)        │
│  "Series A–C fintech companies under pressure to add AI..." │
│                                                             │
│  5 Apollo searches ready                                    │
│  [ Run Company Searches ▶ ]                                 │
└─────────────────────────────────────────────────────────────┘
```

Clicking "Run Company Searches" executes each search sequentially with a progress bar:

```
Running 3/5: Funded Fintech Hiring ML Engineers...
▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  60%
```

After all searches complete, the panel updates:

```
47 companies found (3 deduplicated)
[ Re-run ]
```

### Company results list

Below the Intel Panel, deduplicated company cards appear:

```
☑ [Select All]                     [ Save 12 as Companies ▶ ]

☑  Stripe Inc.               Fintech · 5,000+ employees
   stripe.com                via "Series B Fintech"

☑  Marqeta                   Payments · 800 employees
   marqeta.com               via "Funded Fintech Hiring ML"

□  Acme Payments             (already in CRM)

☑  Plaid Technologies        Fintech · 700 employees
   plaid.com                 via "Series B Fintech"
```

**Deduplication:** by `primary_domain`. If no domain, fall back to lowercased company name. A company already in EventFold (matched by domain against the existing Companies list) is shown greyed-out with "(already in CRM)" and excluded from the bulk save.

**Bulk save:** "Save N as Companies" creates an EventFold Company record for each selected result with:
- `name` → company name
- `industry` → industry from Apollo result
- `website` → `website_url` from Apollo result
- Tags: `naics:{code}` and `intel:{YYYY-MM-DD}` added via `add_company_tag` after creation

**"Find Contacts" button** (appears after save): pre-fills the standard people-search form with the saved companies' domains and the intel package's `person_titles` / `seniority` values, then exits Intel Mode and shows the normal filter panel — ready to search.

---

## User Flow

```
ProspectFold
  1. Generate intel for NAICS 522320 (Fintech)
  2. Results load — 5 Apollo searches in the Apollo tab
  3. Click "→ EventFold (Full Package)" → button flashes "✓ Package Copied"

EventFold
  4. Navigate to Apollo Search
  5. Click "Paste from Prospect Intel"
  6. Intel Mode activates — Intel Panel appears, filter form hidden
  7. Panel shows: "522320 — Fintech · 5 searches ready"
  8. Click "Run Company Searches"
  9. Progress bar: Running 1/5... 2/5... 3/5... done
  10. "47 companies found" — cards appear with checkboxes
  11. Review, uncheck 8 irrelevant companies
  12. Click "Save 39 as Companies" → success toast
  13. Click "Find Contacts at These Companies"
  14. People-search form pre-fills with domains + titles from intel package
  15. Click Search → leads populate
```

Total time from ProspectFold export to EventFold leads: ~3 minutes

---

## Files Changed

| File | Change |
|------|--------|
| `prospect-crafter.jsx` | Add `copiedPackage` state, `exportFullPackage()`, "→ EventFold (Full Package)" button in export controls row |
| `src/apollo.rs` | Add `ApolloCompanyFilters`, `ApolloCompanyResult`, `ApolloCompanySearchResponse`, `search_companies()` |
| `src/commands.rs` | Add `map_employee_count_range()` helper, `search_apollo_companies` Tauri command; extend apollo import |
| `src/lib.rs` | Register `search_apollo_companies` in `invoke_handler!` after `search_apollo` |
| `src-frontend/src/api/types.ts` | Add `ApolloCompanyResult`, `ApolloCompanySearchResponse`, `IntelApolloSearch`, `ProspectIntelV2Payload` |
| `src-frontend/src/api/mutations.ts` | Add `useSearchApolloCompanies` mutation hook |
| `src-frontend/src/components/apollo/ApolloSearch.tsx` | Add Intel Mode: v2 paste detection, `runIntelSearches()`, Intel Panel JSX, company result cards, `handleSaveCompanies()`, "Find Contacts" trigger |

---

## Acceptance Criteria

- [ ] ProspectFold: "→ EventFold (Full Package)" button appears in the export controls row when a result is loaded
- [ ] ProspectFold: Button is absent when no result is loaded
- [ ] ProspectFold: Clicking it copies valid JSON with `__prospect_intel_v2: true`, `naicsCode`, `naicsLabel`, `summary`, and a populated `apollo_searches` array
- [ ] ProspectFold: Button flashes green "✓ Package Copied" for 2 seconds then reverts
- [ ] EventFold: Pasting a v2 payload via "Paste from Prospect Intel" enters Intel Mode; filter panel hides
- [ ] EventFold: Existing v1 paste (`__prospect_intel: true`) still works — people-search autofill unchanged
- [ ] EventFold: Intel Panel shows NAICS code, label, truncated summary, and search count
- [ ] EventFold: Clicking "Run Company Searches" runs each search in sequence with progress label and bar
- [ ] EventFold: Per-search failure is swallowed — remaining searches continue
- [ ] EventFold: Results are deduplicated by `primary_domain`
- [ ] EventFold: Companies already in the CRM (matched by domain) are shown greyed with "(already in CRM)" and excluded from bulk save
- [ ] EventFold: "Save N as Companies" creates Company records tagged `naics:{code}` and `intel:{date}`
- [ ] EventFold: "Find Contacts at These Companies" pre-fills the people-search form and exits Intel Mode
- [ ] EventFold: No Apollo API key → existing "Go to Settings" gate fires (no new error path needed)

---

## Out of Scope (v1)

- Automatic enrichment of saved companies (use existing company detail flow)
- Apollo pagination within Intel Mode (10 results per company search, matching PRD-04 behaviour)
- Scheduled or recurring intel runs
- Re-opening a saved intel package after the session ends
- Multi-vertical batch processing in one session

---

## Future Improvements

- **Named prospect lists** — save the full run (companies + intel package) as a named list in EventFold for later reference
- **Staleness indicator** — warn when an intel package was generated > 30 days ago before running
- **Technology filter** — pass `technologies` through to a `currently_using_any_of_technology_uids` filter once Apollo UID resolution is implemented (see PRD-04 limitations)
- **Direct "Add to EventFold" on SearchCard company results** — for the case where the user ran a live search inside ProspectFold and wants to save one specific company without exporting the whole package
- **v1 payload upgrade path** — detect v1 payloads and offer "Run as Intel Package" using the single search's filters as a one-search intel run
