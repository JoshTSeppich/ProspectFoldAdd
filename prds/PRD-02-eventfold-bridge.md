# PRD-02 · EventFold Bridge (Clipboard Autofill)

**Feature:** One-click transfer of prospect intel filters from ProspectFold to EventFold CRM's Apollo Search
**Status:** Shipped v1 (ProspectFold side) / Integration guide shipped (EventFold side)
**Owner:** Foxworks Studios

---

## Problem

ProspectFold generates AI-tuned Apollo search filters (industry, target titles, seniority, keywords). EventFold CRM has an Apollo Search page where you run those filters to find people. Without a bridge, the user has to manually read the filters from ProspectFold and retype them into EventFold — a friction point that breaks flow and introduces typos.

The bridge eliminates that. One click in ProspectFold, one click in EventFold, filters are populated.

---

## Design Decision: Clipboard over Deep Link

Two approaches were evaluated:

| Approach | ProspectFold change | EventFold change | OS registration |
|----------|--------------------|--------------------|-----------------|
| **Deep link** (`eventfold://`) | `shell.openExternal(url)` | Cargo.toml dep + tauri.conf.json + lib.rs + TSX | Required (must build + install) |
| **Clipboard JSON** | `navigator.clipboard.writeText(json)` | TSX only | None |

**Clipboard was chosen** because:
- Zero Rust/config changes needed in EventFold — a single TSX file edit
- No OS-level URL scheme registration (no build + install required to test)
- Easier for a second developer to integrate into the EventFold repo independently
- Just as fast from a UX standpoint — two button clicks vs. one

---

## Clipboard Payload

ProspectFold writes the following JSON to the clipboard when "→ EventFold" is clicked:

```json
{
  "__prospect_intel": true,
  "industry": "Technology, Software",
  "titles": "CTO, VP Engineering, Head of Product",
  "seniority": "director, vp, c_suite",
  "keywords": "AI, machine learning, OpenAI"
}
```

**Field mapping to EventFold's `FilterFormState`:**

| Payload field | EventFold filter field | Notes |
|--------------|----------------------|-------|
| `industry` | `industry` | Comma-separated string |
| `titles` | `titles` | Maps to `person_titles` in Apollo API |
| `seniority` | `seniority` | Maps to Apollo seniority filter |
| `keywords` | _(not currently mapped)_ | Available for future use |

**The `__prospect_intel: true` flag** is a namespace guard. Without it, clicking "Paste" on arbitrary clipboard content would silently fill the form with garbage. EventFold silently ignores any clipboard content that doesn't have this flag set to `true`.

---

## ProspectFold Implementation

**Trigger:** "→ EventFold" button on each Apollo SearchCard (Apollo tab only)

**Source data:** `item.filters` from the AI-generated intel package
```js
const payload = JSON.stringify({
  __prospect_intel: true,
  industry:  item.filters?.industry       || "",
  titles:    item.filters?.person_titles  || "",
  seniority: item.filters?.seniority      || "",
  keywords:  item.filters?.keywords       || "",
});
await navigator.clipboard.writeText(payload);
```

**Visual feedback:** Button flashes from indigo "→ EventFold" to green "✓ Copied" for 2 seconds, then reverts. No toast or modal — the button state change is sufficient feedback for a power user.

**Location:** Top-right of each Apollo SearchCard, to the left of "Search Live"

---

## EventFold Implementation

See `PROSPECT_INTEL_INTEGRATION.md` in this repo for the copy-paste integration guide.

**Summary of changes to `ApolloSearch.tsx`:**

1. Add `ClipboardDocumentIcon` to heroicons import
2. Add `autofillToast` state: `const [autofillToast, setAutofillToast] = useState(false)`
3. Add `pasteFromProspect` callback:
```ts
const pasteFromProspect = useCallback(async () => {
    try {
        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text) as Record<string, unknown>;
        if (data.__prospect_intel !== true) return;
        setFilters((prev) => ({
            ...prev,
            industry:  typeof data.industry  === "string" && data.industry  ? data.industry  : prev.industry,
            titles:    typeof data.titles    === "string" && data.titles    ? data.titles    : prev.titles,
            seniority: typeof data.seniority === "string" && data.seniority ? data.seniority : prev.seniority,
        }));
        setFiltersVisible(true);
        setAutofillToast(true);
        setTimeout(() => setAutofillToast(false), TOAST_DURATION_MS);
    } catch { /* clipboard empty or non-JSON — silently ignore */ }
}, []);
```
4. Add "Paste from Prospect Intel" button next to existing "Hide Filters" button
5. Add autofill toast above the save-success toast

**No changes to:** Cargo.toml, tauri.conf.json, src/lib.rs, capabilities, package.json

---

## User Flow

```
ProspectFold
  1. Generate intel for NAICS 541511
  2. Open Apollo tab
  3. See SearchCard: "Series A SaaS with Engineering Teams"
     filters: industry=Technology, titles=CTO VP Engineering, seniority=c_suite director
  4. Click "→ EventFold" → button flashes "✓ Copied"

EventFold
  5. Navigate to Apollo Search
  6. Click "Paste from Prospect Intel"
  7. Industry, Title/Role, Seniority fields auto-fill
  8. Toast: "Fields loaded from Prospect Intelligence"
  9. Click Search → results appear
```

Total time from ProspectFold click to EventFold search: ~5 seconds

---

## Future Improvements

- **Keywords mapping** — currently written to payload but not mapped to a filter field in EventFold. Map to `companyName` or a future keywords filter when EventFold adds it.
- **Multi-filter transfer** — allow transferring all Apollo SearchCards at once as a saved search preset in EventFold, not just the one clicked
- **Deal pre-fill** — extend the payload to include company name + angle name → pre-populate a new EventFold Deal record
- **Payload versioning** — add `"__version": 1` to the payload for forward compatibility as the schema evolves
