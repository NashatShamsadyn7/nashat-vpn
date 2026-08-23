'use strict';
/**
 * nashat-vpn — cli/vpn.js
 * Command-line control for the VPN/proxy. Zero dependencies.
 *
 *   node cli/vpn.js import <links-or-file>     Import share links / subscription
 *   node cli/vpn.js list                       Show saved servers
 *   node cli/vpn.js use <index|name|id>        Select active server
 *   node cli/vpn.js up [--tun]                 Connect (default: proxy mode)
 *   node cli/vpn.js down                       Disconnect
 *   node cli/vpn.js status                     Connection status
 *   node cli/vpn.js logs [n]                   Last n engine log lines
 *   node cli/vpn.js doctor                     Check engine + connectivity
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { parseSubscriptionOrLinks } = require('../core/parsers');
const { buildConfig, SOCKS_PORT, HTTP_PORT } = require('../core/configBuilder');
const { VpnRunner, findEngine, waitForPort } = require('../core/runner');

const DATA_DIR = process.env.NASHAT_VPN_HOME || path.join(os.homedir(), '.nashat-vpn');
const STORE_PATH = path.join(DATA_DIR, 'servers.json');
const WORK_DIR = path.join(DATA_DIR, 'runtime');

// ---------------------------------------------------------------- store ----
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { servers: [], activeId: null };
  }
}
function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function pickServer(store, selector) {
  if (!selector) return store.servers.find((s) => s.id === store.activeId) || null;
  const byIndex = parseInt(selector, 10);
  if (Number.isFinite(byIndex)) return store.servers[byIndex - 1] || null;
  return (
    store.servers.find((s) => s.id === selector) ||
    store.servers.find((s) => s.name.toLowerCase().includes(String(selector).toLowerCase())) ||
    null
  );
}

/** Is the engine actually alive? PID file + real process check. */
function runningPid() {
  const pidPath = path.join(WORK_DIR, 'sing-box.pid');
  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return null;
    if (process.platform === 'win32') {
      // tasklist finds the process; if it errors, it's gone
      const { execFileSync } = require('child_process');
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      if (out.includes(String(pid))) return pid;
      return null;
    }
    process.kill(pid, 0); // signal 0 = existence check
    return pid;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- commands --
async function cmdImport(arg) {
  let text = arg || '';
  if (arg && fs.existsSync(arg)) text = fs.readFileSync(arg, 'utf8');
  if (!text.trim()) {
    console.error('Usage: node cli/vpn.js import "<vless://...>" | <file-with-links>');
    process.exitCode = 1;
    return;
  }
  const { nodes, errors } = parseSubscriptionOrLinks(text);
  const store = loadStore();
  const existing = new Set(store.servers.map((s) => `${s.protocol}|${s.server}|${s.port}|${s.uuid || s.password}`));
  let added = 0;
  for (const n of nodes) {
    const key = `${n.protocol}|${n.server}|${n.port}|${n.uuid || n.password}`;
    if (existing.has(key)) continue;
    existing.add(key);
    store.servers.push(n);
    added += 1;
  }
  if (!store.activeId && store.servers.length) store.activeId = store.servers[store.servers.length - 1].id;
  saveStore(store);
  console.log(`Imported ${added} new server(s); ${errors.length} line(s) failed.`);
  for (const e of errors) console.log(`  ! ${e.line}… → ${e.reason}`);
}

function cmdList() {
  const store = loadStore();
  if (!store.servers.length) return console.log('No servers yet. Try: node cli/vpn.js import "vless://..."');
  store.servers.forEach((s, i) => {
    const active = s.id === store.activeId ? '*' : ' ';
    console.log(`${active} ${i + 1}. [${s.protocol}] ${s.name}  (${s.server}:${s.port})`);
  });
}

async function cmdUp(argv) {
  const tun = argv.includes('--tun');
  const rest = argv.filter((a) => a !== '--tun');
  const store = loadStore();
  const server = pickServer(store, rest[0]);
  if (!server) return console.error('No server selected. Use: node cli/vpn.js list / use <n>');

  if (runningPid()) console.log('Stopping previous instance first…');
  const mode = tun ? 'tun' : 'socks';
  const config = buildConfig(server, mode);
  const r = new VpnRunner(findEngine(), WORK_DIR);
  console.log(`Connecting to "${server.name}" in ${mode.toUpperCase()} mode…`);
  try {
    const info = await r.start(config, WORK_DIR);
    console.log(`✔ Connected. Engine PID ${info.pid}.`);
    console.log(`  SOCKS5 socks5://127.0.0.1:${SOCKS_PORT} · HTTP http://127.0.0.1:${HTTP_PORT}`);
    if (tun) console.log('  Full-device TUN is active.');
    else console.log('  Full-device VPN: re-run with --tun (as Administrator).');
  } catch (e) {
    console.error(`✘ Failed: ${e.message.split('\n')[0]}`);
    console.error(r.logs(WORK_DIR, 15));
    process.exitCode = 1;
  }
}

function cmdDown() {
  const r = new VpnRunner(null, WORK_DIR);
  const stopped = r.stop(WORK_DIR);
  console.log(stopped ? 'Disconnected.' : 'Was not running.');
}

function cmdStatus() {
  const store = loadStore();
  const server = pickServer(store, null);
  const pid = runningPid();
  if (!pid) {
    console.log('Status: DISCONNECTED');
  } else {
    console.log(`Status: CONNECTED (engine pid ${pid}) via ${server ? server.name : '?'}`);
    console.log(`SOCKS5 127.0.0.1:${SOCKS_PORT} · HTTP 127.0.0.1:${HTTP_PORT}`);
  }
  if (server) console.log(`Active server: ${server.name}`);
}

function cmdLogs(n) {
  const count = parseInt(n, 10) || 30;
  const r = new VpnRunner(null, WORK_DIR);
  console.log(r.logs(WORK_DIR, count) || '(no logs yet)');
}

async function cmdDoctor() {
  const exe = findEngine();
  console.log(`Engine       : ${exe || 'NOT FOUND'}`);
  if (exe) {
    const { execFileSync } = require('child_process');
    try { console.log(`Version      : ${execFileSync(exe, ['version'], { encoding: 'utf8' }).split('\n')[0].trim()}`); }
    catch { console.log('Version      : (could not run engine)'); }
  }
  const store = loadStore();
  console.log(`Servers saved: ${store.servers.length} (${STORE_PATH})`);
  try {
    await waitForPort(SOCKS_PORT, '127.0.0.1', 800);
    console.log(`Local SOCKS  : listening on port ${SOCKS_PORT} ✔`);
  } catch {
    console.log(`Local SOCKS  : not running (normal when disconnected)`);
  }

  const directMs = await timeDirect().catch(() => null);
  console.log(`Internet     : direct ${directMs === null ? 'FAIL' : `OK (${directMs} ms)`}`);

  if (runningPid() || portOpen(HTTP_PORT)) {
    const proxiedMs = await timeViaHttpProxy().catch(() => null);
    console.log(`Via proxy    : ${proxiedMs === null ? 'FAIL' : `OK (${proxiedMs} ms)`}`);
  } else {
    console.log('Via proxy    : not connected');
  }
}

function portOpen(port) {
  try {
    const { execSync } = require('child_process');
    execSync(`netstat -an | findstr ":${port}"`, { stdio: 'ignore', shell: 'cmd.exe' });
    return true;
  } catch {
    return false;
  }
}

function timeDirect(url = 'https://www.google.com/generate_204') {
  const start = Date.now();
  return fetch(url, { signal: AbortSignal.timeout(6000) }).then(() => Date.now() - start);
}

function timeViaHttpProxy(url = 'https://www.google.com/generate_204') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const target = new URL(url);
    const req = http.request({
      host: '127.0.0.1',
      port: HTTP_PORT,
      path: url,
      headers: { Host: target.host },
      timeout: 6000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(Date.now() - start));
    });
    req.on('timeout', () => req.destroy(new Error('proxy timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ------------------------------------------------------------------ main ---
async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  switch (cmd) {
    case 'import': return cmdImport(argv.join(' '));
    case 'list': return cmdList();
    case 'use': {
      const store = loadStore();
      const s = pickServer(store, argv[0]);
      if (!s) return console.error('Not found. Run: node cli/vpn.js list');
      store.activeId = s.id;
      saveStore(store);
      return console.log(`Active server → ${s.name}`);
    }
    case 'up': return cmdUp(argv);
    case 'down': return cmdDown();
    case 'status': return cmdStatus();
    case 'logs': return cmdLogs(argv[0]);
    case 'doctor': return cmdDoctor();
    default:
      console.log(USAGE_TEXT);
  }
}

const USAGE_TEXT = `nashat-vpn — command line

  import "<link>" | <file>   Import share links / subscription
  list                       Show saved servers (* = active)
  use <number|name|id>       Switch active server
  up [--tun]                 Connect (default proxy mode; --tun = full VPN, as Administrator)
  down                       Disconnect
  status                     Connection status
  logs [n]                   Last n engine log lines
  doctor                     Engine + connectivity diagnostics

Proxy mode listens on socks5://127.0.0.1:2080 and http://127.0.0.1:2081.
Full CLI reference: docs/USAGE.md in the project folder.
`;

main().catch((e) => { console.error(e); process.exit(1); });
