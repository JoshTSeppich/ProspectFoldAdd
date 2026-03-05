# PRD-01 · NAICS Intel Engine

**Feature:** AI-powered prospect intelligence generation from a NAICS industry code
**Status:** Shipped v1
**Owner:** Foxworks Studios

---

## Problem

Sales people at Foxworks (and at any small high-ticket B2B team) spend hours manually researching a new industry vertical before they can write a single outreach message. The output of that research lives in someone's head or a messy Notion doc, is inconsistently structured, and dies when that person moves on. There's no repeatable, machine-readable artifact you can hand off to Apollo, a CRM, or a copywriter.

---

## What It Does

Given a NAICS code, an optional company size range, and optional free-text context, the engine calls the Anthropic Messages API with a structured system prompt and returns a complete prospect intelligence package as JSON. The output is streamed live to the UI and parsed on completion.

---

## Input Schema

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `naicsCode` | string (6-digit) | Yes | e.g. `"541511"` |
| `naicsLabel` | string | Yes | e.g. `"Custom Software Development"` |
| `sizes` | string[] | No | e.g. `["51–200", "201–500"]` |
| `context` | string | No | Free-text override/focus for the AI |

---

## Output Schema

```json
{
  "summary": "string — 2-sentence ICP description",
  "icp": {
    "company_types": ["string"],
    "company_sizes": ["string"],
    "qualifying_criteria": ["string"],
    "signals": ["string — observable buying trigger"]
  },
  "angles": [
    {
      "name": "string — segment name",
      "hypothesis": "string — why this segment buys",
      "hook": "string — one-line value prop"
    }
  ],
  "searches": {
    "apollo": [
      {
        "label": "string",
        "query": "string — Apollo company search description",
        "filters": {
          "industry": "string",
          "employee_count": "string",
          "keywords": "string",
          "technologies": "string",
          "person_titles": "string — titles to target at these companies",
          "seniority": "string — e.g. 'director, vp, c_suite'"
        }
      }
    ],
    "google": [
      { "label": "string", "query": "string — exact Google search string" }
    ],
    "linkedin": [
      { "label": "string", "query": "string", "url_hint": "string" }
    ]
  },
  "qualification_checklist": [
    { "criterion": "string", "how_to_verify": "string" }
  ],
  "red_flags": ["string"],
  "enrichment_urls": [
    { "label": "string", "url": "string", "why": "string" }
  ]
}
```

---

## AI Model & Prompt Design

**Model:** `claude-sonnet-4-6` via Anthropic Messages API
**Max tokens:** 4096
**Streaming:** Yes — SSE via `ReadableStream`

**System prompt design principles:**
- Scoped to B2B company prospecting for AI engineering services (Foxworks domain)
- Explicitly instructs the model to target **companies**, not individuals
- `person_titles` and `seniority` fields are included in the Apollo filter schema so the output can drive EventFold's people search downstream
- Instructs model to return ONLY valid JSON — no markdown fences, no preamble
- Output is tactical and specific — generic outputs ("technology companies") are penalized implicitly by prompt specificity

**Prompt construction:**
```
Target industry: NAICS {code} — {label}
Company sizes: {sizes}  (omitted if empty)
Additional context: {context}  (omitted if empty)
Build me a full prospecting intelligence package for this target.
```

---

## Streaming UX

- Dark terminal-style display renders accumulated JSON in real time
- Phase label updates as the model writes each section:
  - `"summary"` → "Distilling ICP summary..."
  - `"icp"` → "Mapping company profile..."
  - `"signals"` → "Identifying buying signals..."
  - `"searches"` → "Generating search queries..."
  - `"apollo"` → "Crafting Apollo searches..."
  - `"google"` → "Crafting Google searches..."
  - `"linkedin"` → "Crafting LinkedIn searches..."
  - `"qualification_checklist"` → "Building qualification checklist..."
  - `"red_flags"` → "Flagging disqualifiers..."
  - `"enrichment_urls"` → "Finding enrichment sources..."
- Phase is detected by substring matching on the accumulated JSON string
- On complete, switches to Apollo tab automatically

---

## Error Cases

| Error | Handling |
|-------|----------|
| Empty API key | Block submit, show inline error |
| Bad API key (401) | Show API error message from response |
| No NAICS selected | Disable Generate button |
| Malformed JSON from model | Strip ` ```json ` fences, retry parse |
| Network failure | Show error in red banner below submit |
| Stream interrupted mid-JSON | JSON.parse throws → surface error |

---

## Performance

- Average response time: ~10–15 seconds for full package
- Streaming makes it feel faster — first text appears in ~1–2 seconds
- No caching in v1 — every run hits the API fresh
- History stores last 15 results in localStorage to avoid redundant regeneration

---

## Future Improvements

- **Staleness indicator** — show "Generated 14 days ago" on history entries, prompt to refresh
- **Multi-NAICS comparison** — run two codes side by side, highlight angle overlap
- **Model selection** — allow switching to Opus for higher-fidelity output on key verticals
- **Prompt versioning** — track which system prompt version generated each result; allow reruns with updated prompt
- **Feedback loop** — thumbs up/down on angles; surface winning angles first in future runs for same NAICS
