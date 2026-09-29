'use client';

// Lightweight confetti burst (no dependencies). Skipped for users who prefer reduced motion.
const COLORS = ['#10b981', '#34d399', '#059669', '#fde047', '#f59e0b', '#fb7185', '#60a5fa', '#a78bfa'];

export function confetti({ particles = 220, duration = 3800 }: { particles?: number; duration?: number } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.append(canvas);
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3000';
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  // Two cannons from the bottom corners plus a burst from the center.
  const origins: { x: number; y: number; angle: [number, number] }[] = [
    { x: 0, y: innerHeight, angle: [-75, -45] },
    { x: innerWidth, y: innerHeight, angle: [-135, -105] },
    { x: innerWidth / 2, y: innerHeight * 0.35, angle: [-180, 0] },
  ];
  const bits = Array.from({ length: particles }, (_, i) => {
    const o = origins[i % origins.length];
    const angle = (rand(...o.angle) * Math.PI) / 180;
    const speed = o === origins[2] ? rand(4, 11) : rand(13, 22);
    return {
      x: o.x, y: o.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: rand(6, 11), h: rand(8, 16), rot: rand(0, Math.PI * 2), vr: rand(-0.25, 0.25),
      tilt: rand(0, Math.PI * 2), vt: rand(0.05, 0.15), color: COLORS[i % COLORS.length], round: Math.random() < 0.3,
      delay: o === origins[2] ? 0 : rand(0, 250),
    };
  });

  const start = performance.now();
  function frame(now: number) {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const fade = Math.max(0, Math.min(1, (duration - t) / 800));
    for (const b of bits) {
      if (t < b.delay) continue;
      b.vy += 0.32;
      b.vx *= 0.985;
      b.vy *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      b.tilt += b.vt;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(1, Math.cos(b.tilt));
      ctx.fillStyle = b.color;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else {
      removeEventListener('resize', resize);
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
