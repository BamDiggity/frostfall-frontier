import { sfx } from './audio';
import { createInitialExplorers, EXPLORER_MISSIONS, getStageDef, STAGES } from './stages';
import {
  ALL_RESOURCES,
  BlizzardState,
  BuildingState,
  CustomerEntity,
  Ember,
  ExplorerMissionDef,
  FloatingText,
  FlyingItem,
  Footprint,
  GlobalSaveState,
  GroundLoot,
  HOMESTEAD_TIERS,
  HomesteadTier,
  Particle,
  PlayerState,
  PlayerUpgrades,
  RESOURCE_META,
  ResourceNode,
  ResourceNodeKind,
  ResourceType,
  SlashArc,
  StageDef,
  TownSaveRecord,
  WildlifeEntity,
  WildlifeKind,
  WorkerCounts,
  WorkerEntity,
  WorkerRole,
} from './types';

const SAVE_KEY = 'frostfall_frontier_save_v1';

// Deterministic PRNG so every one of the 25 towns has its own memorable handcrafted layout
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ZONE_RADII = [0, 420, 690, 960, 1220, 1340];

export interface UpgradeInfo {
  key: keyof PlayerUpgrades;
  name: string;
  icon: string;
  desc: string;
  level: number;
  maxLevel: number;
  cost: number;
  statLabel: string;
}

export interface WorkerHireInfo {
  role: WorkerRole;
  name: string;
  icon: string;
  desc: string;
  count: number;
  maxCount: number;
  cost: number;
  minTier: HomesteadTier;
}

export class GameEngine {
  public save: GlobalSaveState;
  public stage: StageDef;
  public homesteadTier: HomesteadTier = 0;
  public buildings: BuildingState[] = [];
  public nodes: ResourceNode[] = [];
  public wildlife: WildlifeEntity[] = [];
  public workers: WorkerEntity[] = [];
  public customers: CustomerEntity[] = [];
  public flyingItems: FlyingItem[] = [];
  public groundLoot: GroundLoot[] = [];
  public slashArcs: SlashArc[] = [];
  public embers: Ember[] = [];
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];
  public footprints: Footprint[] = [];
  public showCompass = true;
  public townStockpile: Partial<Record<ResourceType, number>> = {};
  public workerCounts: WorkerCounts = { lumberjack: 0, miner: 0, hunter: 0, hauler: 0, merchant: 0 };

  public player: PlayerState;
  public blizzard: BlizzardState = { active: false, timer: 55, intensity: 0 };
  public camera = { x: 0, y: 0, shake: 0 };
  public thawWave = { active: false, radius: 0, maxRadius: 0, alpha: 0 };
  public pendingTributeGold = 0;

  // Input state (joystick + keyboard)
  public inputVec = { x: 0, y: 0 };
  public joystick = { active: false, originX: 0, originY: 0, currentX: 0, currentY: 0, pointerId: -1 };
  private keysPressed = new Set<string>();

  // Timers & events
  public elapsedTime = 0;
  private nextFlyId = 1;
  private saveTimer = 0;
  private customerSpawnTimer = 4;
  private tributeTickTimer = 0;
  private onUiEvent?: (type: string, payload?: unknown) => void;

  // Cached snow particles in screen-relative coords
  public snowFlakes: { x: number; y: number; r: number; speed: number; drift: number }[] = [];

  constructor(onUiEvent?: (type: string, payload?: unknown) => void) {
    this.onUiEvent = onUiEvent;
    this.save = this.loadSave();
    sfx.muted = this.save.muted;
    this.stage = getStageDef(this.save.activeStageId);
    this.player = this.createFreshPlayer();

    for (let i = 0; i < 95; i++) {
      this.snowFlakes.push({
        x: Math.random(),
        y: Math.random(),
        r: 1.2 + Math.random() * 2.8,
        speed: 0.04 + Math.random() * 0.09,
        drift: -0.02 + Math.random() * 0.04,
      });
    }

    this.loadTownStage(this.save.activeStageId, false);
  }

  private createFreshPlayer(): PlayerState {
    return {
      x: 0,
      y: 120,
      vx: 0,
      vy: 0,
      facing: 0,
      hp: 100,
      maxHp: 100,
      warmth: 100,
      backpack: [],
      swingTimer: 0,
      swingTool: 'none',
      swingCount: 0,
      hurtFlash: 0,
      walkCycle: 0,
      footstepTimer: 0,
      transferCooldown: 0,
      stewBuffTimer: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 0,
      dashDirY: -1,
    };
  }

  private createDefaultSave(): GlobalSaveState {
    return {
      version: 1,
      activeStageId: 1,
      highestUnlockedStage: 1,
      gold: 30,
      legacyPoints: 0,
      upgrades: {
        axeLevel: 1,
        pickLevel: 1,
        weaponLevel: 1,
        packLevel: 1,
        bootsLevel: 1,
        cloakLevel: 1,
      },
      explorers: createInitialExplorers(),
      towns: {},
      totalTreesChopped: 0,
      totalAnimalsHunted: 0,
      totalGoldEarned: 0,
      muted: false,
      lastSavedAt: Date.now(),
    };
  }

  private loadSave(): GlobalSaveState {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this.createDefaultSave();
      const parsed = JSON.parse(raw) as GlobalSaveState;
      if (!parsed || typeof parsed.activeStageId !== 'number') return this.createDefaultSave();
      // Merge defaults safely
      const def = this.createDefaultSave();
      const merged: GlobalSaveState = {
        ...def,
        ...parsed,
        upgrades: { ...def.upgrades, ...(parsed.upgrades || {}) },
        explorers: Array.isArray(parsed.explorers) && parsed.explorers.length > 0 ? parsed.explorers : def.explorers,
        towns: parsed.towns || {},
      };
      // Offline tribute catch-up (capped at 4 hours so returning feels rewarding!)
      const elapsedSec = Math.min(14400, Math.max(0, (Date.now() - (merged.lastSavedAt || Date.now())) / 1000));
      if (elapsedSec > 15) {
        let totalRate = 0;
        for (const rec of Object.values(merged.towns)) {
          totalRate += rec.tributePerMin || 0;
        }
        const earned = Math.floor((totalRate / 60) * elapsedSec);
        if (earned > 0) {
          this.pendingTributeGold += earned;
        }
        // Advance explorer missions offline too
        for (const exp of merged.explorers) {
          if (exp.activeMissionId && exp.missionRemainingSec > 0) {
            exp.missionRemainingSec = Math.max(0, exp.missionRemainingSec - elapsedSec);
          }
        }
      }
      return merged;
    } catch {
      return this.createDefaultSave();
    }
  }

  public persistSave(): void {
    this.syncCurrentTownToSave();
    this.save.lastSavedAt = Date.now();
    this.save.muted = sfx.muted;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      // Ignore storage quota errors
    }
  }

  public resetAllProgress(): void {
    localStorage.removeItem(SAVE_KEY);
    this.save = this.createDefaultSave();
    this.pendingTributeGold = 0;
    this.loadTownStage(1, false);
    this.persistSave();
    this.emitUi('toast', 'Fresh frontier started!');
  }

  private emitUi(type: string, payload?: unknown): void {
    if (this.onUiEvent) this.onUiEvent(type, payload);
  }

  // ==================== DERIVED PLAYER STATS ====================

  public getTotalHomesteadStars(): number {
    let stars = this.homesteadTier;
    for (const [idStr, rec] of Object.entries(this.save.towns)) {
      if (Number(idStr) === this.stage.id) continue;
      stars += rec.homesteadTier || 0;
    }
    return stars;
  }

  public getEmpireTownCount(): number {
    let count = this.homesteadTier >= 5 ? 1 : 0;
    for (const [idStr, rec] of Object.entries(this.save.towns)) {
      if (Number(idStr) === this.stage.id) continue;
      if (rec.reachedTownHall || rec.homesteadTier >= 5) count += 1;
    }
    return count;
  }

  public getEmpireMultiplier(): number {
    return (
      1 +
      this.getTotalHomesteadStars() * 0.05 +
      this.getEmpireTownCount() * 0.15 +
      this.save.legacyPoints * 0.02
    );
  }

  public getUnlockedZone(): number {
    return HOMESTEAD_TIERS[this.homesteadTier].unlockZone;
  }

  public getUnlockedRadius(): number {
    return ZONE_RADII[this.getUnlockedZone()];
  }

  public getBackpackCapacity(): number {
    return 10 + (this.save.upgrades.packLevel - 1) * 5;
  }

  public getPlayerSpeed(): number {
    const base = 185 + (this.save.upgrades.bootsLevel - 1) * 20;
    const furnace = this.buildings.find((b) => b.kind === 'furnace');
    const hearthOverdrive = (furnace?.overdriveTimer || 0) > 0 ? 1.25 : 1.0;
    const stewMult = this.player.stewBuffTimer > 0 ? 1.25 : 1.0;
    const coldMult = this.player.warmth < 25 ? 0.75 : 1.0;
    return base * hearthOverdrive * stewMult * coldMult;
  }

  public triggerDash(): boolean {
    const p = this.player;
    if (p.dashCooldown > 0 || p.dashTimer > 0) return false;
    const iv = this.computeInputVector();
    const len = Math.hypot(iv.x, iv.y);
    if (len > 0.1) {
      p.dashDirX = iv.x / len;
      p.dashDirY = iv.y / len;
    } else {
      p.dashDirX = Math.cos(p.facing);
      p.dashDirY = Math.sin(p.facing);
    }
    p.facing = Math.atan2(p.dashDirY, p.dashDirX);
    p.dashTimer = 0.21;
    p.dashCooldown = 1.65;
    sfx.playDash();
    this.spawnBurst(p.x, p.y + 4, '#e0f2fe', 10);
    return true;
  }

  public getObjectiveTarget(): { x: number; y: number; label: string; color: string } | null {
    if (!this.showCompass) return null;
    const p = this.player;
    const unlockedZone = this.getUnlockedZone();
    const home = this.buildings.find((b) => b.kind === 'homestead');

    // 1. If backpack is full, guide to Storehouse or Trading Sled
    if (p.backpack.length >= this.getBackpackCapacity()) {
      const store = this.buildings.find((b) => b.kind === 'storehouse');
      if (store) return { x: store.x, y: store.y, label: 'Store Pack', color: '#38bdf8' };
    }

    // 2. If Homestead upgrade is ready, guide straight to Homestead!
    if (home && home.level < 5) {
      const cost = this.getBuildingNextCost(home);
      let ready = this.save.gold >= Math.max(0, cost.gold - home.depositedGold);
      let missingRes: ResourceType | null = null;
      for (const [k, v] of Object.entries(cost.resources)) {
        const res = k as ResourceType;
        const rem = Math.max(0, (v || 0) - (home.deposited[res] || 0));
        if (rem > 0 && this.getTotalAvailableResource(res) < rem) {
          ready = false;
          if (!missingRes) missingRes = res;
        }
      }
      if (ready) {
        return { x: home.x, y: home.y, label: 'Upgrade Homestead!', color: '#facc15' };
      }
      // Guide to nearest missing resource node or wildlife!
      if (missingRes === 'meat' || missingRes === 'pelt') {
        const prey = this.wildlife
          .filter((w) => w.state !== 'dead' && w.zone <= unlockedZone)
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (prey) return { x: prey.x, y: prey.y, label: `Hunt ${missingRes}`, color: '#fb7185' };
      } else if (missingRes && ['wood', 'coal', 'iron', 'crystal'].includes(missingRes)) {
        const node = this.nodes
          .filter((n) => n.respawnTimer <= 0 && n.zone <= unlockedZone && n.resource === missingRes)
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (node) return { x: node.x, y: node.y, label: `Gather ${RESOURCE_META[missingRes].shortName}`, color: '#4ade80' };
      } else if (missingRes) {
        // Refined resource -> point to its producer building!
        const producer = this.buildings.find((b) => b.outputType === missingRes && b.zoneRequired <= unlockedZone);
        if (producer) return { x: producer.x, y: producer.y, label: producer.name, color: '#a78bfa' };
      } else if (this.save.gold < Math.max(0, cost.gold - home.depositedGold)) {
        const trade = this.buildings.find((b) => b.kind === 'trading_post');
        if (trade && p.backpack.length > 0) return { x: trade.x, y: trade.y, label: 'Sell for Gold', color: '#facc15' };
      }
    }

    // 3. Unbuilt unlocked business plot
    const unbuilt = this.buildings.find((b) => b.level === 0 && b.zoneRequired <= unlockedZone);
    if (unbuilt) return { x: unbuilt.x, y: unbuilt.y, label: `Build ${unbuilt.name}`, color: '#38bdf8' };
    return null;
  }

  public getAxeDamage(): number {
    return (16 + (this.save.upgrades.axeLevel - 1) * 11) * this.getEmpireMultiplier();
  }

  public getPickDamage(): number {
    return (14 + (this.save.upgrades.pickLevel - 1) * 10) * this.getEmpireMultiplier();
  }

  public getWeaponDamage(): number {
    const lodge = this.buildings.find((b) => b.kind === 'hunters_lodge');
    const lodgeBonus = lodge && lodge.level > 0 ? 1 + lodge.level * 0.2 : 1;
    return (18 + (this.save.upgrades.weaponLevel - 1) * 13) * lodgeBonus * this.getEmpireMultiplier();
  }

  public getWarmthResistance(): number {
    const tannery = this.buildings.find((b) => b.kind === 'tannery');
    const coatBonus = tannery && tannery.level > 0 ? tannery.level * 0.12 : 0;
    return Math.min(0.85, (this.save.upgrades.cloakLevel - 1) * 0.14 + coatBonus);
  }

  public getTradeGoldMultiplier(): number {
    const merchants = this.workerCounts.merchant;
    const stageGoldBonus = this.stage.bonusType === 'gold' ? 1.25 : this.stage.bonusType === 'all' ? 1.15 : 1.0;
    return (1 + merchants * 0.18) * stageGoldBonus * this.getEmpireMultiplier();
  }

  public getFurnaceRadius(): number {
    const furnace = this.buildings.find((b) => b.kind === 'furnace');
    if (!furnace) return 220;
    const fuelRatio = furnace.fuel > 0 ? 0.55 + 0.45 * (furnace.fuel / furnace.maxFuel) : 0.25;
    return (210 + furnace.level * 55) * fuelRatio;
  }

  public getTownTributePerMin(): number {
    if (this.homesteadTier < 1) return 0;
    const builtCount = this.buildings.filter((b) => b.level > 0).reduce((s, b) => s + b.level, 0);
    const workerTotal =
      this.workerCounts.lumberjack +
      this.workerCounts.miner +
      this.workerCounts.hunter +
      this.workerCounts.hauler +
      this.workerCounts.merchant;
    const base =
      this.homesteadTier * 18 +
      builtCount * 9 +
      workerTotal * 14 +
      (this.homesteadTier >= 5 ? 90 : 0);
    return Math.round(base * (1 + (this.stage.id - 1) * 0.18));
  }

  public getTotalPassiveTributePerMin(): number {
    let total = 0;
    for (const [idStr, rec] of Object.entries(this.save.towns)) {
      if (Number(idStr) === this.stage.id) continue;
      total += rec.tributePerMin || 0;
    }
    return total;
  }

  // ==================== STAGE / TOWN LOADING ====================

  private syncCurrentTownToSave(): void {
    const buildingLevels: Record<string, number> = {};
    const buildingDeposits: Record<string, { res: Partial<Record<ResourceType, number>>; gold: number }> = {};
    for (const b of this.buildings) {
      buildingLevels[b.id] = b.level;
      buildingDeposits[b.id] = { res: { ...b.deposited }, gold: b.depositedGold };
    }
    const existing = this.save.towns[this.stage.id];
    const reachedTownHall = Boolean(existing?.reachedTownHall || this.homesteadTier >= 5);
    this.save.towns[this.stage.id] = {
      stageId: this.stage.id,
      homesteadTier: this.homesteadTier,
      buildingLevels,
      buildingDeposits,
      workers: { ...this.workerCounts },
      townStockpile: { ...this.townStockpile },
      tributePerMin: this.getTownTributePerMin(),
      reachedTownHall,
    };
  }

  public loadTownStage(stageId: number, savePrevious = true): void {
    if (savePrevious && this.buildings.length > 0) {
      this.syncCurrentTownToSave();
    }
    this.stage = getStageDef(stageId);
    this.save.activeStageId = this.stage.id;

    const rec = this.save.towns[this.stage.id];
    this.homesteadTier = rec ? rec.homesteadTier : 0;
    this.workerCounts = rec
      ? { ...rec.workers }
      : { lumberjack: 0, miner: 0, hunter: 0, hauler: 0, merchant: 0 };
    this.townStockpile = rec ? { ...rec.townStockpile } : {};

    this.buildings = this.buildTownStructures(rec);
    this.nodes = [];
    this.wildlife = [];
    this.workers = [];
    this.customers = [];
    this.flyingItems = [];
    this.groundLoot = [];
    this.slashArcs = [];
    this.embers = [];
    this.particles = [];
    this.floatingTexts = [];
    this.footprints = [];

    this.generateWorldContent();
    this.rebuildWorkerEntities();

    this.player = this.createFreshPlayer();
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.blizzard = { active: false, timer: this.stage.id === 1 ? 85 : 60, intensity: 0 };
    this.thawWave = { active: false, radius: 0, maxRadius: 0, alpha: 0 };

    this.persistSave();
    this.emitUi('stage_changed', this.stage);
  }

  private buildTownStructures(rec?: TownSaveRecord): BuildingState[] {
    const list: BuildingState[] = [
      {
        id: 'homestead',
        kind: 'homestead',
        name: 'Homestead',
        x: 0,
        y: -75,
        radius: 56,
        zoneRequired: 1,
        level: rec ? rec.homesteadTier : 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'furnace',
        kind: 'furnace',
        name: 'Hearth Furnace',
        x: 0,
        y: 55,
        radius: 36,
        zoneRequired: 1,
        level: 1,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 100,
        maxFuel: 100,
        bounceAnim: 0,
      },
      {
        id: 'storehouse',
        kind: 'storehouse',
        name: 'Camp Storehouse',
        x: -160,
        y: 25,
        radius: 42,
        zoneRequired: 1,
        level: 1,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'trading_post',
        kind: 'trading_post',
        name: 'Trading Sled',
        x: 165,
        y: 25,
        radius: 44,
        zoneRequired: 1,
        level: 1,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      // Zone 2 (Log Cabin unlocks)
      {
        id: 'sawmill',
        kind: 'sawmill',
        name: 'Timber Sawmill',
        x: -245,
        y: -210,
        radius: 46,
        zoneRequired: 2,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputRecipe: { wood: 2 },
        outputType: 'plank',
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 2.2,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'hunters_lodge',
        kind: 'hunters_lodge',
        name: "Hunter's Lodge",
        x: 260,
        y: -215,
        radius: 46,
        zoneRequired: 2,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      // Zone 3 (Stone House unlocks)
      {
        id: 'smeltery',
        kind: 'smeltery',
        name: 'Iron Smeltery',
        x: -385,
        y: 165,
        radius: 48,
        zoneRequired: 3,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputRecipe: { iron: 2, coal: 1 },
        outputType: 'steel',
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 2.8,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'tannery',
        kind: 'tannery',
        name: 'Fur Tannery',
        x: 385,
        y: 165,
        radius: 48,
        zoneRequired: 3,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputRecipe: { pelt: 2 },
        outputType: 'coat',
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 2.5,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      // Zone 4 (Grand Mansion unlocks)
      {
        id: 'tavern',
        kind: 'tavern',
        name: 'Hearth Tavern',
        x: -255,
        y: 385,
        radius: 48,
        zoneRequired: 4,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputRecipe: { meat: 2, wood: 1 },
        outputType: 'stew',
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 2.6,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'artisan_guild',
        kind: 'artisan_guild',
        name: 'Artisan Guild',
        x: 260,
        y: 385,
        radius: 48,
        zoneRequired: 4,
        level: 0,
        maxLevel: 5,
        deposited: {},
        depositedGold: 0,
        inputRecipe: { crystal: 2, steel: 1 },
        outputType: 'relic',
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 3.4,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
      {
        id: 'explorers_guild',
        kind: 'explorers_guild',
        name: "Explorer's Hall",
        x: 0,
        y: -380,
        radius: 50,
        zoneRequired: 4,
        level: 0,
        maxLevel: 3,
        deposited: {},
        depositedGold: 0,
        inputBuffer: {},
        outputStock: 0,
        processTimer: 0,
        processDuration: 0,
        fuel: 0,
        maxFuel: 0,
        bounceAnim: 0,
      },
    ];

    if (rec) {
      for (const b of list) {
        if (rec.buildingLevels[b.id] !== undefined) {
          b.level = rec.buildingLevels[b.id];
        }
        if (rec.buildingDeposits[b.id]) {
          b.deposited = { ...rec.buildingDeposits[b.id].res };
          b.depositedGold = rec.buildingDeposits[b.id].gold || 0;
        }
      }
      // Keep homestead synced
      const home = list.find((b) => b.kind === 'homestead');
      if (home) home.level = rec.homesteadTier;
    }

    return list;
  }

  public getBuildingNextCost(b: BuildingState): { resources: Partial<Record<ResourceType, number>>; gold: number } {
    const scale = this.stage.difficultyScale;
    if (b.kind === 'homestead') {
      const nextTier = Math.min(5, b.level + 1);
      const info = HOMESTEAD_TIERS[nextTier];
      const resources: Partial<Record<ResourceType, number>> = {};
      for (const [k, v] of Object.entries(info.baseCosts)) {
        resources[k as ResourceType] = Math.max(1, Math.round((v || 0) * (0.75 + scale * 0.25)));
      }
      const gold = Math.round(info.baseGoldCost * scale);
      return { resources, gold };
    }

    const lvl = b.level; // 0 = build, 1+ = upgrade
    const mult = Math.pow(1.65, lvl) * (0.8 + scale * 0.2);
    switch (b.kind) {
      case 'furnace':
        return { resources: { wood: Math.round(16 * mult), coal: lvl >= 2 ? Math.round(8 * mult) : 0 }, gold: Math.round(60 * mult) };
      case 'storehouse':
        return { resources: { wood: Math.round(12 * mult) }, gold: Math.round(55 * mult) };
      case 'trading_post':
        return { resources: { wood: Math.round(14 * mult) }, gold: Math.round(75 * mult) };
      case 'sawmill':
        return { resources: { wood: Math.round(20 * mult) }, gold: Math.round(90 * mult) };
      case 'hunters_lodge':
        return { resources: { wood: Math.round(18 * mult), pelt: Math.round(6 * mult) }, gold: Math.round(120 * mult) };
      case 'smeltery':
        return { resources: { plank: Math.round(10 * mult), coal: Math.round(12 * mult) }, gold: Math.round(240 * mult) };
      case 'tannery':
        return { resources: { plank: Math.round(10 * mult), pelt: Math.round(10 * mult) }, gold: Math.round(220 * mult) };
      case 'tavern':
        return { resources: { plank: Math.round(14 * mult), meat: Math.round(12 * mult) }, gold: Math.round(420 * mult) };
      case 'artisan_guild':
        return { resources: { steel: Math.round(8 * mult), crystal: Math.round(8 * mult) }, gold: Math.round(580 * mult) };
      case 'explorers_guild':
        return { resources: { plank: Math.round(16 * mult), steel: Math.round(10 * mult), coat: Math.round(6 * mult) }, gold: Math.round(650 * mult) };
    }
  }

  private generateWorldContent(): void {
    const rand = mulberry32(this.stage.seed);
    const scale = this.stage.difficultyScale;
    let nodeIdx = 0;

    const isClearOfBuildings = (x: number, y: number, pad = 95): boolean => {
      for (const b of this.buildings) {
        if (Math.hypot(x - b.x, y - b.y) < b.radius + pad) return false;
      }
      if (Math.hypot(x, y - 120) < 95) return false; // player spawn
      return true;
    };

    const isClearOfNodes = (x: number, y: number, minDist = 56): boolean => {
      for (const n of this.nodes) {
        if (Math.hypot(x - n.x, y - n.y) < minDist) return false;
      }
      return true;
    };

    const spawnRing = (
      kind: ResourceNodeKind,
      resource: ResourceType,
      zone: number,
      count: number,
      minR: number,
      maxR: number,
      hp: number,
      yieldAmt: number,
      respawnSec: number
    ) => {
      let placed = 0;
      let attempts = 0;
      while (placed < count && attempts < count * 20) {
        attempts++;
        const angle = rand() * Math.PI * 2;
        const r = minR + rand() * (maxR - minR);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (!isClearOfBuildings(x, y, 78) || !isClearOfNodes(x, y, 58)) continue;
        this.nodes.push({
          id: `node_${nodeIdx++}`,
          kind,
          resource,
          x,
          y,
          zone,
          hp,
          maxHp: hp,
          yieldAmount: yieldAmt,
          respawnTimer: 0,
          respawnDuration: respawnSec,
          shakeTimer: 0,
          scale: 0.88 + rand() * 0.28,
          variant: Math.floor(rand() * 3),
        });
        placed++;
      }
    };

    // Zone 1: Pine Clearing (lots of trees right around camp!)
    spawnRing('pine', 'wood', 1, 20, 175, 390, Math.round(30 * scale), 3, 11);

    // Zone 2: Timber Ridge & Coal Seam
    spawnRing('pine', 'wood', 2, 18, 435, 655, Math.round(42 * scale), 4, 12);
    spawnRing('coal_vein', 'coal', 2, 13, 445, 655, Math.round(52 * scale), 3, 15);

    // Zone 3: Iron Quarry & Bear Hollow
    spawnRing('iron_vein', 'iron', 3, 15, 710, 920, Math.round(74 * scale), 3, 18);
    spawnRing('coal_vein', 'coal', 3, 8, 710, 920, Math.round(60 * scale), 4, 15);
    spawnRing('ancient_pine', 'wood', 3, 10, 710, 920, Math.round(62 * scale), 6, 14);

    // Zone 4: Crystal Glade & Frost Spire
    spawnRing('crystal_spire', 'crystal', 4, 14, 985, 1190, Math.round(105 * scale), 3, 22);
    spawnRing('ancient_pine', 'wood', 4, 10, 985, 1190, Math.round(72 * scale), 7, 15);
    spawnRing('iron_vein', 'iron', 4, 8, 985, 1190, Math.round(85 * scale), 4, 18);

    // Wildlife across zones
    let wildIdx = 0;
    const spawnWildlife = (kind: WildlifeKind, zone: number, count: number, minR: number, maxR: number) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand() * 0.7;
        const r = minR + rand() * (maxR - minR);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        const spec = this.getWildlifeSpec(kind, scale);
        this.wildlife.push({
          id: `wild_${wildIdx++}`,
          kind,
          x,
          y,
          homeX: x,
          homeY: y,
          vx: 0,
          vy: 0,
          zone,
          hp: spec.hp,
          maxHp: spec.hp,
          speed: spec.speed,
          aggressive: spec.aggressive,
          attackDamage: spec.damage,
          attackCooldown: 0,
          telegraphTimer: 0,
          telegraphX: x,
          telegraphY: y,
          hitFlash: 0,
          facing: rand() * Math.PI * 2,
          state: 'wander',
          stateTimer: 1 + rand() * 2,
          respawnTimer: 0,
          dropMeat: spec.meat,
          dropPelt: spec.pelt,
          dropBonus: spec.bonus,
          dropGold: spec.gold,
          radius: spec.radius,
        });
      }
    };

    spawnWildlife('rabbit', 1, 5, 210, 380);
    spawnWildlife('deer', 2, 6, 460, 650);
    spawnWildlife('boar', 3, 4, 725, 905);
    spawnWildlife('bear', 3, 3, 760, 920);
    spawnWildlife('dire_wolf', 4, 4, 1005, 1175);
    spawnWildlife('yeti', 4, 2, 1060, 1185);
  }

  private getWildlifeSpec(kind: WildlifeKind, scale: number) {
    switch (kind) {
      case 'rabbit':
        return { hp: Math.round(24 * scale), speed: 105, aggressive: false, damage: 0, meat: 1, pelt: 1, gold: 4, radius: 13 };
      case 'deer':
        return { hp: Math.round(48 * scale), speed: 122, aggressive: false, damage: 0, meat: 2, pelt: 2, gold: 10, radius: 18 };
      case 'boar':
        return { hp: Math.round(85 * scale), speed: 102, aggressive: true, damage: 14, meat: 3, pelt: 3, gold: 20, radius: 19 };
      case 'bear':
        return { hp: Math.round(150 * scale), speed: 88, aggressive: true, damage: 22, meat: 5, pelt: 5, gold: 42, radius: 26 };
      case 'dire_wolf':
        return { hp: Math.round(135 * scale), speed: 126, aggressive: true, damage: 20, meat: 4, pelt: 5, bonus: 'crystal' as ResourceType, gold: 48, radius: 20 };
      case 'yeti':
        return { hp: Math.round(280 * scale), speed: 82, aggressive: true, damage: 30, meat: 6, pelt: 7, bonus: 'crystal' as ResourceType, gold: 110, radius: 32 };
    }
  }

  // ==================== INPUT HANDLING ====================

  public setKey(code: string, down: boolean): void {
    if (down) this.keysPressed.add(code);
    else this.keysPressed.delete(code);
  }

  public clearKeys(): void {
    this.keysPressed.clear();
  }

  public startJoystick(pointerId: number, x: number, y: number): void {
    sfx.unlock();
    this.joystick = { active: true, originX: x, originY: y, currentX: x, currentY: y, pointerId };
  }

  public moveJoystick(pointerId: number, x: number, y: number): void {
    if (!this.joystick.active || this.joystick.pointerId !== pointerId) return;
    this.joystick.currentX = x;
    this.joystick.currentY = y;
  }

  public endJoystick(pointerId: number): void {
    if (this.joystick.pointerId !== pointerId) return;
    this.joystick.active = false;
    this.joystick.pointerId = -1;
  }

  private computeInputVector(): { x: number; y: number } {
    let ix = 0;
    let iy = 0;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) iy -= 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) iy += 1;
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) ix -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) ix += 1;

    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy);
      return { x: ix / len, y: iy / len };
    }

    if (this.joystick.active) {
      const dx = this.joystick.currentX - this.joystick.originX;
      const dy = this.joystick.currentY - this.joystick.originY;
      const dist = Math.hypot(dx, dy);
      if (dist > 6) {
        const maxDist = 58;
        const mag = Math.min(1, dist / maxDist);
        return { x: (dx / dist) * mag, y: (dy / dist) * mag };
      }
    }
    return { x: 0, y: 0 };
  }

  // ==================== MAIN SIMULATION TICK ====================

  public update(rawDt: number): void {
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.elapsedTime += dt;

    this.updateBlizzard(dt);
    this.updatePlayer(dt);
    this.updateNodes(dt);
    this.updateWildlife(dt);
    this.updateBuildings(dt);
    this.updateWorkers(dt);
    this.updateCustomers(dt);
    this.updateExplorers(dt);
    this.updateVisualFx(dt);
    this.updateCamera(dt);

    // Passive tribute from other towns
    this.tributeTickTimer += dt;
    if (this.tributeTickTimer >= 5) {
      this.tributeTickTimer = 0;
      const rate = this.getTotalPassiveTributePerMin();
      if (rate > 0) {
        const gain = Math.max(1, Math.round((rate / 60) * 5));
        this.pendingTributeGold += gain;
      }
    }

    // Periodic autosave
    this.saveTimer += dt;
    if (this.saveTimer >= 6) {
      this.saveTimer = 0;
      this.persistSave();
    }
  }

  private updateBlizzard(dt: number): void {
    this.blizzard.timer -= dt;
    if (this.blizzard.timer <= 0) {
      this.blizzard.active = !this.blizzard.active;
      this.blizzard.timer = this.blizzard.active ? 18 : 62 + Math.random() * 25;
      if (this.blizzard.active) {
        this.emitUi('toast', '❄️ Blizzard incoming! Stay near the Furnace or upgrade your Cloak.');
      }
    }
    const target = this.blizzard.active ? 1 : 0;
    this.blizzard.intensity += (target - this.blizzard.intensity) * Math.min(1, dt * 1.4);

    // Animate snow
    const speedMult = 1 + this.blizzard.intensity * 2.8;
    const wind = 0.015 + this.blizzard.intensity * 0.24;
    for (const f of this.snowFlakes) {
      f.y += f.speed * speedMult * dt;
      f.x += (f.drift + wind) * dt;
      if (f.y > 1.05) {
        f.y = -0.05;
        f.x = Math.random();
      }
      if (f.x > 1.05) f.x = -0.05;
      if (f.x < -0.05) f.x = 1.05;
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    this.inputVec = this.computeInputVector();
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);

    const speed = this.getPlayerSpeed();
    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.vx = p.dashDirX * speed * 2.85;
      p.vy = p.dashDirY * speed * 2.85;
      if (Math.random() < 0.75) {
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * 14,
          y: p.y + 4,
          vx: -p.vx * 0.12,
          vy: -p.vy * 0.12 - 15,
          size: 3.2,
          color: '#e0f2fe',
          alpha: 0.85,
          life: 0.25,
          maxLife: 0.25,
          gravity: 110,
        });
      }
    } else {
      p.vx = this.inputVec.x * speed;
      p.vy = this.inputVec.y * speed;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Keep inside unlocked zone boundary
    const maxR = this.getUnlockedRadius() - 22;
    const distFromOrigin = Math.hypot(p.x, p.y);
    if (distFromOrigin > maxR) {
      p.x = (p.x / distFromOrigin) * maxR;
      p.y = (p.y / distFromOrigin) * maxR;
    }

    // Soft push out of solid building centers (keep outer pad walkable!)
    for (const b of this.buildings) {
      if (b.zoneRequired > this.getUnlockedZone()) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const dist = Math.hypot(dx, dy);
      const solidR = b.level > 0 ? b.radius * 0.45 : 16;
      if (dist < solidR && dist > 0.01) {
        p.x = b.x + (dx / dist) * solidR;
        p.y = b.y + (dy / dist) * solidR;
      }
    }

    const moving = Math.hypot(p.vx, p.vy) > 12;
    if (moving) {
      p.facing = Math.atan2(p.vy, p.vx);
      p.walkCycle += dt * 11;
      p.footstepTimer -= dt;
      if (p.footstepTimer <= 0) {
        p.footstepTimer = 0.19;
        this.footprints.push({ x: p.x, y: p.y + 10, angle: p.facing, life: 4.5 });
      }
    } else {
      p.walkCycle = 0;
    }

    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3);
    if (p.stewBuffTimer > 0) p.stewBuffTimer = Math.max(0, p.stewBuffTimer - dt);
    if (p.transferCooldown > 0) p.transferCooldown = Math.max(0, p.transferCooldown - dt);

    // Warmth & HP regen near furnace
    const furnace = this.buildings.find((b) => b.kind === 'furnace');
    const distFurnace = furnace ? Math.hypot(p.x - furnace.x, p.y - furnace.y) : 9999;
    const inWarmth = distFurnace <= this.getFurnaceRadius();

    if (inWarmth) {
      p.warmth = Math.min(100, p.warmth + dt * 26);
      p.hp = Math.min(p.maxHp, p.hp + dt * 14);
    } else {
      const resist = 1 - this.getWarmthResistance();
      const drain = (2.1 + this.blizzard.intensity * 6.5) * this.stage.coldIntensity * resist;
      p.warmth = Math.max(0, p.warmth - drain * dt);
      if (p.warmth <= 0) {
        p.hp = Math.max(10, p.hp - dt * 3.5);
      }
    }

    // Auto-swing tool (prioritize wildlife in range, then resource nodes!)
    p.swingTimer = Math.max(0, p.swingTimer - dt);
    if (p.swingTimer <= 0) {
      const didAction = this.tryPlayerAutoAction();
      if (didAction) {
        p.swingTimer = Math.max(0.22, 0.42 - (this.save.upgrades.axeLevel - 1) * 0.025);
      }
    }

    // Building pad interactions
    if (p.transferCooldown <= 0) {
      this.handlePlayerBuildingInteractions();
    }
  }

  private tryPlayerAutoAction(): boolean {
    const p = this.player;
    const unlockedZone = this.getUnlockedZone();

    // 1. Check nearby wildlife for hunting!
    let closestWild: WildlifeEntity | null = null;
    let closestWildDist = 76;
    for (const w of this.wildlife) {
      if (w.state === 'dead' || w.zone > unlockedZone) continue;
      const d = Math.hypot(w.x - p.x, w.y - p.y) - w.radius;
      if (d < closestWildDist) {
        closestWildDist = d;
        closestWild = w;
      }
    }

    if (closestWild) {
      const ang = Math.atan2(closestWild.y - p.y, closestWild.x - p.x);
      p.facing = ang;
      p.swingTool = 'spear';
      p.swingCount += 1;
      const crit = p.swingCount % 4 === 0;
      const dmg = this.getWeaponDamage() * (crit ? 1.55 : 1);
      this.spawnSlashArc(p.x, p.y - 10, ang, 46, crit ? '#facc15' : '#fda4af', crit);
      if (crit) {
        sfx.playCrit();
        this.spawnFloatingText(closestWild.x, closestWild.y - 34, 'CRIT!', '#facc15', 1.2);
      }
      this.damageWildlife(closestWild, dmg, true);
      return true;
    }

    // 2. Check nearby resource nodes if backpack has space
    if (p.backpack.length >= this.getBackpackCapacity()) {
      return false;
    }

    let closestNode: ResourceNode | null = null;
    let closestNodeDist = 66;
    for (const n of this.nodes) {
      if (n.respawnTimer > 0 || n.zone > unlockedZone) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < closestNodeDist) {
        closestNodeDist = d;
        closestNode = n;
      }
    }

    if (closestNode) {
      const ang = Math.atan2(closestNode.y - p.y, closestNode.x - p.x);
      p.facing = ang;
      const isTree = closestNode.kind === 'pine' || closestNode.kind === 'ancient_pine';
      p.swingTool = isTree ? 'axe' : 'pick';
      p.swingCount += 1;
      const crit = p.swingCount % 4 === 0;
      const baseDmg = isTree ? this.getAxeDamage() : this.getPickDamage();
      const dmg = baseDmg * (crit ? 1.55 : 1);
      this.spawnSlashArc(p.x, p.y - 10, ang, 42, crit ? '#facc15' : isTree ? '#e2e8f0' : '#7dd3fc', crit);
      if (crit) {
        sfx.playCrit();
        this.spawnFloatingText(closestNode.x, closestNode.y - 34, 'CRIT!', '#facc15', 1.15);
      }
      this.damageNode(closestNode, dmg, true);
      return true;
    }

    p.swingTool = 'none';
    return false;
  }

  private damageNode(node: ResourceNode, dmg: number, byPlayer: boolean): void {
    node.hp -= dmg;
    node.shakeTimer = 0.22;
    const isTree = node.kind === 'pine' || node.kind === 'ancient_pine';

    if (byPlayer) {
      if (isTree) sfx.playChop();
      else sfx.playMine();
      this.camera.shake = Math.min(4, this.camera.shake + 1.6);
    }

    // Chips / sparks
    const meta = RESOURCE_META[node.resource];
    this.spawnBurst(node.x, node.y - 12, meta.accent, isTree ? 5 : 6);

    if (node.hp <= 0) {
      node.respawnTimer = node.respawnDuration;
      let yieldAmt = node.yieldAmount;
      if (
        (isTree && (this.stage.bonusType === 'wood' || this.stage.bonusType === 'all')) ||
        (!isTree && (this.stage.bonusType === 'mine' || this.stage.bonusType === 'all'))
      ) {
        yieldAmt = Math.ceil(yieldAmt * 1.25);
      }

      if (byPlayer) {
        if (isTree) this.save.totalTreesChopped += 1;
        this.spawnGroundLoot(node.resource, yieldAmt, node.x, node.y - 8);
      } else {
        this.addStockpile(node.resource, yieldAmt);
      }
      this.spawnBurst(node.x, node.y - 14, meta.color, 10);
    }
  }

  private damageWildlife(w: WildlifeEntity, dmg: number, byPlayer: boolean): void {
    w.hp -= dmg;
    w.hitFlash = 0.22;
    if (byPlayer) {
      sfx.playHuntHit();
      this.camera.shake = Math.min(5, this.camera.shake + 2.2);
    }
    this.spawnBurst(w.x, w.y - 8, '#ff7b7b', 6);

    // Non-aggressive animals bolt away when hit
    if (!w.aggressive && w.state !== 'dead') {
      w.state = 'flee';
      w.stateTimer = 2.2;
      const angle = Math.atan2(w.y - this.player.y, w.x - this.player.x);
      w.vx = Math.cos(angle) * w.speed * 1.35;
      w.vy = Math.sin(angle) * w.speed * 1.35;
    }

    if (w.hp <= 0) {
      w.state = 'dead';
      w.respawnTimer = w.kind === 'yeti' ? 28 : w.kind === 'bear' ? 22 : 14;
      const huntMult = this.stage.bonusType === 'hunt' || this.stage.bonusType === 'all' ? 1.3 : 1;
      const meat = Math.ceil(w.dropMeat * huntMult);
      const pelt = Math.ceil(w.dropPelt * huntMult);
      const gold = Math.round(w.dropGold * this.getTradeGoldMultiplier());

      if (byPlayer) {
        this.save.totalAnimalsHunted += 1;
        this.spawnGroundLoot('meat', meat, w.x, w.y);
        this.spawnGroundLoot('pelt', pelt, w.x, w.y);
        if (w.dropBonus) this.spawnGroundLoot(w.dropBonus, 2, w.x, w.y);
        this.addGold(gold, w.x, w.y - 18);
        sfx.playCoin();
      } else {
        this.addStockpile('meat', meat);
        this.addStockpile('pelt', pelt);
        if (w.dropBonus) this.addStockpile(w.dropBonus, 1);
      }
      this.spawnBurst(w.x, w.y - 10, '#f4d6bc', 14);
    }
  }

  public givePlayerResource(type: ResourceType, amount: number, fromX: number, fromY: number): void {
    const cap = this.getBackpackCapacity();
    let intoPack = 0;
    let intoStock = 0;
    for (let i = 0; i < amount; i++) {
      if (this.player.backpack.length < cap) {
        this.player.backpack.push(type);
        intoPack++;
        this.spawnFlyingItem(type, fromX, fromY, this.player.x, this.player.y - 26);
      } else {
        this.addStockpile(type, 1);
        intoStock++;
      }
    }
    if (intoPack > 0) {
      sfx.playPop(this.player.backpack.length);
      this.spawnFloatingText(
        fromX,
        fromY - 22,
        `+${intoPack} ${RESOURCE_META[type].shortName}`,
        RESOURCE_META[type].accent
      );
    }
    if (intoStock > 0) {
      this.spawnFloatingText(fromX, fromY - 38, `+${intoStock} → Camp`, '#cbd5e1', 0.85);
    }
  }

  public addStockpile(type: ResourceType, amount: number): void {
    this.townStockpile[type] = (this.townStockpile[type] || 0) + amount;
  }

  public getTotalAvailableResource(type: ResourceType): number {
    let packCount = 0;
    for (const r of this.player.backpack) if (r === type) packCount++;
    return packCount + (this.townStockpile[type] || 0);
  }

  private consumePlayerOrStockpile(type: ResourceType, count: number, targetX: number, targetY: number): number {
    let taken = 0;
    while (taken < count) {
      const idx = this.player.backpack.lastIndexOf(type);
      if (idx >= 0) {
        this.player.backpack.splice(idx, 1);
        this.spawnFlyingItem(type, this.player.x, this.player.y - 24, targetX, targetY);
        taken++;
      } else if ((this.townStockpile[type] || 0) > 0) {
        this.townStockpile[type] = (this.townStockpile[type] || 0) - 1;
        this.spawnFlyingItem(type, 0, -60, targetX, targetY);
        taken++;
      } else {
        break;
      }
    }
    return taken;
  }

  public addGold(amount: number, x?: number, y?: number): void {
    if (amount <= 0) return;
    this.save.gold += amount;
    this.save.totalGoldEarned += amount;
    if (x !== undefined && y !== undefined) {
      this.spawnFloatingText(x, y, `+${amount}g`, '#ffd84d', 1.1);
    }
  }

  // ==================== BUILDING PAD INTERACTIONS ====================

  private handlePlayerBuildingInteractions(): void {
    const p = this.player;
    const unlockedZone = this.getUnlockedZone();

    for (const b of this.buildings) {
      if (b.zoneRequired > unlockedZone) continue;
      const dist = Math.hypot(p.x - b.x, p.y - b.y);
      if (dist > b.radius + 32) continue;

      // 1a. Camp Storehouse: stash backpack goods safely into Town Stockpile (usable for all upgrades!)
      if (b.kind === 'storehouse' && b.level > 0 && p.backpack.length > 0) {
        const stored = p.backpack.pop()!;
        this.addStockpile(stored, 1);
        this.spawnFlyingItem(stored, p.x, p.y - 24, b.x, b.y - 12);
        this.spawnFloatingText(b.x, b.y - 34, `📦 +1 ${RESOURCE_META[stored].shortName}`, '#7dd3fc', 0.95);
        sfx.playPop(5);
        b.bounceAnim = 0.22;
        p.transferCooldown = 0.075;
        return;
      }

      // 1b. Trading Post: sell backpack goods rapidly for Gold!
      if (b.kind === 'trading_post' && b.level > 0 && p.backpack.length > 0) {
        const sold = p.backpack.pop()!;
        const value = Math.max(1, Math.round(RESOURCE_META[sold].sellValue * this.getTradeGoldMultiplier()));
        this.spawnFlyingItem(sold, p.x, p.y - 24, b.x, b.y - 12);
        this.addGold(value, b.x + (Math.random() - 0.5) * 28, b.y - 34);
        sfx.playCoin();
        b.bounceAnim = 0.25;
        p.transferCooldown = 0.085;
        return;
      }

      // 2. Furnace: stoke fuel & trigger Blazing Hearth Overdrive!
      if (b.kind === 'furnace' && (b.fuel < 92 || (b.overdriveTimer || 0) <= 0)) {
        const fuelItem = p.backpack.includes('coal') ? 'coal' : p.backpack.includes('wood') ? 'wood' : null;
        if (fuelItem && b.fuel < 96) {
          const idx = p.backpack.lastIndexOf(fuelItem);
          p.backpack.splice(idx, 1);
          const fuelGain = fuelItem === 'coal' ? 38 : 20;
          b.fuel = Math.min(b.maxFuel, b.fuel + fuelGain);
          this.spawnFlyingItem(fuelItem, p.x, p.y - 24, b.x, b.y - 10);
          if (b.fuel >= 95 && (b.overdriveTimer || 0) <= 1) {
            b.overdriveTimer = 20;
            this.spawnFloatingText(b.x, b.y - 46, '🔥 BLAZING HEARTH! +25% Speed', '#fde047', 1.15);
            this.spawnBurst(b.x, b.y - 16, '#fb923c', 16);
          } else {
            this.spawnFloatingText(b.x, b.y - 38, `🔥 +${fuelGain}% Heat`, '#ff9f43');
          }
          sfx.playPop(5);
          b.bounceAnim = 0.25;
          p.transferCooldown = 0.14;
          return;
        }
      }

      // 3. Processor buildings: collect finished refined goods & feed raw inputs!
      if (b.level > 0 && b.outputType) {
        if (b.outputStock > 0 && p.backpack.length < this.getBackpackCapacity()) {
          b.outputStock -= 1;
          p.backpack.push(b.outputType);
          this.spawnFlyingItem(b.outputType, b.x, b.y - 14, p.x, p.y - 24);
          this.spawnFloatingText(b.x, b.y - 36, `+1 ${RESOURCE_META[b.outputType].shortName}`, RESOURCE_META[b.outputType].accent);
          // Tavern stew gives a fun warmth & speed boost!
          if (b.outputType === 'stew') {
            p.stewBuffTimer = 25;
            p.warmth = 100;
            this.spawnFloatingText(p.x, p.y - 52, '🍲 Speed +25%!', '#ffd394');
          }
          sfx.playPop(8);
          p.transferCooldown = 0.11;
          return;
        }
        if (b.inputRecipe) {
          for (const [resKey, needed] of Object.entries(b.inputRecipe)) {
            const res = resKey as ResourceType;
            const buffered = b.inputBuffer[res] || 0;
            if (buffered < (needed || 1) * 4) {
              const idx = p.backpack.lastIndexOf(res);
              if (idx >= 0) {
                p.backpack.splice(idx, 1);
                b.inputBuffer[res] = buffered + 1;
                this.spawnFlyingItem(res, p.x, p.y - 24, b.x, b.y - 10);
                sfx.playPop(3);
                b.bounceAnim = 0.2;
                p.transferCooldown = 0.1;
                return;
              }
            }
          }
        }
      }

      // 4. Construction / Upgrade pad deposit (for unbuilt businesses & Homestead upgrades!)
      if (b.level < b.maxLevel) {
        // For Homestead, always auto-deposit on pad; for businesses, auto-deposit to build (level 0 -> 1)
        const allowPadUpgrade = b.kind === 'homestead' || b.level === 0;
        if (allowPadUpgrade && this.tryDepositTowardBuilding(b)) {
          p.transferCooldown = 0.09;
          return;
        }
      }
    }
  }

  public tryDepositTowardBuilding(b: BuildingState): boolean {
    if (b.level >= b.maxLevel) return false;
    const cost = this.getBuildingNextCost(b);

    // Deposit 1 unit of any needed resource from backpack or town stockpile
    for (const [resKey, totalNeeded] of Object.entries(cost.resources)) {
      const res = resKey as ResourceType;
      const need = (totalNeeded || 0) - (b.deposited[res] || 0);
      if (need > 0 && this.getTotalAvailableResource(res) > 0) {
        const taken = this.consumePlayerOrStockpile(res, 1, b.x, b.y - 10);
        if (taken > 0) {
          b.deposited[res] = (b.deposited[res] || 0) + taken;
          sfx.playPop(4);
          b.bounceAnim = 0.2;
          this.checkBuildingComplete(b);
          return true;
        }
      }
    }

    // Deposit gold chunk if needed
    const goldNeed = cost.gold - b.depositedGold;
    if (goldNeed > 0 && this.save.gold > 0) {
      const chunk = Math.min(goldNeed, this.save.gold, Math.max(5, Math.ceil(cost.gold / 10)));
      this.save.gold -= chunk;
      b.depositedGold += chunk;
      this.spawnFlyingItem('gold', this.player.x, this.player.y - 20, b.x, b.y - 10);
      sfx.playCoin();
      b.bounceAnim = 0.2;
      this.checkBuildingComplete(b);
      return true;
    }

    return false;
  }

  public instantUpgradeBuilding(buildingId: string): boolean {
    const b = this.buildings.find((x) => x.id === buildingId);
    if (!b || b.level >= b.maxLevel || b.zoneRequired > this.getUnlockedZone()) return false;
    const cost = this.getBuildingNextCost(b);
    const goldNeed = Math.max(0, cost.gold - b.depositedGold);
    if (this.save.gold < goldNeed) return false;

    for (const [resKey, totalNeeded] of Object.entries(cost.resources)) {
      const res = resKey as ResourceType;
      const need = Math.max(0, (totalNeeded || 0) - (b.deposited[res] || 0));
      if (this.getTotalAvailableResource(res) < need) return false;
    }

    // Consume all remaining
    this.save.gold -= goldNeed;
    b.depositedGold += goldNeed;
    for (const [resKey, totalNeeded] of Object.entries(cost.resources)) {
      const res = resKey as ResourceType;
      const need = Math.max(0, (totalNeeded || 0) - (b.deposited[res] || 0));
      if (need > 0) {
        this.consumePlayerOrStockpile(res, need, b.x, b.y - 10);
        b.deposited[res] = (b.deposited[res] || 0) + need;
      }
    }
    this.checkBuildingComplete(b);
    return true;
  }

  private checkBuildingComplete(b: BuildingState): void {
    const cost = this.getBuildingNextCost(b);
    if (b.depositedGold < cost.gold) return;
    for (const [resKey, totalNeeded] of Object.entries(cost.resources)) {
      const res = resKey as ResourceType;
      if ((b.deposited[res] || 0) < (totalNeeded || 0)) return;
    }

    // Level up!
    b.level += 1;
    b.deposited = {};
    b.depositedGold = 0;
    b.bounceAnim = 0.65;
    this.spawnBurst(b.x, b.y - 20, '#ffd84d', 20);

    if (b.kind === 'homestead') {
      this.homesteadTier = b.level as HomesteadTier;
      const tierInfo = HOMESTEAD_TIERS[this.homesteadTier];
      sfx.playThaw();
      this.camera.shake = 9;
      this.thawWave = {
        active: true,
        radius: 60,
        maxRadius: this.getUnlockedRadius() + 60,
        alpha: 1,
      };
      this.spawnFloatingText(b.x, b.y - 68, `🏠 ${tierInfo.name}!`, '#ffe066', 1.45);
      this.emitUi('homestead_upgraded', tierInfo);

      if (this.homesteadTier >= 5) {
        // Town Hall crowned! Unlock next stage on the 25-town frontier map!
        if (this.save.highestUnlockedStage < Math.min(STAGES.length, this.stage.id + 1)) {
          this.save.highestUnlockedStage = Math.min(STAGES.length, this.stage.id + 1);
        }
        const bonusGold = Math.round(400 * this.stage.difficultyScale);
        this.addGold(bonusGold, b.x, b.y - 94);
        this.save.legacyPoints += 5;
        this.emitUi('town_crowned', { stage: this.stage, bonusGold });
      }
    } else {
      sfx.playUpgrade();
      const verb = b.level === 1 ? 'Built' : `Lv.${b.level}`;
      this.spawnFloatingText(b.x, b.y - 54, `✨ ${b.name} ${verb}!`, '#7dd3fc', 1.25);
      this.emitUi('toast', `${b.name} upgraded to Level ${b.level}!`);
    }
    this.persistSave();
  }

  // ==================== WORLD UPDATES ====================

  private updateNodes(dt: number): void {
    for (const n of this.nodes) {
      if (n.shakeTimer > 0) n.shakeTimer = Math.max(0, n.shakeTimer - dt);
      if (n.respawnTimer > 0) {
        n.respawnTimer = Math.max(0, n.respawnTimer - dt);
        if (n.respawnTimer <= 0) {
          n.hp = n.maxHp;
          this.spawnBurst(n.x, n.y - 10, '#ffffff', 4);
        }
      }
    }
  }

  private updateWildlife(dt: number): void {
    const unlockedZone = this.getUnlockedZone();
    const p = this.player;

    for (const w of this.wildlife) {
      if (w.hitFlash > 0) w.hitFlash = Math.max(0, w.hitFlash - dt * 3);
      if (w.attackCooldown > 0) w.attackCooldown = Math.max(0, w.attackCooldown - dt);

      if (w.state === 'dead') {
        w.respawnTimer -= dt;
        if (w.respawnTimer <= 0) {
          w.x = w.homeX;
          w.y = w.homeY;
          w.hp = w.maxHp;
          w.state = 'wander';
          w.stateTimer = 1.5;
        }
        continue;
      }

      if (w.zone > unlockedZone) continue;

      const distToPlayer = Math.hypot(p.x - w.x, p.y - w.y);
      const distHome = Math.hypot(w.x - w.homeX, w.y - w.homeY);

      if (w.state === 'windup') {
        w.telegraphTimer -= dt;
        if (w.telegraphTimer <= 0) {
          // Execute lunge / slam!
          const hitDist = Math.hypot(p.x - w.telegraphX, p.y - w.telegraphY);
          this.spawnBurst(w.telegraphX, w.telegraphY, '#ff6b6b', 10);
          w.x += (w.telegraphX - w.x) * 0.45;
          w.y += (w.telegraphY - w.y) * 0.45;
          if (hitDist < w.radius + 32 && p.dashTimer <= 0) {
            p.hp = Math.max(0, p.hp - w.attackDamage);
            p.hurtFlash = 0.5;
            this.camera.shake = 7;
            sfx.playHurt();
            this.spawnFloatingText(p.x, p.y - 36, `-${w.attackDamage} HP`, '#ff6b6b', 1.15);
            if (p.hp <= 0) {
              // Safe camp rescue!
              p.x = 0;
              p.y = 115;
              p.hp = p.maxHp;
              p.warmth = 100;
              this.emitUi('toast', '🩹 Rescued back to camp! Upgrade Spear/Cloak for tough beasts.');
            }
          }
          w.attackCooldown = 1.8;
          w.state = 'chase';
        }
        continue;
      }

      if (w.aggressive && distToPlayer < 175 && distHome < 320) {
        w.state = 'chase';
      } else if (!w.aggressive && distToPlayer < 95 && w.state !== 'flee') {
        w.state = 'flee';
        w.stateTimer = 1.6;
        const a = Math.atan2(w.y - p.y, w.x - p.x);
        w.vx = Math.cos(a) * w.speed;
        w.vy = Math.sin(a) * w.speed;
      }

      if (w.state === 'chase') {
        if (distToPlayer > 240 || distHome > 360) {
          w.state = 'wander';
        } else if (distToPlayer < w.radius + 42 && w.attackCooldown <= 0) {
          // Begin telegraphed attack so player can dodge like 90s Zelda!
          w.state = 'windup';
          w.telegraphTimer = 0.72;
          w.telegraphX = p.x;
          w.telegraphY = p.y;
          w.facing = Math.atan2(p.y - w.y, p.x - w.x);
          w.vx = 0;
          w.vy = 0;
        } else {
          const a = Math.atan2(p.y - w.y, p.x - w.x);
          w.facing = a;
          w.vx = Math.cos(a) * w.speed;
          w.vy = Math.sin(a) * w.speed;
        }
      } else if (w.state === 'flee') {
        w.stateTimer -= dt;
        if (w.stateTimer <= 0) w.state = 'wander';
      } else {
        w.stateTimer -= dt;
        if (w.stateTimer <= 0) {
          w.stateTimer = 1.5 + Math.random() * 2.5;
          if (distHome > 130) {
            const a = Math.atan2(w.homeY - w.y, w.homeX - w.x);
            w.vx = Math.cos(a) * w.speed * 0.55;
            w.vy = Math.sin(a) * w.speed * 0.55;
          } else if (Math.random() < 0.6) {
            const a = Math.random() * Math.PI * 2;
            w.vx = Math.cos(a) * w.speed * 0.4;
            w.vy = Math.sin(a) * w.speed * 0.4;
          } else {
            w.vx = 0;
            w.vy = 0;
          }
        }
      }

      w.x += w.vx * dt;
      w.y += w.vy * dt;
      if (Math.hypot(w.vx, w.vy) > 5) w.facing = Math.atan2(w.vy, w.vx);

      // Keep wildlife outside camp center and inside their zone ring
      const dOrigin = Math.hypot(w.x, w.y);
      const minZoneR = Math.max(175, ZONE_RADII[w.zone - 1] + 20);
      const maxZoneR = ZONE_RADII[w.zone] - 25;
      if (dOrigin < minZoneR && dOrigin > 1) {
        w.x = (w.x / dOrigin) * minZoneR;
        w.y = (w.y / dOrigin) * minZoneR;
      } else if (dOrigin > maxZoneR) {
        w.x = (w.x / dOrigin) * maxZoneR;
        w.y = (w.y / dOrigin) * maxZoneR;
      }
    }
  }

  private updateBuildings(dt: number): void {
    for (const b of this.buildings) {
      if (b.bounceAnim > 0) b.bounceAnim = Math.max(0, b.bounceAnim - dt * 2.2);
      if (b.level <= 0) continue;

      if (b.kind === 'furnace') {
        if ((b.overdriveTimer || 0) > 0) {
          b.overdriveTimer = Math.max(0, (b.overdriveTimer || 0) - dt);
        }
        // Rising glowing hearth embers
        if (Math.random() < ((b.overdriveTimer || 0) > 0 ? 0.45 : 0.18)) {
          this.embers.push({
            x: b.x + (Math.random() - 0.5) * 26,
            y: b.y - 24,
            vx: (Math.random() - 0.5) * 22,
            vy: -32 - Math.random() * 34,
            size: 1.8 + Math.random() * 2.2,
            life: 0.9 + Math.random() * 0.7,
            maxLife: 1.6,
            color: Math.random() < 0.5 ? '#fde047' : '#fb923c',
          });
        }
        const burnRate = (0.75 + this.blizzard.intensity * 1.1) / (1 + (b.level - 1) * 0.25);
        b.fuel = Math.max(8, b.fuel - burnRate * dt);
        // Auto-stoke slowly from town stockpile if fuel drops below 40%
        if (b.fuel < 40) {
          if ((this.townStockpile.coal || 0) > 0) {
            this.townStockpile.coal! -= 1;
            b.fuel = Math.min(100, b.fuel + 35);
          } else if ((this.townStockpile.wood || 0) > 0) {
            this.townStockpile.wood! -= 1;
            b.fuel = Math.min(100, b.fuel + 18);
          }
        }
      }

      // Craft refined products
      if (b.inputRecipe && b.outputType && b.outputStock < 10 + b.level * 4) {
        // Also pull raw materials from town stockpile if haulers/workers exist!
        if (this.workerCounts.hauler > 0) {
          for (const [resKey, need] of Object.entries(b.inputRecipe)) {
            const res = resKey as ResourceType;
            if ((b.inputBuffer[res] || 0) < (need || 1) && (this.townStockpile[res] || 0) > 0) {
              this.townStockpile[res]! -= 1;
              b.inputBuffer[res] = (b.inputBuffer[res] || 0) + 1;
            }
          }
        }

        let hasAllInputs = true;
        for (const [resKey, need] of Object.entries(b.inputRecipe)) {
          if ((b.inputBuffer[resKey as ResourceType] || 0) < (need || 1)) {
            hasAllInputs = false;
            break;
          }
        }

        if (hasAllInputs) {
          const speedMult = 1 + (b.level - 1) * 0.35 + (this.player.stewBuffTimer > 0 ? 0.2 : 0);
          b.processTimer += dt * speedMult;
          if (b.processTimer >= b.processDuration) {
            b.processTimer = 0;
            for (const [resKey, need] of Object.entries(b.inputRecipe)) {
              const res = resKey as ResourceType;
              b.inputBuffer[res] = Math.max(0, (b.inputBuffer[res] || 0) - (need || 1));
            }
            b.outputStock += 1;
            b.bounceAnim = 0.3;
            this.spawnBurst(b.x, b.y - 26, RESOURCE_META[b.outputType].accent, 5);
          }
        }
      }
    }
  }

  // ==================== WORKERS & CARAVAN CUSTOMERS ====================

  private rebuildWorkerEntities(): void {
    this.workers = [];
    const roles: WorkerRole[] = ['lumberjack', 'miner', 'hunter', 'hauler', 'merchant'];
    const names = ['Olaf', 'Sven', 'Ingrid', 'Tove', 'Bjorn', 'Maja', 'Leif', 'Nora', 'Erik', 'Signe'];
    let idx = 0;
    for (const role of roles) {
      const count = this.workerCounts[role] || 0;
      for (let i = 0; i < count; i++) {
        const angle = (idx * 1.1) % (Math.PI * 2);
        this.workers.push({
          id: `worker_${role}_${i}`,
          role,
          name: names[idx % names.length],
          x: Math.cos(angle) * 70,
          y: Math.sin(angle) * 70,
          targetX: 0,
          targetY: 0,
          carry: [],
          carryCap: 4,
          actionTimer: 0.4 + Math.random(),
          state: 'idle',
          targetId: null,
          facing: 0,
          bobPhase: Math.random() * 6,
        });
        idx++;
      }
    }
  }

  private updateWorkers(dt: number): void {
    const unlockedZone = this.getUnlockedZone();
    const tradingPost = this.buildings.find((b) => b.kind === 'trading_post')!;
    const homestead = this.buildings.find((b) => b.kind === 'homestead')!;
    const speed = 115 * (this.player.stewBuffTimer > 0 ? 1.2 : 1);

    for (const wk of this.workers) {
      wk.bobPhase += dt * 9;

      if (wk.role === 'merchant') {
        // Staff trading post & auto-sell surplus town stockpile periodically
        const tx = tradingPost.x - 24;
        const ty = tradingPost.y + 16;
        this.moveToward(wk, tx, ty, speed, dt);
        wk.actionTimer -= dt;
        if (wk.actionTimer <= 0) {
          wk.actionTimer = 3.2;
          // Auto-sell highest value refined good in stockpile (or raw if abundant > 20)
          const sellCandidate =
            (['relic', 'steel', 'stew', 'coat', 'plank'] as ResourceType[]).find(
              (r) => (this.townStockpile[r] || 0) > 0
            ) ||
            (['crystal', 'iron', 'pelt', 'meat', 'coal', 'wood'] as ResourceType[]).find(
              (r) => (this.townStockpile[r] || 0) > 18
            );
          if (sellCandidate) {
            this.townStockpile[sellCandidate]! -= 1;
            const g = Math.round(RESOURCE_META[sellCandidate].sellValue * this.getTradeGoldMultiplier());
            this.addGold(g, tradingPost.x, tradingPost.y - 34);
            this.spawnFlyingItem(sellCandidate, homestead.x, homestead.y, tradingPost.x, tradingPost.y - 12);
          }
        }
        continue;
      }

      if (wk.role === 'hauler') {
        // Pick up finished goods from any processor and bring to town stockpile
        wk.actionTimer -= dt;
        if (wk.state === 'idle') {
          const ready = this.buildings.find((b) => b.level > 0 && b.outputType && b.outputStock > 0);
          if (ready) {
            wk.targetId = ready.id;
            wk.targetX = ready.x;
            wk.targetY = ready.y + 20;
            wk.state = 'move_to_target';
          } else {
            this.moveToward(wk, homestead.x + 35, homestead.y + 35, speed * 0.7, dt);
          }
        } else if (wk.state === 'move_to_target') {
          if (this.moveToward(wk, wk.targetX, wk.targetY, speed, dt)) {
            const b = this.buildings.find((x) => x.id === wk.targetId);
            if (b && b.outputType && b.outputStock > 0) {
              const grab = Math.min(wk.carryCap, b.outputStock);
              b.outputStock -= grab;
              for (let i = 0; i < grab; i++) wk.carry.push(b.outputType);
              wk.state = 'return';
            } else {
              wk.state = 'idle';
            }
          }
        } else if (wk.state === 'return') {
          if (this.moveToward(wk, homestead.x, homestead.y + 30, speed, dt)) {
            for (const item of wk.carry) this.addStockpile(item, 1);
            wk.carry = [];
            wk.state = 'idle';
          }
        }
        continue;
      }

      // Gatherers: lumberjack, miner, hunter
      if (wk.state === 'idle') {
        if (wk.role === 'hunter') {
          const target = this.wildlife.find((w) => w.state !== 'dead' && w.zone <= unlockedZone);
          if (target) {
            wk.targetId = target.id;
            wk.state = 'move_to_target';
          }
        } else {
          const wantTree = wk.role === 'lumberjack';
          const candidates = this.nodes.filter(
            (n) =>
              n.respawnTimer <= 0 &&
              n.zone <= unlockedZone &&
              (wantTree ? n.kind === 'pine' || n.kind === 'ancient_pine' : n.kind !== 'pine' && n.kind !== 'ancient_pine')
          );
          if (candidates.length > 0) {
            candidates.sort((a, b) => Math.hypot(a.x - wk.x, a.y - wk.y) - Math.hypot(b.x - wk.x, b.y - wk.y));
            wk.targetId = candidates[0].id;
            wk.targetX = candidates[0].x;
            wk.targetY = candidates[0].y;
            wk.state = 'move_to_target';
          }
        }
      } else if (wk.state === 'move_to_target') {
        if (wk.role === 'hunter') {
          const w = this.wildlife.find((x) => x.id === wk.targetId && x.state !== 'dead');
          if (!w) {
            wk.state = 'idle';
            continue;
          }
          if (this.moveToward(wk, w.x, w.y, speed * 1.05, dt, 42)) {
            wk.actionTimer -= dt;
            if (wk.actionTimer <= 0) {
              wk.actionTimer = 0.7;
              this.damageWildlife(w, this.getWeaponDamage() * 0.45, false);
              if (w.state === 'dead') {
                wk.carry.push('meat', 'pelt');
                wk.state = 'return';
              }
            }
          }
        } else {
          const n = this.nodes.find((x) => x.id === wk.targetId && x.respawnTimer <= 0);
          if (!n) {
            wk.state = 'idle';
            continue;
          }
          if (this.moveToward(wk, n.x, n.y, speed, dt, 38)) {
            wk.actionTimer -= dt;
            if (wk.actionTimer <= 0) {
              wk.actionTimer = 0.65;
              const dmg = wk.role === 'lumberjack' ? this.getAxeDamage() * 0.5 : this.getPickDamage() * 0.5;
              this.damageNode(n, dmg, false);
              if (n.respawnTimer > 0) {
                wk.carry.push(n.resource, n.resource);
                wk.state = 'return';
              }
            }
          }
        }
      } else if (wk.state === 'return') {
        if (this.moveToward(wk, homestead.x, homestead.y + 34, speed, dt)) {
          wk.carry = [];
          wk.state = 'idle';
        }
      }
    }
  }

  private moveToward(
    ent: { x: number; y: number; facing: number },
    tx: number,
    ty: number,
    speed: number,
    dt: number,
    stopDist = 14
  ): boolean {
    const dx = tx - ent.x;
    const dy = ty - ent.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopDist) return true;
    ent.facing = Math.atan2(dy, dx);
    const step = Math.min(d, speed * dt);
    ent.x += (dx / d) * step;
    ent.y += (dy / d) * step;
    return false;
  }

  private updateCustomers(dt: number): void {
    const trading = this.buildings.find((b) => b.kind === 'trading_post');
    if (!trading || trading.level <= 0) return;

    this.customerSpawnTimer -= dt;
    if (this.customerSpawnTimer <= 0 && this.customers.length < 2 + Math.min(3, this.homesteadTier)) {
      this.customerSpawnTimer = Math.max(4, 11 - this.homesteadTier * 1.4);
      const colors = ['#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f39c12'];
      const spawnR = this.getUnlockedRadius() - 25;
      const angle = -0.35 + Math.random() * 0.7;
      this.customers.push({
        id: `cust_${Date.now()}_${Math.random()}`,
        x: Math.cos(angle) * spawnR,
        y: Math.sin(angle) * spawnR,
        targetX: trading.x + 28 + (Math.random() - 0.5) * 32,
        targetY: trading.y + 24 + (Math.random() - 0.5) * 20,
        state: 'arriving',
        waitTimer: 2.5,
        coatColor: colors[Math.floor(Math.random() * colors.length)],
        hatColor: '#f8fafc',
      });
    }

    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      const dummy = { x: c.x, y: c.y, facing: 0 };
      if (c.state === 'arriving') {
        if (this.moveToward(dummy, c.targetX, c.targetY, 85, dt, 10)) {
          c.state = 'shopping';
          c.waitTimer = 2.0;
        }
        c.x = dummy.x;
        c.y = dummy.y;
      } else if (c.state === 'shopping') {
        c.waitTimer -= dt;
        if (c.waitTimer <= 0) {
          // Customer buys something if town has stockpile, or drops a small tip!
          const avail = ALL_RESOURCES.find((r) => (this.townStockpile[r] || 0) > 0);
          if (avail) {
            this.townStockpile[avail]! -= 1;
            const g = Math.round(RESOURCE_META[avail].sellValue * this.getTradeGoldMultiplier() * 1.15);
            this.addGold(g, c.x, c.y - 26);
            c.boughtIcon = RESOURCE_META[avail].icon;
          } else {
            const tip = Math.round((6 + this.homesteadTier * 5) * this.stage.difficultyScale);
            this.addGold(tip, c.x, c.y - 26);
          }
          c.state = 'leaving';
          c.targetX = this.getUnlockedRadius() + 20;
          c.targetY = c.y + (Math.random() - 0.5) * 140;
        }
      } else {
        if (this.moveToward(dummy, c.targetX, c.targetY, 90, dt, 16)) {
          this.customers.splice(i, 1);
          continue;
        }
        c.x = dummy.x;
        c.y = dummy.y;
      }
    }
  }

  // ==================== EXPLORERS & MANAGEMENT ACTIONS ====================

  public areExplorersUnlocked(): boolean {
    const guild = this.buildings.find((b) => b.kind === 'explorers_guild');
    return Boolean((guild && guild.level > 0) || this.homesteadTier >= 5 || this.getEmpireTownCount() > 0);
  }

  private updateExplorers(dt: number): void {
    for (const exp of this.save.explorers) {
      if (exp.activeMissionId && exp.missionRemainingSec > 0) {
        exp.missionRemainingSec = Math.max(0, exp.missionRemainingSec - dt);
        if (exp.missionRemainingSec <= 0) {
          this.emitUi('toast', `🧭 ${exp.name} returned from expedition! Claim loot in Explorers.`);
        }
      }
    }
  }

  public hireExplorer(explorerId: string): boolean {
    const exp = this.save.explorers.find((e) => e.id === explorerId);
    if (!exp || exp.unlocked || this.save.gold < exp.hireCost) return false;
    this.save.gold -= exp.hireCost;
    exp.unlocked = true;
    sfx.playUpgrade();
    this.persistSave();
    this.emitUi('toast', `🧭 ${exp.name} (${exp.title}) joined your Frontier Guild!`);
    return true;
  }

  public dispatchExplorer(explorerId: string, missionId: string): boolean {
    if (!this.areExplorersUnlocked()) return false;
    const exp = this.save.explorers.find((e) => e.id === explorerId);
    const mission = EXPLORER_MISSIONS.find((m) => m.id === missionId);
    if (!exp || !exp.unlocked || exp.activeMissionId || !mission) return false;

    const speedFactor = 1 / (1 + (exp.level - 1) * 0.12);
    const dur = Math.max(10, Math.round(mission.durationSec * speedFactor));
    exp.activeMissionId = mission.id;
    exp.missionTotalSec = dur;
    exp.missionRemainingSec = dur;
    sfx.playPop(7);
    this.persistSave();
    return true;
  }

  public claimExplorerMission(explorerId: string): ExplorerMissionDef | null {
    const exp = this.save.explorers.find((e) => e.id === explorerId);
    if (!exp || !exp.activeMissionId || exp.missionRemainingSec > 0) return null;
    const mission = EXPLORER_MISSIONS.find((m) => m.id === exp.activeMissionId);
    if (!mission) return null;

    const mult = (1 + (exp.level - 1) * 0.25) * this.stage.difficultyScale;
    const goldGain = Math.round(mission.goldReward * mult);
    this.addGold(goldGain, this.player.x, this.player.y - 44);
    for (const [resKey, amt] of Object.entries(mission.resourceRewards)) {
      const gain = Math.max(1, Math.round((amt || 0) * (1 + (exp.level - 1) * 0.2)));
      this.addStockpile(resKey as ResourceType, gain);
    }
    this.save.legacyPoints += mission.legacyPoints;
    exp.completedCount += 1;
    if (exp.completedCount % 3 === 0) exp.level += 1;
    exp.activeMissionId = null;
    exp.missionRemainingSec = 0;
    exp.missionTotalSec = 0;

    sfx.playUpgrade();
    this.persistSave();
    this.emitUi('toast', `🎁 ${exp.name} delivered +${goldGain}g & Frontier Supplies!`);
    return mission;
  }

  public collectPendingTribute(): number {
    if (this.pendingTributeGold <= 0) return 0;
    const amt = this.pendingTributeGold;
    this.pendingTributeGold = 0;
    this.addGold(amt, this.player.x, this.player.y - 50);
    sfx.playCoin();
    this.persistSave();
    return amt;
  }

  public sellAllStockpile(): number {
    let totalGold = 0;
    for (const r of ALL_RESOURCES) {
      const qty = this.townStockpile[r] || 0;
      if (qty > 0) {
        totalGold += Math.round(qty * RESOURCE_META[r].sellValue * this.getTradeGoldMultiplier());
        this.townStockpile[r] = 0;
      }
    }
    if (totalGold > 0) {
      this.addGold(totalGold, this.player.x, this.player.y - 45);
      sfx.playCoin();
      this.persistSave();
    }
    return totalGold;
  }

  // ==================== UPGRADES & WORKER HIRING ====================

  public getUpgradeList(): UpgradeInfo[] {
    const u = this.save.upgrades;
    const makeCost = (base: number, lvl: number) => Math.round(base * Math.pow(1.62, lvl - 1));
    return [
      {
        key: 'axeLevel',
        name: 'Timber Axe',
        icon: '🪓',
        desc: 'Chop pine & ancient trees much faster',
        level: u.axeLevel,
        maxLevel: 12,
        cost: makeCost(45, u.axeLevel),
        statLabel: `${Math.round(this.getAxeDamage())} dmg`,
      },
      {
        key: 'pickLevel',
        name: 'Glacier Pickaxe',
        icon: '⛏️',
        desc: 'Break Coal, Iron & Frost Crystal veins fast',
        level: u.pickLevel,
        maxLevel: 12,
        cost: makeCost(65, u.pickLevel),
        statLabel: `${Math.round(this.getPickDamage())} dmg`,
      },
      {
        key: 'weaponLevel',
        name: 'Hunting Spear',
        icon: '🏹',
        desc: 'Hunt Deer, Boars, Bears & Yetis quickly',
        level: u.weaponLevel,
        maxLevel: 12,
        cost: makeCost(60, u.weaponLevel),
        statLabel: `${Math.round(this.getWeaponDamage())} dmg`,
      },
      {
        key: 'packLevel',
        name: 'Expedition Pack',
        icon: '🎒',
        desc: 'Haul taller resource stacks on your back',
        level: u.packLevel,
        maxLevel: 12,
        cost: makeCost(50, u.packLevel),
        statLabel: `${this.getBackpackCapacity()} slots`,
      },
      {
        key: 'bootsLevel',
        name: 'Snow Boots',
        icon: '🥾',
        desc: 'Sprint smoothly through deep winter snow',
        level: u.bootsLevel,
        maxLevel: 10,
        cost: makeCost(55, u.bootsLevel),
        statLabel: `${Math.round(this.getPlayerSpeed())} spd`,
      },
      {
        key: 'cloakLevel',
        name: 'Fur Cloak',
        icon: '🧥',
        desc: 'Resist freezing cold & blizzards longer',
        level: u.cloakLevel,
        maxLevel: 10,
        cost: makeCost(70, u.cloakLevel),
        statLabel: `${Math.round(this.getWarmthResistance() * 100)}% resist`,
      },
    ];
  }

  public buyUpgrade(key: keyof PlayerUpgrades): boolean {
    const item = this.getUpgradeList().find((u) => u.key === key);
    if (!item || item.level >= item.maxLevel || this.save.gold < item.cost) return false;
    this.save.gold -= item.cost;
    this.save.upgrades[key] += 1;
    sfx.playUpgrade();
    this.spawnFloatingText(this.player.x, this.player.y - 45, `${item.icon} ${item.name} Lv.${item.level + 1}!`, '#7dd3fc', 1.2);
    this.persistSave();
    return true;
  }

  public getWorkerHireList(): WorkerHireInfo[] {
    const c = this.workerCounts;
    const s = this.stage.difficultyScale;
    const cost = (base: number, n: number) => Math.round(base * Math.pow(1.75, n) * (0.8 + s * 0.2));
    return [
      {
        role: 'lumberjack',
        name: 'Lumberjack',
        icon: '🪓',
        desc: 'Chops trees & delivers wood to town stockpile',
        count: c.lumberjack,
        maxCount: 4,
        cost: cost(95, c.lumberjack),
        minTier: 1,
      },
      {
        role: 'hunter',
        name: 'Camp Hunter',
        icon: '🏹',
        desc: 'Hunts snow wildlife for Meat & Warm Pelts',
        count: c.hunter,
        maxCount: 3,
        cost: cost(140, c.hunter),
        minTier: 2,
      },
      {
        role: 'miner',
        name: 'Quarry Miner',
        icon: '⛏️',
        desc: 'Mines Coal, Iron & Frost Crystals automatically',
        count: c.miner,
        maxCount: 4,
        cost: cost(170, c.miner),
        minTier: 2,
      },
      {
        role: 'hauler',
        name: 'Town Hauler',
        icon: '📦',
        desc: 'Feeds Workshops & collects Planks/Steel/Coats',
        count: c.hauler,
        maxCount: 3,
        cost: cost(190, c.hauler),
        minTier: 2,
      },
      {
        role: 'merchant',
        name: 'Trade Merchant',
        icon: '💰',
        desc: 'Auto-sells surplus & boosts all Gold prices +18%',
        count: c.merchant,
        maxCount: 3,
        cost: cost(240, c.merchant),
        minTier: 3,
      },
    ];
  }

  public hireWorker(role: WorkerRole): boolean {
    const info = this.getWorkerHireList().find((w) => w.role === role);
    if (!info || info.count >= info.maxCount || this.homesteadTier < info.minTier || this.save.gold < info.cost) {
      return false;
    }
    this.save.gold -= info.cost;
    this.workerCounts[role] += 1;
    this.rebuildWorkerEntities();
    sfx.playUpgrade();
    this.spawnFloatingText(0, -40, `${info.icon} Hired ${info.name}!`, '#86efac', 1.2);
    this.persistSave();
    return true;
  }

  // ==================== VISUAL FX HELPERS ====================

  private spawnSlashArc(
    x: number,
    y: number,
    angle: number,
    radius: number,
    color: string,
    crit: boolean
  ): void {
    this.slashArcs.push({
      x,
      y,
      angle,
      radius,
      color,
      life: crit ? 0.24 : 0.17,
      maxLife: crit ? 0.24 : 0.17,
      crit,
    });
  }

  private spawnGroundLoot(resource: ResourceType, amount: number, x: number, y: number): void {
    const pieces = Math.min(amount, 5);
    const perPiece = Math.floor(amount / pieces);
    const remainder = amount % pieces;
    for (let i = 0; i < pieces; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 65 + Math.random() * 65;
      this.groundLoot.push({
        id: this.nextFlyId++,
        resource,
        amount: perPiece + (i < remainder ? 1 : 0),
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        age: 0,
        z: 8,
        vz: 120 + Math.random() * 55,
      });
    }
  }

  private spawnFlyingItem(
    resource: ResourceType | 'gold',
    startX: number,
    startY: number,
    targetX: number,
    targetY: number
  ): void {
    this.flyingItems.push({
      id: this.nextFlyId++,
      resource,
      startX,
      startY,
      targetX,
      targetY,
      progress: 0,
      duration: 0.28 + Math.random() * 0.08,
      arcHeight: 34 + Math.random() * 16,
    });
  }

  private spawnBurst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 115;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 35,
        size: 2.5 + Math.random() * 3.5,
        color,
        alpha: 1,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        gravity: 260,
      });
    }
  }

  public spawnFloatingText(x: number, y: number, text: string, color: string, scale = 1): void {
    this.floatingTexts.push({ x, y, text, color, life: 0.95, maxLife: 0.95, scale });
  }

  private updateVisualFx(dt: number): void {
    // Magnetic ground loot bounce + vacuum into backpack!
    const p = this.player;
    for (let i = this.groundLoot.length - 1; i >= 0; i--) {
      const gl = this.groundLoot[i];
      gl.age += dt;
      if (gl.age < 0.24) {
        gl.x += gl.vx * dt;
        gl.y += gl.vy * dt;
        gl.vx *= Math.pow(0.08, dt);
        gl.vy *= Math.pow(0.08, dt);
        gl.vz -= 480 * dt;
        gl.z = Math.max(0, gl.z + gl.vz * dt);
      } else {
        // Magnetic pull toward player!
        const dx = p.x - gl.x;
        const dy = p.y - 16 - gl.y;
        const dist = Math.hypot(dx, dy);
        const pullSpeed = 420 + gl.age * 360;
        if (dist < 26 || gl.age > 1.25) {
          if (gl.resource !== 'gold') {
            this.givePlayerResource(gl.resource, gl.amount, gl.x, gl.y);
          }
          this.groundLoot.splice(i, 1);
          continue;
        }
        gl.x += (dx / dist) * pullSpeed * dt;
        gl.y += (dy / dist) * pullSpeed * dt;
        gl.z += (14 - gl.z) * Math.min(1, dt * 10);
      }
    }

    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      this.slashArcs[i].life -= dt;
      if (this.slashArcs[i].life <= 0) this.slashArcs.splice(i, 1);
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const em = this.embers[i];
      em.life -= dt;
      if (em.life <= 0) {
        this.embers.splice(i, 1);
        continue;
      }
      em.x += (em.vx + Math.sin(this.elapsedTime * 5 + i) * 14) * dt;
      em.y += em.vy * dt;
    }

    for (let i = this.flyingItems.length - 1; i >= 0; i--) {
      const f = this.flyingItems[i];
      f.progress += dt / f.duration;
      if (f.progress >= 1) this.flyingItems.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy += pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.alpha = Math.max(0, pt.life / pt.maxLife);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.y -= dt * 42;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    for (let i = this.footprints.length - 1; i >= 0; i--) {
      this.footprints[i].life -= dt;
      if (this.footprints[i].life <= 0) this.footprints.splice(i, 1);
    }

    if (this.thawWave.active) {
      this.thawWave.radius += dt * 760;
      this.thawWave.alpha = Math.max(0, 1 - this.thawWave.radius / this.thawWave.maxRadius);
      if (this.thawWave.radius >= this.thawWave.maxRadius) {
        this.thawWave.active = false;
      }
    }
  }

  private updateCamera(dt: number): void {
    const smooth = 1 - Math.exp(-8 * dt);
    this.camera.x += (this.player.x - this.camera.x) * smooth;
    this.camera.y += (this.player.y - this.camera.y) * smooth;
    if (this.camera.shake > 0) {
      this.camera.shake = Math.max(0, this.camera.shake - dt * 26);
    }
  }
}
