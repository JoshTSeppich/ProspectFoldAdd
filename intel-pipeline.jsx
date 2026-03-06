import { useState, useEffect, useCallback, useRef } from "react";

// ─── Theme Tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:           "#f8fafc",
  surface:      "#ffffff",
  border:       "#e2e8f0",
  borderFocus:  "#a5b4fc",
  text:         "#0f172a",
  textSub:      "#475569",
  textMuted:    "#94a3b8",
  accent:       "#4F46E5",
  accentHover:  "#4338CA",
  accentBg:     "#EEF2FF",
  accentBorder: "#C7D2FE",
  green:        "#059669",
  greenBg:      "#ECFDF5",
  greenBorder:  "#A7F3D0",
  amber:        "#D97706",
  amberBg:      "#FFFBEB",
  amberBorder:  "#FDE68A",
  red:          "#DC2626",
  redBg:        "#FEF2F2",
  redBorder:    "#FECACA",
  violet:       "#7C3AED",
  violetBg:     "#F5F3FF",
  violetBorder: "#DDD6FE",
  pink:         "#DB2777",
  pinkBg:       "#FDF2F8",
  pinkBorder:   "#FBCFE8",
  shadow:       "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:     "0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)",
  radius:       8,
  radiusSm:     6,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fitScoreColor(score) {
  if (score === null || score === undefined) return T.textMuted;
  if (score >= 80) return T.green;
  if (score >= 60) return T.amber;
  return T.red;
}

function urgencyColors(level) {
  switch (level) {
    case "CRITICAL": return { bg: T.red,      text: "#fff",       border: T.red };
    case "HIGH":     return { bg: T.amberBg,   text: T.amber,      border: T.amberBorder };
    case "MEDIUM":   return { bg: T.accentBg,  text: T.accent,     border: T.accentBorder };
    default:         return { bg: T.bg,        text: T.textMuted,  border: T.border };
  }
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function genId() {
  return String(Date.now()) + String(Math.random()).slice(2, 7);
}

function safeParseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return JSON.parse(cleaned);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UrgencyBadge({ level }) {
  const c = urgencyColors(level);
  return (
    <span style={{
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      fontFamily: "inherit",
      flexShrink: 0,
    }}>
      {level || "LOW"}
    </span>
  );
}

function FitBar({ score }) {
  const color = fitScoreColor(score);
  const pct = score ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1,
        height: 6,
        background: T.border,
        borderRadius: 99,
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: 99,
          transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32, textAlign: "right" }}>
        {score !== null && score !== undefined ? `${score}%` : "—"}
      </span>
    </div>
  );
}

function QualCheckItem({ label, value }) {
  let icon, color;
  if (value === true)        { icon = "✓"; color = T.green; }
  else if (value === false)  { icon = "✕"; color = T.red; }
  else                       { icon = "?"; color = T.textMuted; }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ color, fontWeight: 700, width: 14, textAlign: "center" }}>{icon}</span>
      <span style={{ color: value === null ? T.textMuted : T.text }}>{label}</span>
    </div>
  );
}

function Spinner({ size = 16, color = T.accent }) {
  return (
    <span style={{
      display: "inline-block",
      width: size,
      height: size,
      border: `2px solid ${color}30`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "ip-spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function ModalOverlay({ children, onClose }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

function Tag({ children, color = T.accent, bg = T.accentBg, border = T.accentBorder }) {
  return (
    <span style={{
      background: bg,
      color,
      border: `1px solid ${border}`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      marginRight: 4,
      marginBottom: 4,
      display: "inline-block",
      letterSpacing: "0.02em",
    }}>
      {children}
    </span>
  );
}

function SectionBox({ title, accent = T.accent, children }) {
  return (
    <div style={{
      border: `1px solid ${T.border}`,
      borderRadius: T.radius,
      overflow: "hidden",
      marginBottom: 12,
    }}>
      <div style={{
        padding: "8px 14px",
        background: T.bg,
        borderBottom: `1px solid ${T.border}`,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: accent,
      }}>
        {title}
      </div>
      <div style={{ padding: "12px 14px", background: T.surface }}>
        {children}
      </div>
    </div>
  );
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function claudeCall({ apiKey, model = "claude-sonnet-4-5", system, messages, tools, maxTokens = 4096 }) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools)  body.tools  = tools;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":                              apiKey,
      "anthropic-version":                      "2023-06-01",
      "anthropic-beta":                         "web-search-2025-03-05",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type":                           "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }
  return res.json();
}

function extractText(response) {
  const b = response.content?.find(x => x.type === "text");
  return b?.text ?? "";
}

// ─── Parse Package ────────────────────────────────────────────────────────────

async function parsePackageAPI(apiKey, markdown) {
  const prompt = `You are parsing a B2B market intelligence package. Extract the following from this markdown document and return ONLY valid JSON.

{
  "title": "infer a short title from the content",
  "summary": "2-sentence summary of the target market",
  "icp": {
    "companyTypes": ["array of company types to target"],
    "companySizes": ["array of size ranges"],
    "qualifyingCriteria": ["array of qualifying criteria"],
    "signals": ["array of buying signals to look for"]
  },
  "salesAngles": [
    { "name": "angle name", "hypothesis": "why this works", "hook": "one-line value prop" }
  ],
  "namedProspects": [
    { "name": "company/institution name", "context": "why mentioned, what situation they are in", "urgencySignal": "CRITICAL|HIGH|MEDIUM|LOW" }
  ],
  "qualificationChecklist": ["array of checklist items"],
  "redFlags": ["array of disqualification criteria"]
}

Intelligence Package:
${markdown}

Return ONLY valid JSON. No markdown fences. No preamble.`;

  const response = await claudeCall({
    apiKey,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
  });
  return safeParseJSON(extractText(response));
}

// ─── Research Prospect ────────────────────────────────────────────────────────

async function researchProspectAPI(apiKey, apolloKey, prospect, pkg) {
  const name = prospect.name;

  const prompt = `Research ${name} for B2B outreach qualification.

Context from intel package: ${prospect.discoveryContext}

ICP criteria to validate: ${pkg.qualificationChecklist.join(", ")}
Red flags to check: ${pkg.redFlags.join(", ")}
Sales angles available: ${pkg.salesAngles.map(a => a.name).join(", ")}

Use web_search to find:
1. Recent news about ${name} (financial health, leadership changes, closures, mergers)
2. LMS in use (Canvas, Blackboard, Moodle, Brightspace, D2L)
3. Academic integrity or AI usage policies
4. Decision-maker names and titles
5. Buying signals: RFPs, policy updates, faculty concerns about AI
6. Red flags: closures, vendor lock-ins, recent layoffs

Return ONLY valid JSON:
{
  "currentSituation": {
    "recentNews": ["array of recent news items"],
    "financialHealth": "brief assessment",
    "enrollmentTrends": "brief assessment if applicable"
  },
  "qualificationScore": {
    "hasLMS": null,
    "hasAIPolicy": null,
    "budgetAuthorityIdentified": null,
    "hasOnlinePrograms": null,
    "hasWritingIntensivePrograms": null,
    "underEnrollmentPressure": null,
    "hasAccreditationReview": null
  },
  "buyingSignals": [{ "signal": "...", "source": "...", "date": "..." }],
  "decisionMakers": [{ "name": "...", "title": "...", "source": "..." }],
  "redFlagsDetected": [],
  "isDisqualified": false,
  "disqualificationReason": null,
  "recommendedSalesAngle": "which angle from the package fits best",
  "personalizationHooks": ["3-5 specific personalization hooks from research"],
  "fitScore": 75
}`;

  const response = await claudeCall({
    apiKey,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
  });

  const researchData = safeParseJSON(extractText(response));

  // Apollo enrichment (best-effort)
  let apolloOrgId = null, domain = null, employeeCount = null;
  let industry = null, location = null;
  let primaryContact = null, alternateContacts = [];

  if (apolloKey && window.electronAPI?.searchApolloOrg) {
    try {
      const org = await window.electronAPI.searchApolloOrg({ apiKey: apolloKey, orgName: name });
      if (org?.id) {
        apolloOrgId    = org.id;
        domain         = org.primary_domain || org.domain || null;
        employeeCount  = org.estimated_num_employees || org.employee_count || null;
        industry       = org.industry || null;
        location       = [org.city, org.state, org.country].filter(Boolean).join(", ") || null;

        if (window.electronAPI?.searchApolloContacts) {
          const titles = [
            "Provost", "Vice President Academic Affairs", "Chief Academic Officer",
            "Dean", "CIO", "Director of Academic Integrity", "President", "VP Academic Affairs",
          ];
          const contacts = await window.electronAPI.searchApolloContacts({
            apiKey: apolloKey, orgId: apolloOrgId, titles,
          });

          if (contacts?.length > 0) {
            const rankPrompt = `Given these contacts at ${name}, pick the single best person to cold-email for B2B sales about academic AI integrity tools.

Sales context: ${pkg.salesAngles[0]?.hook || "AI-powered academic integrity tools"}

Contacts:
${contacts.slice(0, 5).map((c, i) => `${i + 1}. ${c.name} — ${c.title}`).join("\n")}

Return ONLY valid JSON:
{ "selectedIndex": 0, "selectionRationale": "one sentence why" }`;

            const rankResp  = await claudeCall({ apiKey, messages: [{ role: "user", content: rankPrompt }], maxTokens: 256 });
            const rank       = safeParseJSON(extractText(rankResp));
            const chosen     = contacts[rank.selectedIndex ?? 0];

            if (chosen) {
              primaryContact = {
                apolloPersonId:     chosen.id,
                name:               chosen.name,
                title:              chosen.title,
                email:              chosen.email,
                linkedinUrl:        chosen.linkedin_url || null,
                selectionRationale: rank.selectionRationale || "",
              };
              alternateContacts = contacts
                .filter((_, i) => i !== (rank.selectedIndex ?? 0))
                .slice(0, 4)
                .map(c => ({ apolloPersonId: c.id, name: c.name, title: c.title, email: c.email }));
            }
          }
        }
      }
    } catch (err) {
      console.warn("Apollo enrichment failed:", err);
    }
  }

  return { ...researchData, apolloOrgId, domain, employeeCount, industry, location, primaryContact, alternateContacts };
}

// ─── Draft Email ──────────────────────────────────────────────────────────────

async function draftEmailAPI(apiKey, prospect) {
  const prompt = `Draft a cold outreach email for B2B sales.

PROSPECT: ${prospect.name}
CONTACT: ${prospect.primaryContact?.name || "Decision Maker"}, ${prospect.primaryContact?.title || ""}
CURRENT SITUATION: ${JSON.stringify(prospect.currentSituation)}
BUYING SIGNALS: ${(prospect.buyingSignals || []).map(s => s.signal).join(", ")}
RECOMMENDED SALES ANGLE: ${prospect.recommendedSalesAngle}
PERSONALIZATION HOOKS: ${(prospect.personalizationHooks || []).join(", ")}

Write a 150-200 word cold email that:
1. Opens with a specific reference to their situation (use the buying signals and hooks)
2. Connects to the sales angle
3. Offers concrete value
4. Has a clear, low-friction CTA (15-minute call)

Tone: Senior professional, human, not salesy.

Return ONLY valid JSON:
{ "subject": "...", "body": "..." }`;

  const response = await claudeCall({ apiKey, messages: [{ role: "user", content: prompt }], maxTokens: 1024 });
  return safeParseJSON(extractText(response));
}

// ─── localStorage ─────────────────────────────────────────────────────────────

function loadPackages()  { try { return JSON.parse(localStorage.getItem("intel_packages")  || "[]"); } catch { return []; } }
function loadProspects() { try { return JSON.parse(localStorage.getItem("intel_prospects") || "{}"); } catch { return {}; } }
function savePackages(v)  { localStorage.setItem("intel_packages",  JSON.stringify(v)); }
function saveProspects(v) { localStorage.setItem("intel_prospects", JSON.stringify(v)); }

// ─── ProspectCard ─────────────────────────────────────────────────────────────

function ProspectCard({ prospect, onReachOut, onViewDetails, onDisqualify }) {
  const isPending      = prospect.researchStatus === "PENDING";
  const isFailed       = prospect.researchStatus === "FAILED";
  const isDisqualified = prospect.isDisqualified;
  const qs             = prospect.qualificationScore || {};
  const dimmed         = isPending || isDisqualified;

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${isDisqualified ? T.redBorder : T.border}`,
      borderRadius: T.radius,
      overflow: "hidden",
      boxShadow: T.shadow,
      opacity: dimmed ? 0.6 : 1,
      display: "flex",
      flexDirection: "column",
      transition: "opacity 0.2s",
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "12px 14px 10px",
        borderBottom: `1px solid ${T.border}`,
        background: isDisqualified ? T.redBg : T.bg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <UrgencyBadge level={prospect.urgencyLevel} />
          {isDisqualified && (
            <span style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
              DISQUALIFIED
            </span>
          )}
          {isFailed && (
            <span style={{ background: T.amberBg, color: T.amber, border: `1px solid ${T.amberBorder}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
              FAILED
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{prospect.name}</div>
        {(prospect.location || prospect.employeeCount || prospect.industry) && (
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>
            {[prospect.location, prospect.employeeCount && `${Number(prospect.employeeCount).toLocaleString()} emp`, prospect.industry].filter(Boolean).join(" · ")}
          </div>
        )}
        {isDisqualified && prospect.disqualificationReason && (
          <div style={{ fontSize: 12, color: T.red, marginTop: 5, fontStyle: "italic" }}>
            {prospect.disqualificationReason}
          </div>
        )}
      </div>

      {isPending ? (
        <div style={{ padding: "24px 14px", textAlign: "center", color: T.textMuted, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Spinner size={14} color={T.textMuted} />
          Awaiting research...
        </div>
      ) : (
        <>
          {/* ── Contact ── */}
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
            {prospect.primaryContact ? (
              <>
                <div style={{ fontSize: 13, color: T.text, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: T.textMuted }}>👤</span>
                  <span style={{ fontWeight: 600 }}>{prospect.primaryContact.name}</span>
                  {prospect.primaryContact.title && (
                    <span style={{ color: T.textSub, fontSize: 12 }}>({prospect.primaryContact.title})</span>
                  )}
                </div>
                {prospect.primaryContact.email && (
                  <div style={{ fontSize: 12, color: T.accent, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                    <span>📧</span> {prospect.primaryContact.email}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>No contact found yet</div>
            )}
          </div>

          {/* ── Fit Score ── */}
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Fit Score</div>
            <FitBar score={prospect.fitScore} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginTop: 8 }}>
              <QualCheckItem label="Has LMS"    value={qs.hasLMS} />
              <QualCheckItem label="AI Policy"  value={qs.hasAIPolicy} />
              <QualCheckItem label="Online Pgm" value={qs.hasOnlinePrograms} />
              <QualCheckItem label="Budget ID"  value={qs.budgetAuthorityIdentified} />
            </div>
          </div>

          {/* ── Sales Angle ── */}
          {prospect.recommendedSalesAngle && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.violet, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                🎯 {prospect.recommendedSalesAngle}
              </div>
              {prospect.personalizationHooks?.[0] && (
                <div style={{ fontSize: 12, color: T.textSub, fontStyle: "italic", lineHeight: 1.5 }}>
                  &ldquo;{prospect.personalizationHooks[0]}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* ── Buying Signals ── */}
          {prospect.buyingSignals?.length > 0 && (
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, marginBottom: 4 }}>🔍 Buying Signals</div>
              <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5 }}>
                {prospect.buyingSignals.slice(0, 2).map(s => s.signal).join(" · ")}
              </div>
            </div>
          )}

          {/* ── Actions ── */}
          <div style={{ padding: "10px 14px", display: "flex", gap: 6, marginTop: "auto" }}>
            <button
              onClick={() => onReachOut(prospect)}
              disabled={isDisqualified}
              style={{
                flex: 1,
                background: isDisqualified ? T.bg : (prospect.reachOutStatus === "DRAFTED" ? T.greenBg : T.accent),
                color:      isDisqualified ? T.textMuted : (prospect.reachOutStatus === "DRAFTED" ? T.green : "#fff"),
                border:     `1px solid ${isDisqualified ? T.border : (prospect.reachOutStatus === "DRAFTED" ? T.greenBorder : T.accent)}`,
                borderRadius: T.radiusSm,
                padding: "7px 0",
                fontSize: 12,
                fontWeight: 600,
                cursor: isDisqualified ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {prospect.reachOutStatus === "DRAFTED" ? "✓ View Draft" : "Reach Out"}
            </button>
            <button
              onClick={() => onViewDetails(prospect)}
              style={{
                flex: 1,
                background: T.surface,
                color: T.textSub,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: "7px 0",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              View Details
            </button>
            {!isDisqualified && (
              <button
                onClick={() => onDisqualify(prospect)}
                title="Disqualify"
                style={{
                  background: T.surface,
                  color: T.red,
                  border: `1px solid ${T.redBorder}`,
                  borderRadius: T.radiusSm,
                  padding: "7px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Details Modal ────────────────────────────────────────────────────────────

function DetailsModal({ prospect, onClose }) {
  const qs = prospect.qualificationScore || {};
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: T.surface,
        borderRadius: T.radius,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        width: "100%",
        maxWidth: 640,
        maxHeight: "88vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: T.bg,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <UrgencyBadge level={prospect.urgencyLevel} />
            <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{prospect.name}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textMuted, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>
          {/* Current Situation */}
          <SectionBox title="Current Situation" accent={T.accent}>
            <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: T.textSub }}>Financial Health: </span>
              {prospect.currentSituation?.financialHealth || "—"}
            </div>
            <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: T.textSub }}>Enrollment Trends: </span>
              {prospect.currentSituation?.enrollmentTrends || "—"}
            </div>
            {prospect.currentSituation?.recentNews?.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Recent News</div>
                {prospect.currentSituation.recentNews.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.textSub, marginBottom: 4, paddingLeft: 10, borderLeft: `2px solid ${T.accentBorder}`, lineHeight: 1.5 }}>{n}</div>
                ))}
              </>
            )}
          </SectionBox>

          {/* Qualification Checklist */}
          <SectionBox title="Qualification Checklist" accent={T.green}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <QualCheckItem label="Has LMS"                   value={qs.hasLMS} />
              <QualCheckItem label="Has AI Policy"             value={qs.hasAIPolicy} />
              <QualCheckItem label="Budget Authority ID'd"     value={qs.budgetAuthorityIdentified} />
              <QualCheckItem label="Has Online Programs"       value={qs.hasOnlinePrograms} />
              <QualCheckItem label="Writing-Intensive Pgms"    value={qs.hasWritingIntensivePrograms} />
              <QualCheckItem label="Enrollment Pressure"       value={qs.underEnrollmentPressure} />
              <QualCheckItem label="Accreditation Review"      value={qs.hasAccreditationReview} />
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Fit Score</div>
              <FitBar score={prospect.fitScore} />
            </div>
          </SectionBox>

          {/* Buying Signals */}
          {prospect.buyingSignals?.length > 0 && (
            <SectionBox title="Buying Signals" accent={T.amber}>
              {prospect.buyingSignals.map((s, i) => (
                <div key={i} style={{
                  padding: "8px 10px",
                  background: T.amberBg,
                  border: `1px solid ${T.amberBorder}`,
                  borderRadius: T.radiusSm,
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 13, color: T.text, marginBottom: 2 }}>{s.signal}</div>
                  <div style={{ fontSize: 11, color: T.textSub }}>{[s.source, s.date].filter(Boolean).join(" · ")}</div>
                </div>
              ))}
            </SectionBox>
          )}

          {/* Decision Makers */}
          {prospect.decisionMakers?.length > 0 && (
            <SectionBox title="Decision Makers Found" accent={T.violet}>
              {prospect.decisionMakers.map((dm, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{dm.name}</span>
                  {dm.title  && <span style={{ color: T.textSub }}> — {dm.title}</span>}
                  {dm.source && <span style={{ color: T.textMuted, fontSize: 11 }}> ({dm.source})</span>}
                </div>
              ))}
            </SectionBox>
          )}

          {/* Red Flags */}
          {prospect.redFlagsDetected?.length > 0 && (
            <SectionBox title="Red Flags Detected" accent={T.red}>
              {prospect.redFlagsDetected.map((f, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, display: "flex", gap: 8, marginBottom: 5 }}>
                  <span style={{ color: T.red, flexShrink: 0 }}>✕</span> {f}
                </div>
              ))}
            </SectionBox>
          )}

          {/* Apollo / Company Data */}
          {(prospect.domain || prospect.employeeCount || prospect.location || prospect.industry) && (
            <SectionBox title="Apollo / Company Data" accent={T.pink}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {prospect.domain        && <div style={{ fontSize: 13 }}><span style={{ color: T.textSub, fontWeight: 600 }}>Domain: </span>{prospect.domain}</div>}
                {prospect.employeeCount && <div style={{ fontSize: 13 }}><span style={{ color: T.textSub, fontWeight: 600 }}>Employees: </span>{Number(prospect.employeeCount).toLocaleString()}</div>}
                {prospect.location      && <div style={{ fontSize: 13 }}><span style={{ color: T.textSub, fontWeight: 600 }}>Location: </span>{prospect.location}</div>}
                {prospect.industry      && <div style={{ fontSize: 13 }}><span style={{ color: T.textSub, fontWeight: 600 }}>Industry: </span>{prospect.industry}</div>}
              </div>
            </SectionBox>
          )}

          {/* Alternate Contacts */}
          {prospect.alternateContacts?.length > 0 && (
            <SectionBox title="Alternate Contacts" accent={T.textSub}>
              {prospect.alternateContacts.map((c, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.title && <span style={{ color: T.textSub }}> — {c.title}</span>}
                  {c.email && <span style={{ color: T.accent, fontSize: 12 }}> · {c.email}</span>}
                </div>
              ))}
            </SectionBox>
          )}

          {/* Personalization Hooks */}
          {prospect.personalizationHooks?.length > 0 && (
            <SectionBox title="Personalization Hooks" accent={T.accent}>
              {prospect.personalizationHooks.map((h, i) => (
                <div key={i} style={{ fontSize: 13, color: T.textSub, marginBottom: 6, display: "flex", gap: 8 }}>
                  <span style={{ color: T.accentBorder, flexShrink: 0 }}>◆</span> {h}
                </div>
              ))}
            </SectionBox>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0, background: T.bg }}>
          <button
            onClick={onClose}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              color: T.textSub,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Draft Email Modal ────────────────────────────────────────────────────────

function DraftModal({ draftModal, generatingDraft, onClose, onCopy }) {
  const [editSubject, setEditSubject] = useState(draftModal.subject || "");
  const [editBody,    setEditBody]    = useState(draftModal.body    || "");
  const [copied,      setCopied]      = useState(false);

  useEffect(() => {
    setEditSubject(draftModal.subject || "");
    setEditBody(draftModal.body    || "");
  }, [draftModal.subject, draftModal.body]);

  const handleCopy = () => {
    const text = `Subject: ${editSubject}\n\n${editBody}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy({ subject: editSubject, body: editBody });
    });
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{
        background: T.surface,
        borderRadius: T.radius,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        width: "100%",
        maxWidth: 580,
        maxHeight: "88vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: T.bg,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Draft Email</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
              {draftModal.prospectName}
              {draftModal.contact?.name && <span> · {draftModal.contact.name}</span>}
              {draftModal.contact?.title && <span style={{ color: T.textMuted }}> ({draftModal.contact.title})</span>}
              {draftModal.contact?.email && <span style={{ color: T.accent }}> · {draftModal.contact.email}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textMuted, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>
          {generatingDraft ? (
            <div style={{ textAlign: "center", padding: "48px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <Spinner size={28} />
              <div style={{ fontSize: 13, color: T.textSub }}>Drafting email for {draftModal.prospectName}...</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Subject</label>
                <input
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  style={{
                    width: "100%",
                    border: `1px solid ${T.border}`,
                    borderRadius: T.radiusSm,
                    padding: "8px 12px",
                    fontSize: 13,
                    color: T.text,
                    fontFamily: "inherit",
                    background: T.surface,
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                  onFocus={e  => { e.target.style.borderColor = T.borderFocus; }}
                  onBlur={e   => { e.target.style.borderColor = T.border; }}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Body</label>
                <textarea
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={10}
                  style={{
                    width: "100%",
                    border: `1px solid ${T.border}`,
                    borderRadius: T.radiusSm,
                    padding: "10px 12px",
                    fontSize: 13,
                    color: T.text,
                    fontFamily: "inherit",
                    resize: "vertical",
                    background: T.surface,
                    lineHeight: 1.6,
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                  onFocus={e  => { e.target.style.borderColor = T.borderFocus; }}
                  onBlur={e   => { e.target.style.borderColor = T.border; }}
                />
              </div>
              {draftModal.hooks?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Personalization Hooks</div>
                  {draftModal.hooks.map((h, i) => (
                    <div key={i} style={{ fontSize: 12, color: T.textSub, marginBottom: 4, display: "flex", gap: 6 }}>
                      <span style={{ color: T.accentBorder, flexShrink: 0 }}>◆</span> {h}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {!generatingDraft && (
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, background: T.bg, flexShrink: 0 }}>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? T.greenBg : T.accent,
                color:      copied ? T.green   : "#fff",
                border:     `1px solid ${copied ? T.greenBorder : T.accent}`,
                borderRadius: T.radiusSm,
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {copied ? "✓ Copied!" : "Copy to Clipboard"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                color: T.textSub,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}

// ─── Main IntelPipeline Component ─────────────────────────────────────────────

export default function IntelPipeline({ apiKey, apolloKey }) {
  // State
  const [packages,         setPackages]         = useState(() => loadPackages());
  const [prospects,        setProspects]         = useState(() => loadProspects());
  const [selectedPkgId,    setSelectedPkgId]     = useState(null);
  const [view,             setView]              = useState("upload");
  const [parsing,          setParsing]           = useState(false);
  const [parseError,       setParseError]        = useState(null);
  const [markdownInput,    setMarkdownInput]      = useState("");
  const [researchProgress, setResearchProgress]  = useState({ current: 0, total: 0, currentProspect: "", log: [] });
  const [isResearching,    setIsResearching]      = useState(false);
  const [filterQual,       setFilterQual]         = useState("ALL");
  const [draftModal,       setDraftModal]         = useState(null);
  const [generatingDraft,  setGeneratingDraft]    = useState(false);
  const [detailsModal,     setDetailsModal]       = useState(null);
  const [hoveredPkgId,     setHoveredPkgId]       = useState(null);

  const fileInputRef = useRef(null);
  const logEndRef    = useRef(null);

  // Derived
  const selectedPkg  = packages.find(p => p.id === selectedPkgId) || null;
  const pkgProspects = selectedPkgId ? (prospects[selectedPkgId] || []) : [];

  // Persist to localStorage
  useEffect(() => { savePackages(packages); },  [packages]);
  useEffect(() => { saveProspects(prospects); }, [prospects]);

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [researchProgress.log]);

  // Helpers
  const addLog = useCallback((msg) => {
    setResearchProgress(p => ({ ...p, log: [...p.log.slice(-49), msg] }));
  }, []);

  const updateProspect = useCallback((pkgId, prospectId, updates) => {
    setProspects(prev => ({
      ...prev,
      [pkgId]: (prev[pkgId] || []).map(p => p.id === prospectId ? { ...p, ...updates } : p),
    }));
  }, []);

  // ── Parse Package ──
  const parsePackage = useCallback(async () => {
    if (!markdownInput.trim() || !apiKey || parsing) return;
    setParsing(true);
    setParseError(null);
    try {
      const data = await parsePackageAPI(apiKey, markdownInput);
      const id   = genId();
      const pkg  = {
        id,
        title:                  data.title || "Untitled Package",
        uploadedAt:             Date.now(),
        summary:                data.summary || "",
        icp:                    data.icp || {},
        salesAngles:            data.salesAngles || [],
        namedProspects:         data.namedProspects || [],
        qualificationChecklist: data.qualificationChecklist || [],
        redFlags:               data.redFlags || [],
        rawMarkdown:            markdownInput,
      };
      setPackages(prev => [pkg, ...prev]);
      setSelectedPkgId(id);
      setView("upload");
      setMarkdownInput("");
    } catch (err) {
      setParseError(err.message || "Failed to parse package.");
    } finally {
      setParsing(false);
    }
  }, [markdownInput, apiKey, parsing]);

  // ── Research All ──
  const researchAll = useCallback(async (pkg) => {
    if (!apiKey || isResearching) return;
    setIsResearching(true);
    const total = pkg.namedProspects.length;
    setResearchProgress({ current: 0, total, currentProspect: "", log: [] });

    const initial = pkg.namedProspects.map(np => ({
      id:                    genId(),
      pkgId:                 pkg.id,
      name:                  np.name,
      discoveryContext:      np.context || "",
      urgencyLevel:          np.urgencySignal || "LOW",
      researchStatus:        "PENDING",
      currentSituation:      null,
      qualificationScore:    {},
      redFlagsDetected:      [],
      isDisqualified:        false,
      disqualificationReason: null,
      buyingSignals:         [],
      decisionMakers:        [],
      recommendedSalesAngle: "",
      personalizationHooks:  [],
      fitScore:              null,
      apolloOrgId:           null,
      domain:                null,
      employeeCount:         null,
      industry:              null,
      location:              null,
      primaryContact:        null,
      alternateContacts:     [],
      reachOutStatus:        "NOT_STARTED",
      draftedMessage:        null,
      researchedAt:          null,
    }));

    setProspects(prev => ({ ...prev, [pkg.id]: initial }));
    setView("prospects");

    for (let i = 0; i < initial.length; i++) {
      const p = initial[i];
      setResearchProgress(prev => ({ ...prev, current: i + 1, currentProspect: p.name }));
      addLog(`[${i + 1}/${total}] Researching ${p.name}...`);
      try {
        const result  = await researchProspectAPI(apiKey, apolloKey, p, pkg);
        const updates = {
          researchStatus:        "DONE",
          currentSituation:      result.currentSituation      || { recentNews: [], financialHealth: "Unknown", enrollmentTrends: "Unknown" },
          qualificationScore:    result.qualificationScore    || {},
          redFlagsDetected:      result.redFlagsDetected      || [],
          isDisqualified:        result.isDisqualified        || false,
          disqualificationReason: result.disqualificationReason || null,
          buyingSignals:         result.buyingSignals         || [],
          decisionMakers:        result.decisionMakers        || [],
          recommendedSalesAngle: result.recommendedSalesAngle || "",
          personalizationHooks:  result.personalizationHooks  || [],
          fitScore:              result.fitScore              ?? null,
          apolloOrgId:           result.apolloOrgId           || null,
          domain:                result.domain                || null,
          employeeCount:         result.employeeCount         || null,
          industry:              result.industry              || null,
          location:              result.location              || null,
          primaryContact:        result.primaryContact        || null,
          alternateContacts:     result.alternateContacts     || [],
          researchedAt:          Date.now(),
        };
        updateProspect(pkg.id, p.id, updates);
        addLog(`  ✓ ${p.name} — fit: ${result.fitScore ?? "?"}%`);
      } catch (err) {
        updateProspect(pkg.id, p.id, { researchStatus: "FAILED" });
        addLog(`  ✕ ${p.name} — ${err.message}`);
      }
    }
    setIsResearching(false);
    addLog("Research complete.");
  }, [apiKey, apolloKey, isResearching, addLog, updateProspect]);

  // ── Reach Out / Draft ──
  const handleReachOut = useCallback(async (prospect) => {
    if (!apiKey) return;
    if (prospect.draftedMessage) {
      setDraftModal({
        show: true,
        subject: prospect.draftedMessage.subject,
        body:    prospect.draftedMessage.body,
        contact: prospect.primaryContact,
        prospectName: prospect.name,
        hooks:   prospect.personalizationHooks || [],
      });
      return;
    }
    const modalBase = {
      show: true,
      subject: "",
      body:    "",
      contact: prospect.primaryContact,
      prospectName: prospect.name,
      hooks:   prospect.personalizationHooks || [],
      _prospectId: prospect.id,
      _pkgId:      prospect.pkgId,
    };
    setDraftModal(modalBase);
    setGeneratingDraft(true);
    try {
      const draft = await draftEmailAPI(apiKey, prospect);
      setDraftModal(prev => prev ? { ...prev, subject: draft.subject, body: draft.body } : null);
      updateProspect(prospect.pkgId, prospect.id, {
        draftedMessage: draft,
        reachOutStatus: "DRAFTED",
      });
    } catch (err) {
      setDraftModal(prev => prev ? { ...prev, subject: "Error generating draft", body: err.message } : null);
    } finally {
      setGeneratingDraft(false);
    }
  }, [apiKey, updateProspect]);

  const handleCopyDraft = useCallback(({ subject, body }) => {
    if (draftModal?._prospectId && draftModal?._pkgId) {
      updateProspect(draftModal._pkgId, draftModal._prospectId, {
        draftedMessage: { subject, body },
        reachOutStatus: "DRAFTED",
      });
    }
  }, [draftModal, updateProspect]);

  // ── Disqualify ──
  const handleDisqualify = useCallback((prospect) => {
    const reason = window.prompt(`Disqualification reason for ${prospect.name}? (leave blank for manual)`);
    if (reason === null) return;
    updateProspect(prospect.pkgId, prospect.id, {
      isDisqualified:        true,
      disqualificationReason: reason.trim() || "Manually disqualified",
    });
  }, [updateProspect]);

  // ── Delete Package ──
  const deletePackage = useCallback((pkgId, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this package and all its researched prospects?")) return;
    setPackages(prev => prev.filter(p => p.id !== pkgId));
    setProspects(prev => { const n = { ...prev }; delete n[pkgId]; return n; });
    if (selectedPkgId === pkgId) { setSelectedPkgId(null); setView("upload"); }
  }, [selectedPkgId]);

  // ── File load ──
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => setMarkdownInput(evt.target.result || "");
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // ── Filter counts ──
  const counts = {
    ALL:          pkgProspects.length,
    QUALIFIED:    pkgProspects.filter(p => !p.isDisqualified && p.researchStatus === "DONE").length,
    DISQUALIFIED: pkgProspects.filter(p => p.isDisqualified).length,
    UNRESEARCHED: pkgProspects.filter(p => p.researchStatus === "PENDING").length,
  };

  const filteredProspects = pkgProspects.filter(p => {
    if (filterQual === "QUALIFIED")    return !p.isDisqualified && p.researchStatus === "DONE";
    if (filterQual === "DISQUALIFIED") return p.isDisqualified;
    if (filterQual === "UNRESEARCHED") return p.researchStatus === "PENDING";
    return true;
  });

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes ip-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

        {/* ── Top Header ── */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: "-0.01em" }}>
              Intel Pipeline
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
              Upload a market intelligence package, research named prospects, and draft outreach
            </div>
          </div>
          <button
            onClick={() => { setSelectedPkgId(null); setView("upload"); setMarkdownInput(""); setParseError(null); }}
            style={{
              background: T.accent,
              color: "#fff",
              border: "none",
              borderRadius: T.radiusSm,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.01em",
              flexShrink: 0,
            }}
          >
            + Upload New Package
          </button>
        </div>

        {/* ── Two-column layout ── */}
        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>

          {/* ── Left sidebar ── */}
          <div style={{
            width: 220,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
              padding: "0 2px",
            }}>
              Packages
            </div>

            {packages.length === 0 && (
              <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, padding: "4px 2px" }}>
                No packages yet.
              </div>
            )}

            {packages.map(pkg => {
              const isActive  = pkg.id === selectedPkgId;
              const isHovered = pkg.id === hoveredPkgId;
              const prosCount = (prospects[pkg.id] || []).length;
              return (
                <div
                  key={pkg.id}
                  onClick={() => { setSelectedPkgId(pkg.id); setView(prosCount > 0 ? "prospects" : "upload"); }}
                  onMouseEnter={() => setHoveredPkgId(pkg.id)}
                  onMouseLeave={() => setHoveredPkgId(null)}
                  style={{
                    padding: "9px 10px",
                    borderRadius: T.radiusSm,
                    border: `1px solid ${isActive ? T.accentBorder : (isHovered ? T.border : "transparent")}`,
                    background: isActive ? T.accentBg : (isHovered ? T.bg : "transparent"),
                    cursor: "pointer",
                    position: "relative",
                    marginBottom: 2,
                    transition: "all 0.12s",
                  }}
                >
                  <div style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isActive ? T.accent : T.text,
                    lineHeight: 1.3,
                    paddingRight: 18,
                  }}>
                    {pkg.title}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                    {prosCount} prospects · {timeAgo(pkg.uploadedAt)}
                  </div>
                  <button
                    onClick={e => deletePackage(pkg.id, e)}
                    title="Delete package"
                    style={{
                      position: "absolute",
                      top: 7,
                      right: 6,
                      background: "none",
                      border: "none",
                      fontSize: 15,
                      color: T.textMuted,
                      cursor: "pointer",
                      padding: "0 2px",
                      lineHeight: 1,
                      opacity: (isHovered || isActive) ? 1 : 0,
                      transition: "opacity 0.12s",
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* ── Right content area ── */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>

            {/* View toggle */}
            {selectedPkg && pkgProspects.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {["upload", "prospects"].map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      background:   view === v ? T.accent : T.surface,
                      color:        view === v ? "#fff" : T.textSub,
                      border:       `1px solid ${view === v ? T.accent : T.border}`,
                      borderRadius: T.radiusSm,
                      padding:      "6px 14px",
                      fontSize:     12,
                      fontWeight:   600,
                      cursor:       "pointer",
                      fontFamily:   "inherit",
                    }}
                  >
                    {v === "upload" ? "Package Summary" : `Prospects (${pkgProspects.length})`}
                  </button>
                ))}
              </div>
            )}

            {/* ═══════════ UPLOAD / SUMMARY VIEW ═══════════ */}
            {view === "upload" && (
              <>
                {/* Upload card */}
                <div style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radius,
                  padding: 20,
                  boxShadow: T.shadow,
                  flexShrink: 0,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
                    Paste Intelligence Package Markdown
                  </div>
                  <textarea
                    value={markdownInput}
                    onChange={e => setMarkdownInput(e.target.value)}
                    placeholder="Paste your market intelligence markdown here..."
                    rows={12}
                    style={{
                      width: "100%",
                      border: `1px solid ${T.border}`,
                      borderRadius: T.radiusSm,
                      padding: "12px 14px",
                      fontSize: 12,
                      fontFamily: "ui-monospace, 'SF Mono', monospace",
                      color: T.text,
                      background: T.bg,
                      resize: "vertical",
                      lineHeight: 1.55,
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                    onFocus={e  => { e.target.style.borderColor = T.borderFocus; }}
                    onBlur={e   => { e.target.style.borderColor = T.border; }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={parsePackage}
                      disabled={!markdownInput.trim() || parsing || !apiKey}
                      title={!apiKey ? "Add Anthropic API key to use this feature" : ""}
                      style={{
                        background:   (!markdownInput.trim() || parsing || !apiKey) ? T.bg : T.accent,
                        color:        (!markdownInput.trim() || parsing || !apiKey) ? T.textMuted : "#fff",
                        border:       `1px solid ${(!markdownInput.trim() || parsing || !apiKey) ? T.border : T.accent}`,
                        borderRadius: T.radiusSm,
                        padding:      "8px 18px",
                        fontSize:     13,
                        fontWeight:   600,
                        cursor:       (!markdownInput.trim() || parsing || !apiKey) ? "not-allowed" : "pointer",
                        fontFamily:   "inherit",
                        display:      "flex",
                        alignItems:   "center",
                        gap:          8,
                      }}
                    >
                      {parsing && <Spinner size={14} color={!apiKey ? T.textMuted : "#fff"} />}
                      {parsing ? "Parsing..." : "Parse Package"}
                    </button>
                    <span style={{ fontSize: 12, color: T.textMuted }}>or</span>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        background: T.surface,
                        color:      T.textSub,
                        border:     `1px solid ${T.border}`,
                        borderRadius: T.radiusSm,
                        padding:    "8px 14px",
                        fontSize:   13,
                        fontWeight: 600,
                        cursor:     "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Load .md / .txt
                    </button>
                    <input ref={fileInputRef} type="file" accept=".md,.txt" style={{ display: "none" }} onChange={handleFileChange} />
                    {!apiKey && (
                      <span style={{ fontSize: 12, color: T.amber, fontStyle: "italic" }}>
                        Add Anthropic API key to enable parsing
                      </span>
                    )}
                  </div>
                  {parseError && (
                    <div style={{
                      marginTop: 10,
                      padding: "8px 12px",
                      background: T.redBg,
                      border: `1px solid ${T.redBorder}`,
                      borderRadius: T.radiusSm,
                      fontSize: 12,
                      color: T.red,
                    }}>
                      {parseError}
                    </div>
                  )}
                </div>

                {/* Package summary card */}
                {selectedPkg && (
                  <div style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: T.radius,
                    overflow: "hidden",
                    boxShadow: T.shadow,
                  }}>
                    {/* Package header */}
                    <div style={{
                      padding: "14px 18px",
                      borderBottom: `1px solid ${T.border}`,
                      background: T.accentBg,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                    }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: T.accent }}>{selectedPkg.title}</div>
                        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
                          {selectedPkg.namedProspects.length} named prospects · uploaded {timeAgo(selectedPkg.uploadedAt)}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        {isResearching && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.accent }}>
                            <Spinner size={13} />
                            {researchProgress.currentProspect}...
                          </div>
                        )}
                        <button
                          onClick={() => researchAll(selectedPkg)}
                          disabled={!apiKey || isResearching}
                          title={!apiKey ? "Add Anthropic API key" : ""}
                          style={{
                            background:   (!apiKey || isResearching) ? T.bg : T.green,
                            color:        (!apiKey || isResearching) ? T.textMuted : "#fff",
                            border:       `1px solid ${(!apiKey || isResearching) ? T.border : T.green}`,
                            borderRadius: T.radiusSm,
                            padding:      "8px 16px",
                            fontSize:     12,
                            fontWeight:   700,
                            cursor:       (!apiKey || isResearching) ? "not-allowed" : "pointer",
                            fontFamily:   "inherit",
                            display:      "flex",
                            alignItems:   "center",
                            gap:          8,
                          }}
                        >
                          {isResearching && <Spinner size={12} color="#fff" />}
                          {isResearching
                            ? `${researchProgress.current}/${researchProgress.total}`
                            : `Research All ${selectedPkg.namedProspects.length} Prospects`}
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {isResearching && (
                      <div style={{ background: T.accentBg, paddingBottom: 2 }}>
                        <div style={{ height: 3, background: T.accentBorder }}>
                          <div style={{
                            height: "100%",
                            background: T.accent,
                            width: `${researchProgress.total ? (researchProgress.current / researchProgress.total) * 100 : 0}%`,
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Research log */}
                    {(isResearching || researchProgress.log.length > 0) && (
                      <div style={{ borderBottom: `1px solid ${T.border}`, background: "#0f172a" }}>
                        <div style={{ height: 90, overflowY: "auto", padding: "8px 14px", display: "flex", flexDirection: "column", gap: 1 }}>
                          {researchProgress.log.slice(-12).map((entry, i) => (
                            <div key={i} style={{ fontSize: 11, fontFamily: "ui-monospace, 'SF Mono', monospace", color: "#94a3b8", lineHeight: 1.5 }}>
                              {entry}
                            </div>
                          ))}
                          <div ref={logEndRef} />
                        </div>
                      </div>
                    )}

                    <div style={{ padding: 18 }}>
                      {/* Summary */}
                      <div style={{
                        padding: "10px 14px",
                        background: T.accentBg,
                        border: `1px solid ${T.accentBorder}`,
                        borderRadius: T.radiusSm,
                        fontSize: 13,
                        color: T.text,
                        lineHeight: 1.6,
                        marginBottom: 16,
                      }}>
                        {selectedPkg.summary}
                      </div>

                      {/* ICP chips */}
                      {selectedPkg.icp?.companyTypes?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Company Types</div>
                          <div style={{ display: "flex", flexWrap: "wrap" }}>
                            {selectedPkg.icp.companyTypes.map((t, i) => <Tag key={i}>{t}</Tag>)}
                          </div>
                        </div>
                      )}

                      {/* Qualifying criteria */}
                      {selectedPkg.icp?.qualifyingCriteria?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Qualifying Criteria</div>
                          <div style={{ display: "flex", flexWrap: "wrap" }}>
                            {selectedPkg.icp.qualifyingCriteria.map((c, i) => (
                              <Tag key={i} color={T.green} bg={T.greenBg} border={T.greenBorder}>{c}</Tag>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sales Angles */}
                      {selectedPkg.salesAngles?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Sales Angles</div>
                          {selectedPkg.salesAngles.map((a, i) => (
                            <div key={i} style={{
                              background: T.bg,
                              border: `1px solid ${T.border}`,
                              borderLeft: `3px solid ${T.violetBorder}`,
                              borderRadius: T.radiusSm,
                              padding: "10px 12px",
                              marginBottom: 8,
                            }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: T.violet, marginBottom: 3 }}>{a.name}</div>
                              <div style={{ fontSize: 12, color: T.textSub, marginBottom: 5, lineHeight: 1.5 }}>{a.hypothesis}</div>
                              <div style={{ fontSize: 12, color: T.violet, fontStyle: "italic" }}>&ldquo;{a.hook}&rdquo;</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Named Prospects list */}
                      {selectedPkg.namedProspects?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                            Named Prospects ({selectedPkg.namedProspects.length})
                          </div>
                          {selectedPkg.namedProspects.map((np, i) => {
                            const researched = pkgProspects.find(p => p.name === np.name);
                            const statusColor = researched?.researchStatus === "DONE" ? T.green
                              : researched?.researchStatus === "FAILED" ? T.red
                              : T.textMuted;
                            const statusLabel = researched?.researchStatus === "DONE" ? "✓ Done"
                              : researched?.researchStatus === "FAILED" ? "✕ Failed"
                              : researched ? "Pending" : "";
                            return (
                              <div key={i} style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 10,
                                padding: "8px 0",
                                borderBottom: i < selectedPkg.namedProspects.length - 1 ? `1px solid ${T.border}` : "none",
                              }}>
                                <UrgencyBadge level={np.urgencySignal} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{np.name}</div>
                                  <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>{np.context}</div>
                                </div>
                                {statusLabel && (
                                  <span style={{ fontSize: 11, color: statusColor, fontWeight: 600, flexShrink: 0 }}>{statusLabel}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {!selectedPkg && !parsing && (
                  <div style={{
                    textAlign: "center",
                    padding: "52px 24px",
                    background: T.surface,
                    border: `1px dashed ${T.border}`,
                    borderRadius: T.radius,
                    color: T.textMuted,
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}>
                    Upload an intelligence package to get started.<br />
                    Paste or drop a markdown file above.
                  </div>
                )}
              </>
            )}

            {/* ═══════════ PROSPECTS VIEW ═══════════ */}
            {view === "prospects" && selectedPkg && (
              <>
                {/* Filter tabs */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  {[
                    { key: "ALL",          label: `All ${counts.ALL}` },
                    { key: "QUALIFIED",    label: `Qualified ${counts.QUALIFIED}` },
                    { key: "UNRESEARCHED", label: `Unresearched ${counts.UNRESEARCHED}` },
                    { key: "DISQUALIFIED", label: `Disqualified ${counts.DISQUALIFIED}` },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setFilterQual(key)}
                      style={{
                        background:   filterQual === key ? T.accent : T.surface,
                        color:        filterQual === key ? "#fff"   : T.textSub,
                        border:       `1px solid ${filterQual === key ? T.accent : T.border}`,
                        borderRadius: T.radiusSm,
                        padding:      "6px 14px",
                        fontSize:     12,
                        fontWeight:   600,
                        cursor:       "pointer",
                        fontFamily:   "inherit",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Research button shortcut if still pending */}
                {counts.UNRESEARCHED > 0 && !isResearching && (
                  <div style={{
                    padding: "10px 14px",
                    background: T.amberBg,
                    border: `1px solid ${T.amberBorder}`,
                    borderRadius: T.radiusSm,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}>
                    <span style={{ fontSize: 13, color: T.amber }}>
                      {counts.UNRESEARCHED} prospect{counts.UNRESEARCHED !== 1 ? "s" : ""} not yet researched.
                    </span>
                    <button
                      onClick={() => researchAll(selectedPkg)}
                      disabled={!apiKey}
                      style={{
                        background: apiKey ? T.amber : T.bg,
                        color:      apiKey ? "#fff"  : T.textMuted,
                        border: "none",
                        borderRadius: T.radiusSm,
                        padding: "6px 14px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: apiKey ? "pointer" : "not-allowed",
                        fontFamily: "inherit",
                      }}
                    >
                      Research All
                    </button>
                  </div>
                )}

                {/* Active research progress banner */}
                {isResearching && (
                  <div style={{
                    padding: "10px 14px",
                    background: T.accentBg,
                    border: `1px solid ${T.accentBorder}`,
                    borderRadius: T.radiusSm,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}>
                    <Spinner size={14} />
                    <span style={{ fontSize: 13, color: T.accent, fontWeight: 600 }}>
                      Researching {researchProgress.currentProspect}...
                    </span>
                    <span style={{ fontSize: 12, color: T.textMuted, marginLeft: "auto" }}>
                      {researchProgress.current}/{researchProgress.total}
                    </span>
                  </div>
                )}

                {/* Prospect grid */}
                {filteredProspects.length === 0 ? (
                  <div style={{
                    textAlign: "center",
                    padding: "40px 24px",
                    background: T.surface,
                    border: `1px dashed ${T.border}`,
                    borderRadius: T.radius,
                    color: T.textMuted,
                    fontSize: 13,
                  }}>
                    {filterQual === "QUALIFIED"    ? "No qualified prospects yet." :
                     filterQual === "DISQUALIFIED" ? "No disqualified prospects." :
                     filterQual === "UNRESEARCHED" ? "All prospects have been researched." :
                     "No prospects for this package."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                    {filteredProspects.map(p => (
                      <ProspectCard
                        key={p.id}
                        prospect={p}
                        onReachOut={handleReachOut}
                        onViewDetails={setDetailsModal}
                        onDisqualify={handleDisqualify}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {draftModal?.show && (
        <DraftModal
          draftModal={draftModal}
          generatingDraft={generatingDraft}
          onClose={() => { setDraftModal(null); setGeneratingDraft(false); }}
          onCopy={handleCopyDraft}
        />
      )}
      {detailsModal && (
        <DetailsModal
          prospect={detailsModal}
          onClose={() => setDetailsModal(null)}
        />
      )}
    </>
  );
}
