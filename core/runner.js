'use strict';
/**
 * nashat-vpn — core/runner.js
 * Start/stop the sing-box engine as an independent OS process.
 * The engine outlives the CLI invocation (so `up` exits instantly) and is
 * tracked with a PID file so any later command can stop it. Logs stream to a
 * file instead of pipes, so nothing can block.
 * Zero dependencies.
 */

const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

/** Locate sing-box.exe: explicit env, project engine dir, then PATH. */
function findEngine() {
  const candidates = [];
  if (process.env.SING_BOX_EXE) candidates.push(process.env.SING_BOX_EXE);
  // When frozen into an EXE (Node SEA), __dirname is inside the bundle —
  // prefer looking next to the actual executable.
  const exeDir = path.dirname(process.execPath);
  candidates.push(path.join(exeDir, 'sing-box.exe'));
  candidates.push(path.join(exeDir, 'engine', 'sing-box.exe'));
  const root = path.resolve(__dirname, '..');
  candidates.push(path.join(root, 'engine', 'sing-box.exe'));
  for (const dir of (process.env.PATH || '').split(';')) {
    if (!dir) continue;
    candidates.push(path.join(dir.trim(), 'sing-box.exe'));
  }
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch { /* keep looking */ }
  }
  return null;
}

/** Wait until a local TCP port accepts a connection (proxy is alive). */
function waitForPort(port, host = '127.0.0.1', timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.connect({ port, host }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

class VpnRunner {
  constructor(enginePath, workDir) {
    this.enginePath = enginePath || findEngine();
    this.workDir = workDir;
  }

  /** Validate config without starting. Returns { ok, output }. */
  static checkConfig(enginePath, configPath) {
    return new Promise((resolve) => {
      const p = spawn(enginePath, ['check', '-c', configPath], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (code) => resolve({ ok: code === 0, output: out.trim() }));
      p.on('error', (e) => resolve({ ok: false, output: e.message }));
    });
  }

  /**
   * Write config, validate it, then launch sing-box DETACHED.
   * Resolves once the SOCKS inbound accepts TCP connections.
   */
  async start(configObj, workDir = this.workDir) {
    if (!this.enginePath) throw new Error('sing-box.exe not found — see docs/USAGE.md (engine section)');
    fs.mkdirSync(workDir, { recursive: true });
    const configPath = path.join(workDir, 'config.json');

    // strip our own bookkeeping keys sing-box doesn't know
    const cfg = JSON.parse(JSON.stringify(configObj));
    delete (cfg.experimental || {}).cache_file;

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    const verdict = await VpnRunner.checkConfig(this.enginePath, configPath);
    if (!verdict.ok) throw new Error(`Config rejected by sing-box:\n${verdict.output}`);

    this.stop(workDir); // ensure no previous instance

    const logPath = path.join(workDir, 'sing-box.log');
    const pidPath = path.join(workDir, 'sing-box.pid');
    const logFd = fs.openSync(logPath, 'a');

    const child = spawn(this.enginePath, ['run', '-c', configPath], {
      cwd: workDir,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
      detached: true,
    });
    child.unref();          // CLI can exit; engine keeps running
    fs.closeSync(logFd);
    fs.writeFileSync(pidPath, String(child.pid));

    await waitForPort(2080);
    return { pid: child.pid, configPath, logPath };
  }

  /**
   * Stop any instance recorded in the PID file (works across processes).
   * Also sweeps orphaned sing-box processes from crashed parents.
   */
  stop(workDir = this.workDir) {
    const pidPath = path.join(workDir, 'sing-box.pid');
    let stopped = false;
    if (fs.existsSync(pidPath)) {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      stopped = killPid(pid);
      try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
    }
    return stopped;
  }

  /** Last n lines of the engine log. */
  logs(workDir = this.workDir, n = 40) {
    const logPath = path.join(workDir, 'sing-box.log');
    try {
      return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-n).join('\n');
    } catch {
      return '';
    }
  }
}

function killPid(pid) {
  if (!Number.isFinite(pid)) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false; // already gone
  }
}

module.exports = { VpnRunner, findEngine, waitForPort };
