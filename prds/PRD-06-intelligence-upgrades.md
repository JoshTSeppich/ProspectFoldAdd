# PRD-06 · Intelligence Upgrades — Iterative Improvements

**Feature:** Three-iteration upgrade path to make ProspectFold's intel output materially better
**Status:** NEXT — not yet shipped
**Owner:** Foxworks Studios
**Depends on:** PRD-01 (NAICS Intel Engine)

---

## Problem

The current intel engine makes a single Anthropic API call and reasons entirely from training data. The output is structurally correct but predictably shallow — it generates plausible ICP descriptions rather than grounded market intelligence. A sales person reading the output can tell it's "AI-generated" because it doesn't reference anything real: no company names, no actual trends, no specific signals that require knowing what's happening in the market right now.

The goal of this PRD is to close that gap iteratively — each iteration ships independently and each one is measurably better than the last.

---

## Iteration 1 · Opus + Extended Thinking + Few-Shot Prompt

**Effort:** ~1 hour (no new deps, no structural change)
**Impact:** Highest ROI of the three — the quality difference between Sonnet and Opus with thinking on strategic synthesis tasks is significant and immediately visible in the output

### 1a. Model Upgrade

Change the generation call from `claude-sonnet-4-6` to `claude-opus-4-6`.

Opus is meaningfully better at:
- Synthesizing industry-specific knowledge into non-obvious angles
- Generating qualifying criteria that are actually observable (not vague)
- Writing hooks that sound like a human wrote them, not a template
- Producing search filter combinations that are specific enough to be useful

### 1b. Extended Thinking

Add `thinking: { type: "enabled", budget_tokens: 8000 }` to the API request.

Extended thinking lets the model reason through the problem before committing to the output. For this specific task — "analyze an industry, identify who buys AI services, why, and how to find them" — thinking produces materially better output because the model works through edge cases and non-obvious segments before writing.

**API changes required:**
```js
// Request body
{
  model: "claude-opus-4-6",
  max_tokens: 16000,          // must be > budget_tokens
  thinking: { type: "enabled", budget_tokens: 8000 },
  stream: true,
  system: ANTHROPIC_SYSTEM,
  messages: [...]
  // NOTE: remove temperature if present — not compatible with thinking
}

// Headers
"anthropic-beta": "interleaved-thinking-2025-05-14"
```

**Streaming changes required:**

Extended thinking emits additional SSE event types. The streaming parser needs to:
1. Detect `content_block_start` with `content_block.type === "thinking"` → set phase to "Thinking deeply..."
2. Ignore `content_block_delta` events where `delta.type === "thinking_delta"` (don't accumulate thinking text into the JSON output)
3. Detect `content_block_start` with `content_block.type === "text"` → resume normal phase labels
4. Only accumulate `text_delta` events (existing logic, unchanged)

```js
let inThinkingBlock = false;
// inside the SSE parsing loop:

if (event.type === "content_block_start") {
  if (event.content_block?.type === "thinking") {
    inThinkingBlock = true;
    setPhase("Thinking deeply about this vertical...");
  } else if (event.content_block?.type === "text") {
    inThinkingBlock = false;
  }
}

if (
  event.type === "content_block_delta" &&
  event.delta?.type === "text_delta" &&
  !inThinkingBlock
) {
  accumulated += event.delta.text;
  setStreamText(accumulated);
  setPhase(getPhase(accumulated));
}
```

**UX:** The streaming terminal already handles this correctly (renders accumulated JSON). The user will see "Thinking deeply about this vertical..." for ~10–20 seconds before the JSON starts streaming. This is expected and communicates that something more thorough is happening.

**Cost:** Opus is ~15x more expensive than Sonnet per token. With thinking, a typical run will use ~12,000–18,000 tokens total. Estimated cost per run: ~$0.50–$1.00 vs ~$0.03 for current Sonnet. Acceptable for a power-user internal tool.

---

### 1c. Few-Shot Example in System Prompt

Add one complete, high-quality example to the system prompt showing what exceptional output looks like. This is the most underused prompt engineering technique.

**Why it works:** The model currently has a schema description but no quality signal. "Be specific and tactical" is vague. A concrete example of what specific + tactical looks like dramatically improves consistency and output quality — especially for the fields that tend to be weak: qualifying_criteria specificity, hook sharpness, and signal observability.

**Example to add** (NAICS 522320 — Financial Transaction Processing / Fintech):

```json
{
  "summary": "Series A–C fintech companies ($5M–$80M ARR) that have built payment, lending, or transaction infrastructure and are under pressure to add AI-powered fraud detection, compliance automation, or customer intelligence without expanding their engineering headcount.",
  "icp": {
    "company_types": [
      "Embedded finance API vendors (banking-as-a-service, lending-as-a-service)",
      "Payment middleware companies connecting merchants to acquirers",
      "Expense management SaaS with card issuance (Brex/Ramp-tier)",
      "Neobanks with proprietary transaction ledgers",
      "Lending platforms doing >$50M/yr origination volume"
    ],
    "company_sizes": ["50–300 employees", "Series A–C", "$5M–$80M ARR", "$10M–$100M raised"],
    "qualifying_criteria": [
      "Has posted ML engineer, data scientist, or AI engineer job listings in the last 90 days (LinkedIn/Greenhouse)",
      "Engineering team is >20% of total headcount based on LinkedIn employee data",
      "Processes >$1B/year in transaction volume (detectable from press releases or Crunchbase funding context)",
      "Uses Stripe, Plaid, or Marqeta as infrastructure (visible in job postings or tech stack pages)",
      "Has a dedicated compliance or risk team but no AI/ML tooling listed in job requirements"
    ],
    "signals": [
      "CTO or VP Engineering hired from Stripe, Square, Adyen, or Affirm in last 12 months",
      "Job postings mention 'fraud model', 'transaction scoring', or 'real-time decisioning'",
      "Raised Series B or C in last 18 months — growth pressure to automate ops without hiring",
      "Press coverage of a compliance failure, regulatory fine, or fraud incident in last 24 months",
      "Engineering blog posts about building internal tooling for risk or compliance"
    ]
  },
  "angles": [
    {
      "name": "Fraud Intelligence Automation",
      "hypothesis": "Payment companies are spending 2–5% of revenue on manual fraud review and are one regulatory cycle away from needing real-time ML decisioning. They have the transaction data but not the ML infrastructure to act on it. Foxworks can build the fraud scoring layer in 8–12 weeks without them needing to hire a ML team.",
      "hook": "Your fraud team is reviewing transactions that an AI model could flag in 40ms — we build that model on your data."
    },
    {
      "name": "Compliance Automation for High-Growth Lenders",
      "hypothesis": "Fintech lenders scaling from $50M to $500M origination volume hit a wall where manual compliance review becomes the growth bottleneck. They need AI to auto-classify, flag, and audit loan files but can't afford to hire a 20-person compliance tech team.",
      "hook": "We turn your compliance backlog from a headcount problem into a model — deployed in weeks, not quarters."
    }
  ],
  "searches": {
    "apollo": [
      {
        "label": "Series B Fintech Building Payment Infrastructure",
        "query": "Fintech companies 50-300 employees that process payments or lending, raised Series B, using Stripe or Plaid, actively hiring ML engineers",
        "filters": {
          "industry": "Financial Services, Fintech",
          "employee_count": "50-300",
          "keywords": "payments, embedded finance, transaction processing, lending platform",
          "technologies": "Stripe, Plaid, Marqeta",
          "person_titles": "CTO, VP Engineering, Head of Data, Head of Risk",
          "seniority": "director, vp, c_suite"
        }
      }
    ],
    "google": [
      {
        "label": "Funded Fintech Hiring ML Engineers",
        "query": "site:linkedin.com/jobs \"machine learning engineer\" OR \"fraud model\" fintech payments 2024 2025"
      }
    ],
    "linkedin": [
      {
        "label": "Fintech Companies 51-200 Employees Using Stripe",
        "query": "Company size: 51-200, Industry: Financial Services, Keywords: payments OR lending OR fintech, Technology: Stripe",
        "url_hint": "LinkedIn Sales Navigator company search: industry=Financial Services, headcount=51-200, keywords=payments+lending"
      }
    ]
  },
  "qualification_checklist": [
    { "criterion": "Transaction volume > $500M/year", "how_to_verify": "Check press releases, Crunchbase, or ask directly — 'what's your current TPV?'" },
    { "criterion": "Engineering team > 15 people", "how_to_verify": "LinkedIn headcount filter: company > filter by 'Engineering' department" },
    { "criterion": "No current ML/AI vendor relationship", "how_to_verify": "Job postings — do they mention existing ML tools like DataRobot, H2O, or internal ML platform?" },
    { "criterion": "Raised funding in last 24 months", "how_to_verify": "Crunchbase funding tab" }
  ],
  "red_flags": [
    "Already has a dedicated ML platform team of > 5 engineers (will build in-house)",
    "Enterprise bank or credit union (procurement cycles > 12 months, not a fit)",
    "Pre-product or pre-revenue — no transaction data to model against",
    "Primary market is consumer payments at scale (Stripe, PayPal tier — won't outsource core ML)"
  ],
  "enrichment_urls": [
    { "label": "Crunchbase Fintech Funding", "url": "https://www.crunchbase.com/discover/organizations?facet_ids=category_groups%2Ffinancial-services&funding_total=5000000&last_funding_type=series_b", "why": "Filter by funding stage and amount to find companies at the exact growth stage where AI investment makes sense" },
    { "label": "FinTech Global Company Database", "url": "https://fintech.global/directory/", "why": "Curated directory of fintech companies by subsector — faster than Apollo for initial vertical mapping" }
  ]
}
```

**Where to add it in the prompt:** After the schema definition, before the closing instruction:

```
[schema definition]

## Example of exceptional output quality

Input: NAICS 522320 — Financial Transaction Processing (Fintech)

Output:
[example JSON above]

## Your output must match this quality bar:
- qualifying_criteria must be verifiable from public data (job postings, LinkedIn, press releases) — not assumptions
- signals must be observable without talking to the company — external evidence only
- hooks must be outcome-specific and speak to a business pressure, not a feature
- apollo search filters must be specific enough to return < 500 companies, not thousands

Return ONLY valid JSON. No preamble, no markdown fences.
```

---

## Iteration 2 · Web Search Grounding (NEXT AFTER ITER 1)

**Effort:** ~3 hours (adds a pre-generation API call, new streaming phase)
**Impact:** Takes output from "AI-plausible" to "grounded in what's actually happening"

### What It Does

Before generating the intel package, run a separate Anthropic API call with the `web_search` tool enabled. This call researches the specific vertical with live data, then passes those findings as additional context into the main generation call.

### Two-Phase Flow

```
Phase 1: RESEARCH (new)
  Input:  NAICS code + label
  Model:  claude-opus-4-6 (non-streaming, tool use)
  Tools:  web_search
  Output: structured research summary {
    recent_funding_rounds: [...],   // companies that just raised
    hiring_signals: [...],          // companies hiring AI/ML engineers
    market_trends: [...],           // what's changing in this vertical
    notable_companies: [...]        // specific named companies as ICP anchors
  }

Phase 2: GENERATION (existing, enhanced)
  Input:  NAICS + user filters + research summary from Phase 1
  Model:  claude-opus-4-6 + extended thinking
  Output: full intel package JSON (same schema as today)
```

### Research Prompt (Phase 1)

```
You are researching a B2B sales target vertical for Foxworks Studios, an AI engineering firm.

Research: {naicsCode} — {naicsLabel}

Use web search to find:
1. Companies in this vertical that raised Series A, B, or C funding in the last 18 months (give me company names, amounts, dates)
2. Companies in this vertical currently hiring machine learning engineers, AI engineers, or data scientists (job board evidence)
3. Notable technology shifts, compliance events, or market pressures in this vertical in the last 12 months
4. 3–5 named example companies that represent the ideal buyer profile

Return a JSON object:
{
  "recent_funding": [{ "company": string, "amount": string, "date": string, "stage": string }],
  "hiring_ai": [{ "company": string, "role": string, "evidence": string }],
  "market_pressures": ["string — specific, recent, named"],
  "example_companies": [{ "name": string, "why": string }]
}
```

### Generation Prompt Enhancement (Phase 2)

Append the research output to the user message:

```
Target industry: NAICS {code} — {label}
{sizes}
{context}

Current market research for this vertical:
{researchOutput}

Use this research to ground your intel package in real companies and real trends.
Name specific companies as examples where relevant. Reference actual market pressures you found.
Build me a full prospecting intelligence package.
```

### Streaming UX

Add a new phase before the existing streaming terminal:
```
Phase 1 display: "Researching live market data..."
  → Sub-phases: "Searching recent funding rounds...", "Finding AI hiring signals...", "Identifying market pressures..."
  → Shows a separate, smaller "research" panel with the live search queries being run
  → Collapses when generation starts

Phase 2 display: existing streaming terminal (unchanged)
```

### Cost Estimate

- Phase 1 (research with web search): ~$0.30–0.50 per run (3–5 search calls + summarization)
- Phase 2 (generation): ~$0.50–1.00 (same as Iteration 1)
- Total per run: ~$1.00–1.50

### Edge Cases

| Case | Handling |
|------|----------|
| Web search returns no results for vertical | Skip to generation with a note: "No recent public data found — generating from training knowledge" |
| Research phase errors | Fall back to Phase 2 only (generation without research context) — non-blocking |
| Niche NAICS with little online presence | Research still runs; may return sparse results; generation handles gracefully |

---

## Iteration 3 · Foxworks Deal History as Context (NEXT AFTER ITER 2)

**Effort:** ~4 hours (new data entry UI + localStorage schema + prompt injection)
**Impact:** Takes output from "generic B2B AI" to "Foxworks-specific intelligence" — the most defensible moat

### What It Does

Allows Joshua (or any Foxworks team member) to log won/lost deals with the NAICS code, angle that worked/didn't, company size, and deal size. This history is then injected into the generation prompt to bias the output toward what has actually converted.

### Deal Log Schema

```js
{
  id: string,
  naicsCode: string,
  naicsLabel: string,
  companyName: string,
  companySize: string,          // "50-200"
  dealSize: string,             // "$25k"
  outcome: "won" | "lost",
  winningAngle: string | null,  // the angle name that resonated
  lostReason: string | null,    // why it didn't close
  notes: string,
  timestamp: number,
}
```

### Prompt Injection

When deal history exists for a NAICS code (or adjacent codes), inject it:

```
Foxworks deal history for this vertical:
WON DEALS:
- 85-person custom software dev shop, $22k, angle: "Ops Automation" — "they needed internal tooling automated before they could take on more clients"
- 120-person fintech startup, $45k, angle: "Compliance Automation" — "regulatory pressure was the forcing function"

LOST DEALS:
- 200-person agency, lost: "already committed to in-house AI hire"
- 60-person SaaS company, lost: "budget frozen, 6-month eval cycle"

Use this history to weight your angles toward what has actually converted.
Flag patterns from losses as additional red flags.
```

### UI

A collapsible "Deal History" section below the input panel:
- "+ Log a deal" button → simple form: company name, size, outcome, angle, notes
- Stored in localStorage as `prospect_deal_history`
- History entries tagged to NAICS codes
- When generating, relevant history is automatically injected (same NAICS or same sector)

### Why This Is The Moat

Iterations 1 and 2 make the output better for any user. Iteration 3 makes it better specifically for Foxworks. The longer you use it, the better it gets. No other tool does this — Apollo, Clay, and every other prospecting tool uses generic ICP templates. ProspectFold with deal history feedback becomes a proprietary intelligence asset.

---

## Implementation Order

```
[SHIPPED]  v1   Single Sonnet call, static system prompt
[NEXT]     v1.1 Iter 1: Opus + extended thinking + few-shot prompt
           v1.2 Iter 2: Web search research phase
           v1.3 Iter 3: Deal history context injection
```

Each iteration is independently shippable. Do not combine iterations in a single PR.
