# PRD-FF-05: Security Hardening

**Status:** Ready for implementation
**Priority:** Critical / Blocking
**Effort:** ~1 day

---

## Problem

Feature Fold has three security issues that block client-facing use and demo readiness:

1. **CSP is null** — `tauri.conf.json` sets `"csp": null`, leaving the Tauri WebView without any Content Security Policy. Any JavaScript in AI-generated content, GitHub API responses, or injected via network interception executes without restriction. Since the app holds API keys accessible via IPC, a successful XSS could call `get_credential` and exfiltrate secrets.

2. **Apollo API key hardcoded in source** — `App.jsx` line 26 contains `const APOLLO_KEY = "TlHGetzVDxtVJTl_OZNGCQ"` as a plain string literal. This key is committed to git and readable by anyone with repo access.

3. **Keychain service name collision** — `credentials.rs` uses `"eventfold"` as the keychain service identifier, inherited from the app's earlier name. If other Foxworks tools use the same service name, credentials collide silently. The correct identifier matches the app bundle: `"dev.foxworks.finalfold"`.

---

## Goals

- Set a minimal, correct CSP that permits only known external connections
- Move the Apollo API key from source code into the OS keychain
- Rename the keychain service to the canonical app bundle identifier
- No regression in functionality (all API integrations continue to work)

---

## Non-Goals

- Certificate pinning for API endpoints (out of scope for this PRD)
- Migrating the Intel pipeline's Anthropic key from localStorage (tracked separately)
- Adding an operation audit log (future PRD)

---

## Tickets

### FF-05-T1 — Set Content Security Policy in tauri.conf.json

**File:** `src-tauri/tauri.conf.json`
**Effort:** 15 minutes
**Severity:** Critical

**What:** Replace `"csp": null` with a minimal CSP string that allows exactly the external connections the app needs.

**Required origins:**
- `https://api.anthropic.com` — Claude API
- `https://api.github.com` — GitHub Issues API
- `https://api.apollo.io` — Apollo people search
- `https://app.apollo.io` — Apollo (if any redirect URLs are opened)

**Implementation:**
```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; connect-src 'self' https://api.anthropic.com https://api.github.com https://api.apollo.io; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
}
```

Note: `'unsafe-inline'` for styles is required because the entire app uses inline styles. `img-src data:` permits base64 images if any are used. This CSP blocks all unexpected `connect-src` targets.

**Acceptance criteria:**
- [ ] App builds and runs with CSP enabled
- [ ] Claude generation works (Anthropic API reachable)
- [ ] GitHub issue creation works (GitHub API reachable)
- [ ] Apollo search works (Apollo API reachable)
- [ ] Opening external URLs via `open_url` still works (uses system browser, not WebView fetch)
- [ ] No CSP violations appear in Tauri WebView console

---

### FF-05-T2 — Move Apollo API key from source to OS keychain

**Files:** `src/App.jsx`, `src-tauri/src/credentials.rs` (no changes needed), `src-tauri/src/lib.rs` (no changes needed)
**Effort:** 2-3 hours
**Severity:** High

**What:** Remove the hardcoded `APOLLO_KEY` constant from `App.jsx`. Replace all usages with a keychain read at startup. Add an Apollo key field to the existing Settings modal. The key is read once on app load and stored in component state, exactly as the Anthropic key is handled for the Intel pipeline.

**Current state:**
```js
const APOLLO_KEY = "TlHGetzVDxtVJTl_OZNGCQ"; // line 26 — must be removed
```

**Implementation:**
1. Remove `const APOLLO_KEY` line
2. Add `apolloKey` to app state: `const [apolloKey, setApolloKey] = useState("")`
3. On app mount, call `invoke("get_credential", { key: "apollo_key" })` and set state
4. Replace all `APOLLO_KEY` references with `apolloKey` state variable
5. Add "Apollo API Key" field to Settings modal with save/clear behavior matching the existing Anthropic/GitHub key fields
6. On save, call `invoke("save_credential", { key: "apollo_key", value: newKey })`

**Migration note:** Existing users with the hardcoded key will need to re-enter it in Settings once. Add a note in the Settings modal: "Apollo API key is now stored securely in the OS keychain."

**Acceptance criteria:**
- [ ] `const APOLLO_KEY` does not appear anywhere in tracked source files
- [ ] Apollo key is saved/retrieved via `save_credential` / `get_credential` with key `"apollo_key"`
- [ ] Settings modal shows Apollo key field with the same UX as other credential fields
- [ ] If Apollo key is not set, Intel pipeline shows a clear error message
- [ ] Apollo searches work when key is set via Settings

---

### FF-05-T3 — Rename keychain service identifier

**File:** `src-tauri/src/credentials.rs`
**Effort:** 10 minutes
**Severity:** High

**What:** Change `const KEYCHAIN_SERVICE: &str = "eventfold"` to `"dev.foxworks.finalfold"` to match the app bundle identifier and prevent credential collision with other tools using the `"eventfold"` service name.

**Migration:** Existing saved credentials under the old service name will not be found after this change. Users will need to re-enter their API keys once. This is acceptable since it also forces re-entry of any credentials stored under the old service, ensuring the migration is clean.

**Implementation:**
```rust
const KEYCHAIN_SERVICE: &str = "dev.foxworks.finalfold";
```

**Acceptance criteria:**
- [ ] Credentials are saved and retrieved under service `"dev.foxworks.finalfold"`
- [ ] Old `"eventfold"` entries do not interfere
- [ ] App prompts for re-entry of credentials on first launch after update (expected behavior)

---

## Testing

Manual test sequence after all three tickets:
1. Fresh build — verify CSP is active (check DevTools console for violations)
2. Open Settings → enter Anthropic key → save → verify keychain entry created under `dev.foxworks.finalfold`
3. Enter Apollo key → save → verify Intel pipeline works
4. Enter GitHub PAT → save → verify issue creation works
5. Restart app → verify all credentials are retrieved correctly from keychain
6. Attempt a CSP-violating fetch from the DevTools console — verify it is blocked
