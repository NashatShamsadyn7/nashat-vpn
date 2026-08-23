# nashat-vpn 🛡️

**Free, strong VPN + proxy for Windows — your servers, your rules.**
International-ready (كوردی · العربية · English). No paid subscriptions, no sketchy
free-VPN apps: you run the open-source `sing-box` engine locally and connect to
servers **you** control (a free-forever cloud VPS works great).

Part of the [Nashat apps](https://iosbb0.web.app) family.

---

## Why this beats "free VPN" apps

| | Random free VPN apps | nashat-vpn |
|---|---|---|
| Who sees your traffic | Unknown company | **Only you** (own VPS) |
| Data caps / speed limits | Usually yes | **None** (VPS limits apply) |
| Protocol strength | Often outdated PPTP/L2TP | **VLESS + REALITY, Hysteria2** — same tech paid VPNs resell |
| Cost | Your privacy | **$0** on Oracle/GCP free tier |
| Proxy mode | Rarely | **Built-in** (SOCKS5 + HTTP, per-app) |

## Quick start (3 commands)

```powershell
# 1. Import a server link (from your own VPS — see docs/FREE-SERVER-GUIDE.md)
node cli/vpn.js import "vless://...."

# 2. Connect as a proxy (no admin needed)
node cli/vpn.js up

# 3. Point your browser at the local proxy → done
#    SOCKS5 127.0.0.1:2080   ·   HTTP 127.0.0.1:2081
```

Full-device VPN mode: `node cli/vpn.js up --tun` (Run as Administrator).

## Project layout

```
nashat-vpn/
├── core/            zero-dependency engine bridge (parsers, config builder, runner)
├── cli/             vpn.js — command-line control
├── engine/          sing-box.exe (downloaded, pinned release)
├── server/          install.sh — one-shot Xray REALITY installer for your VPS
├── desktop/         Electron + React + TS GUI (ckb/ar/en, RTL)
├── tests/           smoke.js — 24 checks incl. real sing-box validation
└── docs/            plan, free-server guide, browser proxy, security
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — roadmap & current status
- [docs/FREE-SERVER-GUIDE.md](docs/FREE-SERVER-GUIDE.md) — get a free-forever VPS (Oracle Cloud) and install the server in one command
- [docs/USAGE.md](docs/USAGE.md) — full CLI reference
- [docs/BROWSER-PROXY.md](docs/BROWSER-PROXY.md) — route only your browser (proxy mode)
- [docs/SECURITY.md](docs/SECURITY.md) — hardening checklist

## Verify

```
node tests/smoke.js     # → 24 passed, 0 failed
node cli/vpn.js doctor  # engine + connectivity check
```

## Legal

Use responsibly and in line with your local laws. This project ships
open-source client tooling; you are responsible for the servers you connect to.
