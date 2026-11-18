export type ResourceType =
  | 'wood'
  | 'meat'
  | 'pelt'
  | 'coal'
  | 'iron'
  | 'crystal'
  | 'plank'
  | 'steel'
  | 'coat'
  | 'stew'
  | 'relic';

export const RAW_RESOURCES: ResourceType[] = ['wood', 'meat', 'pelt', 'coal', 'iron', 'crystal'];
export const REFINED_RESOURCES: ResourceType[] = ['plank', 'steel', 'coat', 'stew', 'relic'];
export const ALL_RESOURCES: ResourceType[] = [...RAW_RESOURCES, ...REFINED_RESOURCES];

export interface ResourceMeta {
  id: ResourceType;
  name: string;
  shortName: string;
  color: string;
  accent: string;
  sellValue: number;
  icon: string;
}

export const RESOURCE_META: Record<ResourceType, ResourceMeta> = {
  wood:    { id: 'wood',    name: 'Pine Wood',     shortName: 'Wood',    color: '#9c6638', accent: '#d89b62', sellValue: 4,   icon: '🪵' },
  meat:    { id: 'meat',    name: 'Wild Meat',     shortName: 'Meat',    color: '#d94848', accent: '#ff8a8a', sellValue: 7,   icon: '🥩' },
  pelt:    { id: 'pelt',    name: 'Warm Pelt',     shortName: 'Pelt',    color: '#c49a6c', accent: '#f0d5b4', sellValue: 9,   icon: '🦊' },
  coal:    { id: 'coal',    name: 'Black Coal',    shortName: 'Coal',    color: '#343b46', accent: '#6d7888', sellValue: 10,  icon: '🪨' },
  iron:    { id: 'iron',    name: 'Iron Ore',      shortName: 'Iron',    color: '#768ca8', accent: '#b7cce6', sellValue: 16,  icon: '⛏️' },
  crystal: { id: 'crystal', name: 'Frost Crystal', shortName: 'Crystal', color: '#45d7f5', accent: '#b8f7ff', sellValue: 32,  icon: '💎' },
  plank:   { id: 'plank',   name: 'Timber Planks', shortName: 'Plank',   color: '#c98842', accent: '#f5c583', sellValue: 18,  icon: '🪚' },
  steel:   { id: 'steel',   name: 'Forged Steel',  shortName: 'Steel',   color: '#9fb6cf', accent: '#e4f0fb', sellValue: 48,  icon: '⚙️' },
  coat:    { id: 'coat',    name: 'Fur Coat',      shortName: 'Coat',    color: '#b86f4c', accent: '#f4d6bc', sellValue: 36,  icon: '🧥' },
  stew:    { id: 'stew',    name: 'Hearth Stew',   shortName: 'Stew',    color: '#e67e22', accent: '#ffd394', sellValue: 42,  icon: '🍲' },
  relic:   { id: 'relic',   name: 'Frost Relic',   shortName: 'Relic',   color: '#9b6dff', accent: '#e2d1ff', sellValue: 120, icon: '✨' },
};

export type HomesteadTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface HomesteadTierInfo {
  tier: HomesteadTier;
  name: string;
  unlockZone: number;
  unlockLabel: string;
  description: string;
  baseCosts: Partial<Record<ResourceType, number>>;
  baseGoldCost: number;
}

export const HOMESTEAD_TIERS: HomesteadTierInfo[] = [
  {
    tier: 0,
    name: 'Snow Camp',
    unlockZone: 1,
    unlockLabel: 'Pine Clearing',
    description: 'A humble campfire in the snow. Chop wood & hunt to raise your Timber Hut.',
    baseCosts: {},
    baseGoldCost: 0,
  },
  {
    tier: 1,
    name: 'Timber Hut',
    unlockZone: 1,
    unlockLabel: 'Pine Clearing',
    description: 'Cozy wooden shelter. Unlocks basic camp upgrades & Trading Sled.',
    baseCosts: { wood: 14 },
    baseGoldCost: 0,
  },
  {
    tier: 2,
    name: 'Log Cabin',
    unlockZone: 2,
    unlockLabel: 'Timber Ridge & Coal Seam',
    description: 'Thaws Zone 2! Reveals Coal veins, Arctic Deer, Sawmill & Hunter\'s Lodge.',
    baseCosts: { wood: 32, pelt: 8, meat: 8 },
    baseGoldCost: 110,
  },
  {
    tier: 3,
    name: 'Stone House',
    unlockZone: 3,
    unlockLabel: 'Iron Quarry & Bear Hollow',
    description: 'Thaws Zone 3! Reveals Iron Ore, Bears & Boars, Smeltery & Tannery Market.',
    baseCosts: { plank: 16, coal: 18, pelt: 12 },
    baseGoldCost: 340,
  },
  {
    tier: 4,
    name: 'Grand Mansion',
    unlockZone: 4,
    unlockLabel: 'Crystal Glade & Frost Spire',
    description: 'Thaws Zone 4! Reveals Frost Crystals, Alpha Yetis, Tavern, Artisan Guild & Explorer HQ.',
    baseCosts: { plank: 26, steel: 14, coat: 10 },
    baseGoldCost: 850,
  },
  {
    tier: 5,
    name: 'Town Hall',
    unlockZone: 5,
    unlockLabel: 'Full Frontier Town & Empire',
    description: 'Crowned Frontier Mayor! Assign Explorers, earn passive tribute & found new towns!',
    baseCosts: { steel: 22, coat: 16, stew: 14, relic: 8 },
    baseGoldCost: 1900,
  },
];

export type BuildingKind =
  | 'homestead'
  | 'furnace'
  | 'storehouse'
  | 'trading_post'
  | 'sawmill'
  | 'hunters_lodge'
  | 'smeltery'
  | 'tannery'
  | 'tavern'
  | 'artisan_guild'
  | 'explorers_guild';

export interface BuildingState {
  id: string;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  radius: number;
  zoneRequired: number;
  level: number; // 0 = unbuilt pad, 1+ = built & upgradeable
  maxLevel: number;
  // Active deposit progress toward next level
  deposited: Partial<Record<ResourceType, number>>;
  depositedGold: number;
  // Processor state
  inputRecipe?: Partial<Record<ResourceType, number>>;
  outputType?: ResourceType;
  inputBuffer: Partial<Record<ResourceType, number>>;
  outputStock: number;
  processTimer: number;
  processDuration: number;
  // Furnace fuel & overdrive
  fuel: number; // 0..100
  maxFuel: number;
  overdriveTimer?: number;
  bounceAnim: number;
}

export type ResourceNodeKind = 'pine' | 'ancient_pine' | 'coal_vein' | 'iron_vein' | 'crystal_spire';

export interface ResourceNode {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceType;
  x: number;
  y: number;
  zone: number;
  hp: number;
  maxHp: number;
  yieldAmount: number;
  respawnTimer: number;
  respawnDuration: number;
  shakeTimer: number;
  scale: number;
  variant: number;
}

export type WildlifeKind = 'rabbit' | 'deer' | 'boar' | 'bear' | 'dire_wolf' | 'yeti';

export interface WildlifeEntity {
  id: string;
  kind: WildlifeKind;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  zone: number;
  hp: number;
  maxHp: number;
  speed: number;
  aggressive: boolean;
  attackDamage: number;
  attackCooldown: number;
  telegraphTimer: number;
  telegraphX: number;
  telegraphY: number;
  hitFlash: number;
  facing: number;
  state: 'wander' | 'flee' | 'chase' | 'windup' | 'dead';
  stateTimer: number;
  respawnTimer: number;
  dropMeat: number;
  dropPelt: number;
  dropBonus?: ResourceType;
  dropGold: number;
  radius: number;
}

export type WorkerRole = 'lumberjack' | 'miner' | 'hunter' | 'hauler' | 'merchant';

export interface WorkerEntity {
  id: string;
  role: WorkerRole;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  carry: ResourceType[];
  carryCap: number;
  actionTimer: number;
  state: 'idle' | 'move_to_target' | 'work' | 'return';
  targetId: string | null;
  facing: number;
  bobPhase: number;
}

export interface CustomerEntity {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: 'arriving' | 'shopping' | 'leaving';
  waitTimer: number;
  coatColor: string;
  hatColor: string;
  boughtIcon?: string;
}

export interface FlyingItem {
  id: number;
  resource: ResourceType | 'gold';
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
  duration: number;
  arcHeight: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface Footprint {
  x: number;
  y: number;
  angle: number;
  life: number;
}

export interface GroundLoot {
  id: number;
  resource: ResourceType | 'gold';
  amount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  z: number;
  vz: number;
}

export interface SlashArc {
  x: number;
  y: number;
  angle: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  crit: boolean;
}

export interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  warmth: number; // 0..100
  backpack: ResourceType[];
  swingTimer: number;
  swingTool: 'axe' | 'pick' | 'spear' | 'none';
  swingCount: number;
  hurtFlash: number;
  walkCycle: number;
  footstepTimer: number;
  transferCooldown: number;
  stewBuffTimer: number;
  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
}

export interface PlayerUpgrades {
  axeLevel: number;
  pickLevel: number;
  weaponLevel: number;
  packLevel: number;
  bootsLevel: number;
  cloakLevel: number;
}

export interface WorkerCounts {
  lumberjack: number;
  miner: number;
  hunter: number;
  hauler: number;
  merchant: number;
}

export interface ExplorerMissionDef {
  id: string;
  name: string;
  subtitle: string;
  durationSec: number;
  minRegion: number;
  goldReward: number;
  resourceRewards: Partial<Record<ResourceType, number>>;
  legacyPoints: number;
  icon: string;
}

export interface ExplorerState {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  unlocked: boolean;
  hireCost: number;
  level: number;
  activeMissionId: string | null;
  missionRemainingSec: number;
  missionTotalSec: number;
  completedCount: number;
}

export interface StagePalette {
  snowBase: string;
  snowMid: string;
  snowShadow: string;
  pineLight: string;
  pineDark: string;
  rockColor: string;
  fogTint: string;
  auroraColors?: [string, string];
}

export interface StageDef {
  id: number; // 1..25
  regionIndex: number; // 0..4
  regionName: string;
  townName: string;
  subtitle: string;
  difficultyScale: number;
  coldIntensity: number;
  specialBonus: string;
  bonusType: 'wood' | 'hunt' | 'mine' | 'gold' | 'all';
  seed: number;
  palette: StagePalette;
}

export interface TownSaveRecord {
  stageId: number;
  homesteadTier: HomesteadTier;
  buildingLevels: Record<string, number>;
  buildingDeposits: Record<string, { res: Partial<Record<ResourceType, number>>; gold: number }>;
  workers: WorkerCounts;
  townStockpile: Partial<Record<ResourceType, number>>;
  tributePerMin: number;
  reachedTownHall: boolean;
}

export interface GlobalSaveState {
  version: number;
  activeStageId: number;
  highestUnlockedStage: number;
  gold: number;
  legacyPoints: number;
  upgrades: PlayerUpgrades;
  explorers: ExplorerState[];
  towns: Record<number, TownSaveRecord>;
  totalTreesChopped: number;
  totalAnimalsHunted: number;
  totalGoldEarned: number;
  muted: boolean;
  lastSavedAt: number;
}

export interface BlizzardState {
  active: boolean;
  timer: number; // time until next state flip
  intensity: number; // 0..1 smooth blend
}
