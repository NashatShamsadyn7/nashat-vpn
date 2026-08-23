# Nashat VPN — Desktop app

Real Windows app: **download → install wizard → open → press Connect → protected.**
No Node, no terminal, no manual proxy settings. Built with the same stack as
Nashat TV PC: Electron 33 + React 18 + TypeScript + Vite + electron-builder NSIS.

## What happens on Connect

1. App writes a sing-box config from your selected server (`core/configBuilder.js`).
2. Engine `sing-box.exe` (shipped inside `resources/engine/`) starts detached,
   listening on `socks5://127.0.0.1:2080` + `http://127.0.0.1:2081`.
3. The app **automatically sets the Windows system proxy** to the local HTTP port
   (saving your previous settings) — Chrome/Edge/most apps are instantly routed.
4. On Disconnect it restores your original proxy state exactly.

No admin rights needed (per-user install, user-level registry keys only).

## Languages

English · العربية · کوردی — full RTL mirroring, persisted choice
(`%APPDATA%\nashat-vpn\data\settings.json`).

## Development

```powershell
cd desktop
npm install
npm start          # build ui+main and launch electron
npm run dist       # produce release\NashatVPN-Setup-<version>.exe (NSIS installer)
```

## Install steps the end user sees

1. Run `NashatVPN-Setup-1.0.0.exe`
2. License-free welcome screen → **Next**
3. Choose folder (default `%LOCALAPPDATA%\Programs\Nashat VPN`) → **Install**
4. Progress bar → **Finish** (app launches automatically)
5. Press the big button → 🛡 Protected

Desktop shortcut + Start-menu entry created; uninstaller registered in Windows
"Apps & features". `runAfterFinish: true`, so step 4 is literally Finish.

## Data locations (packaged)

| Path | Content |
|---|---|
| `%APPDATA%\nashat-vpn\data\servers.json` | imported servers |
| `%APPDATA%\nashat-vpn\data\runtime\` | generated config + engine log + pid |
| `<install>\resources\engine\sing-box.exe` | bundled engine |

## Icon

`build/icon.ico` generated from the official NASHAT VPN artwork
(`../nashatvpn.png`) at 16–256 px.
