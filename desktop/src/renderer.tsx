import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LANGS, RegionKey, regionOf, t, dirOf, countryName } from './i18n';

declare global {
  interface Window {
    nashat: {
      getState(): Promise<any>;
      connect(): Promise<{ ok: boolean; error?: string }>;
      disconnect(): Promise<{ ok: boolean }>;
      selectCountry(code: string): Promise<{ ok: boolean; error?: string }>;
      importText(text: string): Promise<{ added: number }>;
      importSubscription(url: string): Promise<{ added: number; error?: string }>;
      listSubscriptions(): Promise<{ subs: { url: string; lastSync: number }[] }>;
      removeSubscription(url: string): Promise<{ ok: boolean }>;
      getLogs(): Promise<string>;
      stats(): Promise<{ up: number; down: number; sessionMs: number }>;
      autoPick(): Promise<{ code: string | null }>;
      setLang(lang: string): Promise<any>;
      toggleFavorite(code: string): Promise<{ favorites: string[] }>;
      getSettings(): Promise<{ autoConnect: boolean; launchAtBoot: boolean; killSwitch: boolean; rotateMin: number }>;
      setAutoConnect(on: boolean): Promise<any>;
      setLaunchAtBoot(on: boolean): Promise<any>;
      setKillSwitch(on: boolean): Promise<any>;
      setRotate(min: number): Promise<any>;
      getUpdateStatus(): Promise<string>;
      checkUpdate(): Promise<string>;
    };
  }
}

/* ── SVG icon set (stroke 1.6, 24 viewBox) — no emoji anywhere ───────── */
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I = {
  shield: 'M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6l7-3z',
  power: 'M12 3v9M6.3 6.3a8 8 0 1011.4 0',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 8h.01M11 12h1v5h1',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  search: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
  download: 'M12 3v12m0 0l4.5-4.5M12 15l-4.5-4.5M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17',
  star: 'M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17.1 6.4 20l1.2-6.2L3 9.5l6.3-.8L12 3z',
  check: 'M4 12.5l5 5L20 6.5',
  link: 'M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5',
  refresh: 'M21 12a9 9 0 11-3-6.7M21 3v6h-6',
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
};

const REGIONS: { key: RegionKey; label: string }[] = [
  { key: 'all', label: '' },
  { key: 'europe', label: 'europe' },
  { key: 'asia', label: 'asia' },
  { key: 'mideast', label: 'mideast' },
  { key: 'americas', label: 'americas' },
  { key: 'africa', label: 'africa' },
  { key: 'oceania', label: 'oceania' },
];

const PROTOCOLS = ['', 'vless', 'vmess', 'trojan', 'ss', 'hysteria2'];

const Flag: React.FC<{ code: string; size?: number }> = ({ code, size = 26 }) => {
  const [broken, setBroken] = useState(false);
  if (broken || !/^[a-z]{2}$/i.test(code)) return <span className="flag-fb">{code.toUpperCase()}</span>;
  return (
    <img className="flag" src={`./flags/${code.toLowerCase()}.svg`} alt="" width={size} height={size} loading="lazy"
         onError={() => setBroken(true)} />
  );
};

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ on, onChange, disabled }) => (
  <button className={`sw ${on ? 'on' : ''}`} onClick={() => !disabled && onChange(!on)} disabled={disabled} role="switch" aria-checked={on}>
    <span className="knob" />
  </button>
);

const App: React.FC = () => {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionKey>('all');
  const [proto, setProto] = useState('');
  const [view, setView] = useState<'main' | 'about'>('main');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logs, setLogs] = useState('');
  const [paste, setPaste] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [subs, setSubs] = useState<{ url: string; lastSync: number }[]>([]);
  const [updMsg, setUpdMsg] = useState('');
  const [stats, setStats] = useState<{ up: number; down: number; sessionMs: number }>({ up: 0, down: 0, sessionMs: 0 });

  const lang = state?.lang ?? 'en';
  const tr = t(lang);
  const dir = dirOf(lang);

  const refresh = useCallback(async () => setState(await window.nashat.getState()), []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);
  }, [dir, lang]);
  // Live stats polling while connected
  const lastDown = useRef(0);
  const lastUp = useRef(0);
  const lastT = useRef(0);
  const [speed, setSpeed] = useState({ up: 0, down: 0 });
  useEffect(() => {
    const id = setInterval(async () => {
      if (!state?.connected) { setSpeed({ up: 0, down: 0 }); return; }
      const s = await window.nashat.stats();
      setStats(s);
      const now = Date.now();
      if (lastT.current) {
        const dt = (now - lastT.current) / 1000;
        setSpeed({
          up: dt > 0 ? (s.up - lastUp.current) / dt : 0,
          down: dt > 0 ? (s.down - lastDown.current) / dt : 0,
        });
      }
      lastDown.current = s.down; lastUp.current = s.up; lastT.current = now;
    }, 1000);
    return () => clearInterval(id);
  }, [state?.connected]);

  const pickCountry = async (code: string) => {
    if (busy) return;
    setBusy(true); setFlash(tr.checking);
    try {
      await window.nashat.selectCountry(code);
      const res = await window.nashat.connect();
      setFlash(res.ok ? '' : `${tr.failed}: ${res.error}`);
      await refresh();
    } finally { setBusy(false); }
  };

  const toggle = async () => {
    setBusy(true); setFlash('');
    try {
      if (state?.connected) await window.nashat.disconnect();
      else if (state?.selectedCountry) {
        setFlash(tr.checking);
        const res = await window.nashat.connect();
        setFlash(res.ok ? '' : `${tr.failed}: ${res.error}`);
      } else if (state?.locations?.length) await pickCountry(state.locations[0].code);
      await refresh();
    } finally { setBusy(false); }
  };

  const changeLang = async (code: string) => { await window.nashat.setLang(code); await refresh(); };
  const toggleSettings = async () => {
    setSettingsOpen(v => !v);
    if (!settingsOpen) { setLogs(await window.nashat.getLogs()); setSubs((await window.nashat.listSubscriptions()).subs); }
  };
  const doAutoPick = async () => {
    const { code } = await window.nashat.autoPick();
    if (code) pickCountry(code); else setFlash(tr.noLocations);
  };

  const doCheckUpdate = async () => {
    setUpdMsg(tr.checkingUpd);
    await window.nashat.checkUpdate();
    await new Promise(r => setTimeout(r, 2500));
    const s = await window.nashat.getUpdateStatus();
    setUpdMsg(s === 'downloaded' ? tr.updateReady : s === 'available' ? tr.updateAvail : s === 'none' ? tr.upToDate : tr.updateError);
  };

  const settings = state?.settings || { autoConnect: false, launchAtBoot: false, killSwitch: false, rotateMin: 0 };

  if (!state) return <div className="loading"><span className="spinner" /></div>;

  const connected = !!state.connected;
  const sel = state.locations.find((l: any) => l.code === state.selectedCountry);
  const q = query.trim().toLowerCase();
  const list = state.locations.filter((l: any) => {
    if (region !== 'all' && regionOf(l.code) !== region) return false;
    if (q && !l.country.toLowerCase().includes(q) && !l.code.toLowerCase().includes(q)) return false;
    if (proto && (l.nodes || []).every((n: any) => (typeof n === 'string' ? parseProto(n) : n.protocol) !== proto)) return false;
    return true;
  });
  const online = list.filter((l: any) => !l.offline);
  const dead = list.filter((l: any) => l.offline);
  const favs = state.favorites || [];
  const favSet = new Set(favs);
  const byFav = (a: any, b: any) => (favSet.has(b.code) ? 1 : 0) - (favSet.has(a.code) ? 1 : 0);
  online.sort(byFav);
  dead.sort(byFav);
  const upd = state.updateStatus;

  return (
    <div className="app">
      <header className="topbar">
        <img src="./icon.png" alt="" className="logo" />
        <span className="brand">{tr.appName}</span>
        <span className="spacer" />
        <select className="ghost-select" value={lang} onChange={(e) => changeLang(e.target.value)} aria-label={tr.language}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className={`iconbtn ${view === 'about' ? 'is-on' : ''}`} onClick={() => setView(view === 'about' ? 'main' : 'about')} title={tr.about}><Icon d={I.info} /></button>
        <button className={`iconbtn ${settingsOpen ? 'is-on' : ''}`} onClick={toggleSettings} title={tr.settings}><Icon d={I.gear} /></button>
      </header>

      {view === 'about' ? (
        <section className="page">
          <div className="about-card">
            <img src="./icon.png" alt="" className="about-logo" />
            <h2>{tr.appName}</h2>
            <p className="muted">{tr.aboutDesc}</p>
            <p className="ver">{tr.version} <b>{state.appVersion}</b></p>
            <button className="btn-primary" onClick={doCheckUpdate}>{tr.checkUpdate}</button>
            {updMsg && <p className="upd">{updMsg}</p>}
            <div className="about-links">
              <a href="https://iosbb0.web.app" target="_blank" rel="noopener"><Icon d={I.link} size={14} /> iosbb0.web.app</a>
              <a href="https://github.com/NashatShamsadyn7/nashat-vpn" target="_blank" rel="noopener"><Icon d={I.link} size={14} /> GitHub</a>
            </div>
            <p className="tiny muted">{tr.madeBy}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="hero">
            <button className={`power ${connected ? 'on' : ''} ${busy ? 'busy' : ''}`} onClick={toggle} disabled={busy}
                    aria-label={connected ? tr.disconnect : tr.connect}>
              <Icon d={connected ? I.shield : I.power} size={40} />
            </button>
            <div className={`status ${connected ? 'ok' : ''}`}>
              {busy ? tr.checking : connected ? tr.connected : tr.disconnected}
            </div>

            {sel && (
              <button className={`selcard ${sel.offline ? 'off' : ''}`} onClick={() => !sel.offline && pickCountry(sel.code)}>
                <Flag code={sel.code} size={20} />
                <span>{countryName(sel, lang)}</span>
                {sel.offline
                  ? <span className="offpill">{tr.offline}</span>
                  : sel.bestMs > 0 && <span className="ms">{sel.bestMs}<small>{tr.ms}</small></span>}
                {sel.code === state.selectedCountry && connected && <span className="dot" />}
              </button>
            )}
            {!sel && <div className="hint muted">{tr.chooseServer}</div>}

            {/* Live traffic stats (Feature E) */}
            {connected && (
              <div className="stats">
                <div><span className="lbl">{tr.up} ↓</span><b>{fmtBytes(stats.up)}</b><small>{fmtBytes(speed.up)}/s</small></div>
                <div><span className="lbl">{tr.down} ↑</span><b>{fmtBytes(stats.down)}</b><small>{fmtBytes(speed.down)}/s</small></div>
                <div><span className="lbl">{tr.session}</span><b>{fmtTime(stats.sessionMs)}</b></div>
              </div>
            )}
            {settings.killSwitch && connected && <p className="lockbadge"><Icon d={I.shield} size={12} /> {tr.lockOn}</p>}

            {flash && <p className="flash">{flash}</p>}
            {upd === 'downloaded' && <p className="flash ok"><Icon d={I.download} size={13} /> {tr.updateReady}</p>}
          </section>

          <div className="chips" role="tablist">
            {REGIONS.map((r) => (
              <button key={r.key} role="tab" aria-selected={region === r.key}
                      className={`chip ${region === r.key ? 'is-on' : ''}`}
                      onClick={() => setRegion(r.key)}>
                {r.key === 'all' ? tr.all : tr[r.label as keyof typeof tr] as string}
              </button>
            ))}
          </div>

          <label className="searchbox">
            <Icon d={I.search} size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${tr.chooseServer}…`} />
          </label>

          {/* Protocol filter (Feature F) */}
          <div className="chips proto">
            <button className={`chip sm ${proto === '' ? 'is-on' : ''}`} onClick={() => setProto('')}>{tr.all}</button>
            {PROTOCOLS.filter(Boolean).map((p) => (
              <button key={p} className={`chip sm ${proto === p ? 'is-on' : ''}`} onClick={() => setProto(proto === p ? '' : p)}>{p}</button>
            ))}
          </div>

          <div className="scroll">
            {/* Auto / fastest card (Feature F) */}
            <button className="auto-card" onClick={doAutoPick} disabled={busy}>
              <Icon d={I.bolt} size={18} />
              <span>{tr.auto}</span>
              <small>{tr.autoDesc}</small>
            </button>

            <div className="grid">
              {online.map((l: any) => {
                const activeSel = l.code === state.selectedCountry;
                const fav = favSet.has(l.code);
                return (
                  <button key={l.code} className={`cell ${activeSel ? 'active' : ''} ${fav ? 'fav' : ''}`} onClick={() => pickCountry(l.code)} disabled={busy}>
                    <button className={`star ${fav ? 'on' : ''}`} title={fav ? tr.favorited : tr.favorite}
                            onClick={(e) => { e.stopPropagation(); window.nashat.toggleFavorite(l.code).then(refresh); }} aria-label={tr.favorite}>
                      <Icon d={I.star} size={12} />
                    </button>
                    <Flag code={l.code} size={30} />
                    <span className="cname">{countryName(l, lang)}</span>
                    <span className="meta">
                      {l.tier === 'fast' && <Icon d={I.star} size={11} />}
                      {l.bestMs > 0 && <span className={`ms ${l.bestMs < 150 ? 'good' : ''}`}>{l.bestMs}{tr.ms}</span>}
                      {activeSel && connected && <span className="dot" />}
                    </span>
                  </button>
                );
              })}
              {online.length === 0 && dead.length === 0 && <p className="muted empty">{tr.noLocations}</p>}
            </div>

            {dead.length > 0 && (
              <div className="deadzone">
                <p className="deadt">{tr.offlineNote}</p>
                <div className="grid">
                  {dead.map((l: any) => (
                    <button key={l.code} className="cell off" disabled title={tr.offline}>
                      <Flag code={l.code} size={30} />
                      <span className="cname">{countryName(l, lang)}</span>
                      <span className="meta"><span className="offpill">{tr.offline}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {settingsOpen && (
              <section className="panel">
                <h3>{tr.settingsTitle}</h3>
                <div className="row"><span>{tr.autoConnect}</span><Switch on={settings.autoConnect} onChange={(v) => { window.nashat.setAutoConnect(v); setState({ ...state, settings: { ...settings, autoConnect: v } }); }} /></div>
                <div className="row"><span>{tr.launchAtBoot}</span><Switch on={settings.launchAtBoot} onChange={(v) => { window.nashat.setLaunchAtBoot(v); setState({ ...state, settings: { ...settings, launchAtBoot: v } }); }} /></div>
                <div className="row"><span>{tr.killSwitch}</span><Switch on={settings.killSwitch} onChange={(v) => { window.nashat.setKillSwitch(v); setState({ ...state, settings: { ...settings, killSwitch: v } }); }} /></div>
                <div className="row"><span>{tr.rotate}</span>
                  <select className="mini-select" value={settings.rotateMin} onChange={(e) => { const m = Number(e.target.value); window.nashat.setRotate(m); setState({ ...state, settings: { ...settings, rotateMin: m } }); }}>
                    <option value={0}>{tr.rotateOff}</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>60 min</option>
                  </select>
                </div>

                <h3>{tr.advanced}</h3>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={tr.importPlaceholder} rows={2} />
                <button className="btn-primary" disabled={!paste.trim()} onClick={async () => {
                  const res = await window.nashat.importText(paste);
                  setFlash(res.added > 0 ? tr.imported(res.added) : tr.importFailed);
                  setPaste(res.added > 0 ? '' : paste);
                }}>{tr.importBtn}</button>

                <h3>{tr.subsTitle}</h3>
                <label className="searchbox"><Icon d={I.link} size={14} /><input value={subUrl} onChange={(e) => setSubUrl(e.target.value)} placeholder={tr.subUrl} /></label>
                <button className="btn-primary" disabled={!subUrl.trim()} onClick={async () => {
                  const res = await window.nashat.importSubscription(subUrl);
                  setFlash(res.added > 0 ? tr.subAdded : (res.error ? `${tr.failed}: ${res.error}` : tr.importFailed));
                  setSubUrl(''); setSubs((await window.nashat.listSubscriptions()).subs);
                }}>{tr.addSub}</button>
                {subs.map((s) => (
                  <div className="subrow" key={s.url}>
                    <span className="suburl">{s.url}</span>
                    <button className="iconbtn danger" title={tr.removeSub} onClick={async () => { await window.nashat.removeSubscription(s.url); setSubs((await window.nashat.listSubscriptions()).subs); }}><Icon d={I.trash} size={13} /></button>
                  </div>
                ))}

                <pre className="logs">{logs || '—'}</pre>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/** Quick protocol sniff from a share link (for the protocol filter). */
function parseProto(link: string): string {
  if (link.startsWith('vless://')) return 'vless';
  if (link.startsWith('vmess://')) return 'vmess';
  if (link.startsWith('trojan://')) return 'trojan';
  if (link.startsWith('ss://')) return 'ss';
  if (link.startsWith('hysteria2://') || link.startsWith('hy2://')) return 'hysteria2';
  return '';
}

createRoot(document.getElementById('root')!).render(<App />);
