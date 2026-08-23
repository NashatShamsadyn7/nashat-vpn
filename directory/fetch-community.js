'use strict';
/**
 * nashat-vpn — directory/fetch-community.js  (v2: wide coverage, alive-only)
 *
 * Builds directory/community.json containing ONLY countries where at least
 * one node passed a TCP liveness check right now. Dead countries are dropped
 * entirely — the site/app promise is "if it's listed, it worked at build time".
 *
 * Sources:
 *   A) aggregator mixes (mahdibland, Epodonios, MatinGhanbari, Pawdroid,
 *      ermaozi, peasoft, aiboboxx, mfuu …) — country detected from node names
 *   B) per-country collections (soroushmirzaei/telegram-configs-collector,
 *      Epodonios Splitted-By-Country) — country comes from the URL itself
 *
 *   node directory/fetch-community.js [--quick]
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { parseSubscriptionOrLinks } = require('../core/parsers');

const QUICK = process.argv.includes('--quick');
const SAMPLE_PER_COUNTRY = QUICK ? 8 : 16;
const FETCH_CONCURRENCY = 14;
const PING_CONCURRENCY = 60;
const TCP_TIMEOUT = 2500;

/* ------------------------------------------------------------------ misc */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapPool(items, limit, worker) {
  const out = [];
  let i = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(lanes);
  return out;
}

async function fetchText(url, timeoutMs = 12000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
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

/* ------------------------------------------------------- country tables */
const COUNTRY_NAMES = {
  AE:'United Arab Emirates', AR:'Argentina', AT:'Austria', AU:'Australia', AL:'Albania',
  AM:'Armenia', AZ:'Azerbaijan', BD:'Bangladesh', BE:'Belgium', BG:'Bulgaria', BR:'Brazil',
  CA:'Canada', CH:'Switzerland', CL:'Chile', CN:'China', CO:'Colombia', CY:'Cyprus',
  CZ:'Czechia', DE:'Germany', DK:'Denmark', EC:'Ecuador', EE:'Estonia', EG:'Egypt',
  ES:'Spain', FI:'Finland', FR:'France', GB:'United Kingdom', GE:'Georgia', GR:'Greece',
  HK:'Hong Kong', HR:'Croatia', HU:'Hungary', ID:'Indonesia', IE:'Ireland', IL:'Israel',
  IN:'India', IQ:'Iraq', IR:'Iran', IS:'Iceland', IT:'Italy', JP:'Japan', KG:'Kyrgyzstan',
  KW:'Kuwait', KZ:'Kazakhstan', LK:'Sri Lanka', LT:'Lithuania', LU:'Luxembourg',
  LV:'Latvia', MA:'Morocco', MD:'Moldova', MK:'North Macedonia', MX:'Mexico', MY:'Malaysia',
  NG:'Nigeria', NL:'Netherlands', NO:'Norway', NP:'Nepal', NZ:'New Zealand', PE:'Peru',
  PH:'Philippines', PK:'Pakistan', PL:'Poland', PT:'Portugal', QA:'Qatar', RO:'Romania',
  RS:'Serbia', RU:'Russia', SA:'Saudi Arabia', SE:'Sweden', SG:'Singapore', SI:'Slovenia',
  SK:'Slovakia', TH:'Thailand', TR:'Türkiye', TW:'Taiwan', UA:'Ukraine', US:'United States',
  UZ:'Uzbekistan', VN:'Vietnam', ZA:'South Africa', KR:'South Korea', MN:'Mongolia',
  KH:'Cambodia', MM:'Myanmar', LA:'Laos', BN:'Brunei', TJ:'Tajikistan', TM:'Turkmenistan',
  AF:'Afghanistan', SY:'Syria', JO:'Jordan', LB:'Lebanon', OM:'Oman', BH:'Bahrain',
  YE:'Yemen', LY:'Libya', TN:'Tunisia', DZ:'Algeria', SD:'Sudan', ET:'Ethiopia',
  KE:'Kenya', TZ:'Tanzania', UG:'Uganda', GH:'Ghana', SN:'Senegal', CI:'Ivory Coast',
  CM:'Cameroon', CD:'DR Congo', AO:'Angola', MZ:'Mozambique', ZW:'Zimbabwe',
  BW:'Botswana', NA:'Namibia', MU:'Mauritius', MG:'Madagascar', PA:'Panama',
  CR:'Costa Rica', GT:'Guatemala', DO:'Dominican Republic', HN:'Honduras', SV:'El Salvador',
  NI:'Nicaragua', BO:'Bolivia', PY:'Paraguay', UY:'Uruguay', VE:'Venezuela', GY:'Guyana',
  SR:'Suriname', PR:'Puerto Rico', FJ:'Fiji', PG:'Papua New Guinea', NC:'New Caledonia',
};

const NAME_HINTS = [
  [/united states|\busa?\b|america|los angeles|seattle|dallas|ashburn|new york/i,'US'],
  [/united kingdom|\buks?\b|london|britain/i,'GB'], [/germany|\bde\b|frankfurt|berlin/i,'DE'],
  [/france|\bfr\b|paris/i,'FR'], [/netherlands|\bnl\b|amsterdam/i,'NL'],
  [/turkey|turkiye|türkiye|\btr\b|istanbul/i,'TR'], [/emirates|\buae?\b|dubai/i,'AE'],
  [/canada|\bca\b|toronto|montreal/i,'CA'], [/japan|\bjp\b|tokyo|osaka/i,'JP'],
  [/singapore|\bsg\b/i,'SG'], [/india|\bin\b|mumbai/i,'IN'], [/australia|\bau\b|sydney/i,'AU'],
  [/sweden|\bse\b|stockholm/i,'SE'], [/switzerland|\bch\b|zurich/i,'CH'],
  [/poland|\bpl\b|warsaw/i,'PL'], [/italy|\bit\b|milan|rome/i,'IT'],
  [/spain|\bes\b|madrid/i,'ES'], [/russia|\bru\b|moscow/i,'RU'],
  [/brazil|\bbr\b|sao paulo/i,'BR'], [/korea|\bkr\b|seoul/i,'KR'],
  [/hong ?kong|\bhk\b/i,'HK'], [/taiwan|\btw\b/i,'TW'], [/malaysia|\bmy\b/i,'MY'],
  [/indonesia|\bid\b|jakarta/i,'ID'], [/vietnam|\bvn\b/i,'VN'], [/thailand|\bth\b/i,'TH'],
  [/mexico|\bmx\b/i,'MX'], [/argentina|\bar\b|buenos/i,'AR'], [/finland|\bfi\b|helsinki/i,'FI'],
  [/norway|\bno\b|oslo/i,'NO'], [/austria|\bat\b|vienna/i,'AT'], [/romania|\bro\b/i,'RO'],
  [/bulgaria|\bbg\b/i,'BG'], [/ukraine|\bua\b|kyiv/i,'UA'], [/israel|\bil\b/i,'IL'],
  [/qatar|\bqa\b|doha/i,'QA'], [/kuwait|\bkw\b/i,'KW'], [/saudi|\bsa\b|riyadh/i,'SA'],
  [/egypt|\beg\b|cairo/i,'EG'], [/morocco|\bma\b/i,'MA'], [/south africa|\bza\b/i,'ZA'],
  [/nigeria|\bng\b/i,'NG'], [/kazakhstan|\bkz\b/i,'KZ'], [/armenia|\bam\b/i,'AM'],
  [/georgia\b|\bge\b|tbilisi/i,'GE'], [/azerbaijan|\baz\b|baku/i,'AZ'],
  [/iraq|baghdad|\biq\b/i,'IQ'], [/iran|tehran|\bir\b/i,'IR'],
  [/china|\bcn\b|shanghai|beijing/i,'CN'], [/philippines|\bph\b/i,'PH'],
  [/pakistan|\bpk\b/i,'PK'], [/bangladesh|\bbd\b/i,'BD'], [/sri ?lanka|\blk\b/i,'LK'],
  [/nepal|\bnp\b/i,'NP'], [/denmark|\bdk\b/i,'DK'], [/belgium|\bbe\b/i,'BE'],
  [/portugal|\bpt\b/i,'PT'], [/greece|\bgr\b/i,'GR'], [/hungary|\bhu\b|budapest/i,'HU'],
  [/czech|\bcz\b|prague/i,'CZ'], [/ireland|\bie\b/i,'IE'], [/luxembourg|\blu\b/i,'LU'],
  [/moldova|\bmd\b/i,'MD'], [/lithuania|\blt\b/i,'LT'], [/latvia|\blv\b/i,'LV'],
  [/estonia|\bee\b/i,'EE'], [/serbia|\brs\b/i,'RS'], [/slovakia|\bsk\b/i,'SK'],
  [/slovenia|\bsi\b/i,'SI'], [/croatia|\bhr\b/i,'HR'], [/cyprus|\bcy\b/i,'CY'],
  [/albania|\bal\b/i,'AL'], [/chile|\bcl\b/i,'CL'], [/colombia|\bco\b/i,'CO'],
  [/peru|\bpe\b/i,'PE'], [/ecuador|\bec\b/i,'EC'],
];

function flagOf(code) {
  return /^[A-Z]{2}$/.test(code || '')
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '🏳️';
}

function detectFromName(name) {
  const f = (String(name).match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [])[0];
  if (f) {
    const [a, b] = [...f].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65));
    return a + b;
  }
  for (const [re, code] of NAME_HINTS) if (re.test(name)) return code;
  return null;
}

/** Reject junk nodes that would crash or waste the liveness pass. */
function isSaneNode(n) {
  return !!n
    && typeof n.server === 'string' && n.server.length > 3
    && Number.isFinite(n.port) && n.port >= 1 && n.port <= 65535
    && (n.uuid || n.password || n.protocol === 'ss');
}

/* ------------------------------------------------------------- sources */
const MIX_SOURCES = [
  'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt',
  'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt',
  'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/v2ray/all_sub.txt',
  'https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub',
  'https://raw.githubusercontent.com/ermaozi01/free_clash_vpn/main/subscribe/v2ray.txt',
  'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt',
  'https://raw.githubusercontent.com/aiboboxx/v2rayfree/main/v2',
  'https://raw.githubusercontent.com/mfuu/v2ray/master/v2ray',
];

const PROTOCOLS = ['vless', 'vmess', 'trojan', 'ss', 'reality'];

/** Probe which per-country URL templates exist, using DE as the guinea pig. */
async function probeTemplates() {
  const templates = [
    { url: (cc, p) => `https://raw.githubusercontent.com/yaney01/telegram-collector/main/countries/${cc}/${p}`, ccStyle: 'lower', protos: ['mixed'] },
    { url: (cc, p) => `https://raw.githubusercontent.com/soroushmirzaei/telegram-configs-collector/main/countries/${cc}/protocols/${p}`, ccStyle: 'lower', protos: ['vless', 'reality'] },
    { url: (cc, p) => `https://raw.githubusercontent.com/soroushmirzaei/telegram-configs-collector/main/countries/${cc}/mixed`, ccStyle: 'lower', protos: ['mixed'] },
  ];
  for (const t of templates) {
    for (const p of t.protos.slice(0, 1)) {
      try {
        const txt = await fetchText(t.url('de', p), 8000);
        if (txt && txt.trim().length > 20) return t;
      } catch { /* next */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------ pipeline */
(async () => {
  console.log('── nashat-vpn community builder v2 ──');
  const byCode = new Map(); // code -> Map(nodeKey -> node)
  const seenGlobal = new Set();

  function addNode(node, forcedCode) {
    if (!isSaneNode(node)) return;
    const key = `${node.protocol}|${node.server}|${node.port}|${node.uuid || node.password}`;
    if (seenGlobal.has(key)) return;
    const code = forcedCode || detectFromName(node.name);
    if (!code || !/^[A-Z]{2}$/.test(code)) return;
    seenGlobal.add(key);
    if (!byCode.has(code)) byCode.set(code, new Map());
    byCode.get(code).set(key, node);
  }

  // A) mixes (country from names)
  await mapPool(MIX_SOURCES, 7, async (url) => {
    try {
      const txt = await fetchText(url);
      const { nodes } = parseSubscriptionOrLinks(txt);
      for (const n of nodes) addNode(n, null);
      console.log(`mix ok  ${url.split('/').slice(-1)[0].padEnd(24)} (+${nodes.length})`);
    } catch (e) {
      console.log(`mix skip ${url.split('/').slice(-1)[0]} (${e.message})`);
    }
  });

  // B) per-country trees
  const tmpl = await probeTemplates();
  if (tmpl) {
    console.log(`per-country template works: ${tmpl.url('de', tmpl.protos[0])}`);
    const jobs = [];
    for (const code of Object.keys(COUNTRY_NAMES)) {
      for (const p of tmpl.protos) jobs.push({ code, proto: p });
    }
    let fetched = 0;
    await mapPool(jobs, FETCH_CONCURRENCY, async ({ code, proto }) => {
      try {
        const txt = await fetchText(tmpl.url(code.toLowerCase(), proto), 9000);
        const { nodes } = parseSubscriptionOrLinks(txt);
        let added = 0;
        for (const n of nodes) { addNode(n, code); added += 1; }
        if (added) fetched += 1;
      } catch { /* 404 = this country/proto not collected */ }
    });
    console.log(`per-country files with content: ${fetched}/${jobs.length}`);
  } else {
    console.log('per-country tree unavailable this run');
  }

  // summary before testing
  console.log(`\ncandidate countries: ${byCode.size}, unique nodes: ${seenGlobal.size}`);

  // C) liveness test per country (sample up to SAMPLE_PER_COUNTRY, parallel)
  const results = [];
  const entries = [...byCode.entries()];
  for (let i = 0; i < entries.length; i += PING_CONCURRENCY) {
    const slice = entries.slice(i, i + PING_CONCURRENCY);
    const tested = await Promise.all(slice.map(async ([code, map]) => {
      const sample = [...map.values()].slice(0, SAMPLE_PER_COUNTRY);
      const pings = await Promise.all(sample.map((n) => tcpPing(n.server, n.port)));
      const alive = sample
        .map((n, j) => ({ n, ms: pings[j] }))
        .filter((x) => x.ms > 0)
        .sort((a, b) => a.ms - b.ms);
      return { code, total: map.size, alive };
    }));
    results.push(...tested);
    process.stdout.write(`\rliveness: ${Math.min(i + PING_CONCURRENCY, entries.length)}/${entries.length} countries`);
  }
  process.stdout.write('\n');

  // D) keep ONLY countries with ≥1 alive node
  const locations = results
    .filter((r) => r.alive.length > 0)
    .map((r) => ({
      code: r.code,
      country: COUNTRY_NAMES[r.code] || r.code,
      flag: flagOf(r.code),
      tier: 'community',
      count: r.total,
      bestMs: r.alive[0].ms,
      // rank: alive first (fastest first); cap stored links to keep file lean
      nodes: r.alive.slice(0, QUICK ? 4 : 8).map((x) => ({ link: serializeLink(x.n), name: x.n.name })),
    }))
    .sort((a, b) => (a.bestMs || 99999) - (b.bestMs || 99999));

  const outPath = path.join(__dirname, 'community.json');
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), locations }, null, 2));
  console.log(`\nwrote ${outPath}: ${locations.length} WORKING countries`);
  console.log(locations.slice(0, 15).map((c) => `${c.flag} ${c.code} ${String(c.count).padStart(4)} nodes  ${c.bestMs}ms`).join('\n'));

  /* Minimal share-link serializer (enough to re-import into sing-box). */
  function serializeLink(node) {
    switch (node.protocol) {
      case 'vless': {
        const q = new URLSearchParams({
          type: node.transport?.type || 'tcp',
          security: node.tls?.reality?.enabled ? 'reality' : node.tls?.enabled ? 'tls' : 'none',
          sni: node.tls?.serverName || '', fp: node.tls?.fingerprint || 'chrome', flow: node.flow || '',
        });
        if (node.tls?.reality?.enabled) { q.set('pbk', node.tls.reality.publicKey || ''); q.set('sid', node.tls.reality.shortId || ''); }
        if (node.transport?.path) q.set('path', node.transport.path);
        if (node.transport?.host) q.set('host', String(node.transport.host));
        return `vless://${encodeURIComponent(node.uuid)}@${node.server}:${node.port}?${q}#${encodeURIComponent(node.name)}`;
      }
      case 'vmess':
        return 'vmess://' + Buffer.from(JSON.stringify({
          add: node.server, port: String(node.port), id: node.uuid, aid: String(node.alterId || 0),
          scy: node.security || 'auto', ps: node.name, net: node.transport?.type || 'tcp',
          path: node.transport?.path || '', host: node.transport?.host || '',
          tls: node.tls?.enabled ? 'tls' : '',
        })).toString('base64');
      case 'trojan':
        return `trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}?sni=${encodeURIComponent(node.tls?.serverName || node.server)}#${encodeURIComponent(node.name)}`;
      case 'shadowsocks':
        return `ss://${Buffer.from(`${node.method}:${node.password}`).toString('base64')}@${node.server}:${node.port}#${encodeURIComponent(node.name)}`;
      case 'hysteria2':
        return `hysteria2://${encodeURIComponent(node.password || '')}@${node.server}:${node.port}?sni=${encodeURIComponent(node.tls?.serverName || node.server)}#${encodeURIComponent(node.name)}`;
      default:
        return '';
    }
  }
})();
