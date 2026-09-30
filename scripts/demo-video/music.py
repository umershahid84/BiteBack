"""Composes the light background music for the demo videos. It is generated here in code (no samples),
so it is original and free to use anywhere.

    python scripts/demo-video/music.py      # after record.mjs; writes .video-tmp/<tour>-music.wav

An easy-going D major loop (D, A, Bm, G) at 100 BPM: marimba-like arpeggio, soft pad, bass, light
percussion and a glockenspiel melody every other phrase. Each tour's cues set the length, and the beat is
lined up so the final chord lands as the BiteBack logo pops in on the end screen.
"""
import json
import pathlib

import numpy as np
import soundfile as sf

RATE = 48000
TMP = pathlib.Path('.video-tmp')
TRIM = 0.6  # seconds cut from the start of each recording (keep in step with build.mjs)
LOGO_POP = 0.35  # the logo pops in this long after the end screen starts (record.mjs)
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT

# I - V - vi - IV in D major: pad voicings, and bass roots (MIDI note numbers).
CHORDS = [[62, 66, 69], [61, 64, 69], [59, 62, 66], [59, 62, 67]]
ROOTS = [38, 45, 47, 43]
# A 4-bar glockenspiel phrase over the progression: (note, start beat, length in beats).
MELODY = [(78, 0, 1), (81, 1, 1), (83, 2, 1.5), (81, 3.5, 0.5),
          (76, 4, 1), (78, 5, 1), (81, 6, 2),
          (78, 8, 1), (76, 9, 1), (74, 10, 1.5), (78, 11.5, 0.5),
          (79, 12, 1), (78, 13, 1), (76, 14, 2)]
ARPEGGIO = [0, 1, 2, 3, 2, 1, 2, 3]  # eighth notes over the chord tones (3 = root an octave up)

rng = np.random.default_rng(7)


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def times(seconds):
    return np.arange(int(seconds * RATE)) / RATE


class Track:
    def __init__(self, seconds):
        self.buf = np.zeros((int(seconds * RATE) + RATE * 6, 2))

    def add(self, at, sig, gain=1.0, pan=0.0):
        """Adds a mono signal at `at` seconds, panned from -1 (left) to 1 (right)."""
        if at < -len(sig) / RATE:
            return
        start = int(round(at * RATE))
        if start < 0:
            sig, start = sig[-start:], 0
        sig = sig[: len(self.buf) - start]
        angle = (pan + 1) * np.pi / 4
        self.buf[start:start + len(sig), 0] += sig * gain * np.cos(angle)
        self.buf[start:start + len(sig), 1] += sig * gain * np.sin(angle)


def pluck(f, seconds=0.9):
    t = times(seconds)
    body = np.sin(2 * np.pi * f * t) + 0.1 * np.sin(2 * np.pi * 2 * f * t)
    tine = 0.18 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t * 28)
    return (body + tine) * np.exp(-t * 6.5) * (1 - np.exp(-t * 500))


def glock(f, seconds=1.6):
    t = times(seconds)
    return np.sin(2 * np.pi * f * t + 1.1 * np.exp(-t * 7) * np.sin(2 * np.pi * 3.5 * f * t)) * np.exp(-t * 3) * (1 - np.exp(-t * 800))


def pad_note(f, seconds, detune):
    t = times(seconds)
    f = f * (1 + detune)
    env = np.minimum(1, t / 0.45) * np.minimum(1, (seconds - t) / 0.7).clip(0)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)) * env * (1 + 0.08 * np.sin(2 * np.pi * 0.3 * t))


def bass(f, seconds):
    t = times(seconds)
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)) \
        * np.exp(-t * 2.2) * (1 - np.exp(-t * 250)) * np.minimum(1, (seconds - t) / 0.05).clip(0)


def kick():
    t = times(0.3)
    phase = 2 * np.pi * np.cumsum(45 + 70 * np.exp(-t * 30)) / RATE
    return np.sin(phase) * np.exp(-t * 18) * (1 - np.exp(-t * 400))


def noise_hit(seconds, decay, brightness):
    t = times(seconds)
    n = rng.standard_normal(len(t))
    for _ in range(brightness):  # each difference tilts the noise brighter
        n = np.diff(n, prepend=0)
    return n / np.abs(n).max() * np.exp(-t * decay) * (1 - np.exp(-t * 900))


def compose(length, final_at):
    """length: video length in seconds; final_at: when the final chord should land."""
    track = Track(length)
    last = int(np.floor(final_at / BAR))  # index of the bar that starts on the final chord
    origin = final_at - last * BAR  # time of bar 0's downbeat
    chord_of = lambda bar: (bar - last + 2) % 4  # so the bar before the ending is the V chord (A)
    shaker, snap = noise_hit(0.08, 55, 2), noise_hit(0.18, 30, 1)

    for bar in range(-1, last):
        t0 = origin + bar * BAR
        if t0 + BAR < 0:
            continue
        c = chord_of(bar)
        intro = t0 < 2 * BAR  # the first bars are just pad and arpeggio
        for i, note in enumerate(CHORDS[c]):
            for detune, pan in ((-0.0015, -0.7), (0.0015, 0.7)):
                track.add(t0, pad_note(hz(note), BAR + 0.5, detune), 0.03 - 0.004 * i, pan)
        tones = CHORDS[c] + [CHORDS[c][0] + 12]
        for i, idx in enumerate(ARPEGGIO):
            velocity = (1.0 if i % 2 == 0 else 0.75) * rng.uniform(0.9, 1.05)
            track.add(t0 + i * BEAT / 2, pluck(hz(tones[idx] + 12)), 0.16 * velocity, -0.25)
        if intro:
            continue
        for beat in (0, 2):
            track.add(t0 + beat * BEAT, bass(hz(ROOTS[c]), BEAT * 1.8), 0.1)
            track.add(t0 + beat * BEAT, kick(), 0.09)
        track.add(t0 + 3.5 * BEAT, bass(hz(ROOTS[c] + 12 if c != 3 else ROOTS[c] + 7), BEAT * 0.45), 0.06)
        for beat in (1, 3):
            track.add(t0 + beat * BEAT, snap, 0.045, 0.15)
        for i in range(8):  # eighth notes, accented on the off-beats
            track.add(t0 + i * BEAT / 2, shaker, 0.03 if i % 2 else 0.018, 0.4)
        if ((bar - last + 2) // 4) % 2 == 0:  # melody every other time round the progression
            for note, start, beats in MELODY:
                if int(start // 4) == c:  # the melody's bar for this chord
                    track.add(t0 + (start - 4 * c) * BEAT, glock(hz(note), max(1.2, beats * BEAT + 0.8)), 0.09, 0.35)

    # The ending: a D major chord with an upward strum, a sparkle and a long bass note.
    tail = max(3.0, length - final_at + 0.5)
    for i, note in enumerate([62, 66, 69]):
        for detune, pan in ((-0.0015, -0.7), (0.0015, 0.7)):
            track.add(final_at, pad_note(hz(note), tail, detune), 0.035 - 0.004 * i, pan)
    for i, note in enumerate([62, 66, 69, 74, 78, 81]):
        track.add(final_at + i * 0.06, pluck(hz(note + 12), 1.6), 0.12, -0.4 + i * 0.16)
    track.add(final_at + 0.4, glock(hz(86), 2.5), 0.06, 0.4)
    track.add(final_at + 0.55, glock(hz(93), 2.5), 0.04, -0.3)
    track.add(final_at, bass(hz(38), 3.0), 0.12)
    track.add(final_at, kick(), 0.1)

    out = track.buf[: int(length * RATE)]
    t = np.arange(len(out)) / RATE
    fade = np.minimum(1, t / 1.5) * np.clip((length - t) / 2.2, 0, 1)
    out = out * fade[:, None]
    return (out / np.abs(out).max() * 0.89).astype(np.float32)


def main():
    for tour in ('customer', 'restaurant'):
        cues = json.loads((TMP / f'{tour}-cues.json').read_text())
        at = {c['id']: c['at'] - TRIM for c in cues if c.get('marker')}
        music = compose(at['finish'], at['outro'] + LOGO_POP)
        sf.write(TMP / f'{tour}-music.wav', music, RATE)
        print(f'{tour}: {len(music) / RATE:.1f}s of music, final chord at {at["outro"] + LOGO_POP:.1f}s')


if __name__ == '__main__':
    main()
