require('dotenv').config();
const { Telegraf } = require('telegraf');
const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL;

// Подготовленный запрос для сохранения состояния мира
const upsertWorldStmt = db.prepare(`
  INSERT INTO worlds (user_id, state_json, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);

// /start с кнопкой mini app
bot.start((ctx) => {
  return ctx.reply(
    'Добро пожаловать в MetaWorlds 🪐\nНажми кнопку, чтобы открыть свой мир.',
    {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🪐 Открыть MetaWorlds',
            web_app: { url: WEBAPP_URL }
          }
        ]]
      }
    }
  );
});

// Приём данных из WebApp (tg.sendData)
bot.on('web_app_data', (ctx) => {
  try {
    const raw = ctx.update.message.web_app_data.data;
    const data = JSON.parse(raw);

    console.log('WEBAPP DATA:', data);

    const user = ctx.from;
    const world = data.world || {};

    // Сохраняем состояние мира в БД
    try {
      const stateJson = JSON.stringify(world);
      upsertWorldStmt.run(String(user.id), stateJson);
      console.log(`✅ Состояние сохранено в БД для пользователя ${user.id}`);
    } catch (dbError) {
      console.error('❌ Ошибка при сохранении в БД:', dbError);
    }

    // Пример простого ответа (можно усложнить потом)
    let text = `📡 Обновление из MetaWorlds\n`;
    text += `Игрок: ${user.first_name} (${user.id})\n`;
    text += `Мир: ${world.name || '—'}\n`;
    text += `Уровень: ${world.level} (${world.xp}/${world.nextLevelXp})\n`;
    text += `Энергия: ${world.energyNow}/${world.energyMax}\n`;
    text += `Монеты: ${world.coins}\n`;
    text += `Хаос/Порядок: ${world.chaos}/${world.order}\n\n`;

    if (data.type === 'battle_finished') {
      text += data.extra?.win
        ? '⚔️ Бой: ВЫИГРАН\n'
        : '⚔️ Бой: ПРОИГРАН\n';
    }
    if (data.type === 'mission_completed') {
      text += '📜 Миссия выполнена\n';
    }
    if (data.type === 'boost_used') {
      text += '🚀 Буст активирован\n';
    }

    ctx.reply(text);
  } catch (e) {
    console.error(e);
    ctx.reply('⚠️ Ошибка при обработке данных из WebApp');
  }
});

// запуск бота
bot.launch()
  .then(() => console.log('MetaWorlds bot started'))
  .catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
