import { useEffect, useRef } from "react";

interface BeamsBackgroundProps {
  className?: string;
  intensity?: "subtle" | "medium" | "strong";
}

interface Beam {
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  speed: number;
  opacity: number;
  hueOffset: number; // spread around the theme hue
  pulse: number;
  pulseSpeed: number;
}

const OPACITY = { subtle: 0.7, medium: 0.85, strong: 1 } as const;
const BEAM_COUNT = 30;
const SCALE = 0.5; // render at half resolution: far cheaper blur, looks the same

function createBeam(w: number, h: number): Beam {
  return {
    x: Math.random() * w * 1.5 - w * 0.25,
    y: Math.random() * h * 1.5 - h * 0.25,
    width: 30 + Math.random() * 60,
    length: h * 2.5,
    angle: -35 + Math.random() * 10,
    speed: 0.6 + Math.random() * 1.2,
    opacity: 0.12 + Math.random() * 0.16,
    hueOffset: (Math.random() - 0.5) * 50,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.02 + Math.random() * 0.03,
  };
}

/** Hue (0-360) of the current theme glow, e.g. "rgb(58, 118, 235)" -> ~220 (Ocean blue). */
function glowHue(): number {
  const m = getComputedStyle(document.documentElement).getPropertyValue("--glow").match(/\d+/g);
  if (!m || m.length < 3) return 220;
  const [r, g, b] = m.slice(0, 3).map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 220;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Animated light beams that follow the theme colour. Sits behind the app. */
export function BeamsBackground({ className = "", intensity = "strong" }: Readonly<BeamsBackgroundProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let beams: Beam[] = [];
    let hue = glowHue();
    let frame = 0;
    let raf = 0;

    const resize = () => {
      w = Math.max(1, Math.round(window.innerWidth * SCALE));
      h = Math.max(1, Math.round(window.innerHeight * SCALE));
      canvas.width = w;
      canvas.height = h;
      beams = Array.from({ length: BEAM_COUNT }, () => createBeam(w, h));
    };

    const resetBeam = (b: Beam, i: number) => {
      const spacing = w / 3;
      b.y = h + 50;
      b.x = (i % 3) * spacing + spacing / 2 + (Math.random() - 0.5) * spacing * 0.5;
      b.width = 50 + Math.random() * 50;
      b.speed = 0.25 + Math.random() * 0.2;
      b.opacity = 0.2 + Math.random() * 0.1;
    };

    const draw = (b: Beam) => {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate((b.angle * Math.PI) / 180);
      const o = b.opacity * (0.8 + Math.sin(b.pulse) * 0.2) * OPACITY[intensity];
      const c = `hsla(${hue + b.hueOffset}, 85%, 65%,`;
      const g = ctx.createLinearGradient(0, 0, 0, b.length);
      g.addColorStop(0, `${c} 0)`);
      g.addColorStop(0.1, `${c} ${o * 0.5})`);
      g.addColorStop(0.4, `${c} ${o})`);
      g.addColorStop(0.6, `${c} ${o})`);
      g.addColorStop(0.9, `${c} ${o * 0.5})`);
      g.addColorStop(1, `${c} 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(-b.width / 2, 0, b.width, b.length);
      ctx.restore();
    };

    const render = (move: boolean) => {
      if (frame++ % 20 === 0) hue = glowHue(); // follows theme switches
      ctx.clearRect(0, 0, w, h);
      ctx.filter = "blur(18px)";
      beams.forEach((b, i) => {
        if (move) {
          b.y -= b.speed;
          b.pulse += b.pulseSpeed;
          if (b.y + b.length < -50) resetBeam(b, i);
        }
        draw(b);
      });
    };

    const loop = () => {
      render(true);
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) loop();
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) render(false);
    else loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intensity]);

  return (
    <div aria-hidden className={`beams-bg ${className}`}>
      <canvas ref={canvasRef} />
      <div className="beams-bg-haze" />
    </div>
  );
}

export default BeamsBackground;
