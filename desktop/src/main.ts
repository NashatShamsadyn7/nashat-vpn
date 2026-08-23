'use strict';
/**
 * nashat-vpn desktop — Electron main process (v1.1: country picker).
 * Owns: sing-box engine lifecycle, Windows system-proxy auto-config,
 * country directory (owner + community tiers), IPC surface.
 */
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Silent background auto-updates straight from GitHub Releases
// (same pattern as Nashat TV PC's electron-updater).
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = true;      // download quietly in the background
autoUpdater.autoInstallOnAppQuit = true; // apply on next close — never mid-session

let updateStatus = ''; // '', 'checking', 'available', 'none', 'downloaded', 'error'

import { parseSubscriptionOrLinks, parseLink } from '../../core/parsers';
import { buildConfig, HTTP_PORT, SOCKS_PORT } from '../../core/configBuilder';
import { VpnRunner } from '../../core/runner';

// One shared data root for CLI + app (userData would vary by productName).
const DATA_DIR = path.join(app.getPath('appData'), 'nashat-vpn', 'data');
const WORK_DIR = path.join(DATA_DIR, 'runtime');
const STORE_PATH = path.join(DATA_DIR, 'servers.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const DIR_CACHE = path.join(DATA_DIR, 'directory-cache.json');

let win: BrowserWindow | null = null;
let runner: VpnRunner | null = null;
let tray: Tray | null = null;
let appQuitting = false;
let systemProxyOn = false;
let savedProxy: { enabled: boolean; server: string; override: string } | null = null;
let lastError = '';

/* ------------------------------------------------------------- helpers -- */
function ensureDirs(): void {
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

function locateEngine(): string | null {
  const candidates = [
    process.env.SING_BOX_EXE,
    path.join(process.resourcesPath || '', 'engine', 'sing-box.exe'),
    path.join(__dirname, '..', '..', 'engine', 'sing-box.exe'),
    path.join(__dirname, 'engine', 'sing-box.exe'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
  }
  return null;
}

/** directory/servers.json + community.json — dev folder or packaged resources. */
function directoryFile(name: string): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'directory', name),
    path.join(process.resourcesPath || '', 'directory', name),
    path.join(DATA_DIR, name),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c); return c; } catch { /* next */ }
  }
  return null;
}

function loadJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}

interface Store { servers: any[]; activeId: string | null }
function loadStore(): Store {
  return loadJson<Store>(STORE_PATH, { servers: [], activeId: null });
}
function saveStore(s: Store): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
}

interface Sub { url: string; lastSync: number }
const SUBS_PATH = path.join(DATA_DIR, 'subscriptions.json');
function loadSubs(): Sub[] { return loadJson<Sub[]>(SUBS_PATH, []); }
function saveSubs(s: Sub[]): void { fs.writeFileSync(SUBS_PATH, JSON.stringify(s, null, 2)); }

interface Settings { lang: string; countryCode?: string | null; favorites?: string[]; autoConnect?: boolean; launchAtBoot?: boolean; killSwitch?: boolean; rotateMin?: number }
function loadSettings(): Settings {
  return loadJson<Settings>(SETTINGS_PATH, { lang: 'en' });
}
function saveSettings(s: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}
function toggleFavorite(code: string): string[] {
  const s = loadSettings();
  s.favorites = s.favorites || [];
  if (s.favorites.includes(code)) s.favorites = s.favorites.filter((c) => c !== code);
  else s.favorites.push(code);
  saveSettings(s);
  return s.favorites;
}

/* --------------------------------------------------------- the directory -- */
interface Location {
  code: string; country: string; countryAr?: string; countryKu?: string;
  flag: string; tier: string; bestMs?: number; count?: number;
  nodes: { link: string; name?: string }[] | any[];
}

async function readDirectory(): Promise<{ updated: string; locations: Location[] }> {
  // Owner tier (his own servers — empty until he adds one)
  let owner: Location[] = [];
  const ownerPath = directoryFile('servers.json');
  if (ownerPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      owner = (parsed.locations || []).map((l: any) => ({ ...l, tier: 'fast' }));
    } catch { /* ignore */ }
  }

  // Community tier — cached copy ships with the app; refresh from GitHub when online
  let community: Location[] = [];
  let updated = '';
  const cached = loadJson<any>(DIR_CACHE, null);
  if (cached?.locations?.length) {
    community = cached.locations;
    updated = cached.updated || '';
  }
  const bundledPath = directoryFile('community.json');
  if (!community.length && bundledPath) {
    const bundled = loadJson<any>(bundledPath, null);
    if (bundled?.locations?.length) {
      community = bundled.locations;
      updated = bundled.updated || '';
      try { fs.copyFileSync(bundledPath, DIR_CACHE); } catch { /* ignore */ }
    }
  }

  // Try a fresh copy (his repo will host it; falls back silently offline)
  try {
    const url = 'https://raw.githubusercontent.com/NashatShamsadyn7/nashat-vpn/main/directory/community.json';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const fresh = await res.json();
      if (fresh?.locations?.length) {
        community = fresh.locations;
        updated = fresh.updated || new Date().toISOString();
        fs.writeFileSync(DIR_CACHE, JSON.stringify(fresh));
      }
    }
  } catch { /* offline — cache is fine */ }

  // merge: fast tier first, then community — deduped by country code
  // (different community sources can tag the same country; combine their nodes)
  const byCode = new Map<string, Location>();
  for (const l of [...owner, ...community]) {
    const existing = byCode.get(l.code);
    if (!existing) { byCode.set(l.code, { ...l, nodes: [...(l.nodes || [])] }); continue; }
    // merge node lists without dupes
    const seen = new Set((existing.nodes || []).map((n: any) => (typeof n === 'string' ? n : n.link)));
    for (const n of l.nodes || []) {
      const link = typeof n === 'string' ? n : n.link;
      if (link && !seen.has(link)) { (existing.nodes as any[]).push(n); seen.add(link); }
    }
    // keep the better latency / count
    if ((l.bestMs ?? 99999) < (existing.bestMs ?? 99999)) existing.bestMs = l.bestMs;
    existing.count = (existing.nodes as any[]).length;
  }
  const merged = [...byCode.values()];
  // fast tier first
  merged.sort((a, b) => (a.tier === 'fast' ? -1 : 1) - (b.tier === 'fast' ? -1 : 1));
  return { updated, locations: merged };
}

/** Best node object for a location code. */
function bestNodeFor(loc: Location): any | null {
  for (const entry of loc.nodes || []) {
    const link = typeof entry === 'string' ? entry : entry.link;
    if (!link) continue;
    try { return parseLink(link); } catch { /* skip dead entry */ }
  }
  return null;
}

/* ------------------------------------------- windows system proxy (auto) - */
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function regQuery(value: string): string | null {
  try { return execFileSync('reg', ['query', REG_KEY, '/v', value], { encoding: 'utf8' }); }
  catch { return null; }
}
function regSet(value: string, type: string, data: string): void {
  execFileSync('reg', ['add', REG_KEY, '/v', value, '/t', type, '/d', data, '/f'], { stdio: 'ignore' });
}
function readProxyState() {
  const e = regQuery('ProxyEnable');
  const s = regQuery('ProxyServer');
  const o = regQuery('ProxyOverride');
  return {
    enabled: !!e && /\b0x1\b/.test(e),
    server: s ? (s.split('REG_SZ')[1] || '').trim() : '',
    override: o ? (o.split('REG_SZ')[1] || '').trim() : '',
  };
}
function refreshWininet(): void {
  for (const option of ['39', '37']) {
    try {
      execFileSync('rundll32.exe', ['WININET.DLL,InternetSetOption', '0', option, '0', '0'], { stdio: 'ignore' });
    } catch { /* best effort */ }
  }
}
function enableSystemProxy(): void {
  if (systemProxyOn) return;
  savedProxy = readProxyState();
  regSet('ProxyServer', 'REG_SZ', `127.0.0.1:${HTTP_PORT}`);
  regSet('ProxyOverride', 'REG_SZ', 'localhost;127.*;192.168.*;10.*;172.16.*;<local>');
  regSet('ProxyEnable', 'REG_DWORD', '1');
  refreshWininet();
  systemProxyOn = true;
}
function disableSystemProxy(): void {
  if (!systemProxyOn) return;
  if (savedProxy && savedProxy.enabled && savedProxy.server) {
    regSet('ProxyServer', 'REG_SZ', savedProxy.server);
    regSet('ProxyOverride', 'REG_SZ', savedProxy.override || '<local>');
    regSet('ProxyEnable', 'REG_DWORD', '1');
  } else {
    regSet('ProxyEnable', 'REG_DWORD', '0');
  }
  refreshWininet();
  systemProxyOn = false;
  savedProxy = null;
}

/* --------------------------------------------------- connect/disconnect -- */
function getRunner(): VpnRunner {
  if (!runner) runner = new VpnRunner(locateEngine(), WORK_DIR);
  return runner;
}

function isConnected(): boolean {
  const pidFile = path.join(WORK_DIR, 'sing-box.pid');
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch { return false; }
}

/** Make a node the active one (used by country selection). */
function setActiveNode(node: any): void {
  const store = loadStore();
  store.servers = store.servers.filter((x) => !x.id.startsWith('auto-'));
  node.id = `auto-${node.protocol}-${node.server}-${node.port}`;
  store.servers.push(node);
  store.activeId = node.id;
  saveStore(store);
}

/** REAL verification: push an actual HTTPS request through the tunnel. */
function verifyTunnel(): boolean {
  try {
    const out = execFileSync(
      'curl',
      ['-s', '-m', '8', '-x', `socks5://127.0.0.1:${SOCKS_PORT}`, '-o', 'NUL', '-w', '%{http_code}', '--retry', '1',
       'https://www.google.com/generate_204'],
      { encoding: 'utf8', timeout: 12000, windowsHide: true },
    );
    return /^204/.test(out.trim());
  } catch { return false; }
}

/**
 * Connect with smart fallback: try up to 5 nodes for the chosen country.
 * A node only counts as "connected" after verifyTunnel() passes —
 * the user never sees Protected on a dead node again.
 */
async function connect(): Promise<{ ok: boolean; error?: string }> {
  const r = getRunner();
  if (!r.enginePath) { lastError = 'ENGINE_MISSING'; return { ok: false, error: 'ENGINE_MISSING' }; }

  // Which country did the user pick?
  const settings = loadSettings();
  const wanted = settings.countryCode;
  let candidates: any[] = [];
  if (wanted) {
    try {
      const dir = await readDirectory();
      const loc = dir.locations.find((l) => l.code === wanted);
      if (loc?.nodes?.length) candidates = loc.nodes;
    } catch { /* fall back to store below */ }
  }
  // manual/CLI-imported servers still work: no countryCode → use store order
  const store0 = loadStore();
  if (!candidates.length) {
    const active = store0.servers.find((x) => x.id === store0.activeId) || store0.servers[0];
    candidates = active ? [active] : [];
  }
  if (!candidates.length) { lastError = 'NO_SERVERS'; return { ok: false, error: 'NO_SERVERS' }; }

  const maxTry = Math.min(5, candidates.length);
  let lastErr = '';
  for (let i = 0; i < maxTry; i += 1) {
    let node: any;
    try {
      const entry = candidates[i];
      node = typeof entry === 'string' ? parseLink(entry) : entry.link ? parseLink(entry.link) : entry;
    } catch { continue; }
    if (!node || !node.server) continue;

    try {
      await r.start(buildConfig(node, 'socks'), WORK_DIR);
    } catch (e: any) {
      lastErr = String(e.message || e).split('\n')[0];
      continue; // config rejected → next node
    }

    if (verifyTunnel()) {
      const settings = loadSettings();
      if (settings.killSwitch) { const okKs = enableKillSwitch(); if (!okKs) lastError = 'KILLSWITCH_NEEDS_ADMIN'; }
      enableSystemProxy();                       // only now flip Windows traffic
      setActiveNode(node);
      markHealth(wanted || '', false);           // recovered → remove from offline list
      lastError = '';
      sessionStart = Date.now();
      if (wanted) scheduleRotation(wanted);
      return { ok: true };
    }
    lastErr = 'node dead (no data through tunnel)';
    getRunner().stop(WORK_DIR);                  // dead node → clean up, try next
  }
  if (wanted) markHealth(wanted, true);          // whole country offline for 30 min
  lastError = `all ${maxTry} nodes failed — ${lastErr}`;
  disableSystemProxy();
  return { ok: false, error: lastError };
}

/** health.json: countries that failed everything get a 30-min cooldown,
 *  then they are probed again automatically (restore-on-recover). */
function markHealth(code: string, dead: boolean): void {
  if (!code) return;
  const p = path.join(DATA_DIR, 'health.json');
  let h: Record<string, { deadUntil?: number }> = {};
  try { h = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* fresh */ }
  if (dead) h[code] = { deadUntil: Date.now() + 30 * 60 * 1000 };
  else delete h[code];
  try { fs.writeFileSync(p, JSON.stringify(h)); } catch { /* ignore */ }
}

function enableKillSwitch(): boolean {
  try {
    // Allow loopback proxy + the active node's IP, then block all other outbound
    execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name', 'NashatVPN-KillSwitch'], { stdio: 'ignore' });
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name', 'NashatVPN-KillSwitch', 'dir', 'out', 'action', 'allow', 'remoteip', '127.0.0.1'], { stdio: 'ignore' });
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name', 'NashatVPN-KillSwitch', 'dir', 'out', 'action', 'block'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function disableKillSwitch(): void {
  try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name', 'NashatVPN-KillSwitch'], { stdio: 'ignore' }); } catch { /* ignore */ }
}

function disconnect(): void {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  try { getRunner().stop(WORK_DIR); } finally {
    disableKillSwitch();
    disableSystemProxy();
  }
  sessionStart = 0;
}

/* --------------------------------------------------- traffic stats (E) ---- */
let sessionStart = 0;
let lastTraffic = { up: 0, down: 0 };
let rotateTimer: NodeJS.Timeout | null = null;

async function getStats(): Promise<{ up: number; down: number; sessionMs: number }> {
  if (!isConnected()) return { up: 0, down: 0, sessionMs: 0 };
  try {
    const res = await fetch('http://127.0.0.1:20900/traffic', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const j = await res.json();
      // clash-api returns cumulative up/down in bytes
      lastTraffic = { up: j.up || 0, down: j.down || 0 };
    }
  } catch { /* keep last known */ }
  return { up: lastTraffic.up, down: lastTraffic.down, sessionMs: sessionStart ? Date.now() - sessionStart : 0 };
}

function scheduleRotation(code: string): void {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  const s = loadSettings();
  const min = s.rotateMin || 0;
  if (min > 0) {
    rotateTimer = setTimeout(() => {
      if (isConnected() && loadSettings().countryCode === code) {
        disconnect();
        connect().catch(() => {});
      }
    }, min * 60 * 1000);
  }
}

async function getState() {
  const settings = loadSettings();
  const dir = await readDirectory();

  /* Health guard: a location is "offline" when every one of its nodes failed
     TCP recently (cached in health.json). It disappears from the active grid,
     and comes back automatically once any node answers again. */
  interface HealthEntry { deadUntil?: number }
  const health = loadJson<Record<string, HealthEntry>>(path.join(DATA_DIR, 'health.json'), {});
  const now = Date.now();
  let healthDirty = false;
  const locations = dir.locations.map((l) => {
    // probe at most every 10 min per country
    const h = health[l.code] || {};
    if (!h.deadUntil || h.deadUntil < now) {
      delete health[l.code];
      return {
        code: l.code, flag: l.flag, country: l.country, countryAr: l.countryAr,
        countryKu: l.countryKu, tier: l.tier || 'community',
        bestMs: l.bestMs ?? -1, count: l.count ?? (l.nodes?.length || 0), offline: false,
      };
    }
    healthDirty = true;
    return {
      code: l.code, flag: l.flag, country: l.country, countryAr: l.countryAr,
      countryKu: l.countryKu, tier: l.tier || 'community',
      bestMs: -1, count: 0, offline: true,
    };
  });
  if (healthDirty || Object.keys(health).length !== Object.keys(loadJson(path.join(DATA_DIR, 'health.json'), {})).length) {
    try { fs.writeFileSync(path.join(DATA_DIR, 'health.json'), JSON.stringify(health)); } catch { /* ignore */ }
  }

  return {
    locations,
    selectedCountry: settings.countryCode || null,
    favorites: (settings.favorites || []).filter((c) => locations.some((l) => l.code === c)),
    connected: isConnected(),
    systemProxyOn,
    lang: settings.lang,
    lastError,
    appVersion: app.getVersion(),
    updateStatus,
    settings: { autoConnect: !!settings.autoConnect, launchAtBoot: !!settings.launchAtBoot, killSwitch: !!settings.killSwitch, rotateMin: settings.rotateMin || 0 },
    ports: { socks: SOCKS_PORT, http: HTTP_PORT },
  };
}

/* ------------------------------------------------------------ ipc wiring - */
ipcMain.handle('vpn:getState', () => getState());
ipcMain.handle('vpn:connect', () => connect());
ipcMain.handle('vpn:disconnect', () => { disconnect(); return { ok: true }; });

ipcMain.handle('vpn:selectCountry', async (_e, code: string) => {
  const dir = await readDirectory();
  const loc = dir.locations.find((l) => l.code === code);
  if (!loc) return { ok: false, error: 'NO_LOCATION' };
  const node = bestNodeFor(loc);
  if (!node) return { ok: false, error: 'NO_SERVERS' };
  const settings = loadSettings();
  settings.countryCode = code;
  saveSettings(settings);
  setActiveNode(node);
  if (isConnected()) { disconnect(); return connect(); }  // hot-swap
  return { ok: true };
});

ipcMain.handle('vpn:importText', (_e, text: string) => {
  const { nodes } = parseSubscriptionOrLinks(String(text || ''));
  const store = loadStore();
  const seen = new Set(store.servers.map((x) => `${x.protocol}|${x.server}|${x.port}|${x.uuid || x.password}`));
  let added = 0;
  for (const n of nodes) {
    const key = `${n.protocol}|${n.server}|${n.port}|${n.uuid || n.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.servers.push(n);
    added += 1;
  }
  saveStore(store);
  return { added };
});

ipcMain.handle('vpn:getLogs', () => getRunner().logs(WORK_DIR, 30));
ipcMain.handle('vpn:stats', () => getStats());
ipcMain.handle('app:setLang', (_e, lang: string) => {
  const clean = ['en', 'ar', 'ckb'].includes(lang) ? lang : 'en';
  const settings = loadSettings();
  settings.lang = clean;
  saveSettings(settings);
  return { ok: true };
});
ipcMain.handle('app:toggleFavorite', (_e, code: string) => ({ favorites: toggleFavorite(code) }));
ipcMain.handle('app:setAutoConnect', (_e, on: boolean) => {
  const s = loadSettings(); s.autoConnect = !!on; saveSettings(s); return { ok: true };
});
ipcMain.handle('app:setLaunchAtBoot', (_e, on: boolean) => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
  const s = loadSettings(); s.launchAtBoot = !!on; saveSettings(s); return { ok: true };
});
ipcMain.handle('app:getSettings', () => {
  const s = loadSettings();
  return { autoConnect: !!s.autoConnect, launchAtBoot: !!s.launchAtBoot, killSwitch: !!s.killSwitch, rotateMin: s.rotateMin || 0 };
});
ipcMain.handle('app:setKillSwitch', (_e, on: boolean) => {
  const s = loadSettings(); s.killSwitch = !!on; saveSettings(s);
  if (!on && !isConnected()) disableKillSwitch();
  return { ok: true };
});
ipcMain.handle('app:setRotate', (_e, min: number) => {
  const s = loadSettings(); s.rotateMin = Math.max(0, Math.min(120, min | 0)); saveSettings(s); return { ok: true };
});
ipcMain.handle('vpn:autoPick', async () => {
  try {
    const dir = await readDirectory();
    const live = dir.locations.filter((l) => (l.bestMs ?? -1) > 0).sort((a, b) => (a.bestMs ?? 99999) - (b.bestMs ?? 99999));
    return { code: live[0]?.code || null };
  } catch { return { code: null }; }
});
ipcMain.handle('vpn:importSubscription', async (_e, url: string) => {
  try {
    const res = await fetch(String(url), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { added: 0, error: 'FETCH_FAILED' };
    const txt = await res.text();
    const { nodes } = parseSubscriptionOrLinks(txt);
    const store = loadStore();
    const seen = new Set(store.servers.map((x) => `${x.protocol}|${x.server}|${x.port}|${x.uuid || x.password}`));
    let added = 0;
    const subs = loadSubs();
    for (const n of nodes) {
      const key = `${n.protocol}|${n.server}|${n.port}|${n.uuid || n.password}`;
      if (seen.has(key)) continue;
      seen.add(key); store.servers.push(n); added += 1;
    }
    saveStore(store);
    subs.push({ url: String(url), lastSync: Date.now() });
    saveSubs(subs);
    return { added };
  } catch (e: any) { return { added: 0, error: String(e.message || e) }; }
});
ipcMain.handle('vpn:listSubscriptions', () => ({ subs: loadSubs() }));
ipcMain.handle('vpn:removeSubscription', (_e, url: string) => {
  const subs = loadSubs().filter((s) => s.url !== url);
  saveSubs(subs);
  return { ok: true };
});
ipcMain.handle('app:getUpdateStatus', () => updateStatus);
ipcMain.handle('app:checkUpdate', async () => {
  try { await autoUpdater.checkForUpdates(); } catch { updateStatus = 'error'; }
  return updateStatus;
});

/* ------------------------------------------------------------- updater -- */
autoUpdater.on('checking-for-update', () => { updateStatus = 'checking'; });
autoUpdater.on('update-available', (info: any) => {
  updateStatus = 'available';
  console.log(`[updater] v${info.version} downloading in background…`);
});
autoUpdater.on('update-not-available', () => { updateStatus = 'none'; });
autoUpdater.on('download-progress', (p: any) => {
  if (Math.round(p.percent) % 25 === 0) console.log(`[updater] ${Math.round(p.percent)}%`);
});
autoUpdater.on('update-downloaded', (info: any) => {
  updateStatus = 'downloaded';
  console.log(`[updater] v${info.version} ready — installs on next close.`);
  // Never interrupt an active VPN session; electron-updater applies on quit
  // because autoInstallOnAppQuit is true.
});
autoUpdater.on('error', () => { updateStatus = 'error'; });

function startUpdateLoop(): void {
  // Check now and every 6 h. Failures are silent — offline users unaffected.
  autoUpdater.checkForUpdatesAndNotify().catch(() => { updateStatus = 'error'; });
  setInterval(() => { autoUpdater.checkForUpdatesAndNotify().catch(() => {}); }, 6 * 60 * 60 * 1000);
}

/* ---------------------------------------------------------------- window - */
function buildTray(): void {
  let iconPath = path.join(__dirname, '..', '..', 'public', 'icon.png');
  if (!fs.existsSync(iconPath)) iconPath = path.join(process.resourcesPath || '', 'public', 'icon.png');
  let img: Electron.NativeImage;
  try { img = nativeImage.createFromPath(iconPath); } catch { img = nativeImage.createEmpty(); }
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, '..', 'dist-ui', 'icon.png'));
  tray = new Tray(img);
  const menu = Menu.buildFromTemplate([
    { label: 'Show Nashat VPN', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: 'Connect', click: () => connect().catch(() => {}) },
    { label: 'Disconnect', click: () => disconnect() },
    { type: 'separator' },
    { label: 'Quit', click: () => { appQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Nashat VPN');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
  tray.on('click', () => { if (win) { if (win.isVisible()) win.hide(); else { win.show(); win.focus(); } } });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 430,
    height: 760,
    minWidth: 380,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    title: 'Nashat VPN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'dist-ui', 'index.html'));
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  // Minimize to tray instead of quitting (unless we are really quitting)
  win.on('close', (e) => {
    if (!appQuitting) { e.preventDefault(); win?.hide(); return false; }
    return true;
  });
  if (!tray) buildTray();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    ensureDirs();
    createWindow();
    startUpdateLoop();
    // Auto-connect to the last country if the user enabled it
    try {
      const s = loadSettings();
      if (s.autoConnect && s.countryCode) {
        setTimeout(() => { connect().catch(() => {}); }, 1500);
      }
    } catch { /* best effort */ }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', () => { disconnect(); });
app.on('window-all-closed', () => { app.quit(); });
