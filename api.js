const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MISSION_TEMPLATES = [
  {
    id: 'stabilize_flow',
    title: 'Стабилизировать магический поток',
    desc: 'Снизить уровень хаоса, проведя ритуал калибровки.',
    baseCoins: 800,
    baseXp: 120,
    baseEnergy: 60,
  },
  {
    id: 'send_expedition',
    title: 'Отправить экспедицию в соседний мир',
    desc: 'Разведать аномалию в соседних слоях MetaWorlds.',
    baseCoins: 1200,
    baseXp: 160,
    baseEnergy: 90,
  },
  {
    id: 'fortify_core',
    title: 'Укрепить кристальный кодекс',
    desc: 'Повысить устойчивость ядра мира и уменьшить хаос.',
    baseCoins: 1500,
    baseXp: 220,
    baseEnergy: 120,
  },
  {
    id: 'trade_hub',
    title: 'Запустить торговый узел',
    desc: 'Наладить обмен ресурсами с соседними мирами.',
    baseCoins: 2000,
    baseXp: 260,
    baseEnergy: 130,
  },
];

const DEFAULT_FALLBACK_OPPONENTS = [
  {
    userId: 'bot_zenith',
    codename: 'ZENITH',
    avatar: '🛡️',
    worldName: 'Осколок Гармонии',
    archetype: 'harmony',
    rating: 1350,
    wins: 18,
    losses: 4,
    level: 12,
    energy: 980,
    regen: 14,
    power: 38,
  },
  {
    userId: 'bot_nebula',
    codename: 'NEBULA',
    avatar: '🪐',
    worldName: 'Туманность Архива',
    archetype: 'tech',
    rating: 1290,
    wins: 10,
    losses: 3,
    level: 10,
    energy: 860,
    regen: 12,
    power: 34,
  },
  {
    userId: 'bot_rogue',
    codename: 'ROGUE-13',
    avatar: '🔥',
    worldName: 'Рубеж Хаоса',
    archetype: 'chaos',
    rating: 1210,
    wins: 8,
    losses: 6,
    level: 9,
    energy: 920,
    regen: 11,
    power: 32,
  },
];

function createApiHandlers(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  const dbFile = options.dbPath || path.join(dataDir, 'database.json');
  const matchWaitTimeout = options.matchWaitTimeout ?? 8000;
  const missionTemplates = options.missionTemplates || DEFAULT_MISSION_TEMPLATES;
  const fallbackOpponents = options.fallbackOpponents || DEFAULT_FALLBACK_OPPONENTS;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function loadDb() {
    if (!fs.existsSync(dbFile)) {
      return {
        meta: { lastEventId: 0 },
        worlds: {},
        events: [],
        rankings: {},
      };
    }
    try {
      return JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
    } catch (err) {
      console.warn('Failed to parse database, resetting', err);
      return {
        meta: { lastEventId: 0 },
        worlds: {},
        events: [],
        rankings: {},
      };
    }
  }

  function saveDb(db) {
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  }

  const db = loadDb();
  const waitingPlayers = new Map();

  function persistDb() {
    saveDb(db);
  }

  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function generateDailyMissions(level = 1) {
    const missions = [];
    const count = 3;
    for (let i = 0; i < count; i += 1) {
      const tpl = missionTemplates[i % missionTemplates.length];
      const levelFactor = 1 + level * 0.15;
      const coins = Math.floor(tpl.baseCoins * levelFactor);
      const xp = Math.floor(tpl.baseXp * levelFactor);
      const energy = Math.floor(tpl.baseEnergy * (0.8 + i * 0.1));
      missions.push({
        id: `${tpl.id}_${getTodayKey()}_${i}`,
        title: tpl.title,
        desc: tpl.desc,
        rewardCoins: coins,
        rewardXp: xp,
        energyCost: energy,
        done: false,
      });
    }
    return missions;
  }

  function ensureWorld(userId) {
    if (!db.worlds[userId]) {
      db.worlds[userId] = {
        userId,
        state: null,
        lastUpdate: Date.now(),
        lastDailyDate: null,
        dailyMissions: [],
        dailyWorlds: 0,
      };
    }
    return db.worlds[userId];
  }

  function updateRankingPosition(userId) {
    const rankingEntries = Object.entries(db.rankings)
      .map(([id, value]) => ({ id, rating: value.rating || 1200 }))
      .sort((a, b) => b.rating - a.rating);
    for (let i = 0; i < rankingEntries.length; i += 1) {
      if (rankingEntries[i].id === userId) {
        return i + 1;
      }
    }
    return rankingEntries.length + 1;
  }

  function updateRankingFromBattle(userId, extra = {}) {
    if (!db.rankings[userId]) {
      db.rankings[userId] = {
        userId,
        rating: 1200,
        wins: 0,
        losses: 0,
        updatedAt: Date.now(),
      };
    }
    const ranking = db.rankings[userId];
    const delta = extra.win ? 25 : -15;
    ranking.rating = Math.max(500, ranking.rating + delta);
    if (extra.win) {
      ranking.wins += 1;
    } else {
      ranking.losses += 1;
    }
    ranking.updatedAt = Date.now();
    db.rankings[userId] = ranking;
  }

  function recordEvent({ userId, type, payload }) {
    db.meta.lastEventId += 1;
    db.events.push({
      id: db.meta.lastEventId,
      userId,
      type,
      payload,
      createdAt: Date.now(),
    });
    if (db.events.length > 5000) {
      db.events.splice(0, db.events.length - 5000);
    }
  }

  function buildOpponentFromWorld(record, ranking) {
    if (!record || !record.state) {
      return null;
    }
    const state = record.state;
    const profile = state.profile || {};
    const codename = profile.displayName || state.name || 'Пилот';
    return {
      userId: record.userId,
      codename,
      avatar: profile.avatarEmoji || '🛰️',
      worldName: state.name || 'Неизвестный мир',
      archetype: state.archetype || 'tech',
      rating: ranking?.rating || 1200,
      wins: ranking?.wins || 0,
      losses: ranking?.losses || 0,
      level: state.level || 1,
      energy: state.energyMax || 1000,
      regen: Math.max(5, Math.round((state.energyMax || 800) / 80)),
      power: Math.max(20, Math.round((state.level || 1) * 4.2 + (state.chaos || 0) * 0.1)),
      isBot: false,
    };
  }

  function pickRandomOpponent(userId) {
    const candidates = Object.values(db.worlds).filter((entry) => entry.userId !== userId && entry.state);
    if (candidates.length) {
      const randomIdx = Math.floor(Math.random() * candidates.length);
      const candidate = candidates[randomIdx];
      const ranking = db.rankings[candidate.userId];
      return buildOpponentFromWorld(candidate, ranking);
    }
    const fallback = fallbackOpponents[Math.floor(Math.random() * fallbackOpponents.length)];
    return { ...fallback, isBot: true };
  }

  function buildPlayerSnapshot(userId) {
    const record = ensureWorld(userId);
    const ranking = db.rankings[userId];
    const opponent = buildOpponentFromWorld(record, ranking);
    if (opponent) {
      return opponent;
    }
    const initials = userId.slice(-4).toUpperCase();
    return {
      userId,
      codename: `PILOT-${initials}`,
      avatar: record.state?.profile?.avatarEmoji || '🛰️',
      worldName: record.state?.name || 'Неизвестный мир',
      archetype: record.state?.archetype || 'tech',
      rating: ranking?.rating || 1200,
      wins: ranking?.wins || 0,
      losses: ranking?.losses || 0,
      level: record.state?.level || 1,
      energy: record.state?.energyMax || 900,
      regen: Math.max(5, Math.round((record.state?.energyMax || 800) / 90)),
      power: Math.max(24, Math.round((record.state?.level || 1) * 3.5 + 18)),
      isBot: false,
    };
  }

  function dequeueOpponent(excludeUserId) {
    for (const [candidateId, entry] of waitingPlayers.entries()) {
      if (candidateId === excludeUserId) {
        continue;
      }
      waitingPlayers.delete(candidateId);
      if (entry.timeout) {
        clearTimeout(entry.timeout);
      }
      return entry;
    }
    return null;
  }

  function respondMatch(res, opponent, matched) {
    if (!res || res.writableEnded) {
      return;
    }
    const eta = matched ? 1 : 2 + Math.floor(Math.random() * 3);
    sendJson(res, 200, {
      opponent,
      etaSeconds: eta,
      matchId: `${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      matched,
    });
  }

  function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 1e6) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!data) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function handleGetWorld(res, urlObj) {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) {
      sendJson(res, 400, { error: 'userId is required' });
      return;
    }
    const record = ensureWorld(userId);
    if (!record.state) {
      sendJson(res, 200, { state: null, ranking: null, coinsAccrued: 0 });
      return;
    }
    const now = Date.now();
    const elapsedMs = now - (record.lastUpdate || now);
    const profitPerMs = (record.state.profitHour || 0) / (60 * 60 * 1000);
    const coinsGain = Math.max(0, Math.floor(profitPerMs * elapsedMs));
    if (coinsGain > 0) {
      record.state.coins = (record.state.coins || 0) + coinsGain;
      record.lastUpdate = now;
    }

    const todayKey = getTodayKey();
    if (record.lastDailyDate !== todayKey) {
      record.lastDailyDate = todayKey;
      record.dailyMissions = generateDailyMissions(record.state?.level || 1);
      record.dailyWorlds = 0;
    }

    record.state.missions = record.dailyMissions;
    record.state.lastDailyDate = record.lastDailyDate;
    record.state.travelWorlds = record.dailyWorlds;

    persistDb();

    const ranking = db.rankings[userId] || {
      userId,
      rating: 1200,
      wins: 0,
      losses: 0,
    };
    const position = updateRankingPosition(userId);

    sendJson(res, 200, {
      state: record.state,
      ranking: { rating: ranking.rating, position, wins: ranking.wins, losses: ranking.losses },
      coinsAccrued: coinsGain,
    });
  }

  async function handleSaveWorld(req, res) {
    try {
      const body = await parseRequestBody(req);
      const { userId, state, reason } = body;
      if (!userId || !state) {
        sendJson(res, 400, { error: 'userId and state are required' });
        return;
      }
      const record = ensureWorld(userId);
      record.state = state;
      record.lastUpdate = Date.now();
      record.profitHour = state.profitHour || record.profitHour || 0;
      record.dailyMissions = state.missions || record.dailyMissions || [];
      record.dailyWorlds = state.travelWorlds ?? record.dailyWorlds ?? 0;
      record.lastDailyDate = state.lastDailyDate || record.lastDailyDate || getTodayKey();
      persistDb();
      sendJson(res, 200, { ok: true, reason: reason || null });
    } catch (err) {
      console.error('Failed to save world', err);
      sendJson(res, 500, { error: 'failed_to_save' });
    }
  }

  async function handleEvent(req, res) {
    try {
      const body = await parseRequestBody(req);
      const { userId, type, state, extra, timestamp } = body;
      if (!userId || !type || !state) {
        sendJson(res, 400, { error: 'userId, type and state are required' });
        return;
      }
      const payload = {
        state,
        extra: extra || null,
        timestamp: timestamp || new Date().toISOString(),
      };
      recordEvent({ userId, type, payload });
      if (type === 'battle_finished') {
        updateRankingFromBattle(userId, extra || {});
      }
      persistDb();
      sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error('Failed to save event', err);
      sendJson(res, 500, { error: 'failed_to_record_event' });
    }
  }

  async function handleMatchmaking(req, res, urlObj) {
    const userId = urlObj.searchParams.get('userId');
    if (!userId) {
      sendJson(res, 400, { error: 'userId is required' });
      return;
    }
    if (waitingPlayers.has(userId)) {
      sendJson(res, 409, { error: 'already_searching' });
      return;
    }

    const playerSnapshot = buildPlayerSnapshot(userId);
    const opponentEntry = dequeueOpponent(userId);
    if (opponentEntry) {
      respondMatch(opponentEntry.res, playerSnapshot, true);
      respondMatch(res, opponentEntry.snapshot, true);
      return;
    }

    const entry = {
      userId,
      res,
      snapshot: playerSnapshot,
      timeout: null,
    };
    waitingPlayers.set(userId, entry);

    const timeoutMs = matchWaitTimeout + Math.floor(Math.random() * 2000);
    entry.timeout = setTimeout(() => {
      if (!waitingPlayers.has(userId)) {
        return;
      }
      waitingPlayers.delete(userId);
      const fallback = pickRandomOpponent(userId);
      respondMatch(res, fallback, false);
    }, timeoutMs);

    req.on('close', () => {
      const pending = waitingPlayers.get(userId);
      if (pending && pending.res === res) {
        waitingPlayers.delete(userId);
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
      }
    });
  }

  function handleRequest(req, res, urlObj) {
    if (urlObj.pathname === '/api/world' && req.method === 'GET') {
      handleGetWorld(res, urlObj);
      return true;
    }
    if (urlObj.pathname === '/api/world' && req.method === 'POST') {
      handleSaveWorld(req, res);
      return true;
    }
    if (urlObj.pathname === '/api/events' && req.method === 'POST') {
      handleEvent(req, res);
      return true;
    }
    if (urlObj.pathname === '/api/matchmaking' && req.method === 'GET') {
      handleMatchmaking(req, res, urlObj);
      return true;
    }
    return false;
  }

  return {
    handleRequest,
  };
}

module.exports = {
  createApiHandlers,
};
