const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const DIST_DIR = path.join(__dirname, 'dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const missionTemplates = [
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

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      meta: { lastEventId: 0 },
      worlds: {},
      events: [],
      rankings: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
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
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const db = loadDb();

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

function serveStaticFile(req, res, urlPath) {
  let filePath = path.join(__dirname, urlPath);
  if (urlPath === '/' || !path.extname(urlPath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  if (urlPath.startsWith('/dist/')) {
    filePath = path.join(DIST_DIR, urlPath.replace('/dist/', ''));
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleGetWorld(req, res, urlObj) {
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
  const lastUpdate = record.lastUpdate || now;
  const elapsedMs = Math.max(0, now - lastUpdate);
  const coinsPerMs = (record.state.profitHour || 0) / 3600000;
  const coinsGain = Math.floor(coinsPerMs * elapsedMs);
  if (coinsGain > 0) {
    record.state.coins = (record.state.coins || 0) + coinsGain;
    record.lastUpdate = now;
  }

  const today = getTodayKey();
  if (record.lastDailyDate !== today || !record.dailyMissions?.length) {
    record.dailyMissions = generateDailyMissions(record.state.level || 1);
    record.dailyWorlds = 0;
    record.lastDailyDate = today;
    record.state.dailyQuestsDone = 0;
    record.state.dailyQuestsTotal = record.dailyMissions.length;
    record.state.travelWorlds = 0;
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

async function requestListener(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname === '/api/world' && req.method === 'GET') {
    handleGetWorld(req, res, urlObj);
    return;
  }
  if (urlObj.pathname === '/api/world' && req.method === 'POST') {
    handleSaveWorld(req, res);
    return;
  }
  if (urlObj.pathname === '/api/events' && req.method === 'POST') {
    handleEvent(req, res);
    return;
  }
  serveStaticFile(req, res, urlObj.pathname);
}

const server = http.createServer(requestListener);
server.listen(PORT, () => {
  console.log(`MetaWorlds server running on http://localhost:${PORT}`);
});
