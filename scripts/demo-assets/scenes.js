/* global window, document */
/**
 * Procedural demo photos for the sample studios (no stock photos or image
 * generation were available in the build environment). Rendered in Chromium by
 * scripts/demo-assets/render.ts. Real studios replace these with their own photos.
 */
(function () {
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function grain(ctx, w, h, amount, seed) {
    const r = rng(seed);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amount;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  function vignette(ctx, w, h, strength) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Side profile of a coupe, scaled to width `cw`, wheels at y = base.
  function coupePath(ctx, x, base, cw) {
    const s = cw / 1000;
    const P = (px, py) => [x + px * s, base - py * s];
    ctx.beginPath();
    ctx.moveTo(...P(0, 95));
    ctx.bezierCurveTo(...P(-6, 150), ...P(10, 190), ...P(70, 205));
    ctx.bezierCurveTo(...P(170, 225), ...P(250, 232), ...P(300, 240));
    ctx.bezierCurveTo(...P(370, 300), ...P(450, 345), ...P(560, 350));
    ctx.bezierCurveTo(...P(650, 352), ...P(720, 330), ...P(800, 270));
    ctx.bezierCurveTo(...P(880, 255), ...P(960, 240), ...P(990, 205));
    ctx.bezierCurveTo(...P(1004, 170), ...P(1004, 120), ...P(990, 95));
    ctx.lineTo(...P(905, 95));
    ctx.bezierCurveTo(...P(900, 185), ...P(745, 185), ...P(740, 95));
    ctx.lineTo(...P(275, 95));
    ctx.bezierCurveTo(...P(270, 185), ...P(115, 185), ...P(110, 95));
    ctx.closePath();
  }

  function wheel(ctx, cx, cy, r, accent, spokes, seed) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#2a2d33');
    g.addColorStop(0.7, '#101114');
    g.addColorStop(1, '#050506');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // rim
    ctx.strokeStyle = 'rgba(210,220,235,0.55)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    const rr = rng(seed);
    for (let i = 0; i < spokes; i += 1) {
      const a = (i / spokes) * Math.PI * 2 + rr() * 0.02;
      ctx.strokeStyle = `rgba(190,200,215,${0.45 + rr() * 0.3})`;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.16, cy + Math.sin(a) * r * 0.16);
      ctx.lineTo(cx + Math.cos(a + 0.08) * r * 0.7, cy + Math.sin(a + 0.08) * r * 0.7);
      ctx.stroke();
    }
    // caliper
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.42, cy - r * 0.18, r * 0.12, r * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16181c';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  function hexGrid(ctx, w, h, horizon, accent, seed) {
    const r = rng(seed);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, horizon);
    ctx.clip();
    const rows = 9;
    for (let row = 0; row < rows; row += 1) {
      const t = row / rows;
      const y = horizon * (0.05 + t * t * 0.95);
      const size = w * (0.018 + t * t * 0.07);
      const count = Math.ceil(w / (size * 1.75)) + 2;
      const offset = row % 2 ? size * 0.87 : 0;
      for (let i = -1; i < count; i += 1) {
        const cx = i * size * 1.75 + offset;
        const glow = 0.55 + r() * 0.45;
        ctx.strokeStyle = `rgba(235,242,255,${glow * (0.35 + t * 0.65)})`;
        ctx.lineWidth = Math.max(1.5, size * 0.12);
        ctx.shadowColor = rgba(accent, 0.9);
        ctx.shadowBlur = size * 0.6;
        ctx.beginPath();
        for (let k = 0; k < 6; k += 1) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const px = cx + Math.cos(a) * size;
          const py = y + Math.sin(a) * size * (0.25 + t * 0.35);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const scenes = {
    'detailing-hero'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#05070b');
      bg.addColorStop(0.55, '#0b0f16');
      bg.addColorStop(1, '#020203');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const portrait = h > w;
      const horizon = h * (portrait ? 0.46 : 0.42);
      hexGrid(ctx, w, h, horizon, accent, 7);
      // floor glow
      const floor = ctx.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, w * 0.7);
      floor.addColorStop(0, rgba(accent, 0.22));
      floor.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, horizon, w, h - horizon);
      // car (kept inside the centre crop used on phones)
      const cw = w * (portrait ? 0.72 : 0.86);
      const x = (w - cw) / 2;
      const base = h * (portrait ? 0.66 : 0.74);
      ctx.save();
      coupePath(ctx, x, base, cw);
      const body = ctx.createLinearGradient(0, base - cw * 0.35, 0, base);
      body.addColorStop(0, '#1c2129');
      body.addColorStop(0.45, '#0c0f14');
      body.addColorStop(1, '#030405');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.clip();
      // reflections of the hex lights on the body
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i += 1) {
        const y = base - cw * (0.12 + i * 0.03);
        const g = ctx.createLinearGradient(x, 0, x + cw, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.3 + i * 0.05, `rgba(220,232,255,${0.18 - i * 0.015})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = cw * 0.004;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + cw * 0.3, y - cw * 0.03, x + cw * 0.7, y - cw * 0.02, x + cw, y + cw * 0.01);
        ctx.stroke();
      }
      // window
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(30,40,58,0.85)';
      ctx.beginPath();
      const s = cw / 1000;
      ctx.moveTo(x + 330 * s, base - 250 * s);
      ctx.bezierCurveTo(x + 400 * s, base - 310 * s, x + 470 * s, base - 335 * s, x + 560 * s, base - 336 * s);
      ctx.bezierCurveTo(x + 640 * s, base - 336 * s, x + 690 * s, base - 315 * s, x + 745 * s, base - 270 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // highlight along the shoulder line
      ctx.save();
      ctx.shadowColor = rgba(accent, 1);
      ctx.shadowBlur = w * 0.02;
      ctx.strokeStyle = 'rgba(240,246,255,0.9)';
      ctx.lineWidth = w * 0.003;
      const sx = cw / 1000;
      ctx.beginPath();
      ctx.moveTo(x + 80 * sx, base - 200 * sx);
      ctx.bezierCurveTo(x + 300 * sx, base - 238 * sx, x + 650 * sx, base - 265 * sx, x + 975 * sx, base - 210 * sx);
      ctx.stroke();
      ctx.restore();
      wheel(ctx, x + 192 * sx, base - 70 * sx, 88 * sx, accent, 10, 3);
      wheel(ctx, x + 822 * sx, base - 70 * sx, 88 * sx, accent, 10, 4);
      // floor reflection
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.translate(0, base * 2 - 2);
      ctx.scale(1, -1);
      coupePath(ctx, x, base, cw);
      ctx.fillStyle = '#18202c';
      ctx.fill();
      ctx.restore();
      const fade = ctx.createLinearGradient(0, base, 0, h);
      fade.addColorStop(0, 'rgba(2,2,3,0)');
      fade.addColorStop(0.5, 'rgba(2,2,3,0.85)');
      fade.addColorStop(1, 'rgba(2,2,3,1)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, base, w, h - base);
      vignette(ctx, w, h, 0.55);
      grain(ctx, w, h, 10, 11);
    },

    'detailing-polish'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#0d1118');
      bg.addColorStop(1, '#020305');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const r = rng(21);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i += 1) {
        const y0 = h * (0.15 + i * 0.13);
        ctx.shadowColor = i % 2 ? rgba(accent, 0.9) : 'rgba(255,255,255,0.8)';
        ctx.shadowBlur = w * 0.02;
        ctx.strokeStyle = `rgba(255,255,255,${0.75 - i * 0.08})`;
        ctx.lineWidth = w * (0.006 + r() * 0.006);
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, y0);
        ctx.bezierCurveTo(w * 0.3, y0 - h * 0.25, w * 0.6, y0 + h * 0.2, w * 1.1, y0 - h * 0.12);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      // swirl-free half vs hazy half (before/after)
      ctx.fillStyle = 'rgba(160,170,185,0.07)';
      ctx.fillRect(0, 0, w * 0.5, h);
      for (let i = 0; i < 900; i += 1) {
        const cx = r() * w * 0.5;
        const cy = r() * h;
        ctx.strokeStyle = `rgba(220,225,235,${0.04 + r() * 0.05})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + r() * 60, r() * 6, r() * 6 + 0.6);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([w * 0.01, w * 0.01]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
      vignette(ctx, w, h, 0.5);
      grain(ctx, w, h, 8, 22);
    },

    'detailing-ceramic'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, rgba(accent, 0.35));
      bg.addColorStop(0.5, '#0a0e16');
      bg.addColorStop(1, '#030407');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const r = rng(31);
      for (let i = 0; i < 260; i += 1) {
        const x = r() * w;
        const y = r() * h;
        const rad = (r() ** 2) * w * 0.035 + w * 0.004;
        const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.05, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.25, 'rgba(200,220,255,0.35)');
        g.addColorStop(0.85, 'rgba(10,20,40,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rad, rad * (0.85 + r() * 0.15), r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      vignette(ctx, w, h, 0.45);
      grain(ctx, w, h, 8, 32);
    },

    'detailing-interior'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2a1d16');
      bg.addColorStop(1, '#0d0907');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const cell = w / 7;
      for (let gy = -1; gy < h / cell + 1; gy += 1) {
        for (let gx = -1; gx < w / cell + 1; gx += 1) {
          const cx = gx * cell + (gy % 2 ? cell / 2 : 0);
          const cy = gy * cell * 0.6;
          const g = ctx.createRadialGradient(cx - cell * 0.15, cy - cell * 0.1, cell * 0.05, cx, cy, cell * 0.6);
          g.addColorStop(0, 'rgba(120,82,60,0.95)');
          g.addColorStop(1, 'rgba(30,20,15,0.95)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(cx, cy - cell * 0.3);
          ctx.lineTo(cx + cell * 0.5, cy);
          ctx.lineTo(cx, cy + cell * 0.3);
          ctx.lineTo(cx - cell * 0.5, cy);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = rgba(accent, 0.75);
          ctx.setLineDash([cell * 0.04, cell * 0.035]);
          ctx.lineWidth = Math.max(2, cell * 0.012);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const light = ctx.createRadialGradient(w * 0.75, h * 0.2, 10, w * 0.75, h * 0.2, w * 0.8);
      light.addColorStop(0, 'rgba(255,230,200,0.18)');
      light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.6);
      grain(ctx, w, h, 10, 42);
    },

    'detailing-wheel'(ctx, w, h, accent) {
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.7);
      glow.addColorStop(0, rgba(accent, 0.25));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      wheel(ctx, w * 0.5, h * 0.52, Math.min(w, h) * 0.42, accent, 14, 51);
      vignette(ctx, w, h, 0.5);
      grain(ctx, w, h, 8, 52);
    },

    'detailing-foam'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0f1622');
      bg.addColorStop(1, '#04060a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const r = rng(61);
      for (let i = 0; i < 1400; i += 1) {
        const y = h * (0.2 + (r() ** 0.6) * 0.8);
        const x = r() * w;
        const rad = w * (0.004 + r() * 0.02) * (1.2 - y / h);
        ctx.fillStyle = `rgba(245,248,255,${0.25 + r() * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgba(accent, 0.25);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      vignette(ctx, w, h, 0.5);
      grain(ctx, w, h, 8, 62);
    },

    'service-hero'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#120d06');
      bg.addColorStop(0.6, '#0a0806');
      bg.addColorStop(1, '#030202');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // light bars
      for (let i = 0; i < 4; i += 1) {
        const x = w * (0.12 + i * 0.25);
        ctx.save();
        ctx.shadowColor = rgba(accent, 1);
        ctx.shadowBlur = w * 0.03;
        ctx.fillStyle = 'rgba(255,240,215,0.95)';
        ctx.fillRect(x, h * 0.06, w * 0.13, h * 0.012);
        ctx.restore();
        const cone = ctx.createLinearGradient(0, h * 0.07, 0, h * 0.8);
        cone.addColorStop(0, rgba(accent, 0.18));
        cone.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.07);
        ctx.lineTo(x + w * 0.13, h * 0.07);
        ctx.lineTo(x + w * 0.22, h * 0.8);
        ctx.lineTo(x - w * 0.09, h * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      // lift posts
      ctx.fillStyle = '#2b2620';
      ctx.fillRect(w * 0.08, h * 0.25, w * 0.04, h * 0.55);
      ctx.fillRect(w * 0.88, h * 0.25, w * 0.04, h * 0.55);
      ctx.fillStyle = accent;
      ctx.fillRect(w * 0.08, h * 0.25, w * 0.04, h * 0.02);
      ctx.fillRect(w * 0.88, h * 0.25, w * 0.04, h * 0.02);
      // raised car
      const cw = w * (h > w ? 0.66 : 0.72);
      const x = (w - cw) / 2;
      const base = h * (h > w ? 0.5 : 0.52);
      ctx.save();
      coupePath(ctx, x, base, cw);
      const body = ctx.createLinearGradient(0, base - cw * 0.35, 0, base);
      body.addColorStop(0, '#3a332b');
      body.addColorStop(1, '#0d0b09');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.restore();
      const s = cw / 1000;
      ctx.save();
      ctx.shadowColor = rgba(accent, 0.9);
      ctx.shadowBlur = w * 0.015;
      ctx.strokeStyle = 'rgba(255,236,200,0.7)';
      ctx.lineWidth = w * 0.0025;
      ctx.beginPath();
      ctx.moveTo(x + 80 * s, base - 200 * s);
      ctx.bezierCurveTo(x + 300 * s, base - 238 * s, x + 650 * s, base - 265 * s, x + 975 * s, base - 210 * s);
      ctx.stroke();
      ctx.restore();
      wheel(ctx, x + 192 * s, base - 70 * s, 88 * s, accent, 6, 71);
      wheel(ctx, x + 822 * s, base - 70 * s, 88 * s, accent, 6, 72);
      // lift arms
      ctx.fillStyle = '#3c352d';
      ctx.fillRect(w * 0.12, base + h * 0.005, w * 0.76, h * 0.012);
      // floor markings
      ctx.strokeStyle = rgba(accent, 0.5);
      ctx.lineWidth = w * 0.006;
      ctx.setLineDash([w * 0.03, w * 0.02]);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.86);
      ctx.lineTo(w, h * 0.86);
      ctx.stroke();
      ctx.setLineDash([]);
      vignette(ctx, w, h, 0.55);
      grain(ctx, w, h, 12, 73);
    },

    'service-brakes'(ctx, w, h, accent) {
      ctx.fillStyle = '#060504';
      ctx.fillRect(0, 0, w, h);
      const cx = w * 0.5;
      const cy = h * 0.5;
      const R = Math.min(w, h) * 0.42;
      const disc = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
      disc.addColorStop(0, '#b9b4ac');
      disc.addColorStop(0.6, '#6d6862');
      disc.addColorStop(1, '#2a2723');
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      const r = rng(81);
      for (let i = 0; i < 160; i += 1) {
        ctx.strokeStyle = `rgba(30,28,25,${0.08 + r() * 0.12})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.45 + r() * 0.54), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let ring = 0; ring < 3; ring += 1) {
        for (let i = 0; i < 18; i += 1) {
          const a = (i / 18) * Math.PI * 2 + ring * 0.12;
          const rr = R * (0.58 + ring * 0.12);
          ctx.fillStyle = '#141210';
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * 0.022, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#25221e';
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(cx + R * 0.72, cy - R * 0.28, R * 0.2, R * 0.42, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.font = `bold ${R * 0.1}px sans-serif`;
      vignette(ctx, w, h, 0.5);
      grain(ctx, w, h, 10, 82);
    },

    'service-tire'(ctx, w, h, accent) {
      ctx.fillStyle = '#090807';
      ctx.fillRect(0, 0, w, h);
      const r = rng(91);
      const bw = w / 6;
      for (let col = -1; col < 7; col += 1) {
        for (let row = -1; row < h / (bw * 0.6) + 1; row += 1) {
          const x = col * bw + (row % 2 ? bw * 0.5 : 0);
          const y = row * bw * 0.6;
          const g = ctx.createLinearGradient(x, y, x + bw, y + bw * 0.5);
          g.addColorStop(0, '#2c2a27');
          g.addColorStop(1, '#151413');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x + bw * 0.1, y);
          ctx.lineTo(x + bw * 0.85, y + bw * 0.08);
          ctx.lineTo(x + bw * 0.75, y + bw * 0.5);
          ctx.lineTo(x, y + bw * 0.42);
          ctx.closePath();
          ctx.fill();
        }
      }
      const light = ctx.createLinearGradient(0, 0, w, 0);
      light.addColorStop(0, 'rgba(0,0,0,0)');
      light.addColorStop(0.5, rgba(accent, 0.18));
      light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i += 1) {
        ctx.fillStyle = `rgba(200,190,170,${r() * 0.06})`;
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
      vignette(ctx, w, h, 0.55);
      grain(ctx, w, h, 10, 92);
    },

    'service-alignment'(ctx, w, h, accent) {
      ctx.fillStyle = '#070605';
      ctx.fillRect(0, 0, w, h);
      wheel(ctx, w * 0.32, h * 0.55, Math.min(w, h) * 0.3, accent, 5, 101);
      ctx.save();
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = w * 0.02;
      ctx.strokeStyle = 'rgba(255,80,60,0.95)';
      ctx.lineWidth = w * 0.004;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(w * 0.32, h * (0.35 + i * 0.2));
        ctx.lineTo(w, h * (0.3 + i * 0.22));
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = rgba(accent, 0.8);
      ctx.lineWidth = w * 0.004;
      ctx.strokeRect(w * 0.66, h * 0.18, w * 0.26, h * 0.3);
      ctx.fillStyle = rgba(accent, 0.15);
      ctx.fillRect(w * 0.66, h * 0.18, w * 0.26, h * 0.3);
      vignette(ctx, w, h, 0.5);
      grain(ctx, w, h, 10, 102);
    },

    'service-oil'(ctx, w, h, accent) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0d0a06');
      bg.addColorStop(1, '#030201');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      const stream = ctx.createLinearGradient(w * 0.45, 0, w * 0.55, 0);
      stream.addColorStop(0, 'rgba(120,70,0,0.2)');
      stream.addColorStop(0.5, rgba(accent, 0.95));
      stream.addColorStop(1, 'rgba(120,70,0,0.2)');
      ctx.fillStyle = stream;
      ctx.shadowColor = rgba(accent, 0.9);
      ctx.shadowBlur = w * 0.04;
      ctx.beginPath();
      ctx.moveTo(w * 0.47, 0);
      ctx.bezierCurveTo(w * 0.46, h * 0.4, w * 0.5, h * 0.6, w * 0.49, h * 0.78);
      ctx.lineTo(w * 0.52, h * 0.78);
      ctx.bezierCurveTo(w * 0.53, h * 0.6, w * 0.51, h * 0.4, w * 0.53, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const pool = ctx.createRadialGradient(w * 0.5, h * 0.82, 5, w * 0.5, h * 0.82, w * 0.35);
      pool.addColorStop(0, rgba(accent, 0.8));
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.82, w * 0.35, h * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      vignette(ctx, w, h, 0.55);
      grain(ctx, w, h, 10, 112);
    },

    logo(ctx, w, h, accent, opts) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = w * 0.36;
      ctx.save();
      ctx.shadowColor = rgba(accent, 0.8);
      ctx.shadowBlur = w * 0.05;
      ctx.strokeStyle = accent;
      ctx.lineWidth = w * 0.045;
      ctx.beginPath();
      const sides = opts.shape === 'hex' ? 6 : 8;
      for (let k = 0; k <= sides; k += 1) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / sides;
        const px = cx + Math.cos(a) * R;
        const py = cy + Math.sin(a) * R;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${w * 0.32}px "DejaVu Sans", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.text, cx, cy + w * 0.015);
    },
  };

  window.renderScene = function renderScene(name, w, h, accent, opts) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    scenes[name](ctx, w, h, accent, opts || {});
    return canvas.toDataURL('image/png');
  };
})();
