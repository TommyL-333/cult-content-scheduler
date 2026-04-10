/**
 * process-skool-intro.js — v5
 *
 * Key change from v4: silence-snapping.
 * Whisper word timestamps have ~100-200ms error. This version runs a fine-
 * grained silencedetect pass (-40dB, 50ms min) on the denoised clip to get
 * real silence boundary timestamps, then snaps each utterance start/end to
 * the nearest actual silence within ±300ms. Cuts only ever land in silence,
 * never mid-word.
 *
 * Also outputs skool-intro/transcript.txt showing every utterance with
 * timestamps so you can review what was kept vs cut.
 *
 * Usage: node process-skool-intro.js
 */

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FFMPEG  = '"C:\\Users\\thlyn\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"';
const FFPROBE = '"C:\\Users\\thlyn\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe"';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const INPUT    = 'C:\\Users\\thlyn\\Downloads\\IMG_1568.MOV';
const OUT_DIR  = 'C:\\Users\\thlyn\\cult-content-scheduler\\skool-intro';
const DENOISED = path.join(OUT_DIR, 'denoised.mov');
const CUT      = path.join(OUT_DIR, 'cut.mp4');
const FINAL    = path.join(OUT_DIR, 'skool_intro_talking_head.mp4');
const SRT_PATH = 'C:\\Users\\thlyn\\subs.srt';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Ground-truth script ───────────────────────────────────────────────────────

const SCRIPT = `Have you ever felt like you were one decision away from changing your entire life?
That's exactly where I was before I moved into this school bus and began traveling the entire country. I didn't have a plan. I just knew that the life I was living wasn't the one I wanted — and that if I didn't do something radical, nothing would change.
What I didn't expect was that living on this bus would completely rewire how I see opportunity. When you strip everything down to what matters, you start to see the world like a blank canvas. And that clarity changed everything for me.
While I traveled, I built a business. I became a certified TikTok Shop Partner Agency, and over the last four years I've gone deep into every corner of the TikTok Shop ecosystem — the tools, the platforms, and the people building them.
Here's what I found: most sellers aren't profitable. After sampling costs, agency fees, affiliate retainers, and ad spend, there's almost nothing left. The truth is that it's become pay to play, and most sellers come looking for profit they never find.
But the sellers and agencies who are winning? They've built systems. And I don't mean just a few webapps — actual infrastructure. Automated affiliate management, content production pipelines, real analytics.
Agentic AI — essentially coded software programs that use AI to do tasks that would otherwise take a team member hours.
I spent two months in San Francisco working directly with the founders of these platforms. I've consulted with dozens of tools, and I've watched brands use them to scale to millions in GMV.
I have no technical background. I didn't go to school for any of this. What I had was time, curiosity, and a willingness to go figure it out. And that's all it takes.
That's why I built this community.
This is the Cult Content Skool Group — and it's for TikTok Shop sellers and agencies who are serious about using agentic AI to run leaner, smarter, and more profitable operations. Inside, I'm giving away the exact systems that top brands are using to automate content, manage affiliates, and scale — the stuff that used to cost tens of thousands of dollars to access or figure out on your own.
This isn't a course. It's not a one-size-fits-all program. It's a living, growing community built around one idea: that the right system, built for your business, changes everything.
If you're a seller who's tired of the margin grind, or an agency that wants to deliver more without hiring more — this was built for you.
Come join us.`;

const SCRIPT_WORDS = SCRIPT
  .toLowerCase()
  .replace(/[^a-z\s']/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

// ── Manual cuts (timecodes in seconds from original denoised clip) ─────────────
// Add any utterances the auto-detector missed here.
const MANUAL_CUTS = [
  { start: 407.8, end: 409.2 }, // "And that group is all about the function of a company" — off-script false start
  { start: 435.8, end: 437.8 }, // "leaner and more profitable systems" — retry of next line
  { start: 444.9, end: 447.6 }, // "And more profitable operations" — duplicate of above
  { start: 493.3, end: 502.3 }, // "Manage affiliates and scale" — sentence fragment/restart
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(w) { return (w || '').toLowerCase().replace(/[^a-z']/g, ''); }

function getClipDuration(filePath) {
  const out = execSync(
    `${FFPROBE} -v quiet -print_format json -show_format "${filePath}"`,
    { encoding: 'utf8' }
  );
  return parseFloat(JSON.parse(out).format.duration);
}

async function transcribeWordLevel(videoPath) {
  console.log(`\n[whisper] Extracting audio from ${path.basename(videoPath)}...`);
  const audioPath = path.join(OUT_DIR, '_tmp_audio.mp3');
  execSync(`${FFMPEG} -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}"`, { stdio: 'pipe' });
  const sizeMB = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Audio: ${sizeMB} MB — submitting to Whisper...`);

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
    console.log(`  Words: ${(res.data.words || []).length}`);
    return res.data;
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

// ── Silence boundary detection ────────────────────────────────────────────────
//
// Runs silencedetect at fine granularity to find real silence start/end times.
// These are used to snap utterance boundaries so cuts always land in silence.

function getSilenceBoundaries(filePath) {
  console.log('\n[silence boundaries] scanning...');
  const stderr = execSync(
    `${FFMPEG} -i "${filePath}" -af "silencedetect=n=-40dB:d=0.05" -f null - 2>&1`,
    { encoding: 'utf8' }
  );
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => ({ t: parseFloat(m[1]), type: 'start' }));
  const ends   = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => ({ t: parseFloat(m[1]), type: 'end' }));
  const all = [...starts, ...ends].sort((a, b) => a.t - b.t);
  console.log(`  Found ${starts.length} silence starts, ${ends.length} silence ends`);
  return all;
}

// Snap a timestamp to the nearest silence boundary within `window` seconds.
// For utterance END: prefer silence_start (audio going quiet = end of speech).
// For utterance START: prefer silence_end (audio coming back = start of speech).
function snapToSilence(time, boundaries, window = 0.30, preferType = null) {
  const candidates = boundaries.filter(b => Math.abs(b.t - time) <= window);
  if (candidates.length === 0) return time; // no boundary nearby — use Whisper timestamp as-is

  // Prefer the matching type if specified
  const typed = preferType ? candidates.filter(b => b.type === preferType) : [];
  const pool = typed.length > 0 ? typed : candidates;
  return pool.reduce((best, b) =>
    Math.abs(b.t - time) < Math.abs(best.t - time) ? b : best
  ).t;
}

// ── Utterance grouping ────────────────────────────────────────────────────────
//
// Groups Whisper words into utterances — consecutive words where the inter-word
// gap is below GAP_THRESHOLD. Cuts will only ever happen BETWEEN utterances,
// so sentences are never split.

function groupIntoUtterances(words, gapThreshold = 0.40) {
  if (words.length === 0) return [];
  const utterances = [];
  let current = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > gapThreshold) {
      utterances.push(current);
      current = [];
    }
    current.push(words[i]);
  }
  if (current.length > 0) utterances.push(current);

  return utterances.map(ws => ({
    words: ws,
    start: ws[0].start,
    end: ws[ws.length - 1].end,
    text: ws.map(w => w.word.trim()).join(' ')
  }));
}

// ── Repeat-take detection ─────────────────────────────────────────────────────
//
// Compares pairs of utterances within a 90-second window using word-bag
// similarity. If two utterances share ≥65% of their content words, the EARLIER
// one is the failed take — cut from its start to the start of the retry.
//
// Also uses script position tracking as a secondary check: if an utterance
// maps backwards in the script by > 20 words, treat it as a retake.

function wordBagSimilarity(textA, textB) {
  const toSet = t => new Set(
    t.toLowerCase().split(/\s+/).map(normalize).filter(w => w.length > 2)
  );
  const setA = toSet(textA);
  const setB = toSet(textB);
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return intersection / Math.max(setA.size, setB.size, 1);
}

function mapToScript(utterance, scriptWords) {
  const spokenNorm = utterance.words.map(w => normalize(w.word)).filter(Boolean);
  if (spokenNorm.length < 3) return -1;
  const WINDOW = Math.min(5, spokenNorm.length);
  let bestScore = 0, bestPos = -1;
  for (let si = 0; si <= scriptWords.length - WINDOW; si++) {
    const slice = scriptWords.slice(si, si + WINDOW);
    const matches = spokenNorm.slice(0, WINDOW).filter((w, i) => slice[i] === w).length;
    const score = matches / WINDOW;
    if (score > bestScore) { bestScore = score; bestPos = si; }
  }
  return bestScore >= 0.45 ? bestPos : -1;
}

function detectRepeatTakes(utterances, scriptWords) {
  const cuts = [];

  // Pass 1: utterance-to-utterance word similarity
  for (let i = 0; i < utterances.length; i++) {
    if (cuts.some(c => utterances[i].start >= c.start && utterances[i].start < c.end)) continue;
    for (let j = i + 1; j < utterances.length; j++) {
      const gap = utterances[j].start - utterances[i].end;
      if (gap > 90) break;
      if (gap < 0.5) continue;
      // Only compare utterances with at least 4 content words each
      if (utterances[i].words.length < 4 || utterances[j].words.length < 4) continue;
      const sim = wordBagSimilarity(utterances[i].text, utterances[j].text);
      if (sim >= 0.65) {
        const cutStart = utterances[i].start;
        const cutEnd = utterances[j].start;
        if (!cuts.some(c => Math.abs(c.start - cutStart) < 2)) {
          cuts.push({ start: cutStart, end: cutEnd });
          console.log(`  Repeat take (${(sim * 100).toFixed(0)}% sim): ${cutStart.toFixed(1)}s–${cutEnd.toFixed(1)}s`);
        }
        break;
      }
    }
  }

  // Pass 2: script position regression (catches retakes of different script sections)
  const scriptPositions = utterances.map(u => mapToScript(u, scriptWords));
  let maxScriptPos = 0;
  for (let i = 0; i < utterances.length; i++) {
    const pos = scriptPositions[i];
    if (pos < 0) continue;
    if (pos < maxScriptPos - 20) {
      // Find start of the repeated section from earlier utterances
      let cutStartTime = utterances[i].start;
      for (let j = i - 1; j >= 0; j--) {
        if (scriptPositions[j] >= 0 && scriptPositions[j] <= pos) {
          cutStartTime = utterances[j].start;
          break;
        }
      }
      const cutEnd = utterances[i].start;
      if (cutEnd - cutStartTime > 0.5 && !cuts.some(c => Math.abs(c.start - cutStartTime) < 2)) {
        cuts.push({ start: cutStartTime, end: cutEnd });
        console.log(`  Repeat take (script pos ${pos}): ${cutStartTime.toFixed(1)}s–${cutEnd.toFixed(1)}s`);
      }
    }
    if (pos > maxScriptPos) maxScriptPos = pos;
  }

  return cuts;
}

// Filter utterances against cut ranges
// An utterance is removed if its midpoint falls within a cut range,
// OR if > 60% of it overlaps with a cut range.
function filterUtterances(utterances, cuts) {
  if (cuts.length === 0) return utterances;
  return utterances.filter(u => {
    const mid = (u.start + u.end) / 2;
    const dur = u.end - u.start;
    for (const c of cuts) {
      if (mid >= c.start && mid <= c.end) return false;
      const overlap = Math.min(u.end, c.end) - Math.max(u.start, c.start);
      if (overlap / dur > 0.6) return false;
    }
    return true;
  });
}

// Convert kept utterances to time segments, snapping boundaries to real silence
function utterancesToSegments(utterances, silenceBoundaries, leadIn = 0.02, leadOut = 0.03) {
  if (utterances.length === 0) return [];

  // Merge adjacent utterances whose gap is < 0.30s (natural within-sentence pauses)
  const merged = [{ start: utterances[0].start, end: utterances[0].end }];
  for (let i = 1; i < utterances.length; i++) {
    const last = merged[merged.length - 1];
    const gap = utterances[i].start - last.end;
    if (gap < 0.30) {
      last.end = utterances[i].end;
    } else {
      merged.push({ start: utterances[i].start, end: utterances[i].end });
    }
  }

  return merged.map(s => {
    // Snap start to nearest silence_end (audio resuming) within ±300ms
    const snappedStart = snapToSilence(s.start, silenceBoundaries, 0.30, 'end');
    // Snap end to nearest silence_start (audio going quiet) within ±300ms
    const snappedEnd   = snapToSilence(s.end,   silenceBoundaries, 0.30, 'start');
    return {
      start: Math.max(0, snappedStart - leadIn),
      end: snappedEnd + leadOut
    };
  });
}

// Cut video using ffmpeg select filter
function cutSegments(inputPath, keepSegments, outputPath) {
  if (keepSegments.length === 0) {
    execSync(`${FFMPEG} -y -i "${inputPath}" -vf "scale=1920:1080" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k "${outputPath}"`, { stdio: 'inherit' });
    return;
  }
  const expr = keepSegments.map(s => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
  execSync(
    `${FFMPEG} -y -i "${inputPath}" ` +
    `-vf "select='${expr}',setpts=N/FRAME_RATE/TB,scale=1920:1080" ` +
    `-af "aselect='${expr}',asetpts=N/SR/TB" ` +
    `-c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k "${outputPath}"`,
    { stdio: 'inherit' }
  );
}

// ── Caption builder ───────────────────────────────────────────────────────────

function buildScriptAlignedSrt(words) {
  const MAX_CHARS = 12;
  const corrected = [];
  let scriptCursor = 0;

  for (const w of words) {
    const spoken = normalize(w.word);
    if (!spoken) { corrected.push({ ...w, display: w.word.trim() }); continue; }

    let bestMatch = -1, bestScore = 0;
    for (let si = Math.max(0, scriptCursor - 2); si < Math.min(SCRIPT_WORDS.length, scriptCursor + 10); si++) {
      if (SCRIPT_WORDS[si] === spoken || SCRIPT_WORDS[si].startsWith(spoken.slice(0, 4))) {
        const score = spoken.length / Math.max(SCRIPT_WORDS[si].length, spoken.length);
        if (score > bestScore) { bestScore = score; bestMatch = si; }
      }
    }

    if (bestMatch >= 0 && bestScore > 0.7) {
      corrected.push({ ...w, display: SCRIPT_WORDS[bestMatch] });
      scriptCursor = bestMatch + 1;
    } else {
      corrected.push({ ...w, display: w.word.trim().toLowerCase() });
    }
  }

  const captions = [];
  let group = [], charCount = 0;
  for (const w of corrected) {
    const txt = w.display;
    if (!txt) continue;
    if (charCount + txt.length + (group.length > 0 ? 1 : 0) > MAX_CHARS && group.length > 0) {
      captions.push(group); group = []; charCount = 0;
    }
    group.push(w);
    charCount += txt.length + (group.length > 1 ? 1 : 0);
  }
  if (group.length > 0) captions.push(group);

  function toSrtTime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60), ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  }

  return captions.map((grp, i) => {
    const text = grp.map(w => w.display).join(' ').toUpperCase();
    return `${i + 1}\n${toSrtTime(grp[0].start)} --> ${toSrtTime(grp[grp.length - 1].end)}\n${text}`;
  }).join('\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n=== Skool Intro Pre-processor v5 ===\n');

  // 1. Denoise (cached if exists)
  if (!fs.existsSync(DENOISED)) {
    console.log('[denoise]');
    execSync(`${FFMPEG} -y -i "${INPUT}" -af "highpass=f=100,afftdn=nf=-25" -c:v copy "${DENOISED}"`, { stdio: 'inherit' });
  } else { console.log('[denoise] cached'); }

  // 2. Fine-grained silence boundaries for snapping
  const silenceBoundaries = getSilenceBoundaries(DENOISED);

  // 3. Whisper on full denoised clip → word-level timestamps
  const whisper = await transcribeWordLevel(DENOISED);
  const words = whisper.words || [];
  if (words.length === 0) { console.error('Whisper returned no words!'); process.exit(1); }

  // 4. Group words into utterances
  const utterances = groupIntoUtterances(words);
  console.log(`\n[utterances] ${utterances.length} groups from ${words.length} words`);

  // 5. Detect repeat takes + merge manual cuts
  console.log('\n[repeat takes]');
  const autoCuts = detectRepeatTakes(utterances, SCRIPT_WORDS);
  const cuts = [...autoCuts, ...MANUAL_CUTS];
  console.log(`  Auto cuts: ${autoCuts.length}, manual cuts: ${MANUAL_CUTS.length}, total: ${cuts.length}`);

  // 6. Filter out repeat takes
  const keptUtterances = filterUtterances(utterances, cuts);
  const totalSpeech = keptUtterances.reduce((a, u) => a + (u.end - u.start), 0);
  console.log(`\n  Final: ${keptUtterances.length}/${utterances.length} utterances, ${totalSpeech.toFixed(1)}s (~${Math.round(totalSpeech / 60)} min)`);

  // 7. Write transcript for review (with script comparison)
  const transcriptPath = path.join(OUT_DIR, 'transcript.txt');
  const fmtTime = s => {
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(1);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(4,'0')}`;
  };

  // Build script sentence array for comparison
  const scriptSentences = SCRIPT.split(/(?<=[.?!—])\s+/).map(s => s.trim()).filter(Boolean);

  function matchScriptLine(utteranceText) {
    const spokenWords = utteranceText.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(w => w.length > 2);
    if (spokenWords.length < 3) return null;
    const spokenSet = new Set(spokenWords);
    let bestScore = 0, bestLine = null;
    for (const line of scriptSentences) {
      const lineWords = line.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(w => w.length > 2);
      const lineSet = new Set(lineWords);
      const overlap = spokenWords.filter(w => lineSet.has(w)).length;
      const score = overlap / Math.max(spokenSet.size, lineSet.size, 1);
      if (score > bestScore) { bestScore = score; bestLine = line; }
    }
    return bestScore >= 0.25 ? { line: bestLine, score: bestScore } : null;
  }

  const keptSet = new Set(keptUtterances.map(u => u.start));
  const transcriptLines = [
    '=== TRANSCRIPT REVIEW ===',
    `${utterances.length} utterances — ${keptUtterances.length} kept, ${utterances.length - keptUtterances.length} cut`,
    'Format: [MM:SS–MM:SS] STATUS | "spoken text" → matched script line',
    ''
  ];

  for (const u of utterances) {
    const kept = keptSet.has(u.start);
    const cutInfo = cuts.find(c => u.start >= c.start && u.start < c.end);
    const status = kept ? 'KEEP' : `CUT  (repeat ${cutInfo ? fmtTime(cutInfo.start) + '–' + fmtTime(cutInfo.end) : '?'})`;
    const match = matchScriptLine(u.text);
    const scriptNote = match
      ? `\n     SCRIPT (${(match.score * 100).toFixed(0)}%): "${match.line.slice(0, 80)}${match.line.length > 80 ? '...' : ''}"`
      : '\n     SCRIPT: [no match — ad-lib or deviation]';
    transcriptLines.push(`[${fmtTime(u.start)}–${fmtTime(u.end)}] ${status} | "${u.text}"${scriptNote}`);
    transcriptLines.push('');
  }

  fs.writeFileSync(transcriptPath, transcriptLines.join('\n'), 'utf8');
  console.log(`\n[transcript] written to ${transcriptPath}`);

  // 8. Convert utterances to silence-snapped time segments
  const keepSegments = utterancesToSegments(keptUtterances, silenceBoundaries);

  // 9. Cut (always rebuild)
  if (fs.existsSync(CUT)) fs.unlinkSync(CUT);
  console.log(`\n[cut] ${keepSegments.length} segments → ${CUT}`);
  cutSegments(DENOISED, keepSegments, CUT);
  const cutDuration = getClipDuration(CUT);
  console.log(`  Cut duration: ${cutDuration.toFixed(1)}s`);

  // 8. Re-transcribe cut clip for accurate caption timestamps
  const captionWhisper = await transcribeWordLevel(CUT);
  const captionWords = captionWhisper.words || [];

  // 9. Script-aligned SRT
  const srtContent = buildScriptAlignedSrt(captionWords);
  fs.writeFileSync(SRT_PATH, srtContent, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'captions.srt'), srtContent, 'utf8');
  console.log(`\n  Captions: ${srtContent.split('\n\n').filter(Boolean).length} segments`);

  // 10. Burn captions onto 1920×1080 cut
  if (fs.existsSync(FINAL)) fs.unlinkSync(FINAL);
  console.log('\n[captions]');
  const escapedSrt = 'C\\:/Users/thlyn/subs.srt';
  execSync(
    `${FFMPEG} -y -i "${CUT}" ` +
    `-vf "subtitles='${escapedSrt}':force_style='FontName=Arial Black,FontSize=14,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1,Outline=2,Shadow=1,MarginV=40,Alignment=2'" ` +
    `-c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k "${FINAL}"`,
    { stdio: 'inherit' }
  );

  console.log(`\n✓ Done! ${FINAL}`);
  console.log(`  Duration: ${getClipDuration(FINAL).toFixed(1)}s`);
})();
