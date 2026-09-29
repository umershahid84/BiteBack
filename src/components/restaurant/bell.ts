'use client';

// Counter-bell "ding-ding", synthesized with the Web Audio API (no sound file needed).
// Browsers only allow audio after the user has interacted with the page, so call
// unlockOnInteraction() once and check isUnlocked() to prompt the user.

let ctx: AudioContext | undefined;
let unlocked = false;

function context() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new AC();
  return ctx;
}

export const isUnlocked = () => unlocked;

export function unlockOnInteraction(onUnlock?: () => void) {
  const unlock = async () => {
    try {
      await context().resume();
      unlocked = context().state === 'running';
    } catch { /* audio unavailable */ }
    if (unlocked) {
      removeEventListener('click', unlock);
      removeEventListener('keydown', unlock);
      // Defer UI changes so the click that unlocked audio still reaches its target.
      setTimeout(() => onUnlock?.(), 0);
    }
  };
  // 'click' (not 'pointerdown'), so hiding the prompt banner can't shift the page mid-click.
  addEventListener('click', unlock);
  addEventListener('keydown', unlock);
  return () => {
    removeEventListener('click', unlock);
    removeEventListener('keydown', unlock);
  };
}

function strike(at: number, base: number, volume: number) {
  const ac = context();
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  // Inharmonic partials give the metallic bell character.
  for (const [ratio, level, decay] of [[1, 1, 1.6], [2.76, 0.45, 0.9], [5.4, 0.25, 0.5], [8.93, 0.12, 0.3]] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * ratio;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

export function ringBell({ volume = 0.35 }: { volume?: number } = {}) {
  if (!unlocked) return false;
  const now = context().currentTime + 0.02;
  strike(now, 1318.5, volume); // E6
  strike(now + 0.32, 1318.5, volume * 0.9);
  return true;
}
