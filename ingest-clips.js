/**
 * ingest-clips.js — Upload clips to Shotstack Ingest CDN
 *
 * Usage: node ingest-clips.js [env=sandbox|prod] clip1=/path/or/url broll1=/path/or/url audio=/path/or/url
 *
 * - Local file paths: uploaded directly to Shotstack via signed URL
 * - HTTP/HTTPS URLs: downloaded to a temp file first, then uploaded
 * - Already-ingested Shotstack URLs: returned as-is (no re-upload)
 *
 * Output: JSON to stdout  { "clip1": "https://cdn.shotstack.io/...", ... }
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Parse args ---

let ENV = 'prod';
const inputs = {};

for (const arg of process.argv.slice(2)) {
  if (arg === 'sandbox' || arg === 'prod') { ENV = arg; continue; }
  const eqIdx = arg.indexOf('=');
  if (eqIdx === -1) { console.error(`Skipping unrecognized arg: ${arg}`); continue; }
  const label = arg.slice(0, eqIdx).trim();
  const value = arg.slice(eqIdx + 1).trim();
  if (label && value) inputs[label] = value;
}

if (Object.keys(inputs).length === 0) {
  console.error('Usage: node ingest-clips.js [sandbox|prod] clip1=/path/or/url broll1=/path/or/url audio=/path/or/url');
  process.exit(1);
}

// --- Shotstack config ---

const SHOTSTACK_KEY = ENV === 'prod'
  ? process.env.SHOTSTACK_API_KEY_PROD
  : process.env.SHOTSTACK_API_KEY_SANDBOX;

const SHOTSTACK_INGEST_BASE = ENV === 'prod'
  ? 'https://api.shotstack.io/ingest/v1'
  : 'https://api.shotstack.io/ingest/stage';

// --- MIME detection ---

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

// --- Download a remote URL to a temp file ---

async function downloadToTemp(url, label) {
  const ext = path.extname(new URL(url).pathname) || '.mp4';
  const tmpPath = path.join(os.tmpdir(), `cult_ingest_${label}_${Date.now()}${ext}`);
  console.error(`  Downloading ${label} from URL...`);
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmpPath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  const sizeMB = (fs.statSync(tmpPath).size / 1024 / 1024).toFixed(1);
  console.error(`  Downloaded: ${sizeMB} MB → ${tmpPath}`);
  return tmpPath;
}

// --- Upload a local file to Shotstack Ingest ---

async function ingestFile(filePath, mimeType, label) {
  console.error(`  Ingesting ${label} (${path.basename(filePath)})...`);

  // 1. Request signed upload URL
  const signedRes = await axios.post(
    `${SHOTSTACK_INGEST_BASE}/upload`,
    {},
    { headers: { 'x-api-key': SHOTSTACK_KEY, 'Content-Type': 'application/json' } }
  );
  const { id, url } = signedRes.data.data.attributes;

  // 2. PUT file to signed URL
  const fileData = fs.readFileSync(filePath);
  await axios.put(url, fileData, {
    headers: { 'Content-Type': mimeType },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  // 3. Poll until ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await axios.get(
      `${SHOTSTACK_INGEST_BASE}/sources/${id}`,
      { headers: { 'x-api-key': SHOTSTACK_KEY } }
    );
    const attrs = statusRes.data.data.attributes;
    console.error(`  ${label}: ${attrs.status}`);
    if (attrs.status === 'ready') {
      const src = attrs.source || attrs.url;
      console.error(`  ${label} ready: ${src}`);
      return src;
    }
    if (attrs.status === 'failed') throw new Error(`Shotstack ingest failed for ${label}`);
  }
  throw new Error(`Ingest timed out for ${label}`);
}

// --- Main ---

(async () => {
  const results = {};
  const tempFiles = [];

  try {
    for (const [label, value] of Object.entries(inputs)) {
      // Already a Shotstack CDN URL — skip re-ingestion
      if (value.includes('shotstack.io') || value.includes('cdn.shotstack')) {
        console.error(`  ${label}: already on Shotstack CDN, skipping ingest`);
        results[label] = value;
        continue;
      }

      let localPath = value;
      let isTemp = false;

      // Remote URL — download first
      if (value.startsWith('http://') || value.startsWith('https://')) {
        localPath = await downloadToTemp(value, label);
        tempFiles.push(localPath);
        isTemp = true;
      } else if (!fs.existsSync(value)) {
        throw new Error(`File not found: ${value} (label: ${label})`);
      }

      const mime = getMimeType(localPath);
      results[label] = await ingestFile(localPath, mime, label);
    }

    // Output JSON to stdout (only line to stdout — rest goes to stderr)
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');

  } finally {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
})().catch(err => {
  if (err.response) console.error('API error:', JSON.stringify(err.response.data, null, 2));
  console.error('ingest-clips failed:', err.message);
  process.exit(1);
});
