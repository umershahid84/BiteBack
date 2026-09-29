// Mixes the voice-over into the recorded tours and encodes them for the web (see README.md in this folder).
// Needs an ffmpeg with libx264, libvpx-vp9 and libopus (set FFMPEG=/path/to/ffmpeg if it isn't on PATH).
// Writes public/videos/<tour>-tour.{mp4,webm,vtt,jpg}.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TMP = path.resolve('.video-tmp');
const OUT = path.resolve('public/videos');
const TRIM = 0.6; // the first moments of a recording are a blank page
const script = JSON.parse(fs.readFileSync(new URL('./narration.json', import.meta.url), 'utf8'));
const durations = JSON.parse(fs.readFileSync(path.join(TMP, 'voice/durations.json'), 'utf8'));
// Poster frame: shortly after this line starts.
const POSTER = { customer: 'pin', restaurant: 'bell' };

const ffmpeg = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const vttTime = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 23);

function length(file) {
  const [, h, m, s] = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(FFMPEG, ['-i', file]).stderr.toString());
  const total = Math.round(Number(h) * 3600 + Number(m) * 60 + Number(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

for (const tour of ['customer', 'restaurant']) {
  const raw = path.join(TMP, `${tour}-raw.webm`);
  const cues = JSON.parse(fs.readFileSync(path.join(TMP, `${tour}-cues.json`), 'utf8'));
  const lines = new Map(script[tour].map((l) => [l.id, l.text]));

  // One input per cue, each delayed to its moment in the video, mixed without lowering the volume.
  const inputs = cues.flatMap((c) => ['-i', path.join(TMP, 'voice', c.sound ? `${c.id}.wav` : `${tour}-${c.id}.wav`)]);
  const delayed = cues.map((c, i) => {
    const ms = Math.max(0, Math.round((c.at - TRIM) * 1000));
    return `[${i + 1}:a]aresample=48000,adelay=${ms}:all=1${c.sound ? ',volume=0.6' : ''}[a${i}]`;
  });
  const mix = `${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`;
  const common = ['-ss', String(TRIM), '-i', raw, ...inputs, '-filter_complex', [...delayed, mix].join(';'), '-map', '0:v', '-map', '[a]'];

  const base = path.join(OUT, `${tour}-tour`);
  ffmpeg([...common, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-movflags', '+faststart', `${base}.mp4`]);
  ffmpeg([...common, '-vf', 'fps=25', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
    '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', `${base}.webm`]);

  // Subtitles (off by default in the player) with the same words as the voice-over.
  const vtt = ['WEBVTT', ''];
  for (const c of cues.filter((x) => !x.sound)) {
    const start = c.at - TRIM;
    vtt.push(`${vttTime(start)} --> ${vttTime(start + durations[`${tour}-${c.id}`])}`, lines.get(c.id), '');
  }
  fs.writeFileSync(`${base}.vtt`, vtt.join('\n'));

  const poster = cues.find((c) => c.id === POSTER[tour] && !c.sound);
  ffmpeg(['-ss', String(poster.at - TRIM + 1.5), '-i', `${base}.mp4`, '-frames:v', '1', '-q:v', '4', `${base}.jpg`]);

  console.log(`${tour}: ${length(`${base}.mp4`)} → ${base}.{mp4,webm,vtt,jpg}`);
}
