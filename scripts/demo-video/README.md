# Demo videos

The narrated tours in `public/videos/` (home page, **How it works** on the deals page, **Watch the tour** on the restaurant dashboard) are recorded from the real app. The voice-over is generated with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an open-source text-to-speech model (Apache 2.0) that runs on your own computer.

To change what is said, edit `narration.json`, then rebuild:

```bash
# 1. Voice (Python 3.10+; model files from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0)
pip install kokoro-onnx soundfile
python scripts/demo-video/voice.py kokoro-v1.0.onnx voices-v1.0.bin   # → .video-tmp/voice/

# 2. Screen recording, timed to the voice (needs Playwright's Chromium: npx playwright install chromium)
npm run db:reset && npm run seed      # fresh demo data
npm run dev                           # in another terminal
node scripts/demo-video/record.mjs    # → .video-tmp/*-raw.webm, *-cues.json

# 3. Mix and encode (ffmpeg with libx264, libvpx-vp9 and libopus)
node scripts/demo-video/build.mjs     # → public/videos/*-tour.{mp4,webm,vtt,jpg}
```

`build.mjs` prints each video's length; update `length` in `src/components/app/demo-video.tsx` if it changed. The `.vtt` files are optional subtitles (off by default in the player) with the same words as the voice-over. The bell in the restaurant tour is the dashboard's own order bell (`src/components/restaurant/bell.ts`), recreated in `voice.py`.

Voice and speed are set at the top of `narration.json` (`af_heart` is a US English voice; others include `af_bella`, `am_michael` and `bf_emma`).
