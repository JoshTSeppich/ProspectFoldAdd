# PRD-FF-10: Intel → Feature Request Bridge

**Status:** Ready for implementation
**Priority:** High (strategic)
**Effort:** ~1.5 days

---

## Problem

The Intel pipeline and Feature Request generator are two separate workflows with no connection. A user who runs an Intel brief on a prospect — learning their company, pain points, tech signals — has to mentally re-transcribe all of that context when switching to the Feature Request generator. There is no "take what I just learned about this client and scope a feature for them" action.

This is the highest-leverage workflow gap in the product. The Intel pipeline produces exactly the signals that make Feature Fold's prospect context field valuable. Bridging them means one click converts "I found a good prospect" into "here's what we'd build for them."

---

## User Flow

1. User runs Intel pipeline on a company/prospect
2. Results appear: contacts, qualification checklist, strategy summary
3. A **"Scope a Feature →"** button appears in the Intel results panel
4. Clicking it:
   - Switches to the Feature Request tab
   - Pre-fills `prospectName` with the company name (extracted from the Intel run)
   - Pre-fills `prospectNotes` with a condensed summary of the intel (pain signals, company context, tech stack mentions)
   - Focuses the feature idea textarea
5. User types the feature idea with context already loaded
6. Generation is aware of who this client is and what they care about

---

## Tickets

### FF-10-T1 — Extract bridgeable context from Intel run

**File:** `src/App.jsx`
**Effort:** 45 minutes

After a successful Intel run, extract the fields needed for the bridge:

**Company name:** The Intel pipeline already extracts Apollo queries with company names. Use the first company name from the `queryLog` or from the markdown's title/header line.

**Context summary:** Combine:
- Company size and industry (from first contact's data, or from the strategy summary)
- Top pain signal from the strategy synthesis stage
- Any tech stack mentions from the Intel pack

Build a `bridgeContext` object in state after a successful Intel run:
```js
const [bridgeContext, setBridgeContext] = useState(null);
// { companyName: string, notes: string }
```

Populate after `run()` completes:
```js
const bridgeCtx = buildBridgeContext(queryLog, contacts, pipelineLog);
setBridgeContext(bridgeCtx);
```

`buildBridgeContext` is a pure function:
```js
function buildBridgeContext(queryLog, contacts, pipelineLog) {
  const companyName = queryLog[0]?.label || "";
  const firstContact = contacts[0];
  const industry = firstContact?.industry || "";
  const size = firstContact?.companySize ? `${firstContact.companySize} employees` : "";
  // Extract strategy synthesis from pipelineLog
  const stratEntry = pipelineLog.find(e => e.stage === "sonnet");
  const stratSummary = stratEntry?.data?.slice(0, 300) || "";
  const notes = [industry, size, stratSummary].filter(Boolean).join(". ");
  return companyName ? { companyName, notes } : null;
}
```

**Acceptance criteria:**
- [ ] `bridgeContext` is set after a successful Intel run
- [ ] `bridgeContext` is null before any run or after pipeline reset
- [ ] Company name matches the primary target from the run

---

### FF-10-T2 — "Scope a Feature →" button in Intel results

**File:** `src/App.jsx`
**Effort:** 30 minutes

Add a "Scope a Feature →" button to the Intel results panel, visible only when `bridgeContext` is set (i.e., a run has completed). Position it in the results header area alongside the existing filter/export controls.

The button is styled as a secondary action (outlined, accent color) to not compete with the primary contact export flow.

On click:
```js
const handleBridgeToFeature = () => {
  if (!bridgeContext) return;
  setView("feature_request");
  // Signal to FeatureRequestView to pre-fill — handled via shared state or props
};
```

**Acceptance criteria:**
- [ ] Button visible after successful Intel run
- [ ] Button not visible before a run or when no results
- [ ] Clicking switches to Feature Request tab

---

### FF-10-T3 — Pre-fill Feature Request view from bridge context

**File:** `src/App.jsx`
**Effort:** 45 minutes

Pass `bridgeContext` down to `FeatureRequestView` as a prop. When the component receives a non-null `bridgeContext` for the first time (or when it changes), pre-fill `prospectName` and `prospectNotes` and expand the Client Context panel.

```jsx
<FeatureRequestView
  c={c}
  onOpenSettings={() => setShowSettings(true)}
  bridgeContext={bridgeContext}
  onClearBridge={() => setBridgeContext(null)}
/>
```

Inside `FeatureRequestView`, use a `useEffect` on `bridgeContext`:
```js
useEffect(() => {
  if (!bridgeContext) return;
  setProspectName(bridgeContext.companyName);
  setProspectNotes(bridgeContext.notes);
  setContextOpen(true);
  // Focus the idea textarea
  ideaRef.current?.focus();
}, [bridgeContext]);
```

Add a `useRef` to the idea textarea for the focus call.

Show a dismissible banner at the top of the input view when bridged:
```
Context loaded from Intel run for [Company Name]  [×]
```
Clicking `×` calls `onClearBridge()` which resets `bridgeContext` to null and clears the pre-filled fields.

**Acceptance criteria:**
- [ ] Switching via bridge pre-fills client name and notes
- [ ] Client Context panel auto-expands when bridged
- [ ] Idea textarea is focused immediately
- [ ] Bridge banner visible at top of input view with dismiss button
- [ ] Dismissing clears the bridge context and pre-filled fields
- [ ] Manual edits to prospect fields are not overwritten after initial fill
