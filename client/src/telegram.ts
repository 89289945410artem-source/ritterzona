export const tg = window.Telegram?.WebApp;

export function hapticTap() {
  tg?.HapticFeedback?.impactOccurred('light');
}

export function hapticSuccess() {
  tg?.HapticFeedback?.notificationOccurred('success');
}

export function hapticError() {
  tg?.HapticFeedback?.notificationOccurred('error');
}

export function getTelegramUser() {
  return tg?.initDataUnsafe?.user ?? null;
}

export function getDisplayName(): string {
  const user = getTelegramUser();

  if (!user) return 'Гость';

  if (user.username) {
    return `@${user.username}`;
  }

  return (
    [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ') || 'Игрок'
  );
}