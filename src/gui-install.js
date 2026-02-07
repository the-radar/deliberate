/**
 * GUI installer for Deliberate v2.
 *
 * The npm package does not bundle the Tauri app. Instead we support a small
 * "download from GitHub Releases" flow. This keeps the npm install fast while
 * still letting users run `deliberate gui`.
 *
 * This installer is best-effort. If the repo does not have the expected asset,
 * we return a clear error so the user can choose a URL or build locally.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';

function platformKey() {
  const p = process.platform;
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

function archKey() {
  if (process.arch === 'arm64') return 'aarch64';
  if (process.arch === 'x64') return 'x64';
  return process.arch;
}

function getInstallDir() {
  return path.join(os.homedir(), '.deliberate', 'bin');
}

export function getInstalledGuiPath() {
  const exe = process.platform === 'win32' ? 'deliberate-gui.exe' : 'deliberate-gui';
  return path.join(getInstallDir(), exe);
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url, {
    headers: {
      // GitHub requires a UA for some endpoints.
      'user-agent': 'deliberate'
    }
  });

  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status})`);
  }

  await pipeline(res.body, fs.createWriteStream(outPath));
}

function pickAsset(assets) {
  const plat = platformKey();
  const arch = archKey();

  // We accept either a raw binary asset or a compressed one, but in practice
  // we prefer a raw executable since it is simplest to install cross-platform.
  const candidates = assets
    .filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string')
    .map((a) => ({ name: a.name.toLowerCase(), url: a.browser_download_url, rawName: a.name }));

  const matches = candidates.filter((c) => c.name.includes(plat) && c.name.includes(arch));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches[0];

  const platOnly = candidates.filter((c) => c.name.includes(plat));
  if (platOnly.length === 1) return platOnly[0];
  if (platOnly.length > 1) return platOnly[0];

  // Last resort: anything that looks like a gui binary.
  const anyGui = candidates.find((c) => c.name.includes('gui') || c.name.includes('deliberate'));
  if (anyGui) return anyGui;

  return null;
}

export async function installGuiFromGithubRelease(opts = {}) {
  const repo = opts.repo || 'the-radar/deliberate';
  const tag = opts.tag || null;

  const apiUrl = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  const res = await fetch(apiUrl, { headers: { 'user-agent': 'deliberate' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch release metadata (${res.status})`);
  }
  const release = await res.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];

  const asset = opts.assetUrl
    ? { url: opts.assetUrl, rawName: path.basename(opts.assetUrl) }
    : pickAsset(assets);

  if (!asset) {
    throw new Error('No suitable GUI asset found in the release');
  }

  const installDir = getInstallDir();
  fs.mkdirSync(installDir, { recursive: true });

  const dest = getInstalledGuiPath();
  const tmp = path.join(os.tmpdir(), `deliberate-gui.${process.pid}.${Date.now()}.tmp`);

  await downloadToFile(asset.url, tmp);
  fs.renameSync(tmp, dest);

  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }

  return { installedPath: dest, assetName: asset.rawName || asset.name || 'unknown' };
}

export default {
  installGuiFromGithubRelease,
  getInstalledGuiPath
};

