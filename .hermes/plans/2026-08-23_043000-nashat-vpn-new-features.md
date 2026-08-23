# Nashat VPN — New Features Roadmap (Implementation Plan)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add high-value, user-visible features to the Nashat VPN desktop app (Electron + sing-box) so it feels like a polished consumer VPN, while keeping the "free, no account, community servers, working-only" guarantee.

**Architecture:** The app is a single-window Electron app. `desktop/src/main.ts` owns the engine (sing-box), Windows system-proxy control, IPC handlers, health guard, and auto-updater. `desktop/src/renderer.tsx` is the React UI; `desktop/src/preload.ts` exposes a `window.nashat` bridge; `desktop/src/i18n.ts` holds en/ar/ckb strings + region map; `desktop/src/styles.css` is the Linear-style dark theme. Server list comes from `directory/community.json` (built by `directory/fetch-community.js`, full-verified at build time). New features hook in via IPC handlers in `main.ts` + matching UI in `renderer.tsx` + strings in `i18n.ts`.

**Tech Stack:** Electron 31, React 18, TypeScript, sing-box v1.13 (engine), electron-updater, Node `net`/`child_process` for diagnostics, Windows `netsh` for firewall/kill-switch.

---

## Current capabilities (baseline)
- Country picker with region tabs (Europe/Asia/MidEast/Americas/Africa/Oceania)
- Connect with 5-node smart retry + real tunnel verify; only "Protected" if data flows
- Health guard: dead countries → offline shelf, auto-restore after 30 min
- About page + live "Check for update" → silent auto-update on close
- Manual import of `vless/vmess/trojan/ss/hysteria2` links
- i18n en/ar/ckb with RTL
- Daily GitHub Action rebuilds `community.json` (alive-only, ms = real latency)
- `scripts/build-europe.js` deep-verifies all European countries (exists, not yet wired to CI)

## Assumptions
- User runs Windows 10/11 (x64). Kill-switch/firewall steps are Windows-only.
- `community.json` is the single source of truth for locations.
- No backend, no accounts — all logic is local + public GitHub sources.

---

## Phase 1 — Engagement & Convenience (highest value, low risk)

### Feature A: Favorites (pin countries to top)
**Objective:** Let users star countries; pinned ones sort above the rest and persist across launches. (Star icon already exists in UI but is unused.)

**Files:**
- Modify: `desktop/src/main.ts` (add `favorites` array to settings; `ipcMain.handle('app:toggleFavorite')`, `app:getFavorites`)
- Modify: `desktop/src/preload.ts` (expose `toggleFavorite`, `getFavorites`)
- Modify: `desktop/src/renderer.tsx` (star button in country card; sort favorites first)
- Modify: `desktop/src/i18n.ts` (add `favorite`, `favorites` strings ×3 langs)
- Modify: `desktop/src/styles.css` (`.country-card.pinned` highlight)

**Steps (bites):**
1. In `main.ts` `loadSettings()` default add `favorites: []`. Add handler `app:toggleFavorite(_e, code)` that flips membership and saves.
2. In `preload.ts` add `toggleFavorite(code): Promise<void>` and `getFavorites(): Promise<string[]>`.
3. In `renderer.tsx`, render a star button on each card calling `toggleFavorite`; read favorites from state; sort selected list so favorites first.
4. In `i18n.ts` add keys; in `styles.css` add pinned style (left accent border, subtle glow).
5. Commit: `feat: persist and surface favorite countries`.

**Validation:** Launch app, star 🇸🇪 SE → it jumps to top of its region and of "All"; restart app → still pinned.

---

### Feature B: Auto-connect on launch + Start with Windows
**Objective:** Two toggles in Settings: "Connect on open" and "Launch at system startup".

**Files:**
- Modify: `desktop/src/main.ts` (settings `autoConnect`, `launchAtBoot`; on `app.whenReady` if `autoConnect` call `connect()`; `app.setLoginItemSettings({ openAtLogin: true })` when toggled)
- Modify: `desktop/src/preload.ts` (`setAutoConnect`, `setLaunchAtBoot`)
- Modify: `desktop/src/renderer.tsx` (two switches in Settings)
- Modify: `desktop/src/i18n.ts` (`autoConnect`, `launchAtBoot` ×3)

**Steps:**
1. Add `app:setAutoConnect(_e, on)` → save setting; `app:setLaunchAtBoot(_e, on)` → `app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath })`.
2. After window ready in `main.ts`, if `settings.autoConnect && settings.countryCode` → `connect()`.
3. UI switches wired to handlers; reflect current state on open.
4. Commit: `feat: auto-connect and launch-at-startup toggles`.

**Validation:** Enable both, close app, reboot Windows (or re-open) → app starts, connects automatically to last country.

**Risk:** `openAtLogin` path must be the installed exe, not the unpacked dev path. Guard with `if (!app.isPackaged) return;`.

---

### Feature C: System Tray + Minimize to tray
**Objective:** App lives in the Windows tray; connect/disconnect/status from tray menu; closing window hides to tray (quit from tray).

**Files:**
- Modify: `desktop/src/main.ts` (create `Tray` with `Menu`; `win.on('close')` preventDefault + `win.hide()` unless `reallyQuit`; `app.on('before-quit')`)
- Modify: `desktop/src/i18n.ts` (`trayConnect`, `trayDisconnect`, `trayShow`, `trayQuit` ×3)
- Add: tray icon asset (use existing `public/icon.ico` or `assets/icons/nashatvpn.webp`; tray needs `.ico`/PNG).

**Steps:**
1. Build tray in `createWindow()` after `win` exists: `const tray = new Tray(iconPath); tray.setContextMenu(Menu.buildFromTemplate([{label, click: ()=>connect()}, ...]))`.
2. `win.on('close', e => { if(!appQuitting){ e.preventDefault(); win.hide(); } })`.
3. Tray double-click → `win.show()`.
4. Commit: `feat: system tray with connect/disconnect and minimize-to-tray`.

**Validation:** Connect in-app, minimize → window gone, tray icon green; right-click tray → Disconnect works; quit from tray fully closes (verify no sing-box.exe left).

---

## Phase 2 — Trust & Safety (differentiators)

### Feature D: Real Kill Switch (fail-closed)
**Objective:** When connected, block all direct outbound traffic so nothing leaks if the tunnel drops. Implemented via Windows `netsh advfirewall` rules that allow only traffic to the tunnel's local SOCKS/HTTP ports and to the active node's IP:port; on disconnect, remove rules.

**Files:**
- Modify: `desktop/src/main.ts` (add `enableKillSwitch(node)`, `disableKillSwitch()` using `child_process.execSync('netsh advfirewall firewall add rule ...')`; call enable after `verifyTunnel()`, disable in `disconnect()`)
- Modify: `desktop/src/renderer.tsx` (Kill Switch toggle in Settings; show "LOCKED" badge when active)
- Modify: `desktop/src/i18n.ts` (`killSwitch`, `killOn`, `killOff` ×3)
- Modify: `desktop/src/styles.css` (`.badge-locked`)

**Steps:**
1. `enableKillSwitch(node)`: add `netsh advfirewall firewall add rule name="NashatVPN-AllowTunnel" dir=out action=allow remoteip=<node.server>` and an allow for `127.0.0.1` (proxy loopback), then a block-all `name="NashatVPN-BlockAll" dir=out action=block`. 
2. `disableKillSwitch()`: `netsh advfirewall firewall delete rule name="NashatVPN-AllowTunnel"` + delete BlockAll.
3. Wrap in try/catch (admin may be required — show `errorKillSwitchAdmin` if it throws).
4. Commit: `feat: Windows firewall kill switch (fail-closed)`.

**Validation:** Connect with kill switch ON → open `ipleak.net` shows tunnel IP; force-kill `sing-box.exe` → all browsing blocked (no leak); disconnect → rules removed, normal browsing returns.

**Risk/Tradeoff:** `netsh advfirewall` changes need admin elevation on some Windows builds. Mitigation: detect failure, show friendly message, fall back to "soft" kill switch (disable system proxy + alert). Open question: should we request admin at install? (No — keep installer non-elevated; kill switch is best-effort.)

---

### Feature E: Live traffic stats (session time + bytes)
**Objective:** Show current session duration, uploaded/downloaded bytes, and current speed — read from sing-box's built-in Clash-API metrics.

**Files:**
- Modify: `desktop/src/main.ts` (enable `experimental.clash_api` in `buildConfig` output or pass `—` ; poll `http://127.0.0.1:<apiPort>/traffic` and `/connections`; expose `ipcMain.handle('vpn:stats')` returning `{up, down, sessionMs}`)
- Modify: `desktop/src/renderer.tsx` (stats row under shield when connected; update every 1s)
- Modify: `desktop/src/i18n.ts` (`up`, `down`, `session`, `speed` ×3)

**Steps:**
1. In `buildConfig`/runner, add to sing-box config: `experimental: { clash_api: { external_controller: '127.0.0.1:20900', secret: '' } }`.
2. `getStats()`: `fetch('http://127.0.0.1:20900/traffic')` → `{up, down}` deltas; track session start time at connect.
3. Renderer polls `vpn:stats` every 1000ms while connected; format MB/GB + KB/s.
4. Commit: `feat: live traffic + session stats via sing-box clash-api`.

**Validation:** Connect, load a webpage, watch Up/Down counters climb and speed update; Disconnect resets.

---

## Phase 3 — Completeness

### Feature F: Protocol filter + "Auto / Fastest" smart pick
**Objective:** Let users filter the visible countries/nodes by protocol (VLESS-Reality, VMess, Trojan, SS, Hysteria2) — useful because some networks block some protocols. Plus an "Auto" row that connects to the lowest-ms working country.

**Files:**
- Modify: `desktop/src/main.ts` (`getState()` to also return per-node `protocol`; add `ipcMain.handle('vpn:autoPick')` returning fastest working country code from `community.json` `bestMs`)
- Modify: `desktop/src/renderer.tsx` (protocol chips above grid; "Auto" card at top of All)
- Modify: `desktop/src/i18n.ts` (`auto`, `protocol`, `filterBy` ×3)

**Steps:**
1. `getState()` already returns `nodes` per location; ensure each node carries `protocol` (add in `directory/fetch-community.js` serializer if missing).
2. `autoPick()`: read `community.json`, return first entry by `bestMs` that passes a quick TCP check.
3. UI: clicking "Auto" calls `selectCountry(autoPick())` then `connect()`.
4. Commit: `feat: protocol filter and Auto/fastest smart-pick`.

**Validation:** Filter to "VLESS" → only VLESS countries show; click Auto → connects to fastest verified country; traffic flows.

---

### Feature G: Remote subscription import (auto-refresh)
**Objective:** Currently `importText` only pastes links. Add "Add subscription URL" that fetches a remote `https://...` subscription, imports its nodes, and re-syncs every 6h.

**Files:**
- Modify: `desktop/src/main.ts` (`ipcMain.handle('vpn:importSubscription', (_e, url))` → fetch + parseSubscriptionOrLinks → store; `setInterval` re-fetch for saved subs in `store.subscriptions`)
- Modify: `desktop/src/renderer.tsx` (input + "Add" in Advanced; list saved subs with remove)
- Modify: `desktop/src/i18n.ts` (`subUrl`, `addSub`, `subAdded`, `removeSub` ×3)

**Steps:**
1. `importSubscription(url)`: `fetch(url)` → `parseSubscriptionOrLinks` → merge into `store.servers`; push `{url, lastSync}` to `store.subscriptions`.
2. On app ready, for each stored sub, `setInterval(()=>importSubscription(url), 6*3600*1000)`.
3. UI lists subs with a remove button (calls `vpn:removeSubscription`).
4. Commit: `feat: remote subscription import with auto-refresh`.

**Validation:** Paste a known subscription URL → its countries appear; wait/offline toggle proves re-sync path (mock with a local file server).

---

### Feature H: Auto server rotation
**Objective:** To avoid throttling/banning on long sessions, optionally reconnect to a fresh node every N minutes while staying on the same country.

**Files:**
- Modify: `desktop/src/main.ts` (`settings.rotateMin`; in `connect()` after success, if `rotateMin>0` schedule `setTimeout(()=>{ if(isConnected()) { disconnect(); connect(); } }, rotateMin*60000)`)
- Modify: `desktop/src/renderer.tsx` (Settings slider 0/15/30/60 min)
- Modify: `desktop/src/i18n.ts` (`rotate`, `rotateOff` ×3)

**Steps:**
1. Add `rotateMin` to settings (default 0 = off).
2. After successful `verifyTunnel()`, if `rotateMin>0` set a timeout that re-connects to next node in same country.
3. UI slider; clear timeout in `disconnect()`.
4. Commit: `feat: optional auto server rotation`.

**Validation:** Set 1 min, connect, watch logs reconnect to a different node after 60s; traffic continues.

---

## Phase 4 — Coverage (your "all Europe" ask, automated)

### Feature I: Wire `build-europe.js` into the daily GitHub Action + expand verification
**Objective:** Guarantee maximum European coverage by deep-verifying every EU country every day and shipping all that pass. Currently `build-europe.js` exists but isn't in CI and isn't merged automatically.

**Files:**
- Modify: `.github/workflows/refresh-directory.yml` (add a job that runs `node scripts/build-europe.js 6` then `node directory/fetch-community.js` merge, commit `directory/community.json`)
- Modify: `scripts/build-europe.js` (already written; verify it commits merged result — add a step to write merged json back, already does)
- Modify: `directory/fetch-community.js` (ensure EU entries from `build-europe.js` are preserved, not overwritten — merge by code in final write)

**Steps:**
1. In workflow, after the normal fetch, run `node scripts/build-europe.js 6`.
2. Ensure `build-europe.js` reads existing `community.json`, replaces EU codes, keeps non-EU, writes back (it already does this).
3. Commit + push `directory/community.json` from the Action.
4. Commit: `ci: deep-verify all European countries daily`.

**Validation:** Manually run `node scripts/build-europe.js 6` locally → `community.json` gains more EU countries (e.g. FR, IT, ES, NL, CH…) each with ≥1 verified node; app shows them with ms.

**Open question:** verification is slow (real engine per node). Cap nodes/country (6) and run EU + rest in parallel CI lanes to stay under GitHub's 6h job limit.

---

## Files likely to change (summary)
- `desktop/src/main.ts` — most new IPC handlers + engine/config tweaks
- `desktop/src/renderer.tsx` — all new UI surfaces
- `desktop/src/preload.ts` — bridge for each new handler
- `desktop/src/i18n.ts` — strings ×3 langs for each feature
- `desktop/src/styles.css` — styles for favorites, tray badge, stats, filters
- `directory/fetch-community.js` — preserve EU merge; ensure node.protocol
- `scripts/build-europe.js` — CI wiring
- `.github/workflows/refresh-directory.yml` — add Europe deep-verify job

## Tests / validation
- Manual: each feature validated via the in-app flow described per feature.
- Script: `node scripts/test-country.js <CODE>` already proves a country carries real traffic (used for SE/GB/PL). Extend with `node scripts/test-all.js` that loops all codes in `community.json` and prints pass/fail — guards regressions.
- CI: the refresh workflow's commit acts as a living test (if a country stops verifying, it drops from the list automatically).

## Risks, tradeoffs, open questions
- **Kill switch admin rights:** `netsh` may need elevation. Fallback = soft kill switch (alert + proxy off). Decision needed: accept best-effort or prompt UAC at connect?
- **CI time:** full verification of 100+ countries × 6 nodes can exceed free CI minutes. Mitigation: cache, parallel lanes, cap nodes/country, run EU in its own job.
- **Tray icon format:** Electron tray wants PNG/ICO, not WEBP. Need to export `public/icon.ico` from existing art.
- **Auto-connect vs kill switch order:** connect must establish tunnel BEFORE enabling kill switch, else self-lockout. Sequence: start engine → verify → enable proxy → enable kill switch.
- **User is non-technical:** keep all toggles simple on/off; hide advanced (subscription, rotation, protocol filter) behind the existing "Advanced" panel.

## Suggested rollout order
1. A (Favorites) — quick win, high delight
2. C (Tray) — feels like a real VPN
3. B (Auto-connect/startup) — convenience
4. D (Kill switch) — trust differentiator
5. E (Stats) — engagement
6. F (Protocol filter + Auto) — power user
7. G (Subscriptions) — extensibility
8. H (Rotation) — anti-throttle
9. I (Europe CI) — coverage automation
