'use strict';
/**
 * nashat-vpn — core/parsers.js
 * Parse VPN/proxy share links into plain node objects.
 * Supported protocols: vless, vmess, trojan, shadowsocks (ss), hysteria2 (hy2).
 * Also parses subscriptions: base64-encoded lists or plain newline-separated links.
 * Zero dependencies.
 */

function b64decode(input) {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function safeDecodeURIComponent(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Parse "?a=b&c=d" style query (after '?', before '#') into an object. */
function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const val = eq === -1 ? '' : pair.slice(eq + 1);
    out[key.toLowerCase()] = safeDecodeURIComponent(val);
  }
  return out;
}

let idCounter = 0;
function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** Parse a single URI-fragment name. */
function fragName(hash) {
  return hash ? safeDecodeURIComponent(hash.replace(/^#/, '')).trim() : '';
}

// ---------------------------------------------------------------------------
// vless://uuid@host:port?params#name
// ---------------------------------------------------------------------------
function parseVless(rest) {
  // rest = everything after "vless://"
  const [main, hash] = splitFragment(rest);
  const at = main.lastIndexOf('@');
  if (at === -1) throw new Error('vless link missing @');
  const userInfo = main.slice(0, at);
  const hostPortQs = main.slice(at + 1);
  const qIdx = hostPortQs.indexOf('?');
  const hostPort = qIdx === -1 ? hostPortQs : hostPortQs.slice(0, qIdx);
  const qs = parseQuery(qIdx === -1 ? '' : hostPortQs.slice(qIdx + 1));
  const cIdx = hostPort.lastIndexOf(':');
  if (cIdx === -1) throw new Error('vless link missing port');
  const host = hostPort.slice(0, cIdx).replace(/^\[|\]$/g, ''); // strip ipv6 brackets
  const port = parseInt(hostPort.slice(cIdx + 1), 10);

  const node = {
    id: makeId('vless'),
    name: fragName(hash) || `${host}:${port}`,
    protocol: 'vless',
    server: host,
    port,
    uuid: userInfo,
    flow: qs.flow || '',
    tls: {
      enabled: (qs.security === 'tls' || qs.security === 'reality'),
      serverName: qs.sni || qs.host || '',
      insecure: qs.allowinsecure === '1' || qs.insecure === '1',
      fingerprint: qs.fp || 'chrome',
    },
  };
  if (qs.security === 'reality') {
    node.tls.reality = {
      enabled: true,
      publicKey: qs.pbk || '',
      shortId: qs.sid || '',
    };
  }
  const transport = buildTransport(qs);
  if (transport) node.transport = transport;
  return node;
}

// ---------------------------------------------------------------------------
// trojan://password@host:port?params#name
// ---------------------------------------------------------------------------
function parseTrojan(rest) {
  const [main, hash] = splitFragment(rest);
  const at = main.lastIndexOf('@');
  if (at === -1) throw new Error('trojan link missing @');
  const password = main.slice(0, at);
  const hostPortQs = main.slice(at + 1);
  const qIdx = hostPortQs.indexOf('?');
  const hostPort = qIdx === -1 ? hostPortQs : hostPortQs.slice(0, qIdx);
  const qs = parseQuery(qIdx === -1 ? '' : hostPortQs.slice(qIdx + 1));
  const cIdx = hostPort.lastIndexOf(':');
  if (cIdx === -1) throw new Error('trojan link missing port');
  const host = hostPort.slice(0, cIdx).replace(/^\[|\]$/g, '');
  const port = parseInt(hostPort.slice(cIdx + 1), 10);

  const node = {
    id: makeId('trojan'),
    name: fragName(hash) || `${host}:${port}`,
    protocol: 'trojan',
    server: host,
    port,
    password,
    tls: {
      enabled: true,
      serverName: qs.sni || qs.peer || host,
      insecure: qs.allowinsecure === '1' || qs.insecure === '1',
      fingerprint: qs.fp || 'chrome',
    },
  };
  const transport = buildTransport(qs);
  if (transport && transport.type !== 'tcp') node.transport = transport;
  return node;
}

// ---------------------------------------------------------------------------
// ss:// (SIP002 and legacy base64 forms)
// ---------------------------------------------------------------------------
function parseShadowsocks(rest) {
  const [main, hash] = splitFragment(rest);
  let method = '';
  let password = '';
  let hostPort = '';
  let plugin = '';

  if (main.includes('@')) {
    // SIP002: ss://base64(method:password)@host:port/?plugin=...
    const at = main.lastIndexOf('@');
    let userInfo = main.slice(0, at);
    hostPort = main.slice(at + 1).split('/').filter(Boolean)[0] || main.slice(at + 1);
    const qIdx = hostPort.indexOf('?');
    if (qIdx !== -1) {
      const qs = parseQuery(hostPort.slice(qIdx + 1));
      plugin = qs.plugin || '';
      hostPort = hostPort.slice(0, qIdx);
    }
    if (!userInfo.includes(':')) userInfo = b64decode(userInfo);
    const c = userInfo.indexOf(':');
    method = userInfo.slice(0, c);
    password = userInfo.slice(c + 1);
  } else {
    // legacy: ss://base64(method:password@host:port)
    const decoded = b64decode(main);
    const at = decoded.lastIndexOf('@');
    const mp = decoded.slice(0, at);
    const c = mp.indexOf(':');
    method = mp.slice(0, c);
    password = mp.slice(c + 1);
    hostPort = decoded.slice(at + 1);
  }

  const cIdx = hostPort.lastIndexOf(':');
  if (cIdx === -1) throw new Error('ss link missing port');
  const host = hostPort.slice(0, cIdx).replace(/^\[|\]$/g, '');
  const port = parseInt(hostPort.slice(cIdx + 1), 10);

  const node = {
    id: makeId('ss'),
    name: fragName(hash) || `${host}:${port}`,
    protocol: 'shadowsocks',
    server: host,
    port,
    method,
    password,
  };
  if (plugin) {
    // e.g. obfs-local;obfs=http;obfs-host=example.com (v2ray-plugin similar)
    const parts = plugin.split(';');
    node.plugin = parts[0];
    node.pluginOpts = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > 0) node.pluginOpts[p.slice(0, eq)] = p.slice(eq + 1);
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// vmess://base64(json)
// ---------------------------------------------------------------------------
function parseVmess(rest) {
  const json = JSON.parse(b64decode(rest));
  const port = parseInt(String(json.port), 10);
  if (!json.add || !Number.isFinite(port) || !json.id) throw new Error('vmess payload incomplete');
  const tlsEnabled = String(json.tls || '') === 'tls';
  const node = {
    id: makeId('vmess'),
    name: json.ps || `${json.add}:${port}`,
    protocol: 'vmess',
    server: String(json.add),
    port,
    uuid: String(json.id),
    alterId: parseInt(String(json.aid ?? json.alterId ?? '0'), 10) || 0,
    security: String(json.scy || 'auto'),
    tls: {
      enabled: tlsEnabled,
      serverName: json.sni || json.host || '',
      insecure: false,
    },
  };
  const net = String(json.net || 'tcp');
  const qs = {
    type: net,
    path: json.path || '',
    host: json.host || '',
    serviceName: json.path || '',
  };
  const transport = buildTransport(qs);
  if (transport && transport.type !== 'tcp') node.transport = transport;
  if (String(json.type || '') === 'http' && net === 'tcp') {
    node.transport = { type: 'http', path: json.path || '/', host: [json.host].filter(Boolean) };
  }
  return node;
}

// ---------------------------------------------------------------------------
// hysteria2://auth@host:port/?params#name   (also hy2://)
// ---------------------------------------------------------------------------
function parseHysteria2(rest) {
  const [main, hash] = splitFragment(rest);
  const qIdx = main.indexOf('?');
  const qs = parseQuery(qIdx === -1 ? '' : main.slice(qIdx + 1));
  const hostPart = qIdx === -1 ? main : main.slice(0, qIdx);
  const at = hostPart.lastIndexOf('@');
  let auth = '';
  let hostPort = hostPart;
  if (at !== -1) {
    auth = hostPart.slice(0, at);
    hostPort = hostPart.slice(at + 1);
  }
  // handle host:port,port-hopping notation "host:443,20000-30000"
  const cIdx = hostPort.lastIndexOf(':');
  if (cIdx === -1) throw new Error('hysteria2 link missing port');
  const host = hostPort.slice(0, cIdx).replace(/^\[|\]$/g, '');
  const port = parseInt(hostPort.slice(cIdx + 1).split(',')[0], 10);

  return {
    id: makeId('hy2'),
    name: fragName(hash) || `${host}:${port}`,
    protocol: 'hysteria2',
    server: host,
    port,
    password: auth,
    tls: {
      enabled: true,
      serverName: qs.sni || host,
      insecure: qs.insecure === '1' || qs.allowinsecure === '1',
    },
    upMbps: parseInt(qs.up || '0', 10) || undefined,
    downMbps: parseInt(qs.down || '0', 10) || undefined,
  };
}

// ---------------------------------------------------------------------------

function splitFragment(s) {
  const h = s.indexOf('#');
  return h === -1 ? [s, ''] : [s.slice(0, h), s.slice(h)];
}

/** Build a sing-box-style transport object from common query params. */
function buildTransport(qs) {
  const type = (qs.type || 'tcp').toLowerCase();
  switch (type) {
    case 'ws':
      return {
        type: 'ws',
        path: qs.path || '/',
        headers: qs.host ? { Host: qs.host } : {},
        earlyDataHeaderName: qs.ed ? 'Sec-WebSocket-Protocol' : undefined,
      };
    case 'grpc':
      return { type: 'grpc', serviceName: qs.servicename || qs.path || '' };
    case 'http':
    case 'h2':
      return { type: 'http', path: qs.path || '/', host: (qs.host || '').split(',').filter(Boolean) };
    case 'httpupgrade':
      return { type: 'httpupgrade', path: qs.path || '/', host: qs.host || '' };
    default:
      return null; // tcp/raw — no transport object needed
  }
}

/** Parse exactly one share link; returns node or throws. */
function parseLink(link) {
  const trimmed = String(link).trim();
  if (trimmed.startsWith('vless://')) return parseVless(trimmed.slice(8));
  if (trimmed.startsWith('trojan://')) return parseTrojan(trimmed.slice(9));
  if (trimmed.startsWith('ss://')) return parseShadowsocks(trimmed.slice(5));
  if (trimmed.startsWith('vmess://')) return parseVmess(trimmed.slice(8));
  if (trimmed.startsWith('hysteria2://')) return parseHysteria2(trimmed.slice(12));
  if (trimmed.startsWith('hy2://')) return parseHysteria2(trimmed.slice(6));
  throw new Error(`Unsupported link scheme: ${trimmed.slice(0, 24)}…`);
}

/**
 * Parse pasted text: a subscription (whole-text base64) or any mix of
 * newline/comma separated share links. Returns { nodes, errors }.
 */
function parseSubscriptionOrLinks(text) {
  const raw = String(text || '').trim();
  if (!raw) return { nodes: [], errors: [] };

  // Whole-payload base64 subscription?
  if (/^[A-Za-z0-9+/=_\-\r\n]+$/.test(raw) && !raw.includes('://')) {
    try {
      const decoded = b64decode(raw);
      if (decoded.includes('://')) {
        return collectLines(decoded);
      }
    } catch { /* fall through to plain-line parsing */ }
  }
  return collectLines(raw);
}

function collectLines(text) {
  const nodes = [];
  const errors = [];
  for (const line of text.split(/[\r\n]+|\s+(?=vless:\/\/|vmess:\/\/|trojan:\/\/|ss:\/\/|hysteria2?:\/\/)/)) {
    const t = line.trim();
    if (!t || t.length < 8) continue;
    try {
      nodes.push(parseLink(t));
    } catch (e) {
      errors.push({ line: t.slice(0, 60), reason: e.message });
    }
  }
  return { nodes, errors };
}

module.exports = {
  parseLink,
  parseSubscriptionOrLinks,
  b64decode,
};
