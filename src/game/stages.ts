import { ExplorerMissionDef, ExplorerState, StageDef, StagePalette } from './types';

const REGION_PALETTES: StagePalette[] = [
  // Region 1: Pinewood Thaw
  {
    snowBase: '#e8f3fb',
    snowMid: '#d4e6f4',
    snowShadow: '#b2cde2',
    pineLight: '#2e7d5b',
    pineDark: '#1b4f3a',
    rockColor: '#697c8f',
    fogTint: 'rgba(186, 217, 240, 0.88)',
  },
  // Region 2: Frozen Fjord
  {
    snowBase: '#dff1fb',
    snowMid: '#c2e0f5',
    snowShadow: '#93bedd',
    pineLight: '#286c73',
    pineDark: '#18444d',
    rockColor: '#566e85',
    fogTint: 'rgba(148, 198, 232, 0.88)',
  },
  // Region 3: Ironback Peaks
  {
    snowBase: '#e6ecf2',
    snowMid: '#ced8e3',
    snowShadow: '#a3b3c4',
    pineLight: '#3b6a58',
    pineDark: '#234237',
    rockColor: '#5c5f6b',
    fogTint: 'rgba(165, 179, 198, 0.90)',
  },
  // Region 4: Crystal Glacier
  {
    snowBase: '#e6f5ff',
    snowMid: '#cce4fa',
    snowShadow: '#9ec1eb',
    pineLight: '#336b8c',
    pineDark: '#1e3f5e',
    rockColor: '#666b96',
    fogTint: 'rgba(161, 189, 242, 0.90)',
    auroraColors: ['rgba(69, 215, 245, 0.14)', 'rgba(155, 109, 255, 0.12)'],
  },
  // Region 5: Aurora Citadel
  {
    snowBase: '#dce9f7',
    snowMid: '#bdd3ec',
    snowShadow: '#8da9cf',
    pineLight: '#2c6e78',
    pineDark: '#173d4a',
    rockColor: '#4c5473',
    fogTint: 'rgba(128, 152, 209, 0.90)',
    auroraColors: ['rgba(61, 245, 180, 0.18)', 'rgba(191, 95, 255, 0.16)'],
  },
];

interface RawTownSpec {
  regionIndex: number;
  regionName: string;
  townName: string;
  subtitle: string;
  specialBonus: string;
  bonusType: StageDef['bonusType'];
}

const RAW_TOWNS: RawTownSpec[] = [
  // Region 1: Pinewood Thaw (1-5)
  { regionIndex: 0, regionName: 'Pinewood Thaw', townName: 'Frostbrook', subtitle: 'First clearing by the pine stream', specialBonus: '+25% Pine Wood yield', bonusType: 'wood' },
  { regionIndex: 0, regionName: 'Pinewood Thaw', townName: 'Cedar Bend', subtitle: 'Abundant timber & swift snow hares', specialBonus: '+25% Hunting loot', bonusType: 'hunt' },
  { regionIndex: 0, regionName: 'Pinewood Thaw', townName: 'Hearthstone', subtitle: 'Sheltered hollow with warm trade routes', specialBonus: '+20% Trade Gold', bonusType: 'gold' },
  { regionIndex: 0, regionName: 'Pinewood Thaw', townName: 'Pinecrest', subtitle: 'High ridge rich in coal seams', specialBonus: '+25% Mining yield', bonusType: 'mine' },
  { regionIndex: 0, regionName: 'Pinewood Thaw', townName: 'Snowfall Haven', subtitle: 'Capital of the Pinewood frontier', specialBonus: '+15% All yields', bonusType: 'all' },

  // Region 2: Frozen Fjord (6-10)
  { regionIndex: 1, regionName: 'Frozen Fjord', townName: 'Icewater Cove', subtitle: 'Glacial bay bustling with fur trappers', specialBonus: '+30% Hunting loot', bonusType: 'hunt' },
  { regionIndex: 1, regionName: 'Frozen Fjord', townName: 'Driftwood Pier', subtitle: 'Ancient logs washed along frozen shores', specialBonus: '+30% Pine Wood yield', bonusType: 'wood' },
  { regionIndex: 1, regionName: 'Frozen Fjord', townName: 'Whalebone Bluff', subtitle: 'Cliffside market for sea-ice caravans', specialBonus: '+25% Trade Gold', bonusType: 'gold' },
  { regionIndex: 1, regionName: 'Frozen Fjord', townName: 'Fjordwatch', subtitle: 'Deep slate quarries beneath the ice', specialBonus: '+30% Mining yield', bonusType: 'mine' },
  { regionIndex: 1, regionName: 'Frozen Fjord', townName: 'Northwind Port', subtitle: 'Grand harbor of the northern fjords', specialBonus: '+20% All yields', bonusType: 'all' },

  // Region 3: Ironback Peaks (11-15)
  { regionIndex: 2, regionName: 'Ironback Peaks', townName: 'Anvil Pass', subtitle: 'Mountain trail lined with raw iron veins', specialBonus: '+35% Mining yield', bonusType: 'mine' },
  { regionIndex: 2, regionName: 'Ironback Peaks', townName: 'Sootridge', subtitle: 'Coal-rich foothills & roaring furnaces', specialBonus: '+30% Wood & Coal', bonusType: 'wood' },
  { regionIndex: 2, regionName: 'Ironback Peaks', townName: 'Hammerfall', subtitle: 'Blacksmith stronghold of the peaks', specialBonus: '+30% Trade Gold', bonusType: 'gold' },
  { regionIndex: 2, regionName: 'Ironback Peaks', townName: 'Cragspire', subtitle: 'Grizzly territory with legendary pelts', specialBonus: '+35% Hunting loot', bonusType: 'hunt' },
  { regionIndex: 2, regionName: 'Ironback Peaks', townName: 'Ironcrown', subtitle: 'Fortress city of the Ironback range', specialBonus: '+25% All yields', bonusType: 'all' },

  // Region 4: Crystal Glacier (16-20)
  { regionIndex: 3, regionName: 'Crystal Glacier', townName: 'Prism Hollow', subtitle: 'Luminous frost crystals jut from the snow', specialBonus: '+40% Mining yield', bonusType: 'mine' },
  { regionIndex: 3, regionName: 'Crystal Glacier', townName: 'Shimmerdrift', subtitle: 'Stalking grounds of dire snow wolves', specialBonus: '+40% Hunting loot', bonusType: 'hunt' },
  { regionIndex: 3, regionName: 'Crystal Glacier', townName: 'Shardgate', subtitle: 'Gem merchant crossroads of the glacier', specialBonus: '+35% Trade Gold', bonusType: 'gold' },
  { regionIndex: 3, regionName: 'Crystal Glacier', townName: 'Frostveil', subtitle: 'Petrified evergreens & crystal groves', specialBonus: '+40% Pine Wood yield', bonusType: 'wood' },
  { regionIndex: 3, regionName: 'Crystal Glacier', townName: 'Glacial Keep', subtitle: 'Shining bastion carved into pure ice', specialBonus: '+30% All yields', bonusType: 'all' },

  // Region 5: Aurora Citadel (21-25)
  { regionIndex: 4, regionName: 'Aurora Citadel', townName: 'Starlight Outpost', subtitle: 'First camp beneath the dancing aurora', specialBonus: '+45% Trade Gold', bonusType: 'gold' },
  { regionIndex: 4, regionName: 'Aurora Citadel', townName: 'Borealis Reach', subtitle: 'Ancient woods bathed in emerald sky', specialBonus: '+45% Pine Wood yield', bonusType: 'wood' },
  { regionIndex: 4, regionName: 'Aurora Citadel', townName: 'Solstice Gate', subtitle: 'Lair of towering Alpha Yetis', specialBonus: '+45% Hunting loot', bonusType: 'hunt' },
  { regionIndex: 4, regionName: 'Aurora Citadel', townName: 'Crown of Winter', subtitle: 'Rich starlight-crystal caverns', specialBonus: '+45% Mining yield', bonusType: 'mine' },
  { regionIndex: 4, regionName: 'Aurora Citadel', townName: 'Aurora Citadel', subtitle: 'Sovereign capital of the Frozen Frontier', specialBonus: '+40% All yields', bonusType: 'all' },
];

export const STAGES: StageDef[] = RAW_TOWNS.map((spec, idx) => {
  const id = idx + 1;
  // Gentle, fun scaling curve so upgrading tools feels impactful and players can blitz or chill
  const difficultyScale = Number((1 + idx * 0.16 + Math.pow(spec.regionIndex, 1.35) * 0.18).toFixed(2));
  const coldIntensity = Number((0.8 + spec.regionIndex * 0.35 + (idx % 5) * 0.06).toFixed(2));
  return {
    id,
    regionIndex: spec.regionIndex,
    regionName: spec.regionName,
    townName: spec.townName,
    subtitle: spec.subtitle,
    difficultyScale,
    coldIntensity,
    specialBonus: spec.specialBonus,
    bonusType: spec.bonusType,
    seed: 1009 * id + 37 * (spec.regionIndex + 1),
    palette: REGION_PALETTES[spec.regionIndex],
  };
});

export function getStageDef(stageId: number): StageDef {
  return STAGES[Math.max(0, Math.min(STAGES.length - 1, stageId - 1))];
}

export const EXPLORER_MISSIONS: ExplorerMissionDef[] = [
  {
    id: 'scout_timber',
    name: 'Timber & Coal Scout',
    subtitle: 'Chart nearby ridges for firewood & coal',
    durationSec: 20,
    minRegion: 0,
    goldReward: 120,
    resourceRewards: { wood: 18, coal: 8 },
    legacyPoints: 2,
    icon: '🧭',
  },
  {
    id: 'trapper_safari',
    name: 'Wilderness Hunt',
    subtitle: 'Track snow elk & winter foxes',
    durationSec: 30,
    minRegion: 0,
    goldReward: 210,
    resourceRewards: { meat: 14, pelt: 12 },
    legacyPoints: 3,
    icon: '🏹',
  },
  {
    id: 'quarry_survey',
    name: 'Deep Quarry Survey',
    subtitle: 'Mine exposed iron & crystal seams',
    durationSec: 40,
    minRegion: 0,
    goldReward: 340,
    resourceRewards: { iron: 12, crystal: 5 },
    legacyPoints: 5,
    icon: '⛏️',
  },
  {
    id: 'trade_caravan',
    name: 'Frontier Trade Sled',
    subtitle: 'Escort luxury coats to southern ports',
    durationSec: 45,
    minRegion: 0,
    goldReward: 650,
    resourceRewards: { plank: 8, steel: 4 },
    legacyPoints: 7,
    icon: '🛷',
  },
  {
    id: 'relic_delve',
    name: 'Ancient Glacier Ruin',
    subtitle: 'Recover frost relics & explorer blueprints',
    durationSec: 60,
    minRegion: 1,
    goldReward: 1100,
    resourceRewards: { crystal: 10, relic: 4 },
    legacyPoints: 14,
    icon: '🏔️',
  },
];

export function createInitialExplorers(): ExplorerState[] {
  return [
    {
      id: 'astrid',
      name: 'Astrid',
      title: 'Pathfinder Scout',
      avatarColor: '#38bdf8',
      unlocked: true,
      hireCost: 0,
      level: 1,
      activeMissionId: null,
      missionRemainingSec: 0,
      missionTotalSec: 0,
      completedCount: 0,
    },
    {
      id: 'bram',
      name: 'Bram',
      title: 'Master Trapper',
      avatarColor: '#f59e0b',
      unlocked: false,
      hireCost: 450,
      level: 1,
      activeMissionId: null,
      missionRemainingSec: 0,
      missionTotalSec: 0,
      completedCount: 0,
    },
    {
      id: 'kael',
      name: 'Kael',
      title: 'Glacier Cartographer',
      avatarColor: '#a78bfa',
      unlocked: false,
      hireCost: 1100,
      level: 1,
      activeMissionId: null,
      missionRemainingSec: 0,
      missionTotalSec: 0,
      completedCount: 0,
    },
    {
      id: 'freya',
      name: 'Freya',
      title: 'Yeti Slayer',
      avatarColor: '#fb7185',
      unlocked: false,
      hireCost: 2400,
      level: 1,
      activeMissionId: null,
      missionRemainingSec: 0,
      missionTotalSec: 0,
      completedCount: 0,
    },
  ];
}
