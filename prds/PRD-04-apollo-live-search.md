# PRD-04 · Apollo Live Company Search

**Feature:** Real-time Apollo.io company search from within each AI-generated SearchCard
**Status:** Shipped v1
**Owner:** Foxworks Studios

---

## Problem

ProspectFold generates AI-suggested Apollo search configurations (industry, keywords, employee count, technologies) but previously had no way to actually execute them. The user had to manually open Apollo.io, reconstruct the filters from the generated text, and run the search — a multi-step process with transcription errors.

Live search closes that loop: generate → search → see companies → send to EventFold, all without leaving ProspectFold.

---

## Why Electron IPC (Not a Direct Browser Fetch)

Apollo's API (`api.apollo.io`) does not include CORS headers that allow browser-side requests. A direct `fetch()` from the renderer process fails with a CORS error.

**Solution:** Route all Apollo API calls through the Electron main process (Node.js runtime), which is not subject to CORS. The renderer calls `window.electronAPI.searchApolloCompanies(args)` via `contextBridge`/`ipcRenderer`; the main process makes the actual HTTPS request and returns the result.

```
Renderer (React)
  └─ window.electronAPI.searchApolloCompanies({ apiKey, filters })
       └─ ipcRenderer.invoke('apollo:companies', args)
            └─ ipcMain.handle('apollo:companies', ...)
                 └─ Node https.request → api.apollo.io
                      └─ return { companies, total }
```

This pattern is only available in the Electron desktop app. If the user opens ProspectFold in a browser (e.g., during `vite dev` without Electron), clicking "Search Live" shows the error: "Run in the desktop app to use live search."

---

## Apollo API Integration

**Endpoint:** `POST https://api.apollo.io/api/v1/mixed_companies/search`

**Authentication:** API key passed in request body as `api_key` (not as a header)

**Request body construction from generated filters:**

| ProspectFold filter field | Apollo API parameter | Transformation |
|--------------------------|---------------------|----------------|
| `keywords` | `q_organization_keyword_tags` | Split on comma, trim |
| `industry` | `organization_industries` | Split on comma, trim |
| `technologies` | `currently_using_any_of_technology_uids` | Split on comma, trim |
| `employee_count` | `organization_num_employees_ranges` | Range mapping (see below) |
| _(pagination)_ | `page: 1, per_page: 10` | Fixed for v1 |

**Employee count range mapping:**
```js
function mapEmployeeCount(value) {
  if (!value) return undefined;
  const map = {
    "1-10": ["1,10"], "1–10": ["1,10"],
    "11-50": ["11,50"], "11–50": ["11,50"],
    "51-200": ["51,200"], "51–200": ["51,200"],
    "201-500": ["201,500"], "201–500": ["201,500"],
    "500-1000": ["500,1000"], "500–1000": ["500,1000"],
    "1000+": ["1000,10000"],
  };
  return map[value.trim()] ?? [value.replace("–", ",").replace("+", ",10000")];
}
```

**Response shape used:**
```js
{
  companies: [
    {
      name: string,
      website_url: string | null,
      num_employees: number | null,
      industry: string | null,
      linkedin_url: string | null,
    }
  ],
  total: number,
}
```

---

## API Key Management

The Apollo API key is stored separately from the Anthropic key:
- `localStorage` key: `"apollo_key"`
- Input: password field in header, amber styling when set
- Required only for live search — intel generation works without it

The API key is **never stored** in the Electron main process or any persistent file outside localStorage. It is passed per-request from the renderer to main via IPC.

---

## UI

**"Search Live" button** — amber, appears on Apollo SearchCards only

States:
- Default: amber background, "Search Live"
- Loading: disabled, lighter background, "Searching..."
- Error: inline red error message below the card
- Success: live results panel expands below the card

**Results panel:**
```
LIVE RESULTS — 2,847 companies

┌─────────────────────────────────────────────┐
│ Acme Corp                    450 employees  │
│ acmecorp.com                 Technology     │
│ linkedin.com/company/acme                   │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ ...                                         │
└─────────────────────────────────────────────┘
```

Each company card shows: name, website, employee count, industry, LinkedIn URL

---

## Error States

| Condition | Error message |
|-----------|--------------|
| No Apollo key | "Add your Apollo API key first." |
| Not in Electron | "Run in the desktop app to use live search." |
| API returns error | Apollo error message from response body |
| Network failure | "Apollo search failed." |

---

## Limitations in v1

- **10 results per page, no pagination** — sufficient for quick validation; full pagination is a future improvement
- **Company search only** — returns organizations, not contacts. Contact/people search is EventFold's job via the Bridge (PRD-02)
- **No caching** — each click hits the API. Rate limiting is the user's responsibility
- **Technologies filter** — passed as string names; Apollo's API expects technology UIDs for exact matching. String-based matching may have lower precision

---

## Future Improvements

- **Pagination** — "Load more" button, result count display
- **Technology UID resolution** — map technology names to Apollo UIDs for precise tech-stack filtering
- **"Add to EventFold" from result** — button on each company card that pre-fills EventFold's company creation form
- **Result caching** — cache results per filter hash for the session to avoid redundant API calls
- **Sort + filter results** — sort by employee count, filter by industry within results
- **Rate limit display** — show remaining Apollo API quota from response headers
