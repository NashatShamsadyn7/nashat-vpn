'use strict';
/**
 * nashat-vpn desktop — Electron main process (v1.1: country picker).
 * Owns: sing-box engine lifecycle, Windows system-proxy auto-config,
 * country directory (owner + community tiers), IPC surface.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
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

interface Settings { lang: string; countryCode?: string | null }
function loadSettings(): Settings {
  return loadJson<Settings>(SETTINGS_PATH, { lang: 'en' });
}
function saveSettings(s: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
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

  // merge: fast tier first
  const merged = [...owner.filter((l) => l.nodes?.length !== undefined), ...community];
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

async function connect(): Promise<{ ok: boolean; error?: string }> {
  const node = (() => {
    const s = loadStore();
    return s.servers.find((x) => x.id === s.activeId) || s.servers[0] || null;
  })();
  if (!node) { lastError = 'NO_SERVERS'; return { ok: false, error: 'NO_SERVERS' }; }
  const r = getRunner();
  if (!r.enginePath) { lastError = 'ENGINE_MISSING'; return { ok: false, error: 'ENGINE_MISSING' }; }
  try {
    await r.start(buildConfig(node, 'socks'), WORK_DIR);
    enableSystemProxy();
    lastError = '';
    return { ok: true };
  } catch (e: any) {
    lastError = String(e.message || e).split('\n')[0];
    return { ok: false, error: lastError };
  }
}

function disconnect(): void {
  try { getRunner().stop(WORK_DIR); } finally { disableSystemProxy(); }
}

async function getState() {
  const settings = loadSettings();
  const dir = await readDirectory();
  return {
    locations: dir.locations.map((l) => ({
      code: l.code,
      flag: l.flag,
      country: l.country,
      countryAr: l.countryAr,
      countryKu: l.countryKu,
      tier: l.tier || 'community',
      bestMs: l.bestMs ?? -1,
      count: l.count ?? (l.nodes?.length || 0),
    })),
    selectedCountry: settings.countryCode || null,
    connected: isConnected(),
    systemProxyOn,
    lang: settings.lang,
    lastError,
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
ipcMain.handle('app:setLang', (_e, lang: string) => {
  const clean = ['en', 'ar', 'ckb'].includes(lang) ? lang : 'en';
  const settings = loadSettings();
  settings.lang = clean;
  saveSettings(settings);
  return { ok: true };
});
ipcMain.handle('app:getUpdateStatus', () => updateStatus);

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
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', () => { disconnect(); });
app.on('window-all-closed', () => { app.quit(); });
