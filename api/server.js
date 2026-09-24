// server.js
import express from 'express';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN не задан — initData не будет проверяться (dev режим)');
}

if (!WEBAPP_URL) {
  console.warn('⚠️  WEBAPP_URL не задан — вебхук Telegram не будет установлен');
}

const app = express();
app.use(express.json({ limit: '100kb' }));

/* =========================================================
   КОНСТАНТЫ
   ========================================================= */

const WELCOME_BONUS = 60;
const DAILY_BONUS = 25;

/* =========================================================
   МЕХАНИКА КЕЙСОВ
   ========================================================= */

const PITY_CONFIG = {
  rare:      { threshold: 6,  boost: 3.0 },
  epic:      { threshold: 15, boost: 3.0 },
  legendary: { threshold: 40, boost: 4.0 },
};

const GUARANTEED = {
  every: 20,
  minRarity: 'rare',
};

const STREAK_CONFIG = {
  commonStreakThreshold: 5,
  epicBoost: 1.8,
  legendaryBoost: 2.5,
};

const RARITY_ORDER = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

/* =========================================================
   БАЗА ДАННЫХ
   ========================================================= */

const db = new Database(path.join(__dirname, 'users.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    game TEXT NOT NULL,
    text TEXT NOT NULL,
    amount INTEGER NOT NULL,
    win INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_history_user
    ON history(telegram_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user
    ON transactions(telegram_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS active_rounds (
    token TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    bet INTEGER NOT NULL,
    crash_point REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_pity (
    telegram_id INTEGER NOT NULL,
    case_id TEXT NOT NULL,
    total_opens INTEGER NOT NULL DEFAULT 0,
    since_rare INTEGER NOT NULL DEFAULT 0,
    since_epic INTEGER NOT NULL DEFAULT 0,
    since_legendary INTEGER NOT NULL DEFAULT 0,
    common_streak INTEGER NOT NULL DEFAULT 0,
    last_drop_rarity TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_id, case_id)
  );
`);

/* =========================================================
   ПРОВЕРКА INITDATA
   ========================================================= */

function verifyInitData(initData) {
  if (!BOT_TOKEN) {
    if (!initData) {
      return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
    }
    try {
      const params = new URLSearchParams(initData);
      const userJson = params.get('user');
      if (!userJson) {
        return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
      }
      return JSON.parse(userJson);
    } catch {
      return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
    }
  }

  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    console.warn('[auth] hash mismatch');
    return null;
  }

  const authDate = Number(params.get('auth_date') || 0);
  const age = Date.now() / 1000 - authDate;
  if (age > 86400) {
    console.warn('[auth] initData expired');
    return null;
  }

  const userJson = params.get('user');
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

/* =========================================================
   УТИЛИТЫ
   ========================================================= */

function getOrCreateUser(tgUser) {
  const now = Date.now();

  let user = db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(tgUser.id);

  if (!user) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tgUser.id,
      tgUser.username || null,
      tgUser.first_name || null,
      WELCOME_BONUS,
      now,
      now,
    );

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, WELCOME_BONUS, 'welcome_bonus', WELCOME_BONUS, now);

    console.log(`[user] new user ${tgUser.id} +${WELCOME_BONUS} welcome bonus`);

    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  } else {
    db.prepare(`
      UPDATE users SET username = ?, first_name = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(
      tgUser.username || user.username,
      tgUser.first_name || user.first_name,
      now,
      tgUser.id,
    );
  }

  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
}

/* =========================================================
   API: АВТОРИЗАЦИЯ
   ========================================================= */

app.post('/api/auth-telegram', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const user = getOrCreateUser(tgUser);
  console.log(`[auth] user ${user.telegram_id} balance=${user.balance}`);

  res.json({
    profile: {
      telegramId: user.telegram_id,
      username: user.username,
      firstName: user.first_name,
      balance: user.balance,
    },
  });
});

/* =========================================================
   API: ИЗМЕНЕНИЕ БАЛАНСА
   ========================================================= */

app.post('/api/update-balance', (req, res) => {
  const { initData, delta, reason } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeDelta = Math.floor(Number(delta));
  if (!Number.isFinite(safeDelta) || safeDelta === 0) {
    return res.status(400).json({ error: 'invalid delta' });
  }
  if (Math.abs(safeDelta) > 10_000_000) {
    return res.status(400).json({ error: 'delta too large' });
  }

  const now = Date.now();

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user) throw new Error('user not found');

    const newBalance = user.balance + safeDelta;
    if (newBalance < 0) {
      return { ok: false, error: 'insufficient funds', balance: user.balance };
    }

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, safeDelta, reason || 'game', newBalance, now);

    return { ok: true, balance: newBalance };
  });

  try {
    const result = tx();
    if (!result.ok) return res.status(400).json(result);

    console.log(`[balance] user ${tgUser.id} ${safeDelta > 0 ? '+' : ''}${safeDelta} → ${result.balance}`);
    res.json({ balance: result.balance });
  } catch (err) {
    console.error('[balance] error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

/* =========================================================
   API: ИСТОРИЯ
   ========================================================= */

app.post('/api/history/add', (req, res) => {
  const { initData, game, text, amount, win } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const now = Date.now();

  db.prepare(`
    INSERT INTO history (telegram_id, game, text, amount, win, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    tgUser.id,
    String(game).slice(0, 50),
    String(text).slice(0, 200),
    Math.floor(Number(amount) || 0),
    win ? 1 : 0,
    now,
  );

  res.json({ ok: true });
});

app.post('/api/history/list', (req, res) => {
  const { initData, limit } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const rows = db.prepare(`
    SELECT id, game, text, amount, win, created_at
    FROM history
    WHERE telegram_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(tgUser.id, safeLimit);

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      game: r.game,
      text: r.text,
      amount: r.amount,
      win: !!r.win,
      createdAt: r.created_at,
    })),
  });
});

/* =========================================================
   API: ЕЖЕДНЕВНЫЙ БОНУС
   ========================================================= */

app.post('/api/daily-bonus', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const lastBonus = db.prepare(`
    SELECT created_at FROM transactions
    WHERE telegram_id = ? AND reason = 'daily_bonus'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(tgUser.id);

  if (lastBonus && lastBonus.created_at > oneDayAgo) {
    const nextAt = lastBonus.created_at + 24 * 60 * 60 * 1000;
    return res.status(400).json({ error: 'already_claimed', nextAt });
  }

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + DAILY_BONUS;

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, DAILY_BONUS, 'daily_bonus', newBalance, now);

    return newBalance;
  });

  const balance = tx();
  console.log(`[daily] user ${tgUser.id} +${DAILY_BONUS} → ${balance}`);
  res.json({ balance, bonus: DAILY_BONUS });
});

/* =========================================================
   API: РУЛЕТКА
   ========================================================= */

const BASE_SEGMENTS = [
  2, 3, 2, 3, 5, 2, 3, 2, 2, 3,
  5, 2, 3, 2, 2, 3, 5, 2, 3, 2,
  2, 5, 3, 2, 2, 3, 5, 2, 3, 2,
  30,
];

app.post('/api/game/roulette', (req, res) => {
  const { initData, bet, selected } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeBet = Math.floor(Number(bet));
  const safeSelected = Number(selected);

  if (!Number.isFinite(safeBet) || safeBet < 10) {
    return res.status(400).json({ error: 'invalid bet' });
  }
  if (![2, 3, 5, 30].includes(safeSelected)) {
    return res.status(400).json({ error: 'invalid selected' });
  }

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const winnerIndex = crypto.randomInt(0, BASE_SEGMENTS.length);
    const winner = BASE_SEGMENTS[winnerIndex];
    const won = winner === safeSelected;
    const reward = won ? safeBet * winner : 0;

    const newBalance = user.balance - safeBet + reward;
    const now = Date.now();

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, reward - safeBet, `roulette:x${winner}`, newBalance, now);

    db.prepare(`
      INSERT INTO history (telegram_id, game, text, amount, win, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tgUser.id, 'Рулетка', `Выпал x${winner}`,
      reward - safeBet, won ? 1 : 0, now,
    );

    return { winner, won, reward, newBalance, delta: reward - safeBet };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   API: РАКЕТА
   ========================================================= */

function generateCrashPoint() {
  const random = crypto.randomInt(1, 1_000_000) / 1_000_000;
  const crash = 0.97 / (1 - random + 0.0001);
  return Math.min(Math.max(Number(crash.toFixed(2)), 1.3), 2000);
}

app.post('/api/game/rocket/start', (req, res) => {
  const { initData, bet } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeBet = Math.floor(Number(bet));
  if (!Number.isFinite(safeBet) || safeBet < 10) {
    return res.status(400).json({ error: 'invalid bet' });
  }

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const crashPoint = generateCrashPoint();
    const newBalance = user.balance - safeBet;
    const now = Date.now();

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, -safeBet, 'rocket:bet', newBalance, now);

    return { crashPoint, newBalance };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);

  const roundToken = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO active_rounds (token, telegram_id, bet, crash_point, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(roundToken, tgUser.id, safeBet, result.crashPoint, Date.now());

  res.json({ roundToken, newBalance: result.newBalance, bet: safeBet });
});

app.post('/api/game/rocket/cashout', (req, res) => {
  const { initData, roundToken, multiplier } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeMultiplier = Number(multiplier);
  if (!Number.isFinite(safeMultiplier) || safeMultiplier < 1.3) {
    return res.status(400).json({ error: 'multiplier too low' });
  }

  const tx = db.transaction(() => {
    const round = db.prepare(`
      SELECT * FROM active_rounds
      WHERE token = ? AND telegram_id = ?
    `).get(roundToken, tgUser.id);

    if (!round) return { error: 'round not found' };

    if (safeMultiplier >= round.crash_point) {
      db.prepare('DELETE FROM active_rounds WHERE token = ?').run(roundToken);
      const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
      return { error: 'crashed', crashPoint: round.crash_point, newBalance: user.balance };
    }

    const reward = Math.floor(round.bet * safeMultiplier);
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + reward;
    const now = Date.now();

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, reward, `rocket:win x${safeMultiplier}`, newBalance, now);

    db.prepare(`
      INSERT INTO history (telegram_id, game, text, amount, win, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tgUser.id, 'Ракета',
      `Вывод на x${safeMultiplier.toFixed(2)}`,
      reward - round.bet, 1, now,
    );

    db.prepare('DELETE FROM active_rounds WHERE token = ?').run(roundToken);

    return { reward, newBalance, delta: reward - round.bet };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   API: КЕЙСЫ
   ========================================================= */

const CASES = [
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    drops: [
      { name: 'Rusty Coin',   icon: '🪙', price: 4,   chance: 50, color: '#c7a56b', rarity: 'common' },
      { name: 'Copper Ring',  icon: '💍', price: 10,  chance: 25, color: '#e0a35f', rarity: 'uncommon' },
      { name: 'Small Gem',    icon: '🔹', price: 15,  chance: 15, color: '#6fd2ff', rarity: 'rare' },
      { name: 'Silver Star',  icon: '⭐', price: 60,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Blue Crystal', icon: '💎', price: 500, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    price: 25,
    drops: [
      { name: 'Bronze Coin',    icon: '🪙', price: 15,   chance: 50, color: '#e0a35f', rarity: 'common' },
      { name: 'Bronze Star',    icon: '⭐', price: 45,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Orange Crystal', icon: '🔶', price: 120,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Small Crown',    icon: '👑', price: 500,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Red Gem',        icon: '💎', price: 4000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'lucky',
    name: 'Lucky',
    price: 49,
    drops: [
      { name: 'Lucky Coin',    icon: '🍀', price: 25,   chance: 50, color: '#8fd9a4', rarity: 'common' },
      { name: 'Green Gem',     icon: '💚', price: 80,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Four Leaf',     icon: '🍀', price: 250,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Golden Clover', icon: '🌟', price: 1200, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'JACKPOT',       icon: '💰', price: 5000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    price: 100,
    drops: [
      { name: 'Silver Coin',  icon: '🪙', price: 50,    chance: 50, color: '#d4e0f0', rarity: 'common' },
      { name: 'Silver Star',  icon: '🌟', price: 180,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Blue Crystal', icon: '🔷', price: 500,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Silver Crown', icon: '👑', price: 2500,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Ice Gem',      icon: '💎', price: 12000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 250,
    drops: [
      { name: 'Gold Coin',    icon: '🪙', price: 130,   chance: 50, color: '#ffe071', rarity: 'common' },
      { name: 'Gold Star',    icon: '🌟', price: 450,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Gold Crystal', icon: '🔶', price: 1300,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Golden Crown', icon: '👑', price: 6000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Dragon Gem',   icon: '🐉', price: 30000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: 500,
    drops: [
      { name: 'Platinum Chip',  icon: '💠', price: 260,   chance: 50, color: '#b8e8e8', rarity: 'common' },
      { name: 'Platinum Star',  icon: '✨', price: 900,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Frost Crystal',  icon: '❄️', price: 2600,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Platinum Crown', icon: '👑', price: 12000, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Frozen Heart',   icon: '💎', price: 60000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    price: 1000,
    drops: [
      { name: 'Diamond Chip',  icon: '💎', price: 520,    chance: 50, color: '#a8e5ff', rarity: 'common' },
      { name: 'Diamond Star',  icon: '⭐', price: 1800,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Aqua Gem',      icon: '🔷', price: 5200,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Diamond Crown', icon: '👑', price: 24000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Ocean Heart',   icon: '💠', price: 120000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'royal',
    name: 'Royal',
    price: 2500,
    drops: [
      { name: 'Royal Chip',     icon: '🟣', price: 1300,   chance: 50, color: '#d4bfff', rarity: 'common' },
      { name: 'Royal Star',     icon: '🌟', price: 4500,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Purple Crystal', icon: '🔮', price: 13000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Royal Crown',    icon: '👑', price: 60000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'King Heart',     icon: '💜', price: 300000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    price: 5000,
    drops: [
      { name: 'Star Dust',      icon: '✨', price: 2600,   chance: 50, color: '#b3aaff', rarity: 'common' },
      { name: 'Cosmic Gem',     icon: '🌌', price: 9000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Nebula Crystal', icon: '🌠', price: 26000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Galaxy Crown',   icon: '👑', price: 120000, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Black Hole',     icon: '🕳️', price: 600000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'dragon',
    name: 'Dragon',
    price: 10000,
    drops: [
      { name: 'Dragon Scale', icon: '🐲', price: 5200,    chance: 50, color: '#ff9a6a', rarity: 'common' },
      { name: 'Dragon Claw',  icon: '🗡️', price: 18000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Dragon Eye',   icon: '👁️', price: 52000,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Dragon Crown', icon: '👑', price: 240000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'Dragon Heart', icon: '🐉', price: 1200000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'legendary',
    name: 'Legendary',
    price: 25000,
    drops: [
      { name: 'Legend Chip',    icon: '🏅', price: 13000,   chance: 50, color: '#ffe071', rarity: 'common' },
      { name: 'Legend Star',    icon: '🌟', price: 45000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { name: 'Legend Crystal', icon: '🔱', price: 130000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { name: 'Legend Crown',   icon: '👑', price: 600000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { name: 'GOD TIER',       icon: '💎', price: 3000000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
];

/* =========================================================
   PITY-СИСТЕМА
   ========================================================= */

function getPity(tgId, caseId) {
  let row = db.prepare(`
    SELECT * FROM case_pity
    WHERE telegram_id = ? AND case_id = ?
  `).get(tgId, caseId);

  if (!row) {
    db.prepare(`
      INSERT INTO case_pity (
        telegram_id, case_id, total_opens, since_rare, since_epic,
        since_legendary, common_streak, last_drop_rarity, updated_at
      ) VALUES (?, ?, 0, 0, 0, 0, 0, NULL, ?)
    `).run(tgId, caseId, Date.now());

    row = db.prepare(`
      SELECT * FROM case_pity
      WHERE telegram_id = ? AND case_id = ?
    `).get(tgId, caseId);
  }

  return row;
}

function updatePity(tgId, caseId, rarity) {
  const now = Date.now();
  const row = getPity(tgId, caseId);

  const newTotal = row.total_opens + 1;
  const newSinceRare = (rarity === 'rare' || RARITY_ORDER[rarity] > RARITY_ORDER.rare)
    ? 0 : row.since_rare + 1;
  const newSinceEpic = (rarity === 'epic' || RARITY_ORDER[rarity] > RARITY_ORDER.epic)
    ? 0 : row.since_epic + 1;
  const newSinceLegendary = (rarity === 'legendary') ? 0 : row.since_legendary + 1;
  const newCommonStreak = rarity === 'common' ? row.common_streak + 1 : 0;

  db.prepare(`
    UPDATE case_pity
    SET total_opens = ?, since_rare = ?, since_epic = ?,
        since_legendary = ?, common_streak = ?, last_drop_rarity = ?,
        updated_at = ?
    WHERE telegram_id = ? AND case_id = ?
  `).run(
    newTotal,
    newSinceRare,
    newSinceEpic,
    newSinceLegendary,
    newCommonStreak,
    rarity,
    now,
    tgId,
    caseId,
  );
}

function pickDropWithMechanics(drops, pity, isGuaranteed) {
  if (isGuaranteed) {
    const minLevel = RARITY_ORDER[GUARANTEED.minRarity];
    const guaranteedPool = drops.filter((d) => RARITY_ORDER[d.rarity] >= minLevel);

    if (guaranteedPool.length > 0) {
      const total = guaranteedPool.reduce((s, d) => s + d.chance, 0);
      let r = crypto.randomInt(0, Math.floor(total * 10000)) / 10000;
      for (const d of guaranteedPool) {
        r -= d.chance;
        if (r <= 0) return d;
      }
      return guaranteedPool[guaranteedPool.length - 1];
    }
  }

  const weights = drops.map((d) => {
    let w = d.chance;

    if (d.rarity === 'rare' && pity.since_rare >= PITY_CONFIG.rare.threshold) {
      w *= PITY_CONFIG.rare.boost;
    }
    if (d.rarity === 'epic' && pity.since_epic >= PITY_CONFIG.epic.threshold) {
      w *= PITY_CONFIG.epic.boost;
    }
    if (d.rarity === 'legendary' && pity.since_legendary >= PITY_CONFIG.legendary.threshold) {
      w *= PITY_CONFIG.legendary.boost;
    }

    if (pity.common_streak >= STREAK_CONFIG.commonStreakThreshold) {
      if (d.rarity === 'epic') w *= STREAK_CONFIG.epicBoost;
      if (d.rarity === 'legendary') w *= STREAK_CONFIG.legendaryBoost;
      if (d.rarity === 'common') w *= 0.7;
    }

    return Math.max(0, w);
  });

  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return drops[crypto.randomInt(0, drops.length)];

  let r = crypto.randomInt(0, Math.floor(total * 10000)) / 10000;
  for (let i = 0; i < drops.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return drops[i];
  }

  return drops[drops.length - 1];
}

app.post('/api/game/case', (req, res) => {
  const { initData, caseId } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const caseDef = CASES.find((c) => c.id === caseId);
  if (!caseDef) return res.status(400).json({ error: 'invalid caseId' });

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < caseDef.price) return { error: 'insufficient funds' };

    const pity = getPity(tgUser.id, caseDef.id);
    const nextTotal = pity.total_opens + 1;
    const isGuaranteed = GUARANTEED.every > 0 && nextTotal % GUARANTEED.every === 0;

    const drop = pickDropWithMechanics(caseDef.drops, pity, isGuaranteed);

    const delta = drop.price - caseDef.price;
    const newBalance = user.balance + delta;
    const now = Date.now();

    db.prepare(`
      UPDATE users SET balance = ?, updated_at = ?
      WHERE telegram_id = ?
    `).run(newBalance, now, tgUser.id);

    db.prepare(`
      INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tgUser.id, delta, `case:${caseDef.id}`, newBalance, now);

    db.prepare(`
      INSERT INTO history (telegram_id, game, text, amount, win, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      tgUser.id,
      caseDef.name,
      `${drop.name} — ${drop.price} ⭐${isGuaranteed ? ' [ГАРАНТ]' : ''}`,
      delta,
      delta >= 0 ? 1 : 0,
      now,
    );

    updatePity(tgUser.id, caseDef.id, drop.rarity);

    return { drop, newBalance, delta, isGuaranteed };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);

  console.log(
    `[case] user ${tgUser.id} ${caseDef.id} → ${result.drop.name} ` +
    `(${result.drop.rarity}, ${result.drop.price}) delta=${result.delta}` +
    ` → ${result.newBalance}${result.isGuaranteed ? ' [GUARANTEED]' : ''}`,
  );

  res.json(result);
});

/* =========================================================
   API: ЗАГЛУШКИ
   ========================================================= */

app.post('/api/create-invoice', (req, res) => {
  res.status(501).json({ error: 'Invoice API не настроен. Подключи Telegram Bot API.' });
});

app.post('/api/request-nft-withdraw', (req, res) => {
  const { userId, amount } = req.body || {};
  if (!userId || !amount || amount < 500) {
    return res.status(400).json({ error: 'invalid amount' });
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, -amount, 'nft_withdraw', 0, now);

  res.json({ ok: true });
});

/* =========================================================
   TELEGRAM BOT: WEBHOOK
   ========================================================= */

async function sendTelegramMessage(chatId, text, keyboard) {
  if (!BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (keyboard) {
    payload.reply_markup = keyboard;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('[tg] sendMessage failed:', data.description);
    }
  } catch (err) {
    console.error('[tg] sendMessage error:', err);
  }
}

async function handleStartCommand(chatId, fromUser) {
  const firstName = fromUser?.first_name || 'игрок';

  const welcomeText =
    `<b>👋 Привет, ${firstName}!</b>\n\n` +
    `Это <b>RITTERZONA</b> — игровая платформа с:\n\n` +
    `🎯 <b>Рулеткой</b> — угадай цвет и умножь ставку\n` +
    `🚀 <b>Ракетой</b> — забери выигрыш до краха\n` +
    `🎁 <b>Кейсами</b> — открывай награды разных редкостей\n\n` +
    `💰 Стартовый бонус: <b>60 ⭐</b>\n` +
    `🎁 Ежедневный бонус: <b>+25 ⭐</b>\n\n` +
    `Нажми кнопку ниже, чтобы начать 👇`;

  const keyboard = WEBAPP_URL
    ? {
        inline_keyboard: [
          [
            {
              text: '🎮 Играть',
              web_app: { url: WEBAPP_URL },
            },
          ],
        ],
      }
    : {
        inline_keyboard: [
          [
            {
              text: '🎮 Играть',
              url: 'https://t.me/',
            },
          ],
        ],
      };

  await sendTelegramMessage(chatId, welcomeText, keyboard);
}

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== WEBHOOK_SECRET) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const update = req.body || {};
    const message = update.message;

    if (message && typeof message.text === 'string') {
      const chatId = message.chat.id;
      const text = message.text.trim();
      const fromUser = message.from;

      if (text === '/start' || text.startsWith('/start ')) {
        await handleStartCommand(chatId, fromUser);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[tg] webhook error:', err);
    res.json({ ok: true });
  }
});

async function setupTelegramWebhook() {
  if (!BOT_TOKEN) return;
  if (!WEBAPP_URL) {
    console.warn('[tg] WEBAPP_URL не задан — вебхук не настроен');
    return;
  }

  const webhookUrl = `${WEBAPP_URL.replace(/\/$/, '')}/api/telegram-webhook`;

  const body = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
  };

  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json();
    if (data.ok) {
      console.log(`[tg] ✅ Webhook установлен: ${webhookUrl}`);
    } else {
      console.warn('[tg] ❌ setWebhook failed:', data.description);
    }
  } catch (err) {
    console.error('[tg] setWebhook error:', err);
  }
}

/* =========================================================
   РАЗДАЧА СТАТИКИ
   ========================================================= */

app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

/* =========================================================
   ЗАПУСК
   ========================================================= */

app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`   BOT_TOKEN: ${BOT_TOKEN ? 'установлен' : 'НЕ установлен (dev)'}`);
  console.log(`   WEBAPP_URL: ${WEBAPP_URL || 'НЕ задан'}`);
  console.log(`   Welcome bonus: ${WELCOME_BONUS} ⭐`);
  console.log(`   Daily bonus: ${DAILY_BONUS} ⭐`);
  console.log(`   Cases: ${CASES.length}`);

  await setupTelegramWebhook();
});