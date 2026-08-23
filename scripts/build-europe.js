'use strict';
/**
 * nashat-vpn — scripts/build-europe.js
 * Deep pass for EUROPE only: gather every candidate node for every European
 * country from all per-country trees + the big mixes (name/flag filtered),
 * then FULL-verify (real engine + HTTPS through tunnel) up to N nodes per
 * country. Merges results into directory/community.json (EU entries replaced,
 * non-EU entries untouched).
 *
 *   node scripts/build-europe.js [nodesPerCountry=6]
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { parseSubscriptionOrLinks } = require('../core/parsers');
const { verifyNode } = require('./verify-node');

const PER_COUNTRY = parseInt(process.argv[2] || '6', 10);
const TCP_TIMEOUT = 2200;
const EU = ['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE',
  'GI','GR','HU','IS','IE','IM','IT','JE','LV','LI','LT','LU','MT','MD','MC','ME',
  'NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB','VA','XK'];
const EU_SET = new Set(EU);

const COUNTRY_NAMES = {
  AL:'Albania', AD:'Andorra', AT:'Austria', BY:'Belarus', BE:'Belgium', BA:'Bosnia and Herzegovina',
  BG:'Bulgaria', HR:'Croatia', CY:'Cyprus', CZ:'Czechia', DK:'Denmark', EE:'Estonia',
  FI:'Finland', FR:'France', DE:'Germany', GI:'Gibraltar', GR:'Greece', HU:'Hungary',
  IS:'Iceland', IE:'Ireland', IM:'Isle of Man', IT:'Italy', JE:'Jersey', LV:'Latvia',
  LI:'Liechtenstein', LT:'Lithuania', LU:'Luxembourg', MT:'Malta', MD:'Moldova', MC:'Monaco',
  ME:'Montenegro', NL:'Netherlands', MK:'North Macedonia', NO:'Norway', PL:'Poland',
  PT:'Portugal', RO:'Romania', RU:'Russia', SM:'San Marino', RS:'Serbia', SK:'Slovakia',
  SI:'Slovenia', ES:'Spain', SE:'Sweden', CH:'Switzerland', UA:'Ukraine', GB:'United Kingdom',
  VA:'Vatican City', XK:'Kosovo',
};

const flagOf = (c) => /^[A-Z]{2}$/.test(c || '')
  ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🏳️';

const NAME_HINTS = [
  [/united kingdom|\buks?\b|london|britain/i,'GB'], [/germany|\bde\b|frankfurt|berlin/i,'DE'],
  [/france|\bfr\b|paris/i,'FR'], [/netherlands|\bnl\b|amsterdam/i,'NL'],
  [/sweden|\bse\b|stockholm/i,'SE'], [/switzerland|\bch\b|zurich/i,'CH'],
  [/poland|\bpl\b|warsaw/i,'PL'], [/italy|\bit\b|milan|rome/i,'IT'],
  [/spain|\bes\b|madrid/i,'ES'], [/norway|\bno\b|oslo/i,'NO'], [/austria|\bat\b|vienna/i,'AT'],
  [/romania|\bro\b/i,'RO'], [/bulgaria|\bbg\b/i,'BG'], [/ukraine|\bua\b|kyiv/i,'UA'],
  [/moldova|\bmd\b/i,'MD'], [/lithuania|\blt\b/i,'LT'], [/latvia|\blv\b/i,'LV'],
  [/estonia|\bee\b/i,'EE'], [/serbia|\brs\b/i,'RS'], [/slovakia|\bsk\b/i,'SK'],
  [/slovenia|\bsi\b/i,'SI'], [/croatia|\bhr\b/i,'HR'], [/hungary|\bhu\b|budapest/i,'HU'],
  [/czech|\bcz\b|prague/i,'CZ'], [/ireland|\bie\b/i,'IE'], [/luxembourg|\blu\b/i,'LU'],
  [/denmark|\bdk\b/i,'DK'], [/belgium|\bbe\b/i,'BE'], [/portugal|\bpt\b/i,'PT'],
  [/greece|\bgr\b/i,'GR'], [/iceland|\bis\b|reykjavik/i,'IS'], [/finland|\bfi\b|helsinki/i,'FI'],
];

function detectFromName(name) {
  const f = (String(name).match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [])[0];
  if (f) {
    const [a, b] = [...f].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65));
    const code = a + b;
    if (EU_SET.has(code)) return code;
  }
  for (const [re, code] of NAME_HINTS) if (re.test(name)) return code;
  return null;
}

function isSane(n) {
  return !!n && typeof n.server === 'string' && n.server.length > 3
    && Number.isFinite(n.port) && n.port >= 1 && n.port <= 65535
    && (n.uuid || n.password || n.protocol === 'ss');
}

function tcpPing(host, port, timeout = TCP_TIMEOUT) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host, port });
    const done = (ms) => { try { sock.destroy(); } catch {} resolve(ms); };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(Date.now() - start));
    sock.on('timeout', () => done(-1));
    sock.on('error', () => done(-1));
  });
}

async function mapPool(items, limit, worker) {
  const out = []; let i = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await worker(items[idx]); } catch { out[idx] = null; } }
  });
  await Promise.all(lanes);
  return out;
}

async function fetchText(url, t = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(t) });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

function serializeLink(node) {
  switch (node.protocol) {
    case 'vless': {
      const q = new URLSearchParams({
        type: node.transport?.type || 'tcp',
        security: node.tls?.reality?.enabled ? 'reality' : node.tls?.enabled ? 'tls' : 'none',
        sni: node.tls?.serverName || '', fp: node.tls?.fingerprint || 'chrome', flow: node.flow || '',
        allowInsecure: node.tls?.insecure ? '1' : '0',
      });
      if (node.tls?.reality?.enabled) { q.set('pbk', node.tls.reality.publicKey || ''); q.set('sid', node.tls.reality.shortId || ''); }
      if (node.transport?.path) q.set('path', node.transport.path);
      const hs = node.transport?.type === 'ws' && node.transport.headers?.Host;
      if (hs) q.set('host', String(hs));
      else if (node.transport?.host) q.set('host', String(node.transport.host));
      return `vless://${encodeURIComponent(node.uuid)}@${node.server}:${node.port}?${q}#${encodeURIComponent(node.name)}`;
    }
    case 'vmess':
      return 'vmess://' + Buffer.from(JSON.stringify({
        add: node.server, port: String(node.port), id: node.uuid, aid: String(node.alterId || 0),
        scy: node.security || 'auto', ps: node.name, net: node.transport?.type || 'tcp',
        path: node.transport?.path || '', host: node.transport?.host || '',
        tls: node.tls?.enabled ? 'tls' : '',
      })).toString('base64');
    case 'trojan': {
      const q = new URLSearchParams({ sni: node.tls?.serverName || node.server, fp: node.tls?.fingerprint || 'chrome', allowInsecure: node.tls?.insecure ? '1' : '0' });
      if (node.transport?.type === 'ws') { q.set('type', 'ws'); q.set('path', node.transport.path || '/'); }
      return `trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}?${q}#${encodeURIComponent(node.name)}`;
    }
    case 'shadowsocks':
      return `ss://${Buffer.from(`${node.method}:${node.password}`).toString('base64')}@${node.server}:${node.port}#${encodeURIComponent(node.name)}`;
    default:
      return '';
  }
}

(async () => {
  console.log('── Europe deep build ──');
  const byCode = new Map(); // code -> Map(key->node)
  const seen = new Set();
  const add = (n, forced) => {
    if (!isSane(n)) return;
    const key = `${n.protocol}|${n.server}|${n.port}|${n.uuid || n.password}`;
    if (seen.has(key)) return;
    const code = forced || detectFromName(n.name);
    if (!code) return;
    seen.add(key);
    if (!byCode.has(code)) byCode.set(code, new Map());
    byCode.get(code).set(key, n);
  };

  // 1) per-country trees for every EU code
  const jobs = [];
  for (const cc of EU) {
    jobs.push({ cc, url: `https://raw.githubusercontent.com/Danialsamadi/v2go/main/Splitted-By-Country/${cc.toLowerCase()}.txt` });
    jobs.push({ cc, url: `https://raw.githubusercontent.com/yaney01/telegram-collector/main/countries/${cc.toLowerCase()}/mixed` });
  }
  let got = 0;
  await mapPool(jobs, 14, async ({ cc, url }) => {
    try {
      const txt = await fetchText(url, 9000);
      const { nodes } = parseSubscriptionOrLinks(txt);
      for (const n of nodes) { add(n, cc); }
      if (nodes.length) got += 1;
    } catch { /* 404 */ }
  });
  console.log(`per-country EU files with content: ${got}/${jobs.length}`);

  // 2) the two big mixes, filtered to EU by name
  for (const url of [
    'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt',
    'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt',
  ]) {
    try {
      const { nodes } = parseSubscriptionOrLinks(await fetchText(url, 15000));
      for (const n of nodes) add(n, null);
      console.log(`mix ok ${url.split('/').slice(-1)[0]} (+${nodes.length})`);
    } catch (e) { console.log(`mix skip (${e.message})`); }
  }
  console.log(`candidate EU countries: ${byCode.size}, nodes: ${seen.size}`);

  // 3) TCP prefilter
  const cand = [...byCode.entries()].map(([code, map]) => ({ code, nodes: [...map.values()] }));
  const prefilt = await mapPool(cand, 12, async ({ code, nodes }) => {
    const sample = nodes.slice(0, 14);
    const pings = await Promise.all(sample.map((n) => tcpPing(n.server, n.port)));
    const alive = sample.map((n, i) => ({ n, ms: pings[i] })).filter((x) => x.ms > 0).sort((a, b) => a.ms - b.ms);
    return { code, total: nodes.length, alive };
  });

  // 4) full verification — try up to PER_COUNTRY tcp-alive nodes each
  let done = 0;
  const results = await mapPool(prefilt.filter((r) => r.alive.length > 0), 10, async (r) => {
    const out = [];
    let port = 23000 + Math.floor(Math.random() * 100) * 10;
    for (const c of r.alive.slice(0, PER_COUNTRY)) {
      const link = serializeLink(c.n);
      if (!link) continue;
      const res = await verifyNode(link, 23000 + ((port++) % 500));
      if (res.ok) out.push({ n: c.n, ms: Math.max(res.ms, 1) });
      if (out.length >= 3) break; // 3 proven nodes per country is plenty
    }
    done += 1;
    process.stdout.write(`\rverified ${done}/${prefilt.filter((x) => x.alive.length > 0).length} countries`);
    return { code: r.code, total: r.total, alive: out };
  });
  process.stdout.write('\n');

  const working = results.filter((r) => r && r.alive.length > 0);
  const euEntries = working
    .map((r) => ({
      code: r.code,
      country: COUNTRY_NAMES[r.code] || r.code,
      flag: flagOf(r.code),
      tier: 'community',
      count: r.total,
      bestMs: r.alive[0].ms,
      nodes: r.alive.slice(0, 3).map((x) => ({ link: serializeLink(x.n), name: x.n.name })),
    }))
    .sort((a, b) => (a.bestMs || 99999) - (b.bestMs || 99999));

  // 5) merge into community.json (replace EU, keep non-EU)
  const outPath = path.join(__dirname, '..', 'directory', 'community.json');
  const dir = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const nonEU = dir.locations.filter((l) => !EU_SET.has(l.code));
  dir.locations = [...euEntries, ...nonEU].sort((a, b) => (a.bestMs || 99999) - (b.bestMs || 99999));
  dir.updated = new Date().toISOString();
  fs.writeFileSync(outPath, JSON.stringify(dir, null, 2));

  console.log(`\nEUROPE WORKING: ${euEntries.length}/${EU.length}`);
  console.log(euEntries.map((l) => `${l.flag} ${l.code} ${l.country}  ${l.bestMs}ms  (${l.count} nodes)`).join('\n'));
  console.log(`\ntotal countries now: ${dir.locations.length}`);
})();
