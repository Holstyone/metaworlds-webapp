// db.js
const Database = require("better-sqlite3");

// создаём/открываем файл БД
const db = new Database("metaworlds.db");

// создаём таблицу, если её нет
db.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    user_id     TEXT PRIMARY KEY,
    state_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

module.exports = db;
