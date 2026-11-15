"use client";

import { useEffect, useRef } from "react";
import { useHtmlAttr } from "@/components/ui";

// Christmas theme decorations (only mounted in the "natal" theme). Everything
// here is decorative: pointer-transparent and aria-hidden.
//  - canvas: twinkling stars and shooting stars, 3 layers of snow (crystals up
//    close) leaning with the mouse, falling baubles, a sparkle trail on the
//    cursor, automatic fireworks, and a rocket + firework on every click;
//  - northern-lights glow, snow mound, Conde flying across the sky;
//  - a swaying garland of twinkling lights;
//  - Santa's sleigh crossing the sky now and then;
//  - a days-to-Christmas pill.

const BULB_COLORS = ["#ef4444", "#fbbf24", "#34d399", "#60a5fa", "#f472b6"];
const ARCS = 8;

// One quadratic arc per segment: the wire dips 36px between two pegs.
const WIRE = (() => {
  let d = "M0 4";
  for (let i = 0; i < ARCS; i++) {
    const x0 = (i * 1000) / ARCS;
    d += ` Q${x0 + 1000 / ARCS / 2} 40 ${x0 + 1000 / ARCS} 4`;
  }
  return d;
})();

const BULBS = Array.from({ length: ARCS * 3 }, (_, i) => {
  const arc = Math.floor(i / 3);
  const t = [0.2, 0.5, 0.8][i % 3];
  return {
    left: ((arc + t) * 100) / ARCS,
    top: 4 + 72 * t * (1 - t),
    color: BULB_COLORS[i % BULB_COLORS.length],
    delay: -(i % 6) * 0.4,
  };
});

// The little dancing Condes along the bottom edge.
const CREW = [
  { h: 84, move: "a", delay: 0, dur: 0.7 },
  { h: 64, move: "b", delay: -0.3, dur: 0.9 },
  { h: 96, move: "c", delay: -0.1, dur: 1.1 },
  { h: 70, move: "a", delay: -0.5, dur: 0.6 },
  { h: 88, move: "b", delay: -0.2, dur: 1 },
  { h: 60, move: "c", delay: -0.6, dur: 0.8 },
  { h: 78, move: "a", delay: -0.4, dur: 0.75 },
];

function daysToChristmas(): number | null {
  const now = new Date();
  const y = now.getFullYear();
  const xmas = new Date(y, 11, 25);
  const today = new Date(y, now.getMonth(), now.getDate());
  const diff = Math.round((xmas.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 0;
  return diff > 0 ? diff : Math.round((new Date(y + 1, 11, 25).getTime() - today.getTime()) / 86400000);
}

interface Flake {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  layer: number;
  rot: number;
}
interface Bauble {
  x: number;
  y: number;
  r: number;
  vy: number;
  phase: number;
  color: string;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  size: number;
  g: number;
}
interface Rocket {
  x: number;
  y: number;
  ty: number;
}
interface Floater {
  x: number;
  y: number;
  life: number;
  text: string;
}

const FIREWORK_COLORS = ["#fde08a", "#f87171", "#4cc77a", "#ffffff", "#60a5fa", "#f472b6", "#fbbf24"];
const BAUBLE_COLORS = ["#dc2626", "#f5c451", "#16a34a", "#2563eb", "#db2777"];
const SHOUTS = ["Ho Ho Ho!", "Feliz Natal!", "Boas apostas!", "Conde!"];

function SnowCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = (): void => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const small = w < 700;

    const mk = (i: number, scatter: boolean): Flake => {
      const layer = i % 3; // 0 far, 1 mid, 2 near
      return {
        x: Math.random() * w,
        y: scatter ? Math.random() * h : -12,
        r: [1.2, 2.2, 4][layer] * (0.8 + Math.random() * 0.5),
        vy: [18, 34, 58][layer] * (0.8 + Math.random() * 0.5),
        phase: Math.random() * Math.PI * 2,
        layer,
        rot: Math.random() * Math.PI,
      };
    };
    const mkBauble = (scatter: boolean): Bauble => ({
      x: Math.random() * w,
      y: scatter ? Math.random() * h : -30,
      r: 8 + Math.random() * 6,
      vy: 22 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
      color: BAUBLE_COLORS[Math.floor(Math.random() * BAUBLE_COLORS.length)],
    });

    const flakes = Array.from({ length: small ? 70 : 130 }, (_, i) => mk(i, true));
    const baubles = Array.from({ length: small ? 3 : 7 }, () => mkBauble(true));
    const stars = Array.from({ length: small ? 35 : 80 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.45,
      ph: Math.random() * 6.28,
      sp: 0.6 + Math.random() * 1.8,
      r: 0.5 + Math.random() * 1.1,
    }));
    const parts: Particle[] = [];
    const rockets: Rocket[] = [];
    const floaters: Floater[] = [];
    let shoot: { x: number; y: number; life: number } | null = null;
    let nextShoot = 4;
    let nextAuto = 3;
    let mouseX = 0.5;
    let mouseY = 0.5;
    let px = 0;
    let py = 0;
    let lastTrail = { x: -99, y: -99 };
    let wind = 0;
    let clock = 0;
    let t0 = performance.now();
    let raf = 0;

    const burst = (x: number, y: number): void => {
      const palette = [0, 1, 2].map(() => FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]);
      const n = small ? 45 : 80;
      const ring = Math.random() < 0.4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
        const sp = ring ? 150 : 40 + Math.random() * 200;
        parts.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.55 + Math.random() * 0.5,
          color: palette[i % 3],
          size: 1.6 + Math.random() * 1.4,
          g: 90,
        });
      }
    };
    const launch = (x: number, ty: number): void => {
      rockets.push({ x, y: h + 10, ty });
    };

    const onMove = (e: PointerEvent): void => {
      mouseX = e.clientX / Math.max(w, 1);
      mouseY = e.clientY / Math.max(h, 1);
      if (e.pointerType !== "mouse") return;
      if (Math.hypot(e.clientX - lastTrail.x, e.clientY - lastTrail.y) < 10) return;
      lastTrail = { x: e.clientX, y: e.clientY };
      parts.push({
        x: e.clientX,
        y: e.clientY,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.3) * 30,
        life: 1,
        decay: 1.8,
        color: Math.random() < 0.5 ? "#fde08a" : "#ffffff",
        size: 1.8,
        g: 40,
      });
    };
    const onDown = (e: PointerEvent): void => {
      launch(e.clientX, e.clientY);
      if (Math.random() < 0.3) {
        floaters.push({ x: e.clientX, y: e.clientY - 20, life: 1, text: SHOUTS[Math.floor(Math.random() * SHOUTS.length)] });
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("resize", resize);

    const root = document.documentElement;

    const drawStar = (x: number, y: number, r: number, rot: number): void => {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot + (k * Math.PI) / 3;
        ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.stroke();
    };

    const frame = (now: number): void => {
      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;
      clock += dt;

      // Smoothed mouse drives the backdrop parallax (CSS vars) and the wind.
      px += ((mouseX - 0.5) * 2 - px) * Math.min(dt * 3, 1);
      py += ((mouseY - 0.5) * 2 - py) * Math.min(dt * 3, 1);
      root.style.setProperty("--mx", px.toFixed(3));
      root.style.setProperty("--my", py.toFixed(3));
      const target = Math.sin(now / 4200) * 22 + (mouseX - 0.5) * 80;
      wind += (target - wind) * Math.min(dt * 1.5, 1);

      ctx.clearRect(0, 0, w, h);

      // Twinkling stars + the odd shooting star.
      ctx.fillStyle = "#fff";
      for (const st of stars) {
        ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(clock * st.sp + st.ph));
        ctx.beginPath();
        ctx.arc(st.x * w, st.y * h, st.r, 0, 6.283);
        ctx.fill();
      }
      if (!shoot && clock > nextShoot) {
        shoot = { x: w * (0.4 + Math.random() * 0.6), y: h * Math.random() * 0.25, life: 1 };
        nextShoot = clock + 6 + Math.random() * 9;
      }
      if (shoot) {
        shoot.life -= dt * 1.3;
        shoot.x -= 700 * dt;
        shoot.y += 300 * dt;
        if (shoot.life <= 0) shoot = null;
        else {
          const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x + 120, shoot.y - 51);
          g.addColorStop(0, `rgba(255,255,255,${shoot.life})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalAlpha = 1;
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(shoot.x, shoot.y);
          ctx.lineTo(shoot.x + 120, shoot.y - 51);
          ctx.stroke();
        }
      }

      // Snow: dots on the far layers, little crystals on the near one.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.y += f.vy * dt;
        f.rot += dt * 0.6;
        f.x += (wind * (0.4 + f.layer * 0.4) + Math.sin(now / 900 + f.phase) * 10) * dt;
        if (f.y > h + 12 || f.x < -24 || f.x > w + 24) {
          const wasLeft = f.x < -24;
          const wasRight = f.x > w + 24;
          flakes[i] = mk(i, false);
          if (wasLeft) flakes[i].x = w + 10;
          else if (wasRight) flakes[i].x = -10;
          continue;
        }
        ctx.globalAlpha = [0.4, 0.6, 0.9][f.layer];
        if (f.layer === 2) drawStar(f.x, f.y, f.r * 1.6, f.rot);
        else {
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, 6.283);
          ctx.fill();
        }
      }

      // Falling baubles with a glossy highlight and a gold cap.
      for (let i = 0; i < baubles.length; i++) {
        const b = baubles[i];
        b.y += b.vy * dt;
        b.x += (wind * 0.3 + Math.sin(now / 1100 + b.phase) * 18) * dt;
        if (b.y > h + 30) {
          baubles[i] = mkBauble(false);
          continue;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.sin(now / 1100 + b.phase) * 0.25);
        ctx.globalAlpha = 0.92;
        const g = ctx.createRadialGradient(-b.r * 0.35, -b.r * 0.35, b.r * 0.1, 0, 0, b.r);
        g.addColorStop(0, "#fff");
        g.addColorStop(0.25, b.color);
        g.addColorStop(1, "rgba(0,0,0,0.55)");
        ctx.fillStyle = g;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, b.r, 0, 6.283);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#f5c451";
        ctx.fillRect(-b.r * 0.28, -b.r - 3, b.r * 0.56, 4);
        ctx.restore();
      }

      // Fireworks: automatic ones and click-launched rockets.
      if (clock > nextAuto) {
        launch(w * (0.12 + Math.random() * 0.76), h * (0.1 + Math.random() * 0.3));
        nextAuto = clock + 5 + Math.random() * 5;
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y -= (h * 1.3 + 200) * dt;
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fde08a";
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.2, 0, 6.283);
        ctx.fill();
        parts.push({ x: r.x, y: r.y, vx: (Math.random() - 0.5) * 20, vy: 30, life: 0.7, decay: 2.2, color: "#fbbf24", size: 1.4, g: 0 });
        if (r.y <= r.ty) {
          burst(r.x, r.y);
          rockets.splice(i, 1);
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt * p.decay;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(p.life * 1.4, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.283);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Shouts that float up from a click.
      ctx.font = "800 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt * 0.7;
        f.y -= 40 * dt;
        if (f.life <= 0) {
          floaters.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(f.life * 2, 1);
        ctx.shadowColor = "#dc2626";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#fde08a";
        ctx.fillText(f.text, f.x, f.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = (): void => {
      if (document.hidden) cancelAnimationFrame(raf);
      else {
        t0 = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      root.style.removeProperty("--mx");
      root.style.removeProperty("--my");
    };
  }, []);

  return <canvas ref={ref} className="xmas-canvas" />;
}

function Sleigh() {
  return (
    <div className="xmas-sleigh">
      <svg viewBox="0 0 200 70" className="xmas-sleigh-bob">
        {/* trail of sparkles */}
        <g fill="#fde08a" opacity="0.8">
          <circle cx="40" cy="40" r="2" />
          <circle cx="26" cy="44" r="1.6" />
          <circle cx="14" cy="38" r="1.2" />
          <circle cx="4" cy="42" r="1" />
        </g>
        {/* runner + body */}
        <path d="M54 60q-8 0-8-6M54 60h66q10 0 8-10" fill="none" stroke="#f5c451" strokeWidth="3" strokeLinecap="round" />
        <path d="M58 54l4-18h56q8 0 10-8l2 16q-4 10-18 10z" fill="#dc2626" />
        <path d="M62 44h62" stroke="#f5c451" strokeWidth="2" />
        {/* gift sack, Santa */}
        <circle cx="72" cy="32" r="10" fill="#a16207" />
        <circle cx="94" cy="28" r="7" fill="#fcd5b4" />
        <path d="M86 25q8-16 16-2z" fill="#dc2626" />
        <circle cx="103" cy="22" r="2.6" fill="#fff" />
        <path d="M87 32q7 8 14 0" fill="#fff" />
        {/* harness */}
        <path d="M128 36q14-3 30 0" fill="none" stroke="#f5c451" strokeWidth="1.6" />
        {/* reindeer */}
        <ellipse cx="170" cy="38" rx="14" ry="8" fill="#7c4a21" />
        <circle cx="186" cy="28" r="5.5" fill="#8a5427" />
        <circle cx="191" cy="29" r="2.2" fill="#ef4444" className="xmas-nose" />
        <path d="M184 23l-2-9m2 9l5-8m-5 8l-6-5" fill="none" stroke="#d6b27a" strokeWidth="1.6" strokeLinecap="round" />
        <g stroke="#5b3416" strokeWidth="2.2" strokeLinecap="round">
          <path className="xmas-leg-a" d="M160 44l-5 12" />
          <path className="xmas-leg-b" d="M166 46l4 10" />
          <path className="xmas-leg-a" d="M174 46l5 9" />
          <path className="xmas-leg-b" d="M180 44l6 8" />
        </g>
      </svg>
    </div>
  );
}

export default function Snowfall() {
  const theme = useHtmlAttr("theme");
  if (theme !== "natal") return null;

  const days = daysToChristmas();
  return (
    <div className="xmas-layer" aria-hidden>
      <div className="xmas-aurora" />
      <div className="xmas-aurora xmas-aurora-b" />
      <SnowCanvas />
      <div className="xmas-mound" />
      <div className="xmas-crew">
        {CREW.map((c, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src="/conde-full.png"
            alt=""
            className={`xmas-dancer xmas-dance-${c.move}`}
            style={{ height: c.h, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }}
          />
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/conde-icon.png" alt="" className="xmas-conde" />

      <div className="xmas-garland">
        <svg viewBox="0 0 1000 44" preserveAspectRatio="none" className="xmas-wire">
          <path d={WIRE} fill="none" stroke="#0b1d13" strokeWidth="2.4" />
        </svg>
        {BULBS.map((b, i) => (
          <span
            key={i}
            className="xmas-bulb"
            style={{ left: `${b.left}%`, top: b.top, color: b.color, animationDelay: `${b.delay}s` }}
          />
        ))}
      </div>

      <Sleigh />

      {days !== null && (
        <div className="xmas-count">
          {days === 0 ? "Feliz Natal!" : days === 1 ? "Falta 1 dia para o Natal" : `Faltam ${days} dias para o Natal`}
        </div>
      )}
    </div>
  );
}
