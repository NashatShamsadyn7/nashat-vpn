'use strict';
/**
 * nashat-vpn — scripts/test-country.js <country-code>
 * Picks the best node for a country from directory/community.json,
 * connects through the real engine, pushes real traffic.
 *   node scripts/test-country.js DE
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseLink } = require('../core/parsers');
const { buildConfig } = require('../core/configBuilder');
const { VpnRunner } = require('../core/runner');
const { execFileSync } = require('child_process');

(async () => {
  const want = (process.argv[2] || 'DE').toUpperCase();
  const dir = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'directory', 'community.json'), 'utf8'));
  const loc = dir.locations.find((l) => l.code === want);
  if (!loc) { console.error(`country ${want} not in directory`); process.exit(1); }

  console.log(`${loc.flag} testing ${loc.country}: trying up to ${Math.min(5, loc.nodes.length)} nodes…`);
  const workDir = path.join(os.homedir(), '.nashat-vpn', 'runtime');
  fs.mkdirSync(workDir, { recursive: true });

  for (const entry of loc.nodes.slice(0, 5)) {
    if (!entry.link) continue;
    let node;
    try { node = parseLink(entry.link); } catch { continue; }
    console.log(`  → ${node.name} (${node.protocol} ${node.server}:${node.port})`);
    const runner = new VpnRunner(null, workDir);
    try {
      await runner.start(buildConfig(node, 'socks'), workDir);
      await new Promise((r) => setTimeout(r, 1500));
      // real traffic: HTTPS through the tunnel + exit IP
      const out = execFileSync('curl', ['-s', '-m', '12', '-x', 'socks5://127.0.0.1:2080',
        '-o', 'NUL', '-w', '%{http_code} %{time_total}s', 'https://www.google.com/generate_204'],
        { encoding: 'utf8' }).trim();
      const exitIp = execFileSync('curl', ['-s', '-m', '12', '-x', 'http://127.0.0.1:2081', 'https://api.ipify.org'], { encoding: 'utf8' }).trim();
      runner.stop(workDir);
      if (/^204/.test(out)) {
        console.log(`    ✔ HTTPS 204 via tunnel (${out.split(' ')[1]}) · exit IP: ${exitIp}`);
        console.log(`\n=== ${loc.flag} ${loc.code} WORKS ===`);
        return;
      }
      console.log(`    ✘ no data (${out})`);
    } catch (e) {
      runner.stop(workDir);
      console.log(`    ✘ failed: ${String(e.message).split('\n')[0].slice(0, 80)}`);
    }
  }
  console.log(`\n=== no working node found in sample for ${loc.code} (try again later — lists refresh daily) ===`);
  process.exit(1);
})();
