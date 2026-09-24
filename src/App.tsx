import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { CSSProperties } from 'react';

import './appStyles.css';

import {
  hapticSuccess,
  hapticError,
  hapticTap,
  getTelegramUser,
  initTelegram,
} from './telegram';

type Page = 'home' | 'roulette' | 'rocket' | 'cases';

type Multiplier = 2 | 3 | 5 | 30;

type HistoryItem = {
  id: number;
  game: string;
  text: string;
  amount: number;
  win: boolean;
};

type Segment = {
  id: number;
  multiplier: Multiplier;
  color: string;
};

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

type Drop = {
  id: string;
  name: string;
  icon: string;
  price: number;
  chance: number;
  color: string;
  rarity: Rarity;
};

type GameCase = {
  id: string;
  name: string;
  price: number;
  color: string;
  tagline: string;
  drops: Drop[];
};

const COLORS: Record<Multiplier, string> = {
  2: '#929aaa',
  3: '#ef4862',
  5: '#3d94ff',
  30: '#ffd13b',
};

const COLOR_NAMES: Record<Multiplier, string> = {
  2: 'серый',
  3: 'красный',
  5: 'синий',
  30: 'жёлтый',
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
};

const BASE_SEGMENTS: Multiplier[] = [
  2, 3, 2, 3, 5, 2, 3, 2, 2, 3,
  5, 2, 3, 2, 2, 3, 5, 2, 3, 2,
  2, 5, 3, 2, 2, 3, 5, 2, 3, 2,
  30,
];

const CASES: GameCase[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    color: '#8b98b8',
    tagline: 'Первый шаг',
    drops: [
      { id: 'st1', name: 'Rusty Coin',   icon: '🪙', price: 4,   chance: 50, color: '#c7a56b', rarity: 'common' },
      { id: 'st2', name: 'Copper Ring',  icon: '💍', price: 10,  chance: 25, color: '#e0a35f', rarity: 'uncommon' },
      { id: 'st3', name: 'Small Gem',    icon: '🔹', price: 15,  chance: 15, color: '#6fd2ff', rarity: 'rare' },
      { id: 'st4', name: 'Silver Star',  icon: '⭐', price: 60,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'st5', name: 'Blue Crystal', icon: '💎', price: 500, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    price: 25,
    color: '#c07840',
    tagline: 'Медный век',
    drops: [
      { id: 'b1', name: 'Bronze Coin',    icon: '🪙', price: 15,   chance: 50, color: '#e0a35f', rarity: 'common' },
      { id: 'b2', name: 'Bronze Star',    icon: '⭐', price: 45,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'b3', name: 'Orange Crystal', icon: '🔶', price: 120,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'b4', name: 'Small Crown',    icon: '👑', price: 500,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'b5', name: 'Red Gem',        icon: '💎', price: 4000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'lucky',
    name: 'Lucky',
    price: 49,
    color: '#4ec97f',
    tagline: 'Удача на твоей стороне',
    drops: [
      { id: 'lk1', name: 'Lucky Coin',    icon: '🍀', price: 25,   chance: 50, color: '#8fd9a4', rarity: 'common' },
      { id: 'lk2', name: 'Green Gem',     icon: '💚', price: 80,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'lk3', name: 'Four Leaf',     icon: '🍀', price: 250,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'lk4', name: 'Golden Clover', icon: '🌟', price: 1200, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'lk5', name: 'JACKPOT',       icon: '💰', price: 5000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    price: 100,
    color: '#a8b8d6',
    tagline: 'Лунное серебро',
    drops: [
      { id: 's1', name: 'Silver Coin',  icon: '🪙', price: 50,    chance: 50, color: '#d4e0f0', rarity: 'common' },
      { id: 's2', name: 'Silver Star',  icon: '🌟', price: 180,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 's3', name: 'Blue Crystal', icon: '🔷', price: 500,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 's4', name: 'Silver Crown', icon: '👑', price: 2500,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 's5', name: 'Ice Gem',      icon: '💎', price: 12000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 250,
    color: '#ffd13b',
    tagline: 'Золото фараонов',
    drops: [
      { id: 'g1', name: 'Gold Coin',    icon: '🪙', price: 130,   chance: 50, color: '#ffe071', rarity: 'common' },
      { id: 'g2', name: 'Gold Star',    icon: '🌟', price: 450,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'g3', name: 'Gold Crystal', icon: '🔶', price: 1300,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'g4', name: 'Golden Crown', icon: '👑', price: 6000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'g5', name: 'Dragon Gem',   icon: '🐉', price: 30000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: 500,
    color: '#8fd7d7',
    tagline: 'Северное сияние',
    drops: [
      { id: 'p1', name: 'Platinum Chip',  icon: '💠', price: 260,   chance: 50, color: '#b8e8e8', rarity: 'common' },
      { id: 'p2', name: 'Platinum Star',  icon: '✨', price: 900,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'p3', name: 'Frost Crystal',  icon: '❄️', price: 2600,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'p4', name: 'Platinum Crown', icon: '👑', price: 12000, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'p5', name: 'Frozen Heart',   icon: '💎', price: 60000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    price: 1000,
    color: '#7fd4ff',
    tagline: 'Ледяное совершенство',
    drops: [
      { id: 'd1', name: 'Diamond Chip',  icon: '💎', price: 520,    chance: 50, color: '#a8e5ff', rarity: 'common' },
      { id: 'd2', name: 'Diamond Star',  icon: '⭐', price: 1800,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'd3', name: 'Aqua Gem',      icon: '🔷', price: 5200,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'd4', name: 'Diamond Crown', icon: '👑', price: 24000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'd5', name: 'Ocean Heart',   icon: '💠', price: 120000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'royal',
    name: 'Royal',
    price: 2500,
    color: '#b28fff',
    tagline: 'Королевский двор',
    drops: [
      { id: 'r1', name: 'Royal Chip',     icon: '🟣', price: 1300,   chance: 50, color: '#d4bfff', rarity: 'common' },
      { id: 'r2', name: 'Royal Star',     icon: '🌟', price: 4500,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'r3', name: 'Purple Crystal', icon: '🔮', price: 13000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'r4', name: 'Royal Crown',    icon: '👑', price: 60000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'r5', name: 'King Heart',     icon: '💜', price: 300000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    price: 5000,
    color: '#7a6bff',
    tagline: 'За гранью вселенной',
    drops: [
      { id: 'c1', name: 'Star Dust',      icon: '✨', price: 2600,   chance: 50, color: '#b3aaff', rarity: 'common' },
      { id: 'c2', name: 'Cosmic Gem',     icon: '🌌', price: 9000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'c3', name: 'Nebula Crystal', icon: '🌠', price: 26000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'c4', name: 'Galaxy Crown',   icon: '👑', price: 120000, chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'c5', name: 'Black Hole',     icon: '🕳️', price: 600000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'dragon',
    name: 'Dragon',
    price: 10000,
    color: '#ff7a3d',
    tagline: 'Пламя древних',
    drops: [
      { id: 'dr1', name: 'Dragon Scale', icon: '🐲', price: 5200,    chance: 50, color: '#ff9a6a', rarity: 'common' },
      { id: 'dr2', name: 'Dragon Claw',  icon: '🗡️', price: 18000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'dr3', name: 'Dragon Eye',   icon: '👁️', price: 52000,   chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'dr4', name: 'Dragon Crown', icon: '👑', price: 240000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'dr5', name: 'Dragon Heart', icon: '🐉', price: 1200000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
  {
    id: 'legendary',
    name: 'Legendary',
    price: 25000,
    color: '#ffd13b',
    tagline: 'Легенды не умирают',
    drops: [
      { id: 'lg1', name: 'Legend Chip',    icon: '🏅', price: 13000,   chance: 50, color: '#ffe071', rarity: 'common' },
      { id: 'lg2', name: 'Legend Star',    icon: '🌟', price: 45000,   chance: 25, color: '#55b3ff', rarity: 'uncommon' },
      { id: 'lg3', name: 'Legend Crystal', icon: '🔱', price: 130000,  chance: 15, color: '#42d1ff', rarity: 'rare' },
      { id: 'lg4', name: 'Legend Crown',   icon: '👑', price: 600000,  chance: 8,  color: '#c18bff', rarity: 'epic' },
      { id: 'lg5', name: 'GOD TIER',       icon: '💎', price: 3000000, chance: 2,  color: '#ffd13b', rarity: 'legendary' },
    ],
  },
];

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getRandomDrop(drops: Drop[]): Drop {
  const total = drops.reduce((sum, item) => sum + item.chance, 0);
  let random = Math.random() * total;
  for (const drop of drops) {
    random -= drop.chance;
    if (random <= 0) return drop;
  }
  return drops[drops.length - 1];
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

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [page, setPage] = useState<Page>('home');
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState(50);
  const [topupLoading, setTopupLoading] = useState(false);

  const [nftOpen, setNftOpen] = useState(false);
  const [nftLoading, setNftLoading] = useState(false);

  const [devMode, setDevMode] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const logoHoldRef = useRef<number | null>(null);

  useEffect(() => {
    initTelegram();

    // Активация dev-режима: либо ?dev=1 в URL, либо долгое нажатие на логотип
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1') {
      setDevMode(true);
      console.log('[dev] Dev mode enabled via URL');
    }
  }, []);

  useEffect(() => {
    function handleBalanceUpdate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.balance === 'number') setBalance(detail.balance);
    }
    function handleHistoryUpdate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.amount === 'number') {
        setHistory((items) =>
          [
            {
              id: Date.now() + Math.random(),
              game: detail.game,
              text: detail.text,
              amount: detail.amount,
              win: detail.win,
            },
            ...items,
          ].slice(0, 30),
        );
      }
    }
    window.addEventListener('balance-update', handleBalanceUpdate);
    window.addEventListener('history-update', handleHistoryUpdate);
    return () => {
      window.removeEventListener('balance-update', handleBalanceUpdate);
      window.removeEventListener('history-update', handleHistoryUpdate);
    };
  }, []);

  const showToast = useCallback((text: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(text);
    toastTimerRef.current = window.setTimeout(() => {
      setToast('');
      toastTimerRef.current = null;
    }, 2300);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (logoHoldRef.current !== null) window.clearTimeout(logoHoldRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      let initData = window.Telegram?.WebApp?.initData || '';
      const sdkAvailable = !!window.Telegram?.WebApp;
      if (sdkAvailable) {
        for (let attempt = 0; attempt < 6 && !initData; attempt += 1) {
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
        if (data.profile) { setBalance(data.profile.balance); setProfileReady(true); }
        else { setBalance(60); setProfileReady(true); }
      } catch {
        if (!cancelled) { setBalance(60); setProfileReady(true); }
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
        const res = await fetch('/api/history/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, limit: 30 }),
        });
        const data = await res.json();
        if (cancelled || !Array.isArray(data.items)) return;
        setHistory(
          data.items.map((item: any) => ({
            id: item.id, game: item.game, text: item.text,
            amount: item.amount, win: item.win,
          })),
        );
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [profileReady]);

  const changeBalance = useCallback(
    async (delta: number, reason = 'game'): Promise<boolean> => {
      if (balance === null) return false;
      if (delta < 0 && balance + delta < 0) {
        hapticError(); showToast('Недостаточно Stars'); return false;
      }
      const initData = window.Telegram?.WebApp?.initData || '';
      const prevBalance = balance;
      const optimistic = Math.max(0, balance + delta);
      setBalance(optimistic);
      setSyncing(true);
      try {
        const res = await fetch('/api/update-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData, delta, reason }),
        });
        const data = await res.json();
        if (!res.ok || typeof data.balance !== 'number') {
          setBalance(prevBalance);
          hapticError();
          showToast(data.error === 'insufficient funds' ? 'Недостаточно Stars' : 'Ошибка сервера');
          return false;
        }
        setBalance(data.balance);
        return true;
      } catch {
        setBalance(prevBalance);
        hapticError();
        showToast('Ошибка сети');
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [balance, showToast],
  );

  const addBalance = useCallback((amount: number) => { void changeBalance(amount, 'reward'); }, [changeBalance]);
  const removeBalance = useCallback(async (amount: number) => {
    if (balance === null) return false;
    if (balance < amount) {
      hapticError(); showToast('Недостаточно Stars'); return false;
    }
    return changeBalance(-amount, 'bet');
  }, [balance, changeBalance, showToast]);

  const addHistory = useCallback((game: string, text: string, amount: number, win: boolean) => {
    setHistory((items) => [{ id: Date.now() + Math.random(), game, text, amount, win }, ...items].slice(0, 30));
    const initData = window.Telegram?.WebApp?.initData || '';
    void fetch('/api/history/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, game, text, amount, win }),
    }).catch(() => {});
  }, []);

  /* ===== DEV: пополнение баланса ===== */

  const devTopup = useCallback(async () => {
    hapticTap();
    const DEV_AMOUNT = 100000;

    const ok = await changeBalance(DEV_AMOUNT, 'dev_topup');

    if (ok) {
      hapticSuccess();
      showToast(`👑 DEV +${DEV_AMOUNT} ⭐`);
    } else {
      hapticError();
      showToast('Не удалось пополнить');
    }
  }, [changeBalance, showToast]);

  const handleLogoPointerDown = useCallback(() => {
    if (logoHoldRef.current !== null) window.clearTimeout(logoHoldRef.current);
    logoHoldRef.current = window.setTimeout(() => {
      logoHoldRef.current = null;
      if (!devMode) {
        setDevMode(true);
        hapticSuccess();
        showToast('👑 Dev-режим включён');
      } else {
        setDevMode(false);
        showToast('Dev-режим выключен');
      }
    }, 1500); // держать 1.5 сек
  }, [devMode, showToast]);

  const handleLogoPointerUp = useCallback(() => {
    if (logoHoldRef.current !== null) {
      window.clearTimeout(logoHoldRef.current);
      logoHoldRef.current = null;
    }
  }, []);

  const claimDailyBonus = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData || '';
    setSyncing(true);
    try {
      const res = await fetch('/api/daily-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      const data = await res.json();
      if (data.balance) {
        setBalance(data.balance);
        hapticSuccess();
        showToast(`🎁 +${data.bonus} ⭐ ежедневный бонус`);
      } else if (data.error === 'already_claimed') {
        const hours = Math.ceil((data.nextAt - Date.now()) / 3600000);
        showToast(`Бонус через ${hours} ч`);
      } else showToast('Ошибка бонуса');
    } catch { showToast('Ошибка сети'); }
    finally { setSyncing(false); }
  }, [showToast]);

  const openTopup = useCallback(() => {
    hapticTap(); setTopupAmount(50); setTopupOpen(true);
  }, []);

  const handleTopup = useCallback(async () => {
    if (topupAmount < 10) { hapticError(); showToast('Минимум 10 Stars'); return; }
    setTopupLoading(true);
    try {
      const telegram = window.Telegram?.WebApp;
      const userId = telegram?.initDataUnsafe?.user?.id ?? 0;
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: topupAmount, userId }),
      });
      const data = await res.json();
      if (!data.invoiceLink) {
        hapticError();
        showToast(data.error || 'Ошибка создания счёта');
        return;
      }
      telegram?.openInvoice?.(data.invoiceLink, (status) => {
        if (status === 'paid') {
          hapticSuccess();
          addBalance(topupAmount);
          setTopupOpen(false);
          showToast(`✅ +${topupAmount} ⭐ зачислено`);
        } else if (status === 'cancelled') { hapticError(); showToast('Оплата отменена'); }
        else if (status === 'failed') { hapticError(); showToast('Оплата не прошла'); }
      });
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setTopupLoading(false); }
  }, [topupAmount, addBalance, showToast]);

  const openNftWithdraw = useCallback(() => {
    hapticTap();
    if (balance === null || balance < 500) {
      hapticError(); showToast('Минимум 500 ⭐ для вывода'); return;
    }
    setNftOpen(true);
  }, [balance, showToast]);

  const confirmNftWithdraw = useCallback(async () => {
    if (balance === null) return;
    setNftLoading(true);
    try {
      const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id ?? 0;
      const res = await fetch('/api/request-nft-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: balance }),
      });
      const data = await res.json();
      if (data.ok) {
        hapticSuccess();
        await changeBalance(-balance, 'nft_withdraw');
        setNftOpen(false);
        showToast('🎁 Заявка создана. Ожидайте подарок');
      } else { hapticError(); showToast(data.error || 'Ошибка заявки'); }
    } catch { hapticError(); showToast('Ошибка сети'); }
    finally { setNftLoading(false); }
  }, [balance, changeBalance, showToast]);

  const user = getTelegramUser();

  if (!profileReady || balance === null) {
    return (
      <div className="app">
        <div style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center',
          color: '#ffd13b', fontFamily: 'Orbitron, sans-serif',
          fontSize: 14, letterSpacing: '0.1em',
        }}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="logo"
          onPointerDown={handleLogoPointerDown}
          onPointerUp={handleLogoPointerUp}
          onPointerLeave={handleLogoPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => { hapticTap(); setPage('home'); }}
          title={devMode ? 'Dev-режим активен' : ''}
        >
          <span>R</span>
          <b>RITTERZONA</b>
          {devMode && <em className="logo-dev-badge">DEV</em>}
        </button>

        <div className="balance">
          <small>{user?.first_name ?? 'Баланс'}</small>
          <strong className={syncing ? 'syncing' : ''}>{balance} ⭐</strong>
        </div>
      </header>

      <div className="floating-balance" key="floating-balance">
        <span>⭐</span><b>{balance}</b>
        {syncing && <span className="sync-dot" />}
      </div>

      {devMode && (
        <button
          type="button"
          className="dev-topup-btn"
          onClick={devTopup}
        >
          👑 DEV +100 000 ⭐
        </button>
      )}

      <div key={page}>
        {page === 'home' && (
          <Home
            balance={balance}
            history={history}
            setPage={setPage}
            showToast={showToast}
            onTopup={openTopup}
            onNftWithdraw={openNftWithdraw}
            onClaimBonus={claimDailyBonus}
          />
        )}
        {page === 'roulette' && (
          <Roulette
            balance={balance}
            setPage={setPage}
            removeBalance={removeBalance}
            addBalance={addBalance}
            addHistory={addHistory}
            showToast={showToast}
          />
        )}
        {page === 'rocket' && (
          <Rocket
            balance={balance}
            removeBalance={removeBalance}
            onReward={addBalance}
            addHistory={addHistory}
            showToast={showToast}
          />
        )}
        {page === 'cases' && (
          <Cases balance={balance} setPage={setPage} showToast={showToast} />
        )}
      </div>

      <nav className="bottom-menu" key="bottom-menu">
        <button type="button" className={page === 'home' ? 'active' : ''} onClick={() => { hapticTap(); setPage('home'); }}>
          <span>⌂</span>Главная
        </button>
        <button type="button" className={page === 'roulette' ? 'active' : ''} onClick={() => { hapticTap(); setPage('roulette'); }}>
          <span>◉</span>Рулетка
        </button>
        <button type="button" className={page === 'rocket' ? 'active' : ''} onClick={() => { hapticTap(); setPage('rocket'); }}>
          <span>🚀</span>Ракета
        </button>
        <button type="button" className={page === 'cases' ? 'active' : ''} onClick={() => { hapticTap(); setPage('cases'); }}>
          <span>🎁</span>Кейсы
        </button>
      </nav>

      {topupOpen && (
        <div className="modal-overlay" onClick={() => setTopupOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setTopupOpen(false)}>✕</button>
            <div className="modal-emoji">⭐</div>
            <h3>Пополнить баланс</h3>
            <p className="modal-sub">Минимум <b>10 ⭐</b>. Оплата через Telegram Stars.</p>
            <div className="topup-display">
              <span>+</span><b>{topupAmount}</b><span>⭐</span>
            </div>
            <div className="topup-slider">
              <input type="range" min={10} max={1000} step={10} value={topupAmount}
                onChange={(e) => setTopupAmount(Number(e.target.value))} />
            </div>
            <div className="topup-quick">
              {[10, 25, 50, 100, 250, 500].map((v) => (
                <button type="button" key={v} className={topupAmount === v ? 'active' : ''}
                  onClick={() => { hapticTap(); setTopupAmount(v); }}>{v} ⭐</button>
              ))}
            </div>
            <button type="button" className="primary-button full" disabled={topupLoading} onClick={handleTopup}>
              {topupLoading ? 'Открываем оплату...' : `Оплатить ${topupAmount} ⭐`}
            </button>
          </div>
        </div>
      )}

      {nftOpen && (
        <div className="modal-overlay" onClick={() => setNftOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setNftOpen(false)}>✕</button>
            <div className="modal-emoji">🎁</div>
            <h3>Вывод NFT-подарком</h3>
            <p className="modal-sub">Мы переведём вам <b>NFT-подарок</b> из нашего запаса. Заявка обрабатывается в течение 24 часов.</p>
            <div className="nft-summary">
              <div><small>К списанию</small><b>{balance} ⭐</b></div>
            </div>
            <button type="button" className="primary-button full" disabled={nftLoading} onClick={confirmNftWithdraw}>
              {nftLoading ? 'Создаём заявку...' : 'Подтвердить вывод'}
            </button>
            <button type="button" className="modal-cancel" onClick={() => setNftOpen(false)}>Отмена</button>
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
  balance, history, setPage, showToast, onTopup, onNftWithdraw, onClaimBonus,
}: {
  balance: number;
  history: HistoryItem[];
  setPage: (page: Page) => void;
  showToast: (text: string) => void;
  onTopup: () => void;
  onNftWithdraw: () => void;
  onClaimBonus: () => void;
}) {
  return (
    <main>
      <section className="hero">
        <span className="live">● LIVE · 1 284 игроков</span>
        <h1>Играй умнее.<br />Забирай больше.</h1>
        <p>Рулетка, ракета и кейсы<br />в одном игровом пространстве.</p>
        <button type="button" className="primary-button" onClick={() => { hapticTap(); setPage('roulette'); }}>
          Начать игру →
        </button>
        <div className="hero-letter">R</div>
      </section>

      <section className="balance-card">
        <div><small>Текущий баланс</small><strong>{balance} ⭐</strong></div>
        <button type="button" onClick={() => { hapticTap(); onTopup(); }}>⭐ Пополнить</button>
      </section>

      <section className="bonus-card">
        <div><small>Ежедневный бонус</small><strong>+25 ⭐</strong></div>
        <button type="button" onClick={() => { hapticTap(); onClaimBonus(); }}>🎁 Забрать</button>
      </section>

      <section className="withdraw-card">
        <div><small>Вывод NFT подарком</small><strong>от 500 ⭐</strong></div>
        <button type="button" disabled={balance < 500} onClick={onNftWithdraw}>🎁 Вывести</button>
      </section>

      <h2>Мини-игры</h2>
      <div className="game-grid">
        <button type="button" onClick={() => { hapticTap(); setPage('roulette'); }}>
          <span className="game-icon purple">🎯</span><b>Рулетка</b><small>Выбери множитель и цвет</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('rocket'); }}>
          <span className="game-icon orange">🚀</span><b>Ракета</b><small>Забери выигрыш до падения</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); setPage('cases'); }}>
          <span className="game-icon blue">🎁</span><b>Кейсы</b><small>Открывай награды</small>
        </button>
        <button type="button" onClick={() => { hapticTap(); showToast(`Игр сыграно: ${history.length}`); }}>
          <span className="game-icon green">🕘</span><b>История</b><small>Последние результаты</small>
        </button>
      </div>

      <h2>История игр</h2>
      <History history={history} />
    </main>
  );
}

/* =========================================================
   ROULETTE — исход определяет сервер
   ========================================================= */

function Roulette({
  balance, setPage, removeBalance, addBalance, addHistory, showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  removeBalance: (amount: number) => Promise<boolean>;
  addBalance: (amount: number) => void;
  addHistory: (game: string, text: string, amount: number, win: boolean) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [selected, setSelected] = useState<Multiplier>(2);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Segment | null>(null);

  const [segments] = useState<Segment[]>(() =>
    shuffle(BASE_SEGMENTS).map((multiplier, index) => ({
      id: index, multiplier, color: COLORS[multiplier],
    })),
  );

  const winnerRef = useRef<Segment | null>(null);
  const betRef = useRef(10);
  const selectedRef = useRef<Multiplier>(2);
  const segmentSize = 360 / segments.length;

  const counts = useMemo(() => ({
    2: segments.filter((i) => i.multiplier === 2).length,
    3: segments.filter((i) => i.multiplier === 3).length,
    5: segments.filter((i) => i.multiplier === 5).length,
    30: segments.filter((i) => i.multiplier === 30).length,
  }), [segments]);

  const wheelGradient = useMemo(() => {
    const stops: string[] = [];
    segments.forEach((segment, index) => {
      const start = index * segmentSize;
      const end = (index + 1) * segmentSize;
      stops.push(`${segment.color} ${start}deg ${end}deg`);
    });
    return `conic-gradient(from ${-segmentSize / 2}deg, ${stops.join(', ')})`;
  }, [segments, segmentSize]);

  const startSpin = async () => {
    if (spinning) return;
    hapticTap();

    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));

    if (balance < safeBet) {
      hapticError();
      showToast('Недостаточно Stars');
      return;
    }

    let winnerMultiplier: Multiplier | null = null;

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
        showToast(data.error === 'insufficient funds' ? 'Недостаточно Stars' : 'Ошибка сервера');
        return;
      }

      if (typeof data.newBalance === 'number') {
        window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: data.newBalance } }));
      }

      winnerMultiplier = data.winner as Multiplier;
    } catch {
      hapticError();
      showToast('Ошибка сети');
      return;
    }

    if (!winnerMultiplier) return;

    const candidates = segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.multiplier === winnerMultiplier);

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const winnerIndex = pick.i;
    const winner = pick.s;

    winnerRef.current = winner;
    betRef.current = safeBet;
    selectedRef.current = selected;

    const centerOfWinner = (winnerIndex + 0.5) * segmentSize;
    const jitter = (Math.random() - 0.5) * (segmentSize * 0.4);
    const targetAngle = 360 - centerOfWinner + jitter;

    setRotation((current) => {
      const normalized = ((current % 360) + 360) % 360;
      let delta = targetAngle - normalized;
      delta = ((delta % 360) + 360) % 360;
      return current + 360 * 5 + delta;
    });

    setResult(null);
    setSpinning(true);
  };

  const finishSpin = () => {
    if (!spinning) return;
    const winner = winnerRef.current;
    if (!winner) { setSpinning(false); return; }

    const betAmount = betRef.current;
    const sel = selectedRef.current;
    const won = winner.multiplier === sel;
    const reward = won ? Math.floor(betAmount * winner.multiplier) : 0;
    const delta = won ? reward - betAmount : -betAmount;

    setSpinning(false);
    setResult(winner);

    if (won) { hapticSuccess(); showToast(`Победа! +${reward} ⭐`); }
    else { hapticError(); showToast(`Выпал ${COLOR_NAMES[winner.multiplier]} цвет`); }

    addHistory(
      'Рулетка',
      `Выпал ${COLOR_NAMES[winner.multiplier]} (x${winner.multiplier})`,
      delta,
      won,
    );
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
        <p>Выбери множитель и цвет.<br />Все линии перемешаны случайно.</p>
      </div>

      <section className="roulette-box">
        <div className="roulette-pointer" />
        <div className={`wheel ${spinning ? 'wheel-spinning' : ''}`} style={wheelStyle} onTransitionEnd={finishSpin}>
          {segments.map((segment, index) => (
            <span key={`wheel-${index}-${segment.multiplier}`} className="wheel-tick"
              style={{ transform: `rotate(${index * segmentSize}deg)` }} />
          ))}
          <div className="wheel-center">
            <b>R</b>
            <small>{spinning ? 'WAIT' : result ? `x${result.multiplier}` : 'SPIN'}</small>
          </div>
        </div>
        <div className="roulette-result">
          {result ? (<>Выпал <b style={{ color: result.color }}>{COLOR_NAMES[result.multiplier]}</b></>)
            : spinning ? 'Колесо вращается...' : 'Сделай ставку'}
        </div>
      </section>

      <BetBox bet={bet} setBet={setBet} disabled={spinning} balance={balance} />

      <div className="color-buttons">
        {([2, 3, 5, 30] as Multiplier[]).map((multiplier) => (
          <button type="button" key={multiplier} disabled={spinning}
            className={selected === multiplier ? 'selected' : ''}
            style={{ borderColor: COLORS[multiplier] }}
            onClick={() => { hapticTap(); setSelected(multiplier); }}>
            <strong style={{ color: COLORS[multiplier] }}>x{multiplier}</strong>
            <small>{COLOR_NAMES[multiplier]}</small>
            <em>{counts[multiplier]} линий</em>
          </button>
        ))}
      </div>

      <div className="selected-text">
        Ставка на <b style={{ color: COLORS[selected] }}>{COLOR_NAMES[selected]} цвет</b>
        {' · '}выигрыш x{selected}
      </div>

      <button type="button" className="primary-button full"
        disabled={spinning || balance < Math.max(10, bet)} onClick={startSpin}>
        {spinning ? 'Колесо вращается...' : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>
    </main>
  );
}

/* =========================================================
   ROCKET
   ========================================================= */

const MIN_CASHOUT = 1.3;

function Rocket({
  balance, removeBalance, onReward, addHistory, showToast,
}: {
  balance: number;
  removeBalance: (amount: number) => Promise<boolean>;
  onReward: (amount: number) => void;
  addHistory: (game: string, text: string, amount: number, win: boolean) => void;
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
  const betRef = useRef(10);
  const startTimeRef = useRef(0);
  const roundRef = useRef(0);

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

  const getCrashPoint = () => {
    const random = Math.random();
    const crash = 0.97 / (1 - random + 0.0001);
    return Math.min(Math.max(Number(crash.toFixed(2)), 1.3), 2000);
  };

  const startRocket = async () => {
    if (playingRef.current || playing) return;
    hapticTap();
    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));
    const ok = await removeBalance(safeBet);
    if (!ok) return;
    clearTimers();
    const roundId = roundRef.current + 1;
    roundRef.current = roundId;
    const crashPoint = getCrashPoint();
    betRef.current = safeBet;
    multiplierRef.current = 1;
    startTimeRef.current = Date.now();
    playingRef.current = true;
    cashedOutRef.current = false;
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
      addHistory('Ракета', `Падение на x${crashPoint}`, -safeBet, false);
      showToast(`Ракета упала на x${crashPoint}`);
    }, crashDelay);
  };

  const cashOut = () => {
    if (!playingRef.current) { showToast('Сначала запусти ракету'); return; }
    if (!canCashOut) {
      hapticError();
      showToast(`Минимум для вывода: x${MIN_CASHOUT.toFixed(2)}`);
      return;
    }
    if (cashedOutRef.current) return;
    const currentMultiplier = multiplierRef.current;
    const reward = Math.floor(betRef.current * currentMultiplier);
    cashedOutRef.current = true;
    playingRef.current = false;
    clearTimers();
    setPlaying(false);
    setCanCashOut(false);
    setCashedOut(true);
    onReward(reward);
    hapticSuccess();
    addHistory('Ракета', `Вывод на x${currentMultiplier.toFixed(2)}`, reward - betRef.current, true);
    showToast(`Вы забрали ${reward} ⭐`);
  };

  const payout = Math.floor(bet * multiplier);

  return (
    <main>
      <div className="heading">
        <small>GAME 02</small>
        <h1>Ракета</h1>
        <p>Запусти ракету и забери выигрыш до падения.</p>
      </div>
      <button type="button" className="primary-button full rocket-start-btn"
        disabled={playing ? !canCashOut : balance < Math.max(10, bet)}
        onClick={playing ? cashOut : startRocket}>
        {playing ? (canCashOut ? `Забрать ${payout} ⭐` : `Ждём x${MIN_CASHOUT.toFixed(2)}...`)
          : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>
      <section className="rocket-box">
        <div className="rocket-multiplier">x{multiplier.toFixed(2)}</div>
        <div className="rocket-payout">Текущий выигрыш: <b>{payout} ⭐</b></div>
        <div className={playing ? 'rocket flying' : 'rocket'}>🚀</div>
        <div className="rocket-line" />
        <div className="rocket-info">
          {playing && !canCashOut && `Ждём x${MIN_CASHOUT.toFixed(2)}...`}
          {playing && canCashOut && 'Можно забрать выигрыш'}
          {!playing && crashed && 'Ракета упала'}
          {!playing && cashedOut && 'Выигрыш забран'}
          {!playing && !crashed && !cashedOut && 'Нажмите кнопку запуска'}
        </div>
      </section>
      <BetBox bet={bet} setBet={setBet} disabled={playing} balance={balance} />
    </main>
  );
}

/* =========================================================
   CASES — каждый дроп в своём цвете редкости
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
      else items.push(getRandomDrop(pool));
    }
    return items;
  };

  const openCase = async () => {
    if (openingRef.current) return;
    if (balance < selectedCase.price) {
      hapticError(); showToast('Недостаточно Stars'); return;
    }
    hapticTap();
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }

    const localDrop = getRandomDrop(selectedCase.drops);
    const items = buildReel(localDrop, selectedCase.drops);
    openingRef.current = true;
    setOpening(true);
    setDrop(null);
    setLastDelta(0);
    setReel(items);
    setReelOffset(0);

    let serverResult: {
      drop?: Drop;
      delta?: number;
      newBalance?: number;
      error?: string;
    } | null = null;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/game/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, caseId: selectedCase.id }),
      });
      serverResult = await res.json();
      if (!res.ok || serverResult?.error) {
        openingRef.current = false;
        setOpening(false);
        setReel([]);
        setReelOffset(0);
        hapticError();
        showToast(serverResult?.error === 'insufficient funds' ? 'Недостаточно Stars' : 'Ошибка сервера');
        return;
      }
    } catch {
      openingRef.current = false;
      setOpening(false);
      setReel([]);
      setReelOffset(0);
      hapticError();
      showToast('Ошибка сети');
      return;
    }

    requestAnimationFrame(() => {
      const reelEl = reelRef.current;
      if (!reelEl) return;
      const winnerElement = reelEl.querySelector(`[data-reel-index="${WINNER_INDEX}"]`) as HTMLElement | null;
      if (!winnerElement) return;
      const reelRect = reelEl.getBoundingClientRect();
      const winnerRect = winnerElement.getBoundingClientRect();
      const reelCenter = reelRect.left + reelRect.width / 2;
      const winnerCenter = winnerRect.left + winnerRect.width / 2;
      setReelOffset(reelCenter - winnerCenter);
    });

    timerRef.current = window.setTimeout(() => {
      openingRef.current = false;
      timerRef.current = null;

      const serverDrop = serverResult?.drop;
      const finalDrop: Drop = serverDrop
        ? {
            id: `${selectedCase.id}-${serverDrop.name}`,
            name: serverDrop.name,
            icon: serverDrop.icon,
            price: serverDrop.price,
            chance: serverDrop.chance,
            color: serverDrop.color,
            rarity: serverDrop.rarity || 'common',
          }
        : localDrop;

      const delta = typeof serverResult?.delta === 'number'
        ? serverResult.delta
        : finalDrop.price - selectedCase.price;

      const newBalance = typeof serverResult?.newBalance === 'number'
        ? serverResult.newBalance
        : balance + delta;

      const isProfit = delta >= 0;
      setOpening(false);
      setDrop(finalDrop);
      setLastDelta(delta);

      if (isProfit) hapticSuccess();
      else hapticError();

      window.dispatchEvent(new CustomEvent('balance-update', { detail: { balance: newBalance } }));
      window.dispatchEvent(new CustomEvent('history-update', {
        detail: {
          game: selectedCase.name,
          text: `${finalDrop.name} — ${finalDrop.price} ⭐`,
          amount: delta,
          win: isProfit,
        },
      }));

      const sign = delta > 0 ? '+' : '';
      showToast(isProfit ? `${finalDrop.name}: ${sign}${delta} ⭐` : `${finalDrop.name}: ${delta} ⭐`);
    }, 4200);
  };

  const isPremiumCase = selectedCase.price >= 1000;
  const ev = selectedCase.drops.reduce((sum, d) => sum + (d.price * d.chance) / 100, 0);
  const rtp = Math.round((ev / selectedCase.price) * 100);

  return (
    <main>
      <BackButton setPage={setPage} />

      <div className="heading">
        <small>REWARDS</small>
        <h1>Кейсы</h1>
        <p>Открывай кейсы и получай случайные награды.</p>
      </div>

      <div className="case-chips">
        {CASES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`case-chip ${selectedCase.id === item.id ? 'active' : ''}`}
            style={{
              ['--chip-color' as string]: item.color,
              ['--chip-color-soft' as string]: `${item.color}33`,
            }}
            disabled={opening}
            onClick={() => {
              hapticTap();
              setSelectedCase(item);
              setDrop(null);
              setLastDelta(0);
              setReel([]);
              setReelOffset(0);
            }}
          >
            <span className="case-chip-glow" style={{ background: item.color }} />
            <span className="case-chip-icon">
              <span className="case-chip-icon-top" style={{ background: lighten(item.color) }} />
              <span className="case-chip-icon-body" style={{ background: item.color }}>🎁</span>
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
          <h2 className="case-hero-title" style={{ ['--case-color' as string]: selectedCase.color }}>
            {selectedCase.name}
          </h2>
          <div className="case-hero-meta">
            <span>Цена: <b>{selectedCase.price} ⭐</b></span>
            <span className="case-hero-meta-sep">·</span>
            <span>Возврат: <b className="rtp">{rtp}%</b></span>
          </div>
        </div>

        {opening && reel.length > 0 && (
          <div className="reel" ref={reelRef}>
            <div className="reel-line" />
            <div
              className="reel-track"
              style={{
                transform: `translate3d(${reelOffset}px, 0, 0)`,
                transition: opening ? 'transform 4s cubic-bezier(0.12, 0.8, 0.2, 1)' : 'none',
              }}
            >
              {reel.map((item, index) => (
                <div
                  className={`reel-item rarity-${item.rarity}`}
                  key={`${item.id}-${index}`}
                  data-reel-index={index}
                  style={{ ['--r-color' as string]: item.color }}
                >
                  <span>{item.icon}</span>
                  <b style={{ color: item.color }}>{item.price}</b>
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
                <span className="case-3d-lux-logo">R</span>
              </span>
              <span className="case-3d-lux-side" />
              <span className="case-3d-lux-lock" />
            </div>
            <div className="case-visual-particles">
              {Array.from({ length: 12 }).map((_, i) => (
                <span
                  key={i}
                  className="case-particle"
                  style={{
                    left: `${8 + i * 7.5}%`,
                    animationDelay: `${i * 0.18}s`,
                    background: selectedCase.color,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {opening && (
          <div className="case-status-v2">
            <span className="case-status-v2-dot" />
            Открываем кейс...
          </div>
        )}

        {!opening && drop && (
          <div
            className={`drop-hero rarity-${drop.rarity} ${lastDelta >= 0 ? 'win' : 'lose'}`}
            style={{ ['--r-color' as string]: drop.color }}
          >
            <span className="drop-hero-burst" style={{ background: drop.color }} />
            <span className="drop-hero-ring" style={{ borderColor: drop.color }} />
            <span className="drop-hero-ring drop-hero-ring-2" style={{ borderColor: drop.color }} />

            <span className="drop-hero-rarity" style={{ ['--r-color' as string]: drop.color }}>
              {RARITY_LABEL[drop.rarity]}
            </span>

            <span className="drop-hero-icon">{drop.icon}</span>
            <b className="drop-hero-name">{drop.name}</b>

            <div className="drop-hero-values">
              <span className="drop-hero-price" style={{ color: drop.color }}>
                +{drop.price} ⭐
              </span>
              <span className={`drop-hero-delta ${lastDelta >= 0 ? 'positive' : 'negative'}`}>
                {lastDelta > 0 ? '+' : ''}{lastDelta} ⭐
              </span>
            </div>
          </div>
        )}

        {!opening && !drop && (
          <div className="case-status-v2 hint">Нажми «Открыть», чтобы начать</div>
        )}

        <button
          type="button"
          className="primary-button full case-open-btn"
          disabled={opening || balance < selectedCase.price}
          onClick={openCase}
        >
          {opening ? 'Открытие...' : `Открыть за ${selectedCase.price} ⭐`}
        </button>
      </section>

      <h2>Возможные награды</h2>

      <div className="drops-v2">
        {selectedCase.drops.map((item) => (
          <div
            className={`drop-card rarity-${item.rarity}`}
            key={item.id}
            style={{ ['--r-color' as string]: item.color }}
          >
            <span className="drop-card-strip" />
            <span className="drop-card-glow" />

            <span className="drop-card-rarity">
              {RARITY_LABEL[item.rarity]}
            </span>

            <span className="drop-card-icon">
              {item.icon}
            </span>

            <b className="drop-card-name">{item.name}</b>

            <div className="drop-card-footer">
              <span className="drop-card-chance">{item.chance}%</span>
              <span className="drop-card-price">
                {item.price} ⭐
              </span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

/* =========================================================
   BET BOX / BACK BUTTON / HISTORY
   ========================================================= */

function BetBox({
  bet, setBet, disabled, balance,
}: {
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
        <span>Размер ставки</span>
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
      <div className="bet-hint">Минимум: {MIN_BET} ⭐ · Баланс: {balance} ⭐</div>
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

function BackButton({ setPage }: { setPage: (page: Page) => void }) {
  return (
    <button type="button" className="back-button" onClick={() => { hapticTap(); setPage('home'); }}>
      ← На главную
    </button>
  );
}

function History({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) return <div className="empty">История игр пока пустая</div>;
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