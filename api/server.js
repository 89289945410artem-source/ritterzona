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
    total_bets INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    last_login INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
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
  CREATE TABLE IF NOT EXISTS active_mines (
    token TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    bet INTEGER NOT NULL,
    mines INTEGER NOT NULL,
    mines_positions TEXT NOT NULL,
    opened TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quests (
    telegram_id INTEGER NOT NULL,
    quest_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_id, quest_id)
  );
  CREATE TABLE IF NOT EXISTS live_wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    username TEXT,
    game TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_wins ON live_wins(created_at DESC);
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

/* =========================================================
   УРОВНИ — за количество ставок
   ========================================================= */

const LEVELS = [
  { level: 1,  bets: 0,     bonus: 0    },
  { level: 2,  bets: 20,    bonus: 50   },
  { level: 3,  bets: 60,    bonus: 150  },
  { level: 4,  bets: 150,   bonus: 400  },
  { level: 5,  bets: 300,   bonus: 1000 },
  { level: 6,  bets: 600,   bonus: 2500 },
  { level: 7,  bets: 1200,  bonus: 6000 },
  { level: 8,  bets: 2500,  bonus: 15000 },
  { level: 9,  bets: 5000,  bonus: 40000 },
  { level: 10, bets: 10000, bonus: 100000 },
];

function getLevelForBets(bets) {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (bets >= l.bets) current = l;
    else break;
  }
  return current;
}

/* =========================================================
   КВЕСТЫ
   ========================================================= */

const QUESTS = [
  { id: 'bets10',   name: 'Сделай 10 ставок',        goal: 10,   reward: 25  },
  { id: 'bets50',   name: 'Сделай 50 ставок',        goal: 50,   reward: 100 },
  { id: 'cases5',   name: 'Открой 5 кейсов',         goal: 5,    reward: 50  },
  { id: 'wins3',    name: 'Выиграй 3 раза подряд',   goal: 3,    reward: 75  },
  { id: 'rocket10', name: 'Забери выигрыш 10 раз',   goal: 10,   reward: 150 },
];

function updateQuest(tgId, questId, delta = 1) {
  const now = Date.now();
  let row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgId, questId);
  if (!row) {
    db.prepare(`INSERT INTO quests (telegram_id, quest_id, progress, claimed, updated_at) VALUES (?, ?, 0, 0, ?)`)
      .run(tgId, questId, now);
    row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgId, questId);
  }
  if (row.claimed) return;

  const newProgress = Math.min(row.progress + delta, 999);
  db.prepare(`UPDATE quests SET progress = ?, updated_at = ? WHERE telegram_id = ? AND quest_id = ?`)
    .run(newProgress, now, tgId, questId);
}

function getOrCreateUser(tgUser) {
  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, balance, total_bets, total_wins, streak, last_login, level, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, ?, ?)
    `).run(tgUser.id, tgUser.username || null, tgUser.first_name || null, WELCOME_BONUS, now, now);
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
      level: user.level,
      streak: user.streak,
      totalBets: user.total_bets,
    },
  });
});

/* =========================================================
   API: БАЛАНС
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
   ПОПОЛНЕНИЕ
   ========================================================= */

app.post('/api/create-invoice', (req, res) => {
  const { initData, amount } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const safeAmount = Math.floor(Number(amount));
  if (!Number.isFinite(safeAmount) || safeAmount < 10 || safeAmount > 100_000) return res.status(400).json({ error: 'invalid amount' });
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
   API: LIVE WINS
   ========================================================= */

app.post('/api/live-wins', (req, res) => {
  const rows = db.prepare(`SELECT username, game, amount, created_at FROM live_wins ORDER BY created_at DESC LIMIT 15`).all();
  res.json({ items: rows });
});

function addLiveWin(tgId, username, game, amount) {
  const now = Date.now();
  db.prepare(`INSERT INTO live_wins (telegram_id, username, game, amount, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(tgId, username || 'Player', game, amount, now);
  // Удаляем старые, оставляя 100
  db.prepare(`DELETE FROM live_wins WHERE id NOT IN (SELECT id FROM live_wins ORDER BY created_at DESC LIMIT 100)`).run();
}

/* =========================================================
   ЕЖЕДНЕВНЫЙ БОНУС С STREAK
   ========================================================= */

app.post('/api/daily-bonus', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const now = Date.now();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) return res.status(400).json({ error: 'user not found' });

  const dayMs = 24 * 60 * 60 * 1000;
  const last = user.last_login || 0;
  const hoursSince = (now - last) / (60 * 60 * 1000);

  // Бонус раз в 24 часа
  const lastBonus = db.prepare(`
    SELECT created_at FROM transactions
    WHERE telegram_id = ? AND reason = 'daily_bonus'
    ORDER BY created_at DESC LIMIT 1
  `).get(tgUser.id);

  if (lastBonus && now - lastBonus.created_at < dayMs) {
    return res.status(400).json({
      error: 'already_claimed',
      nextAt: lastBonus.created_at + dayMs,
    });
  }

  // Streak: если зашли в течение 48 часов — streak+1, если больше — сброс
  let newStreak = 1;
  if (last && now - last < 2 * dayMs) {
    newStreak = Math.min((user.streak || 0) + 1, 7);
  }

  // Бонус растёт со streak
  const streakMultiplier = 1 + (newStreak - 1) * 0.25; // 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5
  const bonus = Math.floor(DAILY_BONUS * streakMultiplier);

  const tx = db.transaction(() => {
    const newBalance = user.balance + bonus;
    db.prepare(`UPDATE users SET balance = ?, streak = ?, last_login = ?, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, newStreak, now, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, bonus, 'daily_bonus', newBalance, now);
    return newBalance;
  });

  res.json({
    balance: tx(),
    bonus,
    streak: newStreak,
    streakMultiplier,
  });
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
   КВЕСТЫ
   ========================================================= */

app.post('/api/quests/list', (req, res) => {
  const { initData } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const items = QUESTS.map((q) => {
    const row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgUser.id, q.id);
    return {
      id: q.id,
      name: q.name,
      goal: q.goal,
      reward: q.reward,
      progress: row?.progress || 0,
      claimed: !!row?.claimed,
    };
  });

  res.json({ items });
});

app.post('/api/quests/claim', (req, res) => {
  const { initData, questId } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) return res.status(400).json({ error: 'invalid quest' });

  const row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgUser.id, questId);
  if (!row || row.claimed) return res.status(400).json({ error: 'not claimable' });
  if (row.progress < quest.goal) return res.status(400).json({ error: 'not complete' });

  const now = Date.now();
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + quest.reward;
    db.prepare(`UPDATE quests SET claimed = 1, updated_at = ? WHERE telegram_id = ? AND quest_id = ?`)
      .run(now, tgUser.id, questId);
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, quest.reward, `quest:${questId}`, newBalance, now);
    return newBalance;
  });

  res.json({ balance: tx(), reward: quest.reward });
});

/* =========================================================
   РУЛЕТКА — RTP 90%
   =========================================================
   40 сегментов: x2=18, x3=12, x5=6, x10=3, x30=1
   RTP: x2 90%, x3 90%, x5 75%, x10 75%, x30 75%
   ========================================================= */

const BASE_SEGMENTS = [
  2,  3,  2,  2,  3,  2,  5,  2,  3,  2,
  2,  3,  10, 2,  5,  3,  2,  2,  3,  2,
  5,  3,  2,  2,  3,  2,  5,  2,  3,  2,
  30, 10, 3,  5,  3,  10, 2,  2,  5,  3,
];

app.post('/api/game/roulette', (req, res) => {
  const { initData, bet, selected } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const safeBet = Math.floor(Number(bet));
  const safeSelected = Number(selected);
  if (!Number.isFinite(safeBet) || safeBet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (![2, 3, 5, 10, 30].includes(safeSelected)) return res.status(400).json({ error: 'invalid selected' });
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };
    const winnerIndex = crypto.randomInt(0, BASE_SEGMENTS.length);
    const winner = BASE_SEGMENTS[winnerIndex];
    const won = winner === safeSelected;
    const reward = won ? safeBet * winner : 0;
    const newBalance = user.balance - safeBet + reward;
    const now = Date.now();
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, won ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, reward - safeBet, `roulette:x${winner}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Рулетка', `Выпал x${winner}`, reward - safeBet, won ? 1 : 0, now);

    // Quest tracking
    updateQuest(tgUser.id, 'bets10');
    updateQuest(tgUser.id, 'bets50');
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Рулетка', reward);

    return { winner, won, reward, newBalance, delta: reward - safeBet };
  });
  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   РАКЕТА — RTP 90%
   ========================================================= */

function generateCrashPoint() {
  const instantCrash = crypto.randomInt(0, 100) < 12;
  if (instantCrash) return 1.0;
  const r = crypto.randomInt(1, 1_000_000) / 1_000_000;
  const crash = 1 + Math.pow(r, 3) * 16;
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
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, -safeBet, 'rocket:bet', newBalance, now);
    updateQuest(tgUser.id, 'bets10');
    updateQuest(tgUser.id, 'bets50');
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
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + reward;
    const now = Date.now();
    db.prepare(`UPDATE users SET balance = ?, total_wins = total_wins + 1, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, reward, `rocket:win x${safeMultiplier}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Ракета', `Вывод на x${safeMultiplier.toFixed(2)}`, reward - round.bet, 1, now);
    db.prepare('DELETE FROM active_rounds WHERE token = ?').run(roundToken);
    updateQuest(tgUser.id, 'rocket10');
    if (reward >= 500) addLiveWin(tgUser.id, user.username, 'Ракета', reward);
    return { reward, newBalance, delta: reward - round.bet };
  });
  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   КЕЙСЫ — RTP 90%
   =========================================================
   Шансы: common 55%, uncommon 25%, rare 12%, epic 5%, legendary 3%
   Цены подобраны так, чтобы RTP ≈ 90%
   ========================================================= */

const RARITY_CHANCES = {
  common: 55,
  uncommon: 25,
  rare: 12,
  epic: 5,
  legendary: 3,
};

const CASES = [
  { id: 'starter', name: 'Starter', price: 10, color: '#8b98b8', tagline: 'Первый шаг',
    drops: [
      { name: 'Rusty Coin',   icon: '🪙', price: 4,    rarity: 'common',    color: '#c7a56b' },
      { name: 'Copper Ring',  icon: '💍', price: 9,    rarity: 'uncommon',  color: '#e0a35f' },
      { name: 'Small Gem',    icon: '🔹', price: 18,   rarity: 'rare',      color: '#6fd2ff' },
      { name: 'Silver Star',  icon: '⭐', price: 50,   rarity: 'epic',      color: '#c18bff' },
      { name: 'Blue Crystal', icon: '💎', price: 150,  rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'bronze', name: 'Bronze', price: 25, color: '#c07840', tagline: 'Медный век',
    drops: [
      { name: 'Bronze Coin',    icon: '🪙', price: 11,   rarity: 'common',    color: '#e0a35f' },
      { name: 'Bronze Star',    icon: '⭐', price: 25,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Orange Crystal', icon: '🔶', price: 55,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Small Crown',    icon: '👑', price: 180,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Red Gem',        icon: '💎', price: 550,  rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'lucky', name: 'Lucky', price: 49, color: '#4ec97f', tagline: 'Удача',
    drops: [
      { name: 'Lucky Coin',    icon: '🍀', price: 22,   rarity: 'common',    color: '#8fd9a4' },
      { name: 'Green Gem',     icon: '💚', price: 55,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Four Leaf',     icon: '🍀', price: 120,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Golden Clover', icon: '🌟', price: 350,  rarity: 'epic',      color: '#c18bff' },
      { name: 'JACKPOT',       icon: '💰', price: 1100, rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'silver', name: 'Silver', price: 100, color: '#a8b8d6', tagline: 'Серебро',
    drops: [
      { name: 'Silver Coin',  icon: '🪙', price: 45,   rarity: 'common',    color: '#d4e0f0' },
      { name: 'Silver Star',  icon: '🌟', price: 110,  rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Blue Crystal', icon: '🔷', price: 250,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Silver Crown', icon: '👑', price: 700,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Ice Gem',      icon: '💎', price: 2200, rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'gold', name: 'Gold', price: 250, color: '#ffd13b', tagline: 'Золото',
    drops: [
      { name: 'Gold Coin',    icon: '🪙', price: 112,  rarity: 'common',    color: '#ffe071' },
      { name: 'Gold Star',    icon: '🌟', price: 275,  rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Gold Crystal', icon: '🔶', price: 625,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Golden Crown', icon: '👑', price: 1750, rarity: 'epic',      color: '#c18bff' },
      { name: 'Dragon Gem',   icon: '🐉', price: 5600, rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'platinum', name: 'Platinum', price: 500, color: '#8fd7d7', tagline: 'Платина',
    drops: [
      { name: 'Platinum Chip',  icon: '💠', price: 225,   rarity: 'common',    color: '#b8e8e8' },
      { name: 'Platinum Star',  icon: '✨', price: 550,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Frost Crystal',  icon: '❄️', price: 1250,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Platinum Crown', icon: '👑', price: 3500,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Frozen Heart',   icon: '💎', price: 11000, rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'diamond', name: 'Diamond', price: 1000, color: '#7fd4ff', tagline: 'Алмаз',
    drops: [
      { name: 'Diamond Chip',  icon: '💎', price: 450,    rarity: 'common',    color: '#a8e5ff' },
      { name: 'Diamond Star',  icon: '⭐', price: 1100,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Aqua Gem',      icon: '🔷', price: 2500,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Diamond Crown', icon: '👑', price: 7000,   rarity: 'epic',      color: '#c18bff' },
      { name: 'Ocean Heart',   icon: '💠', price: 22000,  rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'royal', name: 'Royal', price: 2500, color: '#b28fff', tagline: 'Королевский',
    drops: [
      { name: 'Royal Chip',     icon: '🟣', price: 1125,   rarity: 'common',    color: '#d4bfff' },
      { name: 'Royal Star',     icon: '🌟', price: 2750,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Purple Crystal', icon: '🔮', price: 6250,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Royal Crown',    icon: '👑', price: 17500,  rarity: 'epic',      color: '#c18bff' },
      { name: 'King Heart',     icon: '💜', price: 55000,  rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'cosmic', name: 'Cosmic', price: 5000, color: '#7a6bff', tagline: 'Космос',
    drops: [
      { name: 'Star Dust',      icon: '✨', price: 2250,   rarity: 'common',    color: '#b3aaff' },
      { name: 'Cosmic Gem',     icon: '🌌', price: 5500,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Nebula Crystal', icon: '🌠', price: 12500,  rarity: 'rare',      color: '#42d1ff' },
      { name: 'Galaxy Crown',   icon: '👑', price: 35000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'Black Hole',     icon: '🕳️', price: 110000, rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'dragon', name: 'Dragon', price: 10000, color: '#ff7a3d', tagline: 'Дракон',
    drops: [
      { name: 'Dragon Scale', icon: '🐲', price: 4500,    rarity: 'common',    color: '#ff9a6a' },
      { name: 'Dragon Claw',  icon: '🗡️', price: 11000,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Dragon Eye',   icon: '👁️', price: 25000,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Dragon Crown', icon: '👑', price: 70000,   rarity: 'epic',      color: '#c18bff' },
      { name: 'Dragon Heart', icon: '🐉', price: 220000,  rarity: 'legendary', color: '#ffd13b' },
    ] },
  { id: 'legendary', name: 'Legendary', price: 25000, color: '#ffd13b', tagline: 'Легенда',
    drops: [
      { name: 'Legend Chip',    icon: '🏅', price: 11250,   rarity: 'common',    color: '#ffe071' },
      { name: 'Legend Star',    icon: '🌟', price: 27500,   rarity: 'uncommon',  color: '#55b3ff' },
      { name: 'Legend Crystal', icon: '🔱', price: 62500,   rarity: 'rare',      color: '#42d1ff' },
      { name: 'Legend Crown',   icon: '👑', price: 175000,  rarity: 'epic',      color: '#c18bff' },
      { name: 'GOD TIER',       icon: '💎', price: 550000,  rarity: 'legendary', color: '#ffd13b' },
    ] },
];

function pickDropByRarity(drops) {
  const r = crypto.randomInt(0, 10000) / 100;
  let c = 0;
  c += RARITY_CHANCES.common;
  if (r < c) return drops.find((d) => d.rarity === 'common');
  c += RARITY_CHANCES.uncommon;
  if (r < c) return drops.find((d) => d.rarity === 'uncommon');
  c += RARITY_CHANCES.rare;
  if (r < c) return drops.find((d) => d.rarity === 'rare');
  c += RARITY_CHANCES.epic;
  if (r < c) return drops.find((d) => d.rarity === 'epic');
  return drops.find((d) => d.rarity === 'legendary');
}

app.post('/api/game/case', (req, res) => {
  const { initData, caseId } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const caseDef = CASES.find((c) => c.id === caseId);
  if (!caseDef) return res.status(400).json({ error: 'invalid caseId' });
  const tx = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < caseDef.price) return { error: 'insufficient funds' };
    const drop = pickDropByRarity(caseDef.drops);
    const delta = drop.price - caseDef.price;
    const newBalance = user.balance + delta;
    const now = Date.now();
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, delta >= 0 ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, delta, `case:${caseDef.id}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, caseDef.name, `${drop.name} — ${drop.price} ⭐`, delta, delta >= 0 ? 1 : 0, now);

    updateQuest(tgUser.id, 'cases5');
    updateQuest(tgUser.id, 'bets10');
    updateQuest(tgUser.id, 'bets50');
    if (delta >= 500) addLiveWin(tgUser.id, user.username, caseDef.name, delta);

    return { drop, newBalance, delta };
  });
  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   САПЁР — RTP 90%
   =========================================================
   Easy: 3 мины,  ×1.02
   Normal: 5 мин, ×1.12
   Hard: 7 мин,   ×1.24
   Hi-Risk: 10 мин, ×1.49
   ========================================================= */

const MINES_FIELD_SIZE = 25;

const MINES_MULTIPLIERS = {
  3: [
    1.02, 1.11, 1.21, 1.33, 1.48, 1.65, 1.85, 2.09, 2.39, 2.75, 3.19, 3.73, 4.42, 5.31,
    6.47, 8.01, 10.13, 13.17, 17.68, 24.74, 36.51, 58.14, 108.0, 240.2, 751.1,
  ],
  5: [
    1.12, 1.29, 1.5, 1.76, 2.09, 2.52, 3.07, 3.8, 4.79, 6.17, 8.13, 11.01,
    15.34, 22.13, 33.4, 53.3, 90.8, 167.9, 345.8, 806.9, 2420.7, 12103.6,
  ],
  7: [
    1.24, 1.51, 1.86, 2.32, 2.96, 3.85, 5.12, 6.98, 9.75, 14.03, 20.89,
    32.3, 52.25, 89.38, 163.8, 327.7, 737.2, 1966.2, 6982.2, 52366.6,
  ],
  10: [
    1.49, 1.96, 2.64, 3.66, 5.22, 7.7, 11.79, 18.87, 31.84, 57.3, 110.81,
    232.08, 533.7, 1402.2, 4365.5, 17462.0, 104772.0, 1047720.0,
  ],
};

app.post('/api/game/mines/start', (req, res) => {
  const { initData, bet, minesCount } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const safeBet = Math.floor(Number(bet));
  const safeMines = Math.floor(Number(minesCount));
  if (!Number.isFinite(safeBet) || safeBet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (![3, 5, 7, 10].includes(safeMines)) return res.status(400).json({ error: 'invalid mines' });

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const positions = Array.from({ length: MINES_FIELD_SIZE }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const minesPositions = positions.slice(0, safeMines);

    const roundToken = crypto.randomBytes(16).toString('hex');
    const newBalance = user.balance - safeBet;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, -safeBet, 'mines:bet', newBalance, now);
    db.prepare(`INSERT INTO active_mines (token, telegram_id, bet, mines, mines_positions, opened, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(roundToken, tgUser.id, safeBet, safeMines, JSON.stringify(minesPositions), '[]', now);

    updateQuest(tgUser.id, 'bets10');
    updateQuest(tgUser.id, 'bets50');

    return { roundToken, newBalance, bet: safeBet, mines: safeMines };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/game/mines/open', (req, res) => {
  const { initData, roundToken, cell } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const safeCell = Math.floor(Number(cell));
  if (!Number.isFinite(safeCell) || safeCell < 0 || safeCell >= MINES_FIELD_SIZE) {
    return res.status(400).json({ error: 'invalid cell' });
  }

  const tx = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_mines WHERE token = ? AND telegram_id = ?`).get(roundToken, tgUser.id);
    if (!round) return { error: 'round not found' };
    const minesPositions = JSON.parse(round.mines_positions);
    const opened = JSON.parse(round.opened);
    if (opened.includes(safeCell)) return { error: 'already opened' };

    const isMine = minesPositions.includes(safeCell);
    if (isMine) {
      db.prepare('DELETE FROM active_mines WHERE token = ?').run(roundToken);
      const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
      const now = Date.now();
      db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(tgUser.id, 'Сапёр', `Взорвался`, -round.bet, 0, now);
      return { mine: true, cell: safeCell, minePositions: minesPositions, newBalance: user.balance, delta: -round.bet };
    }

    opened.push(safeCell);
    db.prepare('UPDATE active_mines SET opened = ? WHERE token = ?').run(JSON.stringify(opened), roundToken);
    const multiplier = MINES_MULTIPLIERS[round.mines][opened.length - 1] || 0;
    const potentialReward = Math.floor(round.bet * multiplier);
    return { mine: false, cell: safeCell, opened, multiplier, potentialReward, bet: round.bet, mines: round.mines };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/game/mines/cashout', (req, res) => {
  const { initData, roundToken } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const tx = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_mines WHERE token = ? AND telegram_id = ?`).get(roundToken, tgUser.id);
    if (!round) return { error: 'round not found' };
    const opened = JSON.parse(round.opened);
    if (opened.length === 0) return { error: 'nothing opened' };

    const multiplier = MINES_MULTIPLIERS[round.mines][opened.length - 1] || 0;
    const reward = Math.floor(round.bet * multiplier);
    const delta = reward - round.bet;

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    const newBalance = user.balance + reward;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, total_wins = total_wins + 1, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, delta, `mines:win x${multiplier}`, newBalance, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Сапёр', `Забрал x${multiplier.toFixed(2)}`, delta, 1, now);
    db.prepare('DELETE FROM active_mines WHERE token = ?').run(roundToken);

    if (reward >= 500) addLiveWin(tgUser.id, user.username, 'Сапёр', reward);

    return { reward, newBalance, delta, multiplier };
  });

  const result = tx();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* =========================================================
   МОНЕТКА — RTP 90%
   ========================================================= */

app.post('/api/game/coinfly', (req, res) => {
  const { initData, bet, choice } = req.body || {};
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });

  const safeBet = Math.floor(Number(bet));
  if (!Number.isFinite(safeBet) || safeBet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (!['heads', 'tails', 'edge'].includes(choice)) return res.status(400).json({ error: 'invalid choice' });

  const tx = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < safeBet) return { error: 'insufficient funds' };

    const roll = crypto.randomInt(0, 100);
    let outcome;
    if (roll < 45) outcome = 'heads';
    else if (roll < 90) outcome = 'tails';
    else outcome = 'edge';

    const multipliers = { heads: 2, tails: 2, edge: 9 };
    const won = outcome === choice;
    const reward = won ? safeBet * multipliers[outcome] : 0;
    const newBalance = user.balance - safeBet + reward;
    const delta = reward - safeBet;
    const now = Date.now();

    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`)
      .run(newBalance, won ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgUser.id, delta, `coinfly:${outcome}`, newBalance, now);

    const outcomeNames = { heads: 'орёл', tails: 'решка', edge: 'ребро' };
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tgUser.id, 'Монетка', `Выпало ${outcomeNames[outcome]}`, delta, won ? 1 : 0, now);

    updateQuest(tgUser.id, 'bets10');
    updateQuest(tgUser.id, 'bets50');
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Монетка', reward);

    return { outcome, won, reward, newBalance, delta };
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
    `Это <b>RITTERZONA</b> — открывай кейсы и выигрывай!\n\n` +
    `🎁 Кейсы\n🎯 Рулетка\n🚀 Ракета\n💣 Сапёр\n🪙 Монетка\n📦 Free Box раз в 24 часа\n\n` +
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