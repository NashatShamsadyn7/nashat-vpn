'use strict';
/**
 * nashat-vpn — core/configBuilder.js
 * Build a sing-box configuration JSON from a parsed node + mode.
 * Modes:
 *   socks — local SOCKS5 (2080) + HTTP (2081) proxy only. No admin needed. "like a proxy".
 *   tun   — full-device VPN via TUN interface. Requires Administrator.
 * Zero dependencies.
 */

const SOCKS_PORT = 2080;
const HTTP_PORT = 2081;

/**
 * @param {object} node  parsed node from parsers.js
 * @param {'socks'|'tun'} mode
 * @param {object} opts  { socksPort?, httpPort?, blockAds?, bypassLan?, logLevel? }
 */
function buildConfig(node, mode = 'socks', opts = {}) {
  const socksPort = opts.socksPort || SOCKS_PORT;
  const httpPort = opts.httpPort || HTTP_PORT;
  const proxyTag = 'proxy';

  const inbounds = [
    { type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: socksPort },
    { type: 'http', tag: 'http-in', listen: '127.0.0.1', listen_port: httpPort },
  ];
  if (mode === 'tun') {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'nashatvpn',
      address: ['172.19.0.1/30'],
      mtu: 9000,
      auto_route: true,
      strict_route: true,
      stack: 'mixed',
    });
  }

  const dns = {
    servers: [
      { type: 'https', tag: 'dns-proxy', server: '8.8.8.8', detour: proxyTag },
      { type: 'local', tag: 'dns-direct' },
    ],
    final: 'dns-proxy',
    strategy: 'prefer_ipv4',
  };

  const rules = [];
  if (opts.bypassLan !== false) {
    rules.push({ ip_is_private: true, outbound: 'direct' });
  }
  if (opts.blockAds) {
    rules.push({
      rule_set: ['geosite-category-ads-all'],
      outbound: 'block',
    });
  }

  const config = {
    log: { level: opts.logLevel || 'info', timestamp: true },
    dns,
    inbounds,
    outbounds: [
      nodeToOutbound(node, proxyTag),
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules,
      final: proxyTag,
      auto_detect_interface: true,
      // Resolve outbound server names (and everything needing bootstrap DNS) directly
      default_domain_resolver: { server: 'dns-direct' },
    },
    experimental: {
      cache_file: { enabled: true, path: 'cache.db' },
    },
  };

  if (opts.blockAds) {
    config.route.rule_set = [{
      type: 'remote',
      tag: 'geosite-category-ads-all',
      format: 'binary',
      url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs',
      download_detour: 'direct',
    }];
    config.outbounds.push({ type: 'block', tag: 'block' });
  }

  return config;
}

/** Map a parsed node to a sing-box outbound object. */
function nodeToOutbound(node, tag = 'proxy') {
  const base = { tag, server: node.server, server_port: node.port };
  const tls = buildTls(node);

  switch (node.protocol) {
    case 'vless': {
      const out = { ...base, type: 'vless', uuid: node.uuid, flow: node.flow || '' };
      if (tls) out.tls = tls;
      if (node.transport) out.transport = sanitizeTransport(node.transport);
      return out;
    }
    case 'vmess': {
      const out = {
        ...base, type: 'vmess', uuid: node.uuid,
        security: node.security || 'auto', alter_id: node.alterId || 0,
      };
      if (tls) out.tls = tls;
      if (node.transport) out.transport = sanitizeTransport(node.transport);
      return out;
    }
    case 'trojan': {
      const out = { ...base, type: 'trojan', password: node.password };
      if (tls) out.tls = tls;
      if (node.transport) out.transport = sanitizeTransport(node.transport);
      return out;
    }
    case 'shadowsocks': {
      const out = { ...base, type: 'shadowsocks', method: node.method, password: node.password };
      return out;
    }
    case 'hysteria2': {
      const out = { ...base, type: 'hysteria2', password: node.password || '' };
      out.tls = tls || { enabled: true, insecure: false };
      if (node.upMbps) out.up_mbps = node.upMbps;
      if (node.downMbps) out.down_mbps = node.downMbps;
      return out;
    }
    default:
      throw new Error(`Cannot build outbound for unsupported protocol: ${node.protocol}`);
  }
}

function buildTls(node) {
  const t = node.tls;
  if (!t || !t.enabled) return null;
  const tls = {
    enabled: true,
    server_name: t.serverName || node.server,
    insecure: !!t.insecure,
  };
  if (t.fingerprint) tls.utls = { enabled: true, fingerprint: t.fingerprint };
  if (t.reality && t.reality.enabled) {
    tls.reality = {
      enabled: true,
      public_key: t.reality.publicKey,
      short_id: t.reality.shortId,
    };
    tls.utls = { enabled: true, fingerprint: t.fingerprint || 'chrome' };
  }
  return tls;
}

/** Drop undefined fields sing-box would reject. */
function sanitizeTransport(tr) {
  const clean = JSON.parse(JSON.stringify(tr));
  if (clean.headers && Object.keys(clean.headers).length === 0) delete clean.headers;
  if (clean.earlyDataHeaderName === undefined) delete clean.earlyDataHeaderName;
  return clean;
}

module.exports = { buildConfig, nodeToOutbound, SOCKS_PORT, HTTP_PORT };
