window.addEventListener("load", () => {
  const STORAGE_KEY = "metaworlds_state_v1";
  const tg = window.Telegram?.WebApp;
  const API_BASE = "http://localhost:3001";
  const playerId = tg?.initDataUnsafe?.user?.id
    ? `tg_${tg.initDataUnsafe.user.id}`
    : "local-debug";
  let playerRanking = {
    rating: 1200,
    position: 0,
    wins: 0,
    losses: 0,
  };
  if (tg) {
    tg.expand();
    tg.ready();
  }

  // ========= СОСТОЯНИЕ МИРА =========
  const worldState = {
    name: "Magotech Grad",
    level: 7,
    xp: 1200,
    nextLevelXp: 2000,
    rankTop: 1284,
    energyNow: 860,
    energyMax: 1000,
    profitHour: 4320,
    chaos: 62,
    order: 38,
    coins: 493232,
    epoch: "II",
    dailyQuestsDone: 0,
    dailyQuestsTotal: 0,
    dailyBonus: "+12% к наградам",
    travelWorlds: 3,
    lastDailyDate: null,
    missions: [],
    boosts: [
      {
        id: "b1",
        title: "Энергетический импульс",
        desc: "Мгновенно восстановить 25% энергии.",
        costCoins: 2000,
        effect: "energy",
        used: false,
      },
      {
        id: "b2",
        title: "Финансовый резонанс",
        desc: "Временно увеличить прибыль в час на 20%.",
        costCoins: 3500,
        effect: "profit",
        used: false,
      },
    ],
    archetype: null, // "tech" | "chaos" | "harmony"
    isCreated: false, // мир создан или ещё нет
  };

  // ========= ШАБЛОНЫ МИССИЙ ДНЯ =========
  const missionTemplates = [
    {
      id: "stabilize_flow",
      title: "Стабилизировать магический поток",
      desc: "Снизить уровень хаоса, проведя ритуал калибровки.",
      baseCoins: 800,
      baseXp: 120,
      baseEnergy: 60,
    },
    {
      id: "send_expedition",
      title: "Отправить экспедицию в соседний мир",
      desc: "Разведать аномалию в соседних слоях MetaWorlds.",
      baseCoins: 1200,
      baseXp: 160,
      baseEnergy: 90,
    },
    {
      id: "fortify_core",
      title: "Укрепить кристальный кодекс",
      desc: "Повысить устойчивость ядра мира и уменьшить хаос.",
      baseCoins: 1500,
      baseXp: 220,
      baseEnergy: 120,
    },
    {
      id: "trade_hub",
      title: "Запустить торговый узел",
      desc: "Наладить обмен ресурсами с соседними мирами.",
      baseCoins: 2000,
      baseXp: 260,
      baseEnergy: 130,
    },
  ];

  // ========= ВСПОМОГАТЕЛЬНОЕ =========

  function getTodayKey() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function generateDailyMissions() {
    const today = getTodayKey();
    if (worldState.lastDailyDate === today && worldState.missions.length > 0) {
      return;
    }

    worldState.lastDailyDate = today;
    worldState.missions = [];
    worldState.dailyQuestsDone = 0;

    const count = 3;
    for (let i = 0; i < count; i++) {
      const tpl = missionTemplates[i % missionTemplates.length];
      const levelFactor = 1 + worldState.level * 0.15;
      const coins = Math.floor(tpl.baseCoins * levelFactor);
      const xp = Math.floor(tpl.baseXp * levelFactor);
      const energy = Math.floor(tpl.baseEnergy * (0.8 + i * 0.1));

      worldState.missions.push({
        id: tpl.id + "_d" + today + "_" + i,
        title: tpl.title,
        desc: tpl.desc,
        rewardCoins: coins,
        rewardXp: xp,
        energyCost: energy,
        done: false,
      });
    }

    worldState.dailyQuestsTotal = worldState.missions.length;
  }

  const hasCloudStorage = Boolean(tg?.CloudStorage);

  function getPlayerId() {
    return playerId;
  }

  async function postJson(url, body) {
    const endpoint = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    if (!resp.ok) {
      throw new Error(`Request failed with ${resp.status}`);
    }
    return resp.json();
  }

  let lastSyncedPayload = null;

  function updatePlayerRanking(ranking) {
    if (!ranking) return;
    playerRanking = {
      rating: ranking.rating ?? playerRanking.rating,
      position: ranking.position ?? playerRanking.position,
      wins: ranking.wins ?? playerRanking.wins,
      losses: ranking.losses ?? playerRanking.losses,
    };
    if (playerRanking.position) {
      worldState.rankTop = playerRanking.position;
    }
  }

  const inspectorEls = {
    card: document.getElementById("dataInspectorCard"),
    toggle: document.getElementById("btnToggleInspector"),
    refresh: document.getElementById("btnRefreshInspector"),
    status: document.getElementById("inspectorStatus"),
    current: document.getElementById("inspectorCurrentState"),
    last: document.getElementById("inspectorLastSnapshot"),
    stored: document.getElementById("inspectorStoredState"),
    source: document.getElementById("inspectorStorageSource"),
  };

  function formatJson(value) {
    try {
      if (typeof value === "string") {
        return JSON.stringify(JSON.parse(value), null, 2);
      }
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return typeof value === "string" ? value : String(value);
    }
  }

  function setInspectorStatus(text) {
    if (inspectorEls.status) {
      inspectorEls.status.textContent = text || "";
    }
  }

  function updateInspectorCurrentState() {
    if (!inspectorEls.current) return;
    inspectorEls.current.textContent = formatJson(worldState);
  }

  function updateInspectorLastSnapshot() {
    if (!inspectorEls.last) return;
    if (!lastSyncedPayload) {
      inspectorEls.last.textContent = "Снапшоты ещё не отправлялись";
      return;
    }
    inspectorEls.last.textContent = formatJson(lastSyncedPayload);
  }

  function updateInspectorStoredState(raw, sourceLabel = "—") {
    if (!inspectorEls.stored) return;
    if (!raw) {
      inspectorEls.stored.textContent = "Сохранённых данных пока нет";
      if (inspectorEls.source) inspectorEls.source.textContent = "—";
      return;
    }
    inspectorEls.stored.textContent = formatJson(raw);
    if (inspectorEls.source) inspectorEls.source.textContent = sourceLabel;
  }

  async function readStoredStateSnapshot() {
    let raw = null;
    let source = null;
    if (hasCloudStorage) {
      try {
        raw = await cloudGetItem(STORAGE_KEY);
        if (raw) {
          source = "Telegram CloudStorage";
        }
      } catch (err) {
        console.warn("CloudStorage read failed", err);
      }
    }

    if (!raw) {
      try {
        raw = loadFromLocalStorage();
        if (raw) {
          source = "localStorage";
        }
      } catch (err) {
        console.warn("localStorage read failed", err);
      }
    }

    return { raw, source };
  }

  async function refreshInspectorStorage() {
    if (!inspectorEls.stored) return;
    try {
      setInspectorStatus("Обновляю…");
      inspectorEls.refresh?.setAttribute("disabled", "disabled");
      const { raw, source } = await readStoredStateSnapshot();
      if (raw) {
        updateInspectorStoredState(raw, source || "localStorage");
      } else {
        inspectorEls.stored.textContent = "В хранилище данных нет";
        if (inspectorEls.source) inspectorEls.source.textContent = "—";
      }
    } catch (err) {
      inspectorEls.stored.textContent = `Ошибка чтения: ${err.message || err}`;
      if (inspectorEls.source) inspectorEls.source.textContent = "—";
    } finally {
      inspectorEls.refresh?.removeAttribute("disabled");
      setInspectorStatus("");
    }
  }

  function initInspectorControls() {
    if (inspectorEls.toggle && inspectorEls.card) {
      inspectorEls.toggle.addEventListener("click", () => {
        const open = inspectorEls.card.classList.toggle("inspector-open");
        inspectorEls.toggle.textContent = open ? "Свернуть" : "Показать";
        if (open) {
          updateInspectorCurrentState();
          updateInspectorLastSnapshot();
        }
      });
    }

    if (inspectorEls.refresh) {
      inspectorEls.refresh.addEventListener("click", () => {
        refreshInspectorStorage();
      });
    }
  }

  initInspectorControls();
  updateInspectorCurrentState();
  updateInspectorLastSnapshot();
  updateInspectorStoredState(null);

  function serializeState() {
    return JSON.parse(JSON.stringify(worldState));
  }

  function syncWithBot(eventType, extra) {
    const payload = {
      type: eventType,
      world: {
        name: worldState.name,
        level: worldState.level,
        xp: worldState.xp,
        nextLevelXp: worldState.nextLevelXp,
        rankTop: worldState.rankTop,
        energyNow: worldState.energyNow,
        energyMax: worldState.energyMax,
        coins: worldState.coins,
        chaos: worldState.chaos,
        order: worldState.order,
      },
      state: serializeState(),
      extra: extra || null,
      timestamp: new Date().toISOString(),
    };
    lastSyncedPayload = payload;
    updateInspectorLastSnapshot();
    if (tg?.sendData) {
      try {
        tg.sendData(JSON.stringify(payload));
      } catch (err) {
        console.warn("sendData failed", err);
      }
    }
    sendEventToServer(eventType, extra);
  }

  function sendEventToServer(eventType, extra) {
    const userId = getPlayerId();
    if (!userId) return;
    postJson("/api/events", {
      userId,
      type: eventType,
      state: serializeState(),
      extra: extra || null,
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.warn("Server event sync failed", err);
    });
  }

  let botSyncTimer = null;
  let pendingReason = null;
  function scheduleStatePush(reason = "auto") {
    if (!tg || !tg.sendData) return;
    pendingReason = reason;
    if (botSyncTimer) return;
    botSyncTimer = setTimeout(() => {
      botSyncTimer = null;
      const extra = { reason: pendingReason };
      pendingReason = null;
      syncWithBot("state_snapshot", extra);
    }, 350);
  }

  function saveToLocalStorage(data, reason) {
    localStorage.setItem(STORAGE_KEY, data);
    console.log("Saved to localStorage:", reason);
  }

  function loadFromLocalStorage() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function cloudSetItem(key, value) {
    return new Promise((resolve, reject) => {
      tg.CloudStorage.setItem(key, value, (err, success) => {
        if (err) {
          reject(err);
        } else {
          resolve(success);
        }
      });
    });
  }

  function cloudGetItem(key) {
    return new Promise((resolve, reject) => {
      tg.CloudStorage.getItem(key, (err, value) => {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      });
    });
  }

  async function saveWorldState(reason = "") {
    try {
      const data = JSON.stringify(worldState);
      saveToLocalStorage(data, reason);
      let storageLabel = "localStorage";
      if (hasCloudStorage) {
        try {
          await cloudSetItem(STORAGE_KEY, data);
          storageLabel = "Telegram CloudStorage + localStorage";
          console.log("Saved to Telegram CloudStorage:", reason);
        } catch (err) {
          console.warn("CloudStorage save failed", err);
        }
      }
      updateInspectorStoredState(data, storageLabel);
      const userId = getPlayerId();
      if (userId) {
        postJson("/api/world", {
          userId,
          state: serializeState(),
          reason: reason || null,
          timestamp: Date.now(),
        }).catch((err) => {
          console.warn("Server save failed", err);
        });
      }
      scheduleStatePush(reason || "save");
    } catch (e) {
      console.warn("Save error:", e);
    }
  }

  async function loadStateFromServer() {
    let loadedFromServer = false;
    const userId = getPlayerId();
    if (userId) {
      try {
        const resp = await fetch(
          `/api/world?userId=${encodeURIComponent(userId)}`,
          { credentials: "same-origin" }
        );
        if (resp.ok) {
          const payload = await resp.json();
          if (payload?.state) {
            Object.assign(worldState, payload.state);
            updatePlayerRanking(payload.ranking);
            loadedFromServer = true;
          }
        }
      } catch (err) {
        console.warn("Server load failed", err);
      }
    }

    if (!loadedFromServer) {
      try {
        let raw = null;
        if (hasCloudStorage) {
          raw = await cloudGetItem(STORAGE_KEY);
          if (raw) {
            console.log("Loaded from Telegram CloudStorage");
          }
        }
        if (!raw) {
          raw = loadFromLocalStorage();
          if (raw) {
            console.log("Loaded from localStorage");
          }
        }
        if (raw) {
          const data = JSON.parse(raw);
          Object.assign(worldState, data);
          loadedFromServer = true;
        }
      } catch (err) {
        console.warn("Load error:", err);
      }
    }

    if (loadedFromServer) {
      updateInspectorCurrentState();
    }
    return loadedFromServer;
  }

  // ========= РЕНДЕР МИРА =========
  function applyArchetype(arch) {
    worldState.archetype = arch;

    if (arch === "tech") {
      worldState.energyMax = 900;
      worldState.energyNow = 900;
      worldState.profitHour = 5200;
      worldState.chaos = 45;
      worldState.order = 55;
    } else if (arch === "harmony") {
      worldState.energyMax = 1000;
      worldState.energyNow = 1000;
      worldState.profitHour = 4500;
      worldState.chaos = 50;
      worldState.order = 50;
    } else if (arch === "chaos") {
      worldState.energyMax = 1200;
      worldState.energyNow = 1200;
      worldState.profitHour = 4800;
      worldState.chaos = 65;
      worldState.order = 35;
    }

    tg?.HapticFeedback?.selectionChanged?.();
  }

  function renderWorld() {
    const byId = (id) => document.getElementById(id);

    if (!byId("heroName")) {
      // если разметка ещё не загрузилась — просто выходим
      return;
    }

    byId("heroName").textContent = worldState.name;
    byId("heroLevel").textContent = worldState.level;
    const heroTopEl = byId("heroTop");
    const heroRatingEl = document.getElementById("heroRating");
    const currentTop =
      playerRanking.position || worldState.rankTop || 0;
    if (heroTopEl) {
      heroTopEl.textContent = currentTop
        ? Number(currentTop).toLocaleString("ru-RU")
        : "—";
    }
    if (heroRatingEl) {
      heroRatingEl.textContent = (playerRanking.rating || 1200).toLocaleString(
        "ru-RU"
      );
    }

    byId("xpNow").textContent = worldState.xp;
    byId("xpNext").textContent = worldState.nextLevelXp;
    const xpPerc = (worldState.xp / worldState.nextLevelXp) * 100;
    document.getElementById("xpBar").style.width =
      Math.max(5, Math.min(100, xpPerc)) + "%";

    byId("energyNow").textContent = worldState.energyNow;
    byId("energyMax").textContent = worldState.energyMax;

    byId("profitHour").textContent =
      worldState.profitHour.toLocaleString("ru-RU");
    byId("chaosOrder").textContent =
      worldState.chaos + " / " + worldState.order;
    byId("coins").textContent = worldState.coins.toLocaleString("ru-RU");
    byId("epoch").textContent = worldState.epoch;

    byId("dailyQuestsText").textContent =
      worldState.dailyQuestsDone +
      " / " +
      worldState.dailyQuestsTotal +
      " миссий";
    byId("dailyBonusText").textContent = worldState.dailyBonus;
    byId("travelWorldsText").textContent =
      worldState.travelWorlds + " мира посещено";

    const energyBar = document.getElementById("energyBar");
    const percent = (worldState.energyNow / worldState.energyMax) * 100;
    energyBar.style.width = Math.max(5, Math.min(100, percent)) + "%";

    const rankTopSmall = document.getElementById("rankTopSmall");
    if (rankTopSmall) {
      rankTopSmall.textContent = heroTopEl?.textContent || "—";
    }
    const rankRatingSmall = document.getElementById("rankRatingSmall");
    if (rankRatingSmall) {
      rankRatingSmall.textContent = (
        playerRanking.rating || 1200
      ).toLocaleString("ru-RU");
    }

    updateInspectorCurrentState();
  }

  // ========= СОЗДАНИЕ МИРА =========
  const archCards = document.querySelectorAll(".archetype-card");
  const worldNameInput = document.getElementById("worldNameInput");
  const btnCreateWorld = document.getElementById("btnCreateWorld");

  let selectedArch = null;

  archCards.forEach((card) => {
    card.addEventListener("click", () => {
      archCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedArch = card.dataset.arch;
      applyArchetype(selectedArch);
    });
  });

  if (btnCreateWorld) {
    btnCreateWorld.addEventListener("click", () => {
      const name = (worldNameInput?.value || "").trim();
      if (!selectedArch) {
        window.alert("Выбери архетип мира.");
        tg?.HapticFeedback?.notificationOccurred?.("error");
        return;
      }
      if (!name) {
        window.alert("Введи название мира.");
        tg?.HapticFeedback?.notificationOccurred?.("error");
        return;
      }

      worldState.name = name;
      worldState.isCreated = true;

      generateDailyMissions();
      renderWorld();
      renderMissions();
      renderBoosts();

      syncWithBot("world_created", { archetype: selectedArch, name });
      saveWorldState("world_created");

      tg?.HapticFeedback?.impactOccurred?.("medium");
      showScreen("home");
    });
  }

  // ========= РОУТЕР ПО ЭКРАНАМ =========

  const screens = document.querySelectorAll(".screen");
  const tabs = document.querySelectorAll(".tab-item");

  function showScreen(name) {
    screens.forEach((s) => {
      s.classList.toggle("screen-active", s.dataset.screen === name);
    });
    tabs.forEach((t) => {
      t.classList.toggle("tab-item-active", t.dataset.tab === name);
    });
  }

  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.screenTarget;
      showScreen(target);
      tg?.HapticFeedback?.selectionChanged?.();
    });
  });

  // ========= МИССИИ =========

  const missionsListEl = document.getElementById("missionsList");

  function renderMissions() {
    if (!missionsListEl) return;
    missionsListEl.innerHTML = "";
    worldState.missions.forEach((m) => {
      const card = document.createElement("div");
      card.className = "mission-card";
      card.innerHTML = `
        <div class="mission-title">${m.title}</div>
        <div class="mission-desc">${m.desc}</div>
        <div class="mission-meta">
          <span>⚡ Энергия: ${m.energyCost}</span>
          <span>💰 ${m.rewardCoins.toLocaleString("ru-RU")} • ⭐ ${
        m.rewardXp
      }</span>
        </div>
        <div class="mission-footer">
          <span class="mission-status">${
            m.done ? "✅ Выполнено" : "Доступно"
          }</span>
          ${
            m.done
              ? ""
              : `<button class="mission-btn" data-mission-id="${m.id}">
                  Выполнить
                 </button>`
          }
        </div>
      `;
      missionsListEl.appendChild(card);
    });

    missionsListEl.querySelectorAll(".mission-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.missionId;
        completeMission(id);
      });
    });
  }

  function gainXp(amount) {
    worldState.xp += amount;
    let leveledUp = false;
    let levelsGained = 0;

    while (worldState.xp >= worldState.nextLevelXp) {
      worldState.xp -= worldState.nextLevelXp;
      worldState.level += 1;
      levelsGained += 1;
      worldState.nextLevelXp = Math.floor(worldState.nextLevelXp * 1.35);
      worldState.energyMax += 40;
      worldState.profitHour = Math.floor(worldState.profitHour * 1.08);
      leveledUp = true;
    }

    if (leveledUp) {
      tg?.HapticFeedback?.notificationOccurred?.("success");
      window.alert(
        `Новый уровень! +${levelsGained} уровень(я).\n` +
          `Энергия и доход мира увеличены.`
      );
    }
  }

  function completeMission(id) {
    const mission = worldState.missions.find((m) => m.id === id);
    if (!mission || mission.done) return;

    if (worldState.energyNow < mission.energyCost) {
      tg?.HapticFeedback?.notificationOccurred?.("error");
      window.alert("Недостаточно энергии для выполнения миссии.");
      return;
    }

    worldState.energyNow -= mission.energyCost;
    worldState.coins += mission.rewardCoins;
    gainXp(mission.rewardXp);
    mission.done = true;

    worldState.dailyQuestsDone = worldState.missions.filter(
      (m) => m.done
    ).length;
    worldState.travelWorlds = (worldState.travelWorlds || 0) + 1;

    worldState.chaos = Math.max(0, worldState.chaos - 2);
    worldState.order = 100 - worldState.chaos;

    renderWorld();
    renderMissions();
    syncWithBot("mission_completed", { missionId: mission.id });
    saveWorldState("mission_completed");
    tg?.HapticFeedback?.impactOccurred?.("medium");
  }

  // ========= БУСТЫ =========

  const boostsListEl = document.getElementById("boostsList");

  function renderBoosts() {
    if (!boostsListEl) return;
    boostsListEl.innerHTML = "";
    worldState.boosts.forEach((b) => {
      const card = document.createElement("div");
      card.className = "mission-card";
      card.innerHTML = `
        <div class="mission-title">${b.title}</div>
        <div class="mission-desc">${b.desc}</div>
        <div class="mission-meta">
          <span>Тип: ${b.effect === "energy" ? "Энергия" : "Доход"}</span>
          <span>💰 Стоимость: ${b.costCoins.toLocaleString("ru-RU")}</span>
        </div>
        <div class="mission-footer">
          <span class="mission-status">${
            b.used ? "✅ Использован" : "Доступен"
          }</span>
          ${
            b.used
              ? ""
              : `<button class="mission-btn" data-boost-id="${b.id}">
                  Активировать
                 </button>`
          }
        </div>
      `;
      boostsListEl.appendChild(card);
    });

    boostsListEl.querySelectorAll(".mission-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.boostId;
        useBoost(id);
      });
    });
  }

  function useBoost(id) {
    const boost = worldState.boosts.find((b) => b.id === id);
    if (!boost || boost.used) return;

    if (worldState.coins < boost.costCoins) {
      tg?.HapticFeedback?.notificationOccurred?.("error");
      window.alert("Недостаточно монет для активации буста.");
      return;
    }

    worldState.coins -= boost.costCoins;

    if (boost.effect === "energy") {
      const add = Math.floor(worldState.energyMax * 0.25);
      worldState.energyNow = Math.min(
        worldState.energyMax,
        worldState.energyNow + add
      );
    }
    if (boost.effect === "profit") {
      worldState.profitHour = Math.floor(worldState.profitHour * 1.2);
    }

    boost.used = true;
    renderWorld();
    renderBoosts();
    syncWithBot("boost_used", { boostId: boost.id });
    saveWorldState("boost_used");
    tg?.HapticFeedback?.impactOccurred?.("medium");
  }

  // ========= БОЙ =========

  const leftHpEl = document.getElementById("leftHp");
  const rightHpEl = document.getElementById("rightHp");
  const leftHpBar = document.getElementById("leftHpBar");
  const rightHpBar = document.getElementById("rightHpBar");
  const countdownEl = document.getElementById("countdown");
  const resultTextEl = document.getElementById("battleResultText");
  const btnStartBattle = document.getElementById("btnStartBattle");

  function setHp(numEl, barEl, hp) {
    if (!numEl || !barEl) return;
    numEl.textContent = hp;
    barEl.style.width = Math.max(5, hp) + "%";
  }

  if (btnStartBattle) {
    btnStartBattle.addEventListener("click", () => {
      if (worldState.energyNow < 40) {
        tg?.HapticFeedback?.notificationOccurred?.("error");
        window.alert("Недостаточно энергии для боя.");
        return;
      }

      setHp(leftHpEl, leftHpBar, 100);
      setHp(rightHpEl, rightHpBar, 100);
      resultTextEl.textContent = "Бой начинается...";
      let cd = 3;
      countdownEl.textContent = cd;
      btnStartBattle.disabled = true;
      tg?.HapticFeedback?.impactOccurred?.("light");

      const timer = setInterval(() => {
        cd--;
        if (cd > 0) {
          countdownEl.textContent = cd;
          tg?.HapticFeedback?.selectionChanged?.();
        } else {
          clearInterval(timer);
          countdownEl.textContent = "GO";

          let leftHp = 100 - Math.floor(Math.random() * 70);
          let rightHp = 100 - Math.floor(Math.random() * 70);
          if (leftHp === rightHp) rightHp -= 5;

          setHp(leftHpEl, leftHpBar, leftHp);
          setHp(rightHpEl, rightHpBar, rightHp);

          const win = leftHp > rightHp;
          if (win) {
            resultTextEl.textContent =
              "Твой мир отстоял свои позиции и получил награду! 🏆";
            worldState.coins += 3500;
            worldState.energyNow = Math.max(0, worldState.energyNow - 80);
            worldState.chaos = Math.max(0, worldState.chaos - 3);
            gainXp(180);
          } else {
            resultTextEl.textContent =
              "Противник оказался сильнее. Но ты получил опыт боя. ⚔️";
            worldState.energyNow = Math.max(0, worldState.energyNow - 50);
            worldState.chaos = Math.min(100, worldState.chaos + 4);
            gainXp(90);
          }

          worldState.order = 100 - worldState.chaos;
          renderWorld();
          saveWorldState("battle_finished");
          syncWithBot("battle_finished", { win, leftHp, rightHp });

          btnStartBattle.disabled = false;
          tg?.HapticFeedback?.impactOccurred?.("medium");
        }
      }, 600);
    });
  }

  // ========= ПАССИВНАЯ РЕГЕНЕРАЦИЯ =========

  setInterval(() => {
    if (worldState.energyNow < worldState.energyMax) {
      worldState.energyNow = Math.min(
        worldState.energyMax,
        worldState.energyNow + 5
      );
      renderWorld();
      saveWorldState("passive_regen");
    }
  }, 15000);

  window.addEventListener("beforeunload", () => {
    if (!tg || !tg.sendData) return;
    try {
      syncWithBot("state_snapshot", { reason: "unload" });
    } catch (err) {
      console.warn("sendData before unload failed", err);
    }
  });

  // ========= СТАРТ =========

  async function postJson(url, body) {
  const endpoint = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Request failed with ${resp.status}`);
  return resp.json();
}

  (async () => {
    await loadStateFromServer();
    await refreshInspectorStorage();
    scheduleStatePush("boot");

    if (worldState.isCreated) {
      if (!worldState.missions || worldState.missions.length === 0) {
        generateDailyMissions();
      }
      renderWorld();
      renderMissions();
      renderBoosts();
      showScreen("home");
    } else {
      renderWorld();
      showScreen("create");
    }
  })();
});