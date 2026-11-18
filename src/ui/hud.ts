import { sfx } from '../game/audio';
import { GameEngine } from '../game/engine';
import { EXPLORER_MISSIONS, STAGES } from '../game/stages';
import { ALL_RESOURCES, HOMESTEAD_TIERS, PlayerUpgrades, RESOURCE_META, ResourceType, WorkerRole } from '../game/types';

export type DrawerTab = 'gear' | 'town' | 'explorers' | 'map' | null;

export class GameHud {
  private root: HTMLElement;
  private engine: GameEngine;
  private activeTab: DrawerTab = null;
  private showTitleScreen = true;
  private crownedModalStageId: number | null = null;
  private toastTimer = 0;

  // Cached DOM nodes so 60fps updates never thrash the DOM
  private topTownEl!: HTMLElement;
  private topGoldEl!: HTMLElement;
  private topPackEl!: HTMLElement;
  private topWarmthEl!: HTMLElement;
  private topWarmthTextEl!: HTMLElement;
  private muteBtnEl!: HTMLElement;
  private goalStripEl!: HTMLElement;
  private resStripEl!: HTMLElement;
  private dashBtnEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private dockEl!: HTMLElement;
  private drawerHostEl!: HTMLElement;
  private modalHostEl!: HTMLElement;

  private uiRefreshAccum = 0;
  private lastGoalHtml = '';
  private lastResHtml = '';
  private lastDrawerHtml = '';
  private pointerDownInUi = false;

  constructor(root: HTMLElement, engine: GameEngine) {
    this.root = root;
    this.engine = engine;
    this.buildShell();
    this.renderTitleModal();
    this.syncLiveHud();
  }

  public showToast(msg: string): void {
    this.toastTimer = 3.4;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
  }

  public showTownCrowned(stageId: number): void {
    this.crownedModalStageId = stageId;
    this.activeTab = null;
    this.renderDrawer();
    this.renderCrownedModal();
  }

  public isBlockingCanvas(): boolean {
    return this.showTitleScreen || this.activeTab !== null || this.crownedModalStageId !== null;
  }

  public tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastEl.classList.remove('visible');
      }
    }
    this.uiRefreshAccum += dt;
    if (this.uiRefreshAccum >= 0.25) {
      this.uiRefreshAccum = 0;
      this.syncLiveHud();
      if (this.activeTab !== null && !this.pointerDownInUi) {
        this.renderDrawer(false);
      }
    }
  }

  private buildShell(): void {
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-row">
          <div class="pill pill-town" id="hud-town"></div>
          <div style="display:flex;gap:6px;align-items:center;">
            <div class="pill pill-gold" id="hud-gold">💰 0</div>
            <div class="pill pill-pack" id="hud-pack">🎒 0/10</div>
            <button class="pill pill-btn" id="hud-mute" aria-label="Toggle Audio">🔊</button>
          </div>
        </div>
        <div class="hud-row" style="justify-content:space-between;">
          <div class="pill" style="padding:4px 10px;font-size:12px;">
            <div class="warmth-bar-wrap">
              <span id="hud-warmth-txt">🔥 100%</span>
              <div class="warmth-track"><div class="warmth-fill" id="hud-warmth-fill"></div></div>
            </div>
          </div>
          <div class="goal-strip" id="hud-goal-strip"></div>
        </div>
        <div class="res-strip" id="hud-res-strip"></div>
      </div>

      <div class="toast-box" id="hud-toast"></div>

      <button class="dash-fab" id="btn-dash" aria-label="Dash">
        <span class="dash-ico">⚡</span>
        <span id="dash-label">DASH</span>
      </button>

      <div class="hud-bottom">
        <div class="control-hint">Drag or WASD to move · Space / ⚡ to Dash · Auto-chop, hunt &amp; build</div>
        <div class="dock" id="hud-dock">
          <button class="dock-btn" data-tab="gear"><span class="ico">🛠️</span><span>Gear</span></button>
          <button class="dock-btn" data-tab="town"><span class="ico">🏘️</span><span>Town</span></button>
          <button class="dock-btn" data-tab="explorers"><span class="ico">🧭</span><span>Explorers</span></button>
          <button class="dock-btn" data-tab="map"><span class="ico">🗺️</span><span>25 Towns</span></button>
        </div>
      </div>

      <div id="drawer-host"></div>
      <div id="modal-host"></div>
    `;

    this.topTownEl = this.root.querySelector('#hud-town')!;
    this.topGoldEl = this.root.querySelector('#hud-gold')!;
    this.topPackEl = this.root.querySelector('#hud-pack')!;
    this.topWarmthEl = this.root.querySelector('#hud-warmth-fill')!;
    this.topWarmthTextEl = this.root.querySelector('#hud-warmth-txt')!;
    this.muteBtnEl = this.root.querySelector('#hud-mute')!;
    this.goalStripEl = this.root.querySelector('#hud-goal-strip')!;
    this.resStripEl = this.root.querySelector('#hud-res-strip')!;
    this.dashBtnEl = this.root.querySelector('#btn-dash')!;
    this.toastEl = this.root.querySelector('#hud-toast')!;
    this.dockEl = this.root.querySelector('#hud-dock')!;
    this.drawerHostEl = this.root.querySelector('#drawer-host')!;
    this.modalHostEl = this.root.querySelector('#modal-host')!;

    this.root.addEventListener('pointerdown', () => {
      this.pointerDownInUi = true;
    });
    window.addEventListener('pointerup', () => {
      this.pointerDownInUi = false;
    });
    window.addEventListener('pointercancel', () => {
      this.pointerDownInUi = false;
    });

    this.muteBtnEl.addEventListener('click', () => {
      sfx.muted = !sfx.muted;
      if (!sfx.muted) sfx.unlock();
      this.engine.persistSave();
      this.syncLiveHud();
    });

    this.dashBtnEl.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      sfx.unlock();
      this.engine.triggerDash();
    });

    this.dockEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.dock-btn') as HTMLElement | null;
      if (!btn) return;
      sfx.unlock();
      const tab = btn.dataset.tab as DrawerTab;
      this.activeTab = this.activeTab === tab ? null : tab;
      this.renderDrawer(true);
      this.syncLiveHud();
    });

    // Persistent delegated clicks on Goal Strip (never dropped by periodic refresh!)
    this.goalStripEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const e = this.engine;
      if (target.closest('#btn-collect-tribute')) {
        const got = e.collectPendingTribute();
        if (got > 0) this.showToast(`👑 Collected +${got}g Empire Tribute!`);
        this.syncLiveHud();
        return;
      }
      if (target.closest('#btn-goal-upgrade')) {
        if (e.instantUpgradeBuilding('homestead')) {
          this.renderDrawer(true);
          this.syncLiveHud();
        } else {
          this.showToast('Gather materials & walk onto the Homestead pad to deposit!');
        }
        return;
      }
      if (target.closest('#btn-goal-next-town')) {
        this.activeTab = 'map';
        this.renderDrawer(true);
        this.syncLiveHud();
      }
    });

    // Persistent delegated clicks on Drawer Host (100% reliable on every tap/click!)
    this.drawerHostEl.addEventListener('click', (ev) => {
      this.handleDrawerClick(ev);
    });
  }

  private syncLiveHud(): void {
    const e = this.engine;
    const tierInfo = HOMESTEAD_TIERS[e.homesteadTier];
    this.topTownEl.innerHTML = `<span>🏔️</span><span>#${e.stage.id} ${e.stage.townName}</span><span style="color:#7dd3fc;">· ${tierInfo.name}</span>`;
    this.topGoldEl.textContent = `💰 ${Math.floor(e.save.gold).toLocaleString()}`;
    this.topPackEl.textContent = `🎒 ${e.player.backpack.length}/${e.getBackpackCapacity()}`;

    const warmthPct = Math.round(e.player.warmth);
    this.topWarmthEl.style.width = `${warmthPct}%`;
    this.topWarmthTextEl.textContent = e.blizzard.active ? `❄️ BLIZZARD ${warmthPct}%` : `🔥 ${warmthPct}%`;
    this.muteBtnEl.textContent = sfx.muted ? '🔇' : '🔊';

    // Goal strip + Tribute collect button
    const home = e.buildings.find((b) => b.kind === 'homestead');
    let html = '';
    if (e.pendingTributeGold > 0) {
      html += `<button class="tribute-btn" id="btn-collect-tribute">👑 Collect +${e.pendingTributeGold}g Tribute</button>`;
    }

    if (home && home.level < 5) {
      const next = HOMESTEAD_TIERS[home.level + 1];
      const cost = e.getBuildingNextCost(home);
      let ready = e.save.gold >= Math.max(0, cost.gold - home.depositedGold);
      const chips: string[] = [];
      for (const [k, v] of Object.entries(cost.resources)) {
        const res = k as ResourceType;
        const rem = Math.max(0, (v || 0) - (home.deposited[res] || 0));
        if (rem > 0) {
          const have = e.getTotalAvailableResource(res);
          if (have < rem) ready = false;
          chips.push(`${RESOURCE_META[res].icon}${have}/${rem}`);
        }
      }
      const gRem = Math.max(0, cost.gold - home.depositedGold);
      if (gRem > 0) chips.push(`💰${gRem}`);
      html += `<div class="goal-banner ${ready ? 'ready' : ''}" id="btn-goal-upgrade">
        <span>${ready ? '✨ Tap to Upgrade:' : '🎯 Next:'} ${next.name}</span>
        <span style="opacity:0.9;">${chips.join(' ')}</span>
      </div>`;
    } else if (e.stage.id < STAGES.length) {
      html += `<div class="goal-banner ready" id="btn-goal-next-town">👑 Town Hall Complete! Open 25 Towns Map →</div>`;
    } else {
      html += `<div class="goal-banner ready">👑 Supreme Ruler of Aurora Citadel!</div>`;
    }

    if (html !== this.lastGoalHtml && !this.pointerDownInUi) {
      this.lastGoalHtml = html;
      this.goalStripEl.innerHTML = html;
    }

    // Live compact combined resource strip (Backpack + Storehouse)
    const resHtml = ALL_RESOURCES.map((r) => {
      const total = e.getTotalAvailableResource(r);
      return total > 0 ? `<span class="res-mini">${RESOURCE_META[r].icon} ${total}</span>` : '';
    })
      .filter(Boolean)
      .join('');
    if (resHtml !== this.lastResHtml) {
      this.lastResHtml = resHtml;
      this.resStripEl.innerHTML = resHtml;
    }

    // Dash button cooldown display
    const cd = e.player.dashCooldown;
    this.dashBtnEl.classList.toggle('cooling', cd > 0);
    const dashLbl = this.dashBtnEl.querySelector('#dash-label');
    if (dashLbl) {
      dashLbl.textContent = cd > 0 ? `${cd.toFixed(1)}s` : 'DASH';
    }

    // Update dock active highlight & notification dots
    const hasClaimableExplorer = e.save.explorers.some((ex) => ex.activeMissionId && ex.missionRemainingSec <= 0);
    const canBuyUpgrade = e.getUpgradeList().some((u) => u.level < u.maxLevel && e.save.gold >= u.cost);
    const canHireWorker = e
      .getWorkerHireList()
      .some((w) => w.count < w.maxCount && e.homesteadTier >= w.minTier && e.save.gold >= w.cost);

    this.dockEl.querySelectorAll('.dock-btn').forEach((el) => {
      const btn = el as HTMLElement;
      const tab = btn.dataset.tab as DrawerTab;
      btn.classList.toggle('active', this.activeTab === tab);
      const oldDot = btn.querySelector('.badge-dot');
      if (oldDot) oldDot.remove();
      const showDot =
        (tab === 'gear' && canBuyUpgrade) ||
        (tab === 'town' && canHireWorker) ||
        (tab === 'explorers' && hasClaimableExplorer) ||
        (tab === 'map' && e.homesteadTier >= 5 && e.stage.id === e.save.highestUnlockedStage - 1);
      if (showDot) {
        const dot = document.createElement('span');
        dot.className = 'badge-dot';
        btn.appendChild(dot);
      }
    });
  }

  private renderTitleModal(): void {
    if (!this.showTitleScreen) {
      this.modalHostEl.innerHTML = '';
      return;
    }
    const e = this.engine;
    const isReturning = e.save.totalTreesChopped > 0 || e.homesteadTier > 0 || e.stage.id > 1;
    const ctaText = isReturning ? `CONTINUE · Town #${e.stage.id} ${e.stage.townName}` : 'START FRONTIER ADVENTURE';

    this.modalHostEl.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div style="font-size:44px;line-height:1;">❄️🔥🪓</div>
          <div class="modal-title">FROSTFALL FRONTIER</div>
          <div class="modal-subtitle">
            The real snow-survival game the ads promised — zero timers, zero paywalls, pure 90s arcade fun with modern visuals.
          </div>
          <div class="feature-pills">
            <span class="feature-pill">🪓 Chop, Mine &amp; Hunt</span>
            <span class="feature-pill">🏠 Hut → Cabin → House → Mansion → Town</span>
            <span class="feature-pill">🧭 Assign Explorers</span>
            <span class="feature-pill">🗺️ 25 Frontier Towns</span>
          </div>
          <button class="play-cta" id="btn-start-play">${ctaText}</button>
        </div>
      </div>
    `;

    this.modalHostEl.querySelector('#btn-start-play')!.addEventListener('click', () => {
      sfx.unlock();
      sfx.playUpgrade();
      this.showTitleScreen = false;
      this.modalHostEl.innerHTML = '';
      if (isReturning) {
        this.showToast(`🏔️ Welcome back to #${e.stage.id} ${e.stage.townName}!`);
      } else {
        this.showToast('Chop pine trees & walk to the Campfire pad to build your Timber Hut!');
      }
    });
  }

  private renderCrownedModal(): void {
    if (this.crownedModalStageId === null) {
      this.modalHostEl.innerHTML = '';
      return;
    }
    const e = this.engine;
    const nextId = Math.min(STAGES.length, this.crownedModalStageId + 1);
    const hasNext = this.crownedModalStageId < STAGES.length;
    const nextStage = STAGES[nextId - 1];

    this.modalHostEl.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          <div style="font-size:46px;line-height:1;">👑🏰🎉</div>
          <div class="modal-title">${e.stage.townName} Crowned!</div>
          <div class="modal-subtitle">
            You raised a grand <b>Town Hall</b>! ${e.stage.townName} now generates <b>+${e.getTownTributePerMin()}g/min</b> Frontier Tribute and grants <b>+15% global Empire speed</b>.
            ${hasNext ? `<br/><br/>Next Frontier unlocked: <b>#${nextStage.id} ${nextStage.townName}</b> (${nextStage.regionName})` : '<br/><br/>You have conquered all 25 Frontier Towns!'}
          </div>
          ${
            hasNext
              ? `<button class="play-cta" id="btn-found-next">Found #${nextStage.id} ${nextStage.townName} →</button>`
              : ''
          }
          <button class="action-btn blue" id="btn-stay-town" style="padding:12px;">Stay Here to Hunt &amp; Manage</button>
        </div>
      </div>
    `;

    const foundBtn = this.modalHostEl.querySelector('#btn-found-next');
    if (foundBtn) {
      foundBtn.addEventListener('click', () => {
        this.crownedModalStageId = null;
        this.modalHostEl.innerHTML = '';
        e.loadTownStage(nextId);
        this.showToast(`🧭 Welcome to Town #${nextStage.id}: ${nextStage.townName}!`);
        this.syncLiveHud();
      });
    }

    this.modalHostEl.querySelector('#btn-stay-town')!.addEventListener('click', () => {
      this.crownedModalStageId = null;
      this.modalHostEl.innerHTML = '';
    });
  }

  private renderDrawer(force = true): void {
    if (!this.activeTab) {
      if (this.lastDrawerHtml !== '') {
        this.lastDrawerHtml = '';
        this.drawerHostEl.innerHTML = '';
      }
      return;
    }

    const titles: Record<Exclude<DrawerTab, null>, string> = {
      gear: '🛠️ Personal Gear & Hunting Upgrades',
      town: `🏘️ ${this.engine.stage.townName} Management`,
      explorers: '🧭 Frontier Explorers Guild',
      map: '🗺️ 25-Town Frontier Empire Map',
    };

    let bodyHtml = '';
    if (this.activeTab === 'gear') bodyHtml = this.buildGearHtml();
    else if (this.activeTab === 'town') bodyHtml = this.buildTownHtml();
    else if (this.activeTab === 'explorers') bodyHtml = this.buildExplorersHtml();
    else if (this.activeTab === 'map') bodyHtml = this.buildMapHtml();

    const fullHtml = `
      <div class="drawer-backdrop" id="drawer-backdrop">
        <div class="drawer" id="drawer-panel">
          <div class="drawer-header">
            <div class="drawer-title">${titles[this.activeTab]}</div>
            <button class="close-btn" id="drawer-close">✕</button>
          </div>
          <div class="drawer-body">${bodyHtml}</div>
        </div>
      </div>
    `;

    // Skip DOM replacement when nothing changed so active clicks/scrolls are NEVER interrupted!
    if (!force && fullHtml === this.lastDrawerHtml) {
      return;
    }
    this.lastDrawerHtml = fullHtml;

    const prevScroll = this.drawerHostEl.querySelector('.drawer-body')?.scrollTop || 0;
    this.drawerHostEl.innerHTML = fullHtml;
    const bodyEl = this.drawerHostEl.querySelector('.drawer-body');
    if (bodyEl) bodyEl.scrollTop = prevScroll;
  }

  private buildGearHtml(): string {
    const e = this.engine;
    const list = e.getUpgradeList();
    const empirePct = Math.round((e.getEmpireMultiplier() - 1) * 100);
    let html = `
      <div class="card">
        <div class="card-info">
          <div class="card-name">Empire Bonus: +${empirePct}% Power</div>
          <div class="card-sub">Homestead Stars: ${e.getTotalHomesteadStars()}★ (+5% ea) · Town Halls: ${e.getEmpireTownCount()}/25 · Legacy: ${e.save.legacyPoints}</div>
        </div>
        <div style="font-size:22px;">👑</div>
      </div>
      <div class="section-label">Your Tools &amp; Hunting Kit (Persists Across All 25 Towns)</div>
    `;
    for (const u of list) {
      const maxed = u.level >= u.maxLevel;
      const canAfford = e.save.gold >= u.cost;
      html += `
        <div class="card">
          <div class="card-left">
            <div class="card-ico">${u.icon}</div>
            <div class="card-info">
              <div class="card-name">${u.name} <span style="color:#7dd3fc;">Lv.${u.level}</span></div>
              <div class="card-sub">${u.desc} · <b>${u.statLabel}</b></div>
            </div>
          </div>
          <button class="action-btn" data-upgrade="${u.key}" ${maxed || !canAfford ? 'disabled' : ''}>
            ${maxed ? 'MAX' : `💰 ${u.cost}`}
          </button>
        </div>
      `;
    }
    return html;
  }

  private buildTownHtml(): string {
    const e = this.engine;
    const stockChips = ALL_RESOURCES.filter((r) => (e.townStockpile[r] || 0) > 0)
      .map((r) => `<span class="stock-chip">${RESOURCE_META[r].icon} ${RESOURCE_META[r].shortName}: ${e.townStockpile[r]}</span>`)
      .join('');

    let html = `
      <div class="card card-col">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <div class="card-name">Town Storehouse &amp; Tribute</div>
            <div class="card-sub">Passive Tribute when away: <b>+${e.getTownTributePerMin()}g/min</b> · Trade Boost: <b>${Math.round(e.getTradeGoldMultiplier() * 100)}%</b></div>
          </div>
          <button class="action-btn green" id="btn-sell-stockpile" ${stockChips ? '' : 'disabled'}>Sell Stockpile</button>
        </div>
        <div class="stock-grid" style="margin-top:8px;">
          ${stockChips || '<span class="card-sub">Workers &amp; Explorers store extra goods here automatically.</span>'}
        </div>
      </div>
      <div class="section-label">Town Crew (Autonomous Workers)</div>
    `;

    for (const w of e.getWorkerHireList()) {
      const locked = e.homesteadTier < w.minTier;
      const maxed = w.count >= w.maxCount;
      const canAfford = e.save.gold >= w.cost;
      html += `
        <div class="card">
          <div class="card-left">
            <div class="card-ico">${w.icon}</div>
            <div class="card-info">
              <div class="card-name">${w.name} <span style="color:#86efac;">${w.count}/${w.maxCount}</span></div>
              <div class="card-sub">${locked ? `Unlocks at ${HOMESTEAD_TIERS[w.minTier].name}` : w.desc}</div>
            </div>
          </div>
          <button class="action-btn blue" data-hire="${w.role}" ${locked || maxed || !canAfford ? 'disabled' : ''}>
            ${maxed ? 'FULL' : locked ? 'LOCKED' : `💰 ${w.cost}`}
          </button>
        </div>
      `;
    }

    html += `<div class="section-label">Town Buildings &amp; Businesses</div>`;
    const unlockedZone = e.getUnlockedZone();
    for (const b of e.buildings) {
      if (b.zoneRequired > unlockedZone) continue;
      const maxed = b.level >= b.maxLevel;
      const cost = e.getBuildingNextCost(b);
      let canBuild = !maxed && e.save.gold >= Math.max(0, cost.gold - b.depositedGold);
      const costStr: string[] = [];
      for (const [k, v] of Object.entries(cost.resources)) {
        const res = k as ResourceType;
        const rem = Math.max(0, (v || 0) - (b.deposited[res] || 0));
        if (rem > 0) {
          if (e.getTotalAvailableResource(res) < rem) canBuild = false;
          costStr.push(`${RESOURCE_META[res].icon}${rem}`);
        }
      }
      const gRem = Math.max(0, cost.gold - b.depositedGold);
      if (gRem > 0) costStr.push(`💰${gRem}`);
      const label = b.kind === 'homestead' ? HOMESTEAD_TIERS[b.level].name : b.name;
      html += `
        <div class="card">
          <div class="card-info">
            <div class="card-name">${label} <span style="color:#facc15;">Lv.${b.level}/${b.maxLevel}</span></div>
            <div class="card-sub">${maxed ? 'Max Level Reached' : `Next: ${costStr.join('  ')}`}</div>
          </div>
          <button class="action-btn" data-bldg="${b.id}" ${maxed || !canBuild ? 'disabled' : ''}>
            ${maxed ? 'MAX' : b.level === 0 ? 'Build' : 'Upgrade'}
          </button>
        </div>
      `;
    }
    return html;
  }

  private buildExplorersHtml(): string {
    const e = this.engine;
    const unlocked = e.areExplorersUnlocked();
    if (!unlocked) {
      return `
        <div class="card card-col" style="text-align:center;padding:18px;">
          <div style="font-size:38px;">🧭🏔️</div>
          <div class="card-name">Explorer's Guild Locked</div>
          <div class="card-sub">
            Upgrade your Homestead to <b>Grand Mansion</b> (build Explorer's Hall) or reach <b>Town Hall</b> to assign Explorers on frontier expeditions!
          </div>
        </div>
      `;
    }

    let html = `
      <div class="card">
        <div class="card-info">
          <div class="card-name">Frontier Expedition Command</div>
          <div class="card-sub">Send Explorers out while you hunt, chop, or manage towns! Legacy Points: <b>${e.save.legacyPoints}</b></div>
        </div>
        <div style="font-size:24px;">🧭</div>
      </div>
    `;

    for (const exp of e.save.explorers) {
      if (!exp.unlocked) {
        html += `
          <div class="card">
            <div class="card-left">
              <div class="card-ico" style="background:${exp.avatarColor}33;border:1px solid ${exp.avatarColor};">🧭</div>
              <div class="card-info">
                <div class="card-name">${exp.name} · ${exp.title}</div>
                <div class="card-sub">Recruit to run parallel frontier expeditions</div>
              </div>
            </div>
            <button class="action-btn blue" data-hire-exp="${exp.id}" ${e.save.gold < exp.hireCost ? 'disabled' : ''}>
              💰 ${exp.hireCost}
            </button>
          </div>
        `;
        continue;
      }

      if (exp.activeMissionId) {
        const mission = EXPLORER_MISSIONS.find((m) => m.id === exp.activeMissionId);
        const done = exp.missionRemainingSec <= 0;
        html += `
          <div class="card">
            <div class="card-left">
              <div class="card-ico" style="background:${exp.avatarColor}33;border:1px solid ${exp.avatarColor};">${mission?.icon || '🧭'}</div>
              <div class="card-info">
                <div class="card-name">${exp.name} <span style="color:#7dd3fc;">Lv.${exp.level}</span> · ${mission?.name || 'Expedition'}</div>
                <div class="card-sub">${done ? '🎉 Returned with loot!' : `Returning in ${Math.ceil(exp.missionRemainingSec)}s...`}</div>
              </div>
            </div>
            <button class="action-btn green" data-claim-exp="${exp.id}" ${done ? '' : 'disabled'}>
              ${done ? 'Claim Loot' : `${Math.ceil(exp.missionRemainingSec)}s`}
            </button>
          </div>
        `;
      } else {
        const missionsHtml = EXPLORER_MISSIONS.map((m) => {
          const rewardPreview = Object.entries(m.resourceRewards)
            .map(([r, a]) => `${RESOURCE_META[r as ResourceType].icon}${a}`)
            .join(' ');
          return `
            <button class="mission-btn" data-dispatch-exp="${exp.id}" data-mission="${m.id}">
              <div style="font-weight:800;font-size:12px;">${m.icon} ${m.name}</div>
              <div style="font-size:11px;color:#94a3b8;">⏱ ${m.durationSec}s · 💰${Math.round(m.goldReward * e.stage.difficultyScale)} ${rewardPreview}</div>
            </button>
          `;
        }).join('');

        html += `
          <div class="card card-col">
            <div class="card-left">
              <div class="card-ico" style="background:${exp.avatarColor}33;border:1px solid ${exp.avatarColor};">🧭</div>
              <div class="card-info">
                <div class="card-name">${exp.name} <span style="color:#7dd3fc;">Lv.${exp.level}</span> · ${exp.title}</div>
                <div class="card-sub">Ready for assignment · Expeditions completed: ${exp.completedCount}</div>
              </div>
            </div>
            <div class="mission-grid">${missionsHtml}</div>
          </div>
        `;
      }
    }
    return html;
  }

  private buildMapHtml(): string {
    const e = this.engine;
    const regions = ['Pinewood Thaw', 'Frozen Fjord', 'Ironback Peaks', 'Crystal Glacier', 'Aurora Citadel'];
    let html = `
      <div class="card">
        <div class="card-info">
          <div class="card-name">Frontier Empire · ${e.getEmpireTownCount()}/25 Town Halls</div>
          <div class="card-sub">Reach Town Hall (Tier 5) in a town to unlock the next frontier! Switch between unlocked towns anytime.</div>
        </div>
        <button class="action-btn danger" id="btn-reset-save" style="font-size:11px;padding:6px 9px;">Reset</button>
      </div>
    `;

    for (let r = 0; r < 5; r++) {
      const regionTowns = STAGES.filter((s) => s.regionIndex === r);
      const cardsHtml = regionTowns
        .map((st) => {
          const isCurrent = st.id === e.stage.id;
          const unlocked = st.id <= e.save.highestUnlockedStage;
          const rec = e.save.towns[st.id];
          const tier = isCurrent ? e.homesteadTier : rec?.homesteadTier || 0;
          const trib = isCurrent ? e.getTownTributePerMin() : rec?.tributePerMin || 0;
          const stars = '★'.repeat(tier) + '☆'.repeat(5 - tier);
          return `
            <div class="town-card ${isCurrent ? 'current' : ''} ${unlocked ? '' : 'locked'}">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:800;font-size:13px;">#${st.id} ${st.townName}</span>
                <span style="color:#facc15;font-size:11px;">${unlocked ? stars : '🔒'}</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;">${st.specialBonus}</div>
              <div style="font-size:11px;color:#86efac;">${trib > 0 ? `+${trib}g/min tribute` : HOMESTEAD_TIERS[tier].name}</div>
              <button class="action-btn ${isCurrent ? '' : 'blue'}" style="margin-top:4px;padding:6px 8px;font-size:11.5px;"
                data-travel="${st.id}" ${!unlocked || isCurrent ? 'disabled' : ''}>
                ${isCurrent ? 'Current Town' : unlocked ? 'Travel Here' : '🔒 Locked'}
              </button>
            </div>
          `;
        })
        .join('');

      html += `
        <div class="region-block">
          <div class="section-label">Region ${r + 1}: ${regions[r]} (Towns ${r * 5 + 1}–${r * 5 + 5})</div>
          <div class="town-grid">${cardsHtml}</div>
        </div>
      `;
    }

    return html;
  }

  private handleDrawerClick(ev: Event): void {
    const target = ev.target as HTMLElement;
    const e = this.engine;

    if (target.id === 'drawer-backdrop' || target.closest('#drawer-close')) {
      this.activeTab = null;
      this.renderDrawer(true);
      this.syncLiveHud();
      return;
    }

    const upgradeBtn = target.closest('[data-upgrade]') as HTMLButtonElement | null;
    if (upgradeBtn && !upgradeBtn.disabled) {
      const key = upgradeBtn.dataset.upgrade as keyof PlayerUpgrades;
      if (e.buyUpgrade(key)) {
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const hireBtn = target.closest('[data-hire]') as HTMLButtonElement | null;
    if (hireBtn && !hireBtn.disabled) {
      const role = hireBtn.dataset.hire as WorkerRole;
      if (e.hireWorker(role)) {
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const bldgBtn = target.closest('[data-bldg]') as HTMLButtonElement | null;
    if (bldgBtn && !bldgBtn.disabled) {
      const id = bldgBtn.dataset.bldg!;
      if (e.instantUpgradeBuilding(id)) {
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const sellBtn = target.closest('#btn-sell-stockpile') as HTMLButtonElement | null;
    if (sellBtn && !sellBtn.disabled) {
      const got = e.sellAllStockpile();
      if (got > 0) this.showToast(`💰 Sold Town Stockpile for +${got}g!`);
      this.renderDrawer(true);
      this.syncLiveHud();
      return;
    }

    const hireExpBtn = target.closest('[data-hire-exp]') as HTMLButtonElement | null;
    if (hireExpBtn && !hireExpBtn.disabled) {
      const id = hireExpBtn.dataset.hireExp!;
      if (e.hireExplorer(id)) {
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const dispatchBtn = target.closest('[data-dispatch-exp]') as HTMLButtonElement | null;
    if (dispatchBtn && !dispatchBtn.disabled) {
      const id = dispatchBtn.dataset.dispatchExp!;
      const mission = dispatchBtn.dataset.mission!;
      if (e.dispatchExplorer(id, mission)) {
        this.showToast('🧭 Explorer dispatched on frontier mission!');
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const claimBtn = target.closest('[data-claim-exp]') as HTMLButtonElement | null;
    if (claimBtn && !claimBtn.disabled) {
      const id = claimBtn.dataset.claimExp!;
      if (e.claimExplorerMission(id)) {
        this.renderDrawer(true);
        this.syncLiveHud();
      }
      return;
    }

    const travelBtn = target.closest('[data-travel]') as HTMLButtonElement | null;
    if (travelBtn && !travelBtn.disabled) {
      const id = Number(travelBtn.dataset.travel);
      e.loadTownStage(id);
      this.activeTab = null;
      this.renderDrawer(true);
      this.syncLiveHud();
      this.showToast(`🏔️ Arrived at Town #${id}: ${e.stage.townName}!`);
      return;
    }

    if (target.closest('#btn-reset-save')) {
      if (window.confirm('Reset all Frostfall Frontier progress and start fresh from Town #1?')) {
        e.resetAllProgress();
        this.activeTab = null;
        this.renderDrawer(true);
        this.syncLiveHud();
      }
    }
  }
}
