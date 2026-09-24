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

type Drop = {
  id: string;
  name: string;
  icon: string;
  price: number;
  chance: number;
  color: string;
};

type GameCase = {
  id: string;
  name: string;
  price: number;
  color: string;
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

const BASE_SEGMENTS: Multiplier[] = [
  2, 3, 2, 5, 2, 3, 2, 2,
  5, 3, 2, 30, 2, 3, 5, 2,
  3, 2, 2, 5, 3, 2, 3, 2,
  5, 2, 3, 2, 2, 3, 2,
];

const CASES: GameCase[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    color: '#5c6b8a',
    drops: [
      { id: 'st1', name: 'Rusty Coin', icon: '🪙', price: 3, chance: 45, color: '#7a869f' },
      { id: 'st2', name: 'Copper Ring', icon: '💍', price: 10, chance: 30, color: '#c98b4a' },
      { id: 'st3', name: 'Small Gem', icon: '🔹', price: 25, chance: 18, color: '#4fc3f7' },
      { id: 'st4', name: 'Silver Star', icon: '⭐', price: 60, chance: 6, color: '#dae7ff' },
      { id: 'st5', name: 'Blue Crystal', icon: '💎', price: 250, chance: 1, color: '#42aaff' },
    ],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    price: 25,
    color: '#ad653d',
    drops: [
      { id: 'b1', name: 'Bronze Coin', icon: '🪙', price: 10, chance: 42, color: '#be854e' },
      { id: 'b2', name: 'Bronze Star', icon: '⭐', price: 25, chance: 32, color: '#dca35d' },
      { id: 'b3', name: 'Orange Crystal', icon: '🔶', price: 50, chance: 18, color: '#ff8b3d' },
      { id: 'b4', name: 'Small Crown', icon: '👑', price: 100, chance: 7, color: '#ffd13b' },
      { id: 'b5', name: 'Red Gem', icon: '💎', price: 250, chance: 1, color: '#ff586f' },
    ],
  },
  {
    id: 'lucky49a',
    name: 'Lucky 49',
    price: 49,
    color: '#4ec97f',
    drops: [
      { id: 'l49a1', name: 'Lucky Coin', icon: '🍀', price: 5, chance: 55, color: '#5fb878' },
      { id: 'l49a2', name: 'Green Gem', icon: '💚', price: 49, chance: 25, color: '#4ec97f' },
      { id: 'l49a3', name: 'Four Leaf', icon: '🍀', price: 200, chance: 15, color: '#7df0a1' },
      { id: 'l49a4', name: 'Golden Clover', icon: '🌟', price: 1500, chance: 4.99, color: '#ffd13b' },
      { id: 'l49a5', name: 'JACKPOT 💎', icon: '💎', price: 92000, chance: 0.01, color: '#ff4d7a' },
    ],
  },
  {
    id: 'lucky49b',
    name: 'Fire 49',
    price: 49,
    color: '#e5533c',
    drops: [
      { id: 'l49b1', name: 'Fire Spark', icon: '🔥', price: 5, chance: 55, color: '#ff8b3d' },
      { id: 'l49b2', name: 'Red Gem', icon: '❤️', price: 49, chance: 25, color: '#ef4862' },
      { id: 'l49b3', name: 'Flame Crystal', icon: '🔶', price: 200, chance: 15, color: '#ff6b3d' },
      { id: 'l49b4', name: 'Phoenix Feather', icon: '🦅', price: 1500, chance: 4.99, color: '#ffb52e' },
      { id: 'l49b5', name: 'PHOENIX 💎', icon: '🐉', price: 92000, chance: 0.01, color: '#ff4d7a' },
    ],
  },
  {
    id: 'silver',
    name: 'Silver',
    price: 75,
    color: '#7185a9',
    drops: [
      { id: 's1', name: 'Silver Coin', icon: '🪙', price: 30, chance: 40, color: '#aab8d2' },
      { id: 's2', name: 'Silver Star', icon: '🌟', price: 75, chance: 30, color: '#dae7ff' },
      { id: 's3', name: 'Blue Crystal', icon: '🔷', price: 150, chance: 20, color: '#42aaff' },
      { id: 's4', name: 'Silver Crown', icon: '👑', price: 400, chance: 8, color: '#dfe8ff' },
      { id: 's5', name: 'Ice Gem', icon: '💎', price: 1000, chance: 2, color: '#8fd9ff' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    price: 250,
    color: '#d59620',
    drops: [
      { id: 'g1', name: 'Gold Coin', icon: '🪙', price: 100, chance: 45, color: '#ffd13b' },
      { id: 'g2', name: 'Gold Star', icon: '🌟', price: 250, chance: 30, color: '#ffe071' },
      { id: 'g3', name: 'Gold Crystal', icon: '🔶', price: 500, chance: 17, color: '#ffb52e' },
      { id: 'g4', name: 'Golden Crown', icon: '👑', price: 1500, chance: 7, color: '#ffd700' },
      { id: 'g5', name: 'Dragon Gem', icon: '🐉', price: 5000, chance: 1, color: '#ff6b3d' },
    ],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: 500,
    color: '#8fd7d7',
    drops: [
      { id: 'p1', name: 'Platinum Chip', icon: '💠', price: 200, chance: 40, color: '#a8e8e8' },
      { id: 'p2', name: 'Platinum Star', icon: '✨', price: 500, chance: 30, color: '#d6ffff' },
      { id: 'p3', name: 'Frost Crystal', icon: '❄️', price: 1200, chance: 20, color: '#5ddcff' },
      { id: 'p4', name: 'Platinum Crown', icon: '👑', price: 3000, chance: 8, color: '#d0f7ff' },
      { id: 'p5', name: 'Frozen Heart', icon: '💎', price: 8000, chance: 2, color: '#6fd8ff' },
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    price: 1000,
    color: '#7fd4ff',
    drops: [
      { id: 'd1', name: 'Diamond Chip', icon: '💎', price: 400, chance: 42, color: '#8de0ff' },
      { id: 'd2', name: 'Diamond Star', icon: '⭐', price: 1000, chance: 30, color: '#c8efff' },
      { id: 'd3', name: 'Aqua Gem', icon: '🔷', price: 2500, chance: 18, color: '#4fc3f7' },
      { id: 'd4', name: 'Diamond Crown', icon: '👑', price: 7000, chance: 8, color: '#b8efff' },
      { id: 'd5', name: 'Ocean Heart', icon: '💠', price: 20000, chance: 2, color: '#42aaff' },
    ],
  },
  {
    id: 'royal',
    name: 'Royal',
    price: 2500,
    color: '#b28fff',
    drops: [
      { id: 'r1', name: 'Royal Chip', icon: '🟣', price: 1000, chance: 42, color: '#b28fff' },
      { id: 'r2', name: 'Royal Star', icon: '🌟', price: 2500, chance: 30, color: '#d4bfff' },
      { id: 'r3', name: 'Purple Crystal', icon: '🔮', price: 6000, chance: 18, color: '#9d6bff' },
      { id: 'r4', name: 'Royal Crown', icon: '👑', price: 20000, chance: 8, color: '#ffd13b' },
      { id: 'r5', name: 'King Heart', icon: '💜', price: 60000, chance: 2, color: '#ff4ddb' },
    ],
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    price: 5000,
    color: '#5a4fff',
    drops: [
      { id: 'c1', name: 'Star Dust', icon: '✨', price: 2000, chance: 42, color: '#8f87ff' },
      { id: 'c2', name: 'Cosmic Gem', icon: '🌌', price: 5000, chance: 30, color: '#b3aaff' },
      { id: 'c3', name: 'Nebula Crystal', icon: '🌠', price: 12000, chance: 18, color: '#6fd8ff' },
      { id: 'c4', name: 'Galaxy Crown', icon: '👑', price: 40000, chance: 8, color: '#ffd13b' },
      { id: 'c5', name: 'Black Hole', icon: '🕳️', price: 120000, chance: 2, color: '#ff4ddb' },
    ],
  },
  {
    id: 'dragon',
    name: 'Dragon',
    price: 10000,
    color: '#ff5b2a',
    drops: [
      { id: 'dr1', name: 'Dragon Scale', icon: '🐲', price: 4000, chance: 42, color: '#ff7c4d' },
      { id: 'dr2', name: 'Dragon Claw', icon: '🗡️', price: 10000, chance: 30, color: '#ffb52e' },
      { id: 'dr3', name: 'Dragon Eye', icon: '👁️', price: 25000, chance: 18, color: '#ff6b3d' },
      { id: 'dr4', name: 'Dragon Crown', icon: '👑', price: 80000, chance: 8, color: '#ffd13b' },
      { id: 'dr5', name: 'Dragon Heart', icon: '🐉', price: 250000, chance: 2, color: '#ff2d55' },
    ],
  },
  {
    id: 'legendary',
    name: 'Legendary',
    price: 25000,
    color: '#ffd13b',
    drops: [
      { id: 'lg1', name: 'Legend Chip', icon: '🏅', price: 10000, chance: 40, color: '#ffe071' },
      { id: 'lg2', name: 'Legend Star', icon: '🌟', price: 25000, chance: 30, color: '#fff3b0' },
      { id: 'lg3', name: 'Legend Crystal', icon: '🔱', price: 60000, chance: 18, color: '#ffc93b' },
      { id: 'lg4', name: 'Legend Crown', icon: '👑', price: 200000, chance: 9.9, color: '#ffd700' },
      { id: 'lg5', name: 'GOD TIER 💎', icon: '💎', price: 500000, chance: 0.1, color: '#ff2d55' },
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

    if (random <= 0) {
      return drop;
    }
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
  const [balance, setBalance] = useState(250);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState('');

  const toastTimerRef = useRef<number | null>(null);

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
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const addBalance = useCallback((amount: number) => {
    setBalance((value) => value + amount);
  }, []);

  const removeBalance = useCallback(
    (amount: number) => {
      if (balance < amount) {
        hapticError();
        showToast('Недостаточно Stars');
        return false;
      }

      setBalance((value) => value - amount);
      return true;
    },
    [balance, showToast],
  );

  const addHistory = useCallback(
    (game: string, text: string, amount: number, win: boolean) => {
      setHistory((items) =>
        [
          {
            id: Date.now() + Math.random(),
            game,
            text,
            amount,
            win,
          },
          ...items,
        ].slice(0, 30),
      );
    },
    [],
  );

  const user = getTelegramUser();

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="logo"
          onClick={() => {
            hapticTap();
            setPage('home');
          }}
        >
          <span>R</span>
          <b>RITTERZONA</b>
        </button>

        <div className="balance">
          <small>{user?.first_name ?? 'Баланс'}</small>
          <strong>{balance} ⭐</strong>
        </div>
      </header>

      <div className="floating-balance" key="floating-balance">
        <span>⭐</span>
        <b>{balance}</b>
      </div>

      <div key={page}>
        {page === 'home' && (
          <Home
            balance={balance}
            history={history}
            setPage={setPage}
            addBalance={addBalance}
            showToast={showToast}
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
            addBalance={addBalance}
            addHistory={addHistory}
            showToast={showToast}
          />
        )}

        {page === 'cases' && (
          <Cases
            balance={balance}
            setPage={setPage}
            removeBalance={removeBalance}
            addBalance={addBalance}
            addHistory={addHistory}
            showToast={showToast}
          />
        )}
      </div>

      <nav className="bottom-menu" key="bottom-menu">
        <button
          type="button"
          className={page === 'home' ? 'active' : ''}
          onClick={() => {
            hapticTap();
            setPage('home');
          }}
        >
          <span>⌂</span>
          Главная
        </button>

        <button
          type="button"
          className={page === 'roulette' ? 'active' : ''}
          onClick={() => {
            hapticTap();
            setPage('roulette');
          }}
        >
          <span>◉</span>
          Рулетка
        </button>

        <button
          type="button"
          className={page === 'rocket' ? 'active' : ''}
          onClick={() => {
            hapticTap();
            setPage('rocket');
          }}
        >
          <span>🚀</span>
          Ракета
        </button>

        <button
          type="button"
          className={page === 'cases' ? 'active' : ''}
          onClick={() => {
            hapticTap();
            setPage('cases');
          }}
        >
          <span>🎁</span>
          Кейсы
        </button>
      </nav>

      {toast && (
        <div className="toast" key="toast">
          {toast}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   HOME
   ========================================================= */

function Home({
  balance,
  history,
  setPage,
  addBalance,
  showToast,
}: {
  balance: number;
  history: HistoryItem[];
  setPage: (page: Page) => void;
  addBalance: (amount: number) => void;
  showToast: (text: string) => void;
}) {
  return (
    <main>
      <section className="hero">
        <span className="live">● LIVE · 1 284 игроков</span>

        <h1>
          Играй умнее.
          <br />
          Забирай больше.
        </h1>

        <p>
          Рулетка, ракета и кейсы
          <br />в одном игровом пространстве.
        </p>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            hapticTap();
            setPage('roulette');
          }}
        >
          Начать игру →
        </button>

        <div className="hero-letter">R</div>
      </section>

      <section className="balance-card">
        <div>
          <small>Текущий баланс</small>
          <strong>{balance} ⭐</strong>
        </div>

        <button
          type="button"
          onClick={() => {
            hapticSuccess();
            addBalance(25);
            showToast('+25 Stars добавлено');
          }}
        >
          🎁 Бонус
        </button>
      </section>

      <h2>Мини-игры</h2>

      <div className="game-grid">
        <button
          type="button"
          onClick={() => {
            hapticTap();
            setPage('roulette');
          }}
        >
          <span className="game-icon purple">🎯</span>
          <b>Рулетка</b>
          <small>Выбери множитель и цвет</small>
        </button>

        <button
          type="button"
          onClick={() => {
            hapticTap();
            setPage('rocket');
          }}
        >
          <span className="game-icon orange">🚀</span>
          <b>Ракета</b>
          <small>Забери выигрыш до падения</small>
        </button>

        <button
          type="button"
          onClick={() => {
            hapticTap();
            setPage('cases');
          }}
        >
          <span className="game-icon blue">🎁</span>
          <b>Кейсы</b>
          <small>Открывай награды</small>
        </button>

        <button
          type="button"
          onClick={() => {
            hapticTap();
            showToast(`Игр сыграно: ${history.length}`);
          }}
        >
          <span className="game-icon green">🕘</span>
          <b>История</b>
          <small>Последние результаты</small>
        </button>
      </div>

      <h2>История игр</h2>

      <History history={history} />
    </main>
  );
}

/* =========================================================
   ROULETTE
   ========================================================= */

function Roulette({
  balance,
  setPage,
  removeBalance,
  addBalance,
  addHistory,
  showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  removeBalance: (amount: number) => boolean;
  addBalance: (amount: number) => void;
  addHistory: (
    game: string,
    text: string,
    amount: number,
    win: boolean,
  ) => void;
  showToast: (text: string) => void;
}) {
  const [bet, setBet] = useState(10);
  const [selected, setSelected] = useState<Multiplier>(2);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Segment | null>(null);

  const [segments] = useState<Segment[]>(() =>
    shuffle(BASE_SEGMENTS).map((multiplier, index) => ({
      id: index,
      multiplier,
      color: COLORS[multiplier],
    })),
  );

  const winnerRef = useRef<Segment | null>(null);
  const roundRef = useRef(0);

  const segmentSize = 360 / segments.length;

  const counts = useMemo(() => {
    return {
      2: segments.filter((item) => item.multiplier === 2).length,
      3: segments.filter((item) => item.multiplier === 3).length,
      5: segments.filter((item) => item.multiplier === 5).length,
      30: segments.filter((item) => item.multiplier === 30).length,
    };
  }, [segments]);

  const startSpin = () => {
    if (spinning) return;

    hapticTap();

    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));

    if (!removeBalance(safeBet)) {
      return;
    }

    const winnerIndex = Math.floor(Math.random() * segments.length);
    const winner = segments[winnerIndex];

    winnerRef.current = winner;
    roundRef.current += 1;

    const targetAngle = winnerIndex * segmentSize + segmentSize / 2;

    setRotation((current) => {
      const normalized = ((current % 360) + 360) % 360;

      let correction = 360 - targetAngle - normalized;

      if (correction < 0) {
        correction += 360;
      }

      return current + 360 * 6 + correction;
    });

    setResult(null);
    setSpinning(true);
  };

  const finishSpin = () => {
    if (!spinning) return;

    const winner = winnerRef.current;

    if (!winner) {
      setSpinning(false);
      return;
    }

    const won = winner.multiplier === selected;
    const reward = won ? Math.floor(bet * winner.multiplier) : 0;

    setSpinning(false);
    setResult(winner);

    if (won) {
      addBalance(reward);
      hapticSuccess();
      showToast(`Победа! +${reward} ⭐`);
    } else {
      hapticError();
      showToast(`Выпала линия x${winner.multiplier}`);
    }

    addHistory(
      'Рулетка',
      `Выпала линия x${winner.multiplier}`,
      won ? reward - bet : -bet,
      won,
    );
  };

  const wheelStyle: CSSProperties = {
    transform: `rotate(${rotation}deg)`,
  };

  return (
    <main>
      <BackButton setPage={setPage} />

      <div className="heading">
        <small>GAME 01</small>
        <h1>Рулетка</h1>
        <p>
          Выбери множитель и цвет.
          <br />
          Все линии перемешаны случайно.
        </p>
      </div>

      <section className="roulette-box">
        <div className="selected-label">
          ВЫБРАНО
          <b style={{ color: COLORS[selected] }}>x{selected}</b>
        </div>

        <div className="pointer" />

        <div
          className={`wheel ${spinning ? 'wheel-spinning' : ''}`}
          style={wheelStyle}
          onTransitionEnd={finishSpin}
        >
          {segments.map((segment, index) => (
            <span
              key={`wheel-${index}-${segment.multiplier}`}
              className="wheel-line"
              style={{
                background: segment.color,
                transform: `rotate(${index * segmentSize}deg)`,
              }}
            />
          ))}

          <div className="wheel-center">
            <b>R</b>
            <small>
              {spinning
                ? 'WAIT'
                : result
                  ? `x${result.multiplier}`
                  : 'SPIN'}
            </small>
          </div>
        </div>

        <div className="roulette-result">
          {result ? (
            <>
              Выпала линия{' '}
              <b style={{ color: result.color }}>x{result.multiplier}</b>
            </>
          ) : spinning ? (
            'Колесо вращается...'
          ) : (
            'Сделай ставку'
          )}
        </div>
      </section>

      <BetBox
        bet={bet}
        setBet={setBet}
        disabled={spinning}
        balance={balance}
      />

      <div className="color-buttons">
        {([2, 3, 5, 30] as Multiplier[]).map((multiplier) => (
          <button
            type="button"
            key={multiplier}
            disabled={spinning}
            className={selected === multiplier ? 'selected' : ''}
            style={{ borderColor: COLORS[multiplier] }}
            onClick={() => {
              hapticTap();
              setSelected(multiplier);
            }}
          >
            <strong>x{multiplier}</strong>
            <small>{COLOR_NAMES[multiplier]}</small>
            <em>{counts[multiplier]} линий</em>
          </button>
        ))}
      </div>

      <div className="selected-text">
        Ставка на{' '}
        <b style={{ color: COLORS[selected] }}>
          {COLOR_NAMES[selected]} цвет
        </b>
        {' · '}выигрыш x{selected}
      </div>

      <button
        type="button"
        className="primary-button full"
        disabled={spinning || balance < Math.max(10, bet)}
        onClick={startSpin}
      >
        {spinning
          ? 'Колесо вращается...'
          : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>
    </main>
  );
}

/* =========================================================
   ROCKET
   ========================================================= */

const MIN_CASHOUT = 1.3;

function Rocket({
  balance,
  removeBalance,
  addBalance,
  addHistory,
  showToast,
}: {
  balance: number;
  removeBalance: (amount: number) => boolean;
  addBalance: (amount: number) => void;
  addHistory: (
    game: string,
    text: string,
    amount: number,
    win: boolean,
  ) => void;
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
    try {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
    } catch (err) {
      console.warn('clearInterval failed', err);
    }

    try {
      if (crashTimerRef.current !== null) {
        window.clearTimeout(crashTimerRef.current);
      }
    } catch (err) {
      console.warn('clearTimeout failed', err);
    }

    intervalRef.current = null;
    crashTimerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      playingRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const getCrashPoint = () => {
    const random = Math.random();

    if (random < 0.35) {
      return Number((1.35 + Math.random() * 0.9).toFixed(2));
    }

    if (random < 0.7) {
      return Number((2.2 + Math.random() * 2.3).toFixed(2));
    }

    if (random < 0.92) {
      return Number((4.5 + Math.random() * 5).toFixed(2));
    }

    return Number((10 + Math.random() * 25).toFixed(2));
  };

  const startRocket = () => {
    if (playingRef.current) return;
    if (playing) return;

    hapticTap();

    const safeBet = Math.max(10, Math.floor(Number(bet) || 10));

    if (!removeBalance(safeBet)) {
      return;
    }

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
      if (!mountedRef.current) return;
      if (!playingRef.current) return;
      if (roundRef.current !== roundId) return;

      const seconds = (Date.now() - startTimeRef.current) / 1000;

      const raw = Math.pow(1.06, seconds * 2.4);
      const next = Number(Math.min(crashPoint, raw).toFixed(2));

      multiplierRef.current = next;
      setMultiplier(next);

      if (next >= MIN_CASHOUT) {
        setCanCashOut(true);
      }
    }, 100);

    const crashDelay = Math.min(
      18000,
      Math.max(
        1500,
        (Math.log(crashPoint) / Math.log(1.06) / 2.4) * 1000,
      ),
    );

    crashTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (!playingRef.current) return;
      if (roundRef.current !== roundId) return;

      playingRef.current = false;
      clearTimers();

      setPlaying(false);
      setCanCashOut(false);
      setCrashed(true);
      setMultiplier(crashPoint);

      hapticError();

      addHistory(
        'Ракета',
        `Падение на x${crashPoint}`,
        -safeBet,
        false,
      );

      showToast(`Ракета упала на x${crashPoint}`);
    }, crashDelay);
  };

  const cashOut = () => {
    if (!playingRef.current) {
      showToast('Сначала запусти ракету');
      return;
    }

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

    addBalance(reward);
    hapticSuccess();

    addHistory(
      'Ракета',
      `Вывод на x${currentMultiplier.toFixed(2)}`,
      reward - betRef.current,
      true,
    );

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

      <button
        type="button"
        className="primary-button full rocket-start-btn"
        disabled={playing ? !canCashOut : balance < Math.max(10, bet)}
        onClick={playing ? cashOut : startRocket}
      >
        {playing
          ? canCashOut
            ? `Забрать ${payout} ⭐`
            : `Ждём x${MIN_CASHOUT.toFixed(2)}...`
          : `Запустить за ${Math.max(10, bet)} ⭐`}
      </button>

      <section className="rocket-box">
        <div className="rocket-multiplier">x{multiplier.toFixed(2)}</div>

        <div className="rocket-payout">
          Текущий выигрыш: <b>{payout} ⭐</b>
        </div>

        <div className={playing ? 'rocket flying' : 'rocket'}>🚀</div>

        <div className="rocket-line" />

        <div className="rocket-info">
          {playing && !canCashOut &&
            `Ждём x${MIN_CASHOUT.toFixed(2)}...`}
          {playing && canCashOut && 'Можно забрать выигрыш'}
          {!playing && crashed && 'Ракета упала'}
          {!playing && cashedOut && 'Выигрыш забран'}
          {!playing && !crashed && !cashedOut && 'Нажмите кнопку запуска'}
        </div>
      </section>

      <BetBox
        bet={bet}
        setBet={setBet}
        disabled={playing}
        balance={balance}
      />
    </main>
  );
}

/* =========================================================
   CASES
   ========================================================= */

function Cases({
  balance,
  setPage,
  removeBalance,
  addBalance,
  addHistory,
  showToast,
}: {
  balance: number;
  setPage: (page: Page) => void;
  removeBalance: (amount: number) => boolean;
  addBalance: (amount: number) => void;
  addHistory: (
    game: string,
    text: string,
    amount: number,
    win: boolean,
  ) => void;
  showToast: (text: string) => void;
}) {
  const [selectedCase, setSelectedCase] = useState<GameCase>(CASES[0]);
  const [opening, setOpening] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [reel, setReel] = useState<Drop[]>([]);
  const [reelOffset, setReelOffset] = useState(0);

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const ITEM_WIDTH = 88;
  const ITEM_GAP = 8;
  const ITEM_STEP = ITEM_WIDTH + ITEM_GAP;
  const REEL_LENGTH = 60;
  const WINNER_INDEX = 48;

  const buildReel = (winner: Drop, pool: Drop[]): Drop[] => {
    const items: Drop[] = [];

    for (let i = 0; i < REEL_LENGTH; i += 1) {
      if (i === WINNER_INDEX) {
        items.push(winner);
      } else {
        items.push(getRandomDrop(pool));
      }
    }

    return items;
  };

  const openCase = () => {
    if (opening) return;

    hapticTap();

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!removeBalance(selectedCase.price)) {
      return;
    }

    const result = getRandomDrop(selectedCase.drops);
    const items = buildReel(result, selectedCase.drops);

    setOpening(true);
    setDrop(null);
    setReel(items);
    setReelOffset(0);

    const target = -WINNER_INDEX * ITEM_STEP;

    window.requestAnimationFrame(() => {
      setReelOffset(target);
    });

    timerRef.current = window.setTimeout(() => {
      setOpening(false);
      setDrop(result);

      addBalance(result.price);

      const amount = result.price - selectedCase.price;
      const isProfit = amount >= 0;

      if (isProfit) {
        hapticSuccess();
      } else {
        hapticError();
      }

      addHistory(
        selectedCase.name,
        `${result.name} — ${result.price} ⭐`,
        amount,
        isProfit,
      );

      showToast(`${result.name}: +${result.price} ⭐`);

      timerRef.current = null;
    }, 4200);
  };

  const rarityClass = (price: number, casePrice: number) => {
    const ratio = price / casePrice;

    if (ratio >= 20) return 'mythic';
    if (ratio >= 5) return 'legendary';
    if (ratio >= 2) return 'rare';
    if (ratio >= 1) return 'uncommon';
    return 'common';
  };

  const rarityLabel = (price: number, casePrice: number) => {
    const ratio = price / casePrice;

    if (ratio >= 20) return 'MYTHIC';
    if (ratio >= 5) return 'LEGENDARY';
    if (ratio >= 2) return 'RARE';
    if (ratio >= 1) return 'GOOD';
    return 'COMMON';
  };

  const isPremiumCase = selectedCase.price >= 1000;

  return (
    <main>
      <BackButton setPage={setPage} />

      <div className="heading">
        <small>REWARDS</small>
        <h1>Кейсы</h1>
        <p>Открывай кейсы и получай случайные награды.</p>
      </div>

      <div className="case-list">
        {CASES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={selectedCase.id === item.id ? 'active' : ''}
            disabled={opening}
            onClick={() => {
              hapticTap();
              setSelectedCase(item);
              setDrop(null);
              setReel([]);
              setReelOffset(0);
            }}
          >
            <div className="case-3d-mini">
              <div
                className="case-3d-mini-front"
                style={{ background: item.color }}
              >
                🎁
              </div>
              <div
                className="case-3d-mini-top"
                style={{ background: lighten(item.color) }}
              />
            </div>

            <b>{item.name}</b>
            <small>{item.price} ⭐</small>
          </button>
        ))}
      </div>

      <section
        className={`case-showcase ${isPremiumCase ? 'premium' : ''}`}
      >
        {opening && reel.length > 0 && (
          <div className="reel">
            <div className="reel-line" />

            <div
              className="reel-track"
              style={{
                transform: `translateX(${reelOffset}px)`,
                transition: opening
                  ? 'transform 4s cubic-bezier(0.12, 0.8, 0.2, 1)'
                  : 'none',
              }}
            >
              {reel.map((item, index) => (
                <div
                  className="reel-item"
                  key={`${item.id}-${index}`}
                  style={{
                    borderColor: item.color,
                  }}
                >
                  <span>{item.icon}</span>
                  <b style={{ color: item.color }}>{item.price}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        {!opening && (
          <div className="case-3d-wrap">
            <div
              className="case-3d-glow"
              style={{ background: selectedCase.color }}
            />

            <div className="case-3d">
              <div
                className="case-3d-back"
                style={{ background: selectedCase.color }}
              />

              <div
                className="case-3d-front"
                style={{ background: selectedCase.color }}
              >
                <span className="case-3d-logo">R</span>
              </div>

              <div
                className="case-3d-top"
                style={{ background: lighten(selectedCase.color) }}
              />

              <div className="case-3d-lid" />

              <div className="case-3d-side" />
            </div>
          </div>
        )}

        {opening && (
          <div className="case-status">
            <span className="case-status-dot" />
            Открываем кейс...
          </div>
        )}

        {!opening && drop && (
          <div
            className={`drop-result ${rarityClass(
              drop.price,
              selectedCase.price,
            )}`}
          >
            <span
              className="drop-result-glow"
              style={{ background: drop.color }}
            />

            <span className="drop-result-icon">{drop.icon}</span>

            <b>{drop.name}</b>
            <em className="drop-result-rarity">
              {rarityLabel(drop.price, selectedCase.price)}
            </em>
            <strong style={{ color: drop.color }}>
              +{drop.price} ⭐
            </strong>
          </div>
        )}

        {!opening && !drop && (
          <div className="case-status">Выбери кейс и нажми открыть</div>
        )}

        <button
          type="button"
          className="primary-button full"
          disabled={opening || balance < selectedCase.price}
          onClick={openCase}
        >
          {opening
            ? 'Открытие...'
            : `Открыть за ${selectedCase.price} ⭐`}
        </button>
      </section>

      <h2>Предметы в кейсе</h2>

      <div className="drops">
        {selectedCase.drops.map((item) => (
          <div
            className={`drop-row ${rarityClass(
              item.price,
              selectedCase.price,
            )}`}
            key={item.id}
          >
            <span
              className="drop-icon"
              style={{
                color: item.color,
                borderColor: item.color,
                boxShadow: `0 0 12px ${item.color}44`,
              }}
            >
              {item.icon}
            </span>

            <div>
              <b>{item.name}</b>
              <small>Шанс: {item.chance}%</small>
            </div>

            <strong style={{ color: item.color }}>{item.price} ⭐</strong>
          </div>
        ))}
      </div>
    </main>
  );
}

/* =========================================================
   BET BOX
   ========================================================= */

function BetBox({
  bet,
  setBet,
  disabled,
  balance,
}: {
  bet: number;
  setBet: (value: number) => void;
  disabled: boolean;
  balance: number;
}) {
  const MIN_BET = 10;

  const [inputValue, setInputValue] = useState(String(bet));

  useEffect(() => {
    setInputValue(String(bet));
  }, [bet]);

  const commitValue = (raw: string) => {
    if (raw === '' || raw === '-') {
      setBet(MIN_BET);
      setInputValue(String(MIN_BET));
      return;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < MIN_BET) {
      setBet(MIN_BET);
      setInputValue(String(MIN_BET));
      return;
    }

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
        <button
          type="button"
          className="bet-step"
          disabled={disabled || bet <= MIN_BET}
          onClick={() => {
            hapticTap();
            const next = Math.max(MIN_BET, bet - 10);
            setBet(next);
            setInputValue(String(next));
          }}
        >
          −
        </button>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9]/g, '');
            setInputValue(raw);
          }}
          onBlur={(event) => {
            commitValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitValue((event.target as HTMLInputElement).value);
              (event.target as HTMLInputElement).blur();
            }
          }}
        />

        <button
          type="button"
          className="bet-step"
          disabled={disabled}
          onClick={() => {
            hapticTap();
            const next = bet + 10;
            setBet(next);
            setInputValue(String(next));
          }}
        >
          +
        </button>
      </div>

      <div className="bet-hint">
        Минимум: {MIN_BET} ⭐ · Баланс: {balance} ⭐
      </div>

      <div className="quick-bets">
        {[10, 50, 100, 500].map((value) => (
          <button
            type="button"
            key={value}
            disabled={disabled || value > balance}
            className={bet === value ? 'active' : ''}
            onClick={() => {
              hapticTap();
              const next = Math.max(MIN_BET, value);
              setBet(next);
              setInputValue(String(next));
            }}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="quick-bets">
        <button
          type="button"
          disabled={disabled || balance < MIN_BET}
          onClick={() => {
            hapticTap();
            const next = Math.max(MIN_BET, Math.floor(balance / 2));
            setBet(next);
            setInputValue(String(next));
          }}
        >
          ½
        </button>

        <button
          type="button"
          disabled={disabled || balance < MIN_BET}
          onClick={() => {
            hapticTap();
            const next = Math.max(MIN_BET, balance);
            setBet(next);
            setInputValue(String(next));
          }}
        >
          MAX
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   BACK BUTTON
   ========================================================= */

function BackButton({
  setPage,
}: {
  setPage: (page: Page) => void;
}) {
  return (
    <button
      type="button"
      className="back-button"
      onClick={() => {
        hapticTap();
        setPage('home');
      }}
    >
      ← На главную
    </button>
  );
}

/* =========================================================
   HISTORY
   ========================================================= */

function History({ history }: { history: HistoryItem[] }) {
  if (history.length === 0) {
    return (
      <div className="empty">История игр пока пустая</div>
    );
  }

  return (
    <div className="history">
      {history.map((item) => (
        <div className="history-row" key={item.id}>
          <span className={item.win ? 'win' : 'lose'}>
            {item.win ? '↗' : '↘'}
          </span>

          <div>
            <b>{item.game}</b>
            <small>{item.text}</small>
          </div>

          <strong
            className={item.amount >= 0 ? 'positive' : 'negative'}
          >
            {item.amount > 0 ? '+' : ''}
            {item.amount} ⭐
          </strong>
        </div>
      ))}
    </div>
  );
}

export default App;