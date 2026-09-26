import 'dotenv/config';
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
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN || '';
const CRYPTO_WEBHOOK_SECRET = process.env.CRYPTO_WEBHOOK_SECRET || '';

// База: на Railway Volume или рядом с server.js
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'users.db')
  : path.join(__dirname, 'users.db');

if (!BOT_TOKEN) console.warn('⚠️ BOT_TOKEN не задан');
if (!WEBAPP_URL) console.warn('⚠️ WEBAPP_URL не задан');
if (!CRYPTO_PAY_TOKEN) console.warn('⚠️ CRYPTO_PAY_TOKEN не задан');

const STAR_TO_RUB = 2;
const USDT_RUB_RATE = 100;
const WELCOME_BONUS = 5;
const WELCOME_TICKETS = 1;
const DAILY_TICKET_EVERY = 7;
const PROMO_INVITER_TICKETS = 1;
const PROMO_ACTIVATOR_BONUS = 5;
const BOX_PRICE = 1;
const MIN_WITHDRAW = 500;

const app = express();
app.use(express.json({ limit: '100kb' }));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0, total_bets INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
    last_login INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1,
    tickets INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    game TEXT NOT NULL, text TEXT NOT NULL, amount INTEGER NOT NULL,
    win INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_user ON history(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    delta INTEGER NOT NULL, reason TEXT NOT NULL, balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS active_rounds (
    token TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL, bet INTEGER NOT NULL,
    crash_point REAL NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS active_mines (
    token TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL, bet INTEGER NOT NULL,
    mines INTEGER NOT NULL, mines_positions TEXT NOT NULL,
    opened TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quests (
    telegram_id INTEGER NOT NULL, quest_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, PRIMARY KEY (telegram_id, quest_id)
  );
  CREATE TABLE IF NOT EXISTS live_wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    username TEXT, game TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_wins ON live_wins(created_at DESC);
  CREATE TABLE IF NOT EXISTS promocodes (
    code TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, used_by INTEGER,
    used_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ticket_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, reason TEXT NOT NULL, balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'stars',
    payload TEXT UNIQUE, invoice_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, paid_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, processed_at INTEGER
  );
`);

function verifyInitData(initData) {
  if (!BOT_TOKEN) {
    if (!initData) return { id: 999999999, username: 'dev_user', first_name: 'Dev' };
    try { return JSON.parse(new URLSearchParams(initData).get('user')); }
    catch { return { id: 999999999, username: 'dev_user', first_name: 'Dev' }; }
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
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

const QUESTS = [
  { id: 'bet1', name: 'Первая ставка', goal: 1, reward: 1 },
  { id: 'bet5', name: '5 ставок', goal: 5, reward: 2 },
  { id: 'bet20', name: '20 ставок', goal: 20, reward: 5 },
  { id: 'case3', name: 'Открой 3 кейса', goal: 3, reward: 3 },
  { id: 'promo1', name: 'Активируй промокод', goal: 1, reward: 5 },
  { id: 'ticket1', name: 'Получи 1 билет', goal: 1, reward: 2 },
  { id: 'mines1', name: 'Сыграй в Сапёр', goal: 1, reward: 1 },
];

function updateQuest(tgId, questId, delta = 1) {
  const now = Date.now();
  let row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgId, questId);
  if (!row) {
    db.prepare(`INSERT INTO quests (telegram_id, quest_id, progress, claimed, updated_at) VALUES (?, ?, 0, 0, ?)`).run(tgId, questId, now);
    row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgId, questId);
  }
  if (row.claimed) return;
  db.prepare(`UPDATE quests SET progress = ?, updated_at = ? WHERE telegram_id = ? AND quest_id = ?`)
    .run(Math.min(row.progress + delta, 999), now, tgId, questId);
}

function addTickets(tgId, amount, reason) {
  if (amount <= 0) return;
  const now = Date.now();
  db.transaction(() => {
    const user = db.prepare(`SELECT tickets FROM users WHERE telegram_id = ?`).get(tgId);
    if (!user) return;
    const nb = user.tickets + amount;
    db.prepare(`UPDATE users SET tickets = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgId);
    db.prepare(`INSERT INTO ticket_history (telegram_id, amount, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgId, amount, reason, nb, now);
  })();
}

function getOrCreateUser(tgUser) {
  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    db.prepare(`INSERT INTO users (telegram_id, username, first_name, balance, total_bets, total_wins, streak, last_login, level, tickets, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, 0, ?, ?)`).run(tgUser.id, tgUser.username || null, tgUser.first_name || null, WELCOME_BONUS, now, now);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, WELCOME_BONUS, 'welcome_bonus', WELCOME_BONUS, now);
    addTickets(tgUser.id, WELCOME_TICKETS, 'welcome');
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  } else {
    db.prepare(`UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE telegram_id = ?`).run(tgUser.username || user.username, tgUser.first_name || user.first_name, now, tgUser.id);
  }
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
}

function creditBalance(tgId, amount, reason) {
  const now = Date.now();
  return db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgId);
    if (!user) return null;
    const nb = user.balance + amount;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgId);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgId, amount, reason, nb, now);
    return nb;
  })();
}

/* =========================================================
   AUTH + HISTORY + LIVE WINS
   ========================================================= */

app.post('/api/auth-telegram', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const user = getOrCreateUser(tgUser);
  res.json({ profile: { telegramId: user.telegram_id, username: user.username, firstName: user.first_name, balance: user.balance, level: user.level, streak: user.streak, totalBets: user.total_bets, tickets: user.tickets || 0 } });
});

app.post('/api/history/add', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const { game, text, amount, win } = req.body || {};
  db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, String(game).slice(0,50), String(text).slice(0,200), Math.floor(Number(amount)||0), win?1:0, Date.now());
  res.json({ ok: true });
});

app.post('/api/history/list', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const limit = Math.min(Math.max(Number(req.body?.limit)||30, 1), 100);
  const rows = db.prepare(`SELECT id, game, text, amount, win, created_at FROM history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?`).all(tgUser.id, limit);
  res.json({ items: rows.map(r => ({ ...r, win: !!r.win, createdAt: r.created_at })) });
});

app.post('/api/live-wins', (req, res) => {
  res.json({ items: db.prepare(`SELECT username, game, amount, created_at FROM live_wins ORDER BY created_at DESC LIMIT 15`).all() });
});

function addLiveWin(tgId, username, game, amount) {
  db.prepare(`INSERT INTO live_wins (telegram_id, username, game, amount, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgId, username||'Player', game, amount, Date.now());
  db.prepare(`DELETE FROM live_wins WHERE id NOT IN (SELECT id FROM live_wins ORDER BY created_at DESC LIMIT 100)`).run();
}

/* =========================================================
   BOX / DAILY / QUESTS
   ========================================================= */

app.post('/api/box/open', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user || user.balance < BOX_PRICE) return { error: 'insufficient funds' };
    let nb = user.balance - BOX_PRICE;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -BOX_PRICE, 'box_open', nb, now);
    const roll = crypto.randomInt(0, 10000) / 100;
    if (roll < 2) {
      addTickets(tgUser.id, 1, 'box_ticket');
      return { ok: true, type: 'ticket', reward: 0, message: '🎟 Билет!', newBalance: nb };
    }
    if (roll < 12) {
      const refund = 2 + crypto.randomInt(0, 4);
      nb += refund;
      db.prepare(`UPDATE users SET balance = ? WHERE telegram_id = ?`).run(nb, tgUser.id);
      db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, refund, 'box_refund', nb, now);
      return { ok: true, type: 'refund', reward: refund, message: `+${refund} ⭐`, newBalance: nb };
    }
    return { ok: true, type: 'redirect', reward: 0, message: 'Иди в Сапёр 💣', game: 'mines', newBalance: nb };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/daily-bonus', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) return res.status(400).json({ error: 'user not found' });
  const dayMs = 86400000;
  const lastBonus = db.prepare(`SELECT created_at FROM transactions WHERE telegram_id = ? AND reason = 'daily_bonus' ORDER BY created_at DESC LIMIT 1`).get(tgUser.id);
  if (lastBonus && now - lastBonus.created_at < dayMs) return res.status(400).json({ error: 'already_claimed', nextAt: lastBonus.created_at + dayMs });
  let newStreak = 1;
  if (user.last_login && now - user.last_login < 2 * dayMs) newStreak = Math.min((user.streak||0)+1, 30);
  let ticketsGiven = 0;
  if (newStreak % DAILY_TICKET_EVERY === 0) { ticketsGiven = 1; addTickets(tgUser.id, 1, `daily_streak_day${newStreak}`); }
  db.prepare(`UPDATE users SET streak = ?, last_login = ?, updated_at = ? WHERE telegram_id = ?`).run(newStreak, now, now, tgUser.id);
  db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, 0, 'daily_bonus', user.balance, now);
  res.json({ balance: user.balance, bonus: 0, streak: newStreak, ticketsGiven, message: ticketsGiven ? `🔥 Streak ${newStreak} дней! +1 билет 🎟` : `🔥 Streak ${newStreak}` });
});

app.post('/api/quests/list', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const items = QUESTS.map(q => {
    const row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgUser.id, q.id);
    return { ...q, progress: row?.progress||0, claimed: !!row?.claimed };
  });
  res.json({ items });
});

app.post('/api/quests/claim', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const quest = QUESTS.find(q => q.id === req.body?.questId);
  if (!quest) return res.status(400).json({ error: 'invalid quest' });
  const row = db.prepare(`SELECT * FROM quests WHERE telegram_id = ? AND quest_id = ?`).get(tgUser.id, quest.id);
  if (!row || row.claimed) return res.status(400).json({ error: 'not claimable' });
  if (row.progress < quest.goal) return res.status(400).json({ error: 'not complete' });
  const now = Date.now();
  const nb = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    const balance = user.balance + quest.reward;
    db.prepare(`UPDATE quests SET claimed = 1, updated_at = ? WHERE telegram_id = ? AND quest_id = ?`).run(now, tgUser.id, quest.id);
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(balance, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, quest.reward, `quest:${quest.id}`, balance, now);
    return balance;
  })();
  res.json({ balance: nb, reward: quest.reward });
});

/* =========================================================
   PROMO
   ========================================================= */

app.post('/api/promo/create', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) return res.status(400).json({ error: 'user not found' });
  const active = db.prepare(`SELECT COUNT(*) AS c FROM promocodes WHERE owner_id = ? AND used_by IS NULL`).get(tgUser.id).c;
  if (active >= 20) return res.status(400).json({ error: 'too_many_active' });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = null;
  for (let i = 0; i < 10; i++) {
    let c = 'RTR-';
    for (let j = 0; j < 6; j++) c += alphabet[crypto.randomInt(0, alphabet.length)];
    if (!db.prepare(`SELECT 1 FROM promocodes WHERE code = ?`).get(c)) { code = c; break; }
  }
  if (!code) return res.status(500).json({ error: 'generate_failed' });
  db.prepare(`INSERT INTO promocodes (code, owner_id, created_at) VALUES (?, ?, ?)`).run(code, tgUser.id, Date.now());
  res.json({ code });
});

app.post('/api/promo/list', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const rows = db.prepare(`SELECT p.code, p.used_by, p.used_at, p.created_at, u.username, u.first_name FROM promocodes p LEFT JOIN users u ON u.telegram_id = p.used_by WHERE p.owner_id = ? ORDER BY p.created_at DESC LIMIT 50`).all(tgUser.id);
  const user = db.prepare('SELECT tickets FROM users WHERE telegram_id = ?').get(tgUser.id);
  res.json({ tickets: user?.tickets||0, codes: rows.map(r => ({ code: r.code, used: !!r.used_by, usedAt: r.used_at, usedByUsername: r.username, usedByFirstName: r.first_name, createdAt: r.created_at })) });
});

app.post('/api/promo/redeem', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const code = String(req.body?.code||'').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'empty' });
  const promo = db.prepare(`SELECT * FROM promocodes WHERE code = ?`).get(code);
  if (!promo) return res.status(400).json({ error: 'not_found' });
  if (promo.owner_id === tgUser.id) return res.status(400).json({ error: 'own_code' });
  if (promo.used_by) return res.status(400).json({ error: 'already_used' });
  const now = Date.now();
  db.transaction(() => {
    db.prepare(`UPDATE promocodes SET used_by = ?, used_at = ? WHERE code = ?`).run(tgUser.id, now, code);
    const userB = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (userB) {
      const nb = userB.balance + PROMO_ACTIVATOR_BONUS;
      db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
      db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, PROMO_ACTIVATOR_BONUS, 'promo_activate', nb, now);
    }
    addTickets(promo.owner_id, PROMO_INVITER_TICKETS, `promo:${code}`);
  })();
  updateQuest(tgUser.id, 'promo1');
  res.json({ ok: true, reward: PROMO_ACTIVATOR_BONUS, message: `Промокод активирован! +${PROMO_ACTIVATOR_BONUS} ⭐` });
});

/* =========================================================
   TICKETS
   ========================================================= */

const TICKET_CASES = [
  { id: 't15', name: 'Ticket Bronze', tickets: 15, color: '#c07840', tagline: '15 билетов', minReward: 50, maxReward: 200 },
  { id: 't30', name: 'Ticket Silver', tickets: 30, color: '#a8b8d6', tagline: '30 билетов', minReward: 150, maxReward: 600 },
  { id: 't75', name: 'Ticket Gold', tickets: 75, color: '#ffd13b', tagline: '75 билетов', minReward: 500, maxReward: 2500 },
];

app.post('/api/tickets/info', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const user = db.prepare('SELECT tickets FROM users WHERE telegram_id = ?').get(tgUser.id);
  res.json({ tickets: user?.tickets||0, cases: TICKET_CASES });
});

app.post('/api/tickets/open', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const caseDef = TICKET_CASES.find(c => c.id === req.body?.caseId);
  if (!caseDef) return res.status(400).json({ error: 'invalid case' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user) return { error: 'user not found' };
    if ((user.tickets||0) < caseDef.tickets) return { error: 'not_enough_tickets' };
    const reward = caseDef.minReward + crypto.randomInt(0, caseDef.maxReward - caseDef.minReward + 1);
    const newTickets = user.tickets - caseDef.tickets;
    const newBalance = user.balance + reward;
    db.prepare(`UPDATE users SET tickets = ?, balance = ?, updated_at = ? WHERE telegram_id = ?`).run(newTickets, newBalance, now, tgUser.id);
    db.prepare(`INSERT INTO ticket_history (telegram_id, amount, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -caseDef.tickets, `open:${caseDef.id}`, newTickets, now);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, reward, `ticket_case:${caseDef.id}`, newBalance, now);
    return { reward, newTickets, newBalance };
  })();
  if (r.error) return res.status(400).json(r);
  if (r.reward >= 500) {
    const u = db.prepare('SELECT username FROM users WHERE telegram_id = ?').get(tgUser.id);
    addLiveWin(tgUser.id, u?.username, caseDef.name, r.reward);
  }
  res.json(r);
});

/* =========================================================
   GAMES
   ========================================================= */

const BASE_SEGMENTS = [2,3,2,2,3,2,5,2,3,2,2,3,10,2,5,3,2,2,3,2,5,3,2,2,3,2,5,2,3,2,30,10,3,5,3,10,2,2,5,3];

app.post('/api/game/roulette', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  const selected = Number(req.body?.selected);
  if (!Number.isFinite(bet) || bet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (![2,3,5,10,30].includes(selected)) return res.status(400).json({ error: 'invalid selected' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const winner = BASE_SEGMENTS[crypto.randomInt(0, BASE_SEGMENTS.length)];
    const won = winner === selected;
    const reward = won ? bet * winner : 0;
    const nb = user.balance - bet + reward;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`).run(nb, won?1:0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, reward - bet, `roulette:x${winner}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, 'Рулетка', `Выпал x${winner}`, reward - bet, won?1:0, now);
    updateQuest(tgUser.id, 'bet1'); updateQuest(tgUser.id, 'bet5'); updateQuest(tgUser.id, 'bet20');
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Рулетка', reward);
    return { winner, won, reward, newBalance: nb, delta: reward - bet };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

function generateCrashPoint() {
  if (crypto.randomInt(0, 100) < 12) return 1.0;
  const r = crypto.randomInt(1, 1000000) / 1000000;
  return Math.min(Math.max(Number((1 + Math.pow(r, 3) * 16).toFixed(2)), 1.3), 100);
}

app.post('/api/game/rocket/start', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  if (!Number.isFinite(bet) || bet < 10) return res.status(400).json({ error: 'invalid bet' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const crashPoint = generateCrashPoint();
    const nb = user.balance - bet;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -bet, 'rocket:bet', nb, now);
    updateQuest(tgUser.id, 'bet1'); updateQuest(tgUser.id, 'bet5'); updateQuest(tgUser.id, 'bet20');
    return { crashPoint, newBalance: nb };
  })();
  if (r.error) return res.status(400).json(r);
  const roundToken = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO active_rounds (token, telegram_id, bet, crash_point, created_at) VALUES (?, ?, ?, ?, ?)`).run(roundToken, tgUser.id, bet, r.crashPoint, Date.now());
  res.json({ roundToken, newBalance: r.newBalance, bet, crashPoint: r.crashPoint });
});

app.post('/api/game/rocket/cashout', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const multiplier = Number(req.body?.multiplier);
  if (!Number.isFinite(multiplier) || multiplier < 1.3) return res.status(400).json({ error: 'multiplier too low' });
  const now = Date.now();
  const r = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_rounds WHERE token = ? AND telegram_id = ?`).get(req.body?.roundToken, tgUser.id);
    if (!round) return { error: 'round not found' };
    if (multiplier >= round.crash_point) {
      db.prepare('DELETE FROM active_rounds WHERE token = ?').run(req.body?.roundToken);
      const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
      return { error: 'crashed', crashPoint: round.crash_point, newBalance: user.balance };
    }
    const reward = Math.floor(round.bet * multiplier);
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    const nb = user.balance + reward;
    db.prepare(`UPDATE users SET balance = ?, total_wins = total_wins + 1, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, reward, `rocket:win x${multiplier}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, 'Ракета', `Вывод x${multiplier.toFixed(2)}`, reward - round.bet, 1, now);
    db.prepare('DELETE FROM active_rounds WHERE token = ?').run(req.body?.roundToken);
        if (reward >= 500) addLiveWin(tgUser.id, user.username, 'Ракета', reward);
    return { reward, newBalance: nb, delta: reward - round.bet };

  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

/* =========================================================
   CASES
   ========================================================= */

const RARITY_CHANCES = { common: 55, uncommon: 25, rare: 12, epic: 5, legendary: 3 };

const CASES = [
  { id: 'starter', name: 'Starter', price: 10, drops: [
    { name: 'Rusty Coin', icon: '🪙', price: 4, rarity: 'common' },
    { name: 'Copper Ring', icon: '💍', price: 9, rarity: 'uncommon' },
    { name: 'Small Gem', icon: '🔹', price: 18, rarity: 'rare' },
    { name: 'Silver Star', icon: '⭐', price: 50, rarity: 'epic' },
    { name: 'Blue Crystal', icon: '💎', price: 150, rarity: 'legendary' },
  ]},
  { id: 'bronze', name: 'Bronze', price: 25, drops: [
    { name: 'Bronze Coin', icon: '🪙', price: 11, rarity: 'common' },
    { name: 'Bronze Star', icon: '⭐', price: 25, rarity: 'uncommon' },
    { name: 'Orange Crystal', icon: '🔶', price: 55, rarity: 'rare' },
    { name: 'Small Crown', icon: '👑', price: 180, rarity: 'epic' },
    { name: 'Red Gem', icon: '💎', price: 550, rarity: 'legendary' },
  ]},
  { id: 'lucky', name: 'Lucky', price: 49, drops: [
    { name: 'Lucky Coin', icon: '🍀', price: 22, rarity: 'common' },
    { name: 'Green Gem', icon: '💚', price: 55, rarity: 'uncommon' },
    { name: 'Four Leaf', icon: '🍀', price: 120, rarity: 'rare' },
    { name: 'Golden Clover', icon: '🌟', price: 350, rarity: 'epic' },
    { name: 'JACKPOT', icon: '💰', price: 1100, rarity: 'legendary' },
  ]},
  { id: 'silver', name: 'Silver', price: 100, drops: [
    { name: 'Silver Coin', icon: '🪙', price: 45, rarity: 'common' },
    { name: 'Silver Star', icon: '🌟', price: 110, rarity: 'uncommon' },
    { name: 'Blue Crystal', icon: '🔷', price: 250, rarity: 'rare' },
    { name: 'Silver Crown', icon: '👑', price: 700, rarity: 'epic' },
    { name: 'Ice Gem', icon: '💎', price: 2200, rarity: 'legendary' },
  ]},
  { id: 'gold', name: 'Gold', price: 250, drops: [
    { name: 'Gold Coin', icon: '🪙', price: 112, rarity: 'common' },
    { name: 'Gold Star', icon: '🌟', price: 275, rarity: 'uncommon' },
    { name: 'Gold Crystal', icon: '🔶', price: 625, rarity: 'rare' },
    { name: 'Golden Crown', icon: '👑', price: 1750, rarity: 'epic' },
    { name: 'Dragon Gem', icon: '🐉', price: 5600, rarity: 'legendary' },
  ]},
  { id: 'platinum', name: 'Platinum', price: 500, drops: [
    { name: 'Platinum Chip', icon: '💠', price: 225, rarity: 'common' },
    { name: 'Platinum Star', icon: '✨', price: 550, rarity: 'uncommon' },
    { name: 'Frost Crystal', icon: '❄️', price: 1250, rarity: 'rare' },
    { name: 'Platinum Crown', icon: '👑', price: 3500, rarity: 'epic' },
    { name: 'Frozen Heart', icon: '💎', price: 11000, rarity: 'legendary' },
  ]},
  { id: 'diamond', name: 'Diamond', price: 1000, drops: [
    { name: 'Diamond Chip', icon: '💎', price: 450, rarity: 'common' },
    { name: 'Diamond Star', icon: '⭐', price: 1100, rarity: 'uncommon' },
    { name: 'Aqua Gem', icon: '🔷', price: 2500, rarity: 'rare' },
    { name: 'Diamond Crown', icon: '👑', price: 7000, rarity: 'epic' },
    { name: 'Ocean Heart', icon: '💠', price: 22000, rarity: 'legendary' },
  ]},
  { id: 'royal', name: 'Royal', price: 2500, drops: [
    { name: 'Royal Chip', icon: '🟣', price: 1125, rarity: 'common' },
    { name: 'Royal Star', icon: '🌟', price: 2750, rarity: 'uncommon' },
    { name: 'Purple Crystal', icon: '🔮', price: 6250, rarity: 'rare' },
    { name: 'Royal Crown', icon: '👑', price: 17500, rarity: 'epic' },
    { name: 'King Heart', icon: '💜', price: 55000, rarity: 'legendary' },
  ]},
  { id: 'cosmic', name: 'Cosmic', price: 5000, drops: [
    { name: 'Star Dust', icon: '✨', price: 2250, rarity: 'common' },
    { name: 'Cosmic Gem', icon: '🌌', price: 5500, rarity: 'uncommon' },
    { name: 'Nebula Crystal', icon: '🌠', price: 12500, rarity: 'rare' },
    { name: 'Galaxy Crown', icon: '👑', price: 35000, rarity: 'epic' },
    { name: 'Black Hole', icon: '🕳️', price: 110000, rarity: 'legendary' },
  ]},
  { id: 'dragon', name: 'Dragon', price: 10000, drops: [
    { name: 'Dragon Scale', icon: '🐲', price: 4500, rarity: 'common' },
    { name: 'Dragon Claw', icon: '🗡️', price: 11000, rarity: 'uncommon' },
    { name: 'Dragon Eye', icon: '👁️', price: 25000, rarity: 'rare' },
    { name: 'Dragon Crown', icon: '👑', price: 70000, rarity: 'epic' },
    { name: 'Dragon Heart', icon: '🐉', price: 220000, rarity: 'legendary' },
  ]},
  { id: 'legendary', name: 'Legendary', price: 25000, drops: [
    { name: 'Legend Chip', icon: '🏅', price: 11250, rarity: 'common' },
    { name: 'Legend Star', icon: '🌟', price: 27500, rarity: 'uncommon' },
    { name: 'Legend Crystal', icon: '🔱', price: 62500, rarity: 'rare' },
    { name: 'Legend Crown', icon: '👑', price: 175000, rarity: 'epic' },
    { name: 'GOD TIER', icon: '💎', price: 550000, rarity: 'legendary' },
  ]},
];

function pickDropByRarity(drops) {
  const r = crypto.randomInt(0, 10000) / 100;
  let c = 0;
  c += RARITY_CHANCES.common; if (r < c) return drops.find(d => d.rarity === 'common');
  c += RARITY_CHANCES.uncommon; if (r < c) return drops.find(d => d.rarity === 'uncommon');
  c += RARITY_CHANCES.rare; if (r < c) return drops.find(d => d.rarity === 'rare');
  c += RARITY_CHANCES.epic; if (r < c) return drops.find(d => d.rarity === 'epic');
  return drops.find(d => d.rarity === 'legendary');
}

app.post('/api/game/case', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const caseDef = CASES.find(c => c.id === req.body?.caseId);
  if (!caseDef) return res.status(400).json({ error: 'invalid caseId' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < caseDef.price) return { error: 'insufficient funds' };
    const drop = pickDropByRarity(caseDef.drops);
    const delta = drop.price - caseDef.price;
    const nb = user.balance + delta;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`).run(nb, delta >= 0 ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, delta, `case:${caseDef.id}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, caseDef.name, `${drop.name} — ${drop.price} ⭐`, delta, delta >= 0 ? 1 : 0, now);
    updateQuest(tgUser.id, 'case3'); updateQuest(tgUser.id, 'bet1'); updateQuest(tgUser.id, 'bet5'); updateQuest(tgUser.id, 'bet20');
    if (delta >= 500) addLiveWin(tgUser.id, user.username, caseDef.name, delta);
    return { drop, newBalance: nb, delta };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

/* =========================================================
   MINES
   ========================================================= */

const MINES_MULTIPLIERS = {
  3: [1.02,1.11,1.21,1.33,1.48,1.65,1.85,2.09,2.39,2.75,3.19,3.73,4.42,5.31,6.47,8.01,10.13,13.17,17.68,24.74,36.51,58.14,108.0,240.2,751.1],
  5: [1.12,1.29,1.5,1.76,2.09,2.52,3.07,3.8,4.79,6.17,8.13,11.01,15.34,22.13,33.4,53.3,90.8,167.9,345.8,806.9,2420.7,12103.6],
  7: [1.24,1.51,1.86,2.32,2.96,3.85,5.12,6.98,9.75,14.03,20.89,32.3,52.25,89.38,163.8,327.7,737.2,1966.2,6982.2,52366.6],
  10: [1.49,1.96,2.64,3.66,5.22,7.7,11.79,18.87,31.84,57.3,110.81,232.08,533.7,1402.2,4365.5,17462.0,104772.0,1047720.0],
};

app.post('/api/game/mines/start', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  const safeMines = Math.floor(Number(req.body?.minesCount));
  if (!Number.isFinite(bet) || bet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (![3,5,7,10].includes(safeMines)) return res.status(400).json({ error: 'invalid mines' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const positions = Array.from({ length: 25 }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const minesPositions = positions.slice(0, safeMines);
    const roundToken = crypto.randomBytes(16).toString('hex');
    const nb = user.balance - bet;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -bet, 'mines:bet', nb, now);
    db.prepare(`INSERT INTO active_mines (token, telegram_id, bet, mines, mines_positions, opened, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(roundToken, tgUser.id, bet, safeMines, JSON.stringify(minesPositions), '[]', now);
    updateQuest(tgUser.id, 'mines1'); updateQuest(tgUser.id, 'bet1'); updateQuest(tgUser.id, 'bet5'); updateQuest(tgUser.id, 'bet20');
    return { roundToken, newBalance: nb, bet, mines: safeMines };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/game/mines/open', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const cell = Math.floor(Number(req.body?.cell));
  if (!Number.isFinite(cell) || cell < 0 || cell >= 25) return res.status(400).json({ error: 'invalid cell' });
  const r = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_mines WHERE token = ? AND telegram_id = ?`).get(req.body?.roundToken, tgUser.id);
    if (!round) return { error: 'round not found' };
    const minesPositions = JSON.parse(round.mines_positions);
    const opened = JSON.parse(round.opened);
    if (opened.includes(cell)) return { error: 'already opened' };
    if (minesPositions.includes(cell)) {
      db.prepare('DELETE FROM active_mines WHERE token = ?').run(req.body?.roundToken);
      const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
      return { mine: true, cell, minePositions: minesPositions, newBalance: user.balance, delta: -round.bet };
    }
    opened.push(cell);
    db.prepare('UPDATE active_mines SET opened = ? WHERE token = ?').run(JSON.stringify(opened), req.body?.roundToken);
    const multiplier = MINES_MULTIPLIERS[round.mines][opened.length - 1] || 0;
    return { mine: false, cell, opened, multiplier, potentialReward: Math.floor(round.bet * multiplier), bet: round.bet, mines: round.mines };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/game/mines/cashout', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  const r = db.transaction(() => {
    const round = db.prepare(`SELECT * FROM active_mines WHERE token = ? AND telegram_id = ?`).get(req.body?.roundToken, tgUser.id);
    if (!round) return { error: 'round not found' };
    const opened = JSON.parse(round.opened);
    if (opened.length === 0) return { error: 'nothing opened' };
    const multiplier = MINES_MULTIPLIERS[round.mines][opened.length - 1] || 0;
    const reward = Math.floor(round.bet * multiplier);
    const delta = reward - round.bet;
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    const nb = user.balance + reward;
    db.prepare(`UPDATE users SET balance = ?, total_wins = total_wins + 1, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, delta, `mines:win x${multiplier}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, 'Сапёр', `Забрал x${multiplier.toFixed(2)}`, delta, 1, now);
    db.prepare('DELETE FROM active_mines WHERE token = ?').run(req.body?.roundToken);
    if (reward >= 500) addLiveWin(tgUser.id, user.username, 'Сапёр', reward);
    return { reward, newBalance: nb, delta, multiplier };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

/* =========================================================
   COINFLY
   ========================================================= */

app.post('/api/game/coinfly', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  if (!Number.isFinite(bet) || bet < 10) return res.status(400).json({ error: 'invalid bet' });
  if (!['heads','tails','edge'].includes(req.body?.choice)) return res.status(400).json({ error: 'invalid choice' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const roll = crypto.randomInt(0, 100);
    const outcome = roll < 45 ? 'heads' : roll < 90 ? 'tails' : 'edge';
    const multipliers = { heads: 2, tails: 2, edge: 9 };
    const won = outcome === req.body.choice;
    const reward = won ? bet * multipliers[outcome] : 0;
    const nb = user.balance - bet + reward;
    const delta = reward - bet;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`).run(nb, won ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, delta, `coinfly:${outcome}`, nb, now);
    updateQuest(tgUser.id, 'bet1'); updateQuest(tgUser.id, 'bet5'); updateQuest(tgUser.id, 'bet20');
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Монетка', reward);
    return { outcome, won, reward, newBalance: nb, delta };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

/* =========================================================
   WITHDRAW
   ========================================================= */

app.post('/api/request-nft-withdraw', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) return res.status(400).json({ error: `min ${MIN_WITHDRAW}` });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user || user.balance < amount) return { error: 'insufficient funds' };
    const nb = user.balance - amount;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -amount, 'withdraw_request', nb, now);
    db.prepare(`INSERT INTO withdraw_requests (telegram_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)`).run(tgUser.id, amount, now);
    return { ok: true, newBalance: nb };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

/* =========================================================
   CRYPTO PAY (CryptoBot)
   ========================================================= */

const CRYPTO_API = 'https://pay.crypt.bot/api';

async function cryptoApiCall(method, body) {
  if (!CRYPTO_PAY_TOKEN) throw new Error('CRYPTO_PAY_TOKEN not set');
  const res = await fetch(`${CRYPTO_API}/${method}`, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error?.message || 'crypto api error');
  return data.result;
}

app.post('/api/crypto/create', async (req, res) => {
  if (!CRYPTO_PAY_TOKEN) return res.status(503).json({ error: 'crypto_disabled' });
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const stars = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(stars) || stars < 50 || stars > 100000) return res.status(400).json({ error: 'invalid amount' });
  const rub = stars * 2;
  const usdt = (rub / USDT_RUB_RATE).toFixed(2);
  const now = Date.now();
  const payload = `crypto_${tgUser.id}_${stars}_${now}`;
  try {
    const invoice = await cryptoApiCall('createInvoice', {
      currency_type: 'crypto',
      asset: 'USDT',
      amount: usdt,
      description: `Пополнение ${stars} ⭐`,
      payload,
      expires_in: 1800,
      paid_btn_name: 'openBot',
      paid_btn_url: 'https://t.me/CryptoBot',
      allow_comments: false,
      allow_anonymous: false,
    });
    db.prepare(`INSERT INTO payments (telegram_id, amount, method, payload, invoice_id, status, created_at) VALUES (?, ?, 'crypto', ?, ?, 'pending', ?)`).run(tgUser.id, stars, payload, String(invoice.invoice_id), now);
    res.json({ ok: true, invoiceId: invoice.invoice_id, payUrl: invoice.bot_invoice_url || invoice.mini_app_invoice_url, amountUsdt: usdt, amountStars: stars, amountRub: rub, payload });
  } catch (err) {
    console.error('[crypto] create error:', err);
    res.status(500).json({ error: 'crypto_create_failed' });
  }
});

app.post('/api/crypto/webhook/:secret', async (req, res) => {
  if (req.params.secret !== CRYPTO_WEBHOOK_SECRET) return res.status(403).json({ ok: false });
  try {
    const update = req.body || {};
    if (update.update_type === 'invoice_paid') {
      const invoice = update.payload || {};
      const payload = invoice.payload;
      const invoiceId = String(invoice.invoice_id);
      const paidAmount = Number(invoice.amount);
      const asset = invoice.asset;
      const payment = db.prepare(`SELECT * FROM payments WHERE payload = ?`).get(payload);
      if (!payment || payment.status === 'paid') return res.json({ ok: true });
      const expectedUsdt = (payment.amount * STAR_TO_RUB) / USDT_RUB_RATE;
      if (asset !== 'USDT' || Math.abs(paidAmount - expectedUsdt) / expectedUsdt > 0.02) {
        console.warn('[crypto] amount mismatch');
        return res.json({ ok: true });
      }
      const now = Date.now();
      db.transaction(() => {
        const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(payment.telegram_id);
        if (!user) return;
        const nb = user.balance + payment.amount;
        db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, payment.telegram_id);
        db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(payment.telegram_id, payment.amount, 'topup_crypto', nb, now);
        db.prepare(`UPDATE payments SET status = 'paid', paid_at = ?, invoice_id = ? WHERE id = ?`).run(now, invoiceId, payment.id);
      })();
      console.log(`[crypto] ✅ ${payment.amount} ⭐ → ${payment.telegram_id}`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[crypto] webhook error:', err);
    res.json({ ok: true });
  }
});

app.post('/api/crypto/status', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const payment = db.prepare(`SELECT status, amount FROM payments WHERE payload = ? AND telegram_id = ?`).get(req.body?.payload, tgUser.id);
  if (!payment) return res.status(404).json({ error: 'not_found' });
  res.json({ status: payment.status, amount: payment.amount });
});

/* =========================================================
   STARS
   ========================================================= */

async function sendTelegramMessage(chatId, text, keyboard) {
  if (!BOT_TOKEN) return;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  try { await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch {}
}

async function handleStartCommand(chatId, fromUser) {
  const text =
    `<b>👋 Привет, ${fromUser?.first_name || 'игрок'}!</b>\n\n` +
    `<b>RITTERZONA</b> — кейсы, рулетка, сапёр!\n\n` +
    `💰 Бонус: <b>5 ⭐ + 1 билет</b>\n\nНажми 👇`;
  const keyboard = WEBAPP_URL
    ? { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: WEBAPP_URL } }]] }
    : { inline_keyboard: [[{ text: '🎮 Играть', url: 'https://t.me/' }]] };
  await sendTelegramMessage(chatId, text, keyboard);
}

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).json({ error: 'forbidden' });
    }
    const update = req.body || {};
    const message = update.message;
    if (message && typeof message.text === 'string') {
      if (message.text.trim() === '/start' || message.text.startsWith('/start ')) {
        await handleStartCommand(message.chat.id, message.from);
      }
    }
    const sp = update.message?.successful_payment;
    if (sp) {
      const payload = sp.invoice_payload || '';
      const amount = sp.total_amount || 0;
      const tgId = update.message.from?.id;
      if (tgId && amount > 0) {
        const payment = db.prepare(`SELECT * FROM payments WHERE payload = ? AND status = 'pending'`).get(payload);
        if (payment) {
          creditBalance(tgId, amount, 'topup_stars');
          db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?`).run(Date.now(), payment.id);
          console.log(`[stars] ✅ ${amount} ⭐ → ${tgId}`);
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[tg] webhook error:', err);
    res.json({ ok: true });
  }
});

app.post('/api/create-invoice', async (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < 10 || amount > 10000) return res.status(400).json({ error: 'invalid amount' });
  const now = Date.now();
  const payload = `stars_${tgUser.id}_${amount}_${now}`;
  db.prepare(`INSERT INTO payments (telegram_id, amount, method, payload, status, created_at) VALUES (?, ?, 'stars', ?, 'pending', ?)`).run(tgUser.id, amount, payload, now);
  if (!BOT_TOKEN) {
    const nb = creditBalance(tgUser.id, amount, 'topup_dev');
    db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE payload = ?`).run(now, payload);
    return res.json({ dev: true, balance: nb, amount });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Пополнение ${amount} ⭐`,
        description: `Зачислим ${amount} звёзд на баланс`,
        payload,
        currency: 'XTR',
        prices: [{ label: `${amount} ⭐`, amount }],
      }),
    });
    const data = await r.json();
    if (!data.ok) return res.status(500).json({ error: 'invoice_failed' });
    res.json({ invoiceLink: data.result });
  } catch {
    res.status(500).json({ error: 'network' });
  }
});

/* =========================================================
   WEBHOOK SETUP + STATIC + START
   ========================================================= */

async function setupTelegramWebhook() {
  if (!BOT_TOKEN || !WEBAPP_URL) return;
  const url = `${WEBAPP_URL.replace(/\/$/, '')}/api/telegram-webhook`;
  const body = { url, allowed_updates: ['message', 'callback_query'] };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.ok) console.log(`[tg] ✅ Webhook: ${url}`);
    else console.warn('[tg] ❌', data.description);
  } catch (err) { console.error('[tg] setWebhook error:', err); }
}

// Статика — frontend в ./dist
app.use(express.static(path.join(__dirname, 'dist')));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`   BOT_TOKEN: ${BOT_TOKEN ? 'установлен' : 'НЕ установлен (dev)'}`);
  console.log(`   WEBAPP_URL: ${WEBAPP_URL || 'НЕ задан'}`);
  console.log(`   CRYPTO_PAY_TOKEN: ${CRYPTO_PAY_TOKEN ? 'установлен' : 'НЕ установлен'}`);
  console.log(`   Экономика: 1 ⭐ = ${STAR_TO_RUB} ₽`);
  await setupTelegramWebhook();
});