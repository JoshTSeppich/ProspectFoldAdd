import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── Themes ───────────────────────────────────────────────────────────────────
const DARK = {
  bg:          "#080c14", surface:     "#0d1521",  card:        "#111d2e",
  cardHover:   "#152237", border:      "#1a2e45",  borderLight: "#1e3a54",
  text:        "#dde8f5", textSub:     "#7a8fa6",  textMuted:   "#3d5266",
  accent:      "#2d7ef7", accentDim:   "#1a4a94",  accentGlow:  "rgba(45,126,247,0.15)",
  green:       "#22c55e", greenDim:    "#14532d",
  amber:       "#f59e0b", amberDim:    "#451a03",
  red:         "#ef4444", redDim:      "#450a0a",
};
const LIGHT = {
  bg:          "#f1f5f9", surface:     "#ffffff",  card:        "#ffffff",
  cardHover:   "#f8fafc", border:      "#e2e8f0",  borderLight: "#cbd5e1",
  text:        "#0f172a", textSub:     "#475569",  textMuted:   "#94a3b8",
  accent:      "#4f46e5", accentDim:   "#e0e7ff",  accentGlow:  "rgba(79,70,229,0.08)",
  green:       "#16a34a", greenDim:    "#dcfce7",
  amber:       "#d97706", amberDim:    "#fef3c7",
  red:         "#dc2626", redDim:      "#fee2e2",
};

const HAIKU      = "claude-haiku-4-5-20251001";
const SONNET     = "claude-sonnet-4-6";
// Apollo API key — loaded from OS keychain at runtime. Never hardcoded.
// Updated by App component whenever keychain value changes.
let _apolloKey = "";

const INTEL_STAGES = [
  { id: "haiku1", label: "Extract Apollo Queries",   model: "Haiku",  icon: "⚡" },
  { id: "haiku2", label: "Extract ICP Targets",      model: "Haiku",  icon: "⚡" },
  { id: "haiku3", label: "Extract Sales Signals",    model: "Haiku",  icon: "⚡" },
  { id: "haiku4", label: "Extract Qual Checklist",   model: "Haiku",  icon: "⚡" },
  { id: "sonnet", label: "Synthesize Strategy",      model: "Sonnet", icon: "✦" },
  { id: "apollo", label: "Search Apollo Contacts",   model: "Apollo", icon: "◎" },
];
const TABLE_STAGES = [
  { id: "parse",  label: "Parse Company Table",      model: "Local",  icon: "⚡" },
  { id: "apollo", label: "Search Apollo Contacts",   model: "Apollo", icon: "◎" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanJson(raw) {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}
function parseJson(raw) {
  try { return JSON.parse(cleanJson(raw)); } catch { /* */ }
  const src = raw.match(/\[[\s\S]*\]/)?.[0] || raw.match(/\{[\s\S]*\}/)?.[0];
  if (src) return JSON.parse(src);
  throw new Error("Could not parse JSON from model response");
}

// ─── Intel → Feature Request bridge ──────────────────────────────────────────
function buildBridgeContext(queryLog, contacts, pipelineLog) {
  const companyName = queryLog[0]?.label || "";
  const firstContact = contacts[0];
  const industry = firstContact?.industry || "";
  const size = firstContact?.companySize ? `${firstContact.companySize.toLocaleString()} employees` : "";
  const stratEntry = pipelineLog.find(e => e.stage === "sonnet" || e.stage === "Sonnet");
  const stratSummary = (stratEntry?.data ? JSON.stringify(stratEntry.data) : "").slice(0, 300);
  const notes = [industry, size, stratSummary].filter(Boolean).join(". ");
  return companyName ? { companyName, notes } : null;
}

// ─── Intel → Outreach bridge ──────────────────────────────────────────────────
function buildOutreachBridge(contacts, markdown) {
  const first = contacts[0];
  if (!first) return null;
  return {
    contactName:  first.name    || "",
    contactTitle: first.title   || "",
    company:      first.company || "",
    contactEmail: first.email   || "",
    intelContext: markdown.slice(0, 4000),
  };
}

// ─── Spam scanner ─────────────────────────────────────────────────────────────
const SPAM_WORDS = [
  "free","guaranteed","winner","urgent","act now","limited time","click here",
  "no obligation","risk free","earn money","you won","congratulations",
  "order now","special promotion","buy now","cash bonus","incredible deal",
];
function scanSpam(text) {
  return SPAM_WORDS.filter(w => new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "i").test(text));
}

function emailScore(c) {
  if (!c.email) return 0;
  if (c.emailStatus === "verified") return 3;
  if (c.emailStatus === "likely to engage") return 2;
  return 1;
}
function seniorityScore(title) {
  const t = (title || "").toLowerCase();
  if (/\b(cto|ceo|coo|cpo|chief)\b/.test(t)) return 5;
  if (/\b(founder|co-founder|cofounder)\b/.test(t)) return 4;
  if (/\bvp\b|vice president/.test(t)) return 3;
  if (/\b(director|head of|provost|dean|chancellor)\b/.test(t)) return 2;
  if (/\b(senior|sr\.|lead|principal|staff|manager)\b/.test(t)) return 1;
  return 0;
}
function pickHook(title, topHooks, primaryHook) {
  if (!topHooks?.length) return primaryHook || null;
  const t = (title || "").toLowerCase();
  for (const h of topHooks) {
    const words = (h.angle || "").toLowerCase().split(/[\s/_\-]+/).filter(w => w.length > 3);
    if (words.some(w => t.includes(w))) return h.hook;
  }
  return primaryHook || topHooks[0]?.hook || null;
}

// ─── Qualification scoring ────────────────────────────────────────────────────
// Runs each criterion from the extracted checklist against available Apollo data.
// Returns array of { criterion, checkable, passed, note }

function runQualChecks(contact, checklist, targetTitles) {
  return checklist.map(item => {
    const c  = item.criterion || "";
    const cl = c.toLowerCase();
    const title = (contact.title || "").toLowerCase();
    const ind   = (contact.industry || "").toLowerCase();
    const co    = (contact.company || "").toLowerCase();
    const size  = contact.companySize || 0;

    // Decision-maker / budget authority check
    if (/decision.maker|budget authority|title|buyer|purchas/i.test(cl)) {
      const matched = targetTitles.some(t => title.includes(t.toLowerCase()));
      return { criterion: c, checkable: true, passed: matched,
        note: matched ? `${contact.title} matches target titles` : `${contact.title} not in target list` };
    }

    // Company size check
    if (/employee|size|headcount|team size/i.test(cl)) {
      if (!size) return { criterion: c, checkable: false, passed: null, note: "Company size unknown" };
      // Extract range from criterion text e.g. "1-50" or "50-200"
      const rangeMatch = c.match(/(\d+)\s*[-–to]+\s*(\d+)/);
      if (rangeMatch) {
        const [, lo, hi] = rangeMatch.map(Number);
        const passed = size >= lo && size <= hi;
        return { criterion: c, checkable: true, passed, note: `${size.toLocaleString()} employees` };
      }
      return { criterion: c, checkable: false, passed: null, note: `${size.toLocaleString()} employees` };
    }

    // Industry/sector check
    if (/industry|sector|vertical|software|saas|fintech|edtech|dev tool/i.test(cl)) {
      const passed = !!ind && ind !== "unknown";
      return { criterion: c, checkable: true, passed,
        note: ind ? contact.industry : "Industry unknown" };
    }

    // Email/reachability check
    if (/email|contact|reachable|accessible/i.test(cl)) {
      return { criterion: c, checkable: true, passed: !!contact.email,
        note: contact.email ? `${contact.emailStatus || "email found"}` : "No email" };
    }

    // LinkedIn check
    if (/linkedin|profile|social/i.test(cl)) {
      return { criterion: c, checkable: true, passed: !!contact.linkedinUrl,
        note: contact.linkedinUrl ? "LinkedIn found" : "No LinkedIn" };
    }

    // Location check
    if (/location|us |united states|country|region/i.test(cl)) {
      const loc = (contact.location || "").toLowerCase();
      const inUS = loc.includes("united states") || loc.includes("us") || loc.includes(", ca") || loc.includes(", ny");
      return { criterion: c, checkable: !!contact.location, passed: inUS || null,
        note: contact.location || "Location unknown" };
    }

    // Non-checkable from Apollo data
    return { criterion: c, checkable: false, passed: null, note: "Requires manual research" };
  });
}

function fitScore(checks) {
  const checkable = checks.filter(x => x.checkable);
  const passed    = checkable.filter(x => x.passed === true);
  return checkable.length ? Math.round((passed.length / checkable.length) * 100) : null;
}

// ─── Apollo search with 3-tier fallback ───────────────────────────────────────
// Tier 1: full filters + seniority
// Tier 2: full filters, no seniority (niche titles don't map to seniority)
// Tier 3: location + size only, no keyword tags (broadest)

async function apolloSearchWithFallback(filters, personTitles, seniorityLevels) {
  const base = { apiKey: _apolloKey, personTitles, page: 1, perPage: 25 };

  // Tier 1
  let res = await invoke("apollo_people_search", { ...base, filters, seniorityLevels });
  if ((res.people || []).length > 0) return { result: res, tier: 1 };

  // Tier 2 — no seniority restriction
  res = await invoke("apollo_people_search", { ...base, filters, seniorityLevels: [] });
  if ((res.people || []).length > 0) return { result: res, tier: 2 };

  // Tier 3 — strip keyword tags, keep only location + employee count
  const sparse = {};
  if (filters.organization_locations) sparse.organization_locations = filters.organization_locations;
  if (filters.organization_num_employees_ranges) sparse.organization_num_employees_ranges = filters.organization_num_employees_ranges;
  res = await invoke("apollo_people_search", { ...base, filters: sparse, seniorityLevels: [] });
  return { result: res, tier: 3 };
}

// ─── Deduplication ────────────────────────────────────────────────────────────
function deduplicateContacts(batches) {
  const byId    = new Map();
  const byEmail = new Map();
  for (const people of batches) {
    for (const c of people) {
      const norm = c.email?.toLowerCase().trim();
      if (norm && byEmail.has(norm) && byEmail.get(norm) !== c.id) continue;
      const existing = byId.get(c.id);
      if (!existing) {
        byId.set(c.id, c);
        if (norm) byEmail.set(norm, c.id);
      } else if (!existing.email && c.email) {
        byId.set(c.id, c);
        if (norm) byEmail.set(norm, c.id);
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ed = emailScore(b) - emailScore(a);
    return ed !== 0 ? ed : seniorityScore(b.title) - seniorityScore(a.title);
  });
}

// ─── Table mode helpers ───────────────────────────────────────────────────────
// Parses a markdown (pipe-separated) or TSV company table into structured rows.
function parseCompanyTable(text) {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/^[|\s:-]+$/.test(line)) continue;                       // separator row
    if (/company|apollo title|decision maker/i.test(line) && rows.length === 0) continue; // header
    let cols;
    if (line.includes("|")) {
      cols = line.split("|").map(c => c.trim()).filter(Boolean);
    } else if (line.includes("\t")) {
      cols = line.split("\t").map(c => c.trim());
    } else continue;
    if (cols.length < 2) continue;
    const [company, decisionMaker = "", apolloTitleRaw = "", emailAngle = ""] = cols;
    if (!company || company.startsWith("-")) continue;
    const apolloTitles = apolloTitleRaw
      ? apolloTitleRaw.split(",").map(t => t.trim()).filter(Boolean)
      : [decisionMaker].filter(Boolean);
    rows.push({ company, decisionMaker, apolloTitles, emailAngle });
  }
  return rows;
}

// Detects whether the input is an intel pack (markdown with ## sections) or a company table.
function detectMode(text) {
  if (text.includes("## Apollo Search Queries")) return "intel";
  const lines = text.split("\n").filter(l => l.trim());
  const pipeLines = lines.filter(l => l.includes("|")).length;
  const tabLines  = lines.filter(l => l.includes("\t")).length;
  if (pipeLines > 1 || tabLines > 1) return "table";
  return "intel";
}

// ─── Contacted status storage (FF-17) ────────────────────────────────────────
const CONTACTED_KEY = "ff_contacted";

function loadContacted() {
  try { return JSON.parse(localStorage.getItem(CONTACTED_KEY) || "{}"); } catch { return {}; }
}
function markContacted(email, company) {
  if (!email) return;
  const data = loadContacted();
  data[email.toLowerCase()] = { contactedAt: Date.now(), company: company || "" };
  localStorage.setItem(CONTACTED_KEY, JSON.stringify(data));
}
function getContactedInfo(email) {
  if (!email) return null;
  const data = loadContacted();
  return data[email.toLowerCase()] || null;
}

// ─── Pipeline storage (FF-19) ─────────────────────────────────────────────────
const PIPELINE_KEY = "ff_pipeline_v1";

function loadPipeline() {
  try { return JSON.parse(localStorage.getItem(PIPELINE_KEY) || "{}"); } catch { return {}; }
}
function savePipeline(data) {
  localStorage.setItem(PIPELINE_KEY, JSON.stringify(data));
}
function upsertPipelineCard(card) {
  const data = loadPipeline();
  data[card.id] = { ...card, lastActivity: Date.now() };
  savePipeline(data);
  return data;
}
function deletePipelineCard(id) {
  const data = loadPipeline();
  delete data[id];
  savePipeline(data);
  return data;
}
function pipelineCardFromContact(contact) {
  const id = `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name:         contact.name    || "",
    email:        (contact.email  || "").toLowerCase(),
    company:      contact.company || "",
    title:        contact.title   || "",
    stage:        "identified",
    notes:        "",
    addedAt:      Date.now(),
    lastActivity: Date.now(),
  };
}

// ─── Sequences storage (FF-20) ────────────────────────────────────────────────
const SEQUENCES_KEY = "ff_sequences_v1";

function loadSequences() {
  try { return JSON.parse(localStorage.getItem(SEQUENCES_KEY) || "{}"); } catch { return {}; }
}
function saveSequences(data) {
  localStorage.setItem(SEQUENCES_KEY, JSON.stringify(data));
}
function upsertSequenceRecord(record) {
  const data = loadSequences();
  data[record.id] = { ...record, lastActivity: Date.now() };
  saveSequences(data);
  return data;
}

// ─── Template storage (FF-21) ─────────────────────────────────────────────────
const TEMPLATES_KEY = "ff_templates_v1";

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "{}"); } catch { return {}; }
}
function saveTemplates(data) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(data));
}
function upsertTemplate(tpl) {
  const data = loadTemplates();
  data[tpl.id] = tpl;
  saveTemplates(data);
}
function deleteTemplate(id) {
  const data = loadTemplates();
  delete data[id];
  saveTemplates(data);
}
function incrementTemplateUse(id) {
  const data = loadTemplates();
  if (data[id]) { data[id].useCount = (data[id].useCount || 0) + 1; saveTemplates(data); }
}

// ─── Saved runs storage ───────────────────────────────────────────────────────
const RUNS_KEY = "ff_saved_runs";
const MAX_RUNS = 10;

function loadSavedRuns() {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"); } catch { return []; }
}
function formatRelativeTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return "just now";
  if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 172800000) return "yesterday";
  return `${Math.floor(d / 86400000)}d ago`;
}
function generateRunName(mode, queries, companies) {
  if (mode === "intel" && queries?.length) return queries[0].label?.slice(0, 45) || "Intel Run";
  if (mode === "table" && companies?.length)
    return companies.length === 1 ? companies[0].company : `${companies[0].company} +${companies.length - 1}`;
  return new Date(Date.now()).toLocaleString("en-US", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ─── Apollo filter sanitizer ──────────────────────────────────────────────────
// Intel packs use freeform field names; Apollo api_search is strict.
// This maps every known non-standard name to a valid Apollo field and
// normalises values to the formats Apollo expects.

// Convert an employee-count range value to Apollo's "lo,hi" format.
function toEmployeeRange(v) {
  const s = String(v).replace(/\s*employees?\s*/gi, "").trim();
  // "1-10" or "1–10" or "1 to 10"
  const dash = s.match(/^([\d,]+)\s*[-–to]+\s*([\d,]+)$/);
  if (dash) return `${dash[1].replace(/,/g, "")},${dash[2].replace(/,/g, "")}`;
  // "50+" → open upper bound (Apollo uses 10000 as a sentinel)
  const plus = s.match(/^([\d,]+)\+$/);
  if (plus) return `${plus[1].replace(/,/g, "")},10000`;
  // Already in Apollo comma format "1,10"
  if (/^\d+,\d+$/.test(s)) return s;
  return null;
}

function sanitizeFilters(f) {
  const out = {};
  const kwParts = []; // accumulate keyword fragments; merged into q_keywords at end

  // Field-name aliases
  const TITLE_FIELDS    = new Set(["person_titles","job_titles","contact_titles","titles","decision_maker"]);
  const EMP_FIELDS      = new Set(["employee_count","company_size","size","headcount","num_employees","employees"]);
  const LOCATION_FIELDS = new Set(["location","locations","company_location","company_locations","headquarters","hq","geo"]);
  const KW_FIELDS       = new Set(["keywords","keyword","technologies","technology","tech","tech_stack",
                                    "tools","software","platforms","products","q_organization_keyword_tags",
                                    "use_cases","use_case"]);
  const IND_FIELDS      = new Set(["industry","industries","sector","vertical","verticals"]);

  for (const [k, v] of Object.entries(f || {})) {
    // ── Skip title fields — handled by personTitles param ────────────
    if (TITLE_FIELDS.has(k)) continue;

    // ── Employee count / size → organization_num_employees_ranges ────
    if (EMP_FIELDS.has(k) || k === "organization_num_employees_ranges") {
      const arr    = Array.isArray(v) ? v : [v];
      const ranges = arr.map(toEmployeeRange).filter(Boolean);
      if (ranges.length) {
        out.organization_num_employees_ranges = [
          ...(out.organization_num_employees_ranges || []),
          ...ranges,
        ];
      }
      continue;
    }

    // ── Location → organization_locations ────────────────────────────
    if (LOCATION_FIELDS.has(k)) {
      const arr = Array.isArray(v) ? v : (typeof v === "string" ? [v] : []);
      if (arr.length) {
        out.organization_locations = [
          ...(out.organization_locations || []),
          ...arr.filter(x => typeof x === "string" && x.trim()),
        ];
      }
      continue;
    }

    // ── Industry → q_keywords (no reliable tag-ID mapping available) ─
    // If values happen to be numeric we try organization_industry_tag_ids too.
    if (IND_FIELDS.has(k) || k === "organization_industry_tag_ids") {
      const arr    = Array.isArray(v) ? v : (typeof v === "string" ? [v] : []);
      const strs   = arr.filter(x => typeof x === "string" && isNaN(Number(x.trim())));
      const numIds = arr.filter(x => !isNaN(Number(String(x).trim())));
      if (strs.length)   kwParts.push(...strs);
      if (numIds.length) out.organization_industry_tag_ids = [
        ...(out.organization_industry_tag_ids || []),
        ...numIds.map(Number),
      ];
      continue;
    }

    // ── Keyword / tech / tool fields → q_keywords ────────────────────
    if (KW_FIELDS.has(k)) {
      const arr = Array.isArray(v) ? v : (typeof v === "string" ? [v] : []);
      kwParts.push(...arr.filter(x => typeof x === "string" && x.trim()));
      continue;
    }

    // ── Pass through all other valid Apollo fields unchanged ──────────
    out[k] = v;
  }

  // Merge keyword parts with any existing q_keywords value
  if (kwParts.length) {
    out.q_keywords = [out.q_keywords, ...kwParts].filter(Boolean).join(" ");
  }

  return out;
}

// ─── Section extractor ────────────────────────────────────────────────────────
// Splits the markdown at every ## heading, then finds the section(s) matching
// the requested headings. Returns them joined, or the first 5 000 chars as fallback.
// NOTE: the old regex approach broke because $ with the m flag matches end of
// every line, truncating section content to a single line.
function extractSection(md, ...headings) {
  // Split at positions where a ## heading begins at the start of a line.
  // The lookahead preserves the ## in each resulting chunk.
  const sections = md.split(/^(?=##\s)/m).filter(s => s.trim());
  const parts = [];
  for (const h of headings) {
    const lower = h.toLowerCase();
    const found = sections.find(s =>
      s.split("\n")[0].toLowerCase().includes(lower)
    );
    if (found) parts.push(found.trim());
  }
  return parts.length ? parts.join("\n\n") : md.slice(0, 5000);
}

// mapContact handles both api_search (preview) and bulk_match (full) response shapes.
// bulk_match returns: name, last_name, email, email_status, linkedin_url, photo_url, city/state/country, organization.estimated_num_employees etc.
// api_search returns: first_name, last_name_obfuscated, has_email, organization.name (no employee count, no location)
function mapContact(p, hookFn) {
  const org  = p.organization || {};
  const name = p.name
    || [p.first_name, p.last_name].filter(Boolean).join(" ")
    || p.first_name || "";
  return {
    id: p.id,
    name,
    title:         p.title || "",
    company:       org.name || p.employment_history?.[0]?.organization_name || "",
    companyDomain: org.primary_domain,
    companySize:   org.estimated_num_employees,
    industry:      org.industry,
    location:      [p.city, p.state, p.country].filter(Boolean).join(", ") || undefined,
    email:         p.email     || undefined,
    emailStatus:   p.email_status || undefined,
    linkedinUrl:   p.linkedin_url || undefined,
    photoUrl:      p.photo_url    || undefined,
    hook: hookFn ? hookFn(p.title || "") : undefined,
  };
}

// Step 2 of the Apollo pipeline: bulk_match preview objects to reveal full data + emails.
// Apollo's bulk_match is an enrichment endpoint — it matches by linkedin_url, email,
// or name+domain. Sending just an internal ID causes 400s, so we pass all available
// signals from the api_search preview to give Apollo the best chance to match.
// Returns { enrichMap, meta } — always succeeds so callers can log what happened.
async function apolloEnrich(previews) {
  const empty = { enrichMap: new Map(), meta: { sent: 0, received: 0, withEmail: 0, error: null } };
  if (!previews.length) return empty;
  try {
    // Build detail objects with every signal api_search gave us
    const details = previews.map(p => {
      const org = p.organization || {};
      const d = {};
      if (p.id)                  d.id               = p.id;
      if (p.first_name)          d.first_name        = p.first_name;
      if (org.name)              d.organization_name = org.name;
      if (org.primary_domain)    d.domain            = org.primary_domain;
      if (p.linkedin_url)        d.linkedin_url      = p.linkedin_url;
      return d;
    });
    const res = await invoke("apollo_bulk_match", { apiKey: _apolloKey, details });
    const matches = res.matches || [];
    const withEmail = matches.filter(m => m.email).length;
    return {
      enrichMap: new Map(matches.map(m => [m.id, m])),
      meta: { sent: previews.length, received: matches.length, withEmail, error: null },
    };
  } catch (e) {
    return { enrichMap: new Map(), meta: { sent: previews.length, received: 0, withEmail: 0, error: String(e) } };
  }
}

// Combined search + enrich: runs tiered people/search then optionally bulk_match.
// people/search returns full data (emails, linkedin_url, etc.) directly.
// bulk_match is attempted only for contacts that didn't get an email from search.
// Returns { people, total, tier, searchMeta, enrichMeta } — callers use meta for logging.
async function apolloSearchAndEnrich(filters, personTitles, seniorityLevels, hookFn) {
  // Sanitize filter fields — no contact_email_status restriction so we maximise results
  const f = sanitizeFilters(filters);
  const { result, tier } = await apolloSearchWithFallback(f, personTitles, seniorityLevels);
  const previews = result.people || [];
  const total    = result.total_entries ?? result.pagination?.total_entries ?? previews.length;

  // Count how many already have emails straight from people/search
  const alreadyWithEmail = previews.filter(p => p.email).length;

  // Only run bulk_match for previews that are missing emails (saves API calls)
  const needsEnrich = previews.filter(p => !p.email);
  const { enrichMap, meta: enrichMeta } = await apolloEnrich(needsEnrich);

  const people = previews.map(p => mapContact(enrichMap.get(p.id) || p, hookFn));
  return {
    people, total, tier,
    searchMeta: { tier, previews: previews.length, total, alreadyWithEmail, filtersUsed: f },
    enrichMeta,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineStep({ stage, status, detail, c }) {
  const isActive = status === "active", isDone = status === "done", isError = status === "error";
  const dotColor = isActive ? c.accent : isDone ? c.green : isError ? c.red : c.textMuted;
  const mc = ({
    Haiku:  { d: ["#1a2a3a","#5b9bd5"], l: ["#e0f2fe","#0369a1"] },
    Sonnet: { d: ["#1a1a3a","#818cf8"], l: ["#ede9fe","#6d28d9"] },
    Apollo: { d: ["#1a3a2a","#4ade80"], l: ["#dcfce7","#15803d"] },
    Local:  { d: ["#1a1f2a","#94a3b8"], l: ["#f1f5f9","#64748b"] },
  }[stage.model] ?? { d: ["#1a2a3a","#5b9bd5"], l: ["#e0f2fe","#0369a1"] })[c === DARK ? "d" : "l"];

  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 14px", borderRadius:8, background: isActive ? c.accentGlow : "transparent", border:`1px solid ${isActive ? c.accentDim : "transparent"}`, transition:"all 0.2s" }}>
      <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, background: isDone ? c.green : isError ? c.red : "transparent", border:`2px solid ${dotColor}`, display:"flex", alignItems:"center", justifyContent:"center", animation: isActive ? "spin 1s linear infinite" : "none", fontSize:10, color:(isDone||isError) ? "#fff" : "transparent" }}>
        {isDone ? "✓" : isError ? "✕" : ""}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, color: isActive ? c.text : isDone ? c.textSub : c.textMuted, fontWeight: isActive ? 600 : 400 }}>{stage.icon} {stage.label}</span>
          <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4, background:mc[0], color:mc[1], fontWeight:700, letterSpacing:"0.05em" }}>{stage.model}</span>
        </div>
        {detail && <div style={{ fontSize:11, color:c.textMuted, marginTop:2 }}>{detail}</div>}
      </div>
    </div>
  );
}

function CopyButton({ text, c }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}
      style={{ flexShrink:0, padding:"3px 10px", borderRadius:6, border:`1px solid ${copied ? c.green : c.border}`, background: copied ? c.greenDim : "transparent", color: copied ? c.green : c.textSub, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function EmailBadge({ status, c }) {
  const [color, label] = status === "verified"         ? [c.green, "verified"]
                       : status === "likely to engage" ? [c.accent, "likely"]
                       : [c.amber, "guessed"];
  return <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4, border:`1px solid ${color}44`, background:`${color}18`, color, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", flexShrink:0 }}>{label}</span>;
}

function QualChecklist({ checks, score, c }) {
  const [open, setOpen] = useState(false);
  if (!checks?.length) return null;

  const scoreColor = score === null ? c.textMuted : score >= 75 ? c.green : score >= 50 ? c.amber : c.red;
  const checkable  = checks.filter(x => x.checkable);
  const passCount  = checkable.filter(x => x.passed === true).length;

  return (
    <div style={{ marginTop:10, borderTop:`1px solid ${c.border}`, paddingTop:10 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:8, width:"100%" }}>
        <span style={{ fontSize:11, fontWeight:700, color:scoreColor }}>
          {score !== null ? `${score}% fit` : "Qual checks"}
        </span>
        <span style={{ fontSize:11, color:c.textMuted }}>{passCount}/{checkable.length} checkable criteria</span>
        <span style={{ marginLeft:"auto", fontSize:10, color:c.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
          {checks.map((ch, i) => (
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:6 }}>
              <span style={{ fontSize:12, flexShrink:0, color: ch.passed === true ? c.green : ch.passed === false ? c.red : c.textMuted, marginTop:1 }}>
                {ch.passed === true ? "✓" : ch.passed === false ? "✕" : "○"}
              </span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, color: ch.checkable ? c.text : c.textMuted, lineHeight:1.3 }}>{ch.criterion}</div>
                <div style={{ fontSize:10, color:c.textMuted, marginTop:1 }}>{ch.note}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Send Preview Modal (FF-18) ───────────────────────────────────────────────
function SendPreviewModal({ to, subject, body, onConfirm, onCancel, c }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:14, padding:28, maxWidth:520, width:"90%", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
        <div style={{ fontSize:15, fontWeight:700, color:c.text, marginBottom:18 }}>Preview Before Sending</div>
        <div style={{ display:"flex", flexDirection:"column", gap:12, flex:1, overflow:"auto", marginBottom:22 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>To</div>
            <div style={{ fontSize:13, color: to ? c.text : c.textMuted, fontFamily:"monospace", padding:"8px 10px", background:c.bg, borderRadius:6, border:`1px solid ${c.border}` }}>
              {to || "(no recipient — add contact email)"}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>Subject</div>
            <div style={{ fontSize:13, color:c.text, padding:"8px 10px", background:c.bg, borderRadius:6, border:`1px solid ${c.border}` }}>
              {subject || "(no subject)"}
            </div>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:4 }}>Body</div>
            <pre style={{ fontSize:12, color:c.text, fontFamily:"inherit", whiteSpace:"pre-wrap", wordBreak:"break-word", background:c.bg, padding:"12px 14px", borderRadius:6, border:`1px solid ${c.border}`, maxHeight:220, overflow:"auto", margin:0 }}>
              {body}
            </pre>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onCancel}
            style={{ padding:"9px 20px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:13, cursor:"pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!to}
            style={{ padding:"9px 20px", borderRadius:8, border:"none", background: to ? c.accent : c.border, color:"#fff", fontSize:13, fontWeight:700, cursor: to ? "pointer" : "not-allowed" }}>
            Send Email
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactCard({ contact, checklist, targetTitles, onDraftOutreach, onAddToPipeline, c }) {
  const initials = (contact.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const checks   = checklist?.length ? runQualChecks(contact, checklist, targetTitles) : [];
  const score    = fitScore(checks);
  const contactedInfo = getContactedInfo(contact.email);

  return (
    <div style={{ background:c.card, border:`1px solid ${c.border}`, borderRadius:12, padding:18, transition:"border-color 0.15s,background 0.15s", boxShadow: c === LIGHT ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = c.borderLight; e.currentTarget.style.background = c.cardHover; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = c.border;      e.currentTarget.style.background = c.card; }}>

      {/* Header */}
      <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
        {contact.photoUrl
          ? <img src={contact.photoUrl} alt={contact.name} style={{ width:40, height:40, borderRadius:"50%", objectFit:"cover", flexShrink:0 }} />
          : <div style={{ width:40, height:40, borderRadius:"50%", flexShrink:0, background:c.accentDim, color:c.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700 }}>{initials}</div>
        }
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14, fontWeight:700, color:c.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{contact.name}</span>
            {contact.linkedinUrl && (
              <a href="#" onClick={e => { e.preventDefault(); invoke("open_url", { url: contact.linkedinUrl }); }}
                style={{ color:"#0a66c2", flexShrink:0, lineHeight:1 }}>
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
              </a>
            )}
            {contactedInfo && (
              <span style={{ fontSize:10, padding:"2px 7px", borderRadius:10, background:`${c.green}1a`, color:c.green, fontWeight:600, flexShrink:0, border:`1px solid ${c.green}33` }}>
                ✓ Contacted {formatRelativeTime(contactedInfo.contactedAt)}
              </span>
            )}
            {score !== null && (
              <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, color: score >= 75 ? c.green : score >= 50 ? c.amber : c.red, flexShrink:0 }}>
                {score}%
              </span>
            )}
          </div>
          <div style={{ fontSize:12, color:c.textSub, marginTop:2 }}>{contact.title}</div>
        </div>
      </div>

      {/* Company */}
      <div style={{ marginTop:12, padding:"8px 10px", background:c.bg, borderRadius:8, border:`1px solid ${c.border}` }}>
        <div style={{ fontSize:13, fontWeight:600, color:c.text }}>{contact.company}</div>
        <div style={{ fontSize:11, color:c.textMuted, marginTop:3, display:"flex", gap:8, flexWrap:"wrap" }}>
          {contact.companySize && <span>{contact.companySize.toLocaleString()} emp.</span>}
          {contact.industry    && <span>· {contact.industry}</span>}
          {contact.location    && <span>· {contact.location}</span>}
        </div>
      </div>

      {/* Email */}
      <div style={{ marginTop:12, borderTop:`1px solid ${c.border}`, paddingTop:12 }}>
        {contact.email ? (
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {contact.emailStatus && <EmailBadge status={contact.emailStatus} c={c} />}
            <span style={{ fontSize:12, fontFamily:"monospace", color:c.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{contact.email}</span>
            <CopyButton text={contact.email} c={c} />
          </div>
        ) : (
          <span style={{ fontSize:12, color:c.textMuted, fontStyle:"italic" }}>Email not available</span>
        )}
      </div>

      {/* Actions row */}
      {(onDraftOutreach || onAddToPipeline) && (
        <div style={{ marginTop:10, display:"flex", gap:6, justifyContent:"flex-end" }}>
          {onAddToPipeline && (
            <button
              onClick={() => onAddToPipeline(contact)}
              style={{ padding:"4px 12px", borderRadius:6, border:`1px solid ${c.accent}44`, background:`${c.accent}11`, color:c.accent, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = `${c.accent}22`; e.currentTarget.style.borderColor = c.accent; }}
              onMouseLeave={e => { e.currentTarget.style.background = `${c.accent}11`; e.currentTarget.style.borderColor = `${c.accent}44`; }}>
              + Pipeline
            </button>
          )}
          {onDraftOutreach && (
            <button
              onClick={() => onDraftOutreach(contact)}
              style={{ padding:"4px 12px", borderRadius:6, border:`1px solid ${c.green}44`, background:`${c.green}11`, color:c.green, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = `${c.green}22`; e.currentTarget.style.borderColor = c.green; }}
              onMouseLeave={e => { e.currentTarget.style.background = `${c.green}11`; e.currentTarget.style.borderColor = `${c.green}44`; }}>
              Draft Outreach →
            </button>
          )}
        </div>
      )}

      {/* Hook */}
      {contact.hook && (
        <div style={{ marginTop:10, fontSize:11, color:c.textSub, fontStyle:"italic", borderLeft:`2px solid ${c.accentDim}`, paddingLeft:8 }}>
          {contact.hook}
        </div>
      )}

      {/* Qualification checklist */}
      <QualChecklist checks={checks} score={score} c={c} />
    </div>
  );
}

// ─── Pipeline Log Panel ────────────────────────────────────────────────────────
function PipelineLogPanel({ logs, c }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  if (!logs.length) return null;

  const dark = c.bg === DARK.bg;
  const stagePalette = (stage) => {
    if (stage.startsWith("Haiku"))  return { bg: dark ? "#1a2a3a" : "#e0f2fe", fg: dark ? "#5b9bd5" : "#0369a1" };
    if (stage.startsWith("Sonnet")) return { bg: dark ? "#1a1a3a" : "#ede9fe", fg: dark ? "#818cf8" : "#6d28d9" };
    if (stage.startsWith("Apollo")) return { bg: dark ? "#1a3a2a" : "#dcfce7", fg: dark ? "#4ade80" : "#15803d" };
    return { bg: dark ? "#1a1f2a" : "#f1f5f9", fg: dark ? "#94a3b8" : "#64748b" };
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${c.border}`, paddingTop: 10 }}>
      <button onClick={() => setCollapsed(v => !v)}
        style={{ width: "100%", background: "none", border: "none", padding: "0 0 6px 0", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Pipeline Log ({logs.length})
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: c.textMuted }}>{collapsed ? "▶" : "▼"}</span>
      </button>

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {logs.map((entry, i) => {
            const { bg, fg } = stagePalette(entry.stage);
            const isOpen = openIdx === i;
            return (
              <div key={i} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${c.border}` }}>
                <button onClick={() => setOpenIdx(isOpen ? null : i)}
                  style={{ width: "100%", padding: "7px 8px", background: isOpen ? c.accentGlow : c.surface, border: "none", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 7 }}>
                  <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 4, background: bg, color: fg, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                    {entry.stage}
                  </span>
                  <span style={{ fontSize: 11, color: c.textSub, flex: 1, lineHeight: 1.4, wordBreak: "break-word" }}>{entry.label}</span>
                  <span style={{ fontSize: 10, color: c.textMuted, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "8px 10px", background: c.bg, borderTop: `1px solid ${c.border}`, maxHeight: 220, overflow: "auto" }}>
                    <pre style={{ fontSize: 10, color: c.textSub, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", lineHeight: 1.5 }}>
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Saved Runs Panel ─────────────────────────────────────────────────────────
function SavedRunsPanel({ runs, currentRunId, onLoad, onDelete, c }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId,  setCopiedId]  = useState(null);
  if (!runs.length) return null;
  const dark = c.bg === DARK.bg;

  const exportRun = (e, run) => {
    e.stopPropagation();
    const payload = {
      meta: {
        id: run.id,
        name: run.name,
        mode: run.mode,
        timestamp: new Date(run.timestamp).toISOString(),
        contactCount: run.contactCount,
        emailCount: run.emailCount,
      },
      pipelineLog: run.pipelineLog || [],
      queryLog:    run.queryLog    || [],
      contactSample: (run.contacts || []).slice(0, 10),
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setCopiedId(run.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${c.border}`, paddingTop: 10 }}>
      <button onClick={() => setCollapsed(v => !v)}
        style={{ width:"100%", background:"none", border:"none", padding:"0 0 6px 0", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase" }}>
          Saved Runs ({runs.length})
        </span>
        <span style={{ marginLeft:"auto", fontSize:10, color:c.textMuted }}>{collapsed ? "▶" : "▼"}</span>
      </button>

      {!collapsed && (
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          {runs.map(run => {
            const isActive  = run.id === currentRunId;
            const isCopied  = run.id === copiedId;
            const modeBg    = run.mode === "table" ? (dark ? "#1a1f2a" : "#f1f5f9") : (dark ? "#1a2a3a" : "#e0f2fe");
            const modeFg    = run.mode === "table" ? (dark ? "#94a3b8" : "#64748b") : (dark ? "#5b9bd5" : "#0369a1");
            return (
              <div key={run.id} style={{ borderRadius:8, border:`1px solid ${isActive ? c.accent + "66" : c.border}`, background: isActive ? c.accentGlow : c.bg, overflow:"hidden" }}>
                <button onClick={() => onLoad(run)}
                  style={{ width:"100%", padding:"8px 10px", background:"none", border:"none", textAlign:"left", cursor:"pointer", display:"flex", flexDirection:"column", gap:4 }}>
                  {/* Row 1: name + age + export + delete */}
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ fontSize:11, fontWeight:600, color: isActive ? c.accent : c.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {isActive && "◉ "}{run.name}
                    </span>
                    <span style={{ fontSize:10, color:c.textMuted, flexShrink:0 }}>{formatRelativeTime(run.timestamp)}</span>
                    {/* Export/copy diagnostic JSON */}
                    <button
                      onClick={e => exportRun(e, run)}
                      title="Copy diagnostic JSON to clipboard"
                      style={{ background: isCopied ? c.greenDim : "none", border:`1px solid ${isCopied ? c.green : "transparent"}`, borderRadius:4, padding:"1px 5px", color: isCopied ? c.green : c.textMuted, fontSize:10, cursor:"pointer", lineHeight:1.4, flexShrink:0, fontWeight:600, transition:"all 0.15s" }}
                      onMouseEnter={e => { if (!isCopied) { e.currentTarget.style.color = c.accent; e.currentTarget.style.borderColor = c.accentDim; } }}
                      onMouseLeave={e => { if (!isCopied) { e.currentTarget.style.color = c.textMuted; e.currentTarget.style.borderColor = "transparent"; } }}>
                      {isCopied ? "✓" : "⎘"}
                    </button>
                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); onDelete(run.id); }}
                      title="Delete run"
                      style={{ background:"none", border:"none", padding:"0 2px", color:c.textMuted, fontSize:14, cursor:"pointer", lineHeight:1, flexShrink:0 }}
                      onMouseEnter={e => e.currentTarget.style.color = c.red}
                      onMouseLeave={e => e.currentTarget.style.color = c.textMuted}>
                      ×
                    </button>
                  </div>
                  {/* Row 2: mode badge + stats */}
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:modeBg, color:modeFg, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.04em", flexShrink:0 }}>
                      {run.mode}
                    </span>
                    <span style={{ fontSize:10, color:c.textMuted }}>{run.contactCount} contacts</span>
                    {run.emailCount > 0 && <span style={{ fontSize:10, color:c.green }}>· {run.emailCount} emails</span>}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsModal({ apiKey, apolloKeyProp, onSave, onClose, onGmailConnected, c }) {
  const [anthropicVal, setAnthropicVal] = useState(apiKey);
  const [ghPatVal,     setGhPatVal]     = useState("");
  const [ghPatExists,  setGhPatExists]  = useState(false);
  const [apolloVal,    setApolloVal]    = useState("");
  const [apolloExists, setApolloExists] = useState(!!apolloKeyProp);
  const [saved,        setSaved]        = useState(false);
  const [verifyStatus, setVerifyStatus] = useState({});
  // Gmail OAuth state
  const [gmailEmail,       setGmailEmail]       = useState(null);   // connected email
  const [gmailClientId,    setGmailClientId]    = useState("");
  const [gmailClientSecret,setGmailClientSecret]= useState("");
  const [gmailConnecting,  setGmailConnecting]  = useState(false);
  const [gmailError,       setGmailError]       = useState(null);

  const verify = async (type) => {
    setVerifyStatus(s => ({ ...s, [type]: "loading" }));
    try {
      if (type === "anthropic") {
        const key = anthropicVal.trim() || await invoke("get_credential", { key: "anthropic_key" }).then(v => v || "");
        await invoke("verify_anthropic_key", { apiKey: key });
        setVerifyStatus(s => ({ ...s, anthropic: "ok" }));
      } else if (type === "github") {
        const token = ghPatVal.trim() || await invoke("get_credential", { key: "github_pat" }).then(v => v || "");
        const result = await invoke("verify_github_pat", { token });
        const login = result.startsWith("valid:") ? result.slice(6) : "";
        setVerifyStatus(s => ({ ...s, github: login ? `ok:${login}` : "ok" }));
      }
    } catch (e) {
      setVerifyStatus(s => ({ ...s, [type]: `err:${String(e)}` }));
    }
  };

  useEffect(() => {
    invoke("get_credential", { key: "anthropic_key" })
      .then(val => { if (val && !anthropicVal) setAnthropicVal(val); })
      .catch(() => {});
    invoke("get_credential", { key: "github_pat" })
      .then(val => { if (val) setGhPatExists(true); })
      .catch(() => {});
    invoke("get_credential", { key: "apollo_key" })
      .then(val => { if (val) setApolloExists(true); })
      .catch(() => {});
    // Load Gmail connection status
    invoke("gmail_check_connection")
      .then(email => { if (email) setGmailEmail(email); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (anthropicVal.trim()) {
      localStorage.setItem("ff_anthropic_key", anthropicVal);
      try { await invoke("save_credential", { key: "anthropic_key", value: anthropicVal }); } catch {}
    }
    if (ghPatVal.trim()) {
      try { await invoke("save_credential", { key: "github_pat", value: ghPatVal }); setGhPatExists(true); } catch {}
    }
    if (apolloVal.trim()) {
      try {
        await invoke("save_credential", { key: "apollo_key", value: apolloVal });
        _apolloKey = apolloVal;
        setApolloExists(true);
      } catch {}
    }
    onSave(anthropicVal, apolloVal.trim() || apolloKeyProp);
    setSaved(true);
    setTimeout(onClose, 800);
  };

  const handleGmailConnect = async () => {
    if (!gmailClientId.trim() || !gmailClientSecret.trim()) {
      setGmailError("Both Client ID and Client Secret are required");
      return;
    }
    setGmailConnecting(true);
    setGmailError(null);
    try {
      const email = await invoke("gmail_oauth_start", {
        clientId: gmailClientId.trim(),
        clientSecret: gmailClientSecret.trim(),
      });
      setGmailEmail(email);
      onGmailConnected && onGmailConnected(email);
    } catch (e) {
      setGmailError(String(e));
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleGmailDisconnect = async () => {
    await invoke("gmail_disconnect").catch(() => {});
    setGmailEmail(null);
    setGmailClientId("");
    setGmailClientSecret("");
    onGmailConnected && onGmailConnected(null);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }} onClick={onClose}>
      <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:16, padding:28, width:480, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize:16, fontWeight:700, color:c.text, marginBottom:4 }}>Settings</h2>
        <p style={{ fontSize:12, color:c.textSub, marginBottom:20 }}>Credentials saved to OS keychain — never written to disk as plaintext.</p>

        {/* Anthropic API Key */}
        <label style={{ fontSize:12, fontWeight:600, color:c.textSub, display:"block", marginBottom:6 }}>Anthropic API Key</label>
        <input type="password" value={anthropicVal} onChange={e => setAnthropicVal(e.target.value)} placeholder="sk-ant-..."
          style={{ width:"100%", padding:"10px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:13, outline:"none", fontFamily:"monospace" }} />
        <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }}>
          <svg width="12" height="12" fill="none" stroke={c.accent} strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
          <button onClick={() => invoke("open_url", { url:"https://console.anthropic.com/settings/keys" })}
            style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer" }}
            onMouseEnter={e => e.target.style.textDecoration = "underline"}
            onMouseLeave={e => e.target.style.textDecoration = "none"}>
            console.anthropic.com/settings/keys
          </button>
          <button onClick={() => verify("anthropic")}
            style={{ marginLeft:"auto", fontSize:11, padding:"3px 8px", borderRadius:5, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, cursor:"pointer" }}>
            {verifyStatus.anthropic === "loading" ? "…" : verifyStatus.anthropic === "ok" ? "✓ Valid" : verifyStatus.anthropic?.startsWith("err:") ? "✕ Invalid" : "Verify"}
          </button>
        </div>
        {verifyStatus.anthropic?.startsWith("err:") && (
          <div style={{ fontSize:11, color:c.red, marginTop:4 }}>{verifyStatus.anthropic.slice(4)}</div>
        )}

        {/* GitHub PAT */}
        <label style={{ fontSize:12, fontWeight:600, color:c.textSub, display:"block", marginTop:18, marginBottom:6 }}>
          GitHub Personal Access Token
          {ghPatExists && !ghPatVal && (
            <span style={{ marginLeft:8, fontSize:11, padding:"2px 6px", borderRadius:4, background:c.greenDim, color:c.green, fontWeight:700 }}>Saved</span>
          )}
        </label>
        <input type="password" value={ghPatVal} onChange={e => setGhPatVal(e.target.value)}
          placeholder={ghPatExists ? "●●●●●●●●●●●●●●●● (leave blank to keep existing)" : "ghp_..."}
          style={{ width:"100%", padding:"10px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:13, outline:"none", fontFamily:"monospace" }} />
        <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }}>
          <svg width="12" height="12" fill="none" stroke={c.amber} strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style={{ fontSize:12, color:c.textMuted }}>Requires <code style={{ fontSize:11, background:c.bg, padding:"1px 4px", borderRadius:3 }}>repo</code> scope (issues:write) — </span>
          <button onClick={() => invoke("open_url", { url:"https://github.com/settings/tokens/new" })}
            style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer" }}
            onMouseEnter={e => e.target.style.textDecoration = "underline"}
            onMouseLeave={e => e.target.style.textDecoration = "none"}>
            create token
          </button>
          <button onClick={() => verify("github")}
            style={{ marginLeft:"auto", fontSize:11, padding:"3px 8px", borderRadius:5, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, cursor:"pointer" }}>
            {verifyStatus.github === "loading" ? "…" : verifyStatus.github?.startsWith("ok:") ? `✓ @${verifyStatus.github.slice(3)}` : verifyStatus.github === "ok" ? "✓ Valid" : verifyStatus.github?.startsWith("err:") ? "✕ Invalid" : "Verify"}
          </button>
        </div>
        {verifyStatus.github?.startsWith("err:") && (
          <div style={{ fontSize:11, color:c.red, marginTop:4 }}>{verifyStatus.github.slice(4)}</div>
        )}

        {/* Apollo API Key */}
        <label style={{ fontSize:12, fontWeight:600, color:c.textSub, display:"block", marginTop:18, marginBottom:6 }}>
          Apollo API Key
          {apolloExists && !apolloVal && (
            <span style={{ marginLeft:8, fontSize:11, padding:"2px 6px", borderRadius:4, background:c.greenDim, color:c.green, fontWeight:700 }}>Saved</span>
          )}
        </label>
        <input type="password" value={apolloVal} onChange={e => setApolloVal(e.target.value)}
          placeholder={apolloExists ? "●●●●●●●●●●●●●●●● (leave blank to keep existing)" : "Enter Apollo API key…"}
          style={{ width:"100%", padding:"10px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:13, outline:"none", fontFamily:"monospace" }} />
        <div style={{ marginTop:6, fontSize:12, color:c.textMuted }}>Used for the Intel pipeline contact search.</div>

        {/* ── Gmail Integration ─────────────────────────────────────────────── */}
        <div style={{ marginTop:22, paddingTop:18, borderTop:`1px solid ${c.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={c.accent}><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.910 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>
            <label style={{ fontSize:12, fontWeight:700, color:c.text }}>Gmail Integration</label>
            {gmailEmail && (
              <span style={{ fontSize:11, padding:"2px 7px", borderRadius:4, background:c.greenDim, color:c.green, fontWeight:700 }}>Connected</span>
            )}
          </div>

          {gmailEmail ? (
            /* Connected state */
            <div style={{ padding:"12px 14px", background:c.bg, border:`1px solid ${c.green}44`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:c.green }}>✓ {gmailEmail}</div>
                <div style={{ fontSize:11, color:c.textMuted, marginTop:2 }}>Sequence drafts, direct send, and reply tracking enabled</div>
              </div>
              <button onClick={handleGmailDisconnect}
                style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:`1px solid ${c.red}44`, background:"transparent", color:c.red, cursor:"pointer" }}
                onMouseEnter={e => { e.currentTarget.style.background = c.redDim; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                Disconnect
              </button>
            </div>
          ) : (
            /* Setup state */
            <>
              <div style={{ fontSize:11, color:c.textMuted, marginBottom:10, lineHeight:1.6 }}>
                Connect your Gmail to save outreach sequences as drafts, send directly from FinalFold, and track replies. Requires a Google Cloud OAuth 2.0 "Desktop app" client.{" "}
                <button onClick={() => invoke("open_url", { url:"https://console.cloud.google.com/apis/credentials" })}
                  style={{ color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer", fontSize:11 }}
                  onMouseEnter={e => e.target.style.textDecoration="underline"}
                  onMouseLeave={e => e.target.style.textDecoration="none"}>
                  Create credentials →
                </button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <input type="text" value={gmailClientId} onChange={e => setGmailClientId(e.target.value)}
                  placeholder="OAuth 2.0 Client ID (…apps.googleusercontent.com)"
                  style={{ width:"100%", padding:"9px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none", fontFamily:"monospace" }} />
                <input type="password" value={gmailClientSecret} onChange={e => setGmailClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  style={{ width:"100%", padding:"9px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none", fontFamily:"monospace" }} />
              </div>
              {gmailError && (
                <div style={{ marginTop:8, fontSize:11, color:c.red, lineHeight:1.5 }}>{gmailError}</div>
              )}
              <button onClick={handleGmailConnect} disabled={gmailConnecting || !gmailClientId.trim() || !gmailClientSecret.trim()}
                style={{ marginTop:8, width:"100%", padding:"9px 0", borderRadius:8, border:"none", background:c.accent, color:"#fff", fontSize:12, fontWeight:700, opacity: (gmailConnecting || !gmailClientId.trim() || !gmailClientSecret.trim()) ? 0.5 : 1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {gmailConnecting ? (
                  <><div style={{ width:12, height:12, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Waiting for browser…</>
                ) : "Connect Gmail Account"}
              </button>
              {gmailConnecting && (
                <div style={{ marginTop:6, fontSize:11, color:c.textMuted, textAlign:"center" }}>
                  Complete sign-in in your browser — waiting up to 5 minutes
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"8px 18px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:13 }}>Cancel</button>
          <button onClick={handleSave} style={{ padding:"8px 18px", borderRadius:8, border:"none", background: saved ? c.green : c.accent, color:"#fff", fontSize:13, fontWeight:600, transition:"background 0.2s" }}>
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Feature Request Generator ─────────────────────────────────────────────────

function parseRepoInput(input) {
  const clean = input.trim();
  const urlMatch = clean.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/);
  if (urlMatch) return { owner: urlMatch[1], repoName: urlMatch[2].replace(/\.git$/, "") };
  const slashMatch = clean.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) return { owner: slashMatch[1], repoName: slashMatch[2] };
  return null;
}

function FeatureRequestView({ c, onOpenSettings, bridgeContext, onClearBridge }) {
  const [subView,    setSubView]    = useState("input");
  const [savedRepos, setSavedRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [ideaText,   setIdeaText]   = useState("");
  const [genOutput,  setGenOutput]  = useState(null);    // { brief, issues }
  const [editedIssues, setEditedIssues] = useState([]);
  const [issueResults, setIssueResults] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [genError,   setGenError]   = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(0);
  const [addingRepo, setAddingRepo] = useState(false);
  const [newRepoInput, setNewRepoInput] = useState("");
  const [addRepoError, setAddRepoError] = useState(null);
  // Prospect context
  const [prospectName,  setProspectName]  = useState("");
  const [prospectNotes, setProspectNotes] = useState("");
  const [contextOpen,   setContextOpen]   = useState(false);
  // Run history
  const [featureRuns,   setFeatureRuns]   = useState([]);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  // Proposal draft copy feedback
  const [copiedDraft,   setCopiedDraft]   = useState(false);
  // Track the DB id of the last saved run so we can persist published URLs
  const lastRunIdRef = useRef(null);

  const ideaRef = useRef(null);

  // FF-10-T3: Pre-fill from bridge context when it changes
  useEffect(() => {
    if (!bridgeContext) return;
    setProspectName(bridgeContext.companyName);
    setProspectNotes(bridgeContext.notes);
    setContextOpen(true);
    ideaRef.current?.focus();
  }, [bridgeContext]);

  // FF-08-T1: Cmd+Enter (Mac) / Ctrl+Enter (Win) triggers Generate
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && subView === "input") {
        e.preventDefault();
        const ideaLen = ideaText.trim().length;
        if (selectedRepo && ideaLen >= 10 && ideaLen <= 2000 && !generating) {
          handleGenerate();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, ideaText, selectedRepo, generating]);

  const loadRepos = () => {
    invoke("list_saved_repos").then(setSavedRepos).catch(() => {});
  };
  const loadHistory = () => {
    invoke("list_feature_runs").then(setFeatureRuns).catch(() => {});
  };

  useEffect(() => { loadRepos(); loadHistory(); }, []);

  const handleAddRepo = async () => {
    const parsed = parseRepoInput(newRepoInput);
    if (!parsed) { setAddRepoError("Use format: owner/repo or a GitHub URL"); return; }
    try {
      await invoke("upsert_saved_repo", { owner: parsed.owner, repoName: parsed.repoName, displayLabel: null });
      await loadRepos();
      setSelectedRepo(`${parsed.owner}/${parsed.repoName}`);
      setNewRepoInput("");
      setAddingRepo(false);
      setAddRepoError(null);
    } catch (e) {
      setAddRepoError(String(e));
    }
  };

  const handleDeleteRepo = async (repo) => {
    try {
      await invoke("delete_saved_repo", { id: repo.id });
      if (selectedRepo === `${repo.owner}/${repo.repo_name}`) setSelectedRepo(null);
      loadRepos();
    } catch {}
  };

  const handleGenerate = async () => {
    if (!selectedRepo || ideaText.trim().length < 10) return;
    const [owner, repoName] = selectedRepo.split("/");
    setGenerating(true);
    setGenError(null);
    try {
      const output = await invoke("generate_feature_request", {
        owner,
        repoName,
        idea: ideaText,
        prospectName: prospectName.trim() || null,
        prospectNotes: prospectNotes.trim() || null,
      });
      setGenOutput(output);
      setEditedIssues(output.issues.map(i => ({ ...i })));
      setExpandedIdx(0);
      // Auto-save run to SQLite (non-blocking — failure should not prevent preview)
      invoke("save_feature_run", {
        input: {
          repo_owner: owner,
          repo_name: repoName,
          idea: ideaText,
          prospect_name: prospectName.trim(),
          prospect_notes: prospectNotes.trim(),
          brief: output.brief,
          issues: output.issues,
        },
      }).then(id => { lastRunIdRef.current = id; loadHistory(); }).catch(() => {});
      setSubView("preview");
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateIssues = async () => {
    if (!selectedRepo) return;
    const [owner, repoName] = selectedRepo.split("/");
    setSubmitting(true);
    try {
      const results = await invoke("create_github_issues", { owner, repoName, issues: editedIssues });
      setIssueResults(results);
      // Persist the successfully created URLs to the run record
      const urls = results.filter(r => r.status === "success" && r.url).map(r => r.url);
      if (urls.length > 0 && lastRunIdRef.current != null) {
        invoke("update_feature_run_urls", { id: lastRunIdRef.current, urls }).catch(() => {});
      }
      setSubView("confirmation");
    } catch (e) {
      setIssueResults([{ title: "Error", status: "error", url: null, error: String(e) }]);
      setSubView("confirmation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    setSubView("input");
    setGenOutput(null);
    setEditedIssues([]);
    setIssueResults([]);
    setGenError(null);
    setIdeaText("");
    // Preserve: selectedRepo, prospectName, prospectNotes — user likely wants to scope another feature for same client
  };

  const updateIssue = (idx, field, value) => {
    setEditedIssues(prev => prev.map((iss, i) => i === idx ? { ...iss, [field]: value } : iss));
  };

  // ── Input sub-view ────────────────────────────────────────────────────────
  if (subView === "input") {
    const ideaLen = ideaText.trim().length;
    const canGenerate = selectedRepo && ideaLen >= 10 && ideaLen <= 2000 && !generating;

    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* FF-10-T3: Bridge banner */}
        {bridgeContext && (
          <div style={{ padding:"10px 20px", background:c.accentGlow, borderBottom:`1px solid ${c.accentDim}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
            <span style={{ fontSize:12, color:c.accent }}>
              Context loaded from Intel run for <strong>{bridgeContext.companyName}</strong>
            </span>
            <button
              onClick={() => { onClearBridge(); setProspectName(""); setProspectNotes(""); setContextOpen(false); }}
              style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:"0 4px", cursor:"pointer", lineHeight:1 }}>
              ×
            </button>
          </div>
        )}
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        {/* Left panel */}
        <div style={{ width:340, flexShrink:0, borderRight:`1px solid ${c.border}`, display:"flex", flexDirection:"column", background:c.surface, padding:24 }}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Target Repository</div>
            {savedRepos.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8 }}>
                {savedRepos.map(r => {
                  const key = `${r.owner}/${r.repo_name}`;
                  const selected = selectedRepo === key;
                  return (
                    <div key={r.id} style={{ display:"flex", alignItems:"center", padding:"8px 10px", borderRadius:8, border:`1px solid ${selected ? c.accent : c.border}`, background: selected ? c.accentGlow : c.bg, cursor:"pointer", transition:"all 0.15s" }}
                      onClick={() => setSelectedRepo(selected ? null : key)}>
                      <span style={{ flex:1, fontSize:12, color: selected ? c.accent : c.text, fontWeight: selected ? 600 : 400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {r.display_label}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteRepo(r); }}
                        style={{ flexShrink:0, marginLeft:6, width:18, height:18, borderRadius:4, border:"none", background:"transparent", color:c.textMuted, fontSize:13, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}
                        title="Remove repository">
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {!addingRepo ? (
              <button onClick={() => setAddingRepo(true)}
                style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:16, lineHeight:1 }}>+</span> Add repository
              </button>
            ) : (
              <div style={{ marginTop:4 }}>
                <input
                  type="text"
                  value={newRepoInput}
                  onChange={e => { setNewRepoInput(e.target.value); setAddRepoError(null); }}
                  onKeyDown={e => { if (e.key === "Enter") handleAddRepo(); if (e.key === "Escape") { setAddingRepo(false); setNewRepoInput(""); setAddRepoError(null); } }}
                  placeholder="owner/repo or GitHub URL"
                  autoFocus
                  style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${addRepoError ? c.red : c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none", fontFamily:"monospace", marginBottom:6 }}
                />
                {addRepoError && <div style={{ fontSize:11, color:c.red, marginBottom:6 }}>{addRepoError}</div>}
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={handleAddRepo}
                    style={{ flex:1, padding:"7px 0", borderRadius:7, border:"none", background:c.accent, color:"#fff", fontSize:12, fontWeight:600 }}>
                    Add
                  </button>
                  <button onClick={() => { setAddingRepo(false); setNewRepoInput(""); setAddRepoError(null); }}
                    style={{ flex:1, padding:"7px 0", borderRadius:7, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:12 }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Feature Idea</div>
            <textarea
              ref={ideaRef}
              value={ideaText}
              onChange={e => setIdeaText(e.target.value.slice(0, 2000))}
              placeholder={"Describe your feature idea in plain text.\n\nExample: Add a dark mode toggle that persists between sessions and respects the user's system preference by default."}
              style={{ flex:1, minHeight:180, padding:"12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:10, color:c.text, fontSize:13, fontFamily:"inherit", lineHeight:1.6, outline:"none", resize:"none" }}
            />
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:4 }}>
              <span style={{ fontSize:11, color: ideaLen > 2000 ? c.red : ideaLen < 10 && ideaLen > 0 ? c.amber : c.textMuted }}>
                {ideaLen}/2000
              </span>
            </div>
          </div>

          {/* Client Context (collapsible) */}
          <div style={{ marginTop:16 }}>
            <button
              onClick={() => setContextOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", background:"none", border:"none", padding:0, cursor:"pointer" }}>
              <span style={{ fontSize:12, color:c.textMuted }}>{contextOpen ? "▼" : "▶"}</span>
              Client Context
              {(prospectName || prospectNotes) && <span style={{ fontSize:10, padding:"1px 5px", borderRadius:3, background:c.accentDim, color:c.accent }}>set</span>}
            </button>
            {contextOpen && (
              <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:8 }}>
                <input
                  type="text"
                  value={prospectName}
                  onChange={e => setProspectName(e.target.value)}
                  placeholder="Client name (e.g. Acme Corp)"
                  style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none" }}
                />
                <textarea
                  value={prospectNotes}
                  onChange={e => setProspectNotes(e.target.value)}
                  placeholder="Stack, team size, pain points… (e.g. React + Rails API, 25 employees, manual reporting is a major bottleneck)"
                  rows={3}
                  style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, fontFamily:"inherit", lineHeight:1.5, outline:"none", resize:"none" }}
                />
              </div>
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            style={{ marginTop:16, width:"100%", padding:"12px 0", borderRadius:10, border:"none", background:c.accent, color:"#fff", fontSize:14, fontWeight:700, opacity: canGenerate ? 1 : 0.45, transition:"opacity 0.15s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {generating ? (
              <><div style={{ width:14, height:14, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Generating…</>
            ) : "Generate Issues"}
          </button>
          {genError && (
            <div style={{ marginTop:12, padding:"10px 12px", background:c.redDim, border:`1px solid ${c.red}44`, borderRadius:10, fontSize:12, color:c.red }}>
              <strong>Error:</strong> {genError}
              <button onClick={handleGenerate} style={{ display:"block", marginTop:8, fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer" }}>Try again →</button>
            </div>
          )}
        </div>

        {/* Right panel — empty state + history */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:32, overflow:"auto" }}>
          {/* Empty state prompt */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", flex: featureRuns.length ? 0 : 1, paddingBottom: featureRuns.length ? 24 : 0 }}>
            <div style={{ fontSize:40, marginBottom:16, opacity:0.15 }}>◈</div>
            <div style={{ fontSize:16, fontWeight:600, color:c.textSub, marginBottom:8 }}>Idea → GitHub Issues</div>
            <div style={{ fontSize:13, color:c.textMuted, maxWidth:360, lineHeight:1.7 }}>
              Select a repo, describe your feature, and click <strong style={{ color:c.textSub }}>Generate Issues</strong>.<br/><br/>
              Claude will produce a feature brief and implementation tickets ready to publish to GitHub.
            </div>
            {!savedRepos.length && (
              <div style={{ marginTop:24, padding:"12px 16px", background:c.amberDim, border:`1px solid ${c.amber}44`, borderRadius:10, fontSize:12, color:c.amber, maxWidth:320 }}>
                Add a repository in the left panel to get started.
              </div>
            )}
          </div>

          {/* History panel */}
          {featureRuns.length > 0 && (
            <div style={{ marginTop: featureRuns.length ? 0 : 32 }}>
              <button
                onClick={() => setHistoryOpen(o => !o)}
                style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12, fontSize:12, fontWeight:700, color:c.textSub, background:"none", border:"none", padding:0, cursor:"pointer" }}>
                <span style={{ fontSize:11 }}>{historyOpen ? "▼" : "▶"}</span>
                Recent Runs
                <span style={{ fontSize:11, padding:"1px 6px", borderRadius:4, background:c.card, color:c.textMuted, border:`1px solid ${c.border}` }}>{featureRuns.length}</span>
              </button>
              {(historyOpen || featureRuns.length <= 3) && (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {featureRuns.slice(0, 10).map(run => (
                    <button
                      key={run.id}
                      onClick={async () => {
                        try {
                          const full = await invoke("load_feature_run", { id: run.id });
                          setGenOutput({ brief: full.brief, issues: full.issues });
                          setEditedIssues(full.issues.map(i => ({ ...i })));
                          setExpandedIdx(0);
                          setIssueResults([]);
                          setGenError(null);
                          if (full.prospect_name) setProspectName(full.prospect_name);
                          if (full.prospect_notes) setProspectNotes(full.prospect_notes);
                          if (run.repo_owner && run.repo_name) setSelectedRepo(`${run.repo_owner}/${run.repo_name}`);
                          setSubView("preview");
                        } catch {}
                      }}
                      style={{ textAlign:"left", padding:"12px 14px", background:c.card, border:`1px solid ${c.border}`, borderRadius:10, cursor:"pointer", transition:"border-color 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = c.borderLight}
                      onMouseLeave={e => e.currentTarget.style.borderColor = c.border}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:c.accent }}>{run.repo_owner}/{run.repo_name}</span>
                        <span style={{ fontSize:10, color:c.textMuted }}>
                          {new Date(run.created_at * 1000).toLocaleDateString("en-US", { month:"short", day:"numeric" })}
                        </span>
                      </div>
                      {run.prospect_name && (
                        <div style={{ fontSize:10, color:c.textMuted, marginBottom:3 }}>{run.prospect_name}</div>
                      )}
                      <div style={{ fontSize:12, color:c.textSub, lineHeight:1.4 }}>{run.idea_preview}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    );
  }

  // ── Preview sub-view ──────────────────────────────────────────────────────
  if (subView === "preview" && genOutput) {
    const { brief } = genOutput;
    const hasEmptyTitle = editedIssues.some(i => !i.title.trim());

    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Top bar */}
        <div style={{ padding:"14px 24px", borderBottom:`1px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", background:c.surface, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <button onClick={() => setSubView("input")}
              style={{ fontSize:12, color:c.textSub, background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
              ← Back
            </button>
            <span style={{ fontSize:14, fontWeight:700, color:c.text }}>{brief.feature_name}</span>
            <span style={{ fontSize:12, padding:"2px 8px", borderRadius:5, background:c.accentDim, color:c.accent, fontWeight:700 }}>{editedIssues.length} issues</span>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button
              onClick={() => {
                const today = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
                const repo = selectedRepo || "—";
                const { brief } = genOutput;
                const goalsStr = brief.goals?.length ? brief.goals.map(g => `- ${g}`).join("\n") : "—";
                const nonGoalsStr = brief.non_goals?.length ? brief.non_goals.map(g => `- ${g}`).join("\n") : "—";
                const tableRows = editedIssues.map((iss, i) =>
                  `| ${i + 1} | ${iss.title} | ${iss.area} | — |`
                ).join("\n");
                const acSection = editedIssues.slice(0, 3).flatMap(iss =>
                  iss.acceptance_criteria?.length ? iss.acceptance_criteria.map(ac => `- ${ac}`) : []
                ).join("\n");
                const md = `# ${brief.feature_name} — Scope Summary\n\n**Client:** ${prospectName || "—"}  \n**Repository:** ${repo}  \n**Date:** ${today}\n\n## What We're Building\n\n${brief.summary}\n\n## Problem Being Solved\n\n${brief.problem}\n\n## Goals\n\n${goalsStr}\n\n## What's Not Included\n\n${nonGoalsStr}\n\n## Proposed Work Breakdown\n\n| # | Issue | Area | Est. Complexity |\n|---|-------|------|-----------------|\n${tableRows}\n\n## Acceptance Criteria (Selected)\n\n${acSection || "—"}\n\n## Next Steps\n\n1. Review this scope and confirm the priority order\n2. Identify any missing requirements or out-of-scope items\n3. Proceed with implementation planning\n\n---\n*Generated by Feature Fold — Foxworks*`;
                navigator.clipboard.writeText(md).catch(() => {});
                setCopiedDraft(true);
                setTimeout(() => setCopiedDraft(false), 2000);
              }}
              style={{ padding:"9px 16px", borderRadius:9, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:13, fontWeight:600 }}>
              {copiedDraft ? "Copied ✓" : "Copy Proposal Draft"}
            </button>
            <button
              onClick={handleCreateIssues}
              disabled={hasEmptyTitle || submitting}
              style={{ padding:"9px 20px", borderRadius:9, border:"none", background:c.accent, color:"#fff", fontSize:13, fontWeight:700, opacity: hasEmptyTitle || submitting ? 0.5 : 1, display:"flex", alignItems:"center", gap:8 }}>
              {submitting ? (
                <><div style={{ width:12, height:12, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Creating…</>
              ) : `Create Issues on GitHub →`}
            </button>
          </div>
        </div>

        <div style={{ flex:1, overflow:"auto", padding:24, display:"flex", gap:20, alignItems:"flex-start" }}>
          {/* Feature Brief sidebar */}
          <div style={{ width:280, flexShrink:0 }}>
            <div style={{ background:c.card, border:`1px solid ${c.border}`, borderRadius:12, padding:18 }}>
              <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:10 }}>Feature Brief</div>
              <div style={{ fontSize:13, fontWeight:600, color:c.text, marginBottom:6 }}>{brief.feature_name}</div>
              <div style={{ fontSize:12, color:c.textSub, marginBottom:12, lineHeight:1.6 }}>{brief.summary}</div>
              <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Problem</div>
              <div style={{ fontSize:12, color:c.textSub, marginBottom:12, lineHeight:1.6 }}>{brief.problem}</div>
              {brief.goals?.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Goals</div>
                  <ul style={{ margin:0, padding:"0 0 0 14px", marginBottom:12 }}>
                    {brief.goals.map((g, i) => <li key={i} style={{ fontSize:12, color:c.textSub, marginBottom:4, lineHeight:1.5 }}>{g}</li>)}
                  </ul>
                </>
              )}
              {brief.non_goals?.length > 0 && (
                <>
                  <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Non-Goals (v1)</div>
                  <ul style={{ margin:0, padding:"0 0 0 14px" }}>
                    {brief.non_goals.map((g, i) => <li key={i} style={{ fontSize:12, color:c.textMuted, marginBottom:4, lineHeight:1.5 }}>{g}</li>)}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Issue cards */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10, minWidth:0 }}>
            {editedIssues.map((issue, idx) => (
              <div key={idx} style={{ background:c.card, border:`1px solid ${expandedIdx === idx ? c.borderLight : c.border}`, borderRadius:12, overflow:"hidden", transition:"border-color 0.15s" }}>
                {/* Card header */}
                <div
                  onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                  style={{ padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:c.textMuted, flexShrink:0 }}>#{idx + 1}</span>
                    <span style={{ fontSize:13, fontWeight:600, color:c.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{issue.title || <em style={{ color:c.textMuted }}>Untitled</em>}</span>
                    <span style={{ flexShrink:0, fontSize:10, padding:"2px 6px", borderRadius:4, background:c.accentDim, color:c.accent }}>{issue.area}</span>
                  </div>
                  <span style={{ color:c.textMuted, fontSize:12, marginLeft:8 }}>{expandedIdx === idx ? "▲" : "▼"}</span>
                </div>

                {/* Card body */}
                {expandedIdx === idx && (
                  <div style={{ padding:"0 18px 18px", borderTop:`1px solid ${c.border}` }}>
                    <label style={{ fontSize:11, fontWeight:700, color:c.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginTop:14, marginBottom:6 }}>Title</label>
                    <input
                      type="text"
                      value={issue.title}
                      onChange={e => updateIssue(idx, "title", e.target.value)}
                      style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${!issue.title.trim() ? c.red : c.border}`, borderRadius:8, color:c.text, fontSize:13, outline:"none" }}
                    />

                    <label style={{ fontSize:11, fontWeight:700, color:c.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginTop:14, marginBottom:6 }}>Body</label>
                    <textarea
                      value={issue.body}
                      onChange={e => updateIssue(idx, "body", e.target.value)}
                      rows={8}
                      style={{ width:"100%", padding:"10px 12px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, fontFamily:"monospace", lineHeight:1.6, outline:"none", resize:"vertical" }}
                    />

                    <>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:14, marginBottom:8 }}>
                        <label style={{ fontSize:11, fontWeight:700, color:c.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Acceptance Criteria</label>
                        <button
                          onClick={() => updateIssue(idx, "acceptance_criteria", [...(issue.acceptance_criteria || []), ""])}
                          style={{ fontSize:11, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer" }}>
                          + Add
                        </button>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {(issue.acceptance_criteria || []).map((ac, ai) => (
                          <div key={ai} style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ flexShrink:0, color:c.textMuted, fontSize:12 }}>☐</span>
                            <input
                              type="text"
                              value={ac}
                              onChange={e => {
                                const updated = [...issue.acceptance_criteria];
                                updated[ai] = e.target.value;
                                updateIssue(idx, "acceptance_criteria", updated);
                              }}
                              style={{ flex:1, padding:"5px 8px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:6, color:c.text, fontSize:12, outline:"none" }}
                            />
                            <button
                              onClick={() => updateIssue(idx, "acceptance_criteria", issue.acceptance_criteria.filter((_, i) => i !== ai))}
                              style={{ flexShrink:0, color:c.textMuted, background:"none", border:"none", padding:"0 2px", cursor:"pointer", fontSize:14, lineHeight:1 }}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </>

                    {issue.dependencies?.length > 0 && (
                      <>
                        <label style={{ fontSize:11, fontWeight:700, color:c.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginTop:14, marginBottom:6 }}>Dependencies</label>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                          {issue.dependencies.map((dep, di) => (
                            <span key={di} style={{ fontSize:11, padding:"2px 8px", borderRadius:5, background:c.amberDim, color:c.amber }}>{dep}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Confirmation sub-view ─────────────────────────────────────────────────
  if (subView === "confirmation") {
    const allSuccess = issueResults.length > 0 && issueResults.every(r => r.status === "success");
    const allFailed  = issueResults.length > 0 && issueResults.every(r => r.status === "error");
    const successUrls = issueResults.filter(r => r.status === "success" && r.url).map(r => r.url);

    const openAll = async () => {
      for (let i = 0; i < successUrls.length; i++) {
        if (i > 0) await new Promise(res => setTimeout(res, 300));
        invoke("open_url", { url: successUrls[i] }).catch(() => {});
      }
    };

    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", padding:"40px 24px", overflow:"auto" }}>
        <div style={{ width:"100%", maxWidth:580 }}>
          <div style={{ marginBottom:24, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:c.text, marginBottom:4 }}>
                {allSuccess ? "All issues created" : allFailed ? "Creation failed" : "Issues created"}
              </div>
              <div style={{ fontSize:13, color:c.textSub }}>
                {issueResults.filter(r => r.status === "success").length} of {issueResults.length} succeeded
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {allSuccess && successUrls.length > 1 && (
                <button onClick={openAll}
                  style={{ padding:"8px 16px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.accent, fontSize:13, fontWeight:600 }}>
                  Open all on GitHub
                </button>
              )}
              <button onClick={handleDone}
                style={{ padding:"8px 16px", borderRadius:8, border:"none", background:c.accent, color:"#fff", fontSize:13, fontWeight:600 }}>
                Done
              </button>
            </div>
          </div>

          {allFailed && (
            <div style={{ marginBottom:16, padding:"12px 16px", background:c.redDim, border:`1px solid ${c.red}44`, borderRadius:10, fontSize:12, color:c.red }}>
              All issues failed. Check your GitHub PAT in <button onClick={onOpenSettings} style={{ color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer", textDecoration:"underline", fontSize:12 }}>Settings</button> — ensure it has <code>repo</code> scope.
            </div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {issueResults.map((result, idx) => (
              <div key={idx} style={{ padding:"14px 16px", background:c.card, border:`1px solid ${result.status === "success" ? c.green + "44" : c.red + "44"}`, borderRadius:10, display:"flex", alignItems:"flex-start", gap:12 }}>
                <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{result.status === "success" ? "✓" : "✕"}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:c.text, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{result.title}</div>
                  {result.status === "success" && result.url && (
                    <button onClick={() => invoke("open_url", { url: result.url }).catch(() => {})}
                      style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>
                      Open on GitHub →
                    </button>
                  )}
                  {result.status === "error" && result.error && (
                    <div style={{ fontSize:12, color:c.red, lineHeight:1.5 }}>{result.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Outreach Email Generator ─────────────────────────────────────────────────

const OUTREACH_STAGES = [
  { id: "haiku",  label: "Extract Signals", model: "Haiku",  icon: "⚡" },
  { id: "sonnet", label: "Draft Emails",    model: "Sonnet", icon: "✦" },
  { id: "haiku2", label: "Score Variants",  model: "Haiku",  icon: "⚡" },
];

function VariantCard({ variant, spamHits, contactEmail, contactCompany, gmailConnected, onDraftSaved, onSent, onChange, c }) {
  const [copiedSubj,  setCopiedSubj]  = useState(null);
  const [copiedBody,  setCopiedBody]  = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  // Gmail per-variant state
  const [draftResult,  setDraftResult]  = useState(null);   // { draftId, gmailUrl }
  const [sendResult,   setSendResult]   = useState(null);   // { messageId, threadId, sentAt }
  const [draftSaving,  setDraftSaving]  = useState(false);
  const [sending,      setSending]      = useState(false);
  const [gmailError,   setGmailError]   = useState(null);
  // Send preview modal (FF-18)
  const [previewOpen,   setPreviewOpen]  = useState(false);
  // Template save (FF-21)
  const [savingTpl,     setSavingTpl]    = useState(false);
  const [tplName,       setTplName]      = useState("");
  const [tplSaved,      setTplSaved]     = useState(false);

  const wordCount = (variant.body || "").trim().split(/\s+/).filter(Boolean).length;
  const isLinkedIn = variant.label === "LinkedIn";

  const copyEmail = () => {
    const subj = variant.subjects?.[0];
    const text = subj ? `Subject: ${subj}\n\n${variant.body || ""}` : variant.body || "";
    navigator.clipboard.writeText(text).then(() => { setCopiedEmail(true); setTimeout(() => setCopiedEmail(false), 1800); });
  };

  const openInMail = () => {
    const subj = encodeURIComponent(variant.subjects?.[0] || "");
    const body = encodeURIComponent(variant.body || "");
    const to   = encodeURIComponent(contactEmail || "");
    invoke("open_url", { url: `mailto:${to}?subject=${subj}&body=${body}` });
  };

  const openInGmail = () => {
    const su   = encodeURIComponent(variant.subjects?.[0] || "");
    const body = encodeURIComponent(variant.body || "");
    const to   = encodeURIComponent(contactEmail || "");
    invoke("open_url", { url: `https://mail.google.com/mail/?view=cm&to=${to}&su=${su}&body=${body}` });
  };

  const handleSaveDraft = async () => {
    setDraftSaving(true); setGmailError(null);
    try {
      const result = await invoke("gmail_save_draft", {
        to: contactEmail || "",
        subject: variant.subjects?.[0] || variant.label || "",
        body: variant.body || "",
      });
      setDraftResult(result);
      onDraftSaved && onDraftSaved(result);
    } catch (e) { setGmailError(String(e)); }
    setDraftSaving(false);
  };

  const handleSendNow = async () => {
    if (!contactEmail) { setGmailError("Add contact email to send"); return; }
    setSending(true); setGmailError(null);
    setPreviewOpen(false);
    try {
      const result = await invoke("gmail_send_message", {
        to: contactEmail,
        subject: variant.subjects?.[0] || variant.label || "",
        body: variant.body || "",
      });
      const r = { ...result, sentAt: Date.now() };
      setSendResult(r);
      markContacted(contactEmail, contactCompany);
      onSent && onSent(r);
    } catch (e) { setGmailError(String(e)); }
    setSending(false);
  };

  return (
    <div style={{ maxWidth:680, margin:"0 auto" }}>
      {/* Subject lines (not for LinkedIn) */}
      {!isLinkedIn && (variant.subjects || []).length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Subject Lines</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {(variant.subjects || []).map((subj, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input
                  type="text"
                  value={subj}
                  onChange={e => { const u = [...variant.subjects]; u[i] = e.target.value; onChange("subjects", u); }}
                  style={{ flex:1, padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:13, outline:"none" }}
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(subj).then(() => { setCopiedSubj(i); setTimeout(() => setCopiedSubj(null), 1800); }); }}
                  style={{ flexShrink:0, padding:"5px 10px", borderRadius:6, border:`1px solid ${copiedSubj === i ? c.green : c.border}`, background: copiedSubj === i ? c.greenDim : "transparent", color: copiedSubj === i ? c.green : c.textSub, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
                  {copiedSubj === i ? "✓" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase" }}>
            {isLinkedIn ? "Message" : "Email Body"}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, color: wordCount > 120 ? c.red : wordCount > 100 ? c.amber : c.textMuted }}>
              {wordCount} words{wordCount > 120 ? " ⚠ over 120" : ""}
            </span>
            {/* Copy Email — subject + blank line + body in one shot */}
            {!isLinkedIn && (variant.subjects || []).length > 0 && (
              <button onClick={copyEmail}
                style={{ padding:"5px 12px", borderRadius:6, border:`1px solid ${copiedEmail ? c.green : c.border}`, background: copiedEmail ? c.greenDim : "transparent", color: copiedEmail ? c.green : c.textSub, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
                {copiedEmail ? "✓ Copied" : "Copy Email"}
              </button>
            )}
            <button
              onClick={() => { navigator.clipboard.writeText(variant.body || "").then(() => { setCopiedBody(true); setTimeout(() => setCopiedBody(false), 1800); }); }}
              style={{ padding:"5px 12px", borderRadius:6, border:`1px solid ${copiedBody ? c.green : c.border}`, background: copiedBody ? c.greenDim : "transparent", color: copiedBody ? c.green : c.textSub, fontSize:11, fontWeight:600, cursor:"pointer", transition:"all 0.15s" }}>
              {copiedBody ? "✓ Copied" : isLinkedIn ? "Copy" : "Copy Body"}
            </button>
            {/* ★ Save as Template (FF-21) */}
            {tplSaved ? (
              <span style={{ fontSize:11, color:c.green, fontWeight:600 }}>★ Saved!</span>
            ) : savingTpl ? (
              <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                <input
                  autoFocus
                  value={tplName}
                  onChange={e => setTplName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && tplName.trim()) {
                      const id = `tpl_${Date.now()}`;
                      upsertTemplate({ id, name: tplName.trim(), label: variant.label, subjects: variant.subjects || [], body: variant.body || "", savedAt: Date.now(), useCount: 0 });
                      setTplSaved(true); setSavingTpl(false); setTplName("");
                      setTimeout(() => setTplSaved(false), 3000);
                    }
                    if (e.key === "Escape") { setSavingTpl(false); setTplName(""); }
                  }}
                  placeholder="Template name…"
                  style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${c.accent}66`, background:c.bg, color:c.text, fontSize:11, outline:"none", width:120 }}
                />
                <button
                  onClick={() => {
                    if (!tplName.trim()) return;
                    const id = `tpl_${Date.now()}`;
                    upsertTemplate({ id, name: tplName.trim(), label: variant.label, subjects: variant.subjects || [], body: variant.body || "", savedAt: Date.now(), useCount: 0 });
                    setTplSaved(true); setSavingTpl(false); setTplName("");
                    setTimeout(() => setTplSaved(false), 3000);
                  }}
                  style={{ padding:"4px 8px", borderRadius:6, border:"none", background:c.accent, color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  Save
                </button>
                <button onClick={() => { setSavingTpl(false); setTplName(""); }}
                  style={{ padding:"4px 6px", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, cursor:"pointer" }}>
                  ×
                </button>
              </div>
            ) : (
              <button onClick={() => setSavingTpl(true)}
                style={{ padding:"5px 10px", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, fontWeight:600, cursor:"pointer" }}
                title="Save as reusable template">
                ★ Save
              </button>
            )}
          </div>
        </div>
        <textarea
          value={variant.body || ""}
          onChange={e => onChange("body", e.target.value)}
          rows={isLinkedIn ? 10 : 12}
          style={{ width:"100%", padding:"14px", background:c.bg, border:`1px solid ${(spamHits || []).length > 0 ? c.amber : c.border}`, borderRadius:10, color:c.text, fontSize:13, fontFamily:"inherit", lineHeight:1.7, outline:"none", resize:"vertical" }}
        />
        {/* Anti-spam warning */}
        {(spamHits || []).length > 0 && (
          <div style={{ marginTop:6, fontSize:11, color:c.amber }}>
            ⚠ {spamHits.length} spam word{spamHits.length > 1 ? "s" : ""}: {spamHits.join(", ")}
          </div>
        )}

        {/* Send buttons — email variants only */}
        {!isLinkedIn && (
          <>
            {/* Open in Mail / Open in Gmail (compose URL) */}
            <div style={{ marginTop:12, display:"flex", gap:8 }}>
              <button onClick={openInMail}
                style={{ flex:1, padding:"9px 0", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = c.accent; e.currentTarget.style.color = c.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSub; }}>
                ✉ Open in Mail
              </button>
              <button onClick={openInGmail}
                style={{ flex:1, padding:"9px 0", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#ea4335"; e.currentTarget.style.color = "#ea4335"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSub; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.910 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>
                Open in Gmail
              </button>
            </div>

            {/* Gmail API actions (requires OAuth) */}
            {gmailConnected && (
              <div style={{ marginTop:8 }}>
                {sendResult ? (
                  /* Sent confirmation */
                  <div style={{ padding:"10px 14px", background:c.greenDim, border:`1px solid ${c.green}44`, borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:14, color:c.green }}>✓</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:c.green }}>Sent via Gmail</div>
                      <div style={{ fontSize:11, color:c.textMuted, marginTop:1 }}>{new Date(sendResult.sentAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display:"flex", gap:6 }}>
                    {/* Save as Gmail draft */}
                    {draftResult ? (
                      <button onClick={() => invoke("open_url", { url: draftResult.gmail_url })}
                        style={{ flex:1, padding:"9px 0", borderRadius:8, border:`1px solid ${c.green}44`, background:c.greenDim, color:c.green, fontSize:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        ✓ Open Draft →
                      </button>
                    ) : (
                      <button onClick={handleSaveDraft} disabled={draftSaving}
                        style={{ flex:1, padding:"9px 0", borderRadius:8, border:`1px solid ${c.accent}55`, background:`${c.accent}11`, color:c.accent, fontSize:12, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:5, opacity: draftSaving ? 0.6 : 1 }}
                        onMouseEnter={e => { if (!draftSaving) { e.currentTarget.style.background = `${c.accent}22`; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${c.accent}11`; }}>
                        {draftSaving ? "Saving…" : "Save to Drafts"}
                      </button>
                    )}
                    {/* Send immediately — opens preview modal */}
                    <button onClick={() => { if (contactEmail) setPreviewOpen(true); else setGmailError("Add contact email to send"); }}
                      disabled={sending}
                      style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", background: contactEmail ? c.accent : c.textMuted, color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", gap:5, opacity: sending ? 0.5 : 1 }}
                      title={!contactEmail ? "Add contact email to enable direct send" : ""}>
                      {sending ? "Sending…" : "Send Now"}
                    </button>
                  </div>
                )}
                {gmailError && (
                  <div style={{ marginTop:6, fontSize:11, color:c.red }}>{gmailError}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Send preview modal (FF-18) */}
      {previewOpen && (
        <SendPreviewModal
          to={contactEmail}
          subject={variant.subjects?.[0] || variant.label || ""}
          body={variant.body || ""}
          onConfirm={handleSendNow}
          onCancel={() => setPreviewOpen(false)}
          c={c}
        />
      )}
    </div>
  );
}

function OutreachView({ c, apiKey, onOpenSettings, outreachBridge, onClearBridge, gmailConnected, onGmailConnectedChange }) {
  const [stStates,       setStStates]       = useState({});
  const [contactName,    setContactName]    = useState("");
  const [contactTitle,   setContactTitle]   = useState("");
  const [contactEmail,   setContactEmail]   = useState("");
  const [company,        setCompany]        = useState("");
  const [intelCtx,       setIntelCtx]       = useState("");
  const [tone,           setTone]           = useState("direct");
  const [mode,           setMode]           = useState("variants"); // "variants" | "sequence"
  const [generating,     setGenerating]     = useState(false);
  const [signals,        setSignals]        = useState(null);
  const [editedVariants, setEditedVariants] = useState([]);
  const [activeIdx,      setActiveIdx]      = useState(0);
  const [scores,         setScores]         = useState([]);
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [sharpeningIdx,  setSharpeningIdx]  = useState(null);
  const [error,          setError]          = useState(null);
  // Gmail — sequence drafts and sent tracking
  const [sequenceDrafts,  setSequenceDrafts]  = useState([]); // [{step, draft_id, message_id, gmail_url}]
  const [sequenceSent,    setSequenceSent]     = useState({}); // { label: {messageId, threadId, sentAt} }
  const [savingDrafts,    setSavingDrafts]     = useState(false);
  const [sendingStep,     setSendingStep]      = useState(null); // label being sent
  const [replyStatus,     setReplyStatus]      = useState({}); // { label: bool }
  const [replyDetails,    setReplyDetails]     = useState({}); // { label: ReplyDetail }
  const [checkingReplies, setCheckingReplies]  = useState(false);
  // FF-15: scheduled sends { step: ISO datetime string }
  const [schedules,       setSchedules]        = useState({});
  // FF-16: lifecycle paused state
  const [paused,          setPaused]           = useState(false);
  // FF-18: send preview modal for sequence tracker
  const [seqPreview,      setSeqPreview]       = useState(null); // { step, variant } | null
  // FF-20: id of the currently persisted sequence record
  const [activeSeqId,     setActiveSeqId]      = useState(null);
  // FF-21: template picker
  const [showTplPicker,  setShowTplPicker]  = useState(false);
  const [tplList,        setTplList]        = useState(() => Object.values(loadTemplates()));
  const autoCheckedRef = useRef(false);
  const [history,        setHistory]        = useState(() => {
    try { return JSON.parse(localStorage.getItem("ff_outreach_history") || "[]"); } catch { return []; }
  });
  const [historyOpen,    setHistoryOpen]    = useState(false);

  const setSt = (id, status) => setStStates(s => ({ ...s, [id]: status }));

  // FF-16: Auto-check replies once when sequenceSent first gets thread_ids
  useEffect(() => {
    if (autoCheckedRef.current) return;
    const hasSentWithThread = Object.values(sequenceSent).some(s => s.thread_id);
    if (!hasSentWithThread || !gmailConnected) return;
    autoCheckedRef.current = true;
    handleCheckReplies();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceSent, gmailConnected]);

  // FF-15: Scheduled send auto-fire — check every 60s
  useEffect(() => {
    if (!Object.keys(schedules).length) return;
    const tick = async () => {
      const now = Date.now();
      for (const [step, isoDate] of Object.entries(schedules)) {
        if (!isoDate) continue;
        const scheduledMs = new Date(isoDate).getTime();
        if (scheduledMs > now) continue;
        if (sequenceSent[step] || sendingStep === step) continue;
        const stepVariant = editedVariants.find(v => v.label === step);
        if (stepVariant && contactEmail && gmailConnected) {
          setSchedules(prev => { const u = { ...prev }; delete u[step]; return u; });
          await handleSendSequenceStep(stepVariant);
        }
      }
    };
    tick(); // Check immediately
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, sequenceSent, sendingStep, editedVariants, contactEmail, gmailConnected]);

  const chat = useCallback(async (model, system, userMessage, maxTokens = 2048) => {
    if (!apiKey?.trim()) throw new Error("Anthropic API key not set — open Settings ⚙");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await invoke("anthropic_chat", { apiKey, model, system, userMessage, maxTokens });
      } catch (err) {
        if (String(err).includes("429") && attempt < 2) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 10000));
          continue;
        }
        throw err;
      }
    }
  }, [apiKey]);

  // Pre-fill from outreach bridge
  useEffect(() => {
    if (!outreachBridge) return;
    setContactName(outreachBridge.contactName || "");
    setContactTitle(outreachBridge.contactTitle || "");
    setContactEmail(outreachBridge.contactEmail || "");
    setCompany(outreachBridge.company || "");
    setIntelCtx(outreachBridge.intelContext || "");
  }, [outreachBridge]);

  const handleSharpen = async (idx) => {
    if (sharpeningIdx !== null || generating) return;
    const v = editedVariants[idx];
    if (!v) return;
    setSharpeningIdx(idx);
    try {
      const hasSubjects = (v.subjects || []).length > 0;
      const raw = await chat(SONNET,
        "You are a B2B email editor. Return ONLY valid JSON — no preamble, no code fences.",
        `Rewrite this cold email to be 20-30% shorter and more direct. Keep every named signal and specific detail. Make every sentence earn its place.

Return JSON: ${hasSubjects ? `{ "subjects": ["sharper subject 1", "sharper subject 2"], "body": "..." }` : `{ "body": "..." }`}

Current email:
${hasSubjects ? `Subject options: ${v.subjects.join(" | ")}\n\n` : ""}${v.body}`, 1024);
      const result = parseJson(raw);
      setEditedVariants(prev => prev.map((item, i) => i === idx ? {
        ...item,
        body: result.body || item.body,
        ...(hasSubjects && result.subjects ? { subjects: result.subjects } : {}),
      } : item));
    } catch { /* non-fatal */ }
    setSharpeningIdx(null);
  };

  // ── Gmail sequence actions ────────────────────────────────────────────────
  const handleSaveSequenceDrafts = async () => {
    if (!editedVariants.length || !gmailConnected) return;
    setSavingDrafts(true);
    setError(null);
    try {
      const steps = editedVariants
        .filter(v => v.label !== "LinkedIn")
        .map(v => ({
          label:   v.label,
          subject: (v.subjects || [])[0] || v.label,
          body:    v.body || "",
        }));
      const results = await invoke("gmail_save_sequence_drafts", {
        steps,
        to: contactEmail || "",
      });
      setSequenceDrafts(results);

      // FF-18: apply "FinalFold" label to all drafted messages
      try {
        const labelId = await invoke("gmail_ensure_label", { name: "FinalFold" });
        for (const r of results) {
          if (r.message_id) {
            await invoke("gmail_apply_label", { messageId: r.message_id, labelId });
          }
        }
      } catch { /* label application is non-fatal */ }

      // FF-20: persist sequence record to localStorage
      try {
        const seqId = `seq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const seqSteps = steps.map((step, i) => {
          const d = results[i] || {};
          return {
            label:       step.label,
            subject:     step.subject,
            body:        step.body,
            draftId:     d.draft_id   || null,
            messageId:   d.message_id || null,
            gmailUrl:    d.gmail_url  || null,
            sentAt:      null,
            threadId:    null,
            scheduledAt: null,
          };
        });
        const record = {
          id:           seqId,
          contactEmail: (contactEmail || "").toLowerCase(),
          contactName:  contactName,
          company,
          createdAt:    Date.now(),
          lastActivity: Date.now(),
          status:       "active",
          replyDetails: {},
          steps:        seqSteps,
        };
        upsertSequenceRecord(record);
        setActiveSeqId(seqId);
      } catch { /* non-fatal */ }

    } catch (e) {
      setError(String(e));
    } finally {
      setSavingDrafts(false);
    }
  };

  const handleSendSequenceStep = async (variant) => {
    if (!contactEmail || !gmailConnected) return;
    setSeqPreview(null); // close preview if open
    setSendingStep(variant.label);
    setError(null);
    try {
      const result = await invoke("gmail_send_message", {
        to:      contactEmail,
        subject: (variant.subjects || [])[0] || variant.label,
        body:    variant.body || "",
      });
      const sentAt = Date.now();
      setSequenceSent(prev => ({
        ...prev,
        [variant.label]: { ...result, sentAt },
      }));
      markContacted(contactEmail, company);
      // FF-20: sync to localStorage sequence record
      if (activeSeqId) {
        try {
          const seqs = loadSequences();
          const stored = seqs[activeSeqId];
          if (stored) {
            const s = stored.steps.find(s => s.label === variant.label);
            if (s) { s.sentAt = sentAt; s.threadId = result.thread_id || null; }
            stored.status = stored.steps.every(s => s.sentAt) ? "complete" : "active";
            stored.lastActivity = Date.now();
            saveSequences(seqs);
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSendingStep(null);
    }
  };

  const handleCheckReplies = async () => {
    const sentEntries = Object.entries(sequenceSent).filter(([, v]) => v.thread_id);
    if (!sentEntries.length) return;
    setCheckingReplies(true);
    const newStatus = {};
    const newDetails = {};
    let gotReply = false;
    for (const [label, sent] of sentEntries) {
      try {
        const detail = await invoke("gmail_check_reply_detail", { threadId: sent.thread_id });
        newStatus[label] = detail.has_reply;
        if (detail.has_reply) {
          newDetails[label] = detail;
          gotReply = true;
        }
      } catch { /* non-fatal */ }
    }
    setReplyStatus(prev => ({ ...prev, ...newStatus }));
    setReplyDetails(prev => ({ ...prev, ...newDetails }));
    if (gotReply) {
      setPaused(true);
      // FF-20: sync reply status to localStorage sequence record
      if (activeSeqId) {
        try {
          const seqs = loadSequences();
          const stored = seqs[activeSeqId];
          if (stored) {
            stored.replyDetails = { ...(stored.replyDetails || {}), ...newDetails };
            stored.status = "replied";
            stored.lastActivity = Date.now();
            saveSequences(seqs);
          }
        } catch { /* non-fatal */ }
      }
    }
    setCheckingReplies(false);
  };

  const handleGenerate = async () => {
    if (!company.trim() && !intelCtx.trim()) return;
    setGenerating(true);
    setError(null);
    setEditedVariants([]);
    setSignals(null);
    setScores([]);
    setScoringInProgress(false);
    setStStates({});
    // Reset sequence tracking on regenerate
    setSequenceDrafts([]);
    setSequenceSent({});
    setReplyStatus({});
    setReplyDetails({});
    setSchedules({});
    setPaused(false);
    setSeqPreview(null);
    setActiveSeqId(null);
    autoCheckedRef.current = false;

    const context = [
      contactName  && `Contact: ${contactName}`,
      contactTitle && `Title: ${contactTitle}`,
      company      && `Company: ${company}`,
      intelCtx     && `\n\nIntel Context:\n${intelCtx.slice(0, 4000)}`,
    ].filter(Boolean).join("\n");

    try {
      // Phase 1: Haiku extracts Three-Signal data
      setSt("haiku", "active");
      const sigRaw = await chat(HAIKU,
        "You extract B2B outreach signals from sales intelligence. Return ONLY valid JSON — no preamble, no code fences.",
        `From the contact and intel data below, identify the three types of fit signals for a cold email:

1. Structural fit: why this person's title/role is a clear ICP match
2. Situational fit: current buying triggers (hiring, funding, product changes, pain points)
3. Psychological fit: personal/professional signals that make them uniquely receptive (open source, blog, talks, projects)

Return JSON:
{
  "structural": "one sentence",
  "situational": "one sentence",
  "psychological": "one sentence or null",
  "companyPain": "sharpest pain point in one sentence",
  "contactName": "name or Unknown",
  "contactTitle": "title or Unknown",
  "company": "company name"
}

DATA:
${context}`, 1024);
      const sigs = parseJson(sigRaw);
      setSignals(sigs);
      setSt("haiku", "done");

      const dName = sigs.contactName || contactName || "prospect";
      const dTitle = sigs.contactTitle || contactTitle || "decision maker";
      const dCo = sigs.company || company;

      // Phase 2: Sonnet — branches on mode
      setSt("sonnet", "active");
      const toneDesc = tone === "direct"  ? "direct and blunt — get to the point in 2 sentences, no fluff"
                     : tone === "formal"  ? "professional and formal — polished business language"
                     :                     "conversational but professional — warm and approachable";

      if (mode === "sequence") {
        // ── 4-step cadence ────────────────────────────────────────────────────
        const seqRaw = await chat(SONNET,
          "You are a B2B outreach strategist. Return ONLY valid JSON — no preamble, no code fences.",
          `Create a 4-email cold outreach sequence for ${dName} (${dTitle}) at ${dCo}. Tone: ${toneDesc}. Max 100 words per email. Each email builds on the previous.

Signals:
- Structural: ${sigs.structural}
- Situational: ${sigs.situational}
- Psychological: ${sigs.psychological || "N/A"}
- Pain: ${sigs.companyPain}

Email 1 (Day 1): First touch — lead with strongest signal, introduce yourself, single soft CTA
Email 2 (Day 3): Value-add — share a relevant insight or resource, no hard ask
Email 3 (Day 7): Social proof — brief case study or result, soft ask
Email 4 (Day 14): Breakup — respectful, assume they're busy not uninterested, leave door open

Return JSON:
{
  "sequence": [
    { "label": "Day 1",  "subject": "...", "body": "..." },
    { "label": "Day 3",  "subject": "...", "body": "..." },
    { "label": "Day 7",  "subject": "...", "body": "..." },
    { "label": "Day 14", "subject": "...", "body": "..." }
  ]
}`, 2048);
        const { sequence: seq = [] } = parseJson(seqRaw);
        const variants = seq.map(s => ({ label: s.label, subjects: [s.subject || ""], body: s.body || "" }));
        setEditedVariants(variants);
        setSt("sonnet", "done");
        setActiveIdx(0);
        const entry = { id: Date.now(), company: dCo, contactName: dName, tone, mode, variants, signals: sigs, ts: Date.now() };
        setHistory(prev => { const u = [entry, ...prev].slice(0, 25); localStorage.setItem("ff_outreach_history", JSON.stringify(u)); return u; });

      } else {
        // ── 3 variants + LinkedIn ─────────────────────────────────────────────
        const varRaw = await chat(SONNET,
          "You are an elite B2B cold email copywriter. Return ONLY valid JSON — no preamble, no code fences.",
          `Write 3 cold email variants + 1 LinkedIn message. Tone: ${toneDesc}.
Email max 120 words. Subject lines ≤7 words. No "Hope this finds you well."
LinkedIn: 150-word max, connection-request register, no subject line, warm and specific.

Contact: ${dName} (${dTitle}) at ${dCo}
Signals:
- Structural: ${sigs.structural}
- Situational: ${sigs.situational}
- Psychological: ${sigs.psychological || "N/A — use strongest available signal"}
- Pain: ${sigs.companyPain}

Variant 1 (Role-led): Lead with structural fit
Variant 2 (Trigger-led): Lead with situational fit
Variant 3 (Personal-led): Lead with psychological fit or strongest angle

Return JSON:
{
  "variants": [
    { "label": "Role-led",     "subjects": ["subject 1", "subject 2"], "body": "..." },
    { "label": "Trigger-led",  "subjects": ["subject 1", "subject 2"], "body": "..." },
    { "label": "Personal-led", "subjects": ["subject 1", "subject 2"], "body": "..." }
  ],
  "linkedin": "LinkedIn message text"
}`, 2048);

        const { variants: v = [], linkedin = "" } = parseJson(varRaw);
        const allVariants = [
          ...v.map(x => ({ ...x, subjects: [...(x.subjects || [])] })),
          { label: "LinkedIn", subjects: [], body: linkedin },
        ];
        setEditedVariants(allVariants);
        setSt("sonnet", "done");
        setActiveIdx(0);

        // Phase 3: Haiku scores the 3 email variants (not LinkedIn)
        if (v.length > 0) {
          setScoringInProgress(true);
          setSt("haiku2", "active");
          try {
            const scoreRaw = await chat(HAIKU,
              "You score B2B emails on personalization. Return ONLY valid JSON — no preamble, no code fences.",
              `Score each email variant 1–10 on personalization depth.
10 = uses specific named details (company, exact trigger, personal reference).
1 = generic template with no real personalization.

Signals available: ${JSON.stringify({ structural: sigs.structural, situational: sigs.situational, psychological: sigs.psychological, pain: sigs.companyPain })}

${v.map((vv, i) => `Variant ${i + 1}:\n${vv.body}`).join("\n\n")}

Return JSON array of integers only: [score1, score2, score3]`, 256);
            const parsed = parseJson(scoreRaw);
            const arr = Array.isArray(parsed) ? parsed : (parsed.scores || []);
            setScores(arr.slice(0, v.length).map(s => typeof s === "number" ? s : null));
          } catch { /* non-fatal */ }
          setSt("haiku2", "done");
          setScoringInProgress(false);
        }

        const entry = { id: Date.now(), company: dCo, contactName: dName, tone, mode, variants: allVariants, signals: sigs, ts: Date.now() };
        setHistory(prev => { const u = [entry, ...prev].slice(0, 25); localStorage.setItem("ff_outreach_history", JSON.stringify(u)); return u; });
      }

    } catch (e) {
      setError(String(e));
      setStStates(s => { const u = { ...s }; Object.keys(u).forEach(k => { if (u[k] === "active") u[k] = "error"; }); return u; });
    } finally {
      setGenerating(false);
      setScoringInProgress(false);
    }
  };

  const canGenerate = (company.trim() || intelCtx.trim()) && !generating;
  const activeStages = mode === "sequence" ? OUTREACH_STAGES.slice(0, 2) : OUTREACH_STAGES;
  const showPipeline = generating || editedVariants.length > 0 || !!error;
  const scoreColor = (s) => s >= 8 ? c.green : s >= 5 ? c.amber : c.red;

  return (
    <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

      {/* Left panel */}
      <div style={{ width:320, flexShrink:0, borderRight:`1px solid ${c.border}`, display:"flex", flexDirection:"column", background:c.surface }}>

        {/* Bridge banner */}
        {outreachBridge && (
          <div style={{ padding:"10px 16px", background:c.accentGlow, borderBottom:`1px solid ${c.accentDim}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
            <span style={{ fontSize:12, color:c.accent }}>
              Context from Intel run for <strong>{outreachBridge.company}</strong>
            </span>
            <button
              onClick={() => { onClearBridge(); setContactName(""); setContactTitle(""); setContactEmail(""); setCompany(""); setIntelCtx(""); }}
              style={{ fontSize:12, color:c.accent, background:"none", border:"none", padding:"0 4px", cursor:"pointer", lineHeight:1 }}>
              ×
            </button>
          </div>
        )}

        <div style={{ flex:1, overflow:"auto", padding:20 }}>
          {/* Contact fields */}
          <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Contact</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
            <input type="text" value={contactName} onChange={e => setContactName(e.target.value)}
              placeholder="Name (e.g. Jane Smith)"
              style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none" }} />
            <input type="text" value={contactTitle} onChange={e => setContactTitle(e.target.value)}
              placeholder="Title (e.g. CTO)"
              style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none" }} />
            <input type="text" value={company} onChange={e => setCompany(e.target.value)}
              placeholder="Company (required)"
              style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none" }} />
            <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
              placeholder="Email (optional — enables Send buttons)"
              style={{ width:"100%", padding:"8px 10px", background:c.bg, border:`1px solid ${contactEmail ? c.green + "66" : c.border}`, borderRadius:8, color:c.text, fontSize:12, outline:"none", fontFamily:"monospace" }} />
          </div>

          {/* Intel context */}
          <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Intel Context</div>
          <textarea
            value={intelCtx}
            onChange={e => setIntelCtx(e.target.value)}
            placeholder={"Paste intel pack, notes, or context.\n\nInclude: pain points, hiring signals, recent news, tech stack, blog posts…"}
            rows={8}
            style={{ width:"100%", padding:"10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:10, color:c.text, fontSize:12, fontFamily:"monospace", lineHeight:1.5, outline:"none", resize:"none" }}
          />

          {/* Tone selector */}
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Tone</div>
            <div style={{ display:"flex", gap:4, background:c.bg, borderRadius:8, padding:3, border:`1px solid ${c.border}` }}>
              {["direct","balanced","formal"].map(t => (
                <button key={t} onClick={() => setTone(t)}
                  style={{ flex:1, padding:"5px 0", borderRadius:6, border:"none", fontSize:11, fontWeight:600, background: tone === t ? c.accent : "transparent", color: tone === t ? "#fff" : c.textSub, transition:"all 0.15s", textTransform:"capitalize" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Output mode toggle */}
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Output Mode</div>
            <div style={{ display:"flex", gap:4, background:c.bg, borderRadius:8, padding:3, border:`1px solid ${c.border}` }}>
              {[["variants","3 Variants"],["sequence","4-Step Sequence"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setMode(val)}
                  style={{ flex:1, padding:"5px 0", borderRadius:6, border:"none", fontSize:11, fontWeight:600, background: mode === val ? c.accent : "transparent", color: mode === val ? "#fff" : c.textSub, transition:"all 0.15s" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* FF-21: Templates picker */}
          {tplList.length > 0 && (
            <div style={{ marginTop:12 }}>
              <button
                onClick={() => { setShowTplPicker(v => !v); setTplList(Object.values(loadTemplates())); }}
                style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
                <span>★ Load Template</span>
                <span style={{ opacity:0.5 }}>{showTplPicker ? "▲" : "▼"}</span>
              </button>
              {showTplPicker && (
                <div style={{ marginTop:4, border:`1px solid ${c.border}`, borderRadius:8, overflow:"hidden", background:c.bg }}>
                  {tplList.length === 0 ? (
                    <div style={{ padding:"10px 12px", fontSize:11, color:c.textMuted }}>No saved templates yet.</div>
                  ) : tplList.sort((a,b) => (b.savedAt||0) - (a.savedAt||0)).map(tpl => (
                    <div key={tpl.id} style={{ padding:"8px 12px", borderBottom:`1px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:c.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tpl.name}</div>
                        <div style={{ fontSize:10, color:c.textMuted }}>{tpl.label} · used {tpl.useCount||0}×</div>
                      </div>
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        <button
                          onClick={() => {
                            // Pre-fill intelCtx with a note about the template; real body comes after generate
                            if (tpl.body) setIntelCtx(prev => prev ? prev : `[Template: ${tpl.name}]\n${tpl.body}`);
                            incrementTemplateUse(tpl.id);
                            setTplList(Object.values(loadTemplates()));
                            setShowTplPicker(false);
                          }}
                          style={{ padding:"4px 8px", borderRadius:6, border:"none", background:c.accent, color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                          Use
                        </button>
                        <button
                          onClick={() => { deleteTemplate(tpl.id); setTplList(Object.values(loadTemplates())); }}
                          style={{ padding:"4px 6px", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textMuted, fontSize:10, cursor:"pointer" }}
                          title="Delete template">
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={handleGenerate} disabled={!canGenerate}
            style={{ marginTop:16, width:"100%", padding:"12px 0", borderRadius:10, border:"none", background:c.accent, color:"#fff", fontSize:14, fontWeight:700, opacity: canGenerate ? 1 : 0.45, transition:"opacity 0.15s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {generating ? (
              <><div style={{ width:14, height:14, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Generating…</>
            ) : "Generate Emails"}
          </button>

          {error && (
            <div style={{ marginTop:12, padding:"10px 12px", background:c.redDim, border:`1px solid ${c.red}44`, borderRadius:10, fontSize:12, color:c.red }}>
              <strong>Error:</strong> {error}
              <button onClick={handleGenerate} style={{ display:"block", marginTop:6, fontSize:12, color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer" }}>Try again →</button>
            </div>
          )}

          {/* Pipeline steps */}
          {showPipeline && (
            <div style={{ marginTop:20, borderTop:`1px solid ${c.border}`, paddingTop:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>Pipeline</div>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {OUTREACH_STAGES.map(stage => (
                  <PipelineStep key={stage.id} stage={stage} status={stStates[stage.id] || "pending"} c={c} />
                ))}
              </div>
            </div>
          )}

          {/* Extracted signals */}
          {signals && (
            <div style={{ marginTop:16, padding:"12px 14px", background:c.card, border:`1px solid ${c.border}`, borderRadius:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:10 }}>Extracted Signals</div>
              {[["Structural", signals.structural], ["Situational", signals.situational], ["Psychological", signals.psychological], ["Pain", signals.companyPain]].filter(([, v]) => v).map(([label, val]) => (
                <div key={label} style={{ marginBottom:8 }}>
                  <div style={{ fontSize:9, fontWeight:700, color:c.accent, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:11, color:c.textSub, lineHeight:1.4 }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div style={{ marginTop:16, borderTop:`1px solid ${c.border}`, paddingTop:14 }}>
              <button onClick={() => setHistoryOpen(o => !o)}
                style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", background:"none", border:"none", padding:0, cursor:"pointer", marginBottom:8 }}>
                <span>{historyOpen ? "▼" : "▶"}</span>
                History
                <span style={{ fontSize:10, padding:"1px 5px", borderRadius:3, background:c.card, color:c.textMuted, border:`1px solid ${c.border}` }}>{history.length}</span>
              </button>
              {historyOpen && (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {history.slice(0, 10).map(h => (
                    <button key={h.id}
                      onClick={() => {
                        setCompany(h.company);
                        setContactName(h.contactName);
                        setTone(h.tone);
                        setEditedVariants(h.variants.map(x => ({ ...x, subjects: [...(x.subjects || [])] })));
                        setSignals(h.signals);
                        setActiveIdx(0);
                        setStStates({ haiku: "done", sonnet: "done" });
                      }}
                      style={{ textAlign:"left", padding:"8px 10px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, cursor:"pointer" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = c.borderLight}
                      onMouseLeave={e => e.currentTarget.style.borderColor = c.border}>
                      <div style={{ fontSize:12, fontWeight:600, color:c.text, marginBottom:2 }}>{h.company}</div>
                      <div style={{ fontSize:10, color:c.textMuted }}>{h.contactName} · {h.tone} · {new Date(h.ts).toLocaleDateString("en-US", { month:"short", day:"numeric" })}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: email variants */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {editedVariants.length === 0 ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:c.textMuted, textAlign:"center", padding:40 }}>
            <div style={{ fontSize:40, marginBottom:16, opacity:0.15 }}>✉</div>
            <div style={{ fontSize:16, fontWeight:600, color:c.textSub, marginBottom:8 }}>Three-Signal Email Drafts</div>
            <div style={{ fontSize:13, color:c.textMuted, maxWidth:380, lineHeight:1.7 }}>
              Add a company and intel context, then click <strong style={{ color:c.textSub }}>Generate Emails</strong>.<br/><br/>
              Use <strong style={{ color:c.textSub }}>3 Variants</strong> to choose the best single email, or <strong style={{ color:c.textSub }}>4-Step Sequence</strong> for a full cadence over 2 weeks.
            </div>
          </div>
        ) : (
          <>
            {/* Variant tabs — with score badges + Sharpen */}
            <div style={{ display:"flex", borderBottom:`1px solid ${c.border}`, background:c.surface, flexShrink:0, alignItems:"center" }}>
              {editedVariants.map((v, i) => {
                const score = (mode === "variants" && i < scores.length) ? scores[i] : null;
                const isLinkedIn = v.label === "LinkedIn";
                return (
                  <button key={i} onClick={() => setActiveIdx(i)}
                    style={{ padding:"10px 16px", border:"none", borderBottom:`2px solid ${activeIdx === i ? c.accent : "transparent"}`, background:"transparent", color: activeIdx === i ? c.accent : c.textSub, fontSize:12, fontWeight: activeIdx === i ? 700 : 500, cursor:"pointer", transition:"all 0.15s", display:"flex", alignItems:"center", gap:5 }}>
                    {v.label}
                    {score !== null && (
                      <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:`${scoreColor(score)}22`, color:scoreColor(score), fontWeight:700, border:`1px solid ${scoreColor(score)}44` }}>
                        {score}
                      </span>
                    )}
                    {mode === "variants" && scoringInProgress && !isLinkedIn && i < 3 && score === null && (
                      <span style={{ fontSize:9, color:c.textMuted }}>…</span>
                    )}
                  </button>
                );
              })}
              <div style={{ flex:1 }} />
              {/* Sharpen — variants mode only, not LinkedIn */}
              {mode === "variants" && editedVariants[activeIdx]?.label !== "LinkedIn" && (
                <button
                  onClick={() => handleSharpen(activeIdx)}
                  disabled={sharpeningIdx !== null || generating}
                  style={{ padding:"5px 12px", borderRadius:7, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, fontWeight:600, opacity:(sharpeningIdx !== null || generating) ? 0.5 : 1 }}>
                  {sharpeningIdx === activeIdx ? "…" : "Sharpen ↑"}
                </button>
              )}
              <button onClick={handleGenerate} disabled={generating}
                style={{ margin:"8px 12px", padding:"5px 12px", borderRadius:7, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, fontWeight:600, opacity: generating ? 0.5 : 1 }}>
                ↺ Regenerate
              </button>
            </div>

            {/* Active variant */}
            {editedVariants[activeIdx] && (
              <div style={{ flex:1, overflow:"auto", padding:24 }}>
                <VariantCard
                  variant={editedVariants[activeIdx]}
                  spamHits={scanSpam(editedVariants[activeIdx].body || "")}
                  contactEmail={contactEmail}
                  contactCompany={company}
                  gmailConnected={gmailConnected}
                  onSent={result => {
                    if (mode === "sequence") {
                      setSequenceSent(prev => ({ ...prev, [editedVariants[activeIdx].label]: { ...result, sentAt: Date.now() } }));
                    }
                  }}
                  onChange={(field, val) => setEditedVariants(prev => prev.map((v, i) => i === activeIdx ? { ...v, [field]: val } : v))}
                  c={c}
                />
              </div>
            )}

            {/* ── Sequence Tracker panel (sequence mode + Gmail connected) ── */}
            {mode === "sequence" && editedVariants.length > 0 && gmailConnected && (
              <div style={{ flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.surface, padding:"14px 20px" }}>
                {sequenceDrafts.length === 0 ? (
                  /* Not yet saved */
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:c.text }}>Gmail Sequence</div>
                      <div style={{ fontSize:11, color:c.textMuted, marginTop:2 }}>
                        Save all {editedVariants.filter(v => v.label !== "LinkedIn").length} emails as Gmail drafts in one click
                        {contactEmail ? ` → ${contactEmail}` : " (add email to pre-fill To:)"}
                      </div>
                    </div>
                    <button onClick={handleSaveSequenceDrafts} disabled={savingDrafts || generating}
                      style={{ flexShrink:0, padding:"8px 18px", borderRadius:8, border:"none", background:c.accent, color:"#fff", fontSize:12, fontWeight:700, opacity:(savingDrafts||generating) ? 0.5 : 1, display:"flex", alignItems:"center", gap:6 }}>
                      {savingDrafts ? (
                        <><div style={{ width:11, height:11, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Saving…</>
                      ) : "Save All to Gmail Drafts"}
                    </button>
                  </div>
                ) : (
                  /* Drafts saved — show step-by-step tracker */
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:c.text, display:"flex", alignItems:"center", gap:8 }}>
                        Sequence Drafts
                        <span style={{ fontSize:11, fontWeight:400, color:c.textMuted }}>
                          {Object.keys(sequenceSent).length}/{sequenceDrafts.length} sent
                        </span>
                        {/* FF-16: paused badge */}
                        {paused && (
                          <span style={{ fontSize:10, padding:"2px 8px", borderRadius:10, background:`${c.amber}22`, color:c.amber, fontWeight:700, border:`1px solid ${c.amber}44` }}>
                            ⏸ Paused — got a reply
                          </span>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        {/* FF-16: Resume button */}
                        {paused && (
                          <button onClick={() => setPaused(false)}
                            style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:`1px solid ${c.amber}44`, background:`${c.amber}11`, color:c.amber }}>
                            ▶ Resume
                          </button>
                        )}
                        {Object.values(sequenceSent).some(s => s.thread_id) && (
                          <button onClick={handleCheckReplies} disabled={checkingReplies}
                            style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, opacity: checkingReplies ? 0.5 : 1 }}>
                            {checkingReplies ? "Checking…" : "↻ Check Replies"}
                          </button>
                        )}
                        <button onClick={() => { setSequenceDrafts([]); setSequenceSent({}); setReplyStatus({}); setReplyDetails({}); setSchedules({}); setPaused(false); }}
                          style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textMuted }}>
                          Reset
                        </button>
                      </div>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                      {sequenceDrafts.map(d => {
                        const sent = sequenceSent[d.step];
                        const hasReply = replyStatus[d.step];
                        const detail = replyDetails[d.step];
                        const isUnsub = detail?.is_unsubscribe;
                        const stepVariant = editedVariants.find(v => v.label === d.step);
                        const isBeingSent = sendingStep === d.step;
                        const scheduled = schedules[d.step];
                        return (
                          <div key={d.step} style={{ padding:"10px 12px", borderRadius:10,
                            border:`1px solid ${isUnsub ? c.red + "44" : sent ? c.green + "44" : c.border}`,
                            background: isUnsub ? c.redDim : sent ? c.greenDim : c.bg }}>
                            <div style={{ fontSize:11, fontWeight:700, color: isUnsub ? c.red : sent ? c.green : c.text, marginBottom:5 }}>
                              {d.step}
                              {isUnsub && <span style={{ marginLeft:6, fontSize:9, padding:"1px 5px", borderRadius:3, background:`${c.red}22`, color:c.red, fontWeight:700 }}>⛔ Unsub</span>}
                              {hasReply && !isUnsub && <span style={{ marginLeft:6, fontSize:9, padding:"1px 5px", borderRadius:3, background:`${c.accent}22`, color:c.accent, fontWeight:700 }}>↩ Reply</span>}
                            </div>
                            {sent ? (
                              <div style={{ fontSize:10, color: isUnsub ? c.red : c.green }}>
                                ✓ Sent {formatRelativeTime(sent.sentAt)}
                                {hasReply && !isUnsub && <div style={{ color:c.accent, marginTop:2 }}>Got a reply!</div>}
                                {isUnsub && <div style={{ marginTop:2 }}>Unsubscribe request</div>}
                              </div>
                            ) : (
                              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                <button onClick={() => invoke("open_url", { url: d.gmail_url })}
                                  style={{ width:"100%", padding:"5px 0", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:10, fontWeight:600 }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor = c.accent; e.currentTarget.style.color = c.accent; }}
                                  onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSub; }}>
                                  Open Draft →
                                </button>
                                {/* FF-18: Send Now opens preview modal */}
                                {contactEmail && stepVariant && (
                                  <button onClick={() => setSeqPreview({ step: d.step, variant: stepVariant })}
                                    disabled={isBeingSent || generating || paused}
                                    style={{ width:"100%", padding:"5px 0", borderRadius:6, border:"none", background: paused ? c.textMuted : c.accent, color:"#fff", fontSize:10, fontWeight:700, opacity:(isBeingSent||generating||paused) ? 0.5 : 1 }}
                                    title={paused ? "Resume sequence to send" : ""}>
                                    {isBeingSent ? "Sending…" : "Send Now"}
                                  </button>
                                )}
                                {/* FF-15: Schedule picker */}
                                <input type="datetime-local"
                                  value={scheduled || ""}
                                  onChange={e => setSchedules(prev => ({ ...prev, [d.step]: e.target.value }))}
                                  style={{ width:"100%", fontSize:9, padding:"3px 4px", borderRadius:5, border:`1px solid ${scheduled ? c.accent + "88" : c.border}`, background: scheduled ? `${c.accent}11` : c.surface, color: scheduled ? c.accent : c.textMuted, boxSizing:"border-box" }}
                                  title="Schedule auto-send for this step" />
                                {scheduled && (
                                  <div style={{ fontSize:9, color:c.accent, textAlign:"center" }}>
                                    ⏰ Scheduled {new Date(scheduled).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* FF-16: Reply detail strip */}
                    {Object.entries(replyDetails).length > 0 && (
                      <div style={{ marginTop:8, padding:"8px 10px", background:c.bg, borderRadius:8, border:`1px solid ${c.border}` }}>
                        {Object.entries(replyDetails).map(([step, detail]) => (
                          <div key={step} style={{ fontSize:11, color:c.textSub }}>
                            <strong style={{ color: detail.is_unsubscribe ? c.red : c.accent }}>{step}</strong>
                            {" — "}{detail.reply_subject ? `"${detail.reply_subject.slice(0, 60)}"` : "Reply received"}
                            {detail.is_unsubscribe && <span style={{ marginLeft:4, color:c.red }}>· Unsubscribe request</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Prompt to connect Gmail (sequence mode, not connected) */}
            {mode === "sequence" && editedVariants.length > 0 && !gmailConnected && (
              <div style={{ flexShrink:0, borderTop:`1px solid ${c.border}`, background:c.surface, padding:"12px 20px", display:"flex", alignItems:"center", gap:10 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill={c.textMuted}><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.910 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>
                <span style={{ fontSize:12, color:c.textMuted }}>
                  Connect Gmail in{" "}
                  <button onClick={onOpenSettings} style={{ color:c.accent, background:"none", border:"none", padding:0, cursor:"pointer", fontSize:12, textDecoration:"underline" }}>Settings</button>
                  {" "}to save this sequence as Gmail drafts and track replies
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* FF-18: Sequence step send preview modal */}
      {seqPreview && (
        <SendPreviewModal
          to={contactEmail}
          subject={(seqPreview.variant.subjects || [])[0] || seqPreview.variant.label || ""}
          body={seqPreview.variant.body || ""}
          onConfirm={() => handleSendSequenceStep(seqPreview.variant)}
          onCancel={() => setSeqPreview(null)}
          c={c}
        />
      )}
    </div>
  );
}

// ─── Pipeline Tab (FF-19) ────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { id: "identified", label: "Identified", color: "#7a8fa6" },
  { id: "contacted",  label: "Contacted",  color: "#2d7ef7" },
  { id: "replied",    label: "Replied",    color: "#f59e0b" },
  { id: "meeting",    label: "Meeting",    color: "#22c55e" },
  { id: "closed",     label: "Closed",     color: "#22c55e" },
];

function PipelineTabView({ c, onDraftOutreach }) {
  const [pipeline, setPipeline] = useState(() => loadPipeline());
  const [expandedId, setExpandedId] = useState(null);
  const [draftNotes, setDraftNotes] = useState({});
  const [importedOnce] = useState(() => {
    if (localStorage.getItem("ff_pipeline_imported_v1")) return true;
    // Auto-import from ff_contacted on first mount
    const contacted = loadContacted();
    const existing  = loadPipeline();
    let changed = false;
    for (const [email, info] of Object.entries(contacted)) {
      const alreadyIn = Object.values(existing).some(card => card.email === email);
      if (!alreadyIn) {
        const id = `pc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        existing[id] = {
          id, name: info.company ? `${email.split("@")[0]}` : email.split("@")[0],
          email, company: info.company || "", title: "",
          stage: "contacted", notes: "",
          addedAt: info.contactedAt || Date.now(), lastActivity: info.contactedAt || Date.now(),
        };
        changed = true;
      }
    }
    if (changed) { savePipeline(existing); }
    localStorage.setItem("ff_pipeline_imported_v1", "1");
    return true;
  });

  const cards = Object.values(pipeline).sort((a, b) => b.lastActivity - a.lastActivity);

  const moveCard = (id, newStage) => {
    setPipeline(prev => {
      const updated = { ...prev, [id]: { ...prev[id], stage: newStage, lastActivity: Date.now() } };
      savePipeline(updated);
      return updated;
    });
  };

  const saveNotes = (id) => {
    const notes = draftNotes[id] ?? pipeline[id]?.notes ?? "";
    setPipeline(prev => {
      const updated = { ...prev, [id]: { ...prev[id], notes, lastActivity: Date.now() } };
      savePipeline(updated);
      return updated;
    });
  };

  const removeCard = (id) => {
    deletePipelineCard(id);
    setPipeline(prev => { const u = { ...prev }; delete u[id]; return u; });
    if (expandedId === id) setExpandedId(null);
  };

  const totalContacted = cards.filter(c => c.stage !== "identified").length;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Stats bar */}
      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${c.border}`, flexShrink:0, background:c.surface }}>
        {PIPELINE_STAGES.map((s, i) => {
          const count = cards.filter(card => card.stage === s.id).length;
          return (
            <div key={s.id} style={{ flex:1, padding:"14px 0", textAlign:"center", borderRight: i < PIPELINE_STAGES.length - 1 ? `1px solid ${c.border}` : "none" }}>
              <div style={{ fontSize:22, fontWeight:800, color: count > 0 ? s.color : c.textMuted }}>{count}</div>
              <div style={{ fontSize:11, fontWeight:600, color:c.textSub, marginTop:2 }}>{s.label}</div>
            </div>
          );
        })}
        <div style={{ flex:1, padding:"14px 0", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:c.text }}>{cards.length}</div>
          <div style={{ fontSize:11, fontWeight:600, color:c.textSub, marginTop:2 }}>Total</div>
        </div>
      </div>

      {/* Kanban board */}
      {cards.length === 0 ? (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, color:c.textMuted }}>
          <div style={{ fontSize:36 }}>◎</div>
          <div style={{ fontSize:15, fontWeight:600, color:c.textSub }}>No prospects yet</div>
          <div style={{ fontSize:13, color:c.textMuted, maxWidth:300, textAlign:"center" }}>
            Click "+ Pipeline" on any contact card in Intel view to add them here.
          </div>
        </div>
      ) : (
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          {PIPELINE_STAGES.map(stage => {
            const stagecards = cards.filter(card => card.stage === stage.id);
            return (
              <div key={stage.id} style={{ flex:1, display:"flex", flexDirection:"column", borderRight:`1px solid ${c.border}`, overflow:"hidden" }}>
                {/* Column header */}
                <div style={{ padding:"10px 14px", borderBottom:`1px solid ${c.border}`, display:"flex", alignItems:"center", gap:8, flexShrink:0, background:c.surface }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:stage.color, flexShrink:0 }} />
                  <span style={{ fontSize:12, fontWeight:700, color:c.text }}>{stage.label}</span>
                  <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:10, background:`${stage.color}22`, color:stage.color }}>{stagecards.length}</span>
                </div>

                {/* Cards */}
                <div style={{ flex:1, overflowY:"auto", padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
                  {stagecards.map(card => {
                    const isExpanded = expandedId === card.id;
                    const contactedInfo = getContactedInfo(card.email);
                    return (
                      <div key={card.id} style={{ borderRadius:10, border:`1px solid ${isExpanded ? stage.color + "88" : c.border}`, background: isExpanded ? c.card : c.bg, transition:"border-color 0.15s" }}>
                        {/* Collapsed row */}
                        <div onClick={() => setExpandedId(isExpanded ? null : card.id)}
                          style={{ padding:"10px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:30, height:30, borderRadius:"50%", background:`${stage.color}22`, color:stage.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>
                            {(card.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:700, color:c.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{card.name || card.email}</div>
                            <div style={{ fontSize:11, color:c.textSub, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{card.company}</div>
                          </div>
                          <span style={{ fontSize:9, color:c.textMuted, flexShrink:0 }}>{isExpanded ? "▲" : "▼"}</span>
                        </div>

                        {/* Expanded panel */}
                        {isExpanded && (
                          <div style={{ borderTop:`1px solid ${c.border}`, padding:"12px 12px" }}>
                            {card.title && <div style={{ fontSize:11, color:c.textSub, marginBottom:8 }}>{card.title}</div>}
                            {card.email && (
                              <div style={{ fontSize:11, fontFamily:"monospace", color:c.textSub, marginBottom:8 }}>{card.email}
                                {contactedInfo && <span style={{ marginLeft:6, color:c.green, fontSize:10 }}>· Contacted {formatRelativeTime(contactedInfo.contactedAt)}</span>}
                              </div>
                            )}

                            {/* Stage selector */}
                            <div style={{ marginBottom:10 }}>
                              <div style={{ fontSize:10, fontWeight:700, color:c.textMuted, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" }}>Move to stage</div>
                              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                                {PIPELINE_STAGES.map(s => (
                                  <button key={s.id} onClick={() => moveCard(card.id, s.id)}
                                    style={{ padding:"3px 8px", borderRadius:5, border:`1px solid ${card.stage === s.id ? s.color : c.border}`, background: card.stage === s.id ? `${s.color}22` : "transparent", color: card.stage === s.id ? s.color : c.textMuted, fontSize:10, fontWeight:600, cursor:"pointer" }}>
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Notes */}
                            <textarea
                              value={draftNotes[card.id] ?? card.notes ?? ""}
                              onChange={e => setDraftNotes(prev => ({ ...prev, [card.id]: e.target.value }))}
                              onBlur={() => saveNotes(card.id)}
                              placeholder="Add notes…"
                              rows={3}
                              style={{ width:"100%", padding:"7px 9px", background:c.bg, border:`1px solid ${c.border}`, borderRadius:7, color:c.text, fontSize:11, resize:"vertical", outline:"none", boxSizing:"border-box", fontFamily:"inherit" }}
                            />

                            {/* Actions */}
                            <div style={{ display:"flex", gap:6, marginTop:8 }}>
                              <button onClick={() => onDraftOutreach(card)}
                                style={{ flex:1, padding:"6px 0", borderRadius:7, border:`1px solid ${c.green}44`, background:`${c.green}11`, color:c.green, fontSize:11, fontWeight:600, cursor:"pointer" }}>
                                Draft Outreach →
                              </button>
                              <button onClick={() => removeCard(card.id)}
                                style={{ padding:"6px 10px", borderRadius:7, border:`1px solid ${c.red}44`, background:"transparent", color:c.red, fontSize:11, cursor:"pointer" }}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sequences Tab (FF-20) ───────────────────────────────────────────────────

const SEQ_STATUS_META = {
  active:   { label: "Active",   color: "#2d7ef7" },
  paused:   { label: "Paused",   color: "#f59e0b" },
  replied:  { label: "Replied",  color: "#22c55e" },
  complete: { label: "Complete", color: "#7a8fa6" },
};

function SequencesView({ c, gmailConnected, onOpenSettings }) {
  const [sequences, setSequences] = useState(() =>
    Object.values(loadSequences()).sort((a, b) => b.lastActivity - a.lastActivity)
  );
  const [expandedId,   setExpandedId]   = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkingAll,  setCheckingAll]  = useState(false);
  const [sendingStep,  setSendingStep]  = useState(null); // `${seqId}:${label}`
  const [error,        setError]        = useState(null);

  const refreshSeqs = () =>
    setSequences(Object.values(loadSequences()).sort((a, b) => b.lastActivity - a.lastActivity));

  const visible = statusFilter === "all"
    ? sequences
    : sequences.filter(s => s.status === statusFilter);

  const handleSendStep = async (seqId, step) => {
    const rec = sequences.find(s => s.id === seqId);
    if (!rec || !rec.contactEmail || !gmailConnected) return;
    setSendingStep(`${seqId}:${step.label}`);
    setError(null);
    try {
      const result = await invoke("gmail_send_message", {
        to: rec.contactEmail, subject: step.subject, body: step.body,
      });
      markContacted(rec.contactEmail, rec.company);
      const seqs = loadSequences();
      const stored = seqs[seqId];
      if (stored) {
        const s = stored.steps.find(s => s.label === step.label);
        if (s) { s.sentAt = Date.now(); s.threadId = result.thread_id || null; }
        const allSent = stored.steps.every(s => s.sentAt);
        stored.status = allSent ? "complete" : "active";
        stored.lastActivity = Date.now();
        saveSequences(seqs);
      }
      refreshSeqs();
    } catch (e) { setError(String(e)); }
    setSendingStep(null);
  };

  const handleCheckAllReplies = async () => {
    setCheckingAll(true);
    setError(null);
    const seqs = loadSequences();
    for (const rec of Object.values(seqs)) {
      if (rec.status !== "active" && rec.status !== "paused") continue;
      for (const step of rec.steps) {
        if (!step.threadId) continue;
        try {
          const detail = await invoke("gmail_check_reply_detail", { threadId: step.threadId });
          if (detail.has_reply) {
            rec.replyDetails = rec.replyDetails || {};
            rec.replyDetails[step.label] = detail;
            rec.status = "replied";
            rec.lastActivity = Date.now();
          }
        } catch { /* non-fatal per step */ }
      }
    }
    saveSequences(seqs);
    refreshSeqs();
    setCheckingAll(false);
  };

  const deleteSequence = (id) => {
    const seqs = loadSequences();
    delete seqs[id];
    saveSequences(seqs);
    refreshSeqs();
    if (expandedId === id) setExpandedId(null);
  };

  const activeCount = sequences.filter(s => s.status === "active").length;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"14px 20px", borderBottom:`1px solid ${c.border}`, background:c.surface, flexShrink:0, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:c.text }}>Active Sequences</div>
          <div style={{ fontSize:12, color:c.textMuted, marginTop:2 }}>{sequences.length} total · {activeCount} active</div>
        </div>
        {!gmailConnected && (
          <button onClick={onOpenSettings}
            style={{ padding:"7px 14px", borderRadius:8, border:`1px solid ${c.accent}`, background:"transparent", color:c.accent, fontSize:12, fontWeight:600 }}>
            Connect Gmail →
          </button>
        )}
        {sequences.some(s => s.status === "active" || s.status === "paused") && gmailConnected && (
          <button onClick={handleCheckAllReplies} disabled={checkingAll}
            style={{ padding:"7px 14px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:12, fontWeight:600, opacity: checkingAll ? 0.5 : 1 }}>
            {checkingAll ? "Checking…" : "↻ Check All Replies"}
          </button>
        )}
        {/* Status filter */}
        <div style={{ display:"flex", gap:3, background:c.bg, borderRadius:8, padding:3, border:`1px solid ${c.border}` }}>
          {[["all","All"], ["active","Active"], ["replied","Replied"], ["complete","Complete"]].map(([val, lbl]) => (
            <button key={val} onClick={() => setStatusFilter(val)}
              style={{ padding:"4px 10px", borderRadius:6, border:"none", fontSize:11, fontWeight:600, background: statusFilter === val ? c.accent : "transparent", color: statusFilter === val ? "#fff" : c.textSub, cursor:"pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding:"10px 20px", background:c.redDim, color:c.red, fontSize:12, borderBottom:`1px solid ${c.border}` }}>
          {error}
        </div>
      )}

      {/* List */}
      {sequences.length === 0 ? (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, color:c.textMuted }}>
          <div style={{ fontSize:36 }}>⟳</div>
          <div style={{ fontSize:15, fontWeight:600, color:c.textSub }}>No sequences saved yet</div>
          <div style={{ fontSize:13, color:c.textMuted, maxWidth:320, textAlign:"center" }}>
            Go to Outreach → Sequence mode → generate a 4-step cadence → Save All to Gmail Drafts. It'll appear here automatically.
          </div>
        </div>
      ) : (
        <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
          {visible.map(seq => {
            const isExpanded = expandedId === seq.id;
            const sentCount  = seq.steps.filter(s => s.sentAt).length;
            const meta       = SEQ_STATUS_META[seq.status] || SEQ_STATUS_META.active;
            const hasAnyThread = seq.steps.some(s => s.threadId);

            return (
              <div key={seq.id} style={{ border:`1px solid ${isExpanded ? c.borderLight : c.border}`, borderRadius:12, background: isExpanded ? c.card : c.bg, transition:"border-color 0.15s" }}>
                {/* Collapsed row */}
                <div onClick={() => setExpandedId(isExpanded ? null : seq.id)}
                  style={{ padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
                  {/* Avatar */}
                  <div style={{ width:36, height:36, borderRadius:"50%", background:c.accentDim, color:c.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, flexShrink:0 }}>
                    {(seq.contactName || seq.contactEmail || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:c.text }}>{seq.contactName || seq.contactEmail}</div>
                    <div style={{ fontSize:11, color:c.textSub, marginTop:2 }}>
                      {seq.company && <span>{seq.company} · </span>}
                      {seq.contactEmail}
                    </div>
                  </div>
                  {/* Progress + status */}
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                    {/* Step progress */}
                    <div style={{ display:"flex", gap:3 }}>
                      {seq.steps.map((step, i) => (
                        <div key={i} style={{ width:18, height:6, borderRadius:3, background: step.sentAt ? c.green : seq.replyDetails?.[step.label]?.has_reply ? c.accent : c.border }} title={step.label} />
                      ))}
                    </div>
                    <span style={{ fontSize:11, color:c.textMuted }}>{sentCount}/{seq.steps.length}</span>
                    {/* Status badge */}
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:10, background:`${meta.color}22`, color:meta.color, fontWeight:700, border:`1px solid ${meta.color}44` }}>
                      {meta.label}
                    </span>
                    {/* Reply badge */}
                    {Object.keys(seq.replyDetails || {}).length > 0 && (
                      <span style={{ fontSize:10, padding:"2px 8px", borderRadius:10, background:`${c.green}22`, color:c.green, fontWeight:700 }}>↩ Reply</span>
                    )}
                    <span style={{ fontSize:11, color:c.textMuted }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* Expanded: step tracker */}
                {isExpanded && (
                  <div style={{ borderTop:`1px solid ${c.border}`, padding:"12px 16px" }}>
                    {/* Reply details */}
                    {Object.entries(seq.replyDetails || {}).length > 0 && (
                      <div style={{ marginBottom:10, padding:"8px 10px", background:c.bg, borderRadius:8, border:`1px solid ${c.border}` }}>
                        {Object.entries(seq.replyDetails).map(([step, detail]) => (
                          <div key={step} style={{ fontSize:11, color:c.textSub }}>
                            <strong style={{ color: detail.is_unsubscribe ? c.red : c.accent }}>{step}</strong>
                            {" — "}{detail.reply_subject ? `"${detail.reply_subject.slice(0, 70)}"` : "Reply received"}
                            {detail.is_unsubscribe && <span style={{ marginLeft:4, color:c.red }}>· Unsubscribe</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 4-step grid */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
                      {seq.steps.map(step => {
                        const detail      = (seq.replyDetails || {})[step.label];
                        const isUnsub     = detail?.is_unsubscribe;
                        const isBeingSent = sendingStep === `${seq.id}:${step.label}`;
                        return (
                          <div key={step.label} style={{ padding:"10px 12px", borderRadius:10,
                            border:`1px solid ${isUnsub ? c.red+"44" : step.sentAt ? c.green+"44" : c.border}`,
                            background: isUnsub ? c.redDim : step.sentAt ? c.greenDim : c.surface }}>
                            <div style={{ fontSize:11, fontWeight:700, color: isUnsub ? c.red : step.sentAt ? c.green : c.text, marginBottom:5 }}>
                              {step.label}
                              {isUnsub && <span style={{ marginLeft:5, fontSize:9, padding:"1px 5px", borderRadius:3, background:`${c.red}22`, color:c.red }}>⛔</span>}
                              {detail?.has_reply && !isUnsub && <span style={{ marginLeft:5, fontSize:9, padding:"1px 5px", borderRadius:3, background:`${c.accent}22`, color:c.accent }}>↩</span>}
                            </div>
                            {step.sentAt ? (
                              <div style={{ fontSize:10, color: isUnsub ? c.red : c.green }}>
                                ✓ {formatRelativeTime(step.sentAt)}
                              </div>
                            ) : (
                              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                {step.gmailUrl && (
                                  <button onClick={() => invoke("open_url", { url: step.gmailUrl })}
                                    style={{ width:"100%", padding:"5px 0", borderRadius:6, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:10, fontWeight:600, cursor:"pointer" }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = c.accent; e.currentTarget.style.color = c.accent; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSub; }}>
                                    Open Draft →
                                  </button>
                                )}
                                {seq.contactEmail && gmailConnected && (
                                  <button onClick={() => handleSendStep(seq.id, step)} disabled={isBeingSent}
                                    style={{ width:"100%", padding:"5px 0", borderRadius:6, border:"none", background:c.accent, color:"#fff", fontSize:10, fontWeight:700, opacity: isBeingSent ? 0.5 : 1, cursor:"pointer" }}>
                                    {isBeingSent ? "Sending…" : "Send Now"}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Actions row */}
                    <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                      <div style={{ fontSize:11, color:c.textMuted, alignSelf:"center" }}>
                        Started {formatRelativeTime(seq.createdAt)}
                      </div>
                      <div style={{ flex:1 }} />
                      <button onClick={() => deleteSequence(seq.id)}
                        style={{ padding:"5px 12px", borderRadius:7, border:`1px solid ${c.red}44`, background:"transparent", color:c.red, fontSize:11, cursor:"pointer" }}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard (FF-22) ────────────────────────────────────────────────────────

function DashboardView({ c }) {
  const contacted   = Object.values(loadContacted());
  const pipeline    = Object.values(loadPipeline());
  const sequences   = Object.values(loadSequences());
  const templates   = Object.values(loadTemplates());

  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  // Contacted this week
  const contactedThisWeek = contacted.filter(c => now - (c.contactedAt||0) < oneWeek).length;

  // Pipeline by stage
  const STAGES = ["identified","contacted","replied","meeting","closed"];
  const STAGE_LABELS = { identified:"Identified", contacted:"Contacted", replied:"Replied", meeting:"Meeting", closed:"Closed" };
  const STAGE_COLORS = { identified:c.accent, contacted:"#f59e0b", replied:"#8b5cf6", meeting:"#10b981", closed:c.green };
  const byStage = STAGES.reduce((acc, s) => { acc[s] = pipeline.filter(p => p.stage === s).length; return acc; }, {});
  const pipelineTotal = pipeline.length;

  // Sequence stats
  const seqActive  = sequences.filter(s => s.status === "active").length;
  const seqPaused  = sequences.filter(s => s.status === "paused").length;
  const seqReplied = sequences.filter(s => s.status === "replied").length;
  const seqTotal   = sequences.length;
  const replyRate  = seqTotal > 0 ? Math.round((seqReplied / seqTotal) * 100) : 0;

  // Recent activity (last 10 items across all stores, sorted by time)
  const activityItems = [
    ...contacted.map(c => ({ ts: c.contactedAt||0, text: `Contacted ${c.company || "someone"}`, icon:"✉", color: "#8b5cf6" })),
    ...pipeline.map(p => ({ ts: p.addedAt||0, text: `Added ${p.name||p.company} to Pipeline`, icon:"→", color: c.accent })),
    ...pipeline.filter(p => p.lastActivity !== p.addedAt).map(p => ({ ts: p.lastActivity||0, text: `Pipeline: ${p.name||p.company} → ${STAGE_LABELS[p.stage]}`, icon:"↑", color: STAGE_COLORS[p.stage] || c.accent })),
    ...sequences.map(s => ({ ts: s.createdAt||0, text: `Sequence started for ${s.contactName||s.contactEmail||"contact"}`, icon:"⚡", color:"#f59e0b" })),
  ].sort((a,b) => b.ts - a.ts).slice(0, 12);

  const StatCard = ({ label, value, sub, color }) => (
    <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:4 }}>
      <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase" }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:800, color: color || c.text, letterSpacing:"-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:c.textMuted }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ flex:1, overflow:"auto", padding:24, display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header */}
      <div>
        <div style={{ fontSize:20, fontWeight:800, color:c.text, letterSpacing:"-0.02em" }}>Dashboard</div>
        <div style={{ fontSize:12, color:c.textMuted, marginTop:2 }}>
          {new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}
        </div>
      </div>

      {/* Top KPI row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:12 }}>
        <StatCard label="Contacted This Week" value={contactedThisWeek} sub={`${contacted.length} total`} color={c.accent} />
        <StatCard label="In Pipeline" value={pipelineTotal} sub={`${byStage.meeting||0} in meeting`} color="#10b981" />
        <StatCard label="Active Sequences" value={seqActive} sub={`${seqPaused} paused`} color="#f59e0b" />
        <StatCard label="Reply Rate" value={`${replyRate}%`} sub={`${seqReplied} of ${seqTotal} replied`} color="#8b5cf6" />
      </div>

      {/* Pipeline funnel + Sequence breakdown */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>

        {/* Pipeline Funnel */}
        <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.text, marginBottom:14 }}>Pipeline Funnel</div>
          {pipelineTotal === 0 ? (
            <div style={{ textAlign:"center", padding:"20px 0", color:c.textMuted, fontSize:12 }}>No pipeline cards yet. Add contacts from Intel.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {STAGES.map(stage => {
                const count = byStage[stage] || 0;
                const pct   = pipelineTotal > 0 ? Math.round((count / pipelineTotal) * 100) : 0;
                return (
                  <div key={stage}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontSize:11, fontWeight:600, color:c.textSub }}>{STAGE_LABELS[stage]}</span>
                      <span style={{ fontSize:11, color:c.textMuted }}>{count}</span>
                    </div>
                    <div style={{ height:6, borderRadius:4, background:c.bg, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background: STAGE_COLORS[stage], borderRadius:4, transition:"width 0.4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sequence Breakdown */}
        <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.text, marginBottom:14 }}>Sequence Health</div>
          {seqTotal === 0 ? (
            <div style={{ textAlign:"center", padding:"20px 0", color:c.textMuted, fontSize:12 }}>No sequences yet. Start one in Outreach.</div>
          ) : (
            <>
              <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                {[["Active", seqActive, "#f59e0b"],["Paused", seqPaused, c.amber],["Replied", seqReplied, c.green]].map(([lbl, val, col]) => (
                  <div key={lbl} style={{ flex:1, background:c.bg, borderRadius:8, padding:"10px 12px", textAlign:"center", border:`1px solid ${c.border}` }}>
                    <div style={{ fontSize:20, fontWeight:800, color:col }}>{val}</div>
                    <div style={{ fontSize:10, color:c.textMuted, marginTop:2 }}>{lbl}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ fontSize:11, color:c.textMuted, flexShrink:0 }}>Reply rate</div>
                <div style={{ flex:1, height:8, borderRadius:4, background:c.bg, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${replyRate}%`, background:`linear-gradient(90deg, #8b5cf6, #10b981)`, borderRadius:4, transition:"width 0.4s ease" }} />
                </div>
                <div style={{ fontSize:12, fontWeight:700, color:c.text, flexShrink:0 }}>{replyRate}%</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Templates + Recent Activity */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:12 }}>

        {/* Templates */}
        <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.text, marginBottom:12 }}>Saved Templates</div>
          {templates.length === 0 ? (
            <div style={{ fontSize:11, color:c.textMuted }}>No templates saved yet. Use ★ Save on any variant in Outreach.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[...templates].sort((a,b) => (b.useCount||0) - (a.useCount||0)).slice(0,6).map(tpl => (
                <div key={tpl.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"6px 0", borderBottom:`1px solid ${c.border}` }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:c.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tpl.name}</div>
                    <div style={{ fontSize:10, color:c.textMuted }}>{tpl.label}</div>
                  </div>
                  <div style={{ fontSize:11, color:c.textMuted, flexShrink:0 }}>{tpl.useCount||0}×</div>
                </div>
              ))}
              {templates.length > 6 && <div style={{ fontSize:11, color:c.textMuted, marginTop:2 }}>+{templates.length - 6} more</div>}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{ background:c.surface, border:`1px solid ${c.border}`, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:c.text, marginBottom:12 }}>Recent Activity</div>
          {activityItems.length === 0 ? (
            <div style={{ fontSize:11, color:c.textMuted }}>No activity yet. Start by running an Intel search.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
              {activityItems.map((item, i) => (
                <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"8px 0", borderBottom: i < activityItems.length - 1 ? `1px solid ${c.border}` : "none" }}>
                  <div style={{ width:22, height:22, borderRadius:6, background:`${item.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, flexShrink:0, color:item.color, fontWeight:700 }}>
                    {item.icon}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, color:c.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.text}</div>
                    <div style={{ fontSize:10, color:c.textMuted, marginTop:1 }}>{formatRelativeTime(item.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [isDark,       setIsDark]       = useState(() => localStorage.getItem("ff_theme") !== "light");
  const [view,         setView]         = useState("intel"); // "intel" | "feature_request" | "outreach"
  const [markdown,     setMarkdown]     = useState("");
  const [anthropicKey, setAnthropicKey] = useState(() => localStorage.getItem("ff_anthropic_key") || "");
  const [apolloKey,    setApolloKey]    = useState("");
  const [gmailConnected, setGmailConnected] = useState(null); // null | email string
  const [pipelineToast,  setPipelineToast]  = useState(null); // contact name string for 2s
  const [bridgeContext,   setBridgeContext]   = useState(null); // { companyName, notes }
  const [outreachBridge,  setOutreachBridge]  = useState(null); // { contactName, contactTitle, company, intelContext }
  const [showSettings, setShowSettings] = useState(false);
  const [stageStatus,  setStageStatus]  = useState({});
  const [stageDetail,  setStageDetail]  = useState({});
  const [contacts,     setContacts]     = useState([]);
  const [checklist,    setChecklist]    = useState([]);
  const [targetTitles, setTargetTitles] = useState([]);
  const [queryLog,     setQueryLog]     = useState([]);
  const [pipelineLog,  setPipelineLog]  = useState([]);
  const [savedRuns,    setSavedRuns]    = useState(() => loadSavedRuns());
  const [currentRunId, setCurrentRunId] = useState(null);
  const [running,      setRunning]      = useState(false);
  const [error,        setError]        = useState(null);
  const [done,         setDone]         = useState(false);
  const [filter,       setFilter]       = useState("all");
  const [mode,         setMode]         = useState("intel");
  const abortRef = useRef(false);

  const c = isDark ? DARK : LIGHT;

  // Load Apollo key and Gmail connection from keychain on mount.
  useEffect(() => {
    invoke("get_credential", { key: "apollo_key" })
      .then(val => { if (val) { setApolloKey(val); _apolloKey = val; } })
      .catch(() => {});
    invoke("gmail_check_connection")
      .then(email => { if (email) setGmailConnected(email); })
      .catch(() => {});
  }, []);

  const setSt = (id, status, detail) => {
    setStageStatus(s => ({ ...s, [id]: status }));
    if (detail !== undefined) setStageDetail(d => ({ ...d, [id]: detail }));
  };

  const resetPipeline = () => {
    setStageStatus({}); setStageDetail({});
    setContacts([]); setChecklist([]); setTargetTitles([]);
    setQueryLog([]); setPipelineLog([]); setError(null); setDone(false);
    setBridgeContext(null);
    setOutreachBridge(null);
  };

  const handleAddToPipeline = (contact) => {
    const data = loadPipeline();
    const emailLower = (contact.email || "").toLowerCase();
    const alreadyIn = Object.values(data).some(card => card.email === emailLower);
    if (!alreadyIn) {
      const card = pipelineCardFromContact(contact);
      upsertPipelineCard(card);
    }
    setPipelineToast(contact.name || contact.email || "Contact");
    setTimeout(() => setPipelineToast(null), 2000);
  };

  const handleAddAllToPipeline = (contactList) => {
    if (!contactList || contactList.length === 0) return;
    const data = loadPipeline();
    let added = 0;
    contactList.forEach(contact => {
      const emailLower = (contact.email || "").toLowerCase();
      const alreadyIn = Object.values(data).some(card => card.email === emailLower);
      if (!alreadyIn) {
        const card = pipelineCardFromContact(contact);
        data[card.id] = { ...card, lastActivity: Date.now() };
        added++;
      }
    });
    savePipeline(data);
    setPipelineToast(`${added} contact${added !== 1 ? "s" : ""}`);
    setTimeout(() => setPipelineToast(null), 2500);
  };

  const addLog = useCallback((stage, label, data) => {
    setPipelineLog(prev => [...prev, { stage, label, data }]);
  }, []);

  // Restore a saved run into the view (no re-run needed)
  const loadRun = useCallback((run) => {
    const stages = run.mode === "table" ? TABLE_STAGES : INTEL_STAGES;
    setStageStatus(Object.fromEntries(stages.map(s => [s.id, "done"])));
    setStageDetail({});
    setContacts(run.contacts    || []);
    setQueryLog(run.queryLog    || []);
    setPipelineLog(run.pipelineLog || []);
    setChecklist(run.checklist  || []);
    setTargetTitles(run.targetTitles || []);
    setMode(run.mode || "intel");
    setFilter("all");
    setError(null);
    setRunning(false);
    setDone(true);
    setCurrentRunId(run.id);
  }, []);

  const deleteRun = useCallback((id) => {
    setSavedRuns(prev => {
      const updated = prev.filter(r => r.id !== id);
      localStorage.setItem(RUNS_KEY, JSON.stringify(updated));
      return updated;
    });
    setCurrentRunId(prev => prev === id ? null : prev);
  }, []);

  const chat = useCallback(async (model, system, userMessage, maxTokens = 2048) => {
    if (!anthropicKey.trim()) throw new Error("Anthropic API key not set — open Settings ⚙");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await invoke("anthropic_chat", { apiKey: anthropicKey, model, system, userMessage, maxTokens });
      } catch (err) {
        if (String(err).includes("429") && attempt < 2) {
          // Rate limit — wait 10s / 20s then retry
          await new Promise(r => setTimeout(r, (attempt + 1) * 10000));
          continue;
        }
        throw err;
      }
    }
  }, [anthropicKey]);

  // ── Table mode: search Apollo per company, fully isolated ────────────────────
  const runTableMode = useCallback(async (companies) => {
    setSt("parse",  "done",   `${companies.length} companies ready`);
    setSt("apollo", "active", `Querying ${companies.length} companies in parallel…`);

    const settled = await Promise.allSettled(
      companies.map(async (row) => {
        // Search: q_keywords targets the company name
        const res = await invoke("apollo_people_search", {
          apiKey: _apolloKey,
          filters: { q_keywords: row.company },
          personTitles: row.apolloTitles,
          seniorityLevels: [],
          page: 1,
          perPage: 10,
        });
        const previews = res.people || [];
        // Enrich: bulk_match reveals full names + actual emails
        const { enrichMap } = await apolloEnrich(previews);
        const people = previews.map(p => mapContact(enrichMap.get(p.id) || p, () => row.emailAngle || null));
        return { people, total: res.total_entries ?? previews.length };
      })
    );

    const log = settled.map((r, i) => ({
      label:  companies[i].company,
      count:  r.status === "fulfilled" ? r.value.people.length : 0,
      total:  r.status === "fulfilled" ? r.value.total : 0,
      tier:   1,
      failed: r.status === "rejected",
      error:  r.status === "rejected" ? String(r.reason) : null,
    }));
    setQueryLog(log);

    const allBatches = settled.filter(r => r.status === "fulfilled").map(r => r.value.people);
    const sorted     = deduplicateContacts(allBatches);
    setContacts(sorted);

    const withEmail = sorted.filter(x => x.email).length;
    const failCount = log.filter(x => x.failed).length;
    setSt("apollo",
      failCount === companies.length ? "error" : "done",
      `${sorted.length} contacts · ${withEmail} with email${failCount ? ` · ${failCount}/${companies.length} companies failed` : ""}`
    );
    setDone(true);
    return { sorted, log, withEmail };
  }, []);

  const run = useCallback(async () => {
    if (!markdown.trim()) return;
    abortRef.current = false;
    setRunning(true);
    resetPipeline();
    setCurrentRunId(null);

    // Local accumulator so we can persist the full log when saving the run
    const runLog = [];
    const logEntry = (stage, label, data) => {
      runLog.push({ stage, label, data });
      addLog(stage, label, data);
    };

    const detectedMode = detectMode(markdown);
    setMode(detectedMode);

    try {
      // ── Table mode: no AI passes ───────────────────────────────────────────
      if (detectedMode === "table") {
        setSt("parse", "active", "Parsing company table…");
        const companies = parseCompanyTable(markdown);
        if (!companies.length) throw new Error("No rows found — table needs | or tab separators with Company / Apollo Titles / Email Angle columns.");
        const { sorted, log, withEmail } = await runTableMode(companies);
        // Auto-save table run
        const savedRun = {
          id: Date.now(),
          name: generateRunName("table", null, companies),
          timestamp: Date.now(),
          mode: "table",
          contactCount: sorted.length,
          emailCount: withEmail,
          contacts: sorted,
          queryLog: log,
          pipelineLog: [],
          checklist: [],
          targetTitles: [],
        };
        setSavedRuns(prev => {
          const updated = [savedRun, ...prev].slice(0, MAX_RUNS);
          localStorage.setItem(RUNS_KEY, JSON.stringify(updated));
          return updated;
        });
        setCurrentRunId(savedRun.id);
        return;
      }

      // ── Intel Pack mode ────────────────────────────────────────────────────
      // ── Haiku 1: Extract Apollo queries ──────────────────────────────────
      setSt("haiku1", "active", "Scanning ## Apollo Search Queries…");
      const h1Raw = await chat(HAIKU,
        "You extract structured data from intelligence packages. Return ONLY valid JSON — no preamble, no code fences.",
        `From the intel pack below, extract ALL Apollo search query JSON objects from the "## Apollo Search Queries" section.
Each line looks like: - **Label**: \`{...}\`

Return JSON array:
[{ "label": "...", "filters": { ...the JSON object verbatim... } }, ...]

Copy filter objects EXACTLY as written — no modification.
If no Apollo Search Queries section exists, return [].

INTEL PACK:
${extractSection(markdown, "Apollo Search Queries")}`, 2048);

      const apolloQueries = parseJson(h1Raw);
      setSt("haiku1", "done", `${apolloQueries.length} quer${apolloQueries.length === 1 ? "y" : "ies"} extracted`);
      logEntry("Haiku 1", `${apolloQueries.length} Apollo queries`, apolloQueries);
      if (abortRef.current) return;

      // ── Haiku 2: Extract person titles + seniority ────────────────────────
      setSt("haiku2", "active", "Identifying decision-maker titles…");
      const h2Raw = await chat(HAIKU,
        "You extract job titles from B2B intel packages. Return ONLY valid JSON — no preamble, no code fences.",
        `Extract every target job title mentioned in the ICP Profile, Qualifying Criteria, and "person_titles" fields.

Return JSON:
{
  "personTitles": ["exact title 1", "exact title 2", ...],
  "seniorityLevels": ["c_suite", "vp", "director", "founder"]
}

Seniority must be from: c_suite, vp, director, manager, senior, founder.
Keep seniorityLevels BROAD — include all that apply. Default: ["c_suite","vp","director","founder"].

INTEL PACK:
${extractSection(markdown, "ICP Profile", "Ideal Customer", "Target Persona", "Qualifying Criteria", "Apollo Search Queries")}`, 1024);

      const { personTitles: pt = [], seniorityLevels: sl = [] } = parseJson(h2Raw);
      const finalTitles    = pt.length ? pt : ["CTO","Founder","Co-Founder","VP Engineering","Head of Platform","Head of Infrastructure"];
      const finalSeniority = sl.length ? sl : ["c_suite","vp","director","founder"];
      setTargetTitles(finalTitles);
      setSt("haiku2", "done", `${finalTitles.length} titles · ${finalSeniority.length} seniority levels`);
      logEntry("Haiku 2", `${finalTitles.length} titles · ${finalSeniority.length} seniority`, { personTitles: finalTitles, seniorityLevels: finalSeniority });
      if (abortRef.current) return;

      // ── Haiku 3: Extract sales hooks ──────────────────────────────────────
      setSt("haiku3", "active", "Distilling top sales signals…");
      const h3Raw = await chat(HAIKU,
        "You extract sales intelligence. Return ONLY valid JSON — no preamble, no code fences.",
        `Extract the top 3 sharpest buying-signal hooks from the Sales Angles section. Focus on acute pain points.

Return JSON:
{ "topHooks": [{ "angle": "short angle name", "hook": "one-sentence outreach hook" }, ...] }

INTEL PACK:
${extractSection(markdown, "Sales Angles", "Outreach Hooks", "Hook", "Messaging")}`, 1024);
      const { topHooks = [] } = parseJson(h3Raw);
      setSt("haiku3", "done", `${topHooks.length} hooks distilled`);
      logEntry("Haiku 3", `${topHooks.length} sales hooks`, topHooks);
      if (abortRef.current) return;

      // ── Haiku 4: Extract qualification checklist ──────────────────────────
      setSt("haiku4", "active", "Extracting qualification checklist…");
      const h4Raw = await chat(HAIKU,
        "You extract qualification criteria from sales intelligence packages. Return ONLY valid JSON — no preamble, no code fences.",
        `Extract every qualification criterion from the Qualification Checklist section.

Return JSON array:
[
  { "criterion": "exact criterion text (concise)", "category": "size|title|industry|tech|email|funding|other" },
  ...
]

INTEL PACK:
${extractSection(markdown, "Qualification Checklist", "Qualifying Criteria", "Checklist", "Qualification")}`, 1024);

      let qualChecklist = [];
      try { qualChecklist = parseJson(h4Raw); } catch { /* non-fatal */ }
      setChecklist(qualChecklist);
      setSt("haiku4", "done", `${qualChecklist.length} criteria extracted`);
      logEntry("Haiku 4", `${qualChecklist.length} qual criteria`, qualChecklist);
      if (abortRef.current) return;

      // ── Sonnet: Synthesize strategy ───────────────────────────────────────
      setSt("sonnet", "active", "Synthesizing optimal search strategy…");
      const sRaw = await chat(SONNET,
        "You are a B2B sales intelligence system. Return ONLY valid JSON — no preamble, no code fences.",
        `Optimize the Apollo search strategy from these extractions.

Available queries (pick best 3 by INDEX — do NOT rewrite or modify filter objects):
${apolloQueries.map((q, i) => `[${i}] "${q.label}"`).join("\n")}

Titles: ${JSON.stringify(finalTitles)}
Seniority: ${JSON.stringify(finalSeniority)}
Hooks: ${JSON.stringify(topHooks)}

1. PICK the best 3 query indices (e.g. [0, 2, 1]) — copy verbatim, no modifications
2. MERGE/DEDUPLICATE titles (normalize casing, max 12)
3. CONFIRM seniority levels
4. SELECT the single sharpest outreach hook as primaryHook

Return JSON:
{ "queryIndices": [0, 1, 2], "personTitles": [...], "seniorityLevels": [...], "primaryHook": "..." }`, 4096);

      const strategy = parseJson(sRaw);
      // Use original query objects at the selected indices — never let Sonnet rewrite filter objects
      const strategyQueries   = strategy.queryIndices?.length
        ? strategy.queryIndices.map(i => apolloQueries[i]).filter(Boolean)
        : apolloQueries.slice(0, 3);
      const strategyTitles    = strategy.personTitles?.length   ? strategy.personTitles   : finalTitles;
      const strategySeniority = strategy.seniorityLevels?.length ? strategy.seniorityLevels : finalSeniority;
      const primaryHook       = strategy.primaryHook || topHooks[0]?.hook || null;
      setSt("sonnet", "done", `${Math.min(strategyQueries.length, 3)} queries · ${strategyTitles.length} titles`);
      logEntry("Sonnet", `indices [${(strategy.queryIndices || []).join(",")}] · ${strategyTitles.length} titles · hook selected`, {
        queryIndices: strategy.queryIndices,
        queriesSelected: strategyQueries.map(q => q.label),
        personTitles: strategyTitles,
        seniorityLevels: strategySeniority,
        primaryHook,
      });
      if (abortRef.current) return;

      // ── Apollo: Parallel search with 3-tier fallback ──────────────────────
      if (!_apolloKey.trim()) {
        throw new Error("Apollo API key not set — open Settings ⚙ and add your Apollo key to run contact searches.");
      }
      const querySet = strategyQueries.slice(0, 3);
      setSt("apollo", "active", `Running ${querySet.length} searches with fallback…`);
      const hookFn = (title) => pickHook(title, topHooks, primaryHook);

      const settled = await Promise.allSettled(
        querySet.map(async q => {
          const { people, total, tier, searchMeta, enrichMeta } = await apolloSearchAndEnrich(
            q.filters || {}, strategyTitles, strategySeniority, hookFn
          );
          logEntry(`Apollo: ${q.label}`,
            `${searchMeta.previews} previews (tier ${tier}) → enrich: ${enrichMeta.received} matched, ${enrichMeta.withEmail} with email${enrichMeta.error ? ` ⚠ ${enrichMeta.error}` : ""}`,
            { query: q.label, searchMeta, enrichMeta }
          );
          return { label: q.label, tier, people, total };
        })
      );

      const log = settled.map((r, i) => ({
        label:  querySet[i].label,
        count:  r.status === "fulfilled" ? r.value.people.length : 0,
        tier:   r.status === "fulfilled" ? r.value.tier : null,
        total:  r.status === "fulfilled" ? r.value.total : 0,
        failed: r.status === "rejected",
        error:  r.status === "rejected" ? String(r.reason) : null,
      }));
      setQueryLog(log);

      const allBatches = settled.filter(r => r.status === "fulfilled").map(r => r.value.people);
      const sorted     = deduplicateContacts(allBatches);
      setContacts(sorted);

      const withEmail = sorted.filter(x => x.email).length;
      const failCount = log.filter(x => x.failed).length;
      const tier3Used = log.filter(x => x.tier === 3).length;
      const detailStr = [
        `${sorted.length} contacts · ${withEmail} with email`,
        tier3Used ? `(${tier3Used} quer${tier3Used > 1 ? "ies" : "y"} used broad fallback)` : "",
        failCount ? `· ${failCount} failed` : "",
      ].filter(Boolean).join(" ");

      setSt("apollo", failCount === querySet.length ? "error" : "done", detailStr);

      // ── Auto-save run ──────────────────────────────────────────────────────
      const savedRun = {
        id: Date.now(),
        name: generateRunName("intel", strategyQueries, null),
        timestamp: Date.now(),
        mode: "intel",
        contactCount: sorted.length,
        emailCount: withEmail,
        contacts: sorted,
        queryLog: log,
        pipelineLog: runLog,
        checklist: qualChecklist || [],
        targetTitles: strategyTitles || [],
      };
      setSavedRuns(prev => {
        const updated = [savedRun, ...prev].slice(0, MAX_RUNS);
        localStorage.setItem(RUNS_KEY, JSON.stringify(updated));
        return updated;
      });
      setCurrentRunId(savedRun.id);
      setBridgeContext(buildBridgeContext(log, sorted, runLog));
      setOutreachBridge(buildOutreachBridge(sorted, markdown));
      setDone(true);

    } catch (err) {
      setError(err.message || String(err));
      setStageStatus(prev => {
        const u = { ...prev };
        [...INTEL_STAGES, ...TABLE_STAGES].forEach(s => { if (u[s.id] === "active") u[s.id] = "error"; });
        return u;
      });
    } finally {
      setRunning(false);
    }
  }, [markdown, chat, runTableMode, addLog]);

  const contactedMap = loadContacted();
  const filtered  = filter === "email"        ? contacts.filter(x => x.email)
                  : filter === "uncontacted"  ? contacts.filter(x => !contactedMap[x.email?.toLowerCase()])
                  : contacts;
  const withEmail = contacts.filter(x => x.email).length;
  const uncontactedCount = contacts.filter(x => !contactedMap[x.email?.toLowerCase()]).length;
  const showPipeline = running || done || !!error;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        textarea, input { resize: none; }
        textarea:focus, input:focus { outline: none; }
        button { cursor: pointer; font-family: inherit; }
      `}</style>

      {showSettings && (
        <SettingsModal apiKey={anthropicKey} apolloKeyProp={apolloKey}
          onSave={(k, ak) => {
            setAnthropicKey(k); localStorage.setItem("ff_anthropic_key", k);
            if (ak) { setApolloKey(ak); _apolloKey = ak; }
          }}
          onGmailConnected={email => setGmailConnected(email || null)}
          onClose={() => setShowSettings(false)} c={c} />
      )}

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:c.bg, color:c.text, transition:"background 0.2s,color 0.2s" }}>

        {/* Titlebar */}
        <div style={{ height:52, paddingLeft:84, paddingRight:16, display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${c.border}`, background:c.surface, WebkitAppRegion:"drag", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:c.accentDim, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:14 }}>✉</span></div>
            <span style={{ fontWeight:700, fontSize:15, letterSpacing:"-0.02em", color:c.text }}>FinalFold</span>
            <div style={{ display:"flex", gap:2, marginLeft:12, background:c.bg, borderRadius:8, padding:3, border:`1px solid ${c.border}`, WebkitAppRegion:"no-drag" }}>
              {[["intel","Intel"], ["feature_request","Feature Requests"], ["outreach","Outreach"], ["pipeline","Pipeline"], ["sequences","Sequences"], ["dashboard","Dashboard"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setView(val)}
                  style={{ padding:"4px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, background: view === val ? c.accent : "transparent", color: view === val ? "#fff" : c.textSub, transition:"all 0.15s", cursor:"pointer" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", gap:8, WebkitAppRegion:"no-drag" }}>
            <button onClick={() => setIsDark(d => { const next = !d; localStorage.setItem("ff_theme", next ? "dark" : "light"); return next; })} title={isDark ? "Light mode" : "Dark mode"} style={{ width:36, padding:"5px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {isDark ? "☀" : "🌙"}
            </button>
            <button onClick={() => setShowSettings(true)} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:12, display:"flex", alignItems:"center", gap:5 }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
          </div>
        </div>

        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

          {view === "feature_request" && (
            <FeatureRequestView c={c} onOpenSettings={() => setShowSettings(true)}
              bridgeContext={bridgeContext} onClearBridge={() => setBridgeContext(null)} />
          )}

          {view === "outreach" && (
            <OutreachView c={c} apiKey={anthropicKey} onOpenSettings={() => setShowSettings(true)}
              outreachBridge={outreachBridge} onClearBridge={() => setOutreachBridge(null)}
              gmailConnected={gmailConnected} onGmailConnectedChange={setGmailConnected} />
          )}

          {view === "pipeline" && (
            <PipelineTabView c={c}
              onDraftOutreach={(card) => {
                setOutreachBridge({ contactName: card.name, contactTitle: card.title, company: card.company, contactEmail: card.email, intelContext: "" });
                setView("outreach");
              }}
            />
          )}

          {view === "sequences" && (
            <SequencesView c={c} gmailConnected={gmailConnected} onOpenSettings={() => setShowSettings(true)} />
          )}

          {view === "dashboard" && (
            <DashboardView c={c} />
          )}

          {/* Intel view */}
          {view === "intel" && <>

          {/* Sidebar */}
          <div style={{ width:320, flexShrink:0, borderRight:`1px solid ${c.border}`, display:"flex", flexDirection:"column", background:c.surface }}>
            <div style={{ padding:"16px 16px 0" }}>
              <label style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", display:"block", marginBottom:8 }}>Intel Pack</label>
              <textarea value={markdown} onChange={e => setMarkdown(e.target.value)}
                placeholder={"Two modes:\n\n1. Intel Pack — markdown with ## Apollo Search Queries section\n\n2. Company Table — paste a | or tab-separated table:\nCompany | Apollo Titles | Email Angle\nAcme Corp | CTO, VP Eng | Reduce deploy time"}
                rows={11} style={{ width:"100%", background:c.bg, border:`1px solid ${c.border}`, borderRadius:10, color:c.text, fontSize:12, fontFamily:"monospace", padding:"12px", lineHeight:1.6 }} />
            </div>

            <div style={{ padding:"10px 16px" }}>
              <button onClick={run} disabled={running || !markdown.trim()}
                style={{ width:"100%", padding:"11px 0", borderRadius:10, border:"none", background:c.accent, color:"#fff", fontSize:14, fontWeight:700, opacity: running || !markdown.trim() ? 0.5 : 1, transition:"opacity 0.15s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {running ? (<><div style={{ width:14, height:14, borderRadius:"50%", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", animation:"spin 0.8s linear infinite" }} />Running…</>) : "Run Intel Brief"}
              </button>
            </div>

            <div style={{ borderTop:`1px solid ${c.border}`, padding:"12px 16px", flex:1, overflow:"auto" }}>
              <div style={{ fontSize:11, fontWeight:700, color:c.textMuted, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                Pipeline
                {mode === "table" && showPipeline && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4, background:c.accentDim, color:c.accent, fontWeight:700, letterSpacing:"0.05em" }}>TABLE</span>}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {(mode === "table" ? TABLE_STAGES : INTEL_STAGES).map(stage => (
                  <PipelineStep key={stage.id} stage={stage}
                    status={showPipeline ? (stageStatus[stage.id] || "pending") : "pending"}
                    detail={stageDetail[stage.id]} c={c} />
                ))}
              </div>

              {error && (
                <div style={{ marginTop:12, padding:"10px 12px", background:c.redDim, border:`1px solid ${c.red}44`, borderRadius:10, fontSize:12, color:c.red }}>
                  <strong>Error:</strong> {error}
                </div>
              )}

              {queryLog.length > 0 && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:11, color:c.textMuted, marginBottom:6, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Queries</div>
                  {queryLog.map((q, i) => (
                    <div key={i} style={{ fontSize:11, padding:"5px 8px", background:c.bg, borderRadius:6, marginBottom:4, border:`1px solid ${q.failed ? c.red + "44" : c.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ color: q.failed ? c.red : c.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{q.label}</span>
                        <span style={{ color: q.failed ? c.red : c.textMuted, flexShrink:0, marginLeft:8 }}>
                          {q.failed ? "✕" : q.count}
                        </span>
                      </div>
                      {q.tier > 1 && !q.failed && (
                        <div style={{ color:c.amber, fontSize:10, marginTop:2 }}>
                          ⚠ tier {q.tier} fallback used{q.tier === 3 ? " (broad)" : " (no seniority)"}
                        </div>
                      )}
                      {q.failed && q.error && (
                        <div style={{ color:c.red, fontSize:10, marginTop:2, wordBreak:"break-word" }}>
                          {q.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {checklist.length > 0 && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:11, color:c.textMuted, marginBottom:6, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Qual Criteria ({checklist.length})</div>
                  {checklist.slice(0, 5).map((item, i) => (
                    <div key={i} style={{ fontSize:11, color:c.textSub, padding:"3px 0", borderBottom:`1px solid ${c.border}`, display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:c.accentDim, color:c.accent, flexShrink:0, textTransform:"uppercase", letterSpacing:"0.04em" }}>{item.category}</span>
                      <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.criterion}</span>
                    </div>
                  ))}
                  {checklist.length > 5 && <div style={{ fontSize:11, color:c.textMuted, marginTop:4 }}>+{checklist.length - 5} more (shown on cards)</div>}
                </div>
              )}

              <PipelineLogPanel logs={pipelineLog} c={c} />
              <SavedRunsPanel runs={savedRuns} currentRunId={currentRunId} onLoad={loadRun} onDelete={deleteRun} c={c} />
            </div>
          </div>

          {/* Results */}
          <div style={{ flex:1, overflow:"auto", padding:24 }}>
            {!done && !running && !error && (
              <div style={{ height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:c.textMuted, textAlign:"center" }}>
                <div style={{ fontSize:48, marginBottom:16, opacity:0.2 }}>✉</div>
                <div style={{ fontSize:16, fontWeight:600, color:c.textSub, marginBottom:8 }}>Paste your intel pack and run</div>
                <div style={{ fontSize:13, color:c.textMuted, maxWidth:360, lineHeight:1.7 }}>
                  <strong style={{ color:c.textSub }}>Intel Pack</strong> — paste markdown with <code style={{ fontSize:11, background:c.bg, padding:"1px 4px", borderRadius:3 }}>## Apollo Search Queries</code>. Runs AI pipeline + Apollo.<br/><br/>
                  <strong style={{ color:c.textSub }}>Company Table</strong> — paste a <code style={{ fontSize:11, background:c.bg, padding:"1px 4px", borderRadius:3 }}>|</code> or tab-separated table with Company, Apollo Titles, and Email Angle columns. Searches Apollo directly — no AI needed.
                </div>
              </div>
            )}

            {running && contacts.length === 0 && (
              <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ textAlign:"center" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", border:`3px solid ${c.accentDim}`, borderTopColor:c.accent, animation:"spin 0.9s linear infinite", margin:"0 auto 16px" }} />
                  <div style={{ fontSize:14, color:c.textSub }}>Running pipeline…</div>
                </div>
              </div>
            )}

            {(done || contacts.length > 0) && (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
                  <div>
                    <span style={{ fontSize:20, fontWeight:700, color:c.text }}>{contacts.length} contacts</span>
                    <span style={{ fontSize:13, color:c.textMuted, marginLeft:10 }}>{withEmail} with email</span>
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    {done && bridgeContext && (
                      <button
                        onClick={() => setView("feature_request")}
                        style={{ padding:"6px 14px", borderRadius:7, border:`1px solid ${c.accent}`, background:"transparent", color:c.accent, fontSize:12, fontWeight:600 }}>
                        Scope a Feature →
                      </button>
                    )}
                    {done && outreachBridge && (
                      <button
                        onClick={() => setView("outreach")}
                        style={{ padding:"6px 14px", borderRadius:7, border:`1px solid ${c.green}`, background:"transparent", color:c.green, fontSize:12, fontWeight:600 }}>
                        Draft Outreach →
                      </button>
                    )}
                    <div style={{ display:"flex", gap:4, background:c.bg, borderRadius:8, padding:4, border:`1px solid ${c.border}` }}>
                      {[["all", `All (${contacts.length})`], ["email", `Has Email (${withEmail})`], ["uncontacted", `Uncontacted (${uncontactedCount})`]].map(([val, lbl]) => (
                        <button key={val} onClick={() => setFilter(val)} style={{ padding:"5px 14px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, background: filter === val ? c.accent : "transparent", color: filter === val ? "#fff" : c.textSub, transition:"all 0.15s" }}>{lbl}</button>
                      ))}
                    </div>
                    {filtered.length > 0 && (
                      <button
                        onClick={() => handleAddAllToPipeline(filtered)}
                        style={{ padding:"5px 12px", borderRadius:7, border:`1px solid ${c.border}`, background:"transparent", color:c.textSub, fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:5, cursor:"pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = c.accent; e.currentTarget.style.color = c.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSub; }}
                        title={`Add all ${filtered.length} contacts to Pipeline`}>
                        + All to Pipeline
                      </button>
                    )}
                  </div>
                </div>
                {filtered.length > 0 ? (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:14 }}>
                    {filtered.map(contact => (
                      <ContactCard key={contact.id} contact={contact}
                        checklist={checklist} targetTitles={targetTitles} c={c}
                        onDraftOutreach={(ct) => {
                          setOutreachBridge({ contactName: ct.name, contactTitle: ct.title, company: ct.company, contactEmail: ct.email || "", intelContext: markdown });
                          setView("outreach");
                        }}
                        onAddToPipeline={handleAddToPipeline}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign:"center", padding:"60px 0", color:c.textMuted }}>No contacts match the current filter</div>
                )}
              </>
            )}
          </div>
          </>}

        </div>
      </div>

      {/* Pipeline toast (FF-19) */}
      {pipelineToast && (
        <div style={{ position:"fixed", bottom:24, right:24, padding:"10px 18px", background:c.accent, color:"#fff", borderRadius:10, fontSize:12, fontWeight:700, zIndex:9999, boxShadow:"0 4px 20px rgba(0,0,0,0.35)", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:14 }}>✓</span>
          {pipelineToast} added to Pipeline
        </div>
      )}
    </>
  );
}
