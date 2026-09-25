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

if (!BOT_TOKEN) console.warn('⚠️  BOT_TOKEN не задан');
if (!WEBAPP_URL) console.warn('⚠️  WEBAPP_URL не задан');

const WELCOME_BONUS = 60;
const DAILY_BONUS = 25;

const app = express();
app.use(express.json({ limit: '100kb' }));

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
  CREATE INDEX IF NOT EXISTS idx_history_user ON history(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS active_rounds (
    token TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    bet INTEGER NOT NULL,
    crash_point REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS free_box (
    telegram_id INTEGER PRIMARY KEY,
    last_claimed INTEGER NOT NULL
  );
`);

/* =========================================================
   INITDATA
   ========================================================= */

function verifyInitData(initData) {
  if (!BOT_TOKEN) {
    if (!initData) return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
    try {
      const params = new URLSearchParams(initData);
      const userJson = params.get('user');
      if (!userJson) return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
      return JSON.parse(userJson);
    } catch { return { id: 999999999, username: 'dev_user', first_name: 'Dev' }; }
  }
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;
  const userJson = params.get('user');
  if (!userJson) return null;
  try { return JSON.parse(userJson); } catch { return null; }
}

function getOrCreateUser(tgUser) {
  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    db.prepare(`INSERT INTO users (telegram_id, username, first_name, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, tgUser.username || null, tgUser.first_name || null, WELCOME_BONUS, now, now);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, WELCOME_BONUS, 'welcome_bonus', WELCOME_BONUS, now);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  } else {
    db.prepare(`UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE telegram_id = ?`)
      .run(tgUser.username || user.username, tgUser.first_name || user.first_name, now, tgUser.id);
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
  if (!Number.isFinite(safeDelta) || safeDelta === 0) return res.status(400).json({ error: 'invalid delta' });
  if (Math.abs(safeDelta) > 10_000_000) return res.status(400).json({ error: 'delta too large' });

  const now = Date.now();
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user) throw new Error('user not found');
    const newBalance = user.balance + safeDelta;
    if (newBalance < 0) return { ok: false, error: 'insufficient funds', balance: user.balance };
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, safeDelta, reason || 'game', newBalance, now);
    return { ok: true, balance: newBalance };
  });

  const result = tx();
  if (!result.ok) return res.status(400).json(result);
  res.json({ balance: result.balance });
});

/* =========================================================
   ПОПОЛНЕНИЕ БЕЗ ОПЛАТЫ
   ========================================================= */

app.post('/api/create-invoice', (req, res) => {
  const { initData, amount } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeAmount = Math.floor(Number(amount));
  if (!Number.isFinite(safeAmount) || safeAmount < 10 || safeAmount > 100_000) {
    return res.status(400).json({ error: 'invalid amount' });
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user) throw new Error('user not found');

    const newBalance = user.balance + safeAmount;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, safeAmount, 'topup', newBalance, now);

    return newBalance;
  });

  const newBalance = tx();
  console.log(`[topup] user ${tgUser.id} +${safeAmount} → ${newBalance}`);
  res.json({ balance: newBalance, amount: safeAmount });
});

/* =========================================================
   API: ИСТОРИЯ
   ========================================================= */

app.post('/api/history/add', (req, res) => {
  const { initData, game, text, amount, win } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(tgUser.id, String(game).slice(0, 50), String(text).slice(0, 200), Math.floor(Number(amount) || 0), win ? 1 : 0, now);
  res.json({ ok: true });
});

app.post('/api/history/list', (req, res) => {
  const { initData, limit } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const rows = db.prepare(`SELECT id, game, text, amount, win, created_at FROM history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(tgUser.id, safeLimit);
  res.json({ items: rows.map((r) => ({ id: r.id, game: r.game, text: r.text, amount: r.amount, win: !!r.win, createdAt: r.created_at })) });
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
  const lastBonus = db.prepare(`SELECT created_at FROM transactions WHERE telegram_id = ? AND reason = 'daily_bonus' ORDER BY created_at DESC LIMIT 1`).get(tgUser.id);
  if (lastBonus && lastBonus.created_at > oneDayAgo) {
    return res.status(400).json({ error: 'already_claimed', nextAt: lastBonus.created_at + 24 * 60 * 60 * 1000 });
  }
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + DAILY_BONUS;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, DAILY_BONUS, 'daily_bonus', newBalance, now);
    return newBalance;
  });
  res.json({ balance: tx(), bonus: DAILY_BONUS });
});

/* =========================================================
   FREE BOX
   ========================================================= */

app.post('/api/free-box', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const row = db.prepare('SELECT * FROM free_box WHERE telegram_id = ?').get(tgUser.id);
  if (row && row.last_claimed > oneDayAgo) {
    return res.status(400).json({ error: 'already_claimed', nextAt: row.last_claimed + 24 * 60 * 60 * 1000 });
  }

  const rewards = [5, 10, 15, 25, 50];
  const reward = rewards[crypto.randomInt(0, rewards.length)];

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + reward;
    db.prepare(`INSERT OR REPLACE INTO free_box (telegram_id, last_claimed) VALUES (?, ?)`).run(tgUser.id, now);
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, reward, 'free_box', newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Free Box', `Выпало ${reward} ⭐`, reward, 1, now);
    return { reward, newBalance };
  });

  res.json(tx());
});

/* =========================================================
   РУЛЕТКА
   ========================================================= */

const BASE_SEGMENTS = [
  2, 2, 2, 2, 3, 2, 2, 5, 2, 2,
  2, 3, 2, 2, 2, 2, 3, 5, 2, 2,
  2, 2, 2, 3, 2, 2, 5, 2, 2, 3,
  2, 2, 2, 2, 3, 5, 2, 2, 30, 100,
];

app.post('/api/game/roulette', (req, res) => {
  const { initData, bet, selected } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeBet = Math.floor(Number(bet));
  const safeSelected = Number(selected);
  if (!Number.isFinite(safeBet) || safeBet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (![2, 3, 5, 30, 100].includes(safeSelected)) return res.status(400).json({ error: 'invalid selected' });

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const winnerIndex = crypto.randomInt(0, BASE_SEGMENTS.length);
    const winner = BASE_SEGMENTS[winnerIndex];
    const won = winner === safeSelected;
    const reward = won ? safeBet * winner : 0;
    const newBalance = user.balance - safeBet + reward;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, reward - safeBet, `roulette:x${winner}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Рулетка', `Выпал x${winner}`, reward - safeBet, won ? 1 : 0, now);

    return { winner, won, reward, newBalance, delta: reward - safeBet };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   РАКЕТА
   ========================================================= */

function generateCrashPoint() {
  const instantCrash = crypto.randomInt(0, 100) < 8;
  if (instantCrash) return 1.0;
  const r = crypto.randomInt(1, 1_000_000) / 1_000_000;
  const crash = 1 + Math.pow(r, 3) * 20;
  return Math.min(Math.max(Number(crash.toFixed(2)), 1.3), 100);
}

app.post('/api/game/rocket/start', (req, res) => {
  const { initData, bet } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeBet = Math.floor(Number(bet));
  if (!Number.isFinite(safeBet) || safeBet < 10) return res.status(400).json({ error: 'invalid bet' });

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const crashPoint = generateCrashPoint();
    const newBalance = user.balance - safeBet;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, -safeBet, 'rocket:bet', newBalance, now);

    return { crashPoint, newBalance };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);

  const roundToken = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO active_rounds (token, telegram_id, bet, crash_point, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(roundToken, tgUser.id, safeBet, result.crashPoint, Date.now());

  res.json({ roundToken, newBalance: result.newBalance, bet: safeBet });
});

app.post('/api/game/rocket/cashout', (req, res) => {
  const { initData, roundToken, multiplier } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeMultiplier = Number(multiplier);
  if (!Number.isFinite(safeMultiplier) || safeMultiplier < 1.3) return res.status(400).json({ error: 'multiplier too low' });

  const tx = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_rounds WHERE token = ? AND telegram_id = ?`).get(roundToken, tgUser.id);
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

    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, reward, `rocket:win x${safeMultiplier}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Ракета', `Вывод на x${safeMultiplier.toFixed(2)}`, reward - round.bet, 1, now);
    db.prepare('DELETE FROM active_rounds WHERE token = ?').run(roundToken);

    return { reward, newBalance, delta: reward - round.bet };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   КЕЙСЫ
   ========================================================= */

const RARITY_CHANCES = {
  common: 65,
  uncommon: 25,
  rare: 7,
  epic: 2.5,
  legendary: 0.5,
};

const CASES = [
  {
    id: 'starter', name: 'Starter', price: 10, color: '#8b98b8', tagline: 'Первый шаг',
    drops: [
      { name: 'Rusty Coin',   icon: '🪙', price: 3,   rarity: 'common',    color: '#c7a56b' },
      { name: 'Copper Ring',  icon: '💍', price: 8,   rarity: 'uncommon',  color: '#e0a35f' },
      { name: 'Small Gem',    icon: '🔹', price: 25,  rarity: 'rare',      color: '#6fd2ff' },
      { name: 'Silver Star',  icon: '⭐', price: 100, rarity: 'epic',      color: '#c18bff' },
      { name: 'Blue Crystal', icon: '💎', price: 700, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'bronze', name: 'Bronze', price: 25, color: '#c07840', tagline: 'Медный век',
    drops: [
      { name: 'Bronze Coin',    icon: '🪙', price: 10,   rarity: 'common',    color: '#e0a35f' },
      { name: 'Bronze Star',    icon: '⭐', price: 30,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Orange Crystal', icon: '🔶', price: 80,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Small Crown',    icon: '👑', price: 400,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Red Gem',        icon: '💎', price: 3000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'lucky', name: 'Lucky', price: 49, color: '#4ec97f', tagline: 'Удача на твоей стороне',
    drops: [
      { name: 'Lucky Coin',    icon: '🍀', price: 20,   rarity: 'common',    color: '#8fd9a4' },
      { name: 'Green Gem',     icon: '💚', price: 60,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Four Leaf',     icon: '🍀', price: 180,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Golden Clover', icon: '🌟', price: 900,  rarity: 'epic',      color: '#c18bff' },
      { name: 'JACKPOT',       icon: '💰', price: 4000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'silver', name: 'Silver', price: 100, color: '#a8b8d6', tagline: 'Лунное серебро',
    drops: [
      { name: 'Silver Coin',  icon: '🪙', price: 40,   rarity: 'common',    color: '#d4e0f0' },
      { name: 'Silver Star',  icon: '🌟', price: 140,  rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Blue Crystal', icon: '🔷', price: 380,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Silver Crown', icon: '👑', price: 2000, rarity: 'epic',      color: '#c18bff' },
      { name: 'Ice Gem',      icon: '💎', price: 9000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'gold', name: 'Gold', price: 250, color: '#ffd13b', tagline: 'Золото фараонов',
    drops: [
      { name: 'Gold Coin',    icon: '🪙', price: 100,   rarity: 'common',    color: '#ffe071' },
      { name: 'Gold Star',    icon: '🌟', price: 350,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Gold Crystal', icon: '🔶', price: 1000,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Golden Crown', icon: '👑', price: 5000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Dragon Gem',   icon: '🐉', price: 25000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'platinum', name: 'Platinum', price: 500, color: '#8fd7d7', tagline: 'Северное сияние',
    drops: [
      { name: 'Platinum Chip',  icon: '💠', price: 200,   rarity: 'common',    color: '#b8e8e8' },
      { name: 'Platinum Star',  icon: '✨', price: 700,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Frost Crystal',  icon: '❄️', price: 2000,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Platinum Crown', icon: '👑', price: 10000, rarity: 'epic',      color: '#c18bff' },
      { name: 'Frozen Heart',   icon: '💎', price: 50000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'diamond', name: 'Diamond', price: 1000, color: '#7fd4ff', tagline: 'Ледяное совершенство',
    drops: [
      { name: 'Diamond Chip',  icon: '💎', price: 400,    rarity: 'common',    color: '#a8e5ff' },
      { name: 'Diamond Star',  icon: '⭐', price: 1400,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Aqua Gem',      icon: '🔷', price: 4000,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Diamond Crown', icon: '👑', price: 20000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Ocean Heart',   icon: '💠', price: 100000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'royal', name: 'Royal', price: 2500, color: '#b28fff', tagline: 'Королевский двор',
    drops: [
      { name: 'Royal Chip',     icon: '🟣', price: 1000,   rarity: 'common',    color: '#d4bfff' },
      { name: 'Royal Star',     icon: '🌟', price: 3500,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Purple Crystal', icon: '🔮', price: 10000,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Royal Crown',    icon: '👑', price: 50000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'King Heart',     icon: '💜', price: 250000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'cosmic', name: 'Cosmic', price: 5000, color: '#7a6bff', tagline: 'За гранью вселенной',
    drops: [
      { name: 'Star Dust',      icon: '✨', price: 2000,   rarity: 'common',    color: '#b3aaff' },
      { name: 'Cosmic Gem',     icon: '🌌', price: 7000,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Nebula Crystal', icon: '🌠', price: 20000,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Galaxy Crown',   icon: '👑', price: 100000, rarity: 'epic',      color: '#c18bff' },
      { name: 'Black Hole',     icon: '🕳️', price: 500000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'dragon', name: 'Dragon', price: 10000, color: '#ff7a3d', tagline: 'Пламя древних',
    drops: [
      { name: 'Dragon Scale', icon: '🐲', price: 4000,    rarity: 'common',    color: '#ff9a6a' },
      { name: 'Dragon Claw',  icon: '🗡️', price: 14000,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Dragon Eye',   icon: '👁️', price: 40000,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Dragon Crown', icon: '👑', price: 200000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Dragon Heart', icon: '🐉', price: 1000000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
  {
    id: 'legendary', name: 'Legendary', price: 25000, color: '#ffd13b', tagline: 'Легенды не умирают',
    drops: [
      { name: 'Legend Chip',    icon: '🏅', price: 10000,   rarity: 'common',    color: '#ffe071' },
      { name: 'Legend Star',    icon: '🌟', price: 35000,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Legend Crystal', icon: '🔱', price: 100000,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Legend Crown',   icon: '👑', price: 500000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'GOD TIER',       icon: '💎', price: 2500000, rarity: 'legendary', color: '#ffd13b' },
    ],
  },
];

function pickDropByRarity(drops) {
  const r = crypto.randomInt(0, 10000) / 100;
  let cumulative = 0;
  cumulative += RARITY_CHANCES.common;
  if (r < cumulative) return drops.find((d) => d.rarity === 'common');
  cumulative += RARITY_CHANCES.uncommon;
  if (r < cumulative) return drops.find((d) => d.rarity === 'uncommon');
  cumulative += RARITY_CHANCES.rare;
  if (r < cumulative) return drops.find((d) => d.rarity === 'rare');
  cumulative += RARITY_CHANCES.epic;
  if (r < cumulative) return drops.find((d) => d.rarity === 'epic');
  return drops.find((d) => d.rarity === 'legendary');
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

    const drop = pickDropByRarity(caseDef.drops);
    const delta = drop.price - caseDef.price;
    const newBalance = user.balance + delta;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, delta, `case:${caseDef.id}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, caseDef.name, `${drop.name} — ${drop.price} ⭐`, delta, delta >= 0 ? 1 : 0, now);

    return { drop, newBalance, delta };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

async function sendTelegramMessage(chatId, text, keyboard) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (err) { console.error('[tg] error:', err); }
}

async function handleStartCommand(chatId, fromUser) {
  const firstName = fromUser?.first_name || 'игрок';
  const welcomeText =
    `<b>👋 Привет, ${firstName}!</b>\n\n` +
    `Это <b>RITTERZONA</b> — открывай кейсы и выигрывай подарки!\n\n` +
    `🎁 <b>Кейсы</b>\n` +
    `🎯 <b>Рулетка</b>\n` +
    `🚀 <b>Ракета</b>\n` +
    `📦 <b>Free Box</b> раз в 24 часа\n\n` +
    `💰 Стартовый бонус: <b>60 ⭐</b>\n\n` +
    `Нажми кнопку ниже 👇`;
  const keyboard = WEBAPP_URL
    ? { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: WEBAPP_URL } }]] }
    : { inline_keyboard: [[{ text: '🎮 Играть', url: 'https://t.me/' }]] };
  await sendTelegramMessage(chatId, welcomeText, keyboard);
}

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== WEBHOOK_SECRET) return res.status(403).json({ error: 'forbidden' });
    }
    const update = req.body || {};
    const message = update.message;
    if (message && typeof message.text === 'string') {
      const chatId = message.chat.id;
      const text = message.text.trim();
      if (text === '/start' || text.startsWith('/start ')) {
        await handleStartCommand(chatId, message.from);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[tg] webhook error:', err);
    res.json({ ok: true });
  }
});

async function setupTelegramWebhook() {
  if (!BOT_TOKEN || !WEBAPP_URL) return;
  const webhookUrl = `${WEBAPP_URL.replace(/\/$/, '')}/api/telegram-webhook`;
  const body = { url: webhookUrl, allowed_updates: ['message', 'callback_query'] };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) console.log(`[tg] ✅ Webhook установлен: ${webhookUrl}`);
    else console.warn('[tg] ❌ setWebhook failed:', data.description);
  } catch (err) { console.error('[tg] setWebhook error:', err); }
}

/* =========================================================
   ЗАГЛУШКИ / СТАТИКА / ЗАПУСК
   ========================================================= */

app.post('/api/request-nft-withdraw', (req, res) => {
  const { userId, amount } = req.body || {};
  if (!userId || !amount || amount < 500) return res.status(400).json({ error: 'invalid amount' });
  const now = Date.now();
  db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, -amount, 'nft_withdraw', 0, now);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`   BOT_TOKEN: ${BOT_TOKEN ? 'установлен' : 'НЕ установлен (dev)'}`);
  console.log(`   WEBAPP_URL: ${WEBAPP_URL || 'НЕ задан'}`);
  await setupTelegramWebhook();
});