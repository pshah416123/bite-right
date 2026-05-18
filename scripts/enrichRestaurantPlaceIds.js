#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(projectRoot, 'server', 'scripts', 'backfill-restaurant-places.mjs');

const child = spawn(process.execPath, [scriptPath], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
