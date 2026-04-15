#!/usr/bin/env node
/**
 * start.js — RagaStream frontend dev launcher
 *
 * Reads EXPO_DEV_HOST from .env and starts Expo with the correct LAN IP
 * so the QR code shows your real device IP instead of 127.0.0.1.
 *
 * How it works:
 *   Expo reads REACT_NATIVE_PACKAGER_HOSTNAME to override the IP shown in
 *   the QR code. We set that env var before spawning `expo start --lan`.
 *
 * Usage:  npm run dev
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Load .env manually (no external deps needed) ────────────────────────────
const envPath = path.join(__dirname, '.env');
let devHost = null;

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('EXPO_DEV_HOST=')) {
      devHost = trimmed.slice('EXPO_DEV_HOST='.length).trim();
      break;
    }
  }
}

if (!devHost) {
  console.warn(
    '\n⚠️  EXPO_DEV_HOST not set in frontend/.env\n' +
    '   Falling back to Expo auto-detect (may show 127.0.0.1).\n' +
    '   Add this line to frontend/.env:\n' +
    '     EXPO_DEV_HOST=<your-wifi-ip>\n'
  );
}

// ── Print what we are doing ──────────────────────────────────────────────────
console.log('\n🎵 RagaStream — Starting Expo');
if (devHost) {
  console.log(`   LAN host : ${devHost}`);
  console.log(`   QR will  : exp://${devHost}:8081`);
}
console.log('');

// ── Build environment for child process ─────────────────────────────────────
// REACT_NATIVE_PACKAGER_HOSTNAME is the official Expo mechanism to override
// the IP address shown in the QR code. --lan tells Expo to use LAN mode.
const childEnv = { ...process.env };
if (devHost) {
  childEnv.REACT_NATIVE_PACKAGER_HOSTNAME = devHost;
}

// ── Spawn Expo ───────────────────────────────────────────────────────────────
const args = ['expo', 'start', '--clear', '--lan'];
console.log(`   Running: npx ${args.join(' ')}\n`);

const proc = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: childEnv,
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
