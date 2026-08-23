nashat-vpn — command line

  node cli/vpn.js import "<vless://... vmess://... trojan://... ss://... hysteria2://...>"
  node cli/vpn.js import  links.txt          (file with one link per line, or base64 subscription)
  node cli/vpn.js list                       show saved servers (* = active)
  node cli/vpn.js use <number|name|id>       switch active server
  node cli/vpn.js up [--tun]                 connect (default proxy mode; --tun = full VPN, run as Administrator)
  node cli/vpn.js down                       disconnect
  node cli/vpn.js status                     show connection state
  node cli/vpn.js logs [n]                   last n engine log lines
  node cli/vpn.js doctor                     engine + connectivity diagnostics

Modes
  proxy (default)  Local SOCKS5 127.0.0.1:2080 + HTTP 127.0.0.1:2081.
                   No admin rights needed. Point your browser/apps at it,
                   or set system proxy in Windows Settings.
  --tun            Full-device VPN through a virtual adapter. Requires
                   "Run as Administrator". Everything on the PC is tunneled.

Data location
  %USERPROFILE%\.nashat-vpn\servers.json   (your imported servers)
  %USERPROFILE%\.nashat-vpn\runtime\       (generated config + logs)

Engine
  engine\sing-box.exe — downloaded automatically into this project.
  Override with the SING_BOX_EXE environment variable.
