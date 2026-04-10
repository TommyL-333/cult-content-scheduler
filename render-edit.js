/**
 * render-edit.js — Submit current edit to Shotstack and render
 *
 * Usage: node render-edit.js [sandbox|prod]
 *
 * Reads:  C:\Users\thlyn\cult-content-scheduler\current-edit.json
 * Submits the `timeline` object to Shotstack render API
 * Polls until done, prints the final MP4 URL to stdout
 * Updates current-edit.json with the new render entry
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ENV = (process.argv[2] || 'prod').toLowerCase();

const SHOTSTACK_KEY = ENV === 'prod'
  ? process.env.SHOTSTACK_API_KEY_PROD
  : process.env.SHOTSTACK_API_KEY_SANDBOX;

const SHOTSTACK_BASE = ENV === 'prod'
  ? 'https://api.shotstack.io/v1'
  : 'https://api.shotstack.io/stage';

const STATE_FILE = path.join(__dirname, 'current-edit.json');

// --- Main ---

(async () => {
  // 1. Read state
  if (!fs.existsSync(STATE_FILE)) {
    console.error('No current-edit.json found. Start a new edit session first.');
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  if (!state.timeline) {
    console.error('current-edit.json has no timeline. Build the timeline first.');
    process.exit(1);
  }

  const version = (state.renders || []).length + 1;
  console.error(`\nSubmitting render v${version} (${ENV})...`);

  // 2. Submit render
  const res = await axios.post(
    `${SHOTSTACK_BASE}/render`,
    {
      timeline: state.timeline,
      output: state.output || { format: 'mp4', size: { width: 1080, height: 1920 } }
    },
    { headers: { 'x-api-key': SHOTSTACK_KEY, 'Content-Type': 'application/json' } }
  );

  const renderId = res.data.response.id;
  console.error(`Render queued: ${renderId}`);

  // 3. Poll until done
  let finalUrl;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const statusRes = await axios.get(
      `${SHOTSTACK_BASE}/render/${renderId}`,
      { headers: { 'x-api-key': SHOTSTACK_KEY } }
    );
    const { status, url, error } = statusRes.data.response;
    console.error(`  Render: ${status}`);
    if (status === 'done') { finalUrl = url; break; }
    if (status === 'failed') {
      console.error('Render failed:', JSON.stringify(error));
      process.exit(1);
    }
  }

  if (!finalUrl) {
    console.error('Render timed out after 8 minutes.');
    process.exit(1);
  }

  // 4. Update state file with new render entry
  if (!state.renders) state.renders = [];
  state.renders.push({ version, url: finalUrl, renderedAt: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // 5. Print URL to stdout (only this line goes to stdout)
  process.stdout.write(finalUrl + '\n');
  console.error(`\nv${version} ready: ${finalUrl}`);

})().catch(err => {
  if (err.response) console.error('API error:', JSON.stringify(err.response.data, null, 2));
  console.error('render-edit failed:', err.message);
  process.exit(1);
});
