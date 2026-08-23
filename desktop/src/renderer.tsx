import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LANGS, Lang, t, dirOf, countryName } from './i18n';

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
    };
  }
}

const App: React.FC = () => {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState('');
  const [paste, setPaste] = useState('');

  const lang: Lang = state?.lang ?? 'en';
  const tr = t(lang);
  const dir = dirOf(lang);

  const refresh = useCallback(async () => {
    setState(await window.nashat.getState());
  }, []);

  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [refresh]);

  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);
  }, [dir, lang]);

  const pickCountry = async (code: string) => {
    setBusy(true); setFlash('');
    try {
      await window.nashat.selectCountry(code);
      const res = await window.nashat.connect();
      if (!res.ok) setFlash(res.error === 'NO_SERVERS' ? tr.errorNoServers : `${tr.failed}: ${res.error}`);
      await refresh();
    } finally { setBusy(false); }
  };

  const toggle = async () => {
    setBusy(true); setFlash('');
    try {
      if (state?.connected) await window.nashat.disconnect();
      else if (state?.selectedCountry) await window.nashat.connect();
      else if (state?.locations?.length) await pickCountry(state.locations[0].code);
      await refresh();
    } finally { setBusy(false); }
  };

  const changeLang = async (code: string) => { await window.nashat.setLang(code); await refresh(); };

  const openSettings = async () => {
    setShowSettings((v) => !v);
    if (!showSettings) setLogs(await window.nashat.getLogs());
  };

  const doImport = async () => {
    if (!paste.trim()) return;
    const res = await window.nashat.importText(paste);
    setFlash(res.added > 0 ? tr.imported(res.added) : tr.importFailed);
    setPaste(res.added > 0 ? '' : paste);
  };

  if (!state) return <div className="loading">…</div>;

  const connected = !!state.connected;
  const sel = state.locations.find((l: any) => l.code === state.selectedCountry);
  const list = state.locations.filter((l: any) =>
    !query || l.country.toLowerCase().includes(query.toLowerCase()) || l.code.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="app">
      <header className="topbar">
        <img src="./icon.png" alt="" className="logo" />
        <h1>{tr.appName}</h1>
        <select className="lang" value={lang} onChange={(e) => changeLang(e.target.value)} aria-label={tr.language}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className="gear" onClick={openSettings} title={tr.settings}>⚙</button>
      </header>

      <section className="hero">
        <button
          className={`powerbtn ${connected ? 'on' : ''} ${busy ? 'busy' : ''}`}
          onClick={toggle}
          disabled={busy}
        >
          <span className="power-icon">{connected ? '🛡' : '⏻'}</span>
        </button>
        <div className={`status ${connected ? 'ok' : ''}`}>
          {busy ? tr.connecting : connected ? tr.connected : tr.disconnected}
        </div>
        {sel && (
          <div className="current">
            <img
              className="curflag"
              src={`./flags/${(state.selectedCountry || '').toLowerCase()}.svg`}
              alt=""
              width="18"
              height="18"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {' '}{countryName(sel, lang)}
            {sel.bestMs > 0 && <span className="ms"> · {sel.bestMs}{tr.ms}</span>}
          </div>
        )}
        {!sel && <div className="current muted">{tr.chooseServer}</div>}
        {flash && <p className="err">{flash}</p>}
      </section>

      <section className="countries">
        <input
          className="search"
          placeholder={`${tr.chooseServer}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {list.length === 0 && <p className="muted">{tr.noLocations}</p>}
        <ul>
          {list.map((l: any) => (
            <li key={l.code}>
              <button
                className={`country ${l.code === state.selectedCountry ? 'active' : ''}`}
                onClick={() => pickCountry(l.code)}
                disabled={busy}
              >
                <span className="flag">
                  <img
                    src={`./flags/${l.code.toLowerCase()}.svg`}
                    alt=""
                    width="22"
                    height="22"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).outerHTML = `<b>${l.code}</b>`; }}
                  />
                </span>
                <span className="cname">{countryName(l, lang)}</span>
                {l.tier === 'fast' && <span className="badge fast">⭐</span>}
                {l.bestMs > 0 && <span className={`ms ${l.bestMs < 150 ? 'good' : ''}`}>{l.bestMs}{tr.ms}</span>}
                {l.code === state.selectedCountry && connected && <span className="dot" />}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {showSettings && (
        <section className="settings">
          <h2>{tr.advanced}</h2>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={tr.importPlaceholder} rows={2} />
          <button className="primary" onClick={doImport} disabled={!paste.trim()}>{tr.importBtn}</button>
          <pre className="logs">{logs || '—'}</pre>
        </section>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
