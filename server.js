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
const ADMIN_ID = process.env.ADMIN_ID || '';

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'users.db')
  : path.join(__dirname, 'users.db');

if (!BOT_TOKEN) console.warn('⚠️ BOT_TOKEN не задан');
if (!WEBAPP_URL) console.warn('⚠️ WEBAPP_URL не задан');
if (!CRYPTO_PAY_TOKEN) console.warn('⚠️ CRYPTO_PAY_TOKEN не задан');
if (!ADMIN_ID) console.warn('⚠️ ADMIN_ID не задан');

const STAR_TO_RUB = 2;
const USDT_RUB_RATE = 100;
const WELCOME_BONUS = 15;
const WELCOME_TICKETS = 1;
const DAILY_BONUS = 1;
const DAILY_INTERVAL_MS = 2 * 86400000;
const DAILY_TICKET_EVERY = 7;
const PROMO_INVITER_TICKETS = 1;
const PROMO_ACTIVATOR_BONUS = 5;
const PROMO_MAX_USES = 1000;
const BOX_PRICE = 1;
const BOX_COOLDOWN_MS = 60 * 1000;
const MIN_WITHDRAW = 1250;
const WITHDRAW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const FIRST_DEPOSIT_BONUS_PERCENT = 10;
const VIP_DEPOSIT_BONUS_PERCENT = 20;

const VIP_PRICE = 500;
const VIP_DURATION_MS = 30 * 86400000;
const VIP_DAILY_MULT = 2;

const REFERRAL_PERCENT = 0.05;
const REFERRAL_BIG_THRESHOLD = 5000;

const ROCKET_INSTANT_CRASH_BASE = 30;
const ROCKET_MIN_CASHOUT = 1.5;
const ROCKET_ABUSE_PENALTY = 10;
const ROCKET_ABUSE_MAX_PENALTY = 60;
const ROCKET_ABUSE_HIGH_MULT = 2.0;

const TURNOVER_TICKET_STEP = 500;
const TURNOVER_BONUS_STARS = 1;
const TURNOVER_DAILY_LIMIT = 10;

const MIN_BET = 1;
const MIN_BET_SMALL = 9;
const SMALL_BET_LIMIT_PER_DAY = 15;

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
    tickets INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    vip_until INTEGER NOT NULL DEFAULT 0,
    cashout_streak INTEGER NOT NULL DEFAULT 0,
    total_deposited INTEGER NOT NULL DEFAULT 0,
    total_turnover INTEGER NOT NULL DEFAULT 0,
    today_turnover INTEGER NOT NULL DEFAULT 0,
    today_turnover_day INTEGER NOT NULL DEFAULT 0,
    today_turnover_rewards INTEGER NOT NULL DEFAULT 0,
    last_box_at INTEGER NOT NULL DEFAULT 0,
    last_withdraw_at INTEGER NOT NULL DEFAULT 0,
    small_bets_today INTEGER NOT NULL DEFAULT 0,
    small_bets_day INTEGER NOT NULL DEFAULT 0
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
  CREATE TABLE IF NOT EXISTS live_wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    username TEXT, game TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_wins ON live_wins(created_at DESC);
  CREATE TABLE IF NOT EXISTS promocodes (
    code TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, used_by INTEGER,
    used_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS promo_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL,
    user_id INTEGER NOT NULL, username TEXT, first_name TEXT, used_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_promo_uses ON promo_uses(code, used_at DESC);
  CREATE TABLE IF NOT EXISTS ticket_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, reason TEXT NOT NULL, balance_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'stars',
    payload TEXT UNIQUE, invoice_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, paid_at INTEGER,
    is_first INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(telegram_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, processed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_withdraw_status ON withdraw_requests(status, created_at DESC);
  CREATE TABLE IF NOT EXISTS referrals (
    telegram_id INTEGER PRIMARY KEY, referrer_id INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
  CREATE TABLE IF NOT EXISTS referral_earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL,
    referral_id INTEGER NOT NULL, amount INTEGER NOT NULL, source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vip_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, until INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`[migrate] ✅ ${table}.${column}`);
  }
}

ensureColumn('users', 'vip_until',                 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'cashout_streak',            'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'total_deposited',           'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'total_turnover',            'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'today_turnover',            'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'today_turnover_day',        'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'today_turnover_rewards',    'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'last_box_at',               'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'last_withdraw_at',          'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'small_bets_today',          'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'small_bets_day',            'INTEGER NOT NULL DEFAULT 0');
ensureColumn('payments', 'is_first',               'INTEGER NOT NULL DEFAULT 0');

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
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

async function sendTelegramMessage(chatId, text, keyboard) {
  if (!BOT_TOKEN) return;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = keyboard;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) { console.error('[tg] sendMessage error:', err); }
}

async function answerCallback(callbackId, text, showAlert = false) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: showAlert }),
    });
  } catch {}
}

async function answerPreCheckout(preCheckoutId, ok = true, errorMessage) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: preCheckoutId,
        ok,
        error_message: ok ? undefined : (errorMessage || 'Оплата не может быть завершена'),
      }),
    });
  } catch (err) { console.error('[tg] answerPreCheckout error:', err); }
}

async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup }),
    });
  } catch {}
}

function isVip(user) {
  return user && user.vip_until && user.vip_until > Date.now();
}

function todayKey() {
  return Math.floor(Date.now() / 86400000);
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

function registerTurnover(tgId, amount) {
  if (amount <= 0) return;
  const now = Date.now();
  const today = todayKey();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId);
  if (!user) return;

  let todayTurnover = user.today_turnover || 0;
  let todayDay = user.today_turnover_day || 0;
  let todayRewards = user.today_turnover_rewards || 0;

  if (todayDay !== today) {
    todayTurnover = 0;
    todayRewards = 0;
    todayDay = today;
  }

  const prevTotal = user.total_turnover || 0;
  const newTotal = prevTotal + amount;
  const newToday = todayTurnover + amount;

  const prevThresholds = Math.floor(prevTotal / TURNOVER_TICKET_STEP);
  const newThresholds = Math.floor(newTotal / TURNOVER_TICKET_STEP);
  let rewards = newThresholds - prevThresholds;

  if (todayRewards + rewards > TURNOVER_DAILY_LIMIT) {
    rewards = Math.max(0, TURNOVER_DAILY_LIMIT - todayRewards);
  }

  let newBalance = user.balance;

  if (rewards > 0) {
    newBalance += rewards * TURNOVER_BONUS_STARS;
    addTickets(tgId, rewards, `turnover_bonus_${rewards}`);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgId, rewards * TURNOVER_BONUS_STARS, `turnover_bonus_${rewards}`, newBalance, now);
  }

  db.prepare(`UPDATE users SET total_turnover = ?, today_turnover = ?, today_turnover_day = ?, today_turnover_rewards = ?, balance = ?, updated_at = ? WHERE telegram_id = ?`)
    .run(newTotal, newToday, todayDay, todayRewards + rewards, newBalance, now, tgId);
}

function registerSmallBet(tgId, bet) {
  if (bet > MIN_BET_SMALL) return { ok: true, remaining: -1 };
  const today = todayKey();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId);
  if (!user) return { ok: false, reason: 'no_user' };

  let count = user.small_bets_today || 0;
  let day = user.small_bets_day || 0;

  if (day !== today) {
    count = 0;
    day = today;
  }

  if (count >= SMALL_BET_LIMIT_PER_DAY) {
    return { ok: false, reason: 'limit_reached', limit: SMALL_BET_LIMIT_PER_DAY };
  }

  db.prepare(`UPDATE users SET small_bets_today = ?, small_bets_day = ? WHERE telegram_id = ?`)
    .run(count + 1, day, tgId);

  return { ok: true, remaining: SMALL_BET_LIMIT_PER_DAY - count - 1 };
}

function getOrCreateUser(tgUser) {
  const now = Date.now();
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    db.prepare(`INSERT INTO users (telegram_id, username, first_name, balance, total_bets, total_wins, streak, last_login, level, tickets, vip_until, cashout_streak, total_deposited, total_turnover, today_turnover, today_turnover_day, today_turnover_rewards, last_box_at, last_withdraw_at, small_bets_today, small_bets_day, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`).run(tgUser.id, tgUser.username || null, tgUser.first_name || null, WELCOME_BONUS, now, now);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, WELCOME_BONUS, 'welcome_bonus', WELCOME_BONUS, now);
    addTickets(tgUser.id, WELCOME_TICKETS, 'welcome');
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  } else {
    db.prepare(`UPDATE users SET username = ?, first_name = ?, updated_at = ? WHERE telegram_id = ?`).run(tgUser.username || user.username, tgUser.first_name || user.first_name, now, tgUser.id);
  }
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
}

function applyReferralCut(depositorId, amount, source) {
  const ref = db.prepare(`SELECT referrer_id FROM referrals WHERE telegram_id = ?`).get(depositorId);
  if (!ref) return;
  const referrer = db.prepare(`SELECT total_deposited FROM users WHERE telegram_id = ?`).get(ref.referrer_id);
  if (!referrer || referrer.total_deposited < REFERRAL_BIG_THRESHOLD) return;
  const cut = Math.floor(amount * REFERRAL_PERCENT);
  if (cut <= 0) return;
  const now = Date.now();
  db.transaction(() => {
    const r = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(ref.referrer_id);
    if (!r) return;
    const nb = r.balance + cut;
    db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, ref.referrer_id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(ref.referrer_id, cut, `referral:${source}`, nb, now);
    db.prepare(`INSERT INTO referral_earnings (referrer_id, referral_id, amount, source, created_at) VALUES (?, ?, ?, ?, ?)`).run(ref.referrer_id, depositorId, cut, source, now);
  })();
}

function applyDeposit(tgId, amount, source) {
  const now = Date.now();
  const result = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId);
    if (!user) return null;

    const paidCount = db.prepare(`SELECT COUNT(*) AS c FROM payments WHERE telegram_id = ? AND status = 'paid'`).get(tgId).c;
    const isFirst = paidCount <= 1;

    const firstBonus = isFirst ? Math.floor(amount * FIRST_DEPOSIT_BONUS_PERCENT / 100) : 0;
    const vip = isVip(user);
    const vipBonus = vip ? Math.floor(amount * VIP_DEPOSIT_BONUS_PERCENT / 100) : 0;

    const totalBonus = firstBonus + vipBonus;
    const total = amount + totalBonus;
    const nb = user.balance + total;
    const newDeposited = (user.total_deposited || 0) + amount;

    db.prepare(`UPDATE users SET balance = ?, total_deposited = ?, updated_at = ? WHERE telegram_id = ?`)
      .run(nb, newDeposited, now, tgId);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tgId, total, source + (isFirst ? '_first' : '') + (vip ? '_vip' : ''), nb, now);

    return { newBalance: nb, bonus: totalBonus, firstBonus, vipBonus, isFirst, isVip: vip, deposited: newDeposited };
  })();
  if (result) applyReferralCut(tgId, amount, result.isFirst ? 'first_deposit' : 'deposit');
  return result;
}

app.post('/api/auth-telegram', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const user = getOrCreateUser(tgUser);
  const vip = isVip(user);
  const today = todayKey();
  const smallUsed = user.small_bets_day === today ? (user.small_bets_today || 0) : 0;
  res.json({ profile: {
    telegramId: user.telegram_id, username: user.username, firstName: user.first_name,
    balance: user.balance, level: user.level, streak: user.streak, totalBets: user.total_bets,
    tickets: user.tickets || 0,
    vip, vipUntil: user.vip_until || 0,
    totalDeposited: user.total_deposited || 0,
    totalTurnover: user.total_turnover || 0,
    todayTurnover: user.today_turnover_day === today ? (user.today_turnover || 0) : 0,
    smallBetsRemaining: Math.max(0, SMALL_BET_LIMIT_PER_DAY - smallUsed),
  }});
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
  if (!Number.isFinite(amount) || amount <= 0) return;
  db.prepare(`INSERT INTO live_wins (telegram_id, username, game, amount, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgId, username||'Player', game, amount, Date.now());
  db.prepare(`DELETE FROM live_wins WHERE id NOT IN (SELECT id FROM live_wins ORDER BY created_at DESC LIMIT 100)`).run();
}

app.post('/api/box/open', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user || user.balance < BOX_PRICE) return { error: 'insufficient funds' };
    if (now - (user.last_box_at || 0) < BOX_COOLDOWN_MS) {
      return { error: 'cooldown', nextAt: (user.last_box_at || 0) + BOX_COOLDOWN_MS };
    }
    let nb = user.balance - BOX_PRICE;
    db.prepare(`UPDATE users SET balance = ?, last_box_at = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -BOX_PRICE, 'box_open', nb, now);
    registerTurnover(tgUser.id, BOX_PRICE);

    const vip = isVip(user);
    const ticketChance = vip ? 4 : 2;
    const refundChance = vip ? 18 : 12;

    const roll = crypto.randomInt(0, 10000) / 100;
    if (roll < ticketChance) {
      addTickets(tgUser.id, 1, 'box_ticket');
      return { ok: true, type: 'ticket', reward: 0, message: '🎟 Билет!', newBalance: nb };
    }
    if (roll < refundChance) {
      const refund = 1 + crypto.randomInt(0, 2);
      nb += refund;
      db.prepare(`UPDATE users SET balance = ? WHERE telegram_id = ?`).run(nb, tgUser.id);
      db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, refund, 'box_refund', nb, now);
      return { ok: true, type: 'refund', reward: refund, message: `+${refund} ⭐`, newBalance: nb };
    }
    return { ok: true, type: 'redirect', reward: 0, message: 'Пусто', game: 'mines', newBalance: nb };
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

  const lastBonus = db.prepare(`SELECT created_at FROM transactions WHERE telegram_id = ? AND reason = 'daily_bonus' ORDER BY created_at DESC LIMIT 1`).get(tgUser.id);
  if (lastBonus && now - lastBonus.created_at < DAILY_INTERVAL_MS) {
    return res.status(400).json({ error: 'already_claimed', nextAt: lastBonus.created_at + DAILY_INTERVAL_MS });
  }

  let newStreak = 1;
  const dayMs = 86400000;
  if (user.last_login && now - user.last_login < 3 * dayMs) newStreak = Math.min((user.streak||0)+1, 30);

  const vip = isVip(user);
  const dailyAmount = vip ? DAILY_BONUS * VIP_DAILY_MULT : DAILY_BONUS;

  const newBalance = user.balance + dailyAmount;
  let ticketsGiven = 0;
  if (newStreak % DAILY_TICKET_EVERY === 0) {
    ticketsGiven = 1;
    addTickets(tgUser.id, 1, `daily_streak_day${newStreak}`);
  }

  db.prepare(`UPDATE users SET balance = ?, streak = ?, last_login = ?, updated_at = ? WHERE telegram_id = ?`)
    .run(newBalance, newStreak, now, now, tgUser.id);
  db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(tgUser.id, dailyAmount, 'daily_bonus', newBalance, now);

  res.json({
    balance: newBalance,
    bonus: dailyAmount,
    streak: newStreak,
    ticketsGiven,
    vip,
    message: `${vip ? '👑 VIP · ' : ''}🔥 Streak ${newStreak} · +${dailyAmount} ⭐`,
  });
});

app.post('/api/vip/status', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const user = db.prepare('SELECT vip_until FROM users WHERE telegram_id = ?').get(tgUser.id);
  const vip = user && user.vip_until > Date.now();
  res.json({ vip, vipUntil: user?.vip_until || 0, price: VIP_PRICE });
});

app.post('/api/vip/buy', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user) return { error: 'user not found' };
    if (user.balance < VIP_PRICE) return { error: 'insufficient_funds' };
    const base = Math.max(user.vip_until || 0, now);
    const until = base + VIP_DURATION_MS;
    const nb = user.balance - VIP_PRICE;
    db.prepare(`UPDATE users SET balance = ?, vip_until = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, until, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -VIP_PRICE, 'vip_purchase', nb, now);
    db.prepare(`INSERT INTO vip_purchases (telegram_id, amount, until, created_at) VALUES (?, ?, ?, ?)`).run(tgUser.id, VIP_PRICE, until, now);
    return { ok: true, newBalance: nb, vipUntil: until };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

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
  const rows = db.prepare(`
    SELECT p.code, p.created_at,
      (SELECT COUNT(*) FROM promo_uses WHERE code = p.code) AS uses_count,
      (SELECT COUNT(DISTINCT user_id) FROM promo_uses WHERE code = p.code) AS unique_users
    FROM promocodes p WHERE p.owner_id = ?
    ORDER BY p.created_at DESC LIMIT 50
  `).all(tgUser.id);
  const user = db.prepare('SELECT tickets FROM users WHERE telegram_id = ?').get(tgUser.id);
  res.json({
    tickets: user?.tickets || 0,
    codes: rows.map(r => ({
      code: r.code, createdAt: r.created_at,
      usesCount: r.uses_count || 0, uniqueUsers: r.unique_users || 0,
      maxUses: PROMO_MAX_USES,
    })),
  });
});

app.post('/api/promo/redeem', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const code = String(req.body?.code||'').trim().toUpperCase();
  if (!code || code.length < 4 || code.length > 20) return res.status(400).json({ error: 'empty' });

  const promo = db.prepare(`SELECT * FROM promocodes WHERE code = ?`).get(code);
  if (!promo) return res.status(400).json({ error: 'not_found' });
  if (promo.owner_id === tgUser.id) return res.status(400).json({ error: 'own_code' });

  const uses = db.prepare(`SELECT COUNT(*) AS c FROM promo_uses WHERE code = ?`).get(code).c;
  if (uses >= PROMO_MAX_USES) return res.status(400).json({ error: 'limit_reached' });

  const alreadyUsed = db.prepare(`SELECT 1 FROM promo_uses WHERE code = ? AND user_id = ?`).get(code, tgUser.id);
  if (alreadyUsed) return res.status(400).json({ error: 'already_used' });

  const user = db.prepare('SELECT username, first_name FROM users WHERE telegram_id = ?').get(tgUser.id);
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`INSERT INTO promo_uses (code, user_id, username, first_name, used_at) VALUES (?, ?, ?, ?, ?)`)
      .run(code, tgUser.id, user?.username || null, user?.first_name || null, now);

    const userB = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (userB) {
      const nb = userB.balance + PROMO_ACTIVATOR_BONUS;
      db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
      db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, PROMO_ACTIVATOR_BONUS, `promo:${code}`, nb, now);
    }
    addTickets(promo.owner_id, PROMO_INVITER_TICKETS, `promo:${code}`);
    const existing = db.prepare(`SELECT 1 FROM referrals WHERE telegram_id = ?`).get(tgUser.id);
    if (!existing) {
      db.prepare(`INSERT INTO referrals (telegram_id, referrer_id, created_at) VALUES (?, ?, ?)`).run(tgUser.id, promo.owner_id, now);
    }
  })();

  res.json({ ok: true, reward: PROMO_ACTIVATOR_BONUS, message: `Промокод активирован! +${PROMO_ACTIVATOR_BONUS} ⭐` });
});

app.post('/api/promo/users', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'empty' });
  const promo = db.prepare(`SELECT * FROM promocodes WHERE code = ? AND owner_id = ?`).get(code, tgUser.id);
  if (!promo) return res.status(403).json({ error: 'forbidden' });
  const uses = db.prepare(`
    SELECT user_id, username, first_name, used_at FROM promo_uses WHERE code = ? ORDER BY used_at DESC LIMIT 500
  `).all(code);
  res.json({
    code, totalUses: uses.length,
    users: uses.map(u => ({ userId: u.user_id, username: u.username, firstName: u.first_name, usedAt: u.used_at })),
  });
});

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

const BASE_SEGMENTS = [
  1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8,
  1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8,
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  5, 5, 5, 5, 5,
  8, 8, 8,
  15, 15,
];

app.post('/api/game/roulette', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  const selected = Number(req.body?.selected);
  if (!Number.isFinite(bet) || bet < MIN_BET || bet > 1_000_000) return res.status(400).json({ error: 'invalid bet' });
  if (![1.8, 3, 5, 8, 15].includes(selected)) return res.status(400).json({ error: 'invalid selected' });

  const smallCheck = registerSmallBet(tgUser.id, bet);
  if (!smallCheck.ok) {
    return res.status(400).json({
      error: 'small_bet_limit',
      limit: smallCheck.limit,
      message: `Дневной лимит мелких ставок (1–${MIN_BET_SMALL} ⭐, ${smallCheck.limit} шт.) исчерпан. Поставь ${MIN_BET_SMALL + 1} ⭐ или больше.`,
    });
  }

  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const winner = BASE_SEGMENTS[crypto.randomInt(0, BASE_SEGMENTS.length)];
    const won = winner === selected;
    const reward = won ? Math.floor(bet * winner) : 0;
    const nb = user.balance - bet + reward;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`).run(nb, won?1:0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, reward - bet, `roulette:x${winner}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, 'Рулетка', `Выпал x${winner}`, reward - bet, won?1:0, now);
    registerTurnover(tgUser.id, bet);
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Рулетка', reward);
    return { winner, won, reward, newBalance: nb, delta: reward - bet, smallRemaining: smallCheck.remaining };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

function generateCrashPoint(abuseStreak) {
  const penalty = Math.min(abuseStreak * ROCKET_ABUSE_PENALTY, ROCKET_ABUSE_MAX_PENALTY);
  const instantCrashChance = ROCKET_INSTANT_CRASH_BASE + penalty;
  if (crypto.randomInt(0, 100) < instantCrashChance) return 1.0;
  const r = crypto.randomInt(1, 1000000) / 1000000;
  return Math.min(Math.max(Number((1 + Math.pow(r, 3) * 16).toFixed(2)), 1.3), 100);
}

app.post('/api/game/rocket/start', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  if (!Number.isFinite(bet) || bet < MIN_BET || bet > 1_000_000) return res.status(400).json({ error: 'invalid bet' });

  const smallCheck = registerSmallBet(tgUser.id, bet);
  if (!smallCheck.ok) {
    return res.status(400).json({
      error: 'small_bet_limit',
      limit: smallCheck.limit,
      message: `Дневной лимит мелких ставок (1–${MIN_BET_SMALL} ⭐, ${smallCheck.limit} шт.) исчерпан. Поставь ${MIN_BET_SMALL + 1} ⭐ или больше.`,
    });
  }

  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const crashPoint = generateCrashPoint(user.cashout_streak || 0);
    const nb = user.balance - bet;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, updated_at = ? WHERE telegram_id = ?`).run(nb, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -bet, 'rocket:bet', nb, now);
    registerTurnover(tgUser.id, bet);
    return { crashPoint, newBalance: nb };
  })();
  if (r.error) return res.status(400).json(r);
  const roundToken = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO active_rounds (token, telegram_id, bet, crash_point, created_at) VALUES (?, ?, ?, ?, ?)`).run(roundToken, tgUser.id, bet, r.crashPoint, Date.now());
  res.json({ roundToken, newBalance: r.newBalance, bet, crashPoint: r.crashPoint, smallRemaining: smallCheck.remaining });
});

app.post('/api/game/rocket/cashout', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const multiplier = Number(req.body?.multiplier);
  if (!Number.isFinite(multiplier) || multiplier < ROCKET_MIN_CASHOUT || multiplier > 1000) {
    return res.status(400).json({ error: 'multiplier too low', min: ROCKET_MIN_CASHOUT });
  }
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

    let newStreak = user.cashout_streak || 0;
    if (multiplier < ROCKET_ABUSE_HIGH_MULT) newStreak = Math.min(newStreak + 1, 20);
    else newStreak = 0;

    db.prepare(`UPDATE users SET balance = ?, total_wins = total_wins + 1, cashout_streak = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, newStreak, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, reward, `rocket:win x${multiplier}`, nb, now);
    db.prepare(`INSERT INTO history (telegram_id, game, text, amount, win, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(tgUser.id, 'Ракета', `Вывод x${multiplier.toFixed(2)}`, reward - round.bet, 1, now);
    db.prepare('DELETE FROM active_rounds WHERE token = ?').run(req.body?.roundToken);
    if (reward >= 500) addLiveWin(tgUser.id, user.username, 'Ракета', reward);
    return { reward, newBalance: nb, delta: reward - round.bet, abuseStreak: newStreak };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

const RARITY_CHANCES = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

const CASES = [
  { id: 'starter', name: 'Starter', price: 10, drops: [
    { name: 'Rusty Coin', icon: '🪙', price: 2, rarity: 'common' },
    { name: 'Copper Ring', icon: '💍', price: 6, rarity: 'uncommon' },
    { name: 'Small Gem', icon: '🔹', price: 15, rarity: 'rare' },
    { name: 'Silver Star', icon: '⭐', price: 50, rarity: 'epic' },
    { name: 'Blue Crystal', icon: '💎', price: 150, rarity: 'legendary' },
  ]},
  { id: 'bronze', name: 'Bronze', price: 25, drops: [
    { name: 'Bronze Coin', icon: '🪙', price: 5, rarity: 'common' },
    { name: 'Bronze Star', icon: '⭐', price: 15, rarity: 'uncommon' },
    { name: 'Orange Crystal', icon: '🔶', price: 40, rarity: 'rare' },
    { name: 'Small Crown', icon: '👑', price: 120, rarity: 'epic' },
    { name: 'Red Gem', icon: '💎', price: 400, rarity: 'legendary' },
  ]},
  { id: 'lucky', name: 'Lucky', price: 49, drops: [
    { name: 'Lucky Coin', icon: '🍀', price: 10, rarity: 'common' },
    { name: 'Green Gem', icon: '💚', price: 30, rarity: 'uncommon' },
    { name: 'Four Leaf', icon: '🍀', price: 75, rarity: 'rare' },
    { name: 'Golden Clover', icon: '🌟', price: 240, rarity: 'epic' },
    { name: 'JACKPOT', icon: '💰', price: 750, rarity: 'legendary' },
  ]},
  { id: 'silver', name: 'Silver', price: 100, drops: [
    { name: 'Silver Coin', icon: '🪙', price: 20, rarity: 'common' },
    { name: 'Silver Star', icon: '🌟', price: 60, rarity: 'uncommon' },
    { name: 'Blue Crystal', icon: '🔷', price: 150, rarity: 'rare' },
    { name: 'Silver Crown', icon: '👑', price: 500, rarity: 'epic' },
    { name: 'Ice Gem', icon: '💎', price: 1500, rarity: 'legendary' },
  ]},
  { id: 'gold', name: 'Gold', price: 250, drops: [
    { name: 'Gold Coin', icon: '🪙', price: 50, rarity: 'common' },
    { name: 'Gold Star', icon: '🌟', price: 150, rarity: 'uncommon' },
    { name: 'Gold Crystal', icon: '🔶', price: 400, rarity: 'rare' },
    { name: 'Golden Crown', icon: '👑', price: 1200, rarity: 'epic' },
    { name: 'Dragon Gem', icon: '🐉', price: 4000, rarity: 'legendary' },
  ]},
  { id: 'platinum', name: 'Platinum', price: 500, drops: [
    { name: 'Platinum Chip', icon: '💠', price: 100, rarity: 'common' },
    { name: 'Platinum Star', icon: '✨', price: 300, rarity: 'uncommon' },
    { name: 'Frost Crystal', icon: '❄️', price: 800, rarity: 'rare' },
    { name: 'Platinum Crown', icon: '👑', price: 2400, rarity: 'epic' },
    { name: 'Frozen Heart', icon: '💎', price: 8000, rarity: 'legendary' },
  ]},
  { id: 'diamond', name: 'Diamond', price: 1000, drops: [
    { name: 'Diamond Chip', icon: '💎', price: 200, rarity: 'common' },
    { name: 'Diamond Star', icon: '⭐', price: 600, rarity: 'uncommon' },
    { name: 'Aqua Gem', icon: '🔷', price: 1500, rarity: 'rare' },
    { name: 'Diamond Crown', icon: '👑', price: 5000, rarity: 'epic' },
    { name: 'Ocean Heart', icon: '💠', price: 15000, rarity: 'legendary' },
  ]},
  { id: 'royal', name: 'Royal', price: 2500, drops: [
    { name: 'Royal Chip', icon: '🟣', price: 500, rarity: 'common' },
    { name: 'Royal Star', icon: '🌟', price: 1500, rarity: 'uncommon' },
    { name: 'Purple Crystal', icon: '🔮', price: 4000, rarity: 'rare' },
    { name: 'Royal Crown', icon: '👑', price: 12000, rarity: 'epic' },
    { name: 'King Heart', icon: '💜', price: 40000, rarity: 'legendary' },
  ]},
  { id: 'cosmic', name: 'Cosmic', price: 5000, drops: [
    { name: 'Star Dust', icon: '✨', price: 1000, rarity: 'common' },
    { name: 'Cosmic Gem', icon: '🌌', price: 3000, rarity: 'uncommon' },
    { name: 'Nebula Crystal', icon: '🌠', price: 8000, rarity: 'rare' },
    { name: 'Galaxy Crown', icon: '👑', price: 24000, rarity: 'epic' },
    { name: 'Black Hole', icon: '🕳️', price: 80000, rarity: 'legendary' },
  ]},
  { id: 'dragon', name: 'Dragon', price: 10000, drops: [
    { name: 'Dragon Scale', icon: '🐲', price: 2000, rarity: 'common' },
    { name: 'Dragon Claw', icon: '🗡️', price: 6000, rarity: 'uncommon' },
    { name: 'Dragon Eye', icon: '👁️', price: 15000, rarity: 'rare' },
    { name: 'Dragon Crown', icon: '👑', price: 50000, rarity: 'epic' },
    { name: 'Dragon Heart', icon: '🐉', price: 150000, rarity: 'legendary' },
  ]},
  { id: 'legendary', name: 'Legendary', price: 25000, drops: [
    { name: 'Legend Chip', icon: '🏅', price: 5000, rarity: 'common' },
    { name: 'Legend Star', icon: '🌟', price: 15000, rarity: 'uncommon' },
    { name: 'Legend Crystal', icon: '🔱', price: 40000, rarity: 'rare' },
    { name: 'Legend Crown', icon: '👑', price: 120000, rarity: 'epic' },
    { name: 'GOD TIER', icon: '💎', price: 400000, rarity: 'legendary' },
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

  const smallCheck = registerSmallBet(tgUser.id, caseDef.price);
  if (!smallCheck.ok) {
    return res.status(400).json({
      error: 'small_bet_limit',
      limit: smallCheck.limit,
      message: `Дневной лимит мелких ставок (1–${MIN_BET_SMALL} ⭐, ${smallCheck.limit} шт.) исчерпан. Открой кейс дороже.`,
    });
  }

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
    registerTurnover(tgUser.id, caseDef.price);
    if (delta >= 500) addLiveWin(tgUser.id, user.username, caseDef.name, delta);
    return { drop, newBalance: nb, delta, smallRemaining: smallCheck.remaining };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

const MINES_MULTIPLIERS = {
  3: [0.91,0.99,1.08,1.18,1.32,1.47,1.65,1.86,2.13,2.45,2.84,3.32,3.93,4.73,5.76,7.13,9.02,11.72,15.74,22.02,32.49,51.74,96.12,213.78,668.48],
  5: [1.00,1.15,1.34,1.57,1.86,2.24,2.73,3.38,4.26,5.49,7.24,9.80,13.65,19.70,29.73,47.44,80.81,149.43,307.76,718.14,2154.42,10772.20],
  7: [1.10,1.34,1.66,2.07,2.63,3.43,4.56,6.21,8.68,12.49,18.59,28.75,46.50,79.55,145.78,291.65,656.11,1749.92,6214.16,46606.27],
  10: [1.33,1.74,2.35,3.26,4.65,6.85,10.49,16.79,28.34,51.00,98.62,206.55,475.00,1247.96,3885.30,15541.18,93247.08,932470.80],
};

app.post('/api/game/mines/start', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  const safeMines = Math.floor(Number(req.body?.minesCount));
  if (!Number.isFinite(bet) || bet < MIN_BET || bet > 1_000_000) return res.status(400).json({ error: 'invalid bet' });
  if (![3,5,7,10].includes(safeMines)) return res.status(400).json({ error: 'invalid mines' });

  const smallCheck = registerSmallBet(tgUser.id, bet);
  if (!smallCheck.ok) {
    return res.status(400).json({
      error: 'small_bet_limit',
      limit: smallCheck.limit,
      message: `Дневной лимит мелких ставок (1–${MIN_BET_SMALL} ⭐, ${smallCheck.limit} шт.) исчерпан. Поставь ${MIN_BET_SMALL + 1} ⭐ или больше.`,
    });
  }

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
    registerTurnover(tgUser.id, bet);
    return { roundToken, newBalance: nb, bet, mines: safeMines, smallRemaining: smallCheck.remaining };
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

app.post('/api/game/coinfly', (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const bet = Math.floor(Number(req.body?.bet));
  if (!Number.isFinite(bet) || bet < MIN_BET || bet > 1_000_000) return res.status(400).json({ error: 'invalid bet' });
  if (!['heads','tails','edge'].includes(req.body?.choice)) return res.status(400).json({ error: 'invalid choice' });

  const smallCheck = registerSmallBet(tgUser.id, bet);
  if (!smallCheck.ok) {
    return res.status(400).json({
      error: 'small_bet_limit',
      limit: smallCheck.limit,
      message: `Дневной лимит мелких ставок (1–${MIN_BET_SMALL} ⭐, ${smallCheck.limit} шт.) исчерпан. Поставь ${MIN_BET_SMALL + 1} ⭐ или больше.`,
    });
  }

  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (user.balance < bet) return { error: 'insufficient funds' };
    const roll = crypto.randomInt(0, 100);
    const outcome = roll < 42 ? 'heads' : roll < 84 ? 'tails' : 'edge';
    const multipliers = { heads: 2, tails: 2, edge: 5 };
    const won = outcome === req.body.choice;
    const reward = won ? bet * multipliers[outcome] : 0;
    const nb = user.balance - bet + reward;
    const delta = reward - bet;
    db.prepare(`UPDATE users SET balance = ?, total_bets = total_bets + 1, total_wins = total_wins + ?, updated_at = ? WHERE telegram_id = ?`).run(nb, won ? 1 : 0, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, delta, `coinfly:${outcome}`, nb, now);
    registerTurnover(tgUser.id, bet);
    if (won && reward >= 100) addLiveWin(tgUser.id, user.username, 'Монетка', reward);
    return { outcome, won, reward, newBalance: nb, delta, smallRemaining: smallCheck.remaining };
  })();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/request-nft-withdraw', async (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW || amount > 10_000_000) {
    return res.status(400).json({ error: `min ${MIN_WITHDRAW}` });
  }
  const now = Date.now();
  const r = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
    if (!user || user.balance < amount) return { error: 'insufficient funds' };
    if (now - (user.last_withdraw_at || 0) < WITHDRAW_COOLDOWN_MS) {
      return { error: 'cooldown', nextAt: (user.last_withdraw_at || 0) + WITHDRAW_COOLDOWN_MS };
    }
    const nb = user.balance - amount;
    db.prepare(`UPDATE users SET balance = ?, last_withdraw_at = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, now, tgUser.id);
    db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(tgUser.id, -amount, 'withdraw_request', nb, now);
    const ins = db.prepare(`INSERT INTO withdraw_requests (telegram_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)`).run(tgUser.id, amount, now);
    return { ok: true, newBalance: nb, requestId: ins.lastInsertRowid };
  })();
  if (r.error) return res.status(400).json(r);
  if (ADMIN_ID && BOT_TOKEN) {
    try {
      const user = db.prepare('SELECT username, first_name FROM users WHERE telegram_id = ?').get(tgUser.id);
      const usernameLine = user?.username
        ? `📛 Username: <b>@${user.username}</b>\n🔗 <a href="https://t.me/${user.username}">Открыть чат</a>`
        : `📛 Username: <i>не задан</i>\n🆔 ID: <code>${tgUser.id}</code>`;
      const adminText = `🎁 <b>Заявка на NFT-вывод</b>\n\n👤 <b>${user?.first_name || 'игрок'}</b>\n${usernameLine}\n💰 <b>${amount} ⭐</b>\n📅 #${r.requestId}`;
      const rows = [[
        { text: '✅ Подтвердить', callback_data: `withdraw_approve_${r.requestId}` },
        { text: '❌ Отклонить', callback_data: `withdraw_reject_${r.requestId}` }
      ]];
      if (user?.username) rows.push([{ text: `💬 @${user.username}`, url: `https://t.me/${user.username}` }]);
      await sendTelegramMessage(ADMIN_ID, adminText, { inline_keyboard: rows });
    } catch (e) { console.error('[withdraw] notify admin error:', e); }
  }
  res.json({ ok: true, newBalance: r.newBalance, requestId: r.requestId });
});

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
  if (!Number.isFinite(stars) || stars < 10 || stars > 100000) return res.status(400).json({ error: 'invalid amount' });
  const rub = stars * STAR_TO_RUB;
  const usdt = (rub / USDT_RUB_RATE).toFixed(2);
  const now = Date.now();
  const payload = `crypto_${tgUser.id}_${stars}_${now}`;
  try {
    const invoice = await cryptoApiCall('createInvoice', {
      currency_type: 'crypto', asset: 'USDT', amount: usdt,
      description: `Пополнение ${stars} ⭐`, payload, expires_in: 1800,
      paid_btn_name: 'openBot', paid_btn_url: 'https://t.me/CryptoBot',
      allow_comments: false, allow_anonymous: false,
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
      const payment = db.prepare(`SELECT * FROM payments WHERE payload = ?`).get(payload);
      if (!payment || payment.status === 'paid') return res.json({ ok: true });
      const expectedUsdt = (payment.amount * STAR_TO_RUB) / USDT_RUB_RATE;
      if (Math.abs(paidAmount - expectedUsdt) / expectedUsdt > 0.05) {
        console.warn('[crypto] amount mismatch');
        return res.json({ ok: true });
      }
      const now = Date.now();
      db.prepare(`UPDATE payments SET status = 'paid', paid_at = ?, invoice_id = ? WHERE id = ?`).run(now, invoiceId, payment.id);
      applyDeposit(payment.telegram_id, payment.amount, 'topup_crypto');
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

app.post('/api/create-invoice', async (req, res) => {
  const tgUser = verifyInitData(req.body?.initData);
  if (!tgUser) return res.status(401).json({ error: 'invalid initData' });
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < 10 || amount > 10000) return res.status(400).json({ error: 'invalid amount' });
  const now = Date.now();
  const payload = `stars_${tgUser.id}_${amount}_${now}`;
  const paidCount = db.prepare(`SELECT COUNT(*) AS c FROM payments WHERE telegram_id = ? AND status = 'paid'`).get(tgUser.id).c;
  const isFirst = paidCount === 0 ? 1 : 0;
  db.prepare(`INSERT INTO payments (telegram_id, amount, method, payload, status, created_at, is_first) VALUES (?, ?, 'stars', ?, 'pending', ?, ?)`).run(tgUser.id, amount, payload, now, isFirst);
  if (!BOT_TOKEN) {
    db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE payload = ?`).run(now, payload);
    const dep = applyDeposit(tgUser.id, amount, 'topup_dev');
    return res.json({ dev: true, balance: dep?.newBalance, amount, bonus: dep?.bonus || 0, firstBonus: dep?.firstBonus || 0, vipBonus: dep?.vipBonus || 0, isFirst });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Пополнение ${amount} ⭐`,
        description: isFirst
          ? `Первый депозит +${FIRST_DEPOSIT_BONUS_PERCENT}%`
          : `Зачислим ${amount} звёзд`,
        payload, currency: 'XTR',
        prices: [{ label: `${amount} ⭐`, amount }],
      }),
    });
    const data = await r.json();
    if (!data.ok) return res.status(500).json({ error: 'invoice_failed' });
    res.json({ invoiceLink: data.result, isFirst });
  } catch { res.status(500).json({ error: 'network' }); }
});

async function handleStartCommand(chatId, fromUser) {
  const name = fromUser?.first_name || 'игрок';
  const text =
    `⚡️ <b>${name}, добро пожаловать в RITTERZONA!</b>\n\n` +
    `🎰 Здесь выигрывают звёзды каждый день.\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `🎁 <b>Твои стартовые бонусы:</b>\n` +
    `▫️ <b>+${WELCOME_BONUS} ⭐</b> на баланс\n` +
    `▫️ <b>+${WELCOME_TICKETS} билет</b>\n` +
    `▫️ <b>+${FIRST_DEPOSIT_BONUS_PERCENT}%</b> на первый депозит\n` +
    `▫️ <b>VIP-подписка</b> за ${VIP_PRICE} ⭐ — <b>+${VIP_DEPOSIT_BONUS_PERCENT}%</b> к пополнениям\n\n` +
    `🎯 Ставки от <b>${MIN_BET} ⭐</b>. Не более ${SMALL_BET_LIMIT_PER_DAY} мелких (1–${MIN_BET_SMALL} ⭐) в день.\n` +
    `🔄 За каждые ${TURNOVER_TICKET_STEP} ⭐ оборота — билет + ⭐.\n\n` +
    `👇 <b>Твой шанс на крупный выигрыш:</b>`;
  const keyboard = WEBAPP_URL
    ? { inline_keyboard: [[{ text: '🚀 Открыть RITTERZONA', web_app: { url: WEBAPP_URL } }]] }
    : { inline_keyboard: [[{ text: '🚀 Открыть RITTERZONA', url: 'https://t.me/' }]] };
  await sendTelegramMessage(chatId, text, keyboard);
}

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).json({ error: 'forbidden' });
    }
    const update = req.body || {};

    // ✅ ГЛАВНОЕ ИСПРАВЛЕНИЕ — отвечаем Telegram на pre_checkout_query
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      // Проверяем payload — должен начинаться с stars_
      const payload = q.invoice_payload || '';
      if (!payload.startsWith('stars_')) {
        await answerPreCheckout(q.id, false, 'Неверный заказ');
        return res.json({ ok: true });
      }
      const payment = db.prepare(`SELECT * FROM payments WHERE payload = ? AND status = 'pending'`).get(payload);
      if (!payment) {
        await answerPreCheckout(q.id, false, 'Заказ не найден');
        return res.json({ ok: true });
      }
      await answerPreCheckout(q.id, true);
      return res.json({ ok: true });
    }

    const callback = update.callback_query;
    if (callback) {
      const data = callback.data || '';
      const chatId = callback.message?.chat?.id;
      const messageId = callback.message?.message_id;
      if (String(chatId) !== String(ADMIN_ID)) {
        await answerCallback(callback.id, 'Недоступно', true);
        return res.json({ ok: true });
      }
      if (data.startsWith('withdraw_approve_')) {
        const requestId = Number(data.replace('withdraw_approve_', ''));
        const request = db.prepare(`SELECT * FROM withdraw_requests WHERE id = ?`).get(requestId);
        if (!request || request.status !== 'pending') { await answerCallback(callback.id, 'Уже обработана', true); return res.json({ ok: true }); }
        db.prepare(`UPDATE withdraw_requests SET status = 'completed', processed_at = ? WHERE id = ?`).run(Date.now(), requestId);
        await sendTelegramMessage(request.telegram_id, `🎁 <b>NFT-подарок отправлен!</b>\n\nЗаявка на <b>${request.amount} ⭐</b> одобрена.`, null);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [[{ text: '✅ Подтверждена', callback_data: 'noop' }]] });
        await answerCallback(callback.id, `#${requestId} подтверждена`);
      }
      if (data.startsWith('withdraw_reject_')) {
        const requestId = Number(data.replace('withdraw_reject_', ''));
        const request = db.prepare(`SELECT * FROM withdraw_requests WHERE id = ?`).get(requestId);
        if (!request || request.status !== 'pending') { await answerCallback(callback.id, 'Уже обработана', true); return res.json({ ok: true }); }
        const now = Date.now();
        db.transaction(() => {
          db.prepare(`UPDATE withdraw_requests SET status = 'rejected', processed_at = ? WHERE id = ?`).run(now, requestId);
          const user = db.prepare('SELECT balance FROM users WHERE telegram_id = ?').get(request.telegram_id);
          const nb = user.balance + request.amount;
          db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, request.telegram_id);
          db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`).run(request.telegram_id, request.amount, 'withdraw_refund', nb, now);
        })();
        await sendTelegramMessage(request.telegram_id, `❌ Заявка на <b>${request.amount} ⭐</b> отклонена. Баланс возвращён.`, null);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [[{ text: '❌ Отклонена', callback_data: 'noop' }]] });
        await answerCallback(callback.id, `#${requestId} отклонена`);
      }
      return res.json({ ok: true });
    }

    const message = update.message;
    if (message && typeof message.text === 'string') {
      const text = message.text.trim();
      const chatId = message.chat.id;
      const fromId = String(message.from?.id);

      if (ADMIN_ID && fromId === String(ADMIN_ID)) {
        if (text === '/withdraws' || text === '/w') {
          const pending = db.prepare(`SELECT * FROM withdraw_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20`).all();
          if (pending.length === 0) await sendTelegramMessage(chatId, '📭 Нет активных заявок', null);
          else for (const req of pending) {
            const user = db.prepare('SELECT username, first_name FROM users WHERE telegram_id = ?').get(req.telegram_id);
            const usernameLine = user?.username ? `📛 @${user.username}\n🔗 <a href="https://t.me/${user.username}">Открыть чат</a>` : `📛 <i>username не задан</i>\n🆔 <code>${req.telegram_id}</code>`;
            const txt = `📋 <b>Заявка #${req.id}</b>\n👤 <b>${user?.first_name || ''}</b>\n${usernameLine}\n💰 ${req.amount} ⭐\n📅 ${new Date(req.created_at).toLocaleString('ru')}`;
            const rows = [[{ text: '✅ Подтвердить', callback_data: `withdraw_approve_${req.id}` }, { text: '❌ Отклонить', callback_data: `withdraw_reject_${req.id}` }]];
            if (user?.username) rows.push([{ text: `💬 @${user.username}`, url: `https://t.me/${user.username}` }]);
            await sendTelegramMessage(chatId, txt, { inline_keyboard: rows });
          }
        }
        if (text === '/stats') {
          const totalUsers = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
          const vipCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE vip_until > ?`).get(Date.now()).c;
          const pendingCount = db.prepare(`SELECT COUNT(*) AS c FROM withdraw_requests WHERE status = 'pending'`).get().c;
          const totalBalance = db.prepare(`SELECT SUM(balance) AS s FROM users`).get().s || 0;
          const totalPaid = db.prepare(`SELECT COUNT(*) AS c FROM payments WHERE status = 'paid'`).get().c;
          const totalDeposited = db.prepare(`SELECT SUM(amount) AS s FROM payments WHERE status = 'paid'`).get().s || 0;
          const totalTurnover = db.prepare(`SELECT SUM(total_turnover) AS s FROM users`).get().s || 0;
          const stats =
            `📊 <b>Статистика RITTERZONA</b>\n\n` +
            `👥 Игроков: <b>${totalUsers}</b>\n` +
            `👑 VIP: <b>${vipCount}</b>\n` +
            `💰 Баланс игроков: <b>${totalBalance} ⭐</b>\n` +
            `💳 Платежей: <b>${totalPaid}</b>\n` +
            `💵 Депозитов: <b>${totalDeposited} ⭐</b>\n` +
            `🔄 Оборот: <b>${totalTurnover} ⭐</b>\n` +
            `⏳ Заявок: <b>${pendingCount}</b>`;
          await sendTelegramMessage(chatId, stats, null);
        }
        if (text.startsWith('/give')) {
          const parts = text.split(/\s+/);
          if (parts.length < 3) {
            await sendTelegramMessage(chatId, 'Формат: <code>/give 123456789 5000 bonus</code>', null);
            return res.json({ ok: true });
          }
          const targetId = Number(parts[1]);
          const amount = Math.floor(Number(parts[2]));
          const reason = parts[3] || 'admin_grant';
          if (!Number.isFinite(targetId) || !Number.isFinite(amount) || amount === 0) {
            await sendTelegramMessage(chatId, '❌ Неверные параметры', null);
            return res.json({ ok: true });
          }
          const target = db.prepare('SELECT telegram_id, balance, first_name, username FROM users WHERE telegram_id = ?').get(targetId);
          if (!target) {
            await sendTelegramMessage(chatId, `❌ Игрок <code>${targetId}</code> не найден`, null);
            return res.json({ ok: true });
          }
          const now = Date.now();
          const nb = target.balance + amount;
          db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, targetId);
          db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(targetId, amount, reason, nb, now);
          await sendTelegramMessage(chatId,
            `✅ Начислено <b>${amount} ⭐</b>\n👤 ${target.first_name || 'игрок'}${target.username ? ` (@${target.username})` : ''}\n🆔 <code>${targetId}</code>\n💰 Новый баланс: <b>${nb} ⭐</b>`,
            null);
          try {
            await sendTelegramMessage(targetId, `🎁 Тебе начислено <b>${amount} ⭐</b>\n💰 Баланс: <b>${nb} ⭐</b>`, null);
          } catch {}
          return res.json({ ok: true });
        }
        if (text.startsWith('/take')) {
          const parts = text.split(/\s+/);
          if (parts.length < 3) {
            await sendTelegramMessage(chatId, 'Формат: <code>/take 123456789 500</code>', null);
            return res.json({ ok: true });
          }
          const targetId = Number(parts[1]);
          const amount = Math.floor(Number(parts[2]));
          const reason = parts[3] || 'admin_take';
          if (!Number.isFinite(targetId) || !Number.isFinite(amount) || amount <= 0) {
            await sendTelegramMessage(chatId, '❌ Неверные параметры', null);
            return res.json({ ok: true });
          }
          const target = db.prepare('SELECT telegram_id, balance FROM users WHERE telegram_id = ?').get(targetId);
          if (!target) {
            await sendTelegramMessage(chatId, `❌ Игрок <code>${targetId}</code> не найден`, null);
            return res.json({ ok: true });
          }
          const now = Date.now();
          const nb = Math.max(0, target.balance - amount);
          db.prepare(`UPDATE users SET balance = ?, updated_at = ? WHERE telegram_id = ?`).run(nb, now, targetId);
          db.prepare(`INSERT INTO transactions (telegram_id, delta, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?)`)
            .run(targetId, -amount, reason, nb, now);
          await sendTelegramMessage(chatId, `✅ Списано <b>${amount} ⭐</b> у <code>${targetId}</code>\n💰 Баланс: <b>${nb} ⭐</b>`, null);
          return res.json({ ok: true });
        }
        if (text === '/help') {
          await sendTelegramMessage(chatId,
            `<b>Админ-команды</b>\n\n` +
            `/stats — статистика\n` +
            `/withdraws — заявки\n` +
            `/give ID СУММА [причина] — начислить\n` +
            `/take ID СУММА [причина] — списать\n` +
            `/help — справка`, null);
        }
      }

      if (text === '/start' || text.startsWith('/start ')) {
        await handleStartCommand(chatId, message.from);
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
          db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?`).run(Date.now(), payment.id);
          applyDeposit(tgId, amount, 'topup_stars');
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

async function setupTelegramWebhook() {
  if (!BOT_TOKEN || !WEBAPP_URL) return;
  const url = `${WEBAPP_URL.replace(/\/$/, '')}/api/telegram-webhook`;
  const body = { url, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] };
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

app.use(express.static(path.join(__dirname, 'dist')));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`   Welcome: ${WELCOME_BONUS} ⭐ + ${WELCOME_TICKETS} 🎟`);
  console.log(`   First deposit: +${FIRST_DEPOSIT_BONUS_PERCENT}%`);
  console.log(`   VIP: ${VIP_PRICE} ⭐ / ${VIP_DURATION_MS / 86400000} дн, +${VIP_DEPOSIT_BONUS_PERCENT}% к пополнениям`);
  console.log(`   Bet min: ${MIN_BET} ⭐, small limit: ${SMALL_BET_LIMIT_PER_DAY}/день (${MIN_BET}–${MIN_BET_SMALL} ⭐)`);
  console.log(`   Turnover: ${TURNOVER_TICKET_STEP} ⭐ = +1 🎟 + ${TURNOVER_BONUS_STARS} ⭐ (${TURNOVER_DAILY_LIMIT}/день)`);
  console.log(`   Rocket: min x${ROCKET_MIN_CASHOUT}, crash ${ROCKET_INSTANT_CRASH_BASE}% +${ROCKET_ABUSE_PENALTY}%/кэшаут`);
  console.log(`   Admin: /give ID СУММА, /take ID СУММА`);
  await setupTelegramWebhook();
});