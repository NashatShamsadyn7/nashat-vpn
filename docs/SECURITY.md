# nashat-vpn security checklist

## On the VPS (once, after install.sh)

- [ ] Create a sudo user; disable SSH password auth:
      `/etc/ssh/sshd_config` → `PasswordAuthentication no`, then
      `sudo systemctl restart ssh`
- [ ] Keep UFW minimal: only OpenSSH + 443/tcp (`sudo ufw status`)
- [ ] fail2ban running: `sudo systemctl status fail2ban`
- [ ] Unattended upgrades on (installer enables them):
      `sudo apt-get install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`
- [ ] Back up `/root/nashat-vpn-link.txt` somewhere offline-safe. Anyone with
      that link can use your server — treat it like a password.
- [ ] Sharing with family? Add one Xray client per person (separate UUID +
      email) instead of sharing yours, so you can revoke individually.

## On Windows

- [ ] The `servers.json` store contains your secrets. It lives in
      `%USERPROFILE%\.nashat-vpn\` — don't commit or share it.
- [ ] Prefer REALITY/TLS nodes with real SNIs; avoid `allowInsecure=1` links
      except for testing.
- [ ] After connecting, run the leak tests (see BROWSER-PROXY.md). If DNS shows
      your ISP, your app bypassed the proxy — switch that app to TUN mode.
- [ ] Keep `engine/sing-box.exe` updated: re-run the download snippet in
      README (releases: <https://github.com/SagerNet/sing-box/releases>).

## Threat model honesty

- This protects traffic content and hides your IP from the sites you visit.
- Your VPS provider can still see connection metadata (that you have a VM and
  how much traffic it moves) — same trust level as any paid VPN's datacenter,
  but *your* account.
- REALITY borrows the TLS fingerprint of a real site (default
  www.microsoft.com), which defeats DPI blocking/throttling of known VPN
  protocols. It is not anonymity from a global adversary — for that, layer Tor
  on top for browsing.
