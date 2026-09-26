import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import './appStyles.css';
import { hapticSuccess, hapticError, hapticTap, getTelegramUser, initTelegram } from './telegram';

type Page = 'home' | 'roulette' | 'rocket' | 'cases' | 'mines' | 'coinfly' | 'quests' | 'promo' | 'tickets' | 'bonus';
type Multiplier = 2 | 3 | 5 | 10 | 30;

type HistoryItem = { id: number; game: string; text: string; amount: number; win: boolean };
type Segment = { id: number; multiplier: Multiplier; color: string };
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

type Drop = { id: string; name: string; icon: string; price: number; color: string; rarity: Rarity };
type GameCase = { id: string; name: string; price: number; color: string; tagline: string; drops: Drop[] };
type Quest = { id: string; name: string; goal: number; reward: number; progress: number; claimed: boolean };
type LiveWin = { username: string; game: string; amount: number; created_at: number };
type PromoCode = { code: string; used: boolean; usedAt: number | null; usedByUsername: string | null; usedByFirstName: string | null; createdAt: number };
type TicketCase = { id: string; name: string; tickets: number; color: string; tagline: string; minReward: number; maxReward: number };
type TopupMethod = 'stars' | 'crypto';
type CryptoData = { invoiceId: number; payUrl: string; amountUsdt: string; amountStars: number; amountRub: number; payload: string };

const COLORS: Record<Multiplier, string> = { 2: '#9aa0ab', 3: '#ef4444', 5: '#3b82f6', 10: '#22c55e', 30: '#f59e0b' };
const COLOR_NAMES: Record<Multiplier, string> = { 2: 'серый', 3: 'красный', 5: 'синий', 10: 'зелёный', 30: 'жёлтый' };
const RARITY_LABEL: Record<Rarity, string> = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };

const BASE_SEGMENTS: Multiplier[] = [2,3,2,2,3,2,5,2,3,2,2,3,10,2,5,3,2,2,3,2,5,3,2,2,3,2,5,2,3,2,30,10,3,5,3,10,2,2,5,3];

const CASES: GameCase[] = [
  { id: 'box', name: 'Box', price: 1, color: '#4ec97f', tagline: 'Шанс на билет',
    drops: [
      { id: 'bx1', name: 'Билет 🎟', icon: '🎟', price: 0, color: '#a855f7', rarity: 'epic' },
      { id: 'bx2', name: '2 ⭐', icon: '🪙', price: 2, color: '#22d3ee', rarity: 'rare' },
      { id: 'bx3', name: '3 ⭐', icon: '🪙', price: 3, color: '#22d3ee', rarity: 'rare' },
      { id: 'bx4', name: '4 ⭐', icon: '🪙', price: 4, color: '#22d3ee', rarity: 'rare' },
      { id: 'bx5', name: '5 ⭐', icon: '🪙', price: 5, color: '#22d3ee', rarity: 'uncommon' },
      { id: 'bx6', name: 'Пусто', icon: '💣', price: 0, color: '#8b98b8', rarity: 'common' },
    ] },
  { id: 'starter', name: 'Starter', price: 10, color: '#8b98b8', tagline: 'Первый шаг',
    drops: [
      { id: 'st1', name: 'Rusty Coin', icon: '🪙', price: 4, color: '#c7a56b', rarity: 'common' },
      { id: 'st2', name: 'Copper Ring', icon: '💍', price: 9, color: '#e0a35f', rarity: 'uncommon' },
      { id: 'st3', name: 'Small Gem', icon: '🔹', price: 18, color: '#6fd2ff', rarity: 'rare' },
      { id: 'st4', name: 'Silver Star', icon: '⭐', price: 50, color: '#c18bff', rarity: 'epic' },
      { id: 'st5', name: 'Blue Crystal', icon: '💎', price: 150, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'bronze', name: 'Bronze', price: 25, color: '#c07840', tagline: 'Медный век',
    drops: [
      { id: 'b1', name: 'Bronze Coin', icon: '🪙', price: 11, color: '#e0a35f', rarity: 'common' },
      { id: 'b2', name: 'Bronze Star', icon: '⭐', price: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'b3', name: 'Orange Crystal', icon: '🔶', price: 55, color: '#42d1ff', rarity: 'rare' },
      { id: 'b4', name: 'Small Crown', icon: '👑', price: 180, color: '#c18bff', rarity: 'epic' },
      { id: 'b5', name: 'Red Gem', icon: '💎', price: 550, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'lucky', name: 'Lucky', price: 49, color: '#4ec97f', tagline: 'Удача',
    drops: [
      { id: 'lk1', name: 'Lucky Coin', icon: '🍀', price: 22, color: '#8fd9a4', rarity: 'common' },
      { id: 'lk2', name: 'Green Gem', icon: '💚', price: 55, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'lk3', name: 'Four Leaf', icon: '🍀', price: 120, color: '#42d1ff', rarity: 'rare' },
      { id: 'lk4', name: 'Golden Clover', icon: '🌟', price: 350, color: '#c18bff', rarity: 'epic' },
      { id: 'lk5', name: 'JACKPOT', icon: '💰', price: 1100, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'silver', name: 'Silver', price: 100, color: '#a8b8d6', tagline: 'Серебро',
    drops: [
      { id: 's1', name: 'Silver Coin', icon: '🪙', price: 45, color: '#d4e0f0', rarity: 'common' },
      { id: 's2', name: 'Silver Star', icon: '🌟', price: 110, color: '#55b3ff', rarity: 'uncommon' },
      { id: 's3', name: 'Blue Crystal', icon: '🔷', price: 250, color: '#42d1ff', rarity: 'rare' },
      { id: 's4', name: 'Silver Crown', icon: '👑', price: 700, color: '#c18bff', rarity: 'epic' },
      { id: 's5', name: 'Ice Gem', icon: '💎', price: 2200, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'gold', name: 'Gold', price: 250, color: '#ffd13b', tagline: 'Золото',
    drops: [
      { id: 'g1', name: 'Gold Coin', icon: '🪙', price: 112, color: '#ffe071', rarity: 'common' },
      { id: 'g2', name: 'Gold Star', icon: '🌟', price: 275, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'g3', name: 'Gold Crystal', icon: '🔶', price: 625, color: '#42d1ff', rarity: 'rare' },
      { id: 'g4', name: 'Golden Crown', icon: '👑', price: 1750, color: '#c18bff', rarity: 'epic' },
      { id: 'g5', name: 'Dragon Gem', icon: '🐉', price: 5600, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'platinum', name: 'Platinum', price: 500, color: '#8fd7d7', tagline: 'Платина',
    drops: [
      { id: 'p1', name: 'Platinum Chip', icon: '💠', price: 225, color: '#b8e8e8', rarity: 'common' },
      { id: 'p2', name: 'Platinum Star', icon: '✨', price: 550, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'p3', name: 'Frost Crystal', icon: '❄️', price: 1250, color: '#42d1ff', rarity: 'rare' },
      { id: 'p4', name: 'Platinum Crown', icon: '👑', price: 3500, color: '#c18bff', rarity: 'epic' },
      { id: 'p5', name: 'Frozen Heart', icon: '💎', price: 11000, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'diamond', name: 'Diamond', price: 1000, color: '#7fd4ff', tagline: 'Алмаз',
    drops: [
      { id: 'd1', name: 'Diamond Chip', icon: '💎', price: 450, color: '#a8e5ff', rarity: 'common' },
      { id: 'd2', name: 'Diamond Star', icon: '⭐', price: 1100, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'd3', name: 'Aqua Gem', icon: '🔷', price: 2500, color: '#42d1ff', rarity: 'rare' },
      { id: 'd4', name: 'Diamond Crown', icon: '👑', price: 7000, color: '#c18bff', rarity: 'epic' },
      { id: 'd5', name: 'Ocean Heart', icon: '💠', price: 22000, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'royal', name: 'Royal', price: 2500, color: '#b28fff', tagline: 'Королевский',
    drops: [
      { id: 'r1', name: 'Royal Chip', icon: '🟣', price: 1125, color: '#d4bfff', rarity: 'common' },
      { id: 'r2', name: 'Royal Star', icon: '🌟', price: 2750, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'r3', name: 'Purple Crystal', icon: '🔮', price: 6250, color: '#42d1ff', rarity: 'rare' },
      { id: 'r4', name: 'Royal Crown', icon: '👑', price: 17500, color: '#c18bff', rarity: 'epic' },
      { id: 'r5', name: 'King Heart', icon: '💜', price: 55000, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'cosmic', name: 'Cosmic', price: 5000, color: '#7a6bff', tagline: 'Космос',
    drops: [
      { id: 'c1', name: 'Star Dust', icon: '✨', price: 2250, color: '#b3aaff', rarity: 'common' },
      { id: 'c2', name: 'Cosmic Gem', icon: '🌌', price: 5500, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'c3', name: 'Nebula Crystal', icon: '🌠', price: 12500, color: '#42d1ff', rarity: 'rare' },
      { id: 'c4', name: 'Galaxy Crown', icon: '👑', price: 35000, color: '#c18bff', rarity: 'epic' },
      { id: 'c5', name: 'Black Hole', icon: '🕳️', price: 110000, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'dragon', name: 'Dragon', price: 10000, color: '#ff7a3d', tagline: 'Дракон',
    drops: [
      { id: 'dr1', name: 'Dragon Scale', icon: '🐲', price: 4500, color: '#ff9a6a', rarity: 'common' },
      { id: 'dr2', name: 'Dragon Claw', icon: '🗡️', price: 11000, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'dr3', name: 'Dragon Eye', icon: '👁️', price: 25000, color: '#42d1ff', rarity: 'rare' },
      { id: 'dr4', name: 'Dragon Crown', icon: '👑', price: 70000, color: '#c18bff', rarity: 'epic' },
      { id: 'dr5', name: 'Dragon Heart', icon: '🐉', price: 220000, color: '#ffd13b', rarity: 'legendary' },
    ] },
  { id: 'legendary', name: 'Legendary', price: 25000, color: '#ffd13b', tagline: 'Легенда',
    drops: [
      { id: 'lg1', name: 'Legend Chip', icon: '🏅', price: 11250, color: '#ffe071', rarity: 'common' },
      { id: 'lg2', name: 'Legend Star', icon: '🌟', price: 27500, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'lg3', name: 'Legend Crystal', icon: '🔱', price: 62500, color: '#42d1ff', rarity: 'rare' },
      { id: 'lg4', name: 'Legend Crown', icon: '👑', price: 175000, color: '#c18bff', rarity: 'epic' },
      { id: 'lg5', name: 'GOD TIER', icon: '💎', price: 550000, color: '#ffd13b', rarity: 'legendary' },
    ] },
];

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function lighten(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + 60);
  const g = Math.min(255, ((num >> 8) & 0xff) + 60);
  const b = Math.min(255, (num & 0xff) + 60);
  return `rgb(${r}, ${g}, ${b})`;
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState(100);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupMethod, setTopupMethod] = useState<TopupMethod>('stars');

  const [cryptoOpen, setCryptoOpen] = useState(false);
  const [cryptoData, setCryptoData] = useState<CryptoData | null>(null);
  const [cryptoWaiting, setCryptoWaiting] = useState(false);

  const [nftOpen, setNftOpen] = useState(false);
  const [nftLoading, setNftLoading] = useState(false);

  const [liveWins, setLiveWins] = useState<LiveWin[]>([]);
  const [totalBets, setTotalBets] = useState(0);
  const [streak, setStreak] = useState(0);

  const [quests, setQuests] = useState<Quest[]>([]);

  const [tickets, setTickets] = useState(0);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoList, setPromoList] = useState<PromoCode[]>([]);
  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [ticketCases, setTicketCases] = useState<TicketCase[]>([]);
  const [ticketOpening, setTicketOpening] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const cryptoTimerRef = useRef<number | null>(null);

  useEffect(() => { initTelegram(); }, []);

  useEffect(() => {
    function onBalance(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d && typeof d.balance === 'number') setBalance(d.balance);
    }
    function onHistory(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d && typeof d.amount === 'number') {
        setHistory((items) => [{ id: Date.now() + Math.random(), game: d.game, text: d.text, amount: d.amount, win: d.win }, ...items].slice(0, 30));
      }
    }
    function onLiveWin(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d) setLiveWins((items) => [{ ...d, created_at: Date.now() }, ...items].slice(0, 15));
    }
    window.addEventListener('balance-update', onBalance);
    window.addEventListener('history-update', onHistory);
    window.addEventListener('live-win', onLiveWin);
    return () => {
      window.removeEventListener('balance-update', onBalance);
      window.removeEventListener('history-update', onHistory);
      window.removeEventListener('live-win', onLiveWin);
    };
  }, []);

  const showToast = useCallback((text: string) => {
    if (toastTimerRef.current !== null) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
    setToast(text);
    toastTimerRef.current = window.setTimeout(() => { setToast(''); toastTimerRef.current = null; }, 2300);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      let initData = window.Telegram?.WebApp?.initData || '';
      const sdk = !!window.Telegram?.WebApp;
      if (sdk) {
        for (let i = 0; i < 6 && !initData; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
          initData = window.Telegram?.WebApp?.initData || '';
        }
      }
      try {
        const res = await fetch('/api/auth-telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.profile) {
          setBalance(data.profile.balance);
          setTotalBets(data.profile.totalBets || 0);
          setStreak(data.profile.streak || 0);
          setTickets(data.profile.tickets || 0);
          setProfileReady(true);
        } else { setBalance(5); setProfileReady(true); }
      } catch {
        if (!cancelled) { setBalance(5); setProfileReady(true); }
      }
    }
    loadProfile();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    const initData = window.Telegram?.WebApp?.initData || '';
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/history/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, limit: 30 }) });
        const data = await res.json();
        if (cancelled || !Array.isArray(data.items)) return;
        setHistory(data.items.map((it: any) => ({ id: it.id, game: it.game, text: it.text, amount: it.amount, win: it.win })));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [profileReady]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/live-wins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const data = await res.json();
        if (cancelled || !Array.isArray(data.items)) return;
        setLiveWins(data.items);
      } catch {}
    }
    load();
    const iv = window.setInterval(load, 8000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, []);

  const loadQuests = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || '';
    try {
      const res = await fetch('/api/quests/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const data = await res.json();
      if (Array.isArray(data.items)) setQuests(data.items);
    } catch {}
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    loadQuests();
    const iv = window.setInterval(loadQuests, 5000);
    return () => window.clearInterval(iv);
  }, [profileReady, loadQuests]);

  const loadTicketInfo = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || '';
    try {
      const res = await fetch('/api/tickets/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const data = await res.json();
      if (typeof data.tickets === 'number') setTickets(data.tickets);
      if (Array.isArray(data.cases)) setTicketCases(data.cases);
    } catch {}
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    loadTicketInfo();
  }, [profileReady, loadTicketInfo]);

  const loadPromoInfo = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || '';
    try {
      const res = await fetch('/api/promo/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const data = await res.json();
      if (Array.isArray(data.codes)) setPromoList(data.codes);
      if (typeof data.tickets === 'number') setTickets(data.tickets);
    } catch {}
  }, []);

  const claimDailyBonus = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || '';
    setSyncing(true);
    try {
      const res = await fetch('/api/daily-bonus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const data = await res.json();
      if (typeof data.balance === 'number') {
        setBalance(data.balance);
        setStreak(data.streak || 1);
        hapticSuccess();
        showToast(data.message || `🔥 Streak ${data.streak}`);
        loadTicketInfo();
      } else if (data.error === 'already_claimed') {
        const hours = Math.ceil((data.nextAt - Date.now()) / 3600000);
        showToast(`Бонус через ${hours} ч`);
      } else showToast('Ошибка бонуса');
    } catch { showToast('Ошибка сети'); }
    finally { setSyncing(false); }
  }, [showToast, loadTicketInfo]);

  const claimQuest = useCallback(async (questId: string) => {
    const initData = window.Telegram?.WebApp?.initData || '';
    hapticTap();
    try {
      const res = await fetch('/api/quests/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, questId }) });
      const data = await res.json();
      if (typeof data.balance === 'number') {
        setBalance(data.balance);
        hapticSuccess();
        showToast(`✅ +${data.reward} ⭐`);
        loadQuests();
      } else { hapticError(); showToast(data.error || 'Ошибка'); }
    } catch { hapticError(); showToast('Ошибка сети'); }
  }, [showToast, loadQuests]);

  const openTopup = useCallback(() => {
    hapticTap();
    setTopupAmount(100);
    setTopupMethod('stars');
    setTopupOpen(true);
  }, []);

  const handleTopup = useCallback(async () => {
    if (topupAmount < 10) { hapticError(); showToast('Минимум 10 ⭐'); return; }
    setTopupLoading(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      if (topupMethod === 'stars') {
        const res = await fetch('/api/create-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, amount: topupAmount }) });
        const data = await res.json();
        if (!res.ok || data.error) { hapticError(); showToast(data.error || 'Ошибка'); return; }
        if (data.dev && typeof data.balance === 'number') {
          setBalance(data.balance);
          hapticSuccess();
          setTopupOpen(false);
          showToast(`✅ +${data.amount} ⭐ (dev)`);
          return;
        }
        if (data.invoiceLink && window.Telegram?.WebApp?.openInvoice) {
          window.Telegram.WebApp.openInvoice(data.invoiceLink, (status) => {
            if (status === 'paid') {
              hapticSuccess();
              setTopupOpen(false);
              showToast('✅ Оплата получена');
              setTimeout(() => window.location.reload(), 800);
            } else if (status === 'cancelled') { hapticError(); showToast('Отменено'); }
            else { hapticError(); showToast('Ошибка оплаты'); }
          });
        } else { hapticError(); showToast('Не удалось открыть оплату'); }
        return;
      }
      if (topupMethod === 'crypto') {
        const res = await fetch('/api/crypto/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, amount: topupAmount }) });
        const data = await res.json();
        if (!res.ok || data.error) {
          hapticError();
          showToast(data.error === 'crypto_disabled' ? 'Крипта недоступна' : 'Ошибка');
          return;
        }
        setCryptoData(data);
        setTopupOpen(false);
        setCryptoOpen(true);
        setCryptoWaiting(true);
        startCryptoPolling(data.payload);
        return;
      }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setTopupLoading(false); }
  }, [topupAmount, topupMethod, showToast]);

  const startCryptoPolling = useCallback((payload: string) => {
    if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current);
    let attempts = 0;
    cryptoTimerRef.current = window.setInterval(async () => {
      attempts += 1;
      if (attempts > 180) {
        if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current);
        cryptoTimerRef.current = null;
        setCryptoWaiting(false);
        showToast('Время оплаты истекло');
        return;
      }
      try {
        const initData = window.Telegram?.WebApp?.initData || '';
        const res = await fetch('/api/crypto/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, payload }) });
        const data = await res.json();
        if (data.status === 'paid') {
          if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current);
          cryptoTimerRef.current = null;
          setCryptoWaiting(false);
          hapticSuccess();
          setCryptoOpen(false);
          showToast('✅ Крипта зачислена');
          setTimeout(() => window.location.reload(), 800);
        }
      } catch {}
    }, 10000);
  }, [showToast]);

  const openNftWithdraw = useCallback(() => {
    hapticTap();
    if (balance === null || balance < 500) { hapticError(); showToast('Минимум 500 ⭐'); return; }
    setNftOpen(true);
  }, [balance, showToast]);

  const confirmNftWithdraw = useCallback(async () => {
    if (balance === null) return;
    setNftLoading(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/request-nft-withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, amount: balance }) });
      const data = await res.json();
      if (data.ok) {
        hapticSuccess();
        setBalance(data.newBalance);
        setNftOpen(false);
        showToast('🎁 Заявка создана');
      } else { hapticError(); showToast(data.error || 'Ошибка'); }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setNftLoading(false); }
  }, [balance, showToast]);

  const openPromo = useCallback(async () => {
    hapticTap();
    setPromoOpen(true);
    await loadPromoInfo();
  }, [loadPromoInfo]);

  const createPromo = useCallback(async () => {
    hapticTap();
    const initData = window.Telegram?.WebApp?.initData || '';
    setPromoLoading(true);
    try {
      const res = await fetch('/api/promo/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const data = await res.json();
      if (data.code) { hapticSuccess(); showToast(`Создан: ${data.code}`); await loadPromoInfo(); }
      else { hapticError(); showToast(data.error === 'too_many_active' ? 'Макс. 20' : 'Ошибка'); }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setPromoLoading(false); }
  }, [showToast, loadPromoInfo]);

  const redeemPromo = useCallback(async () => {
    hapticTap();
    const code = promoInput.trim().toUpperCase();
    if (!code) { hapticError(); showToast('Введи код'); return; }
    const initData = window.Telegram?.WebApp?.initData || '';
    setPromoLoading(true);
    try {
      const res = await fetch('/api/promo/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, code }) });
      const data = await res.json();
      if (data.ok) {
        hapticSuccess();
        showToast(data.message);
        setPromoInput('');
        const r2 = await fetch('/api/auth-telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
        const d2 = await r2.json();
        if (d2.profile) { setBalance(d2.profile.balance); setTickets(d2.profile.tickets || 0); }
        loadQuests();
      } else {
        hapticError();
        const map: Record<string, string> = { not_found: 'Код не найден', own_code: 'Нельзя свой', already_used: 'Уже использован', empty: 'Введи код' };
        showToast(map[data.error] || 'Ошибка');
      }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setPromoLoading(false); }
  }, [promoInput, showToast, loadQuests]);

  const openTicketCase = useCallback(async (caseId: string) => {
    hapticTap();
    const initData = window.Telegram?.WebApp?.initData || '';
    setTicketOpening(caseId);
    try {
      const res = await fetch('/api/tickets/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, caseId }) });
      const data = await res.json();
      if (data.error) { hapticError(); showToast(data.error === 'not_enough_tickets' ? 'Недостаточно билетов' : 'Ошибка'); return; }
      hapticSuccess();
      setTickets(data.newTickets);
      setBalance(data.newBalance);
      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
      showToast(`🎟 +${data.reward} ⭐`);
      loadQuests();
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setTicketOpening(null); }
  }, [showToast, loadQuests]);

  const user = getTelegramUser();

  const level = useMemo(() => {
    const LEVELS = [
      { level: 1, bets: 0 }, { level: 2, bets: 20 }, { level: 3, bets: 60 }, { level: 4, bets: 150 },
      { level: 5, bets: 300 }, { level: 6, bets: 600 }, { level: 7, bets: 1200 }, { level: 8, bets: 2500 },
      { level: 9, bets: 5000 }, { level: 10, bets: 10000 },
    ];
    let current = LEVELS[0];
    for (const l of LEVELS) { if (totalBets >= l.bets) current = l; else break; }
    const next = LEVELS[Math.min(current.level, LEVELS.length - 1)];
    return { current, next };
  }, [totalBets]);

  if (!profileReady || balance === null) {
    return <div className="app"><div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#fff', fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600 }}>Загрузка...</div></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="logo" onContextMenu={(e) => e.preventDefault()} onClick={() => { hapticTap(); setPage('home'); }}>
          <span>R</span><b>RITTERZONA</b>
        </button>
        <div className="balance">
          <small>{user?.first_name ?? 'Баланс'}</small>
          <strong className={syncing ? 'syncing' : ''}>{balance}</strong>
        </div>
      </header>

      <div key={page}>
        {page === 'home' && <Home balance={balance} history={history} liveWins={liveWins} level={level} streak={streak} totalBets={totalBets} setPage={setPage} onTopup={openTopup} onNftWithdraw={openNftWithdraw} onBonus={() => setPage('bonus')} />}
        {page === 'roulette' && <Roulette balance={balance} setPage={setPage} showToast={showToast} />}
        {page === 'rocket' && <Rocket setPage={setPage} showToast={showToast} />}
        {page === 'cases' && <Cases balance={balance} setPage={setPage} showToast={showToast} />}
        {page === 'mines' && <Mines setPage={setPage} showToast={showToast} />}
        {page === 'coinfly' && <Coinfly balance={balance} setPage={setPage} showToast={showToast} />}
        {page === 'quests' && <Quests quests={quests} setPage={setPage} onClaim={claimQuest} />}
        {page === 'tickets' && <Tickets tickets={tickets} cases={ticketCases} opening={ticketOpening} onOpen={openTicketCase} setPage={setPage} />}
        {page === 'bonus' && <Bonus tickets={tickets} onPromo={openPromo} onClaimBonus={claimDailyBonus} onTickets={() => setPage('tickets')} setPage={setPage} />}
      </div>

      <nav className="bottom-menu" key="bottom-menu">
        <button type="button" className={page === 'home' ? 'active' : ''} onClick={() => { hapticTap(); setPage('home'); }}><span>🏠</span>Главная</button>
        <button type="button" className={page === 'cases' ? 'active' : ''} onClick={() => { hapticTap(); setPage('cases'); }}><span>🎁</span>Кейсы</button>
        <button type="button" className={page === 'roulette' ? 'active' : ''} onClick={() => { hapticTap(); setPage('roulette'); }}><span>🎯</span>Рулетка</button>
        <button type="button" className={page === 'rocket' ? 'active' : ''} onClick={() => { hapticTap(); setPage('rocket'); }}><span>🚀</span>Ракета</button>
        <button type="button" className={page === 'mines' ? 'active' : ''} onClick={() => { hapticTap(); setPage('mines'); }}><span>💣</span>Сапёр</button>
        <button type="button" className={page === 'quests' ? 'active' : ''} onClick={() => { hapticTap(); setPage('quests'); }}><span>📋</span>Квесты</button>
        <button type="button" className={page === 'bonus' ? 'active' : ''} onClick={() => { hapticTap(); setPage('bonus'); }}><span>🎁</span>Бонусы</button>
      </nav>

      {topupOpen && (
        <div className="modal-overlay" onClick={() => setTopupOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setTopupOpen(false)}>✕</button>
            <div className="modal-emoji">💰</div>
            <h3>Пополнить баланс</h3>
            <p className="modal-sub">1 ⭐ = 2 ₽. Выбери способ оплаты.</p>
            <div className="topup-display"><span>+</span><b>{topupAmount}</b><span>⭐</span></div>
            <div className="topup-slider">
              <input type="range" min={10} max={5000} step={10} value={topupAmount} onChange={(e) => setTopupAmount(Number(e.target.value))} />
            </div>
            <div className="topup-quick">
              {[50, 100, 250, 500, 1000, 2500].map((v) => (
                <button type="button" key={v} className={topupAmount === v ? 'active' : ''} onClick={() => { hapticTap(); setTopupAmount(v); }}>{v} ⭐</button>
              ))}
            </div>
            <div className="topup-methods">
              <button type="button" className={`topup-method ${topupMethod === 'stars' ? 'selected' : ''}`} onClick={() => { hapticTap(); setTopupMethod('stars'); }}>
                <span className="topup-method-icon">⭐</span>
                <div><b>Telegram Stars</b><small>мгновенно · {topupAmount} ⭐</small></div>
              </button>
              <button type="button" className={`topup-method ${topupMethod === 'crypto' ? 'selected' : ''}`} onClick={() => { hapticTap(); setTopupMethod('crypto'); }}>
                <span className="topup-method-icon">💎</span>
                <div><b>CryptoBot</b><small>≈ {(topupAmount * 2 / 100).toFixed(2)} USDT</small></div>
              </button>
            </div>
            <button type="button" className="primary-button full" disabled={topupLoading} onClick={handleTopup}>
              {topupLoading ? 'Создаём счёт...' : topupMethod === 'stars' ? `Оплатить ${topupAmount * 2} ₽` : `Оплатить ≈ ${(topupAmount * 2 / 100).toFixed(2)} USDT`}
            </button>
          </div>
        </div>
      )}

      {cryptoOpen && cryptoData && (
        <div className="modal-overlay" onClick={() => { setCryptoOpen(false); if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current); cryptoTimerRef.current = null; }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => { setCryptoOpen(false); if (cryptoTimerRef.current !== null) window.clearInterval(cryptoTimerRef.current); cryptoTimerRef.current = null; }}>✕</button>
            <div className="modal-emoji">💎</div>
            <h3>Оплата CryptoBot</h3>
            <p className="modal-sub">К оплате: <b>{cryptoData.amountUsdt} USDT</b><br />Зачислим: <b>{cryptoData.amountStars} ⭐</b> ({cryptoData.amountRub} ₽)</p>
            <div className="crypto-info">
              <div className="crypto-row"><small>Сумма</small><b>{cryptoData.amountUsdt} USDT</b></div>
              <div className="crypto-row"><small>Сеть</small><b>TON / USDT</b></div>
            </div>
            {cryptoWaiting && <div className="crypto-waiting"><span className="crypto-spinner" />Ожидаем оплату...</div>}
            <button type="button" className="primary-button full" onClick={() => {
              if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(cryptoData.payUrl);
              else window.open(cryptoData.payUrl, '_blank');
            }}>Открыть счёт в CryptoBot</button>
          </div>
        </div>
      )}

      {nftOpen && (
        <div className="modal-overlay" onClick={() => setNftOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setNftOpen(false)}>✕</button>
            <div className="modal-emoji">🎁</div>
            <h3>Вывод NFT-подарком</h3>
            <p className="modal-sub">Мы переведём <b>NFT-подарок</b> из запаса. Заявка проходит ручную модерацию.</p>
            <div className="nft-summary"><div><small>К списанию</small><b>{balance} ⭐</b></div></div>
            <button type="button" className="primary-button full" disabled={nftLoading} onClick={confirmNftWithdraw}>{nftLoading ? 'Создаём...' : 'Подтвердить вывод'}</button>
            <button type="button" className="modal-cancel" onClick={() => setNftOpen(false)}>Отмена</button>
          </div>
        </div>
      )}

      {promoOpen && (
        <div className="modal-overlay" onClick={() => setPromoOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setPromoOpen(false)}>✕</button>
            <div className="modal-emoji">🎟</div>
            <h3>Промокоды</h3>
            <p className="modal-sub">Отправь другу — он получит <b>+5 ⭐</b>, ты — <b>+1 билет</b>.</p>
            <div className="promo-input-row">
              <input type="text" placeholder="RTR-XXXXXX" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} maxLength={10} />
              <button type="button" className="primary-button" disabled={promoLoading} onClick={redeemPromo}>Ввести</button>
            </div>
            <button type="button" className="primary-button full" disabled={promoLoading} onClick={createPromo}>Создать код</button>
            {promoList.length > 0 && (
              <div className="promo-list">
                {promoList.map((p) => (
                  <div key={p.code} className={`promo-row ${p.used ? 'used' : ''}`}>
                    <b>{p.code}</b>
                    <small>{p.used ? `✅ ${p.usedByUsername || p.usedByFirstName || 'активирован'}` : '⏳ не активирован'}</small>
                    {!p.used && <button type="button" onClick={async () => { await navigator.clipboard.writeText(p.code); showToast('Скопирован'); }}>📋</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast" key="toast">{toast}</div>}
    </div>
  );
}
/* =========================================================
   HOME
   ========================================================= */

function Home({
  balance, history, liveWins, level, streak, totalBets,
  setPage, onTopup, onNftWithdraw, onBonus,
}: {
  balance: number;
  history: HistoryItem[];
  liveWins: LiveWin[];
  level: { current: { level: number; bets: number }; next: { level: number; bets: number } };
  streak: number;
  totalBets: number;
  setPage: (page: Page) => void;
  onTopup: () => void;
  onNftWithdraw: () => void;
  onBonus: () => void;
}) {
  const nextBets = level.next.bets - level.current.bets;
  const currentProgress = totalBets - level.current.bets;
  const progress = nextBets > 0 ? Math.min(100, Math.floor((currentProgress / nextBets) * 100)) : 100;

  return (
    <main>
      <section className="hero">
        <span className="live">● LIVE · играй сейчас</span>
        <h1>Играй умнее.<br />Забирай больше.</h1>
        <p>Кейсы, рулетка, ракета, сапёр и монетка.</p>
        <button type="button" className="primary-button" onClick={() => { hapticTap(); setPage('cases'); }}>Открыть кейсы →</button>
      </section>

      <section className="level-card">
        <div className="level-header">
          <div><small>УРОВЕНЬ</small><strong>LVL {level.current.level}</strong></div>
          <div className="level-streak"><small>STREAK</small><strong>🔥 {streak} дн.</strong></div>
        </div>
        <div className="level-bar"><div className="level-bar-fill" style={{ width: `${progress}%` }} /></div>
        <div className="level-hint">{totalBets} / {level.next.bets} ставок до LVL {level.next.level}</div>
      </section>

      <section className="balance-card">
        <div><small>Текущий баланс</small><strong>{balance} ⭐</strong></div>
        <button type="button" onClick={() => { hapticTap(); onTopup(); }}>Пополнить</button>
      </section>

      <section className="bonus-card" onClick={onBonus}>
        <div><small>🎁 Бонусы</small><strong>Промокоды · Билеты · Streak</strong></div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onBonus(); }}>Открыть</button>
      </section>

      <section className="withdraw-card">
        <div><small>Вывод NFT подарком</small><strong>от 500 ⭐</strong></div>
        <button type="button" disabled={balance < 500} onClick={onNftWithdraw}>Вывести</button>
      </section>

      <h2>Мини-игры</h2>
      <div className="game-grid">
        <button type="button" onClick={() => { hapticTap(); setPage('cases'); }}>
          <span className="game-icon blue">🎁</span><b>Кейсы</b><small>Открывай награды</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('roulette'); }}>
          <span className="game-icon purple">🎯</span><b>Рулетка</b><small>Угадай цвет</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('rocket'); }}>
          <span className="game-icon orange">🚀</span><b>Ракета</b><small>Успей забрать</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('mines'); }}>
          <span className="game-icon green">💣</span><b>Сапёр</b><small>Открывай клетки</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('coinfly'); }}>
          <span className="game-icon orange">🪙</span><b>Монетка</b><small>Орёл или решка</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('tickets'); }}>
          <span className="game-icon purple">🎫</span><b>Билеты</b><small>Кейсы за билеты</small>
        </button>
      </div>

      {liveWins.length > 0 && (
        <>
          <h2>🔥 Крупные победы</h2>
          <div className="live-wins">
            {liveWins.slice(0, 8).map((w, i) => (
              <div className="live-win-row" key={i}>
                <span className="live-win-name">{w.username || 'Игрок'}</span>
                <small>{w.game}</small>
                <strong>+{w.amount} ⭐</strong>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>История игр</h2>
      <History history={history} />
    </main>
  );
}

/* =========================================================
   BONUS
   ========================================================= */

function Bonus({
  tickets, onPromo, onClaimBonus, onTickets, setPage,
}: {
  tickets: number;
  onPromo: () => void;
  onClaimBonus: () => void;
  onTickets: () => void;
  setPage: (page: Page) => void;
}) {
  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>BONUS</small>
        <h1>Бонусы</h1>
        <p>Промокоды, билеты, ежедневный streak.</p>
      </div>

      <section className="bonus-card" onClick={onPromo} style={{ marginTop: 16 }}>
        <div><small>🎟 Промокоды</small><strong>+1 билет за активацию</strong></div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onPromo(); }}>Открыть</button>
      </section>

      <section className="bonus-card" onClick={onTickets}>
        <div><small>🎫 Билеты</small><strong>{tickets} шт.</strong></div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onTickets(); }}>Кейсы</button>
      </section>

      <section className="bonus-card">
        <div><small>Daily streak</small><strong>1 билет за 7 дней</strong></div>
        <button type="button" onClick={() => { hapticTap(); onClaimBonus(); }}>Забрать</button>
      </section>
    </main>
  );
}

/* =========================================================
   ROULETTE
   ========================================================= */

function Roulette({
  balance, setPage, showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [selected, setSelected] = useState<Multiplier>(2);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Segment | null>(null);

  const [segments] = useState<Segment[]>(() =>
    shuffle(BASE_SEGMENTS).map((multiplier, index) => ({ id: index, multiplier, color: COLORS[multiplier] })),
  );

  const winnerRef = useRef<Segment | null>(null);
  const serverResultRef = useRef<{ winner: Segment; reward: number; delta: number; won: boolean } | null>(null);
  const segmentSize = 360 / segments.length;

  const counts = useMemo(() => ({
    2: segments.filter((i) => i.multiplier === 2).length,
    3: segments.filter((i) => i.multiplier === 3).length,
    5: segments.filter((i) => i.multiplier === 5).length,
    10: segments.filter((i) => i.multiplier === 10).length,
    30: segments.filter((i) => i.multiplier === 30).length,
  }), [segments]);

  const wheelGradient = useMemo(() => {
    const stops: string[] = [];
    segments.forEach((s, i) => {
      stops.push(`${s.color} ${i * segmentSize}deg ${(i + 1) * segmentSize}deg`);
    });
    return `conic-gradient(from ${-segmentSize / 2}deg, ${stops.join(', ')})`;
  }, [segments, segmentSize]);

  const startSpin = async () => {
    if (spinning) return;
    hapticTap();
    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));
    if (balance < safeBet) { hapticError(); showToast('Недостаточно ⭐'); return; }

    let winnerMultiplier: Multiplier | null = null;
    let serverReward = 0, serverDelta = 0, serverWon = false;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/roulette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, bet: safeBet, selected }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error === 'insufficient funds' ? 'Недостаточно ⭐' : 'Ошибка');
        return;
      }
      if (typeof data.newBalance === 'number') {
        window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
      }
      winnerMultiplier = data.winner;
      serverReward = data.reward ?? 0;
      serverDelta = data.delta ?? 0;
      serverWon = !!data.won;
    } catch { hapticError(); showToast('Ошибка сети'); return; }

    if (!winnerMultiplier) return;

    const candidates = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.multiplier === winnerMultiplier);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const winner = pick.s;
    winnerRef.current = winner;

    const centerOfWinner = (pick.i + 0.5) * segmentSize;
    const jitter = (Math.random() - 0.5) * (segmentSize * 0.4);
    const targetAngle = 360 - centerOfWinner + jitter;

    setRotation((current) => {
      const normalized = ((current % 360) + 360) % 360;
      let delta = targetAngle - normalized;
      delta = ((delta % 360) + 360) % 360;
      return current + 360 * 5 + delta;
    });

    serverResultRef.current = { winner, reward: serverReward, delta: serverDelta, won: serverWon };
    setResult(null);
    setSpinning(true);
  };

  const finishSpin = () => {
    if (!spinning) return;
    const serverData = serverResultRef.current;
    const winner = winnerRef.current;
    if (!winner || !serverData) { setSpinning(false); return; }

    setSpinning(false);
    setResult(winner);

    if (serverData.won) { hapticSuccess(); showToast(`Победа! +${serverData.reward} ⭐`); }
    else { hapticError(); showToast(`Выпал ${COLOR_NAMES[winner.multiplier]}`); }

    window.dispatchEvent(new CustomEvent('history-update', {
      detail: { game: 'Рулетка', text: `Выпал ${COLOR_NAMES[winner.multiplier]}`, amount: serverData.delta, win: serverData.won },
    }));
    serverResultRef.current = null;
  };

  const wheelStyle: CSSProperties = {
    transform: `translate3d(0, 0, 0) rotate(${rotation}deg)`,
    background: wheelGradient,
    transition: spinning ? 'transform 2.6s cubic-bezier(.16,.84,.18,1)' : 'none',
  };

  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>GAME 01</small>
        <h1>Рулетка</h1>
        <p>Выбери множитель и цвет.</p>
      </div>

      <section className="roulette-box">
        <div className="roulette-pointer" />
        <div className={`wheel ${spinning ? 'wheel-spinning' : ''}`} style={wheelStyle} onTransitionEnd={finishSpin}>
          {segments.map((s, i) => (
            <span key={`w-${i}-${s.multiplier}`} className="wheel-tick" style={{ transform: `rotate(${i * segmentSize}deg)` }} />
          ))}
          <div className="wheel-center">
            <b>R</b>
            <small>{spinning ? 'WAIT' : result ? `x${result.multiplier}` : 'SPIN'}</small>
          </div>
        </div>
        <div className="roulette-result">
          {result ? (<>Выпал <b style={{ color: result.color }}>{COLOR_NAMES[result.multiplier]}</b></>) : spinning ? 'Крутится...' : 'Сделай ставку'}
        </div>
      </section>

      <BetBox bet={bet} setBet={setBet} disabled={spinning} balance={balance} />

      <div className="color-buttons">
        {([2, 3, 5, 10, 30] as Multiplier[]).map((m) => (
          <button type="button" key={m} disabled={spinning}
            className={selected === m ? 'selected' : ''}
            style={{ borderColor: COLORS[m] }}
            onClick={() => { hapticTap(); setSelected(m); }}>
            <strong style={{ color: COLORS[m] }}>x{m}</strong>
            <small>{COLOR_NAMES[m]}</small>
            <em>{counts[m]}</em>
          </button>
        ))}
      </div>

      <div className="selected-text">
        Ставка на <b style={{ color: COLORS[selected] }}>{COLOR_NAMES[selected]}</b>{' · '}x{selected}
      </div>

      <button type="button" className="primary-button full"
        disabled={spinning || balance < Math.max(10, bet)} onClick={startSpin}>
        {spinning ? 'Колесо крутится...' : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>
    </main>
  );
}

/* =========================================================
   ROCKET
   ========================================================= */

const MIN_CASHOUT = 1.3;

function Rocket({
  setPage, showToast,
}: {
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [multiplier, setMultiplier] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [canCashOut, setCanCashOut] = useState(false);
  const [cashedOut, setCashedOut] = useState(false);
  const [crashed, setCrashed] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const crashTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const playingRef = useRef(false);
  const cashedOutRef = useRef(false);
  const multiplierRef = useRef(1);
  const startTimeRef = useRef(0);
  const roundRef = useRef(0);
  const roundTokenRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (crashTimerRef.current !== null) window.clearTimeout(crashTimerRef.current);
    intervalRef.current = null;
    crashTimerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; playingRef.current = false; clearTimers(); };
  }, [clearTimers]);

  const startRocket = async () => {
    if (playingRef.current || playing) return;
    hapticTap();
    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));

    let crashPoint = 1;
    let newBalance = 0;
    let roundToken = '';

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/rocket/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, bet: safeBet }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error === 'insufficient funds' ? 'Недостаточно ⭐' : 'Ошибка');
        return;
      }
      crashPoint = data.crashPoint;
      newBalance = data.newBalance;
      roundToken = data.roundToken;
      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: newBalance } }));
    } catch { hapticError(); showToast('Ошибка сети'); return; }

    clearTimers();
    const roundId = roundRef.current + 1;
    roundRef.current = roundId;
    multiplierRef.current = 1;
    startTimeRef.current = Date.now();
    playingRef.current = true;
    cashedOutRef.current = false;
    roundTokenRef.current = roundToken;
    setBet(safeBet);
    setMultiplier(1);
    setPlaying(true);
    setCanCashOut(false);
    setCashedOut(false);
    setCrashed(false);

    intervalRef.current = window.setInterval(() => {
      if (!mountedRef.current || !playingRef.current || roundRef.current !== roundId) return;
      const seconds = (Date.now() - startTimeRef.current) / 1000;
      const raw = Math.pow(1.06, seconds * 2.4);
      const next = Number(Math.min(crashPoint, raw).toFixed(2));
      multiplierRef.current = next;
      setMultiplier(next);
      if (next >= MIN_CASHOUT) setCanCashOut(true);
    }, 100);

    const crashDelay = Math.min(25000, Math.max(1500, (Math.log(crashPoint) / Math.log(1.06) / 2.4) * 1000));

    crashTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current || !playingRef.current || roundRef.current !== roundId) return;
      playingRef.current = false;
      clearTimers();
      setPlaying(false);
      setCanCashOut(false);
      setCrashed(true);
      setMultiplier(crashPoint);
      hapticError();
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: { game: 'Ракета', text: `Падение на x${crashPoint}`, amount: -safeBet, win: false },
      }));
      showToast(`Упала на x${crashPoint}`);
      roundTokenRef.current = null;
    }, crashDelay);
  };

  const cashOut = async () => {
    if (!playingRef.current) { showToast('Сначала запусти'); return; }
    if (!canCashOut) { hapticError(); showToast(`Минимум x${MIN_CASHOUT.toFixed(2)}`); return; }
    if (cashedOutRef.current) return;
    const currentMultiplier = multiplierRef.current;
    const token = roundTokenRef.current;
    if (!token) return;
    cashedOutRef.current = true;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/rocket/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, roundToken: token, multiplier: currentMultiplier }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error === 'crashed' ? `Упала на x${data.crashPoint}` : 'Ошибка');
        playingRef.current = false;
        clearTimers();
        setPlaying(false);
        setCanCashOut(false);
        setCrashed(true);
        roundTokenRef.current = null;
        return;
      }
      playingRef.current = false;
      clearTimers();
      setPlaying(false);
      setCanCashOut(false);
      setCashedOut(true);
      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
      hapticSuccess();
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: { game: 'Ракета', text: `Вывод на x${currentMultiplier.toFixed(2)}`, amount: data.delta, win: true },
      }));
      showToast(`Забрали ${data.reward} ⭐`);
      roundTokenRef.current = null;
    } catch { hapticError(); showToast('Ошибка сети'); }
  };

  const payout = Math.floor(bet * multiplier);

  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>GAME 02</small>
        <h1>Ракета</h1>
        <p>Забери выигрыш до падения.</p>
      </div>
      <button type="button" className="primary-button full rocket-start-btn"
        onClick={playing ? cashOut : startRocket}>
        {playing ? (canCashOut ? `Забрать ${payout} ⭐` : `Ждём x${MIN_CASHOUT.toFixed(2)}...`)
          : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>
      <section className="rocket-box">
        <div className="rocket-multiplier">x{multiplier.toFixed(2)}</div>
        <div className="rocket-payout">Выигрыш: <b>{payout} ⭐</b></div>
        <div className={playing ? 'rocket flying' : 'rocket'}>🚀</div>
        <div className="rocket-line" />
        <div className="rocket-info">
          {playing && !canCashOut && `Ждём x${MIN_CASHOUT.toFixed(2)}...`}
          {playing && canCashOut && 'Можно забрать'}
          {!playing && crashed && 'Упала'}
          {!playing && cashedOut && 'Забран'}
          {!playing && !crashed && !cashedOut && 'Нажми кнопку'}
        </div>
      </section>
      <BetBox bet={bet} setBet={setBet} disabled={playing} balance={0} />
    </main>
  );
}

/* =========================================================
   CASES
   ========================================================= */

function Cases({
  balance, setPage, showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
}) {
  const [selectedCase, setSelectedCase] = useState<GameCase>(CASES[0]);
  const [opening, setOpening] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [lastDelta, setLastDelta] = useState<number>(0);
  const [reel, setReel] = useState<Drop[]>([]);
  const [reelOffset, setReelOffset] = useState(0);
  const [boxRedirect, setBoxRedirect] = useState(false);

  const timerRef = useRef<number | null>(null);
  const reelRef = useRef<HTMLDivElement | null>(null);
  const openingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      openingRef.current = false;
    };
  }, []);

  const WINNER_INDEX = 48;
  const REEL_LENGTH = 60;

  const buildReel = (winner: Drop, pool: Drop[]): Drop[] => {
    const items: Drop[] = [];
    for (let i = 0; i < REEL_LENGTH; i += 1) {
      if (i === WINNER_INDEX) items.push(winner);
      else items.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return items;
  };

  const openCase = async () => {
    if (openingRef.current) return;
    if (balance < selectedCase.price) { hapticError(); showToast('Недостаточно ⭐'); return; }
    hapticTap();
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }

    let serverResult: any = null;
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const endpoint = selectedCase.id === 'box' ? '/api/box/open' : '/api/game/case';
      const body = selectedCase.id === 'box'
        ? { initData }
        : { initData, caseId: selectedCase.id };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      serverResult = await res.json();
      if (!res.ok || serverResult?.error) {
        hapticError();
        showToast(serverResult?.error === 'insufficient funds' ? 'Недостаточно ⭐' : 'Ошибка');
        return;
      }
    } catch { hapticError(); showToast('Ошибка сети'); return; }

    let finalDrop: Drop;
    if (selectedCase.id === 'box') {
      if (serverResult.type === 'ticket') {
        finalDrop = { id: 'box-ticket', name: 'Билет 🎟', icon: '🎟', price: 0, color: '#a855f7', rarity: 'epic' };
      } else if (serverResult.type === 'refund') {
        finalDrop = { id: 'box-refund', name: `${serverResult.reward} ⭐`, icon: '🪙', price: serverResult.reward, color: '#22d3ee', rarity: 'rare' };
      } else {
        finalDrop = { id: 'box-redirect', name: 'Пусто', icon: '💣', price: 0, color: '#8b98b8', rarity: 'common' };
      }
    } else {
      const sd = serverResult?.drop;
      finalDrop = sd
        ? { id: `${selectedCase.id}-${sd.name}`, name: sd.name, icon: sd.icon, price: sd.price, color: sd.color, rarity: sd.rarity || 'common' }
        : selectedCase.drops[0];
    }

    const items = buildReel(finalDrop, selectedCase.drops);
    openingRef.current = true;
    setOpening(true);
    setDrop(null);
    setLastDelta(0);
    setReel(items);
    setReelOffset(0);
    setBoxRedirect(false);

    requestAnimationFrame(() => {
      const reelEl = reelRef.current;
      if (!reelEl) return;
      const winnerElement = reelEl.querySelector(`[data-reel-index="${WINNER_INDEX}"]`) as HTMLElement | null;
      if (!winnerElement) return;
      const rr = reelEl.getBoundingClientRect();
      const wr = winnerElement.getBoundingClientRect();
      setReelOffset((rr.left + rr.width / 2) - (wr.left + wr.width / 2));
    });

    timerRef.current = window.setTimeout(() => {
      openingRef.current = false;
      timerRef.current = null;

      const delta = selectedCase.id === 'box'
        ? (serverResult.type === 'refund' ? serverResult.reward - 1 : -1)
        : (typeof serverResult?.delta === 'number' ? serverResult.delta : finalDrop.price - selectedCase.price);

      const newBalance = typeof serverResult?.newBalance === 'number' ? serverResult.newBalance : balance + delta;
      const isProfit = delta >= 0;

      setOpening(false);
      setDrop(finalDrop);
      setLastDelta(delta);

      if (selectedCase.id === 'box' && serverResult.type === 'redirect') setBoxRedirect(true);
      if (isProfit) hapticSuccess(); else hapticError();

      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: newBalance } }));
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: { game: selectedCase.name, text: `${finalDrop.name} — ${finalDrop.price} ⭐`, amount: delta, win: isProfit },
      }));

      const sign = delta > 0 ? '+' : '';
      showToast(isProfit ? `${finalDrop.name}: ${sign}${delta} ⭐` : `${finalDrop.name}: ${delta} ⭐`);
    }, 4200);
  };

  const isPremiumCase = selectedCase.price >= 1000;

  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>REWARDS</small>
        <h1>Кейсы</h1>
        <p>Открывай и получай награды.</p>
      </div>

      <div className="case-chips">
        {CASES.map((item) => (
          <button type="button" key={item.id}
            className={`case-chip ${selectedCase.id === item.id ? 'active' : ''}`}
            style={{ ['--chip-color' as string]: item.color, ['--chip-color-soft' as string]: `${item.color}33` }}
            disabled={opening}
            onClick={() => { hapticTap(); setSelectedCase(item); setDrop(null); setLastDelta(0); setReel([]); setReelOffset(0); setBoxRedirect(false); }}>
            <span className="case-chip-glow" style={{ background: item.color }} />
            <span className="case-chip-icon">
              <span className="case-chip-icon-top" style={{ background: lighten(item.color) }} />
              <span className="case-chip-icon-body" style={{ background: item.color }}>{item.id === 'box' ? '📦' : '🎁'}</span>
            </span>
            <b>{item.name}</b>
            <small>{item.price} ⭐</small>
          </button>
        ))}
      </div>

      <section className={`case-showcase-v2 ${isPremiumCase ? 'premium' : ''}`}>
        <div className="case-showcase-v2-bg" style={{ ['--case-color' as string]: selectedCase.color }} />

        <div className="case-hero">
          <div className="case-hero-badge">
            <span className="case-hero-badge-dot" style={{ background: selectedCase.color }} />
            {selectedCase.tagline}
          </div>
          <h2 className="case-hero-title" style={{ ['--case-color' as string]: selectedCase.color }}>{selectedCase.name}</h2>
          <div className="case-hero-meta">
            <span>Цена: <b>{selectedCase.price} ⭐</b></span>
          </div>
        </div>

        {opening && reel.length > 0 && (
          <div className="reel" ref={reelRef}>
            <div className="reel-line" />
            <div className="reel-track" style={{
              transform: `translate3d(${reelOffset}px, 0, 0)`,
              transition: opening ? 'transform 4s cubic-bezier(0.12, 0.8, 0.2, 1)' : 'none',
            }}>
              {reel.map((item, index) => (
                <div className={`reel-item rarity-${item.rarity}`} key={`${item.id}-${index}`} data-reel-index={index} style={{ ['--r-color' as string]: item.color }}>
                  <span style={{ fontSize: 32 }}>{item.icon}</span>
                  <b style={{ color: item.color }}>{item.price || '🎟'}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        {!opening && (
          <div className="case-visual">
            <div className="case-visual-floor" style={{ background: selectedCase.color }} />
            <div className="case-visual-glow" style={{ background: selectedCase.color }} />
            <div className="case-3d-lux" style={{ ['--case-color' as string]: selectedCase.color }}>
              <span className="case-3d-lux-shine" />
              <span className="case-3d-lux-lid" style={{ background: lighten(selectedCase.color) }} />
              <span className="case-3d-lux-body" style={{ background: selectedCase.color }}>
                <span className="case-3d-lux-logo">{selectedCase.id === 'box' ? '📦' : 'R'}</span>
              </span>
              <span className="case-3d-lux-side" />
              <span className="case-3d-lux-lock" />
            </div>
            <div className="case-visual-particles">
              {Array.from({ length: 12 }).map((_, i) => (
                <span key={i} className="case-particle" style={{ left: `${8 + i * 7.5}%`, animationDelay: `${i * 0.18}s`, background: selectedCase.color }} />
              ))}
            </div>
          </div>
        )}

        {opening && (
          <div className="case-status-v2"><span className="case-status-v2-dot" />Открываем...</div>
        )}

        {!opening && drop && (
          <div className={`drop-hero rarity-${drop.rarity}`} style={{ ['--r-color' as string]: drop.color }}>
            <span className="drop-hero-rarity" style={{ ['--r-color' as string]: drop.color }}>{RARITY_LABEL[drop.rarity]}</span>
            <span className="drop-hero-icon">{drop.icon}</span>
            <b className="drop-hero-name">{drop.name}</b>
            <div className="drop-hero-values">
              {drop.price > 0 && <span className="drop-hero-price" style={{ color: drop.color }}>+{drop.price} ⭐</span>}
              <span className={`drop-hero-delta ${lastDelta >= 0 ? 'positive' : 'negative'}`}>{lastDelta > 0 ? '+' : ''}{lastDelta} ⭐</span>
            </div>
            {boxRedirect && (
              <button type="button" className="primary-button full" onClick={() => { hapticTap(); setPage('mines'); }} style={{ marginTop: 8 }}>
                В Сапёр 💣
              </button>
            )}
          </div>
        )}

        {!opening && !drop && (
          <div className="case-status-v2 hint">Нажми «Открыть»</div>
        )}

        <button type="button" className="primary-button full case-open-btn" disabled={opening || balance < selectedCase.price} onClick={openCase}>
          {opening ? 'Открытие...' : `Открыть за ${selectedCase.price} ⭐`}
        </button>
      </section>

      <h2>Награды</h2>

      <div className="drops-v2">
        {selectedCase.drops.map((item) => (
          <div className={`drop-card rarity-${item.rarity}`} key={item.id} style={{ ['--r-color' as string]: item.color }}>
            <span className="drop-card-strip" />
            <span className="drop-card-rarity">{RARITY_LABEL[item.rarity]}</span>
            <span className="drop-card-icon">{item.icon}</span>
            <b className="drop-card-name">{item.name}</b>
            <div className="drop-card-footer">
              <span className="drop-card-chance" />
              <span className="drop-card-price">{item.price > 0 ? `${item.price} ⭐` : '🎟'}</span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
/* =========================================================
   MINES
   ========================================================= */

const MINES_FIELD_SIZE = 25;

function Mines({
  setPage, showToast,
}: {
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [minesCount, setMinesCount] = useState<3 | 5 | 7 | 10>(3);
  const [roundToken, setRoundToken] = useState<string | null>(null);
  const [opened, setOpened] = useState<number[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [potentialReward, setPotentialReward] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exploded, setExploded] = useState<number | null>(null);
  const [minePositions, setMinePositions] = useState<number[]>([]);
  const [gameEnded, setGameEnded] = useState(false);

  const resetGame = useCallback(() => {
    setRoundToken(null);
    setOpened([]);
    setMultiplier(1);
    setPotentialReward(0);
    setExploded(null);
    setMinePositions([]);
    setGameEnded(false);
  }, []);

  const startGame = async () => {
    if (busy) return;
    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));
    hapticTap();
    setBusy(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/mines/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, bet: safeBet, minesCount }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error === 'insufficient funds' ? 'Недостаточно ⭐' : 'Ошибка');
        return;
      }
      setBet(safeBet);
      setRoundToken(data.roundToken);
      setOpened([]);
      setMultiplier(1);
      setPotentialReward(0);
      setExploded(null);
      setMinePositions([]);
      setGameEnded(false);
      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setBusy(false); }
  };

  const openCell = async (cell: number) => {
    if (!roundToken || busy || gameEnded || opened.includes(cell) || exploded !== null) return;
    hapticTap();
    setBusy(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/mines/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, roundToken, cell }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error || 'Ошибка');
        return;
      }
      if (data.mine) {
        setExploded(cell);
        setMinePositions(data.minePositions || []);
        setGameEnded(true);
        setRoundToken(null);
        hapticError();
        window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
        window.dispatchEvent(new CustomEvent('history-update', {
          detail: { game: 'Сапёр', text: 'Взорвался', amount: data.delta, win: false },
        }));
        showToast('💥 Взорвался');
      } else {
        setOpened(data.opened);
        setMultiplier(data.multiplier);
        setPotentialReward(data.potentialReward);
        hapticSuccess();
      }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setBusy(false); }
  };

  const cashout = async () => {
    if (!roundToken || busy || opened.length === 0) return;
    hapticTap();
    setBusy(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/mines/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, roundToken }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error || 'Ошибка');
        return;
      }
      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: { game: 'Сапёр', text: `Забрал x${data.multiplier.toFixed(2)}`, amount: data.delta, win: true },
      }));
      hapticSuccess();
      showToast(`✅ +${data.reward} ⭐`);
      resetGame();
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setBusy(false); }
  };

  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>GAME 04</small>
        <h1>Сапёр</h1>
        <p>Открывай клетки и не попади на мину.</p>
      </div>

      <section className="mines-box">
        <div className="mines-stats">
          <div className="mines-stat"><small>Ставка</small><b>{bet} ⭐</b></div>
          <div className="mines-stat"><small>Множитель</small><b className="blue">x{multiplier.toFixed(2)}</b></div>
          <div className="mines-stat"><small>Выигрыш</small><b className="green">{potentialReward} ⭐</b></div>
        </div>

        {!roundToken && !gameEnded && (
          <div className="mines-setup">
            <div className="mines-mines-picker">
              {([
                { mines: 3,  label: 'Easy',    mult: 'x1.02' },
                { mines: 5,  label: 'Normal',  mult: 'x1.12' },
                { mines: 7,  label: 'Hard',    mult: 'x1.24' },
                { mines: 10, label: 'Hi-Risk', mult: 'x1.49' },
              ] as const).map((opt) => (
                <button type="button" key={opt.mines}
                  className={minesCount === opt.mines ? 'selected' : ''}
                  onClick={() => { hapticTap(); setMinesCount(opt.mines); }}>
                  <b>{opt.mines} 💣</b>
                  <small>{opt.label} · {opt.mult}</small>
                </button>
              ))}
            </div>
            <BetBox bet={bet} setBet={setBet} disabled={false} balance={0} />
            <button type="button" className="primary-button full" disabled={busy} onClick={startGame}>
              {busy ? 'Запуск...' : `Начать за ${Math.max(10, bet)} ⭐`}
            </button>
          </div>
        )}

        {(roundToken || gameEnded) && (
          <>
            <div className="mines-grid">
              {Array.from({ length: MINES_FIELD_SIZE }).map((_, i) => {
                const isOpened = opened.includes(i);
                const isExploded = exploded === i;
                const isMineShown = exploded !== null && minePositions.includes(i);

                let className = 'mines-cell';
                if (isExploded) className += ' mine';
                else if (isMineShown) className += ' mine-revealed';
                else if (isOpened) className += ' opened empty';

                return (
                  <button
                    key={i}
                    type="button"
                    className={className}
                    disabled={busy || isOpened || exploded !== null || !roundToken}
                    onClick={() => openCell(i)}
                  >
                    {isExploded ? '💥' : isMineShown ? '💣' : isOpened ? '💎' : ''}
                  </button>
                );
              })}
            </div>

            {roundToken && opened.length > 0 && (
              <button type="button" className="primary-button full" disabled={busy} onClick={cashout}>
                {busy ? 'Забираем...' : `Забрать ${potentialReward} ⭐`}
              </button>
            )}

            {gameEnded && (
              <button type="button" className="primary-button full" onClick={resetGame}>
                Играть снова
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

/* =========================================================
   COINFLY
   ========================================================= */

type CoinChoice = 'heads' | 'tails' | 'edge';

function Coinfly({
  balance, setPage, showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [choice, setChoice] = useState<CoinChoice>('heads');
  const [flipping, setFlipping] = useState(false);
  const [outcome, setOutcome] = useState<CoinChoice | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const startFlip = async () => {
    if (busy || flipping) return;
    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));
    if (balance < safeBet) { hapticError(); showToast('Недостаточно ⭐'); return; }

    hapticTap();
    setBusy(true);
    setOutcome(null);
    setWon(null);

    let serverOutcome: CoinChoice | null = null;
    let serverWon = false;
    let serverReward = 0;
    let serverNewBalance = 0;
    let serverDelta = 0;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/coinfly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, bet: safeBet, choice }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        hapticError();
        showToast(data.error === 'insufficient funds' ? 'Недостаточно ⭐' : 'Ошибка');
        setBusy(false);
        return;
      }
      serverOutcome = data.outcome;
      serverWon = !!data.won;
      serverReward = data.reward ?? 0;
      serverNewBalance = data.newBalance ?? 0;
      serverDelta = data.delta ?? 0;
    } catch { hapticError(); showToast('Ошибка сети'); setBusy(false); return; }

    setFlipping(true);

    setTimeout(() => {
      setFlipping(false);
      setOutcome(serverOutcome);
      setWon(serverWon);

      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: serverNewBalance } }));
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: {
          game: 'Монетка',
          text: `Выпало ${serverOutcome === 'heads' ? 'орёл' : serverOutcome === 'tails' ? 'решка' : 'ребро'}`,
          amount: serverDelta,
          win: serverWon,
        },
      }));

      if (serverWon) { hapticSuccess(); showToast(`Победа! +${serverReward} ⭐`); }
      else { hapticError(); showToast('Не угадал'); }

      setBusy(false);
    }, 1700);
  };

  const outcomeName = (o: CoinChoice | null) => o === 'heads' ? 'ОРЁЛ' : o === 'tails' ? 'РЕШКА' : o === 'edge' ? 'РЕБРО' : '';
  const outcomeColor = (o: CoinChoice | null) => o === 'heads' ? '#f59e0b' : o === 'tails' ? '#3b82f6' : o === 'edge' ? '#22c55e' : '#fff';

  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>GAME 05</small>
        <h1>Монетка</h1>
        <p>Орёл ×2 · Решка ×2 · Ребро ×9</p>
      </div>

      <section className="coinfly-box">
        <div className={`coin ${flipping ? 'flipping' : ''} ${outcome === 'edge' ? 'edge-mode' : ''}`}>
          <div className="coin-face">
            {outcome === null || flipping
              ? '🪙'
              : outcome === 'heads' ? '👑'
              : outcome === 'tails' ? '🦅'
              : '⚡'}
          </div>
        </div>

        {outcome && !flipping && (
          <div className="coinfly-result" style={{ color: outcomeColor(outcome) }}>
            {outcomeName(outcome)}
            {won && ' 🎉'}
          </div>
        )}
      </section>

      <BetBox bet={bet} setBet={setBet} disabled={flipping || busy} balance={balance} />

      <div className="coinfly-choices">
        <button type="button" disabled={flipping || busy} className={choice === 'heads' ? 'selected' : ''}
          onClick={() => { hapticTap(); setChoice('heads'); }}>
          <span className="emoji">👑</span><b>Орёл</b><small>x2</small>
        </button>
        <button type="button" disabled={flipping || busy} className={choice === 'tails' ? 'selected' : ''}
          onClick={() => { hapticTap(); setChoice('tails'); }}>
          <span className="emoji">🦅</span><b>Решка</b><small>x2</small>
        </button>
        <button type="button" disabled={flipping || busy} className={choice === 'edge' ? 'selected' : ''}
          onClick={() => { hapticTap(); setChoice('edge'); }}>
          <span className="emoji">⚡</span><b>Ребро</b><small>x9</small>
        </button>
      </div>

      <button type="button" className="primary-button full"
        disabled={flipping || busy || balance < Math.max(10, bet)}
        onClick={startFlip}>
        {flipping || busy ? 'Подбрасываем...' : `Подбросить за ${Math.max(10, bet)} ⭐`}
      </button>
    </main>
  );
}

/* =========================================================
   QUESTS
   ========================================================= */

function Quests({
  quests, setPage, onClaim,
}: {
  quests: Quest[];
  setPage: (page: Page) => void;
  onClaim: (id: string) => void;
}) {
  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>MISSIONS</small>
        <h1>Квесты</h1>
        <p>Выполняй задания и получай бонусы.</p>
      </div>

      <div className="quests-list">
        {quests.map((q) => {
          const progress = Math.min(q.progress, q.goal);
          const percent = Math.floor((progress / q.goal) * 100);
          const complete = progress >= q.goal;
          const disabled = !complete || q.claimed;
          return (
            <div className={`quest-row ${q.claimed ? 'claimed' : ''}`} key={q.id}>
              <div className="quest-info">
                <b>{q.name}</b>
                <small>{progress} / {q.goal}</small>
              </div>
              <div className="quest-bar">
                <div className="quest-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <button type="button" disabled={disabled} onClick={() => onClaim(q.id)}>
                {q.claimed ? '✅' : complete ? `+${q.reward} ⭐` : `${percent}%`}
              </button>
            </div>
          );
        })}
        {quests.length === 0 && <div className="empty">Квесты загружаются...</div>}
      </div>
    </main>
  );
}

/* =========================================================
   TICKETS
   ========================================================= */

function Tickets({
  tickets, cases, opening, onOpen, setPage,
}: {
  tickets: number;
  cases: TicketCase[];
  opening: string | null;
  onOpen: (id: string) => void;
  setPage: (page: Page) => void;
}) {
  return (
    <main>
      <BackButton setPage={setPage} />
      <div className="heading">
        <small>TICKETS</small>
        <h1>Билетные кейсы</h1>
        <p>У тебя <b style={{ color: '#60a5fa' }}>{tickets}</b> 🎟 билетов</p>
      </div>

      {cases.length === 0 && <div className="empty">Загрузка...</div>}

      <div className="drops-v2">
        {cases.map((c) => {
          const canOpen = tickets >= c.tickets;
          return (
            <div key={c.id} className="drop-card" style={{ ['--r-color' as string]: c.color }}>
              <span className="drop-card-strip" />
              <span className="drop-card-rarity">{c.tickets} 🎟</span>
              <span className="drop-card-icon">🎁</span>
              <b className="drop-card-name">{c.name}</b>
              <div className="drop-card-footer">
                <span className="drop-card-chance">{c.minReward}–{c.maxReward} ⭐</span>
                <span className="drop-card-price">{c.tickets} 🎟</span>
              </div>
              <button
                type="button"
                className="primary-button full"
                style={{ marginTop: 8, minHeight: 44, fontSize: 12 }}
                disabled={!canOpen || opening === c.id}
                onClick={() => onOpen(c.id)}
              >
                {opening === c.id ? 'Открываем...' : canOpen ? 'Открыть' : `Нужно ${c.tickets} 🎟`}
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
}

/* =========================================================
   BET BOX
   ========================================================= */

function BetBox({ bet, setBet, disabled, balance }: {
  bet: number;
  setBet: (value: number) => void;
  disabled: boolean;
  balance: number;
}) {
  const MIN_BET = 10;
  const [inputValue, setInputValue] = useState(String(bet));

  useEffect(() => { setInputValue(String(bet)); }, [bet]);

  const commitValue = (raw: string) => {
    if (raw === '' || raw === '-') { setBet(MIN_BET); setInputValue(String(MIN_BET)); return; }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_BET) { setBet(MIN_BET); setInputValue(String(MIN_BET)); return; }
    const clamped = Math.floor(parsed);
    setBet(clamped);
    setInputValue(String(clamped));
  };

  return (
    <section className="bet-box">
      <div className="bet-header">
        <span>Ставка</span>
        <b>{bet} ⭐</b>
      </div>
      <div className="bet-input-row">
        <button type="button" className="bet-step" disabled={disabled || bet <= MIN_BET}
          onClick={() => { hapticTap(); const next = Math.max(MIN_BET, bet - 10); setBet(next); setInputValue(String(next)); }}>−</button>
        <input type="text" inputMode="numeric" pattern="[0-9]*" value={inputValue} disabled={disabled}
          onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setInputValue(raw); }}
          onBlur={(e) => commitValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitValue((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }} />
        <button type="button" className="bet-step" disabled={disabled}
          onClick={() => { hapticTap(); const next = bet + 10; setBet(next); setInputValue(String(next)); }}>+</button>
      </div>
      <div className="bet-hint">Мин: {MIN_BET} ⭐ · Баланс: {balance} ⭐</div>
      <div className="quick-bets">
        {[10, 50, 100, 500].map((value) => (
          <button type="button" key={value} disabled={disabled || value > balance}
            className={bet === value ? 'active' : ''}
            onClick={() => { hapticTap(); const next = Math.max(MIN_BET, value); setBet(next); setInputValue(String(next)); }}>{value}</button>
        ))}
      </div>
      <div className="quick-bets">
        <button type="button" disabled={disabled || balance < MIN_BET}
          onClick={() => { hapticTap(); const next = Math.max(MIN_BET, Math.floor(balance / 2)); setBet(next); setInputValue(String(next)); }}>½</button>
        <button type="button" disabled={disabled || balance < MIN_BET}
          onClick={() => { hapticTap(); const next = Math.max(MIN_BET, balance); setBet(next); setInputValue(String(next)); }}>MAX</button>
      </div>
    </section>
  );
}

/* =========================================================
   BACK BUTTON / HISTORY
   ========================================================= */

function BackButton({ setPage }: { setPage: (page: Page) => void }) {
  return (
    <button type="button" className="back-button" onClick={() => { hapticTap(); setPage('home'); }}>
      ← Назад
    </button>
  );
}

function History({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) return <div className="empty">История пуста</div>;
  return (
    <div className="history">
      {history.map((item) => (
        <div className="history-row" key={item.id}>
          <span className={item.win ? 'win' : 'lose'}>{item.win ? '↗' : '↘'}</span>
          <div>
            <b>{item.game}</b>
            <small>{item.text}</small>
          </div>
          <strong className={item.amount >= 0 ? 'positive' : 'negative'}>
            {item.amount > 0 ? '+' : ''}{item.amount} ⭐
          </strong>
        </div>
      ))}
    </div>
  );
}

export default App;