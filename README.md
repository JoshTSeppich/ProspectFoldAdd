# ProspectFold

**B2B prospecting intelligence engine for Foxworks Studios.**

Generates grounded, Foxworks-specific ICP packages for any NAICS vertical — combining live market research, Claude Opus extended thinking, and accumulated deal history to produce output that goes materially beyond generic AI-generated sales copy.

---

## What It Is

ProspectFold is an Electron 33 desktop app (macOS arm64) that takes a NAICS industry code and outputs a structured prospecting intelligence package: ideal customer profile, qualifying criteria, buying signals, sales angles with hooks, Apollo/Google/LinkedIn search configs, qualification checklists, red flags, and enrichment URLs.

The output schema is designed to be immediately actionable — Apollo search filters are wired to a live company search, and a one-click clipboard bridge transfers filter configs directly to the EventFold CRM Apollo Search form.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | Electron | 33.3.1 |
| Renderer | React + Vite | 18.3.1 / 5.4.11 |
| Build bundler | electron-builder | 25.1.8 |
| Intelligence | Anthropic Messages API | claude-opus-4-6 |
| Market research | Anthropic web_search tool | beta: web-search-2025-03-05 |
| Company search | Apollo.io Companies API | v1 |
| Storage | localStorage | — |
| Target platform | macOS arm64 (Apple Silicon) | — |

No TypeScript. No state management library. No router. Single JSX file architecture by design — the app is simple enough that this is a feature, not a debt.

---

## Project Structure

```
ProspectFold/
├── electron/
│   ├── main.cjs          # Electron main process: window, IPC handlers
│   └── preload.cjs       # contextBridge: exposes electronAPI to renderer
├── public/
│   └── logo.png          # Foxworks logo
├── prospect-crafter.jsx  # Entire renderer: all components, state, API calls
├── main.jsx              # React entry point (StrictMode + createRoot)
├── index.html            # Vite HTML template
├── vite.config.js        # base: "./" for Electron file:// compatibility
├── package.json          # Scripts, electron-builder config
├── PRD.md                # Master product spec
├── prds/                 # Individual PRDs per feature (PRD-01 through PRD-06)
│   ├── PRD-01-naics-intel-engine.md
│   ├── PRD-02-eventfold-bridge.md
│   ├── PRD-03-export.md
│   ├── PRD-04-apollo-live-search.md
│   ├── PRD-05-naics-selector-history.md
│   └── PRD-06-intelligence-upgrades.md
├── dist/                 # Vite build output (gitignored)
└── release/              # electron-builder DMG output (gitignored)
```

---

## Development

### Prerequisites

- Node.js 20+
- npm
- macOS (arm64 for native Electron binary)

### Install

```bash
npm install
```

### Run (Vite dev server only — no Electron)

```bash
npm run dev
# → http://localhost:5173
```

This is sufficient for UI development. Apollo live search will fail gracefully ("Run in the desktop app to use live search") because `window.electronAPI` is undefined in a plain browser context. All other features work — Anthropic API calls go direct from the browser renderer via `anthropic-dangerous-direct-browser-access: true`.

### Run (Electron + Vite)

```bash
npm run electron:dev
```

Uses `concurrently` to start Vite dev server, then `wait-on` to block until `http://localhost:5173` is available, then launches Electron. The main process loads `http://localhost:5173` in dev mode.

### Build DMG

```bash
npm run electron:build
```

Runs `vite build` (output: `dist/`) then `electron-builder` (output: `release/`). Target: macOS arm64 DMG. App ID: `dev.foxworks.prospect-crafter`.

In production, Electron loads `file:///path/to/dist/index.html`. Vite's `base: "./"` ensures asset paths are relative for file:// protocol compatibility.

---

## Architecture

### Process Model

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (Chromium)                        │
│                                                     │
│  prospect-crafter.jsx                               │
│  ├─ Anthropic API (direct fetch, CORS-allowed)      │
│  ├─ Apollo API ✗ (blocked by CORS)                  │
│  └─ window.electronAPI.searchApolloCompanies(...)   │
│       └─ ipcRenderer.invoke('apollo:companies')     │
└──────────────────────┬──────────────────────────────┘
                       │ contextBridge IPC
┌──────────────────────▼──────────────────────────────┐
│  Main Process (Node.js)                             │
│                                                     │
│  electron/main.cjs                                  │
│  └─ ipcMain.handle('apollo:companies', ...)         │
│       └─ Node https.request → api.apollo.io         │
│            └─ resolve({ companies, total })         │
└─────────────────────────────────────────────────────┘
```

**Why IPC for Apollo:** Apollo's API (`api.apollo.io`) does not include CORS headers permitting browser-origin requests. Routing through the main process (Node.js `https` module) bypasses CORS entirely. The API key is passed per-request from the renderer via IPC and never stored in the main process.

**Why direct fetch for Anthropic:** Anthropic's API accepts the `anthropic-dangerous-direct-browser-access: true` header, which disables their CORS restriction for trusted client-side use. This avoids needing a backend proxy and keeps the architecture flat.

### contextBridge Surface (`electron/preload.cjs`)

```js
contextBridge.exposeInMainWorld("electronAPI", {
  searchApolloCompanies: (args) => ipcRenderer.invoke("apollo:companies", args),
  openEventFold:         (url)  => ipcRenderer.invoke("shell:openExternal", url),
});
```

`nodeIntegration: false` + `contextIsolation: true` — standard Electron security posture. The renderer never has direct Node access.

---

## Intelligence Pipeline

Every "Generate Intel Package →" click runs a sequential three-phase pipeline before rendering results.

### Phase 1 — Web Search Research (non-streaming)

```
Model:   claude-opus-4-6
Beta:    anthropic-beta: web-search-2025-03-05
Tools:   [{ type: "web_search_20250305", name: "web_search" }]
Input:   NAICS code + label
Output:  JSON { recent_funding, hiring_ai, market_pressures, example_companies }
```

A non-streaming API call with the Anthropic web_search tool. The model performs live web searches for recent funding rounds, AI/ML hiring signals, market pressures, and named anchor companies in the target vertical. The response is parsed from the `text` content blocks. If this call fails for any reason (rate limit, network error, sparse vertical), it fails silently and generation proceeds without research context — never a user-facing error.

### Phase 2 — Deal History Context

Computed client-side from `localStorage["prospect_deal_history"]`. Relevant deals are defined as:
- Same NAICS code, **OR**
- Same sector (sector is resolved by looking up the NAICS code in the `ALL_NAICS` array, which has a `sector` field for each entry)

Won/lost deals are formatted as a structured block and injected into the generation prompt.

### Phase 3 — Intelligence Generation (streaming)

```
Model:   claude-opus-4-6
Beta:    anthropic-beta: interleaved-thinking-2025-05-14
Config:  thinking: { type: "enabled", budget_tokens: 8000 }
         max_tokens: 16000  // must exceed budget_tokens
Stream:  true
```

Extended thinking is enabled. The model reasons privately for ~10–20 seconds before emitting the JSON output. The SSE parser handles thinking blocks:

```js
// Simplified SSE parser logic
if (event.type === "content_block_start") {
  if (event.content_block?.type === "thinking") {
    inThinkingBlock = true;
    setPhase("Thinking deeply about this vertical...");
  } else if (event.content_block?.type === "text") {
    inThinkingBlock = false;
  }
}
if (event.type === "content_block_delta" &&
    event.delta?.type === "text_delta" &&
    !inThinkingBlock) {
  accumulated += event.delta.text;
  // getPhase() watches for JSON keys to update status labels
}
```

The thinking blocks are discarded — only `text_delta` events accumulate into the output JSON.

**Note:** Extended thinking is incompatible with `temperature`. Do not add a `temperature` field to this request body.

### Generation Prompt Structure

```
Target industry: NAICS {code} — {label}
[Company sizes: ...]              // if selected
[Additional context: ...]         // if provided

[Current market research for this vertical:
{researchOutput}
Use this research to ground your intel package...]  // if Phase 1 found data

[Foxworks deal history for this vertical:
WON DEALS: ...
LOST DEALS: ...
Use this history to weight your angles...]          // if relevant deals exist

Build me a full prospecting intelligence package for this target.
```

### System Prompt

`ANTHROPIC_SYSTEM` in `prospect-crafter.jsx` (lines 3–75 approx) defines:
1. The role and task framing
2. The exact output JSON schema with field descriptions
3. A complete few-shot example (NAICS 522320 — Fintech) showing the quality bar for each field
4. Explicit quality rubric: qualifying criteria must be verifiable from public data; signals must be externally observable; hooks must be outcome-specific; Apollo filters must return <500 companies

---

## Output Schema

```ts
{
  summary: string;                       // 2-sentence ICP description
  icp: {
    company_types:        string[];      // specific company archetypes to target
    company_sizes:        string[];      // headcount, funding stage, ARR ranges
    qualifying_criteria:  string[];      // verifiable attributes (job postings, funding, etc.)
    signals:              string[];      // externally observable buying signals
  };
  angles: Array<{
    name:       string;                  // segment name
    hypothesis: string;                  // why they're a fit for Foxworks
    hook:       string;                  // one-line outcome-specific value prop
  }>;
  searches: {
    apollo: Array<{
      label:   string;
      query:   string;
      filters: {
        industry:      string;
        employee_count:string;
        keywords:      string;
        technologies:  string;
        person_titles: string;           // titles to target within companies
        seniority:     string;           // e.g. "director, vp, c_suite"
      };
    }>;
    google:   Array<{ label: string; query: string }>;
    linkedin: Array<{ label: string; query: string; url_hint: string }>;
  };
  qualification_checklist: Array<{
    criterion:    string;
    how_to_verify:string;
  }>;
  red_flags:       string[];
  enrichment_urls: Array<{ label: string; url: string; why: string }>;
}
```

---

## localStorage Schema

All persistence is client-side `localStorage`. No backend, no sync.

| Key | Type | Description |
|---|---|---|
| `anthropic_key` | `string` | Anthropic API key. Loaded on mount, saved on change. |
| `apollo_key` | `string` | Apollo.io API key. Loaded on mount, saved on change. |
| `prospect_history` | `ProspectRun[]` | Last 15 generation runs. Used for one-click restore. |
| `prospect_deal_history` | `DealEntry[]` | All logged won/lost deals. Persists indefinitely. |

### `ProspectRun`

```ts
{
  id:         number;     // Date.now()
  naicsCode:  string;
  naicsLabel: string;
  sizes:      string[];
  context:    string;
  result:     IntelPackage;
  timestamp:  number;
}
```

### `DealEntry`

```ts
{
  id:           string;              // String(Date.now())
  naicsCode:    string;
  naicsLabel:   string;
  companyName:  string;
  companySize:  string;              // "85" (employees, freeform)
  dealSize:     string;              // "$22k" (freeform)
  outcome:      "won" | "lost";
  winningAngle: string | null;
  lostReason:   string | null;
  notes:        string;
  timestamp:    number;
}
```

---

## Apollo API Integration

**Endpoint:** `POST https://api.apollo.io/api/v1/mixed_companies/search`

**Auth:** API key in request body as `api_key` (not Authorization header).

**CORS:** Not allowed from browsers. All requests route through `electron/main.cjs` via IPC.

**Employee count mapping** (in `main.cjs`):

```js
function mapEmployeeCount(str) {
  if (!str) return undefined;
  const s = str.trim();
  if (s.endsWith("+")) return [`${parseInt(s)},10000`];
  const parts = s.split(/[-–]/);           // handles both hyphen and en-dash
  if (parts.length === 2) return [`${parts[0].trim()},${parts[1].trim()}`];
  return undefined;
}
```

Apollo's API expects ranges as `"51,200"` strings in the `organization_num_employees_ranges` array. The AI generates employee count values using both hyphen and en-dash (copied from UI size buttons), so both separators are handled.

**Request body fields used:**

| Apollo field | Source |
|---|---|
| `q_organization_keyword_tags` | `filters.keywords` split on `,` |
| `organization_industries` | `filters.industry` split on `,` |
| `currently_using_any_of_technology_uids` | `filters.technologies` split on `,` |
| `organization_num_employees_ranges` | `filters.employee_count` via `mapEmployeeCount()` |
| `page`, `per_page` | Hardcoded: `1`, `10` |

**Known limitation:** `currently_using_any_of_technology_uids` is intended for Apollo technology UIDs, not string names. The AI generates human-readable names (e.g., "Stripe", "Salesforce"). Apollo's string-based matching may have lower precision than UID-based matching. Resolving names to UIDs is a listed future improvement.

---

## EventFold Bridge

ProspectFold transfers Apollo search filters to EventFold CRM's Apollo Search form via clipboard JSON.

### Clipboard Payload

```json
{
  "__prospect_intel": true,
  "industry":  "Technology, Software",
  "titles":    "CTO, VP Engineering, Head of Product",
  "seniority": "director, vp, c_suite",
  "keywords":  "AI, machine learning, OpenAI"
}
```

The `__prospect_intel: true` flag is a namespace guard — EventFold silently ignores any clipboard content without this flag, preventing accidental form pollution.

### ProspectFold Side

"→ EventFold" button on each Apollo SearchCard writes this payload via `navigator.clipboard.writeText()`. Button state flips to "✓ Copied" for 2 seconds.

### EventFold Side

See `PROSPECT_INTEL_INTEGRATION.md` in the ProspectFoldAdd repo for the exact 5-change implementation guide for `ApolloSearch.tsx`. The integration requires only renderer-side TypeScript changes — no Rust, no Cargo.toml, no tauri.conf.json, no capability files.

Summary of changes to EventFold's `ApolloSearch.tsx`:
1. Add `ClipboardDocumentIcon` to heroicons import
2. Add `autofillToast` state
3. Add `pasteFromProspect` callback (reads clipboard, validates `__prospect_intel` flag, calls `setFilters`)
4. Add "Paste from Prospect Intel" button in the filter header row
5. Add autofill success toast

---

## Export System

### JSON Download

`URL.createObjectURL(Blob)` → programmatic `<a>` click → `URL.revokeObjectURL()`. No Electron file dialog required — browser download API works in the Electron renderer.

**Filename format:** `prospect-{naicsCode}-{YYYY-MM-DD}.json`

**Payload:** Full intel package wrapped in `{ meta: { version, naicsCode, naicsLabel, generated }, ...result }`.

### Markdown Copy

`navigator.clipboard.writeText(markdownString)`. Generates a formatted document covering summary, company types, qualifying criteria, signals, angles, Apollo searches, qualification checklist, and red flags. Intentionally omits Google/LinkedIn searches and enrichment URLs (clutters paste targets).

---

## NAICS Coverage

~300 codes across 22 sectors, defined in the `ALL_NAICS` array in `prospect-crafter.jsx`. Each entry: `{ code: string, label: string, sector: string }`.

8 suggested codes are surfaced at the top of the dropdown (curated for B2B AI/software sales):
- `541511` — Custom Software Development
- `511210` — Software Publishers / SaaS
- `541512` — Computer Systems Design
- `541519` — IT Consulting & Services
- `518210` — Cloud Hosting & Data Processing
- `541611` — Management Consulting
- `522320` — Financial Transaction Processing (Fintech)
- `523110` — Investment Banking & Securities

Dropdown search matches on code, label, and sector. Groups by sector when browsing; groups by sector with match highlighting when searching.

---

## Design System

EventFold-inspired light theme. All tokens in the `T` object (lines ~460–495 of `prospect-crafter.jsx`):

```js
const T = {
  bg: "#f8fafc", surface: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  accent: "#4F46E5", accentHover: "#4338CA",
  accentBg: "#EEF2FF", accentBorder: "#C7D2FE",
  green: "#059669", greenBg: "#ECFDF5", greenBorder: "#A7F3D0",
  amber: "#D97706", amberBg: "#FFFBEB", amberBorder: "#FDE68A",
  red: "#DC2626",   redBg:   "#FEF2F2", redBorder:   "#FECACA",
  violet: "#7C3AED", ...
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  radius: 10, radiusSm: 6,
};
```

All styles are inline (no CSS modules, no Tailwind). This is intentional — the entire UI is in one file and inline styles make it trivially portable.

Font stack: `'DM Sans', 'Inter', 'Segoe UI', sans-serif`. Monospace: `'JetBrains Mono', 'Fira Code', monospace`.

---

## Cost Model

Per generation run (as of v1.3):

| Phase | Model | Tokens (est.) | Cost (est.) |
|---|---|---|---|
| Web search research | claude-opus-4-6 + web_search | ~3,000–5,000 | $0.30–0.50 |
| Intelligence generation | claude-opus-4-6 + thinking | ~12,000–18,000 | $0.50–1.00 |
| **Total** | | | **~$0.80–1.50** |

Previous cost (Sonnet, no thinking): ~$0.03/run. This is a power-user internal tool — the cost is appropriate for the quality delta.

---

## Version History

| Version | What shipped |
|---|---|
| v1.0 | Single Sonnet call, static system prompt, NAICS dropdown, session history, Apollo live search, export (JSON + Markdown), EventFold clipboard bridge |
| v1.1 | Model → `claude-opus-4-6`; extended thinking (`budget_tokens: 8000`); SSE parser updated for thinking blocks; few-shot example added to system prompt |
| v1.2 | Phase 1 web search research (non-streaming, `web_search` tool, non-blocking fallback); research context injected into generation prompt |
| v1.3 | Deal history: `localStorage` persistence, log form (company name/size/deal size/outcome/angle/reason/notes), NAICS + sector-based relevance filtering, prompt injection of won/lost patterns |

---

## Known Limitations

- **Apollo tech filter precision:** `currently_using_any_of_technology_uids` expects UIDs, not names. String-based matching is approximate.
- **Apollo pagination:** 10 results per page, no "load more". Sufficient for validation, not for bulk prospecting.
- **Web search fallback:** If the target vertical has low online presence, Phase 1 may return sparse results. Generation proceeds from training data in that case.
- **macOS only:** `electron-builder` is configured for `darwin arm64` only. Windows/Linux builds require adding targets to `package.json`.
- **Single-window:** No multi-window support. Opening a second window creates a fresh app instance.
- **No auth:** API keys stored in plaintext `localStorage`. Acceptable for a single-user internal tool; not suitable for multi-user deployment.

---

## Roadmap

See `prds/PRD-06-intelligence-upgrades.md` for the full intelligence upgrade roadmap (all three iterations now shipped as v1.1–v1.3).

Remaining backlog (from `PRD.md`):
- Apollo result pagination
- Technology UID resolution for precise Apollo tech-stack filtering
- "Add to EventFold" from Apollo result card (pre-fills EventFold company creation)
- Named packages / pin/favorite in history
- PDF export with Foxworks branding
- Webhook output (POST JSON to configurable URL on generation)
- Deal history: search/filter, export/import
- Staleness warning on cached history entries (>30 days)

---

## Repository

`https://github.com/JoshTSeppich/ProspectFoldAdd`

This repo contains the source additions to an existing ProspectFold installation — not the full app distribution. The `release/` directory (containing the built DMG) is gitignored.

Related: `EventFold.CRM_0.3.2_aarch64.dmg` is the current EventFold CRM build, co-located in the project root for reference.
