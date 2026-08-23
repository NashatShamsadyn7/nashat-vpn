'use strict';
/**
 * Bundles the Electron main + preload using esbuild's JS API directly
 * (spawning npx breaks on Node 22 win32 — spawnSync EINVAL).
 * Run by `npm run build:main`.
 */
const esbuild = require('esbuild');
const path = require('path');

async function bundle(entry, outfile) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, entry)],
    outfile: path.join(__dirname, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'info',
  });
}

(async () => {
  await bundle('src/main.ts', 'dist-electron/main.js');
  await bundle('src/preload.ts', 'dist-electron/preload.js');
  console.log('main + preload bundled.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
