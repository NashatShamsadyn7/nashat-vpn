import React, { useCallback, useEffect, useState } from 'react';
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
      getLogs(): Promise<string>;
      setLang(lang: string): Promise<any>;
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
};

const REGIONS: { key: RegionKey; label: string }[] = [
  { key: 'all', label: '' },        // filled from i18n at render
  { key: 'europe', label: 'europe' },
  { key: 'asia', label: 'asia' },
  { key: 'mideast', label: 'mideast' },
  { key: 'americas', label: 'americas' },
  { key: 'africa', label: 'africa' },
  { key: 'oceania', label: 'oceania' },
];

const Flag: React.FC<{ code: string; size?: number }> = ({ code, size = 26 }) => {
  const [broken, setBroken] = useState(false);
  if (broken || !/^[a-z]{2}$/i.test(code)) return <span className="flag-fb">{code.toUpperCase()}</span>;
  return (
    <img className="flag" src={`./flags/${code.toLowerCase()}.svg`} alt="" width={size} height={size} loading="lazy"
         onError={() => setBroken(true)} />
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<RegionKey>('all');
  const [view, setView] = useState<'main' | 'about'>('main');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logs, setLogs] = useState('');
  const [paste, setPaste] = useState('');
  const [updMsg, setUpdMsg] = useState('');

  const lang = state?.lang ?? 'en';
  const tr = t(lang);
  const dir = dirOf(lang);

  const refresh = useCallback(async () => setState(await window.nashat.getState()), []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);
  }, [dir, lang]);

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
  const toggleSettings = async () => { setSettingsOpen(v => !v); if (!settingsOpen) setLogs(await window.nashat.getLogs()); };

  const doCheckUpdate = async () => {
    setUpdMsg(tr.checkingUpd);
    await window.nashat.checkUpdate();
    await new Promise(r => setTimeout(r, 2500));
    const s = await window.nashat.getUpdateStatus();
    setUpdMsg(
      s === 'downloaded' ? tr.updateReady :
      s === 'available' ? tr.updateAvail :
      s === 'none' ? tr.upToDate :
      tr.updateError,
    );
  };

  if (!state) return <div className="loading"><span className="spinner" /></div>;

  const connected = !!state.connected;
  const sel = state.locations.find((l: any) => l.code === state.selectedCountry);
  const q = query.trim().toLowerCase();
  const list = state.locations.filter((l: any) => {
    if (region !== 'all' && regionOf(l.code) !== region) return false;
    if (q && !l.country.toLowerCase().includes(q) && !l.code.toLowerCase().includes(q)) return false;
    return true;
  });
  const online = list.filter((l: any) => !l.offline);
  const dead = list.filter((l: any) => l.offline);
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

          <div className="scroll">
            <div className="grid">
              {online.map((l: any) => {
                const activeSel = l.code === state.selectedCountry;
                return (
                  <button key={l.code} className={`cell ${activeSel ? 'active' : ''}`} onClick={() => pickCountry(l.code)} disabled={busy}>
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
                <h3>{tr.advanced}</h3>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={tr.importPlaceholder} rows={2} />
                <button className="btn-primary" disabled={!paste.trim()} onClick={async () => {
                  const res = await window.nashat.importText(paste);
                  setFlash(res.added > 0 ? tr.imported(res.added) : tr.importFailed);
                  setPaste(res.added > 0 ? '' : paste);
                }}>{tr.importBtn}</button>
                <pre className="logs">{logs || '—'}</pre>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
