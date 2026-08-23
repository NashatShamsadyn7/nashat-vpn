'use strict';
/**
 * nashat-vpn — directory/fetch-community.js
 * Builds the COMMUNITY tier: pulls public v2ray/xray node lists, detects each
 * node's country (flag emoji / name), TCP-pings a sample per country for
 * latency, and writes directory/community.json grouped by country.
 *
 *   node directory/fetch-community.js            # full run
 *   node directory/fetch-community.js --quick    # smaller sample, faster
 *
 * Output shape: [{ code, country, flag, count, bestMs, nodes: [link…] }]
 * The desktop app merges this with directory/servers.json (owner tier).
 * Zero dependencies.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { parseSubscriptionOrLinks } = require('../core/parsers');

const SOURCES = [
  'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt',
  'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt',
  'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub1.txt',
  'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub2.txt',
];

const QUICK = process.argv.includes('--quick');
const SAMPLE_PER_COUNTRY = QUICK ? 3 : 8;
const TCP_TIMEOUT = 2500;

/** flag emoji -> ISO code (each flag = two regional indicators). */
function flagToCode(name) {
  const flags = name.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [];
  if (!flags.length) return null;
  const [a, b] = [...flags[0]].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65));
  return a + b;
}

/** Country hints found in node names, e.g. "US", "United States", "America". */
const NAME_HINTS = [
  [/united states|\busa?\b|america|los angeles|seattle|dallas|ashburn/i, 'US'],
  [/united kingdom|\buks?\b|london|britain/i, 'GB'],
  [/germany|\bde\b|frankfurt|berlin/i, 'DE'],
  [/france|\bfr\b|paris/i, 'FR'],
  [/netherlands|\bnl\b|amsterdam/i, 'NL'],
  [/turkey|turkiye|türkiye|\btr\b|istanbul/i, 'TR'],
  [/emirates|\buae?\b|dubai/i, 'AE'],
  [/canada|\bca\b|toronto|montreal/i, 'CA'],
  [/japan|\bjp\b|tokyo|osaka/i, 'JP'],
  [/singapore|\bsg\b/i, 'SG'],
  [/india|\bin\b|mumbai/i, 'IN'],
  [/australia|\bau\b|sydney/i, 'AU'],
  [/sweden|\bse\b|stockholm/i, 'SE'],
  [/switzerland|\bch\b|zurich/i, 'CH'],
  [/poland|\bpl\b|warsaw/i, 'PL'],
  [/italy|\bit\b|milan|rome/i, 'IT'],
  [/spain|\bes\b|madrid/i, 'ES'],
  [/russia|\bru\b|moscow/i, 'RU'],
  [/brazil|\bbr\b|sao paulo/i, 'BR'],
  [/korea|\bkr\b|seoul/i, 'KR'],
  [/hong ?kong|\bhk\b/i, 'HK'],
  [/taiwan|\btw\b/i, 'TW'],
  [/malaysia|\bmy\b/i, 'MY'],
  [/indonesia|\bid\b|jakarta/i, 'ID'],
  [/vietnam|\bvn\b/i, 'VN'],
  [/thailand|\bth\b/i, 'TH'],
  [/mexico|\bmx\b/i, 'MX'],
  [/argentina|\bar\b|buenos/i, 'AR'],
  [/finland|\bfi\b|helsinki/i, 'FI'],
  [/norway|\bno\b|oslo/i, 'NO'],
  [/austria|\bat\b|vienna/i, 'AT'],
  [/romania|\bro\b/i, 'RO'],
  [/bulgaria|\bbg\b/i, 'BG'],
  [/ukraine|\bua\b|kyiv/i, 'UA'],
  [/israel|\bil\b/i, 'IL'],
  [/qatar|\bqa\b|doha/i, 'QA'],
  [/kuwait|\bkw\b/i, 'KW'],
  [/saudi|\bsa\b|riyadh/i, 'SA'],
  [/egypt|\beg\b|cairo/i, 'EG'],
  [/morocco|\bma\b/i, 'MA'],
  [/south africa|\bza\b/i, 'ZA'],
  [/nigeria|\bng\b/i, 'NG'],
  [/kazakhstan|\bkz\b/i, 'KZ'],
  [/armenia|\bam\b/i, 'AM'],
  [/georgia\b|\bge\b|tbilisi/i, 'GE'],
  [/azerbaijan|\baz\b|baku/i, 'AZ'],
  [/iraq|baghdad|\biq\b/i, 'IQ'],
  [/iran|tehran|\bir\b/i, 'IR'],
  [/china|\bcn\b|shanghai|beijing/i, 'CN'],
  [/philippines|\bph\b/i, 'PH'],
  [/pakistan|\bpk\b/i, 'PK'],
  [/bangladesh|\bbd\b/i, 'BD'],
  [/sri lanka|\blk\b/i, 'LK'],
  [/nepal|\bnp\b/i, 'NP'],
  [/denmark|\bdk\b/i, 'DK'],
  [/belgium|\bbe\b/i, 'BE'],
  [/portugal|\bpt\b/i, 'PT'],
  [/greece|\bgr\b/i, 'GR'],
  [/hungary|\bhu\b|budapest/i, 'HU'],
  [/czech|\bcz\b|prague/i, 'CZ'],
  [/ireland|\bie\b/i, 'IE'],
  [/luxembourg|\blu\b/i, 'LU'],
  [/moldova|\bmd\b/i, 'MD'],
  [/lithuania|\blt\b/i, 'LT'],
  [/latvia|\blv\b/i, 'LV'],
  [/estonia|\bee\b/i, 'EE'],
  [/serbia|\brs\b/i, 'RS'],
  [/slovakia|\bsk\b/i, 'SK'],
  [/slovenia|\bsi\b/i, 'SI'],
  [/croatia|\bhr\b/i, 'HR'],
  [/cyprus|\bcy\b/i, 'CY'],
  [/albania|\bal\b/i, 'AL'],
  [/chile|\bcl\b/i, 'CL'],
  [/colombia|\bco\b/i, 'CO'],
  [/peru|\bpe\b/i, 'PE'],
  [/ecuador|\bec\b/i, 'EC'],
];

function detectCountry(node) {
  const name = node.name || '';
  const byFlag = flagToCode(name);
  if (byFlag) return byFlag;
  for (const [re, code] of NAME_HINTS) if (re.test(name)) return code;
  return null;
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

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  NL: 'Netherlands', TR: 'Türkiye', AE: 'United Arab Emirates', CA: 'Canada',
  JP: 'Japan', SG: 'Singapore', IN: 'India', AU: 'Australia', SE: 'Sweden',
  CH: 'Switzerland', PL: 'Poland', IT: 'Italy', ES: 'Spain', RU: 'Russia',
  BR: 'Brazil', KR: 'South Korea', HK: 'Hong Kong', TW: 'Taiwan', MY: 'Malaysia',
  ID: 'Indonesia', VN: 'Vietnam', TH: 'Thailand', MX: 'Mexico', AR: 'Argentina',
  FI: 'Finland', NO: 'Norway', AT: 'Austria', RO: 'Romania', BG: 'Bulgaria',
  UA: 'Ukraine', IL: 'Israel', QA: 'Qatar', KW: 'Kuwait', SA: 'Saudi Arabia',
  EG: 'Egypt', MA: 'Morocco', ZA: 'South Africa', NG: 'Nigeria', KZ: 'Kazakhstan',
  AM: 'Armenia', GE: 'Georgia', AZ: 'Azerbaijan', IQ: 'Iraq', IR: 'Iran',
  CN: 'China', PH: 'Philippines', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka',
  NP: 'Nepal', DK: 'Denmark', BE: 'Belgium', PT: 'Portugal', GR: 'Greece',
  HU: 'Hungary', CZ: 'Czechia', IE: 'Ireland', LU: 'Luxembourg', MD: 'Moldova',
  LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', RS: 'Serbia', SK: 'Slovakia',
  SI: 'Slovenia', HR: 'Croatia', CY: 'Cyprus', AL: 'Albania', CL: 'Chile',
  CO: 'Colombia', PE: 'Peru', EC: 'Ecuador',
};

function flagOf(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '🏳️';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

(async () => {
  console.log('── nashat-vpn community directory builder ──');
  const byCountry = new Map();
  const seen = new Set();
  let total = 0;

  for (const url of SOURCES) {
    try {
      console.log(`fetching ${new URL(url).pathname.split('/').slice(-1)[0]} …`);
      const text = await fetchText(url);
      const { nodes, errors } = parseSubscriptionOrLinks(text);
      for (const node of nodes) {
        const key = `${node.protocol}|${node.server}|${node.port}|${node.uuid || node.password}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const code = detectCountry(node);
        if (!code) continue;
        if (!byCountry.has(code)) byCountry.set(code, []);
        byCountry.get(code).push(node);
        total += 1;
      }
      console.log(`  ok (+${nodes.length} parsed)`);
    } catch (e) {
      console.log(`  skipped (${e.message.split('\n')[0]})`);
    }
  }
  console.log(`unique country-tagged nodes: ${total} across ${byCountry.size} countries`);

  // ping a sample per country to rank it
  const out = [];
  for (const [code, nodes] of byCountry.entries()) {
    const sample = nodes.slice(0, SAMPLE_PER_COUNTRY);
    const pings = await Promise.all(sample.map((n) => tcpPing(n.server, n.port)));
    const alive = pings.filter((ms) => ms > 0);
    const bestMs = alive.length ? Math.min(...alive) : -1;
    // keep working nodes first, then the rest
    const ranked = [...sample.entries()]
      .sort((a, b) => (pings[a[0]] > 0 ? 1 : 0) - (pings[b[0]] > 0 ? 1 : 0))
      .map(([, n]) => n);
    out.push({
      code,
      country: COUNTRY_NAMES[code] || code,
      flag: flagOf(code),
      tier: 'community',
      count: nodes.length,
      bestMs,
      nodes: ranked.map((n) => ({ link: serializeLink(n), name: n.name })),
    });
  }
  out.sort((a, b) => (a.bestMs > 0 ? a.bestMs : 99999) - (b.bestMs > 0 ? b.bestMs : 99999));

  const outPath = path.join(__dirname, 'community.json');
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), locations: out }, null, 2));
  console.log(`\nwrote ${outPath}: ${out.length} countries`);
  console.log(out.slice(0, 12).map((c) => `${c.flag} ${c.code}  ${String(c.count).padStart(4)} nodes  ${c.bestMs > 0 ? c.bestMs + 'ms' : 'n/a'}`).join('\n'));
})();

/** Minimal share-link serializer (enough to re-import in the app). */
function serializeLink(node) {
  switch (node.protocol) {
    case 'vless': {
      const q = new URLSearchParams({
        type: node.transport?.type || 'tcp',
        security: node.tls?.reality?.enabled ? 'reality' : node.tls?.enabled ? 'tls' : 'none',
        sni: node.tls?.serverName || '',
        fp: node.tls?.fingerprint || 'chrome',
        flow: node.flow || '',
      });
      if (node.tls?.reality?.enabled) {
        q.set('pbk', node.tls.reality.publicKey || '');
        q.set('sid', node.tls.reality.shortId || '');
      }
      if (node.transport?.path) q.set('path', node.transport.path);
      if (node.transport?.host) q.set('host', String(node.transport.host));
      return `vless://${encodeURIComponent(node.uuid)}@${node.server}:${node.port}?${q}#${encodeURIComponent(node.name)}`;
    }
    case 'vmess': {
      const payload = Buffer.from(JSON.stringify({
        add: node.server, port: String(node.port), id: node.uuid, aid: String(node.alterId || 0),
        scy: node.security || 'auto', ps: node.name, net: node.transport?.type || 'tcp',
        path: node.transport?.path || '', host: node.transport?.host || '',
        tls: node.tls?.enabled ? 'tls' : '',
      })).toString('base64');
      return `vmess://${payload}`;
    }
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
