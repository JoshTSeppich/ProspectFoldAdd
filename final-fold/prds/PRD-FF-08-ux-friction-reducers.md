# PRD-FF-08: UX Friction Reducers

**Status:** Ready for implementation
**Priority:** High
**Effort:** ~1 day

---

## Problem

Five small gaps that collectively make the tool slower and less trustworthy in daily use:

1. Every generation requires a mouse click on the Generate button — no keyboard path
2. Dark/light mode resets to dark on every launch
3. Clicking Done clears repo and prospect context — the natural next action (another feature for the same client) requires re-entering everything
4. Saved repos accumulate with no delete option — `delete_saved_repo` exists in Rust but has no UI
5. Acceptance criteria in Preview are read-only checkboxes — they're in the schema and editable in the Rust structs but the frontend never lets you change them before publish

---

## Tickets

### FF-08-T1 — Cmd+Enter to generate

**File:** `src/App.jsx`
**Effort:** 15 minutes

Add a `keydown` listener inside `FeatureRequestView` that fires `handleGenerate` when the user presses `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux) while in the input sub-view. Only active when `canGenerate` is true.

```js
useEffect(() => {
  if (subView !== "input") return;
  const handler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGenerate) {
      handleGenerate();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [subView, canGenerate, handleGenerate]);
```

Show a hint below the Generate button: `⌘↵ to generate`

**Acceptance criteria:**
- [ ] Cmd+Enter triggers generation when a repo is selected and idea is ≥10 chars
- [ ] Does nothing when canGenerate is false
- [ ] Hint visible below Generate button

---

### FF-08-T2 — Persist dark/light mode preference

**File:** `src/App.jsx`
**Effort:** 5 minutes

Initialize `isDark` from localStorage. Save to localStorage on toggle.

```js
const [isDark, setIsDark] = useState(() =>
  localStorage.getItem("ff_theme") !== "light"
);

// On toggle:
const toggleTheme = () => {
  setIsDark(d => {
    const next = !d;
    localStorage.setItem("ff_theme", next ? "dark" : "light");
    return next;
  });
};
```

**Acceptance criteria:**
- [ ] Theme preference survives app restart
- [ ] Defaults to dark if no preference stored

---

### FF-08-T3 — Done preserves repo and prospect context

**File:** `src/App.jsx`
**Effort:** 10 minutes

`handleDone` currently resets everything including `ideaText`, `prospectName`, `prospectNotes`, and the selected repo. The correct behavior: reset only the generated output and idea text. Keep repo and prospect context so the next generation for the same client starts without re-entry.

```js
const handleDone = () => {
  setSubView("input");
  setGenOutput(null);
  setEditedIssues([]);
  setIssueResults([]);
  setGenError(null);
  setIdeaText("");
  // prospectName, prospectNotes, selectedRepo intentionally preserved
};
```

**Acceptance criteria:**
- [ ] After Done, repo selector retains selection
- [ ] Client name and notes retain their values
- [ ] Feature idea textarea is cleared
- [ ] Generated issues and brief are cleared

---

### FF-08-T4 — Repo deletion UI

**File:** `src/App.jsx`
**Effort:** 30 minutes

Replace the plain `<select>` for saved repos with a list of styled rows, each with an `×` delete button that calls `delete_saved_repo`. This also removes the select element's constraint of showing one item at a time and makes the repo list scannable.

UI: vertical list of repo rows in the left panel. Each row: `[repo label] [×]`. Selected row is highlighted. Clicking a row selects it; clicking `×` deletes after a brief confirmation (inline "Are you sure?" toggle, not a modal).

**Acceptance criteria:**
- [ ] Each saved repo has a visible delete control
- [ ] Deleting a repo removes it from SQLite and the list immediately
- [ ] If the deleted repo was selected, selection clears
- [ ] Empty state shows "No repos saved" with the Add button prominent

---

### FF-08-T5 — Editable acceptance criteria in Preview

**File:** `src/App.jsx`
**Effort:** 45 minutes

Acceptance criteria are currently rendered as read-only `☐` checkboxes in the Preview view. They should be editable text inputs, matching the editability of `title` and `body`. Each criterion gets its own input. Add/remove buttons for individual criteria.

Update `updateIssue` to handle the `acceptance_criteria` array:
```js
const updateCriterion = (issueIdx, acIdx, value) => {
  setEditedIssues(prev => prev.map((iss, i) =>
    i === issueIdx
      ? { ...iss, acceptance_criteria: iss.acceptance_criteria.map((ac, j) => j === acIdx ? value : ac) }
      : iss
  ));
};
const addCriterion = (issueIdx) => {
  setEditedIssues(prev => prev.map((iss, i) =>
    i === issueIdx ? { ...iss, acceptance_criteria: [...iss.acceptance_criteria, ""] } : iss
  ));
};
const removeCriterion = (issueIdx, acIdx) => {
  setEditedIssues(prev => prev.map((iss, i) =>
    i === issueIdx
      ? { ...iss, acceptance_criteria: iss.acceptance_criteria.filter((_, j) => j !== acIdx) }
      : iss
  ));
};
```

**Acceptance criteria:**
- [ ] Each AC item is an editable text input
- [ ] Add criterion button appends a blank item
- [ ] Remove button (×) deletes individual criteria
- [ ] Changes persist through to GitHub issue body via `format_issue_body` in `github.rs`
