import './style.css';
import { GameEngine } from './game/engine';
import { GameRenderer } from './game/renderer';
import { GameHud } from './ui/hud';
import { HomesteadTierInfo, StageDef } from './game/types';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLElement;
const ctx = canvas.getContext('2d')!;

let hud: GameHud;

const engine = new GameEngine((type, payload) => {
  if (!hud) return;
  if (type === 'toast' && typeof payload === 'string') {
    hud.showToast(payload);
  } else if (type === 'homestead_upgraded') {
    const info = payload as HomesteadTierInfo;
    hud.showToast(`🏠 ${info.name} built! ${info.description}`);
  } else if (type === 'town_crowned') {
    const data = payload as { stage: StageDef; bonusGold: number };
    hud.showTownCrowned(data.stage.id);
  }
});

const renderer = new GameRenderer();
hud = new GameHud(hudRoot, engine);

// High-DPI responsive canvas sizing
let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;

function resizeCanvas(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = Math.floor(viewWidth * dpr);
  canvas.height = Math.floor(viewHeight * dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Pointer / Touch virtual joystick on canvas
canvas.addEventListener('pointerdown', (e) => {
  if (hud.isBlockingCanvas()) return;
  canvas.setPointerCapture(e.pointerId);
  engine.startJoystick(e.pointerId, e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  engine.moveJoystick(e.pointerId, e.clientX, e.clientY);
});

const endPointer = (e: PointerEvent) => {
  engine.endJoystick(e.pointerId);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// Keyboard support (WASD + Arrows)
window.addEventListener('keydown', (e) => {
  if (hud.isBlockingCanvas()) return;
  engine.setKey(e.code, true);
});
window.addEventListener('keyup', (e) => {
  engine.setKey(e.code, false);
});
window.addEventListener('blur', () => {
  engine.clearKeys();
  engine.persistSave();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) engine.persistSave();
});

// 60fps animation loop
let lastTime = performance.now();
function loop(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  engine.update(dt);
  renderer.render(ctx, engine, viewWidth, viewHeight);
  hud.tick(dt);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
