import { useEffect, useRef } from "react";

/* ==========================================================================
   The prompt bar's avatar.

   The live page renders this as a <canvas> showing a slowly drifting
   multi-blob gradient, with a light sweep that crosses it on a loop
   (`pvc-orb-shimmer`). Both are reproduced here on a plain 2D canvas: blobs
   are composited additively, and the sweep is a CSS layer on top so it costs
   nothing per frame.
   ========================================================================== */

const BLOB_COUNT = 4;

/** Hue anchors chosen to sit in the warm amber-to-crimson band of the original. */
const HUES = [16, 340, 30, 4];

interface Blob {
  hue: number;
  /** Orbital centre, in 0..1 of the canvas box. */
  cx: number;
  cy: number;
  /** Orbital radius. */
  rx: number;
  ry: number;
  /** Angular speed — negative runs the other way. */
  speed: number;
  phase: number;
  /** Radius as a fraction of the box. */
  size: number;
}

export function AnimatedAvatar({ size = 28 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match device pixels so the orb stays crisp on HiDPI.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const blobs: Blob[] = Array.from({ length: BLOB_COUNT }, (_, i) => ({
      hue: HUES[i % HUES.length],
      cx: 0.5,
      cy: 0.5,
      rx: 0.1 + Math.random() * 0.16,
      ry: 0.1 + Math.random() * 0.16,
      speed: (0.18 + Math.random() * 0.28) * (i % 2 === 0 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
      size: 0.3 + Math.random() * 0.18,
    }));

    let frame = 0;
    let running = true;

    const render = (time: number) => {
      if (!running) return;
      const t = time / 1000;

      ctx.clearRect(0, 0, size, size);

      for (const b of blobs) {
        const x = (0.5 + Math.cos(t * b.speed + b.phase) * b.rx) * size;
        const y = (0.5 + Math.sin(t * b.speed * 1.3 + b.phase) * b.ry) * size;
        const r = b.size * size;

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `hsl(${b.hue} 92% 62% / 0.95)`);
        gradient.addColorStop(0.55, `hsl(${b.hue} 88% 55% / 0.45)`);
        gradient.addColorStop(1, `hsl(${b.hue} 85% 50% / 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [size]);

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: "block" }}
      />
      {/* Light sweep, matching the site's shimmer keyframes. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full bg-gray-alpha-200">
        <div className="absolute inset-y-0 left-0 w-full animate-orb-shimmer" />
      </div>
    </div>
  );
}
