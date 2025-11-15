require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db"); // <-- подключаем нашу БД

const app = express();

app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());

// Готовим запросы заранее
const getWorldStmt = db.prepare(`
  SELECT state_json
  FROM worlds
  WHERE user_id = ?
`);

const upsertWorldStmt = db.prepare(`
  INSERT INTO worlds (user_id, state_json, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);

/**
 * GET /state/:userId
 * Получить сохранённое состояние мира из БД
 */
app.get("/state/:userId", (req, res) => {
  const { userId } = req.params;

  try {
    const row = getWorldStmt.get(String(userId));

    if (!row) {
      return res.json({ ok: true, state: null });
    }

    let parsed = null;
    try {
      parsed = JSON.parse(row.state_json);
    } catch (e) {
      console.error("JSON parse error for user", userId, e);
      return res.json({ ok: false, error: "Corrupted state" });
    }

    res.json({ ok: true, state: parsed });
  } catch (e) {
    console.error("DB get error:", e);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

/**
 * POST /state/:userId
 * Сохранить состояние мира в БД
 * body: { state: {...}, reason?: string }
 */
app.post("/state/:userId", (req, res) => {
  const { userId } = req.params;
  const { state, reason } = req.body || {};

  if (!state || typeof state !== "object") {
    return res.status(400).json({ ok: false, error: "Invalid state" });
  }

  try {
    const json = JSON.stringify(state);
    upsertWorldStmt.run(String(userId), json);

    console.log(
      `State saved for user ${userId}${reason ? " reason=" + reason : ""}`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("DB upsert error:", e);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`MetaWorlds API running on port ${PORT}`);
});
