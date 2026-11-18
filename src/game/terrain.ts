import { StagePalette } from './types';

export interface BiomePatterns {
  snowPattern: CanvasPattern | null;
  stonePattern: CanvasPattern | null;
}

/**
 * Generates high-resolution, tileable offscreen textures for each biome so the snowfield
 * looks lush, tactile, and modern at Retina/4K DPI with virtually zero per-frame cost.
 */
export function createBiomePatterns(
  ctx: CanvasRenderingContext2D,
  palette: StagePalette
): BiomePatterns {
  // 1. High-res tileable snow texture (256x256) with soft sculpted drifts & ice sparkles
  const snowCanvas = document.createElement('canvas');
  snowCanvas.width = 256;
  snowCanvas.height = 256;
  const sctx = snowCanvas.getContext('2d')!;

  sctx.fillStyle = palette.snowBase;
  sctx.fillRect(0, 0, 256, 256);

  // Soft undulating snowdrift patches (wrapped across edges for seamless tiling)
  const patches = [
    { x: 42, y: 50, rx: 68, ry: 34, a: 0.25 },
    { x: 185, y: 120, rx: 74, ry: 40, a: -0.2 },
    { x: 96, y: 205, rx: 64, ry: 30, a: 0.15 },
    { x: 220, y: 30, rx: 52, ry: 28, a: -0.3 },
    { x: 20, y: 170, rx: 58, ry: 32, a: 0.22 },
  ];
  for (const p of patches) {
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        const cx = p.x + ox;
        const cy = p.y + oy;
        if (cx < -100 || cx > 356 || cy < -100 || cy > 356) continue;
        sctx.save();
        sctx.translate(cx, cy);
        sctx.rotate(p.a);
        const grad = sctx.createRadialGradient(0, 0, 4, 0, 0, p.rx);
        grad.addColorStop(0, palette.snowMid);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        sctx.globalAlpha = 0.52;
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        sctx.fill();
        sctx.restore();
      }
    }
  }

  // Subtle sculpted shadow crescents & sunlit snow crests
  sctx.lineWidth = 2.2;
  sctx.lineCap = 'round';
  const crests = [
    [32, 88, 38],
    [148, 44, 44],
    [202, 188, 36],
    [76, 165, 30],
    [134, 232, 34],
  ];
  for (const [x, y, r] of crests) {
    sctx.strokeStyle = palette.snowShadow;
    sctx.globalAlpha = 0.26;
    sctx.beginPath();
    sctx.arc(x, y, r, 0.35, 1.65);
    sctx.stroke();

    sctx.strokeStyle = '#ffffff';
    sctx.globalAlpha = 0.55;
    sctx.beginPath();
    sctx.arc(x - 1.5, y - 2, r, 0.4, 1.55);
    sctx.stroke();
  }

  // Fine crystalline snow sparkles
  sctx.globalAlpha = 0.7;
  for (let i = 0; i < 42; i++) {
    const sx = (i * 73 + 19) % 256;
    const sy = (i * 137 + 41) % 256;
    const r = i % 5 === 0 ? 1.8 : 1.1;
    sctx.fillStyle = i % 4 === 0 ? '#ffffff' : palette.snowShadow;
    sctx.globalAlpha = i % 4 === 0 ? 0.78 : 0.22;
    sctx.beginPath();
    sctx.arc(sx, sy, r, 0, Math.PI * 2);
    sctx.fill();
  }

  // 2. Warm cobblestone camp courtyard texture (128x128) for Tier 2+ settlements
  const stoneCanvas = document.createElement('canvas');
  stoneCanvas.width = 128;
  stoneCanvas.height = 128;
  const stctx = stoneCanvas.getContext('2d')!;
  stctx.fillStyle = '#9aa8b8';
  stctx.fillRect(0, 0, 128, 128);

  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : 16;
    for (let col = -1; col < 5; col++) {
      const bx = col * 32 + offset + 2;
      const by = row * 32 + 2;
      const shade = ((row * 7 + col * 13) & 3) * 8;
      stctx.fillStyle = `rgb(${168 + shade}, ${178 + shade}, ${190 + shade})`;
      stctx.beginPath();
      stctx.roundRect(bx, by, 28, 28, 6);
      stctx.fill();
      // Top bevel highlight
      stctx.strokeStyle = 'rgba(255,255,255,0.28)';
      stctx.lineWidth = 1.5;
      stctx.beginPath();
      stctx.moveTo(bx + 5, by + 2);
      stctx.lineTo(bx + 23, by + 2);
      stctx.stroke();
    }
  }

  return {
    snowPattern: ctx.createPattern(snowCanvas, 'repeat'),
    stonePattern: ctx.createPattern(stoneCanvas, 'repeat'),
  };
}
