# Get a free-forever VPN server

The whole point of nashat-vpn: **you are the VPN provider**. One free cloud VM
runs your private server for years — no monthly bill, no data caps beyond the
provider's fair use, and nobody else can read your traffic.

## Option A — Oracle Cloud "Always Free" (recommended)

Genuinely free forever (not a trial). Up to **4 ARM cores + 24 GB RAM**, or
2 small x86 VMs — far more than a VPN needs.

1. Sign up at <https://cloud.oracle.com> → "Start for free".
   Needs an email + a credit/debit card for identity verification
   (**not charged** on Always Free).
2. Choose a home region close to you (e.g. UAE/Egypt/Turkey for low ping from Iraq).
3. Create a Compute Instance:
   - Image: **Ubuntu 24.04** (Minimal is fine)
   - Shape: `VM.Standard.A1.Flex` (ARM) with 2 OCPU / 4 GB — plenty
   - SSH keys: let Oracle generate them; download BOTH the private key (.key)
     and public key.
4. After it runs: Networking → your VCN → Security Lists → **Add Inbound Rule**:
   Source `0.0.0.0/0`, TCP port **443**.
5. Connect:
   ```bash
   ssh -i Downloads/your-key.key ubuntu@<SERVER_PUBLIC_IP>
   ```
6. Run our installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/NashatShamsadyn7/nashat-vpn/main/server/install.sh -o install.sh
   sudo bash install.sh me@example.com www.microsoft.com
   ```
   It prints your personal `vless://…` link + QR code.

### ARM note
Xray runs fine on ARM. The nashat-vpn Windows client doesn't care what CPU the
server has.

## Option B — Other free tiers

| Provider | Free VM | Notes |
|---|---|---|
| Google Cloud | `e2-micro` always free (us regions) | needs card; 1 GB RAM is enough |
| Azure | 750 h/month B1s for 12 months | expires after 12 months |
| AWS | t2.micro/t3.micro 750 h/month for 12 months | expires after 12 months |

## Option C — Already have a cheap VPS?

Same installer works on any fresh Ubuntu 22.04/24.04 (Debian 12 mostly fine).

## After install

1. Copy the printed `vless://` link (or `/root/nashat-vpn-link.txt`).
2. On your PC: `node cli/vpn.js import "<link>"` → `node cli/vpn.js up`.
3. Test: `node cli/vpn.js doctor` then check <https://ipleak.net> —
   your IP should now be the VPS.

## Keep it safe (do these once)

- `sudo adduser yourname && sudo usermod -aG sudo yourname` then disable
  password SSH login (`PasswordAuthentication no` in /etc/ssh/sshd_config).
- Oracle also blocks ICMP by default — that's fine, don't enable ping.
- Reboot the VM once after first boot to pick up kernel updates.

See [SECURITY.md](SECURITY.md) for the full checklist.
