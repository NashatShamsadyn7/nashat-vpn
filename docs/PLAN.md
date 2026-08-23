# nashat-vpn — build plan & status

Vision: a free, strong VPN + proxy client for Windows, international-ready
(ckb/ar/en), where every user brings their own free-VPS server.
Ship it on iosbb0.web.app next to the other Nashat apps.

## Phase 1 — Core engine (DONE ✅)

- [x] Zero-dependency parsers for vless / vmess / trojan / ss / hysteria2
      links + base64 subscriptions (`core/parsers.js`)
- [x] sing-box config builder: socks (proxy) and tun (VPN) modes,
      modern 1.13 schema incl. `default_domain_resolver` (`core/configBuilder.js`)
- [x] Engine runner: spawn/check/stop sing-box, log ring buffer (`core/runner.js`)
- [x] CLI: import/list/use/up/down/status/logs/doctor (`cli/vpn.js`)
- [x] Engine pinned into `engine/sing-box.exe` (v1.13.19)
- [x] Smoke tests: **24 passed, 0 failed** — every protocol validated by the
      real sing-box binary in both modes; live loopback proxy verified with curl

## Phase 2 — Server story (DONE ✅)

- [x] `server/install.sh`: hardened one-shot Xray VLESS+REALITY installer
      (ufw, fail2ban, fresh UUID/x25519/shortId per install, prints vless:// + QR)
- [x] Free-forever VPS guide (Oracle Always Free walk-through)

## Phase 3 — Desktop GUI (DONE ✅)

Electron 33 + React 18 + TypeScript + Vite (same stack as Nashat TV PC).

- [x] Main process wraps `core/runner.js`; renderer talks only through a
      contextIsolation preload bridge (`window.nashat`)
- [x] Screens: big Connect/Disconnect power button · Servers list · Import box ·
      logs viewer; language picker en/ar/ckb with full RTL mirroring
- [x] **Auto system proxy**: on Connect the app writes WinINET settings itself
      (saving/restoring previous state) — zero manual user action
- [x] NSIS installer: wizard steps, desktop + start-menu shortcuts,
      run-after-finish, per-user (no admin), engine bundled in resources
- [x] Verified headlessly: `scripts/e2e-systemproxy.js` proves real Windows
      apps (.NET stack) route through the tunnel while connected

Artifacts: `desktop/release/NashatVPN-Setup-1.0.0.exe` (~96 MB)
Next: code-signing certificate to remove SmartScreen warning.

## Phase 4 — Country picker + scale plan (IN PROGRESS)

UX decision by owner: NO manual link pasting in main UI — users see a country
grid with flags (en/ar/ckb names), tap country → connect. Manual import moves
to Settings.

Two-tier server model (agreed with Nashat):
- ⭐ FAST tier — his own Oracle Always-Free VMs (start 1–2, grows slowly).
  Trusted, fast, private. Added via directory/servers.json after install.sh.
- 🌐 COMMUNITY tier — public aggregated node lists (barry-far, Epodonios,
  mahdibland etc.), refreshed daily, latency-tested, dead nodes pruned.
  Gives 70–100+ country flags for free; labeled "shared, don't bank on it".

Build items:
- [x] directory/servers.json format (locations + localized names + tiers)
- [x] desktop UI: flag grid, per-country best-node pick, latency badges,
      search, ⭐ fast-tier badges, settings drawer with manual import + logs
      (71 bundled flag SVGs — Windows has no flag emoji; offline-safe)
- [x] directory/fetch-community.js — pull, parse, dedupe, health-check, merge
      (verified: 71 countries / 2,998 nodes; DE + NL proven live with real
       exit IPs through the engine)
- [x] in-app daily refresh from repo raw URL + offline cache fallback
      (directory-cache.json in userData)
- [x] server/install-phone.sh — cardless Fast-tier server: old Android phone
      (Termux) or any Linux + Xray VLESS-WS + free Cloudflare tunnel
      (works behind CGNAT, no public IP needed). Oracle rejected by owner.
- [x] Owner decision: **Community tier only** for v1.1 (no Oracle/card/phone).
- [x] v1.1.0 installer built: NashatVPN-Setup-1.1.0.exe (~96 MB) — verified:
      71-country directory + flags inside resources; country screen confirmed
      visually (flags render, latency shown, UAE/TR reserved as Fast tier)

Scale expectation set with owner: 2k users ≈ 300–500 per free VM;
add VMs over weeks; optional donations for rented capacity later.

## Principles

1. Zero telemetry. Nothing phones home.
2. No bundled servers, no accounts — the user owns the infra.
3. Every protocol path must pass `sing-box check` in CI-style smoke tests.
4. RTL is first-class, not an afterthought.
