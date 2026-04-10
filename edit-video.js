/**
 * edit-video.js — Cult Content Video Editing Pipeline
 *
 * Usage: node edit-video.js <record_id> [sandbox|prod]
 *
 * Pipeline:
 *   Lark raw footage attachment
 *   → download
 *   → FFmpeg noise reduction + silence/pause removal (audio + video in sync)
 *   → OpenAI Whisper (word-level timestamps) → detect repeated takes → cut them
 *   → Build clean SRT (7-12 chars per caption line)
 *   → Burn captions with FFmpeg
 *   → Shotstack render (1080×1920 vertical)
 *   → Lark record updated (Media URL + Status: Filmed)
 */

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const RECORD_ID = process.argv[2];
const ENV = (process.argv[3] || 'prod').toLowerCase();

if (!RECORD_ID) {
  console.error('Usage: node edit-video.js <record_id> [sandbox|prod]');
  process.exit(1);
}

const LARK_APP_ID = process.env.LARK_APP_ID;
const LARK_APP_SECRET = process.env.LARK_APP_SECRET;
const APP_TOKEN = 'P501bI8KwaKvT7siDrZukMrWtAf';
const TABLE_ID = 'tbl0nohouA9DLx2D';

const SHOTSTACK_KEY = ENV === 'prod'
  ? process.env.SHOTSTACK_API_KEY_PROD
  : process.env.SHOTSTACK_API_KEY_SANDBOX;
const SHOTSTACK_BASE = ENV === 'prod'
  ? 'https://api.shotstack.io/v1'
  : 'https://api.shotstack.io/stage';
const SHOTSTACK_INGEST_BASE = ENV === 'prod'
  ? 'https://api.shotstack.io/ingest/v1'
  : 'https://api.shotstack.io/ingest/stage';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const IS_WINDOWS = process.platform === 'win32';
// Linux (cloud/Railway) and Mac use ffmpeg/ffprobe from PATH.
// Windows uses the WinGet-installed binaries.
const FFMPEG  = IS_WINDOWS
  ? '"C:\\Users\\thlyn\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe"'
  : 'ffmpeg';
const FFPROBE = IS_WINDOWS
  ? '"C:\\Users\\thlyn\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffprobe.exe"'
  : 'ffprobe';

// --- Lark helpers ---

async function getLarkToken() {
  const res = await axios.post('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET
  });
  return res.data.tenant_access_token;
}

async function fetchRecord(token) {
  const res = await axios.post(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/search`,
    { filter: { conjunction: 'and', conditions: [{ field_name: 'record_id', operator: 'is', value: [RECORD_ID] }] } },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.data.data || res.data.data.total === 0) {
    const direct = await axios.get(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${RECORD_ID}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return direct.data.data.record;
  }
  return res.data.data.items[0];
}

async function getTmpUrl(token, fileToken) {
  const res = await axios.get(
    `https://open.larksuite.com/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${fileToken}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data.tmp_download_urls[0].tmp_download_url;
}

async function downloadFile(url, destPath) {
  const res = await axios.get(url, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function updateLarkRecord(token, mediaUrl) {
  await axios.put(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${RECORD_ID}`,
    { fields: { 'Media URL': { text: mediaUrl, link: mediaUrl }, 'Status': 'Filmed' } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

// --- FFmpeg helpers ---

function getClipDuration(filePath) {
  const out = execSync(
    `${FFPROBE} -v quiet -print_format json -show_format "${filePath}"`,
    { encoding: 'utf8' }
  );
  return parseFloat(JSON.parse(out).format.duration);
}

function reduceNoise(inputPath, outputPath) {
  console.log('Reducing background noise...');
  execSync(
    `${FFMPEG} -y -i "${inputPath}" -af "highpass=f=100,afftdn=nf=-25" -c:v copy "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function buildKeepSegments(inputPath) {
  const totalDuration = getClipDuration(inputPath);
  const stderr = execSync(
    `${FFMPEG} -i "${inputPath}" -af "silencedetect=n=-35dB:d=0.3" -f null - 2>&1`,
    { encoding: 'utf8' }
  );
  const silenceStarts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const silenceEnds   = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => parseFloat(m[1]));

  const LEAD_IN = 0.08; // keep 80ms before each segment to avoid clipping
  const keep = [];
  let pos = 0;
  for (let i = 0; i < silenceStarts.length; i++) {
    if (silenceStarts[i] > pos + 0.1) keep.push({ start: Math.max(0, pos - LEAD_IN), end: silenceStarts[i] });
    pos = silenceEnds[i] || totalDuration;
  }
  if (pos < totalDuration - 0.1) keep.push({ start: Math.max(0, pos - LEAD_IN), end: totalDuration });
  return keep;
}

function detectCoughs(words, inputPath) {
  const coughRanges = [];
  // Check gaps between words: if gap is 0.2–2s and audio is loud, it's a cough/noise
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const duration = gapEnd - gapStart;
    if (duration < 0.2 || duration > 2.0) continue;
    try {
      const out = execSync(
        `${FFMPEG} -ss ${gapStart.toFixed(3)} -t ${duration.toFixed(3)} -i "${inputPath}" -af "volumedetect" -f null - 2>&1`,
        { encoding: 'utf8' }
      );
      const meanMatch = out.match(/mean_volume: ([-\d.]+) dB/);
      const maxMatch  = out.match(/max_volume: ([-\d.]+) dB/);
      if (meanMatch && maxMatch) {
        const mean = parseFloat(meanMatch[1]);
        const max  = parseFloat(maxMatch[1]);
        // Cough = loud gap (mean > -32dB, max > -18dB) — much louder than room tone
        if (mean > -32 && max > -18) {
          coughRanges.push({ start: gapStart, end: gapEnd });
          console.log(`  Cough/noise: ${gapStart.toFixed(1)}s–${gapEnd.toFixed(1)}s (mean ${mean}dB)`);
        }
      }
    } catch (e) { /* skip */ }
  }
  return coughRanges;
}

function cutSegments(inputPath, keepSegments, outputPath) {
  console.log(`Cutting to ${keepSegments.length} speech segments...`);
  if (keepSegments.length === 0) {
    execSync(`${FFMPEG} -y -i "${inputPath}" -c copy "${outputPath}"`, { stdio: 'pipe' });
    return;
  }
  const expr = keepSegments.map(s => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
  execSync(
    `${FFMPEG} -y -i "${inputPath}" -vf "select='${expr}',setpts=N/FRAME_RATE/TB" -af "aselect='${expr}',asetpts=N/SR/TB" "${outputPath}"`,
    { stdio: 'inherit' }
  );
}

function burnSubtitles(inputPath, srtPath, outputPath) {
  console.log('Burning captions...');
  // On Windows, FFmpeg subtitles filter can't handle paths with colons/spaces,
  // so we copy to a simple path. On Mac/Linux, /tmp works fine.
  const simpleSrt = IS_WINDOWS ? 'C:/Users/thlyn/subs.srt' : '/tmp/cult_subs.srt';
  const escapedSrt = IS_WINDOWS ? 'C\\:/Users/thlyn/subs.srt' : '/tmp/cult_subs.srt';
  fs.copyFileSync(srtPath, simpleSrt);
  try {
    execSync(
      `${FFMPEG} -y -i "${inputPath}" -vf "subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1,Outline=2,Shadow=1,MarginV=60,Alignment=2'" -c:a copy "${outputPath}"`,
      { stdio: 'inherit' }
    );
  } finally {
    try { fs.unlinkSync(simpleSrt); } catch {}
  }
}

// --- Whisper (word-level) ---

async function transcribeWordLevel(videoPath) {
  console.log('Transcribing with Whisper (word-level timestamps)...');

  // Extract audio-only MP3 to stay under OpenAI's 25MB limit
  const audioPath = videoPath.replace(/\.mp4$/, '_audio.mp3');
  execSync(`${FFMPEG} -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}"`, { stdio: 'pipe' });
  console.log(`  Audio: ${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(1)} MB`);

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), { filename: 'audio.mp3', contentType: 'audio/mpeg' });
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  try {
    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...form.getHeaders() },
      maxBodyLength: Infinity
    });
    return res.data; // { words: [{word, start, end}], segments: [...] }
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

// --- Repeated take detection ---

/**
 * Finds repeated phrases in the word list and returns time ranges to cut.
 * Strategy: slide a window of N words, find near-duplicate sequences,
 * keep the LAST occurrence (the cleanest take), cut the earlier ones.
 */
function findRepeatedTakes(words) {
  const cutRanges = [];

  function normalize(w) { return w.toLowerCase().replace(/[^a-z]/g, ''); }
  function similarity(a, b) {
    const setA = new Set(a.map(normalize).filter(Boolean));
    const setB = new Set(b.map(normalize).filter(Boolean));
    const intersection = [...setA].filter(x => setB.has(x)).length;
    return intersection / Math.max(setA.size, setB.size, 1);
  }

  // Pass 1: catch full sentence restarts (8 words, high similarity)
  const WINDOW_LONG = 8;
  for (let i = 0; i < words.length - WINDOW_LONG; i++) {
    const chunkA = words.slice(i, i + WINDOW_LONG);
    for (let j = i + 2; j < words.length - WINDOW_LONG + 1; j++) {
      const chunkB = words.slice(j, j + WINDOW_LONG);
      const gap = chunkB[0].start - chunkA[0].start;
      if (gap > 25) break;
      if (gap < 2) continue;
      if (similarity(chunkA.map(w => w.word), chunkB.map(w => w.word)) >= 0.85) {
        const cutStart = chunkA[0].start;
        const cutEnd = chunkB[0].start;
        if (!cutRanges.some(r => Math.abs(r.start - cutStart) < 2)) {
          cutRanges.push({ start: cutStart, end: cutEnd });
          console.log(`  Repeated take (long): ${cutStart.toFixed(1)}s–${cutEnd.toFixed(1)}s (${(cutEnd-cutStart).toFixed(1)}s)`);
        }
        break;
      }
    }
  }

  // Pass 2: catch short opener restarts (3 words, within 8s)
  const WINDOW_SHORT = 3;
  for (let i = 0; i < words.length - WINDOW_SHORT; i++) {
    const chunkA = words.slice(i, i + WINDOW_SHORT);
    for (let j = i + 1; j < words.length - WINDOW_SHORT + 1; j++) {
      const chunkB = words.slice(j, j + WINDOW_SHORT);
      const gap = chunkB[0].start - chunkA[0].start;
      if (gap > 8) break;
      if (gap < 1.5) continue;
      if (similarity(chunkA.map(w => w.word), chunkB.map(w => w.word)) >= 1.0) { // exact match only
        const cutStart = chunkA[0].start;
        const cutEnd = chunkB[0].start;
        if (!cutRanges.some(r => Math.abs(r.start - cutStart) < 1)) {
          cutRanges.push({ start: cutStart, end: cutEnd });
          console.log(`  Repeated take (short): ${cutStart.toFixed(1)}s–${cutEnd.toFixed(1)}s (${(cutEnd-cutStart).toFixed(1)}s)`);
        }
        break;
      }
    }
  }

  return cutRanges;
}

/**
 * Apply repeated-take cuts on top of existing keep segments.
 * Subtracts cut ranges from the keep segments timeline.
 */
function applyRepeatCuts(keepSegments, cutRanges, totalDuration) {
  if (cutRanges.length === 0) return keepSegments;

  // Build a flat timeline of what to keep (already cut for silence)
  // Then subtract the repeat-cut ranges
  let result = [...keepSegments];
  for (const cut of cutRanges) {
    const next = [];
    for (const seg of result) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        next.push(seg); // no overlap
      } else {
        if (cut.start > seg.start) next.push({ start: seg.start, end: cut.start });
        if (cut.end < seg.end) next.push({ start: cut.end, end: seg.end });
        // fully contained in cut → dropped
      }
    }
    result = next;
  }
  return result.filter(s => s.end - s.start > 0.1);
}

// --- SRT builder (7-12 chars per caption) ---

function buildSrt(words, keepSegments) {
  // Map word timestamps (which are relative to the silence-cut clip) to output time
  // Since we cut silence before transcribing, word timestamps are already correct.
  // We just need to group them into 7-12 char captions.

  const MAX_CHARS = 12;
  const captions = [];
  let group = [];
  let charCount = 0;

  for (const w of words) {
    const wText = w.word.trim();
    if (!wText) continue;
    if (charCount + wText.length + (group.length > 0 ? 1 : 0) > MAX_CHARS && group.length > 0) {
      captions.push(group);
      group = [];
      charCount = 0;
    }
    group.push(w);
    charCount += wText.length + (group.length > 1 ? 1 : 0);
  }
  if (group.length > 0) captions.push(group);

  function toSrtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  }

  return captions.map((grp, i) => {
    const start = grp[0].start;
    const end = grp[grp.length - 1].end;
    const text = grp.map(w => w.word.trim()).join(' ').toLowerCase();
    return `${i + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text}`;
  }).join('\n\n');
}

// --- Shotstack ---

async function shotstackIngest(filePath, mimeType) {
  console.log(`Uploading to Shotstack: ${path.basename(filePath)}...`);
  const signedRes = await axios.post(
    `${SHOTSTACK_INGEST_BASE}/upload`, {},
    { headers: { 'x-api-key': SHOTSTACK_KEY, 'Content-Type': 'application/json' } }
  );
  const { id, url } = signedRes.data.data.attributes;
  const fileData = fs.readFileSync(filePath);
  await axios.put(url, fileData, {
    headers: { 'Content-Type': mimeType },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });

  let src;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await axios.get(
      `${SHOTSTACK_INGEST_BASE}/sources/${id}`,
      { headers: { 'x-api-key': SHOTSTACK_KEY } }
    );
    const attrs = statusRes.data.data.attributes;
    console.log(`  Ingest: ${attrs.status}`);
    if (attrs.status === 'ready') { src = attrs.source || attrs.url; break; }
    if (attrs.status === 'failed') throw new Error('Shotstack ingest failed');
  }
  if (!src) throw new Error('Ingest timed out');
  return src;
}

async function renderShotstack(clipUrl, clipLength, hookOverlay) {
  console.log('Submitting Shotstack render...');
  const tracks = [{
    clips: [{
      asset: { type: 'video', src: clipUrl, volume: 1 },
      start: 0, length: clipLength, fit: 'cover'
    }]
  }];

  if (hookOverlay) {
    tracks.push({ clips: [{
      asset: {
        type: 'html',
        html: `<p>${hookOverlay}</p>`,
        css: 'p { color: #ffffff; font-size: 48px; font-weight: 800; font-family: Arial Black, Arial, sans-serif; text-align: left; text-shadow: 2px 2px 4px rgba(0,0,0,0.8); margin: 0; padding: 0; line-height: 1.2; }',
        width: 960, height: 200, background: 'transparent'
      },
      start: 0, length: 4, position: 'top',
      offset: { x: -0.02, y: -0.3 }
    }]});
  }

  const res = await axios.post(
    `${SHOTSTACK_BASE}/render`,
    { timeline: { background: '#000000', tracks }, output: { format: 'mp4', size: { width: 1080, height: 1920 } } },
    { headers: { 'x-api-key': SHOTSTACK_KEY, 'Content-Type': 'application/json' } }
  );
  const renderId = res.data.response.id;
  console.log(`Render queued: ${renderId}`);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const statusRes = await axios.get(
      `${SHOTSTACK_BASE}/render/${renderId}`,
      { headers: { 'x-api-key': SHOTSTACK_KEY } }
    );
    const { status, url, error } = statusRes.data.response;
    console.log(`  Render: ${status}`);
    if (status === 'done') return url;
    if (status === 'failed') throw new Error(`Render failed: ${JSON.stringify(error)}`);
  }
  throw new Error('Render timed out');
}

// --- Main ---

(async () => {
  const tmpDir = os.tmpdir();
  const rawPath      = path.join(tmpDir, `${RECORD_ID}_raw.mp4`);
  const denoisedPath = path.join(tmpDir, `${RECORD_ID}_denoised.mp4`);
  const cutPath      = path.join(tmpDir, `${RECORD_ID}_cut.mp4`);
  const captionedPath= path.join(tmpDir, `${RECORD_ID}_captioned.mp4`);
  const srtPath      = path.join(tmpDir, `${RECORD_ID}_captions.srt`);
  const allTmp = [rawPath, denoisedPath, cutPath, captionedPath, srtPath];

  try {
    console.log(`\n=== Cult Content Editor | Record: ${RECORD_ID} | Mode: ${ENV} ===\n`);

    // 1. Lark auth + fetch record
    console.log('Authenticating with Lark...');
    const token = await getLarkToken();
    console.log('Fetching record...');
    const record = await fetchRecord(token);
    const fields = record.fields;
    const title = fields['多行文本']?.[0]?.text || RECORD_ID;
    const filmingNotes = fields['Filming Notes']?.[0]?.text || '';
    const rawFootage = fields['Raw Footage'];
    console.log(`Video: "${title}"`);

    if (!rawFootage || rawFootage.length === 0) {
      console.error('No Raw Footage attached. Upload the clip to Lark first.');
      process.exit(1);
    }
    const mainClip = rawFootage.find(f => f.name.toLowerCase().includes('main')) || rawFootage[0];
    console.log(`Clip: ${mainClip.name}`);

    // 2. Download
    console.log('Downloading...');
    const clipDownloadUrl = await getTmpUrl(token, mainClip.file_token);
    await downloadFile(clipDownloadUrl, rawPath);
    console.log(`Downloaded: ${(fs.statSync(rawPath).size / 1024 / 1024).toFixed(1)} MB`);

    // 3. Noise reduction
    reduceNoise(rawPath, denoisedPath);

    // 4. Detect silence segments
    console.log('Detecting speech segments...');
    const silenceKeep = buildKeepSegments(denoisedPath);
    const totalDuration = getClipDuration(denoisedPath);

    // 5. Transcribe with word-level timestamps (on denoised, full clip first)
    const whisperResult = await transcribeWordLevel(denoisedPath);
    const words = whisperResult.words || [];
    console.log(`Transcribed: ${words.length} words`);

    // 6. Detect repeated takes
    const repeatCuts = findRepeatedTakes(words);
    console.log(`Repeated takes found: ${repeatCuts.length}`);

    // 6b. Detect coughs/noise bursts between words
    console.log('Scanning for coughs/noise...');
    const coughCuts = detectCoughs(words, denoisedPath);
    console.log(`Coughs/noise found: ${coughCuts.length}`);

    // 7. Combine silence cuts + repeat cuts + cough cuts
    const allCuts = [...repeatCuts, ...coughCuts];
    const finalSegments = applyRepeatCuts(silenceKeep, allCuts, totalDuration);
    console.log(`Final segments: ${finalSegments.length} (${finalSegments.reduce((a,s)=>a+(s.end-s.start),0).toFixed(1)}s)`);

    // 8. Cut video
    cutSegments(denoisedPath, finalSegments, cutPath);
    const clipLength = getClipDuration(cutPath);
    console.log(`Cut clip length: ${clipLength.toFixed(1)}s`);

    // 9. Re-transcribe cut clip for accurate caption timestamps
    console.log('Re-transcribing for caption timing...');
    const captionResult = await transcribeWordLevel(cutPath);
    const captionWords = captionResult.words || [];

    // 10. Build SRT with 7-12 chars per caption
    const srtContent = buildSrt(captionWords, finalSegments);
    fs.writeFileSync(srtPath, srtContent);
    const captionCount = srtContent.split('\n\n').filter(Boolean).length;
    console.log(`Captions: ${captionCount} segments (≤12 chars each)`);

    // 11. Burn captions
    burnSubtitles(cutPath, srtPath, captionedPath);

    // 12. Upload to Shotstack + render
    const hostedUrl = await shotstackIngest(captionedPath, 'video/mp4');

    const overlayMatch = filmingNotes.match(/[Tt]ext overlay[^:]*:\s*[""]?([^"\n]+)[""]?/);
    const hookOverlay = overlayMatch ? overlayMatch[1].trim() : null;
    if (hookOverlay) console.log(`Hook overlay: "${hookOverlay}"`);

    const renderedUrl = await renderShotstack(hostedUrl, Math.ceil(clipLength), hookOverlay);
    console.log(`\nRendered: ${renderedUrl}`);

    // 13. Update Lark
    await updateLarkRecord(token, renderedUrl);
    console.log('Lark updated → Status: Filmed');

    allTmp.forEach(f => { try { fs.unlinkSync(f); } catch {} });

    console.log(`\n✓ Done! "${title}"`);
    console.log(`  ${renderedUrl}`);

  } catch (err) {
    if (err.response) console.error('API error:', JSON.stringify(err.response.data));
    console.error('\nFailed:', err.message);
    allTmp.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    process.exit(1);
  }
})();
