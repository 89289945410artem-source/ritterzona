// src/telegram.ts

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

export function getTelegram(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

export function getTelegramUser() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user;
}

export function initTelegram() {
  const tg = getTelegram();
  if (!tg) return;

  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#05040a');
    tg.setBackgroundColor?.('#05040a');
  } catch (err) {
    console.warn('[telegram] init error', err);
  }
}

export function hapticTap() {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  } catch {}
}

export function hapticSuccess() {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  } catch {}
}

export function hapticError() {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
  } catch {}
}