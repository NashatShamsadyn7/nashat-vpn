# Route only your browser through nashat-vpn (proxy mode)

Proxy mode = no admin rights, zero risk to your whole system. Only apps that
point at the local proxy are tunneled — everything else stays direct.

## What you get after `node cli/vpn.js up`

| Local endpoint | Type |
|---|---|
| `socks5://127.0.0.1:2080` | SOCKS5 proxy |
| `http://127.0.0.1:2081` | HTTP proxy |

## Chrome / Edge (whole browser)

**Option 1 — launch flag (only that window is proxied):**

```powershell
chrome.exe --proxy-server="socks5://127.0.0.1:2080"
msedge.exe --proxy-server="socks5://127.0.0.1:2080"
```

Tip: add `--user-data-dir=%TEMP%\vpn-profile` to keep it fully separate
(own cookies, own history) — a clean "VPN browser".

**Option 2 — system-wide Windows proxy:**
Settings → Network & Internet → Proxy → Manual setup →
turn **Use a proxy server** on → address `127.0.0.1`, port `2081`.
Turn it off when you disconnect. (Most apps follow this.)

## Firefox

Settings → Network Settings → Manual proxy:
SOCKS Host `127.0.0.1`, Port `2080`, choose SOCKS v5,
tick "Proxy DNS when using SOCKS v5" (important — prevents DNS leaks).

## Extensions (per-site routing)

Install a proxy switcher extension (e.g. SwitchyOmega), create a profile
pointing at `socks5://127.0.0.1:2080`, then set rules like:

```
*.openai.com     → proxy
*.youtube.com    → proxy
*                → direct
```

This gives you "VPN for some sites, full speed for the rest" — the thing paid
VPNs charge extra for.

## Verify no leaks (do this once per session)

With the proxy on, open (through the proxied browser):
1. <https://ipleak.net> → IP must be your VPS, DNS must not be your ISP
2. <https://browserleaks.com/webrtc> → public IP must be the VPS (or disable WebRTC)

## When to use --tun instead

Browser-only covers most cases. Use full VPN mode (`up --tun`) when you need
games, torrent clients or any non-proxy-aware app tunneled too.
