# PRD 01 — ProspectCrafter App
**Status:** Ready to build
**Owner:** Foxworks Studios
**Stack:** Vite + React + prospect-crafter.jsx

---

## Problem

`prospect-crafter.jsx` exists as a standalone component with no project scaffold. It can't be run, tested, or shipped without a host app. The current file calls the Anthropic API directly from the browser and has no entry point, routing, or build pipeline.

---

## Goal

Wrap `prospect-crafter.jsx` in a minimal Vite+React project that can be:
- Run locally in development
- Built to a static bundle
- Embedded in EventFold CRM as a webview (Electron)

---

## Scope

### In scope
- Vite + React scaffold (`index.html`, `main.jsx`, `App.jsx`, `vite.config.js`, `package.json`)
- `ProspectCrafter` mounted as the root component
- `.env` support for `VITE_ANTHROPIC_KEY` as fallback (user-entered key takes priority)
- `launch.json` entry for the dev server
- Production build to `dist/`

### Out of scope
- Auth / user accounts
- Persisting results to a database
- Multi-tab or routing
- Sharing / exporting results (separate PRD)

---

## Functional Requirements

| ID | Requirement |
|----|-------------|
| F1 | `npm run dev` starts the app on port 5173 |
| F2 | API key entered in-app is saved to `localStorage` and survives refresh |
| F3 | If `VITE_ANTHROPIC_KEY` is set in `.env`, pre-populate the key field |
| F4 | `npm run build` produces a static bundle in `dist/` that EventFold can load as a local webview |
| F5 | App renders correctly at 860px max-width (current component design) |
| F6 | Hot reload works during development |

---

## Non-Functional Requirements

- Zero external UI libraries — inline styles only (already the case in the component)
- Bundle size target: <500KB gzipped
- No backend required — all API calls go directly to Anthropic from the browser

---

## File Structure

```
ProspectFold/
├── index.html
├── main.jsx
├── App.jsx
├── prospect-crafter.jsx        ← existing, no changes needed
├── vite.config.js
├── package.json
├── .env.example
├── .gitignore
├── .claude/
│   └── launch.json             ← dev server config
└── prd/
    └── 01-prospect-crafter-app.md
```

---

## API Key Precedence

```
1. User-entered key (localStorage)   ← highest priority
2. VITE_ANTHROPIC_KEY in .env        ← fallback for local dev
3. Empty — user sees prompt to add key
```

---

## Acceptance Criteria

- [ ] `npm install && npm run dev` works from a fresh clone
- [ ] Entering a valid Anthropic API key and submitting a target description returns rendered results
- [ ] Refreshing the page preserves the API key
- [ ] `npm run build` completes without errors
- [ ] Built `dist/index.html` opens correctly when loaded as a local file in Electron
