'use strict';
/**
 * nashat-vpn — tests/smoke.js
 * End-to-end smoke test: parse links → build configs → validate with real sing-box.
 * Run: node tests/smoke.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { parseLink, parseSubscriptionOrLinks } = require('../core/parsers');
const { buildConfig } = require('../core/configBuilder');

const ENGINE = process.env.SING_BOX_EXE || path.join(__dirname, '..', 'engine', 'sing-box.exe');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✔ ${name}`); }
  else { fail += 1; console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// --- sample share links covering every supported protocol -------------------
const LINKS = {
  vlessReality: 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@203.0.113.10:443?type=tcp&security=reality&pbk=xR8mVvN0tX7TqLZ2wK3yH5jF9sD1aG4uB6nC8eM0pQo&sni=www.microsoft.com&sid=6ba85179&fp=chrome&flow=xtls-rprx-vision#My%20REALITY%20Node',
  vlessWs: 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@203.0.113.20:8880?type=ws&path=%2Fray&host=cdn.example.com#WS%20Node',
  trojan: 'trojan://hunter2password@203.0.113.30:443?sni=example.com&fp=chrome#Trojan%20Fast',
  ss: 'ss://YWVzLTI1Ni1nY206dGVzdHBhc3N3b3Jk@203.0.113.40:8388#SS%20Simple',
  vmess: 'vmess://eyJhZGQiOiIyMDMuMC4xMTMuNTAiLCJhaWQiOiIwIiwiaWQiOiJiODMxMzgxZC02MzI0LTRkNTMtYWQ0Zi04Y2RhNDhiMzA4MTEiLCJuZXQiOiJ3cyIsInBhdGgiOiIvd3MiLCJwb3J0IjoiNDQzIiwicHMiOiJWTWVzcyBOb2RlIiwic2N5IjoiYXV0byIsInRscyI6InRscyIsInR5cGUiOiJub25lIn0=',
  hy2: 'hysteria2://letmein@203.0.113.60:36712?sni=hy2.example.com&insecure=0#HY2%20UDP',
};

function validateWithSingbox(config) {
  const tmp = path.join(os.tmpdir(), `nv-smoke-${Date.now()}-${Math.floor(Math.random() * 9999)}.json`);
  const cfg = JSON.parse(JSON.stringify(config));
  delete cfg.experimental; // runner strips cache_file too
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  try {
    execFileSync(ENGINE, ['check', '-c', tmp], { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.stdout || e.message) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

console.log(`Engine: ${ENGINE} (${fs.existsSync(ENGINE) ? 'found' : 'MISSING!'})\n`);

console.log('1) Link parsing:');
const parsed = {};
for (const [label, link] of Object.entries(LINKS)) {
  try {
    parsed[label] = parseLink(link);
    ok(`${label} → ${parsed[label].protocol} ${parsed[label].server}:${parsed[label].port}`, true);
  } catch (e) {
    ok(label, false, e.message);
    parsed[label] = null;
  }
}
ok('REALITY fields captured',
  parsed.vlessReality && parsed.vlessReality.tls.reality &&
  parsed.vlessReality.tls.reality.publicKey.startsWith('xR8') &&
  parsed.vlessReality.flow === 'xtls-rprx-vision');
ok('vmess name decoded', parsed.vmess && parsed.vmess.name === 'VMess Node');
ok('ss method decoded', parsed.ss && parsed.ss.method === 'aes-256-gcm' && parsed.ss.password === 'testpassword');

console.log('\n2) Subscription parsing:');
const subText = Object.values(LINKS).join('\n') + '\ngarbage-line-that-is-not-a-link';
const { nodes, errors } = parseSubscriptionOrLinks(subText);
ok(`mixed list → ${nodes.length}/6 nodes`, nodes.length === 6);
ok('1 error reported', errors.length === 1);
const b64sub = Buffer.from(Object.values(LINKS).join('\n')).toString('base64');
const sub2 = parseSubscriptionOrLinks(b64sub);
ok('base64 subscription → 6 nodes', sub2.nodes.length === 6);

console.log('\n3) Config building + sing-box validation:');
for (const [label, node] of Object.entries(parsed)) {
  if (!node) continue;
  for (const mode of ['socks', 'tun']) {
    const cfg = buildConfig(node, mode);
    const verdict = validateWithSingbox(cfg);
    ok(`${label} [${mode}] accepted by sing-box`, verdict.ok, (verdict.err || '').split('\n')[0]);
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
