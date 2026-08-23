'use strict';
/**
 * nashat-vpn — scripts/verify-node.js
 *
 * FULL verification of one share link using the real engine:
 * spawn sing-box with this node → push an HTTPS request through it →
 * resolve { ok, ms } where ms is actual data-transfer latency.
 *
 * Each call uses its own local SOCKS port so many can run in parallel.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseLink } = require('../core/parsers');
const { buildConfig } = require('../core/configBuilder');

const ENGINE = process.env.SING_BOX_EXE || path.join(__dirname, '..', 'engine', 'sing-box.exe');

/**
 * @param {string} link        share link
 * @param {number} socksPort   unique local port for this instance
 * @returns {Promise<{ok:boolean, ms:number}>}
 */
function verifyNode(link, socksPort) {
  return new Promise((resolve) => {
    let node;
    try { node = parseLink(link); } catch { return resolve({ ok: false, ms: -1 }); }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-verify-'));
    const cfg = JSON.parse(JSON.stringify(buildConfig(node, 'socks', { socksPort, httpPort: socksPort + 1 })));
    delete (cfg.experimental || {}).cache_file;
    // route final directly is NOT wanted; default final=proxy is right.
    const cfgPath = path.join(workDir, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));

    const child = execFile(ENGINE, ['run', '-c', cfgPath], { windowsHide: true }, () => {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    const started = Date.now();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok, ms: ok ? Date.now() - started : -1 });
    };

    // wait for port then push real traffic
    const tryCurl = (attempt) => {
      if (settled) return;
      execFile(
        'curl',
        ['-s', '-m', '6', '-x', `socks5://127.0.0.1:${socksPort}`, '-o', 'NUL',
         '-w', '%{http_code}', '--retry', '1', 'https://www.google.com/generate_204'],
        { timeout: 9000, windowsHide: true },
        (err, stdout) => {
          if (settled) return;
          if (!err && /^204/.test(String(stdout).trim())) return finish(true);
          if (attempt < 2 && Date.now() - started < 8000) return setTimeout(() => tryCurl(attempt + 1), 700);
          finish(false);
        },
      );
    };
    setTimeout(() => tryCurl(0), 1200);

    // hard cap
    setTimeout(() => finish(false), 14000);
  });
}

module.exports = { verifyNode };

/* CLI: node scripts/verify-node.js "<link>" [port] */
if (require.main === module) {
  const link = process.argv[2];
  const port = parseInt(process.argv[3] || '21501', 10);
  verifyNode(link, port).then((r) => {
    console.log(r.ok ? `✔ WORKS ${r.ms}ms` : '✘ dead');
    process.exit(r.ok ? 0 : 1);
  });
}
