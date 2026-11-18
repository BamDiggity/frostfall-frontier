import { GameEngine, ZONE_RADII } from './engine';
import { BiomePatterns, createBiomePatterns } from './terrain';
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
  private cachedStageId = -1;
  private patterns: BiomePatterns | null = null;

  private ensurePatterns(ctx: CanvasRenderingContext2D, engine: GameEngine): BiomePatterns {
    if (!this.patterns || this.cachedStageId !== engine.stage.id) {
      this.patterns = createBiomePatterns(ctx, engine.stage.palette);
      this.cachedStageId = engine.stage.id;
    }
    return this.patterns;
  }

  public render(ctx: CanvasRenderingContext2D, engine: GameEngine, width: number, height: number): void {
    const pal = engine.stage.palette;
    const t = engine.elapsedTime;
    const patterns = this.ensurePatterns(ctx, engine);

    const shakeX = engine.camera.shake > 0 ? (Math.random() - 0.5) * engine.camera.shake * 2 : 0;
    const shakeY = engine.camera.shake > 0 ? (Math.random() - 0.5) * engine.camera.shake * 2 : 0;
    const zoom = Math.min(1.18, Math.max(0.8, Math.min(width, height) / 560));

    ctx.save();
    ctx.fillStyle = pal.snowBase;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
    ctx.scale(zoom, zoom);
    ctx.translate(-engine.camera.x, -engine.camera.y);

    // 1. Textured high-res snow terrain, camp courtyard, roads & furnace glow
    this.drawGround(ctx, engine, patterns, t);

    // 2. Footprints
    for (const fp of engine.footprints) {
      ctx.save();
      ctx.translate(fp.x, fp.y);
      ctx.rotate(fp.angle);
      ctx.fillStyle = `rgba(92, 130, 168, ${Math.min(0.32, fp.life * 0.08)})`;
      ctx.beginPath();
      ctx.ellipse(-2, -3.5, 4, 2.2, 0, 0, Math.PI * 2);
      ctx.ellipse(2, 3.5, 4, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Building ground pads & warmth rings
    this.drawBuildingPads(ctx, engine, t);

    // 4. Diegetic objective compass chevron around player feet
    this.drawObjectiveCompass(ctx, engine, t);

    // 5. Wildlife attack telegraphs (under entities)
    for (const w of engine.wildlife) {
      if (w.state === 'windup') {
        const pct = 1 - Math.max(0, w.telegraphTimer / 0.72);
        const r = w.radius + 26;
        ctx.save();
        ctx.beginPath();
        ctx.arc(w.telegraphX, w.telegraphY, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.14 + pct * 0.25})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.92)';
        ctx.lineWidth = 2.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w.telegraphX, w.telegraphY, r * pct, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.34)';
        ctx.fill();
        ctx.restore();
      }
    }

    // 6. Depth-sorted world entities
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

    for (const gl of engine.groundLoot) {
      drawList.push({
        y: gl.y,
        draw: () => {
          ctx.fillStyle = 'rgba(15, 28, 46, 0.22)';
          ctx.beginPath();
          ctx.ellipse(gl.x, gl.y + 4, 8, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          this.drawDetailedResource(ctx, gl.x, gl.y - gl.z, gl.resource, 9.5);
        },
      });
    }

    drawList.push({ y: engine.player.y, draw: () => this.drawPlayer(ctx, engine, t) });

    drawList.sort((a, b) => a.y - b.y);
    for (const item of drawList) item.draw();

    // 7. Curved weapon/tool slash arcs
    for (const sa of engine.slashArcs) {
      const pct = 1 - sa.life / sa.maxLife;
      const alpha = Math.max(0, 1 - pct);
      ctx.save();
      ctx.translate(sa.x, sa.y);
      ctx.rotate(sa.angle);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sa.color;
      ctx.lineWidth = sa.crit ? 9 * (1 - pct * 0.4) : 5.5 * (1 - pct * 0.4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, sa.radius + pct * 8, -0.95, 0.95);
      ctx.stroke();
      if (sa.crit) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, sa.radius + 4 + pct * 8, -0.75, 0.75);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. Flying resource arcs
    for (const f of engine.flyingItems) {
      const p = Math.min(1, f.progress);
      const x = f.startX + (f.targetX - f.startX) * p;
      const y = f.startY + (f.targetY - f.startY) * p - Math.sin(p * Math.PI) * f.arcHeight;
      this.drawDetailedResource(ctx, x, y, f.resource, 9);
    }

    // 9. Particles & glowing hearth embers
    for (const pt of engine.particles) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const em of engine.embers) {
      const a = Math.max(0, em.life / em.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 8;
      ctx.fillStyle = em.color;
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 10. Locked-zone frosted mist ring & Thaw Wave
    this.drawZoneFrontierWall(ctx, engine, t);

    // 11. Building floating badges
    this.drawBuildingBadges(ctx, engine);

    // 12. Floating popups
    for (const ft of engine.floatingTexts) {
      const alpha = Math.min(1, (ft.life / ft.maxLife) * 1.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${Math.round(14 * ft.scale)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10, 20, 35, 0.88)';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    ctx.restore();

    // ==================== SCREEN-SPACE ATMOSPHERIC PASS ====================

    // Subtle sunlit atmospheric top-left highlight & cinematic soft edges
    const sunGrad = ctx.createRadialGradient(width * 0.12, height * 0.08, 10, width * 0.12, height * 0.08, Math.max(width, height) * 0.75);
    sunGrad.addColorStop(0, 'rgba(255, 250, 235, 0.12)');
    sunGrad.addColorStop(1, 'rgba(15, 28, 48, 0.06)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, width, height);

    // Aurora Borealis ribbons in Regions 4 & 5
    if (pal.auroraColors) {
      const [c1, c2] = pal.auroraColors;
      const grad = ctx.createLinearGradient(0, 0, width, height * 0.45);
      const shift = 0.5 + 0.5 * Math.sin(t * 0.65);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.42 + shift * 0.18, c2);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height * 0.5);
    }

    // Parallax falling snow & Blizzard streaks
    const bliz = engine.blizzard.intensity;
    ctx.save();
    for (const f of engine.snowFlakes) {
      const sx = f.x * width;
      const sy = f.y * height;
      if (bliz > 0.25) {
        ctx.strokeStyle = `rgba(240, 250, 255, ${0.42 + bliz * 0.45})`;
        ctx.lineWidth = f.r * 0.75;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 13 * bliz, sy - 7 * bliz);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.58 + f.r * 0.08})`;
        ctx.beginPath();
        ctx.arc(sx, sy, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Cold frost vignette
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
      vig.addColorStop(1, `rgba(96, 185, 250, ${Math.min(0.55, coldFactor * 0.58)})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }

    if (engine.player.hurtFlash > 0) {
      ctx.fillStyle = `rgba(239, 68, 68, ${engine.player.hurtFlash * 0.28})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Sleek circular Radar Mini-Map (left side above bottom dock)
    this.drawMiniMap(ctx, engine, width, height);

    // Virtual Joystick
    if (engine.joystick.active) {
      const j = engine.joystick;
      const dx = j.currentX - j.originX;
      const dy = j.currentY - j.originY;
      const d = Math.hypot(dx, dy);
      const clamp = Math.min(54, d);
      const kx = d > 1 ? j.originX + (dx / d) * clamp : j.originX;
      const ky = d > 1 ? j.originY + (dy / d) * clamp : j.originY;

      ctx.save();
      ctx.beginPath();
      ctx.arc(j.originX, j.originY, 56, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 28, 46, 0.24)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const kGrad = ctx.createRadialGradient(kx - 5, ky - 5, 3, kx, ky, 24);
      kGrad.addColorStop(0, '#ffffff');
      kGrad.addColorStop(1, '#bae6fd');
      ctx.beginPath();
      ctx.arc(kx, ky, 24, 0, Math.PI * 2);
      ctx.fillStyle = kGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawGround(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    patterns: BiomePatterns,
    t: number
  ): void {
    const pal = engine.stage.palette;

    // Seamless high-res textured snowfield
    ctx.save();
    ctx.fillStyle = patterns.snowPattern || pal.snowBase;
    ctx.fillRect(-1700, -1700, 3400, 3400);

    // Subtle concentric elevation contour rings
    for (let z = 4; z >= 1; z--) {
      ctx.strokeStyle = pal.snowShadow;
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, ZONE_RADII[z], 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Camp central cobblestone plaza (expands as Homestead grows!)
    const plazaR = engine.homesteadTier >= 3 ? 230 : engine.homesteadTier >= 1 ? 145 : 92;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 10, plazaR, 0, Math.PI * 2);
    ctx.clip();
    if (engine.homesteadTier >= 2 && patterns.stonePattern) {
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = patterns.stonePattern;
      ctx.fillRect(-plazaR, -plazaR + 10, plazaR * 2, plazaR * 2);
    } else {
      ctx.fillStyle = 'rgba(182, 152, 118, 0.24)';
      ctx.fillRect(-plazaR, -plazaR + 10, plazaR * 2, plazaR * 2);
    }
    ctx.restore();

    // Styled bordered paths connecting active buildings
    const unlockedZone = engine.getUnlockedZone();
    ctx.lineCap = 'round';
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone || b.kind === 'furnace') continue;
      ctx.strokeStyle = 'rgba(95, 118, 145, 0.22)';
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.moveTo(0, 55);
      ctx.lineTo(b.x, b.y + 18);
      ctx.stroke();

      ctx.strokeStyle = engine.homesteadTier >= 3 ? 'rgba(176, 189, 204, 0.5)' : 'rgba(206, 186, 162, 0.42)';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(0, 55);
      ctx.lineTo(b.x, b.y + 18);
      ctx.stroke();
    }

    // Lush volumetric warmth aura around Hearth Furnace
    const furnace = engine.buildings.find((b) => b.kind === 'furnace');
    if (furnace) {
      const overdrive = (furnace.overdriveTimer || 0) > 0;
      const warmR = engine.getFurnaceRadius() * (overdrive ? 1.15 : 1);
      const pulse = 1 + Math.sin(t * (overdrive ? 8 : 4.2)) * 0.035;

      // Melted dark hearth stone ring directly under furnace
      const meltGrad = ctx.createRadialGradient(furnace.x, furnace.y, 10, furnace.x, furnace.y, 72);
      meltGrad.addColorStop(0, 'rgba(92, 64, 44, 0.48)');
      meltGrad.addColorStop(1, 'rgba(92, 64, 44, 0)');
      ctx.fillStyle = meltGrad;
      ctx.beginPath();
      ctx.arc(furnace.x, furnace.y, 72, 0, Math.PI * 2);
      ctx.fill();

      // Golden light bloom
      const grad = ctx.createRadialGradient(furnace.x, furnace.y, 12, furnace.x, furnace.y, warmR * pulse);
      grad.addColorStop(0, overdrive ? 'rgba(255, 145, 30, 0.56)' : 'rgba(255, 168, 66, 0.45)');
      grad.addColorStop(0.45, overdrive ? 'rgba(255, 204, 72, 0.24)' : 'rgba(255, 196, 112, 0.16)');
      grad.addColorStop(0.88, 'rgba(255, 224, 168, 0.05)');
      grad.addColorStop(1, 'rgba(255, 224, 168, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(furnace.x, furnace.y, warmR * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = overdrive ? 'rgba(251, 146, 60, 0.65)' : 'rgba(255, 165, 70, 0.34)';
      ctx.lineWidth = overdrive ? 3 : 2;
      ctx.beginPath();
      ctx.arc(furnace.x, furnace.y, warmR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawObjectiveCompass(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const target = engine.getObjectiveTarget();
    if (!target) return;
    const p = engine.player;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 110) return;

    const ang = Math.atan2(dy, dx);
    const orbit = 42 + Math.sin(t * 5) * 3;
    const ax = p.x + Math.cos(ang) * orbit;
    const ay = p.y + Math.sin(ang) * orbit;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = target.color;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -6.5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawBuildingPads(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const unlockedZone = engine.getUnlockedZone();
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone) continue;

      const isUpgradeable = b.level < b.maxLevel && (b.kind === 'homestead' || b.level === 0);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 12, b.radius + 11, (b.radius + 11) * 0.68, 0, 0, Math.PI * 2);

      if (b.level === 0) {
        ctx.fillStyle = `rgba(56, 189, 248, ${0.14 + pulse * 0.1})`;
        ctx.fill();
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = `rgba(14, 165, 233, ${0.7 + pulse * 0.28})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (b.kind === 'storehouse') {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.82)';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      } else if (b.kind === 'trading_post') {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
        ctx.fill();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.8)';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      } else if (isUpgradeable) {
        ctx.fillStyle = `rgba(251, 191, 36, ${0.12 + pulse * 0.09})`;
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.65 + pulse * 0.35})`;
        ctx.lineWidth = 2.8;
        ctx.stroke();
      } else if (b.outputType) {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.55)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    const bounce = b.bounceAnim > 0 ? 1 + Math.sin(b.bounceAnim * Math.PI * 4) * 0.11 * b.bounceAnim : 1;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(bounce, 2 - bounce);

    // Directional grounded ambient shadow
    ctx.fillStyle = 'rgba(15, 32, 54, 0.22)';
    ctx.beginPath();
    ctx.ellipse(6, 16, b.radius * 0.94, b.radius * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();

    // Warm window light spill on snow for built shelters/businesses!
    if (b.level > 0 && b.kind !== 'furnace' && b.kind !== 'trading_post' && b.kind !== 'storehouse') {
      const glow = ctx.createRadialGradient(0, 12, 8, 0, 14, b.radius * 1.15);
      glow.addColorStop(0, 'rgba(255, 214, 102, 0.3)');
      glow.addColorStop(1, 'rgba(255, 214, 102, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 14, b.radius * 1.15, b.radius * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (b.kind === 'homestead') {
      this.drawHomestead(ctx, b.level, t);
    } else if (b.kind === 'furnace') {
      this.drawFurnace(ctx, b, t);
    } else if (b.kind === 'storehouse') {
      this.drawStorehouse(ctx, b.level);
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
    const outline = 'rgba(15, 23, 42, 0.42)';

    if (tier === 0) {
      // Tier 0: Detailed Expedition Tent on timber deck
      ctx.fillStyle = '#a46c3b';
      roundedRect(ctx, -36, -2, 72, 22, 6);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const tentGrad = ctx.createLinearGradient(-28, -34, 28, 12);
      tentGrad.addColorStop(0, '#f97316');
      tentGrad.addColorStop(0.55, '#ea580c');
      tentGrad.addColorStop(1, '#9a3412');
      ctx.fillStyle = tentGrad;
      ctx.beginPath();
      ctx.moveTo(0, -38);
      ctx.lineTo(-30, 14);
      ctx.lineTo(30, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Canvas highlight seam + glowing interior
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(-10, 14);
      ctx.lineTo(10, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(254, 240, 138, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 10, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (tier === 1) {
      // Tier 1: Shaded Timber Hut with snow-pillow roof & glowing window
      const wallGrad = ctx.createLinearGradient(-32, -16, 32, 18);
      wallGrad.addColorStop(0, '#b0743f');
      wallGrad.addColorStop(1, '#6f421d');
      ctx.fillStyle = wallGrad;
      roundedRect(ctx, -32, -16, 64, 34, 6);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Horizontal log grooves
      ctx.strokeStyle = 'rgba(69, 34, 12, 0.45)';
      ctx.lineWidth = 1.6;
      for (let y = -8; y <= 12; y += 7) {
        ctx.beginPath();
        ctx.moveTo(-31, y);
        ctx.lineTo(31, y);
        ctx.stroke();
      }

      // Roof with shaded slope
      const roofGrad = ctx.createLinearGradient(-38, -46, 38, -8);
      roofGrad.addColorStop(0, '#7c4a26');
      roofGrad.addColorStop(1, '#43240f');
      ctx.fillStyle = roofGrad;
      ctx.beginPath();
      ctx.moveTo(0, -47);
      ctx.lineTo(-40, -8);
      ctx.lineTo(40, -8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();

      // Plush overhanging snow drift on roof
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -49);
      ctx.lineTo(-34, -17);
      ctx.quadraticCurveTo(-16, -12, 0, -21);
      ctx.quadraticCurveTo(16, -12, 34, -17);
      ctx.closePath();
      ctx.fill();

      // Door & warm mullioned window
      ctx.fillStyle = '#451a03';
      roundedRect(ctx, -8, -1, 16, 19, 4);
      ctx.fill();
      this.drawLitWindow(ctx, 13, -6, 12, 12);
      return;
    }

    if (tier === 2) {
      // Tier 2: Log Cabin (stone chimney + porch + double lit windows)
      const wallGrad = ctx.createLinearGradient(-42, -20, 42, 20);
      wallGrad.addColorStop(0, '#9c6231');
      wallGrad.addColorStop(1, '#5e3615');
      ctx.fillStyle = wallGrad;
      roundedRect(ctx, -42, -20, 84, 40, 7);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(54, 26, 8, 0.5)';
      ctx.lineWidth = 1.8;
      for (let y = -12; y <= 14; y += 8) {
        ctx.beginPath();
        ctx.moveTo(-41, y);
        ctx.lineTo(41, y);
        ctx.stroke();
      }

      // Chimney + smoke
      ctx.fillStyle = '#64748b';
      roundedRect(ctx, 19, -56, 13, 28, 3);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      this.drawSmokePuff(ctx, 25, -60, t);

      // Crimson-shingle roof
      const roofGrad = ctx.createLinearGradient(-48, -56, 48, -12);
      roofGrad.addColorStop(0, '#c24132');
      roofGrad.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = roofGrad;
      ctx.beginPath();
      ctx.moveTo(0, -56);
      ctx.lineTo(-50, -13);
      ctx.lineTo(50, -13);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();

      // Thick snow pillow + icicles
      ctx.fillStyle = '#f8fbff';
      ctx.beginPath();
      ctx.moveTo(0, -58);
      ctx.lineTo(-42, -22);
      ctx.quadraticCurveTo(0, -29, 42, -22);
      ctx.closePath();
      ctx.fill();
      this.drawIcicles(ctx, -38, 38, -13);

      // Door & twin warm windows
      ctx.fillStyle = '#3f220e';
      roundedRect(ctx, -9, -1, 18, 21, 5);
      ctx.fill();
      this.drawLitWindow(ctx, -32, -8, 14, 13);
      this.drawLitWindow(ctx, 18, -8, 14, 13);
      return;
    }

    if (tier === 3) {
      // Tier 3: Stone House (two-story alpine chalet)
      const wallGrad = ctx.createLinearGradient(-46, -30, 46, 20);
      wallGrad.addColorStop(0, '#cbd5e1');
      wallGrad.addColorStop(1, '#7c8ea3');
      ctx.fillStyle = wallGrad;
      roundedRect(ctx, -46, -30, 92, 50, 7);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      roundedRect(ctx, -46, 5, 92, 15, 4);
      ctx.fill();
      ctx.strokeStyle = '#5c3a21';
      ctx.lineWidth = 3;
      ctx.strokeRect(-44, -28, 88, 46);

      ctx.fillStyle = '#475569';
      roundedRect(ctx, 23, -66, 14, 30, 3);
      ctx.fill();
      this.drawSmokePuff(ctx, 30, -70, t);

      const roofGrad = ctx.createLinearGradient(-56, -68, 56, -20);
      roofGrad.addColorStop(0, '#3b6796');
      roofGrad.addColorStop(1, '#1e3a5f');
      ctx.fillStyle = roofGrad;
      ctx.beginPath();
      ctx.moveTo(0, -68);
      ctx.lineTo(-56, -20);
      ctx.lineTo(56, -20);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#f8fbff';
      ctx.beginPath();
      ctx.moveTo(0, -70);
      ctx.lineTo(-47, -30);
      ctx.quadraticCurveTo(0, -37, 47, -30);
      ctx.closePath();
      ctx.fill();
      this.drawIcicles(ctx, -46, 46, -20);

      ctx.fillStyle = '#451a03';
      roundedRect(ctx, -10, -2, 20, 22, 8);
      ctx.fill();
      this.drawLitWindow(ctx, -35, -20, 14, 13);
      this.drawLitWindow(ctx, 21, -20, 14, 13);
      this.drawLitWindow(ctx, -35, 0, 14, 12);
      this.drawLitWindow(ctx, 21, 0, 14, 12);
      return;
    }

    if (tier === 4) {
      // Tier 4: Grand Mansion
      const wingGrad = ctx.createLinearGradient(-60, -24, 60, 20);
      wingGrad.addColorStop(0, '#e2e8f0');
      wingGrad.addColorStop(1, '#94a3b8');
      ctx.fillStyle = wingGrad;
      roundedRect(ctx, -60, -24, 120, 44, 7);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#f1f5f9';
      roundedRect(ctx, -34, -40, 68, 60, 7);
      ctx.fill();
      ctx.stroke();

      // Steep royal red roofs
      ctx.fillStyle = '#991b1b';
      for (const sx of [-42, 42]) {
        ctx.beginPath();
        ctx.moveTo(sx, -48);
        ctx.lineTo(sx - 23, -18);
        ctx.lineTo(sx + 23, -18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      const mainRoof = ctx.createLinearGradient(-44, -76, 44, -30);
      mainRoof.addColorStop(0, '#dc2626');
      mainRoof.addColorStop(1, '#7f1d1d');
      ctx.fillStyle = mainRoof;
      ctx.beginPath();
      ctx.moveTo(0, -76);
      ctx.lineTo(-44, -30);
      ctx.lineTo(44, -30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -77);
      ctx.lineTo(-35, -39);
      ctx.quadraticCurveTo(0, -45, 35, -39);
      ctx.closePath();
      ctx.fill();
      this.drawSmokePuff(ctx, -42, -54, t);
      this.drawSmokePuff(ctx, 42, -54, t + 1.4);

      // Golden grand arch & warm glowing windows
      ctx.fillStyle = '#f59e0b';
      roundedRect(ctx, -13, -5, 26, 25, 10);
      ctx.fill();
      ctx.fillStyle = '#451a03';
      roundedRect(ctx, -10, -2, 20, 22, 8);
      ctx.fill();
      for (const wx of [-51, -24, 11, 38]) {
        this.drawLitWindow(ctx, wx, -13, 13, 15);
      }
      this.drawLitWindow(ctx, -11, -30, 22, 14);
      return;
    }

    // Tier 5: Majestic Frontier Town Hall
    const hallGrad = ctx.createLinearGradient(-64, -28, 64, 20);
    hallGrad.addColorStop(0, '#f8fafc');
    hallGrad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = hallGrad;
    roundedRect(ctx, -64, -28, 128, 48, 8);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Marble columns
    ctx.fillStyle = '#ffffff';
    for (const cx of [-50, -30, 23, 43]) {
      roundedRect(ctx, cx, -25, 7, 43, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,116,139,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Royal sapphire roof
    const roofGrad = ctx.createLinearGradient(-70, -60, 70, -22);
    roofGrad.addColorStop(0, '#2563eb');
    roofGrad.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(0, -60);
    ctx.lineTo(-70, -22);
    ctx.lineTo(70, -22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Central Clocktower
    ctx.fillStyle = '#f1f5f9';
    roundedRect(ctx, -21, -78, 42, 52, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(0, -112);
    ctx.lineTo(-27, -74);
    ctx.lineTo(27, -74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Golden spire & animated fluttering banner
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, -112);
    ctx.lineTo(0, -132);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(0, -131);
    ctx.quadraticCurveTo(10, -129 + Math.sin(t * 7) * 3, 21, -125 + Math.cos(t * 7) * 2.5);
    ctx.lineTo(0, -118);
    ctx.closePath();
    ctx.fill();

    // Glowing clock face
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, -56, 11.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -56);
    ctx.lineTo(0, -64);
    ctx.moveTo(0, -56);
    ctx.lineTo(6, -56);
    ctx.stroke();

    // Golden doorway
    ctx.fillStyle = '#f59e0b';
    roundedRect(ctx, -15, -7, 30, 27, 10);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    roundedRect(ctx, -11, -3, 22, 23, 8);
    ctx.fill();
  }

  private drawLitWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#fef08a');
    grad.addColorStop(1, '#f59e0b');
    ctx.fillStyle = grad;
    roundedRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Window crossbars
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
  }

  private drawIcicles(ctx: CanvasRenderingContext2D, minX: number, maxX: number, y: number): void {
    ctx.fillStyle = 'rgba(219, 244, 255, 0.85)';
    for (let x = minX; x <= maxX; x += 14) {
      const len = 5 + ((Math.abs(x) * 3) % 5);
      ctx.beginPath();
      ctx.moveTo(x - 2.5, y);
      ctx.lineTo(x + 2.5, y);
      ctx.lineTo(x, y + len);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawFurnace(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    const overdrive = (b.overdriveTimer || 0) > 0;
    // Heavy cast-iron boiler base with metallic gradient
    const baseGrad = ctx.createLinearGradient(-24, -28, 24, 16);
    baseGrad.addColorStop(0, '#64748b');
    baseGrad.addColorStop(0.5, '#334155');
    baseGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = baseGrad;
    ctx.beginPath();
    ctx.arc(0, 4, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Brass pressure rivets & upper cylinder
    ctx.fillStyle = baseGrad;
    roundedRect(ctx, -18, -28, 36, 34, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1e293b';
    roundedRect(ctx, -12, -44, 24, 18, 4);
    ctx.fill();
    ctx.stroke();

    // Brass rim band
    ctx.fillStyle = '#d97706';
    roundedRect(ctx, -19, -24, 38, 4, 2);
    ctx.fill();

    // Roaring fire core
    const fRatio = Math.max(0.25, b.fuel / b.maxFuel);
    const flicker = 1 + Math.sin(t * 16) * 0.14;
    ctx.save();
    ctx.shadowColor = overdrive ? '#fde047' : '#f97316';
    ctx.shadowBlur = overdrive ? 20 : 12;
    ctx.fillStyle = overdrive ? '#ff5500' : '#ff6b00';
    ctx.beginPath();
    ctx.arc(0, -6, 12 * fRatio * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, -5, 7 * fRatio * flicker, 0, Math.PI * 2);
    ctx.fill();

    // Chimney flame crown
    ctx.fillStyle = overdrive ? '#fde047' : '#ff922b';
    ctx.beginPath();
    ctx.moveTo(-8 * fRatio, -42);
    ctx.quadraticCurveTo(0, -(overdrive ? 68 : 58) * fRatio * flicker, 8 * fRatio, -42);
    ctx.fill();
    ctx.restore();

    // Fuel bar
    const bw = 42;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    roundedRect(ctx, -bw / 2, 18, bw, 7, 3.5);
    ctx.fill();
    ctx.fillStyle = overdrive ? '#facc15' : b.fuel > 35 ? '#fb923c' : '#ef4444';
    roundedRect(ctx, -bw / 2 + 1, 19, (bw - 2) * (b.fuel / b.maxFuel), 5, 2.5);
    ctx.fill();
  }

  private drawStorehouse(ctx: CanvasRenderingContext2D, level: number): void {
    const wallGrad = ctx.createLinearGradient(-28, -12, 28, 16);
    wallGrad.addColorStop(0, '#9c6231');
    wallGrad.addColorStop(1, '#5e3615');
    ctx.fillStyle = wallGrad;
    roundedRect(ctx, -28, -12, 56, 28, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const roofGrad = ctx.createLinearGradient(-34, -40, 34, -10);
    roofGrad.addColorStop(0, '#0284c7');
    roofGrad.addColorStop(1, '#075985');
    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(0, -40);
    ctx.lineTo(-35, -10);
    ctx.lineTo(35, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fbff';
    ctx.beginPath();
    ctx.moveTo(0, -41);
    ctx.lineTo(-27, -18);
    ctx.quadraticCurveTo(0, -23, 27, -18);
    ctx.closePath();
    ctx.fill();

    // Double barn doors & supply crate
    ctx.fillStyle = '#451a03';
    roundedRect(ctx, -12, -2, 24, 18, 3);
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-12, -2);
    ctx.lineTo(12, 16);
    ctx.moveTo(12, -2);
    ctx.lineTo(-12, 16);
    ctx.stroke();

    ctx.fillStyle = '#c27829';
    roundedRect(ctx, 16, 4, 14, 12, 2.5);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.stroke();

    // Label pill
    ctx.fillStyle = 'rgba(12, 23, 38, 0.88)';
    roundedRect(ctx, -32, 22, 64, 19, 8);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('📦 STORE', 0, 35);
    if (level > 1) {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = '800 9.5px system-ui';
      ctx.fillText(`Lv.${level}`, 0, -44);
    }
  }

  private drawTradingPost(ctx: CanvasRenderingContext2D, level: number): void {
    const woodGrad = ctx.createLinearGradient(-30, -8, 30, 16);
    woodGrad.addColorStop(0, '#a1622a');
    woodGrad.addColorStop(1, '#5c3312');
    ctx.fillStyle = woodGrad;
    roundedRect(ctx, -31, -8, 62, 24, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Festive scalloped striped awning
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#dc2626' : '#fef3c7';
      ctx.fillRect(-33 + i * 11, -29, 11, 19);
      ctx.beginPath();
      ctx.arc(-27.5 + i * 11, -10, 5.5, 0, Math.PI);
      ctx.fill();
    }
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(-33, -29, 66, 19);

    // Glossy coin emblem
    const coinGrad = ctx.createRadialGradient(-3, -38, 2, 0, -35, 11);
    coinGrad.addColorStop(0, '#fef08a');
    coinGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = coinGrad;
    ctx.beginPath();
    ctx.arc(0, -35, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#78350f';
    ctx.font = '900 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('$', 0, -31);

    ctx.fillStyle = 'rgba(12, 23, 38, 0.88)';
    roundedRect(ctx, -30, 22, 60, 19, 8);
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.font = '800 10px system-ui';
    ctx.fillText('💰 SELL', 0, 35);
    if (level > 1) {
      ctx.fillStyle = '#fde047';
      ctx.font = '800 9.5px system-ui';
      ctx.fillText(`Lv.${level}`, 0, 10);
    }
  }

  private drawConstructionPlot(ctx: CanvasRenderingContext2D, _b: BuildingState): void {
    ctx.fillStyle = 'rgba(139, 90, 43, 0.78)';
    roundedRect(ctx, -28, -13, 56, 26, 6);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-26, -11, 52, 22);
    ctx.font = '19px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('🔨', 0, 6);
  }

  private drawBusinessBuilding(ctx: CanvasRenderingContext2D, b: BuildingState, t: number): void {
    const roofColors: Record<string, [string, string]> = {
      sawmill: ['#d97706', '#78350f'],
      hunters_lodge: ['#22c55e', '#14532d'],
      smeltery: ['#64748b', '#1e293b'],
      tannery: ['#c2410c', '#7c2d12'],
      tavern: ['#ea580c', '#9a3412'],
      artisan_guild: ['#8b5cf6', '#4c1d95'],
      explorers_guild: ['#0ea5e9', '#075985'],
    };
    const wallColors: Record<string, [string, string]> = {
      sawmill: ['#b47a3c', '#6e4219'],
      hunters_lodge: ['#9c6538', '#5c3618'],
      smeltery: ['#94a3b8', '#475569'],
      tannery: ['#a86432', '#613414'],
      tavern: ['#b87344', '#6b3b1e'],
      artisan_guild: ['#e2e8f0', '#94a3b8'],
      explorers_guild: ['#f1f5f9', '#94a3b8'],
    };

    const [r1, r2] = roofColors[b.kind] || ['#475569', '#1e293b'];
    const [w1, w2] = wallColors[b.kind] || ['#94a3b8', '#475569'];

    const wallGrad = ctx.createLinearGradient(-34, -16, 34, 18);
    wallGrad.addColorStop(0, w1);
    wallGrad.addColorStop(1, w2);
    ctx.fillStyle = wallGrad;
    roundedRect(ctx, -34, -16, 68, 34, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const roofGrad = ctx.createLinearGradient(-40, -48, 40, -12);
    roofGrad.addColorStop(0, r1);
    roofGrad.addColorStop(1, r2);
    ctx.fillStyle = roofGrad;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.lineTo(-41, -12);
    ctx.lineTo(41, -12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fbff';
    ctx.beginPath();
    ctx.moveTo(0, -49);
    ctx.lineTo(-32, -20);
    ctx.quadraticCurveTo(0, -26, 32, -20);
    ctx.closePath();
    ctx.fill();

    this.drawLitWindow(ctx, -24, -5, 13, 13);
    ctx.fillStyle = '#451a03';
    roundedRect(ctx, -6, 0, 14, 18, 4);
    ctx.fill();

    // Signature animated features
    if (b.kind === 'sawmill') {
      ctx.save();
      ctx.translate(24, 4);
      ctx.rotate(t * 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (b.kind === 'artisan_guild') {
      const bob = Math.sin(t * 3.8) * 4;
      ctx.save();
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, -68 + bob);
      ctx.lineTo(-9, -54 + bob);
      ctx.lineTo(0, -45 + bob);
      ctx.lineTo(9, -54 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (b.kind === 'explorers_guild') {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(0, -56, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🧭', 0, -52);
    } else if (b.kind === 'smeltery' || b.kind === 'tavern') {
      this.drawSmokePuff(ctx, 18, -50, t);
    }

    // Recipe hint pill (e.g. 🪵→🪚) when workshop is active
    if (b.inputRecipe && b.outputType) {
      const inIcons = Object.keys(b.inputRecipe)
        .map((k) => RESOURCE_META[k as ResourceType].icon)
        .join('');
      const outIcon = RESOURCE_META[b.outputType].icon;
      ctx.fillStyle = 'rgba(12, 23, 38, 0.82)';
      roundedRect(ctx, -30, 22, 60, 17, 7);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '700 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${inIcons}→${outIcon}`, 0, 34);
    }

    // Output stock pill
    if (b.outputType && b.outputStock > 0) {
      const meta = RESOURCE_META[b.outputType];
      ctx.fillStyle = 'rgba(12, 23, 38, 0.9)';
      roundedRect(ctx, 16, -38, 38, 21, 9);
      ctx.fill();
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${meta.icon}${b.outputStock}`, 35, -24);
    }

    if (b.processTimer > 0 && b.processDuration > 0) {
      const pct = Math.min(1, b.processTimer / b.processDuration);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      roundedRect(ctx, -26, -56, 52, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      roundedRect(ctx, -25, -55, 50 * pct, 4, 2);
      ctx.fill();
    }
  }

  private drawSmokePuff(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.55 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(241, 245, 249, ${(1 - p) * 0.52})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(p * 5 + i) * 5.5, y - p * 30, 4.5 + p * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStump(ctx: CanvasRenderingContext2D, n: ResourceNode): void {
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.fillStyle = n.kind === 'pine' || n.kind === 'ancient_pine' ? '#7c4d25' : '#64748b';
    ctx.beginPath();
    ctx.ellipse(0, 2, 10, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (n.kind === 'pine' || n.kind === 'ancient_pine') {
      ctx.fillStyle = '#d8a46f';
      ctx.beginPath();
      ctx.ellipse(0, 0.5, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const pct = 1 - n.respawnTimer / n.respawnDuration;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.52)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 2, 12.5, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
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
    const sway = (n.kind === 'pine' || n.kind === 'ancient_pine') ? Math.sin(t * 2.1 + n.x * 0.05) * 1.8 : 0;

    ctx.save();
    ctx.translate(n.x + shake, n.y);
    ctx.scale(n.scale, n.scale);
    if (locked) ctx.globalAlpha = 0.45;

    // Ground directional cast shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.2)';
    ctx.beginPath();
    ctx.ellipse(5, 7, 19, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    if (n.kind === 'pine' || n.kind === 'ancient_pine') {
      const isAncient = n.kind === 'ancient_pine';
      const trunkGrad = ctx.createLinearGradient(-6, -6, 6, 8);
      trunkGrad.addColorStop(0, '#8c5830');
      trunkGrad.addColorStop(1, '#4a2912');
      ctx.fillStyle = trunkGrad;
      roundedRect(ctx, -5.5, -6, 11, 15, 2.5);
      ctx.fill();

      const tiers = isAncient ? 4 : 3;
      for (let i = 0; i < tiers; i++) {
        const yOff = -8 - i * 11.5;
        const w = (isAncient ? 27 : 22) - i * 4.6;
        const tipX = sway * (i + 1) * 0.42;

        const foliageGrad = ctx.createLinearGradient(-w, yOff - 18, w, yOff + 4);
        foliageGrad.addColorStop(0, pal.pineLight);
        foliageGrad.addColorStop(1, pal.pineDark);
        ctx.fillStyle = foliageGrad;
        ctx.beginPath();
        ctx.moveTo(tipX, yOff - 20);
        ctx.quadraticCurveTo(-w * 0.65, yOff - 6, -w, yOff + 4);
        ctx.quadraticCurveTo(0, yOff + 8, w, yOff + 4);
        ctx.quadraticCurveTo(w * 0.65, yOff - 6, tipX, yOff - 20);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(12, 34, 24, 0.32)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Sculpted snow cap with cool underside tint
        const snowGrad = ctx.createLinearGradient(0, yOff - 20, 0, yOff - 4);
        snowGrad.addColorStop(0, '#ffffff');
        snowGrad.addColorStop(1, '#dbeeff');
        ctx.fillStyle = snowGrad;
        ctx.beginPath();
        ctx.moveTo(tipX, yOff - 21);
        ctx.lineTo(-w * 0.65, yOff - 5);
        ctx.quadraticCurveTo(0, yOff - 10, w * 0.65, yOff - 5);
        ctx.closePath();
        ctx.fill();
      }
      if (isAncient) {
        ctx.save();
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(0, -16, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (n.kind === 'coal_vein' || n.kind === 'iron_vein') {
      const isIron = n.kind === 'iron_vein';
      const rockGrad = ctx.createLinearGradient(-20, -22, 20, 8);
      rockGrad.addColorStop(0, '#94a3b8');
      rockGrad.addColorStop(0.55, pal.rockColor);
      rockGrad.addColorStop(1, '#334155');
      ctx.fillStyle = rockGrad;
      ctx.beginPath();
      ctx.moveTo(-21, 6);
      ctx.lineTo(-15, -15);
      ctx.lineTo(2, -23);
      ctx.lineTo(19, -11);
      ctx.lineTo(21, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,0.45)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Lit stone facet
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(-15, -15);
      ctx.lineTo(2, -23);
      ctx.lineTo(4, -3);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();

      // Gleaming ore chunks
      for (const [ox, oy] of [[-7, -6], [7, -10], [4, 1]]) {
        ctx.fillStyle = isIron ? '#dbeafe' : '#0f172a';
        ctx.beginPath();
        ctx.arc(ox, oy, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isIron ? '#ffffff' : '#64748b';
        ctx.beginPath();
        ctx.arc(ox - 1.5, oy - 1.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Glowing Frost Crystal cluster!
      const glow = 0.72 + 0.28 * Math.sin(t * 4.2 + n.x);
      ctx.save();
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 16 * glow;

      const cGrad1 = ctx.createLinearGradient(-12, -22, 0, 6);
      cGrad1.addColorStop(0, '#bae6fd');
      cGrad1.addColorStop(1, '#0284c7');
      ctx.fillStyle = cGrad1;
      ctx.beginPath();
      ctx.moveTo(-16, 6);
      ctx.lineTo(-10, -20);
      ctx.lineTo(-2, 6);
      ctx.closePath();
      ctx.fill();

      const cGrad2 = ctx.createLinearGradient(-6, -34, 10, 6);
      cGrad2.addColorStop(0, '#ffffff');
      cGrad2.addColorStop(0.45, '#38bdf8');
      cGrad2.addColorStop(1, '#0369a1');
      ctx.fillStyle = cGrad2;
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.lineTo(1, -34);
      ctx.lineTo(12, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.moveTo(5, 6);
      ctx.lineTo(14, -17);
      ctx.lineTo(18, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (n.hp < n.maxHp) {
      const pct = Math.max(0, n.hp / n.maxHp);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      roundedRect(ctx, -17, -44, 34, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      roundedRect(ctx, -16, -43, 32 * pct, 4, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawWildlife(ctx: CanvasRenderingContext2D, w: WildlifeEntity, t: number): void {
    const hop = Math.abs(Math.sin(t * (w.kind === 'rabbit' ? 10 : 6.5) + w.homeX)) * (w.kind === 'rabbit' ? 5.5 : 3);
    const flipX = Math.cos(w.facing) < 0 ? -1 : 1;

    ctx.save();
    ctx.translate(w.x, w.y);

    // Shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.22)';
    ctx.beginPath();
    ctx.ellipse(2, 6, w.radius * 0.92, w.radius * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -hop);
    ctx.scale(flipX, 1);

    const outline = 'rgba(15, 23, 42, 0.35)';

    if (w.kind === 'rabbit') {
      const g = ctx.createRadialGradient(-2, -6, 2, 0, -4, 12);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, w.hitFlash > 0 ? '#fca5a5' : '#cbd5e1');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -4, 10.5, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Fluffy tail + head + pink-lined ears
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-10, -5, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, -9.5, 5.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(7, -18, 2.3, 6, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fda4af';
      ctx.beginPath();
      ctx.ellipse(7, -17.5, 1.1, 3.8, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(10.5, -10.5, 1.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'deer') {
      const g = ctx.createLinearGradient(-15, -16, 15, 0);
      g.addColorStop(0, w.hitFlash > 0 ? '#fca5a5' : '#c2782c');
      g.addColorStop(1, '#78350f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -9.5, 16, 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(13.5, -18, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(12, -23);
      ctx.lineTo(15, -33);
      ctx.moveTo(14, -28);
      ctx.lineTo(20, -31);
      ctx.stroke();
    } else if (w.kind === 'boar') {
      const g = ctx.createLinearGradient(-16, -18, 16, 2);
      g.addColorStop(0, w.hitFlash > 0 ? '#fca5a5' : '#785a46');
      g.addColorStop(1, '#3b281c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -8.5, 17, 11.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.moveTo(14, -6);
      ctx.lineTo(22, -12);
      ctx.lineTo(18, -3.5);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(11.5, -11.5, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'bear') {
      const g = ctx.createLinearGradient(-22, -26, 22, 4);
      g.addColorStop(0, w.hitFlash > 0 ? '#fca5a5' : '#7c4d2b');
      g.addColorStop(1, '#3d2210');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -13, 23, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(16.5, -19, 11.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(11, -28.5, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c49a6c';
      ctx.beginPath();
      ctx.ellipse(25, -17, 5.5, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(19.5, -21, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (w.kind === 'dire_wolf') {
      const g = ctx.createLinearGradient(-17, -18, 17, 2);
      g.addColorStop(0, w.hitFlash > 0 ? '#fca5a5' : '#64748b');
      g.addColorStop(1, '#1e293b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -9.5, 18, 10.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(14.5, -15, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(18, -16, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Alpha Yeti mini-boss
      const g = ctx.createRadialGradient(-6, -24, 5, 0, -18, 30);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, w.hitFlash > 0 ? '#fca5a5' : '#7dd3fc');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -19, 26, 23, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.arc(12, -33, 14.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(4, -44);
      ctx.lineTo(-3, -58);
      ctx.lineTo(10, -46);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(16, -44);
      ctx.lineTo(25, -58);
      ctx.lineTo(22, -41);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(17.5, -34, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (w.hp < w.maxHp || w.kind === 'yeti') {
      const pct = Math.max(0, w.hp / w.maxHp);
      const bw = w.kind === 'yeti' ? 46 : 32;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      roundedRect(ctx, -bw / 2, -w.radius - 23, bw, 6, 3);
      ctx.fill();
      ctx.fillStyle = w.aggressive ? '#f87171' : '#facc15';
      roundedRect(ctx, -bw / 2 + 1, -w.radius - 22, (bw - 2) * pct, 4, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawWorker(ctx: CanvasRenderingContext2D, wk: WorkerEntity): void {
    const bob = Math.abs(Math.sin(wk.bobPhase)) * 3.2;
    const roleColors: Record<string, [string, string]> = {
      lumberjack: ['#fb923c', '#c2410c'],
      miner: ['#facc15', '#a16207'],
      hunter: ['#4ade80', '#15803d'],
      hauler: ['#38bdf8', '#0369a1'],
      merchant: ['#c084fc', '#6b21a8'],
    };
    const [c1, c2] = roleColors[wk.role] || ['#60a5fa', '#1d4ed8'];

    ctx.save();
    ctx.translate(wk.x, wk.y);
    ctx.fillStyle = 'rgba(15, 35, 58, 0.22)';
    ctx.beginPath();
    ctx.ellipse(1, 6, 11.5, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const parkaGrad = ctx.createLinearGradient(-9, -16, 9, 4);
    parkaGrad.addColorStop(0, c1);
    parkaGrad.addColorStop(1, c2);
    ctx.fillStyle = parkaGrad;
    roundedRect(ctx, -9.5, -16 - bob, 19, 19, 6.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(0, -22 - bob, 7.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, -25 - bob, 7.8, Math.PI, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < wk.carry.length; i++) {
      this.drawDetailedResource(ctx, -12, -12 - i * 6 - bob, wk.carry[i], 5.5);
    }
    ctx.restore();
  }

  private drawCustomer(ctx: CanvasRenderingContext2D, c: CustomerEntity, t: number): void {
    const bob = Math.abs(Math.sin(t * 8 + c.x * 0.05)) * 2.5;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(15, 35, 58, 0.2)';
    ctx.beginPath();
    ctx.ellipse(1, 6, 10.5, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c.coatColor;
    roundedRect(ctx, -8.5, -14 - bob, 17, 18, 6);
    ctx.fill();
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, -20.5 - bob, 6.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.hatColor;
    ctx.beginPath();
    ctx.arc(0, -23.5 - bob, 7, Math.PI, Math.PI * 2);
    ctx.fill();

    if (c.boughtIcon) {
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(c.boughtIcon, 0, -34 - bob);
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const p = engine.player;
    const bob = Math.abs(Math.sin(p.walkCycle)) * 4.2;
    const facingRight = Math.cos(p.facing) >= 0;
    const dir = facingRight ? 1 : -1;
    const speedMag = Math.hypot(p.vx, p.vy);

    ctx.save();
    ctx.translate(p.x, p.y);

    // Dash speed afterimage halo
    if (p.dashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.ellipse(-p.dashDirX * 14, -12 - p.dashDirY * 14, 15, 19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Contact shadow
    ctx.fillStyle = 'rgba(15, 35, 58, 0.28)';
    ctx.beginPath();
    ctx.ellipse(2, 8.5, 16, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.stewBuffTimer > 0) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, 7, 20, 10.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Physical swaying 3D resource stack on player's back
    const stackX = -dir * 14;
    const swayAmt = -p.vx * 0.015;
    const visibleCount = Math.min(22, p.backpack.length);
    for (let i = 0; i < visibleCount; i++) {
      const res = p.backpack[i];
      const sx = stackX + swayAmt * (i * 0.45);
      const sy = -10 - i * 5.4 - bob * 0.5;
      this.drawDetailedResource(ctx, sx, sy, res, 7.2);
    }
    if (p.backpack.length >= engine.getBackpackCapacity()) {
      ctx.font = '900 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.2;
      const topY = -21 - visibleCount * 5.4;
      ctx.strokeText('FULL', stackX, topY);
      ctx.fillText('FULL', stackX, topY);
    }

    // Trailing animated red winter scarf!
    const scarfWave = Math.sin(t * 14) * (speedMag > 15 ? 4 : 1.5);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-dir * 4, -17 - bob);
    ctx.quadraticCurveTo(-dir * 16, -15 - bob + scarfWave, -dir * (18 + Math.min(8, speedMag * 0.04)), -9 - bob + scarfWave);
    ctx.lineTo(-dir * 12, -7 - bob);
    ctx.closePath();
    ctx.fill();

    // Boots
    ctx.fillStyle = '#451a03';
    const stride = Math.sin(p.walkCycle) * 4.5;
    ctx.beginPath();
    ctx.ellipse(-4.5 + stride, 5.5, 4.8, 3.2, 0, 0, Math.PI * 2);
    ctx.ellipse(4.5 - stride, 5.5, 4.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shaded expedition parka with fur trim
    const parkaGrad = ctx.createLinearGradient(-12, -20 - bob, 12, 4 - bob);
    parkaGrad.addColorStop(0, p.hurtFlash > 0 ? '#f87171' : '#3b82f6');
    parkaGrad.addColorStop(1, p.hurtFlash > 0 ? '#b91c1c' : '#1d4ed8');
    ctx.fillStyle = parkaGrad;
    roundedRect(ctx, -12.5, -19 - bob, 25, 23, 8.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Plush white fur cuffs & hood trim
    ctx.fillStyle = '#f8fafc';
    roundedRect(ctx, -12.5, -1.5 - bob, 25, 5.5, 3);
    ctx.fill();
    roundedRect(ctx, -9.5, -20 - bob, 19, 5.5, 3);
    ctx.fill();

    // Head with soft blush & crisp eyes
    const skinGrad = ctx.createRadialGradient(-2, -28 - bob, 2, 0, -26 - bob, 10.5);
    skinGrad.addColorStop(0, '#fef3c7');
    skinGrad.addColorStop(1, '#fcd34d');
    ctx.fillStyle = skinGrad;
    ctx.beginPath();
    ctx.arc(0, -26.5 - bob, 9.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.32)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(dir * 3.5, -26.5 - bob, 1.6, 0, Math.PI * 2);
    ctx.arc(dir * 7.2, -26.5 - bob, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Shaded red winter beanie + white cuff + pom-pom
    const hatGrad = ctx.createLinearGradient(-10, -39 - bob, 10, -29 - bob);
    hatGrad.addColorStop(0, '#ef4444');
    hatGrad.addColorStop(1, '#991b1b');
    ctx.fillStyle = hatGrad;
    ctx.beginPath();
    ctx.arc(0, -29.5 - bob, 10.4, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    roundedRect(ctx, -10.5, -31.5 - bob, 21, 4.5, 2.2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-dir * 2, -41 - bob, 4, 0, Math.PI * 2);
    ctx.fill();

    // Animated swinging upgraded tool
    if (p.swingTimer > 0 && p.swingTool !== 'none') {
      const swingAngle = (p.swingTimer / 0.35) * 1.6 - 0.6;
      ctx.save();
      ctx.translate(dir * 10, -12 - bob);
      ctx.rotate(dir * swingAngle);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 3.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dir * 20, -15);
      ctx.stroke();
      ctx.fillStyle = p.swingTool === 'axe' ? '#f1f5f9' : p.swingTool === 'pick' ? '#38bdf8' : '#fde047';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(dir * 21, -16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (p.hp < p.maxHp) {
      const pct = Math.max(0, p.hp / p.maxHp);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      roundedRect(ctx, -19, -52 - bob, 38, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      roundedRect(ctx, -18, -51 - bob, 36 * pct, 4, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawDetailedResource(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    res: ResourceType | 'gold',
    r: number
  ): void {
    ctx.save();
    ctx.translate(x, y);
    if (res === 'gold') {
      const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, r);
      g.addColorStop(0, '#fef08a');
      g.addColorStop(1, '#d97706');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (res === 'wood') {
      // Shaded pine log with visible cut ring end
      ctx.fillStyle = '#8b5a2b';
      roundedRect(ctx, -r, -r * 0.55, r * 2, r * 1.1, 3);
      ctx.fill();
      ctx.strokeStyle = '#4a2912';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#e6b88a';
      ctx.beginPath();
      ctx.ellipse(r * 0.72, 0, r * 0.3, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (res === 'meat') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.95, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fecaca';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-r * 0.3, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    } else if (res === 'pelt') {
      ctx.fillStyle = '#c49a6c';
      roundedRect(ctx, -r, -r * 0.6, r * 2, r * 1.2, 4);
      ctx.fill();
      ctx.fillStyle = '#f5e1c8';
      roundedRect(ctx, -r * 0.7, -r * 0.3, r * 1.4, r * 0.6, 2);
      ctx.fill();
      ctx.strokeStyle = '#784c2a';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-r, -r * 0.6, r * 2, r * 1.2);
    } else if (res === 'crystal' || res === 'relic') {
      const col = res === 'relic' ? '#c084fc' : '#38bdf8';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.75, 0);
      ctx.lineTo(0, r * 0.95);
      ctx.lineTo(-r * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      const meta = RESOURCE_META[res];
      ctx.fillStyle = meta.color;
      ctx.strokeStyle = meta.accent;
      ctx.lineWidth = 1.5;
      roundedRect(ctx, -r, -r * 0.58, r * 2, r * 1.16, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawZoneFrontierWall(ctx: CanvasRenderingContext2D, engine: GameEngine, t: number): void {
    const unlockedZone = engine.getUnlockedZone();
    const unlockedR = engine.getUnlockedRadius();

    if (engine.thawWave.active) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 214, 102, ${engine.thawWave.alpha})`;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(0, 0, engine.thawWave.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, unlockedR + 300, 0, Math.PI * 2);
    ctx.arc(0, 0, unlockedR, 0, Math.PI * 2, true);
    ctx.fillStyle = engine.stage.palette.fogTint;
    ctx.fill('evenodd');

    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t * 18;
    ctx.strokeStyle = unlockedZone < 5 ? 'rgba(56, 189, 248, 0.82)' : 'rgba(250, 204, 21, 0.55)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, unlockedR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (unlockedZone < 5) {
      const nextExpandTier = HOMESTEAD_TIERS.find((tier) => tier.unlockZone > unlockedZone);
      if (nextExpandTier) {
        const label = `❄️ Upgrade Homestead → ${nextExpandTier.name} to Thaw Zone ${nextExpandTier.unlockZone}!`;
        ctx.save();
        ctx.font = '800 13px system-ui';
        const w = ctx.measureText(label).width + 26;
        const sx = 0;
        const sy = -unlockedR + 26;
        ctx.fillStyle = 'rgba(12, 23, 38, 0.86)';
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
      const by = b.y + 40;
      ctx.fillStyle = 'rgba(12, 23, 38, 0.9)';
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

  private drawMiniMap(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    width: number,
    height: number
  ): void {
    const r = width < 480 ? 38 : 48;
    const cx = r + 14;
    const cy = height - r - 98;
    const worldSpan = Math.max(460, engine.getUnlockedRadius() + 40);
    const scale = (r - 5) / worldSpan;

    ctx.save();
    // Frosted glass radar bezel
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 22, 38, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.clip();

    // Unlocked snow area circle
    const unlockedR = engine.getUnlockedRadius() * scale;
    ctx.fillStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.beginPath();
    ctx.arc(cx, cy, unlockedR, 0, Math.PI * 2);
    ctx.fill();

    // Buildings
    const unlockedZone = engine.getUnlockedZone();
    for (const b of engine.buildings) {
      if (b.zoneRequired > unlockedZone) continue;
      const bx = cx + b.x * scale;
      const by = cy + b.y * scale;
      ctx.fillStyle =
        b.kind === 'homestead'
          ? '#facc15'
          : b.kind === 'furnace'
            ? '#fb923c'
            : b.kind === 'trading_post'
              ? '#fde047'
              : b.kind === 'storehouse'
                ? '#38bdf8'
                : b.level > 0
                  ? '#4ade80'
                  : 'rgba(148, 163, 184, 0.7)';
      ctx.beginPath();
      ctx.arc(bx, by, b.kind === 'homestead' ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wildlife blips
    for (const w of engine.wildlife) {
      if (w.state === 'dead' || w.zone > unlockedZone) continue;
      ctx.fillStyle = w.aggressive ? '#f87171' : '#e2e8f0';
      ctx.beginPath();
      ctx.arc(cx + w.x * scale, cy + w.y * scale, w.aggressive ? 2.2 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Workers
    ctx.fillStyle = '#86efac';
    for (const wk of engine.workers) {
      ctx.beginPath();
      ctx.arc(cx + wk.x * scale, cy + wk.y * scale, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player marker
    const px = cx + engine.player.x * scale;
    const py = cy + engine.player.y * scale;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
  }
}
