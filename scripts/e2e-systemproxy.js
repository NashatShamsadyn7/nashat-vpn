'use strict';
/**
 * nashat-vpn — scripts/e2e-systemproxy.js
 * Headless proof of the desktop app's connect pipeline:
 *   1. start engine (same core the app uses)
 *   2. flip Windows system proxy ON (same reg writes the app does)
 *   3. prove a real Windows HTTP stack routes through it (.NET/WinINET):
 *        - proxy ON  + engine OFF  -> fetch FAILS  (routed to dead local port)
 *        - proxy ON  + engine RUN  -> fetch OK     (routed through the tunnel)
 *        - proxy OFF (restored)    -> fetch OK     (back to direct)
 * Always restores the original registry state.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseSubscriptionOrLinks } = require('../core/parsers');
const { buildConfig } = require('../core/configBuilder');
const { VpnRunner } = require('../core/runner');

const DATA_DIR = process.env.NASHAT_VPN_HOME || path.join(os.homedir(), '.nashat-vpn');
const WORK_DIR = path.join(DATA_DIR, 'runtime');
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const TEST_URL = 'http://example.com/';

function regQuery(value) {
  try { return execFileSync('reg', ['query', REG_KEY, '/v', value], { encoding: 'utf8' }); }
  catch { return null; }
}
function regSet(value, type, data) {
  execFileSync('reg', ['add', REG_KEY, '/v', value, '/t', type, '/d', data, '/f'], { stdio: 'ignore' });
}
function refreshWininet() {
  for (const option of ['39', '37']) {
    try { execFileSync('rundll32.exe', ['WININET.DLL,InternetSetOption', '0', option, '0', '0'], { stdio: 'ignore' }); } catch {}
  }
}
/** Fetch through the machine-default proxy stack (.NET honors WinINET). */
function dotnetFetch(url) {
  const ps = `
    $ProgressPreference='SilentlyContinue'
    $wc = New-Object System.Net.WebClient
    try { $r = $wc.DownloadString('${url}'); Write-Output ('OK len=' + $r.Length) }
    catch { Write-Output ('FAIL ' + $_.Exception.InnerException.Message) }
  `;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return out.trim().split('\n').pop().trim();
}

(async () => {
  let runner = null;
  const saved = {
    enabled: /0x1/.test(regQuery('ProxyEnable') || ''),
    server: ((regQuery('ProxyServer') || '').split('REG_SZ')[1] || '').trim(),
    override: ((regQuery('ProxyOverride') || '').split('REG_SZ')[1] || '').trim(),
  };
  console.log(`saved proxy state: ${JSON.stringify(saved)}`);

  const restore = () => {
    if (saved.enabled && saved.server) {
      regSet('ProxyServer', 'REG_SZ', saved.server);
      regSet('ProxyOverride', 'REG_SZ', saved.override || '<local>');
      regSet('ProxyEnable', 'REG_DWORD', '1');
    } else {
      regSet('ProxyEnable', 'REG_DWORD', '0');
    }
    refreshWininet();
  };
  const enableProxy = () => {
    regSet('ProxyServer', 'REG_SZ', '127.0.0.1:2081');
    regSet('ProxyOverride', 'REG_SZ', 'localhost;127.*;192.168.*;10.*;172.16.*;<local>');
    regSet('ProxyEnable', 'REG_DWORD', '1');
    refreshWininet();
  };

  try {
    // --- load the seeded server -------------------------------------------------
    const store = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'servers.json'), 'utf8'));
    const node = store.servers.find((s) => s.id === store.activeId) || store.servers[0];
    if (!node) throw new Error('no server in store — seed one first');
    console.log(`server under test : ${node.name} (${node.protocol})`);

    // [A] baseline: proxy untouched ------------------------------------------------
    console.log(`[A] proxy OFF, engine OFF -> .NET fetch: ${dotnetFetch(TEST_URL)}`);

    // [B] system proxy ON, engine OFF ---------------------------------------------
    enableProxy();
    await new Promise((r) => setTimeout(r, 800));
    const b = dotnetFetch(TEST_URL);
    console.log(`[B] proxy ON,  engine OFF -> .NET fetch: ${b}`);
    const routedThroughUs = /FAIL/i.test(b);
    console.log(`    => Windows apps route through Nashat VPN port: ${routedThroughUs ? 'YES ✔' : 'NO ✘'}`);

    // [C] engine up, same proxy setting --------------------------------------------
    fs.mkdirSync(WORK_DIR, { recursive: true });
    runner = new VpnRunner(null, WORK_DIR);
    const info = await runner.start(buildConfig(node, 'socks'), WORK_DIR);
    console.log(`[C] engine started (pid ${info.pid}), proxy stays ON`);
    await new Promise((r) => setTimeout(r, 1200));
    const c = dotnetFetch(TEST_URL);
    console.log(`    .NET fetch now: ${c}`);
    const tunneled = /^OK /.test(c);
    console.log(`    => full chain works for real Windows apps: ${tunneled ? 'YES ✔' : 'NO ✘'}`);

    // [D] restore -------------------------------------------------------------------
    runner.stop(WORK_DIR);
    runner = null;
    restore();
    await new Promise((r) => setTimeout(r, 800));
    console.log(`[D] restored -> .NET fetch: ${dotnetFetch(TEST_URL)}`);

    const pass = routedThroughUs && tunneled;
    console.log(pass ? '\n=== E2E SYSTEM-PROXY PIPELINE: PASS ===' : '\n=== E2E SYSTEM-PROXY PIPELINE: FAIL ===');
    process.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('ERROR:', e.message);
    if (runner) runner.stop(WORK_DIR);
    restore();
    process.exit(1);
  }
})();
