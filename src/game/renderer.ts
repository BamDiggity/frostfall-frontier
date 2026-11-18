import { GameEngine, ZONE_RADII } from './engine';
import {
  BuildingState,
  CustomerEntity,
  HOMESTEAD_TIERS,
  RESOURCE_META,
  ResourceNode,
  ResourceType,
  WildlifeEntity,
  WorkerEntity,
} from './types';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export class GameRenderer {
  public render(ctx: CanvasRenderingContext2D, engine: GameEngine, width: number, height: number): void {
    const pal = engine.stage.palette;
    const t = engine.elapsedTime;

    // Camera transform with subtle screen-shake
    const shakeX = engine.camera.shake > 0 ? (Math.random() - 0.5) * engine.camera.shake * 2 : 0;
    const shakeY = engine.camera.shake > 0 ? (Math.random() - 0.5) * engine.camera.shake * 2 : 0;
    const zoom = Math.min(1.12, Math.max(0.76, Math.min(width, height) / 560));

    ctx.save();
    // Base snow fill
    ctx.fillStyle = pal.snowBase;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
    ctx.scale(zoom, zoom);
    ctx.translate(-engine.camera.x, -engine.camera.y);

    // 1. Ground biome rings, snowdrifts, camp roads & warmth glow
    this.drawGround(ctx, engine, t);

    // 2. Footprints
    for (const fp of engine.footprints) {
      ctx.save();
      ctx.translate(fp.x, fp.y);
      ctx.rotate(fp.angle);
      ctx.fillStyle = `rgba(110, 145, 178, ${Math.min(0.32, fp.life * 0.08)})`;
      ctx.beginPath();
      ctx.ellipse(-2, -3, 3.5, 2, 0, 0, Math.PI * 2);
      ctx.ellipse(2, 3, 3.5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Building ground pads & warmth rings
    this.drawBuildingPads(ctx, engine, t);

    // 4. Wildlife attack telegraphs (under entities)
    for (const w of engine.wildlife) {
      if (w.state === 'windup') {
        const pct = 1 - Math.max(0, w.telegraphTimer / 0.72);
        const r = w.radius + 26;
        ctx.save();
        ctx.beginPath();
        ctx.arc(w.telegraphX, w.telegraphY, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.14 + pct * 0.25})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w.telegraphX, w.telegraphY, r * pct, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.fill();
        ctx.restore();
      }
    }

    // 5. Depth-sorted world entities (nodes, buildings, wildlife, workers, customers, player)
    type DrawItem = { y: number; draw: () => void };
    const drawList: DrawItem[] = [];
    const unlockedZone = engine.getUnlockedZone();

    for (const n of engine.nodes) {
      if (n.respawnTimer > 0) {
        drawList.push({ y: n.y, draw: () => this.drawStump(ctx, n) });
      } else {
        const locked = n.zone > unlockedZone;
        drawList.push({ y: n.y, draw: () => this.drawResourceNode(ctx, n, pal, t, locked) });
      }
    }

    for (const b of engine.buildings) {
      if (b.zoneRequired <= unlockedZone) {
        drawList.push({ y: b.y + 8, draw: () => this.drawBuilding(ctx, b, t) });
      }
    }

    for (const w of engine.wildlife) {
      if (w.state !== 'dead' && w.zone <= unlockedZone) {
        drawList.push({ y: w.y, draw: () => this.drawWildlife(ctx, w, t) });
      }
    }

    for (const wk of engine.workers) {
      drawList.push({ y: wk.y, draw: () => this.drawWorker(ctx, wk) });
    }

    for (const c of engine.customers) {
      drawList.push({ y: c.y, draw: () => this.drawCustomer(ctx, c, t) });
    }

    drawList.push({ y: engine.player.y, draw: () => this.drawPlayer(ctx, engine) });

    drawList.sort((a, b) => a.y - b.y);
    for (const item of drawList) item.draw();

    // 6. Flying resource arcs
    for (const f of engine.flyingItems) {
      const p = Math.min(1, f.progress);
      const x = f.startX + (f.targetX - f.startX) * p;
      const y = f.startY + (f.targetY - f.startY) * p - Math.sin(p * Math.PI) * f.arcHeight;
      this.drawResourceToken(ctx, x, y, f.resource, 9);
    }

    // 7. Particles
    for (const pt of engine.particles) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 8. Locked-zone frosted mist ring & Thaw Wave effect
    this.drawZoneFrontierWall(ctx, engine, t);

    // 9. Building floating cost/status tags (above mist & buildings)
    this.drawBuildingBadges(ctx, engine);

    // 10. Floating popups
    for (const ft of engine.floatingTexts) {
      const alpha = Math.min(1, (ft.life / ft.maxLife) * 1.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${Math.round(14 * ft.scale)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(10, 20, 35, 0.85)';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    ctx.restore();

    // ==================== SCREEN-SPACE OVERLAYS ====================

    // Aurora Borealis shimmer in Regions 4 & 5
    if (pal.auroraColors) {
      const [c1, c2] = pal.auroraColors;
      const grad = ctx.createLinearGradient(0, 0, width, height * 0.42);
      const shift = 0.5 + 0.5 * Math.sin(t * 0.6);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.45 + shift * 0.15, c2);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height * 0.48);
    }

    // Falling snow / Blizzard overlay
    const bliz = engine.blizzard.intensity;
    ctx.save();
    for (const f of engine.snowFlakes) {
      const sx = f.x * width;
      const sy = f.y * height;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.55 + bliz * 0.35})`;
      if (bliz > 0.25) {
        ctx.strokeStyle = `rgba(235, 248, 255, ${0.4 + bliz * 0.45})`;
        ctx.lineWidth = f.r * 0.75;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 10 * bliz, sy - 6 * bliz);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Cold / frost vignette when warmth drops low or blizzard rages
    const coldFactor = Math.max(bliz * 0.45, engine.player.warmth < 45 ? (45 - engine.player.warmth) / 45 : 0);
    if (coldFactor > 0.03) {
      const vig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.34,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72
      );
      vig.addColorStop(0, 'rgba(147, 215, 255, 0)');
      vig.addColorStop(1, `rgba(110, 195, 255, ${Math.min(0.52, coldFactor * 0.55)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }

    // Hurt red flash
    if (engine.player.hurtFlash > 0) {
      ctx.fillStyle = `rgba(239, 68, 68, ${engine.player.hurtFlash * 0.28})`;
      ctx.fillRect(0, 0, width, height);
    }

    // On-screen virtual joystick visual when touch-dragging
    if (engine.joystick.active) {
      const j = engine.joystick;
      const dx = j.currentX - j.originX;
      const dy = j.currentY - j.originY;
      const d = Math.hypot(dx, dy);
      const clamp = Math.min(52, d);
      const kx = d > 1 ? j.originX + (dx / d) * clamp : j.originX;
      const ky = d > 1 ? j.originY + (dy / d) * clamp : j.originY;

      ctx.save();
      ctx.beginPath();
      ctx.arc(j.originX, j.originY, 54, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 28, 46, 0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(kx, ky, 23, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const pal = engine.stage.palette;

    // Subtle concentric snow terrain rings
    for (let z = 4; z >= 1; z--) {
      ctx.beginPath();
      ctx.arc(0, 0, ZONE_RADII[z], 0, Math.PI * 2);
      ctx.fillStyle = z % 2 === 0 ? pal.snowMid : pal.snowBase;
      ctx.fill();
    }

    // Soft snowdrift curves
    ctx.strokeStyle = pal.snowShadow;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 18; i++) {
      const a = i * 0.95;
      const r = 180 + (i % 5) * 210;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0.2, 1.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Packed snow / cobblestone camp paths connecting active buildings
    const unlockedZone = engine.getUnlockedZone();
    ctx.save();
    ctx.strokeStyle = engine.homesteadTier >= 3 ? 'rgba(156, 169, 184, 0.45)' : 'rgba(196, 175, 148, 0.35)';
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone || b.kind === 'furnace') continue;
      ctx.beginPath();
      ctx.moveTo(0, 55);
      ctx.lineTo(b.x, b.y + 18);
      ctx.stroke();
    }
    ctx.restore();

    // Central thawed hearth ground glow around Furnace!
    const furnace = engine.buildings.find((b) => b.kind === 'furnace');
    if (furnace) {
      const warmR = engine.getFurnaceRadius();
      const pulse = 1 + Math.sin(t * 4.2) * 0.035;
      const grad = ctx.createRadialGradient(furnace.x, furnace.y, 14, furnace.x, furnace.y, warmR * pulse);
      grad.addColorStop(0, 'rgba(255, 168, 66, 0.42)');
      grad.addColorStop(0.45, 'rgba(255, 196, 112, 0.16)');
      grad.addColorStop(0.88, 'rgba(255, 224, 168, 0.05)');
      grad.addColorStop(1, 'rgba(255, 224, 168, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(furnace.x, furnace.y, warmR * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Subtle dashed warmth edge ring
      ctx.save();
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(255, 165, 70, 0.32)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(furnace.x, furnace.y, warmR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBuildingPads(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const unlockedZone = engine.getUnlockedZone();
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone) continue;

      const isUpgradeable = b.level < b.maxLevel && (b.kind === 'homestead' || b.level === 0);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);

      ctx.save();
      // Ground shadow / pad ring
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 12, b.radius + 10, (b.radius + 10) * 0.68, 0, 0, Math.PI * 2);

      if (b.level === 0) {
        ctx.fillStyle = `rgba(56, 189, 248, ${0.12 + pulse * 0.1})`;
        ctx.fill();
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = `rgba(14, 165, 233, ${0.65 + pulse * 0.3})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (b.kind === 'trading_post') {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.16)';
        ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.72)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (isUpgradeable) {
        ctx.fillStyle = `rgba(251, 191, 36, ${0.11 + pulse * 0.08})`;
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.6 + pulse * 0.35})`;
        ctx.lineWidth = 2.8;
        ctx.stroke();
      } else if (b.outputType) {
        ctx.fillStyle = 'rgba(134, 239, 172, 0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    const bounce = b.bounceAnim > 0 ? 1 + Math.sin(b.bounceAnim * Math.PI * 4) * 0.12 * b.bounceAnim : 1;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(bounce, 2 - bounce);

    // Contact shadow
    ctx.fillStyle = 'rgba(18, 36, 58, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 14, b.radius * 0.9, b.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (b.kind === 'homestead') {
      this.drawHomestead(ctx, b.level, t);
    } else if (b.kind === 'furnace') {
      this.drawFurnace(ctx, b, t);
    } else if (b.kind === 'trading_post') {
      this.drawTradingPost(ctx, b.level);
    } else if (b.level === 0) {
      this.drawConstructionPlot(ctx, b);
    } else {
      this.drawBusinessBuilding(ctx, b, t);
    }

    ctx.restore();
  }

  private drawHomestead(ctx: CanvasRenderingContext2D, tier: number, t: number): void {
    if (tier === 0) {
      // Tier 0: Cozy Snow Tent + Foundation Stakes
      ctx.fillStyle = '#c88d55';
      roundedRect(ctx, -34, -4, 68, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#e06d53';
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(-28, 12);
      ctx.lineTo(28, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3b2418';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-9, 12);
      ctx.lineTo(9, 12);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (tier === 1) {
      // Tier 1: Timber Hut
      ctx.fillStyle = '#8b5a2b';
      roundedRect(ctx, -30, -14, 60, 32, 6);
      ctx.fill();
      // Roof
      ctx.fillStyle = '#5c3a21';
      ctx.beginPath();
      ctx.moveTo(0, -44);
      ctx.lineTo(-38, -8);
      ctx.lineTo(38, -8);
      ctx.closePath();
      ctx.fill();
      // Snow cap
      ctx.fillStyle = '#f8fbff';
      ctx.beginPath();
      ctx.moveTo(0, -45);
      ctx.lineTo(-32, -16);
      ctx.quadraticCurveTo(0, -24, 32, -16);
      ctx.closePath();
      ctx.fill();
      // Door & warm window
      ctx.fillStyle = '#4a2b14';
      roundedRect(ctx, -7, 0, 14, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#ffcf56';
      roundedRect(ctx, 13, -4, 10, 10, 2);
      ctx.fill();
      return;
    }

    if (tier === 2) {
      // Tier 2: Log Cabin (porch + chimney + twin glowing windows)
      ctx.fillStyle = '#7c4d25';
      roundedRect(ctx, -40, -18, 80, 38, 6);
      ctx.fill();
      // Log lines
      ctx.strokeStyle = '#5b3617';
      ctx.lineWidth = 2;
      for (let y = -10; y <= 14; y += 8) {
        ctx.beginPath();
        ctx.moveTo(-39, y);
        ctx.lineTo(39, y);
        ctx.stroke();
      }
      // Stone chimney + smoke
      ctx.fillStyle = '#64748b';
      roundedRect(ctx, 18, -52, 12, 26, 2);
      ctx.fill();
      this.drawSmokePuff(ctx, 24, -56, t);
      // Gable roof
      ctx.fillStyle = '#9e3a2b';
      ctx.beginPath();
      ctx.moveTo(0, -52);
      ctx.lineTo(-48, -12);
      ctx.lineTo(48, -12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f8fbff';
      ctx.beginPath();
      ctx.moveTo(0, -53);
      ctx.lineTo(-40, -20);
      ctx.quadraticCurveTo(0, -28, 40, -20);
      ctx.closePath();
      ctx.fill();
      // Door & windows
      ctx.fillStyle = '#3f220e';
      roundedRect(ctx, -8, 0, 16, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#ffd966';
      roundedRect(ctx, -30, -6, 13, 12, 2);
      ctx.fill();
      roundedRect(ctx, 17, -6, 13, 12, 2);
      ctx.fill();
      return;
    }

    if (tier === 3) {
      // Tier 3: Stone House (two-story chalet)
      ctx.fillStyle = '#94a3b8';
      roundedRect(ctx, -44, -28, 88, 48, 6);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      roundedRect(ctx, -44, 6, 88, 14, 4);
      ctx.fill();
      // Timber trim
      ctx.strokeStyle = '#5c3a21';
      ctx.lineWidth = 3;
      ctx.strokeRect(-43, -27, 86, 46);
      // Chimney
      ctx.fillStyle = '#475569';
      roundedRect(ctx, 22, -62, 13, 28, 2);
      ctx.fill();
      this.drawSmokePuff(ctx, 28, -66, t);
      // Steep slate roof
      ctx.fillStyle = '#2c4a6e';
      ctx.beginPath();
      ctx.moveTo(0, -64);
      ctx.lineTo(-54, -20);
      ctx.lineTo(54, -20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1f8ff';
      ctx.beginPath();
      ctx.moveTo(0, -65);
      ctx.lineTo(-45, -28);
      ctx.quadraticCurveTo(0, -36, 45, -28);
      ctx.closePath();
      ctx.fill();
      // Arched door & 4 warm windows
      ctx.fillStyle = '#4a2b14';
      roundedRect(ctx, -9, -1, 18, 21, 7);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      roundedRect(ctx, -33, -18, 13, 12, 3);
      ctx.fill();
      roundedRect(ctx, 20, -18, 13, 12, 3);
      ctx.fill();
      roundedRect(ctx, -33, 1, 13, 11, 3);
      ctx.fill();
      roundedRect(ctx, 20, 1, 13, 11, 3);
      ctx.fill();
      return;
    }

    if (tier === 4) {
      // Tier 4: Grand Mansion (twin wings + golden accents)
      // Wings
      ctx.fillStyle = '#cbd5e1';
      roundedRect(ctx, -58, -22, 116, 42, 6);
      ctx.fill();
      // Center block
      ctx.fillStyle = '#e2e8f0';
      roundedRect(ctx, -32, -38, 64, 58, 6);
      ctx.fill();
      // Wing roofs
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.moveTo(-42, -46);
      ctx.lineTo(-64, -18);
      ctx.lineTo(-22, -18);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(42, -46);
      ctx.lineTo(22, -18);
      ctx.lineTo(64, -18);
      ctx.closePath();
      ctx.fill();
      // Main grand roof
      ctx.fillStyle = '#991b1b';
      ctx.beginPath();
      ctx.moveTo(0, -72);
      ctx.lineTo(-42, -30);
      ctx.lineTo(42, -30);
      ctx.closePath();
      ctx.fill();
      // Snow trim
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -73);
      ctx.lineTo(-34, -38);
      ctx.quadraticCurveTo(0, -44, 34, -38);
      ctx.closePath();
      ctx.fill();
      // Smoke
      this.drawSmokePuff(ctx, -40, -52, t);
      this.drawSmokePuff(ctx, 40, -52, t + 1.5);
      // Grand golden doorway & windows
      ctx.fillStyle = '#f59e0b';
      roundedRect(ctx, -12, -4, 24, 24, 9);
      ctx.fill();
      ctx.fillStyle = '#451a03';
      roundedRect(ctx, -9, -1, 18, 21, 7);
      ctx.fill();
      ctx.fillStyle = '#fde047';
      for (const wx of [-48, -22, 10, 36]) {
        roundedRect(ctx, wx, -12, 12, 14, 3);
        ctx.fill();
      }
      roundedRect(ctx, -10, -28, 20, 14, 5);
      ctx.fill();
      return;
    }

    // Tier 5: Majestic Frontier Town Hall with Clocktower & Waving Banner!
    ctx.fillStyle = '#e2e8f0';
    roundedRect(ctx, -62, -26, 124, 46, 7);
    ctx.fill();
    // Columns
    ctx.fillStyle = '#f8fafc';
    for (const cx of [-48, -28, 22, 42]) {
      roundedRect(ctx, cx, -24, 7, 42, 2);
      ctx.fill();
    }
    // Lower royal roof
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath();
    ctx.moveTo(0, -58);
    ctx.lineTo(-68, -22);
    ctx.lineTo(68, -22);
    ctx.closePath();
    ctx.fill();
    // Central Clocktower
    ctx.fillStyle = '#f1f5f9';
    roundedRect(ctx, -20, -76, 40, 50, 5);
    ctx.fill();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(0, -108);
    ctx.lineTo(-26, -72);
    ctx.lineTo(26, -72);
    ctx.closePath();
    ctx.fill();
    // Golden spire & waving flag
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -108);
    ctx.lineTo(0, -126);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(0, -125);
    ctx.lineTo(18, -120 + Math.sin(t * 6) * 2.5);
    ctx.lineTo(0, -114);
    ctx.closePath();
    ctx.fill();
    // Golden clock face
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, -56, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -56);
    ctx.lineTo(0, -63);
    ctx.moveTo(0, -56);
    ctx.lineTo(5, -56);
    ctx.stroke();
    // Grand doorway
    ctx.fillStyle = '#f59e0b';
    roundedRect(ctx, -14, -6, 28, 26, 10);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    roundedRect(ctx, -10, -2, 20, 22, 8);
    ctx.fill();
  }

  private drawFurnace(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    // Iron furnace tower
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, 4, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#475569';
    roundedRect(ctx, -17, -26, 34, 32, 8);
    ctx.fill();
    // Chimney crown
    ctx.fillStyle = '#1e293b';
    roundedRect(ctx, -11, -40, 22, 16, 4);
    ctx.fill();

    // Roaring fire core scaled by fuel!
    const fRatio = Math.max(0.2, b.fuel / b.maxFuel);
    const flicker = 1 + Math.sin(t * 14) * 0.14;
    ctx.fillStyle = '#ff6b00';
    ctx.beginPath();
    ctx.arc(0, -6, 11 * fRatio * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(0, -5, 6.5 * fRatio * flicker, 0, Math.PI * 2);
    ctx.fill();

    // Top flame plume
    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.moveTo(-7 * fRatio, -38);
    ctx.quadraticCurveTo(0, -56 * fRatio * flicker, 7 * fRatio, -38);
    ctx.fill();

    // Compact fuel bar beneath furnace
    const bw = 38;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    roundedRect(ctx, -bw / 2, 18, bw, 6, 3);
    ctx.fill();
    ctx.fillStyle = b.fuel > 35 ? '#fb923c' : '#ef4444';
    roundedRect(ctx, -bw / 2 + 1, 19, (bw - 2) * (b.fuel / b.maxFuel), 4, 2);
    ctx.fill();
  }

  private drawTradingPost(ctx: CanvasRenderingContext2D, level: number): void {
    // Wooden stall & cargo sled
    ctx.fillStyle = '#8b5a2b';
    roundedRect(ctx, -30, -8, 60, 24, 5);
    ctx.fill();
    // Striped red & cream market awning
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#dc2626' : '#fef3c7';
      ctx.fillRect(-33 + i * 11, -28, 11, 18);
    }
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 2;
    ctx.strokeRect(-33, -28, 66, 18);
    // Gold coin emblem on roof
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(0, -34, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#78350f';
    ctx.font = '800 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('$', 0, -30);
    if (level > 1) {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 9px system-ui';
      ctx.fillText(`Lv.${level}`, 0, 10);
    }
  }

  private drawConstructionPlot(ctx: CanvasRenderingContext2D, b: BuildingState): void {
    ctx.fillStyle = 'rgba(139, 90, 43, 0.7)';
    roundedRect(ctx, -26, -12, 52, 24, 5);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-24, -10, 48, 20);
    // Hammer icon
    ctx.font = '18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('🔨', 0, 6);
    ctx.font = '700 10px system-ui';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(b.name, 0, 28);
  }

  private drawBusinessBuilding(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    const roofColors: Record<string, string> = {
      sawmill: '#b45309',
      hunters_lodge: '#15803d',
      smeltery: '#475569',
      tannery: '#9a3412',
      tavern: '#c2410c',
      artisan_guild: '#6d28d9',
      explorers_guild: '#0284c7',
    };
    const wallColors: Record<string, string> = {
      sawmill: '#a16207',
      hunters_lodge: '#784c2a',
      smeltery: '#64748b',
      tannery: '#92400e',
      tavern: '#9a5b32',
      artisan_guild: '#cbd5e1',
      explorers_guild: '#e2e8f0',
    };

    const roof = roofColors[b.kind] || '#334155';
    const wall = wallColors[b.kind] || '#64748b';

    // Main body
    ctx.fillStyle = wall;
    roundedRect(ctx, -32, -16, 64, 34, 6);
    ctx.fill();
    // Roof
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.lineTo(-39, -12);
    ctx.lineTo(39, -12);
    ctx.closePath();
    ctx.fill();
    // Snow cap
    ctx.fillStyle = '#f8fbff';
    ctx.beginPath();
    ctx.moveTo(0, -47);
    ctx.lineTo(-31, -20);
    ctx.quadraticCurveTo(0, -26, 31, -20);
    ctx.closePath();
    ctx.fill();

    // Warm glowing window
    ctx.fillStyle = '#fde047';
    roundedRect(ctx, -22, -4, 12, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#451a03';
    roundedRect(ctx, -6, 0, 13, 18, 3);
    ctx.fill();

    // Signature visual accent per business
    if (b.kind === 'sawmill') {
      ctx.save();
      ctx.translate(22, 4);
      ctx.rotate(t * 5);
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else if (b.kind === 'artisan_guild') {
      const bob = Math.sin(t * 3.5) * 4;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, -64 + bob);
      ctx.lineTo(-8, -52 + bob);
      ctx.lineTo(0, -44 + bob);
      ctx.lineTo(8, -52 + bob);
      ctx.closePath();
      ctx.fill();
    } else if (b.kind === 'explorers_guild') {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(0, -54, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🧭', 0, -50);
    } else if (b.kind === 'smeltery' || b.kind === 'tavern') {
      this.drawSmokePuff(ctx, 18, -48, t);
    }

    // Output stock stack pill if items ready to collect!
    if (b.outputType && b.outputStock > 0) {
      const meta = RESOURCE_META[b.outputType];
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      roundedRect(ctx, 16, -34, 34, 20, 8);
      ctx.fill();
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${meta.icon}${b.outputStock}`, 33, -20);
    }

    // Crafting progress bar
    if (b.processTimer > 0 && b.processDuration > 0) {
      const pct = Math.min(1, b.processTimer / b.processDuration);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      roundedRect(ctx, -24, 20, 48, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      roundedRect(ctx, -23, 21, 46 * pct, 4, 2);
      ctx.fill();
    }
  }

  private drawSmokePuff(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.55 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(241, 245, 249, ${(1 - p) * 0.55})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(p * 5 + i) * 5, y - p * 26, 4 + p * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStump(ctx: CanvasRenderingContext2D, n: ResourceNode): void {
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.fillStyle = n.kind === 'pine' || n.kind === 'ancient_pine' ? '#7c4d25' : '#64748b';
    ctx.beginPath();
    ctx.ellipse(0, 2, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Subtle respawn progress ring
    const pct = 1 - n.respawnTimer / n.respawnDuration;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 2, 11, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawResourceNode(
    ctx: CanvasRenderingContext2D,
    n: ResourceNode,
    pal: { pineLight: string; pineDark: string; rockColor: string },
    t: number,
    locked: boolean
  ): void {
    const shake = n.shakeTimer > 0 ? Math.sin(n.shakeTimer * 48) * 4.5 : 0;
    const sway = (n.kind === 'pine' || n.kind === 'ancient_pine') ? Math.sin(t * 2 + n.x * 0.05) * 1.5 : 0;

    ctx.save();
    ctx.translate(n.x + shake, n.y);
    ctx.scale(n.scale, n.scale);
    if (locked) ctx.globalAlpha = 0.45;

    // Ground shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 17, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (n.kind === 'pine' || n.kind === 'ancient_pine') {
      const isAncient = n.kind === 'ancient_pine';
      // Trunk
      ctx.fillStyle = '#6b4226';
      roundedRect(ctx, -5, -6, 10, 14, 2);
      ctx.fill();
      // 3 snowy evergreen tiers
      const tiers = isAncient ? 4 : 3;
      for (let i = 0; i < tiers; i++) {
        const yOff = -8 - i * 11;
        const w = (isAncient ? 25 : 21) - i * 4.5;
        ctx.fillStyle = i % 2 === 0 ? pal.pineDark : pal.pineLight;
        ctx.beginPath();
        ctx.moveTo(sway * (i + 1) * 0.4, yOff - 18);
        ctx.lineTo(-w, yOff + 4);
        ctx.lineTo(w, yOff + 4);
        ctx.closePath();
        ctx.fill();
        // Snow dusting on branches
        ctx.fillStyle = '#f8fbff';
        ctx.beginPath();
        ctx.moveTo(sway * (i + 1) * 0.4, yOff - 19);
        ctx.lineTo(-w * 0.62, yOff - 5);
        ctx.quadraticCurveTo(0, yOff - 9, w * 0.62, yOff - 5);
        ctx.closePath();
        ctx.fill();
      }
      if (isAncient) {
        // Golden ancient sap glow
        ctx.fillStyle = 'rgba(250, 204, 21, 0.65)';
        ctx.beginPath();
        ctx.arc(0, -14, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (n.kind === 'coal_vein' || n.kind === 'iron_vein') {
      const isIron = n.kind === 'iron_vein';
      ctx.fillStyle = pal.rockColor;
      ctx.beginPath();
      ctx.moveTo(-19, 6);
      ctx.lineTo(-14, -14);
      ctx.lineTo(2, -20);
      ctx.lineTo(18, -10);
      ctx.lineTo(20, 6);
      ctx.closePath();
      ctx.fill();
      // Highlight facet
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(-14, -14);
      ctx.lineTo(2, -20);
      ctx.lineTo(4, -3);
      ctx.lineTo(-10, 0);
      ctx.closePath();
      ctx.fill();
      // Ore chunks embedded
      ctx.fillStyle = isIron ? '#bfdbfe' : '#1e293b';
      for (const [ox, oy] of [[-7, -5], [6, -9], [4, 1]]) {
        ctx.beginPath();
        ctx.arc(ox, oy, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Crystal spire!
      const glow = 0.7 + 0.3 * Math.sin(t * 4 + n.x);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.22 * glow})`;
      ctx.beginPath();
      ctx.arc(0, -12, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0ea5e9';
      ctx.beginPath();
      ctx.moveTo(-14, 5);
      ctx.lineTo(-9, -18);
      ctx.lineTo(-2, 5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(-7, 6);
      ctx.lineTo(1, -30);
      ctx.lineTo(11, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.moveTo(4, 6);
      ctx.lineTo(13, -15);
      ctx.lineTo(16, 6);
      ctx.closePath();
      ctx.fill();
    }

    // Mini HP bar when damaged
    if (n.hp < n.maxHp) {
      const pct = Math.max(0, n.hp / n.maxHp);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      roundedRect(ctx, -16, -42, 32, 5, 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      roundedRect(ctx, -15, -41, 30 * pct, 3, 1.5);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawWildlife(ctx: CanvasRenderingContext2D, w: WildlifeEntity, t: number): void {
    const hop = Math.abs(Math.sin(t * (w.kind === 'rabbit' ? 10 : 6) + w.homeX)) * (w.kind === 'rabbit' ? 5 : 2.5);
    const flipX = Math.cos(w.facing) < 0 ? -1 : 1;

    ctx.save();
    ctx.translate(w.x, w.y);

    // Shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 5, w.radius * 0.9, w.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -hop);
    ctx.scale(flipX, 1);

    if (w.kind === 'rabbit') {
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(0, -4, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, -9, 5.5, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.ellipse(7, -17, 2.2, 5.5, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(10, -10, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'deer') {
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#a16207';
      ctx.beginPath();
      ctx.ellipse(0, -9, 15, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(13, -17, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // Antlers
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, -22);
      ctx.lineTo(15, -31);
      ctx.moveTo(14, -27);
      ctx.lineTo(19, -29);
      ctx.stroke();
    } else if (w.kind === 'boar') {
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#574234';
      ctx.beginPath();
      ctx.ellipse(0, -8, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tusks
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.moveTo(14, -6);
      ctx.lineTo(20, -11);
      ctx.lineTo(17, -4);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(11, -11, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'bear') {
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#5c3a21';
      ctx.beginPath();
      ctx.ellipse(0, -12, 22, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(16, -18, 11, 0, Math.PI * 2);
      ctx.fill();
      // Ears & snout
      ctx.beginPath();
      ctx.arc(11, -27, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a87c56';
      ctx.beginPath();
      ctx.ellipse(24, -16, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(19, -20, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'dire_wolf') {
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#475569';
      ctx.beginPath();
      ctx.ellipse(0, -9, 17, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(14, -14, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(17, -15, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Alpha Yeti mini-boss!
      ctx.fillStyle = w.hitFlash > 0 ? '#fecaca' : '#e0f2fe';
      ctx.beginPath();
      ctx.ellipse(0, -18, 25, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.arc(12, -32, 14, 0, Math.PI * 2);
      ctx.fill();
      // Frost horns
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(4, -42);
      ctx.lineTo(-2, -55);
      ctx.lineTo(10, -44);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(16, -42);
      ctx.lineTo(24, -55);
      ctx.lineTo(21, -40);
      ctx.fill();
      // Glowing eyes
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(17, -33, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // HP bar if damaged or aggressive boss
    if (w.hp < w.maxHp || w.kind === 'yeti') {
      const pct = Math.max(0, w.hp / w.maxHp);
      const bw = w.kind === 'yeti' ? 44 : 30;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      roundedRect(ctx, -bw / 2, -w.radius - 22, bw, 6, 3);
      ctx.fill();
      ctx.fillStyle = w.aggressive ? '#f87171' : '#facc15';
      roundedRect(ctx, -bw / 2 + 1, -w.radius - 21, (bw - 2) * pct, 4, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawWorker(ctx: CanvasRenderingContext2D, wk: WorkerEntity): void {
    const bob = Math.abs(Math.sin(wk.bobPhase)) * 3;
    const roleColors: Record<string, string> = {
      lumberjack: '#ea580c',
      miner: '#eab308',
      hunter: '#16a34a',
      hauler: '#0ea5e9',
      merchant: '#9333ea',
    };
    ctx.save();
    ctx.translate(wk.x, wk.y);
    ctx.fillStyle = 'rgba(15, 35, 58, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Parka body
    ctx.fillStyle = roleColors[wk.role] || '#3b82f6';
    roundedRect(ctx, -9, -15 - bob, 18, 18, 6);
    ctx.fill();
    // Head + beanie
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(0, -21 - bob, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, -24 - bob, 7.5, Math.PI, Math.PI * 2);
    ctx.fill();

    // Carried stack
    for (let i = 0; i < wk.carry.length; i++) {
      this.drawResourceToken(ctx, -11, -12 - i * 6 - bob, wk.carry[i], 5);
    }
    ctx.restore();
  }

  private drawCustomer(ctx: CanvasRenderingContext2D, c: CustomerEntity, t: number): void {
    const bob = Math.abs(Math.sin(t * 8 + c.x * 0.05)) * 2.5;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(15, 35, 58, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c.coatColor;
    roundedRect(ctx, -8, -14 - bob, 16, 17, 6);
    ctx.fill();
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, -20 - bob, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.hatColor;
    ctx.beginPath();
    ctx.arc(0, -23 - bob, 6.8, Math.PI, Math.PI * 2);
    ctx.fill();

    if (c.boughtIcon) {
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(c.boughtIcon, 0, -33 - bob);
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, engine: GameEngine): void {
    const p = engine.player;
    const bob = Math.abs(Math.sin(p.walkCycle)) * 4;
    const facingRight = Math.cos(p.facing) >= 0;
    const dir = facingRight ? 1 : -1;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Ground shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Golden buff aura if Stew buff active
    if (p.stewBuffTimer > 0) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 7, 19, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Physical swaying resource stack on player's back (THE iconic Whiteout-ad visual!)
    const stackX = -dir * 13;
    const swayAmt = -p.vx * 0.015;
    const visibleCount = Math.min(22, p.backpack.length);
    for (let i = 0; i < visibleCount; i++) {
      const res = p.backpack[i];
      const sx = stackX + swayAmt * (i * 0.45);
      const sy = -10 - i * 5.2 - bob * 0.5;
      this.drawResourceToken(ctx, sx, sy, res, 6.5);
    }
    if (p.backpack.length >= engine.getBackpackCapacity()) {
      ctx.font = '800 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      const topY = -20 - visibleCount * 5.2;
      ctx.strokeText('FULL', stackX, topY);
      ctx.fillText('FULL', stackX, topY);
    }

    // Boots
    ctx.fillStyle = '#451a03';
    const stride = Math.sin(p.walkCycle) * 4;
    ctx.beginPath();
    ctx.ellipse(-4 + stride, 5, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(4 - stride, 5, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fur-trimmed hero parka
    ctx.fillStyle = p.hurtFlash > 0 ? '#ef4444' : '#2563eb';
    roundedRect(ctx, -12, -18 - bob, 24, 22, 8);
    ctx.fill();
    // Cozy white fur trim along bottom & collar
    ctx.fillStyle = '#f8fafc';
    roundedRect(ctx, -12, -1 - bob, 24, 5, 3);
    ctx.fill();
    roundedRect(ctx, -9, -19 - bob, 18, 5, 3);
    ctx.fill();

    // Head
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(0, -26 - bob, 9.5, 0, Math.PI * 2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(dir * 3.5, -26 - bob, 1.5, 0, Math.PI * 2);
    ctx.arc(dir * 7, -26 - bob, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Red-trimmed winter beanie + pom-pom
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(0, -29 - bob, 10, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundedRect(ctx, -10, -31 - bob, 20, 4, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-dir * 2, -40 - bob, 3.8, 0, Math.PI * 2);
    ctx.fill();

    // Swinging tool animation
    if (p.swingTimer > 0 && p.swingTool !== 'none') {
      const swingAngle = (p.swingTimer / 0.35) * 1.4 - 0.5;
      ctx.save();
      ctx.translate(dir * 10, -12 - bob);
      ctx.rotate(dir * swingAngle);
      // Handle
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dir * 18, -14);
      ctx.stroke();
      // Head
      ctx.fillStyle = p.swingTool === 'axe' ? '#e2e8f0' : p.swingTool === 'pick' ? '#38bdf8' : '#facc15';
      ctx.beginPath();
      ctx.arc(dir * 19, -15, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Compact player HP bar if injured
    if (p.hp < p.maxHp) {
      const pct = Math.max(0, p.hp / p.maxHp);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      roundedRect(ctx, -18, -50 - bob, 36, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      roundedRect(ctx, -17, -49 - bob, 34 * pct, 4, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawResourceToken(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    res: ResourceType | 'gold',
    r: number
  ): void {
    ctx.save();
    if (res === 'gold') {
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const meta = RESOURCE_META[res];
      ctx.fillStyle = meta.color;
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 1.5;
      roundedRect(ctx, x - r, y - r * 0.6, r * 2, r * 1.2, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawZoneFrontierWall(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const unlockedZone = engine.getUnlockedZone();
    const unlockedR = engine.getUnlockedRadius();

    // Expanding golden thaw wave ring right after upgrading Homestead!
    if (engine.thawWave.active) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 214, 102, ${engine.thawWave.alpha})`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(0, 0, engine.thawWave.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Soft frosted boundary ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, unlockedR + 280, 0, Math.PI * 2);
    ctx.arc(0, 0, unlockedR, 0, Math.PI * 2, true);
    ctx.fillStyle = engine.stage.palette.fogTint;
    ctx.fill('evenodd');

    // Crisp glowing border line
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t * 18;
    ctx.strokeStyle = unlockedZone < 5 ? 'rgba(56, 189, 248, 0.78)' : 'rgba(250, 204, 21, 0.5)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, unlockedR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Helpful border signposts telling player which Homestead upgrade unlocks the next zone
    if (unlockedZone < 5) {
      const nextExpandTier = HOMESTEAD_TIERS.find((tier) => tier.unlockZone > unlockedZone);
      if (nextExpandTier) {
        const label = `❄️ Upgrade Homestead → ${nextExpandTier.name} to Thaw Zone ${nextExpandTier.unlockZone}!`;
        ctx.save();
        ctx.font = '800 13px system-ui';
        const w = ctx.measureText(label).width + 26;
        const sx = 0;
        const sy = -unlockedR + 26;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        roundedRect(ctx, sx - w / 2, sy - 16, w, 28, 12);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#e0f2fe';
        ctx.textAlign = 'center';
        ctx.fillText(label, sx, sy + 2);
        ctx.restore();
      }
    }
  }

  private drawBuildingBadges(ctx: CanvasRenderingContext2D, engine: GameEngine): void {
    const unlockedZone = engine.getUnlockedZone();
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone) continue;
      const showCost = b.level < b.maxLevel && (b.kind === 'homestead' || b.level === 0);
      if (!showCost) continue;

      const cost = engine.getBuildingNextCost(b);
      const parts: string[] = [];
      for (const [k, v] of Object.entries(cost.resources)) {
        const rem = Math.max(0, (v || 0) - (b.deposited[k as ResourceType] || 0));
        if (rem > 0) parts.push(`${RESOURCE_META[k as ResourceType].icon}${rem}`);
      }
      const gRem = Math.max(0, cost.gold - b.depositedGold);
      if (gRem > 0) parts.push(`💰${gRem}`);
      if (parts.length === 0) continue;

      const title =
        b.kind === 'homestead'
          ? `▲ ${HOMESTEAD_TIERS[Math.min(5, b.level + 1)].name}`
          : `Build ${b.name}`;
      const line = parts.join('  ');

      ctx.save();
      ctx.font = '800 11px system-ui';
      const w = Math.max(ctx.measureText(title).width, ctx.measureText(line).width) + 22;
      const bx = b.x;
      const by = b.y + 38;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      roundedRect(ctx, bx - w / 2, by - 16, w, 34, 10);
      ctx.fill();
      ctx.strokeStyle = b.kind === 'homestead' ? '#facc15' : '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = b.kind === 'homestead' ? '#fde047' : '#7dd3fc';
      ctx.fillText(title, bx, by - 3);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 11px system-ui';
      ctx.fillText(line, bx, by + 12);
      ctx.restore();
    }
  }
}
