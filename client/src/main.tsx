import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const telegram = window.Telegram?.WebApp;

/* =========================================================
   КЛЮЧЕВОЙ ФИКС: перехват Node.prototype.removeChild
   ========================================================= */

const originalRemoveChild = Node.prototype.removeChild;

Node.prototype.removeChild = function <T extends Node>(child: T): T {
  if (child.parentNode !== this) {
    // Нода уже удалена — глушим ошибку, не падаем
    return child;
  }

  return originalRemoveChild.call(this, child) as T;
};

const originalInsertBefore = Node.prototype.insertBefore;

Node.prototype.insertBefore = function <T extends Node>(
  newNode: T,
  referenceNode: Node | null,
): T {
  if (referenceNode && referenceNode.parentNode !== this) {
    // Reference-нода удалена — вставляем в конец
    return originalInsertBefore.call(this, newNode, null) as T;
  }

  return originalInsertBefore.call(this, newNode, referenceNode) as T;
};

/* =========================================================
   Глобальные обработчики ошибок
   ========================================================= */

window.addEventListener(
  'error',
  (event) => {
    const message = String(event.message || '');

    if (
      message.includes('removeChild') ||
      message.includes('NotFoundError') ||
      message.includes('is not a child of this node')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  },
  true,
);

window.addEventListener('unhandledrejection', (event) => {
  const reason = String(event.reason || '');

  if (
    reason.includes('removeChild') ||
    reason.includes('NotFoundError')
  ) {
    event.preventDefault();
  }
});

/* =========================================================
   Telegram WebApp
   ========================================================= */

try {
  telegram?.ready?.();
  telegram?.expand?.();

  telegram?.setHeaderColor?.('#080a14');
  telegram?.setBackgroundColor?.('#080a14');
} catch (err) {
  console.warn('Telegram WebApp init failed', err);
}

function syncViewportHeight() {
  const height =
    telegram?.viewportStableHeight ?? window.innerHeight;

  document.documentElement.style.setProperty(
    '--tg-viewport-height',
    `${height}px`,
  );
}

syncViewportHeight();
window.addEventListener('resize', syncViewportHeight);

telegram?.BackButton?.hide?.();

/* =========================================================
   ErrorBoundary
   ========================================================= */

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = {
    hasError: false,
    error: '',
  };

  static getDerivedStateFromError(error: Error) {
    const message = String(error?.message || error);

    if (
      message.includes('removeChild') ||
      message.includes('NotFoundError')
    ) {
      return { hasError: false, error: '' };
    }

    return {
      hasError: true,
      error: error?.stack || error?.message || String(error),
    };
  }

  componentDidCatch(error: Error) {
    const message = String(error?.message || error);

    if (
      message.includes('removeChild') ||
      message.includes('NotFoundError')
    ) {
      return;
    }

    console.error('Ошибка приложения:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 20,
            background: '#080a12',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <h2 style={{ color: '#ff667a' }}>
            Произошла ошибка приложения
          </h2>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              padding: 15,
              borderRadius: 10,
              background: '#191c29',
              color: '#ffd13b',
              fontSize: 12,
              overflow: 'auto',
            }}
          >
            {this.state.error}
          </pre>

          <button
            onClick={() => {
              window.location.reload();
            }}
            style={{
              marginTop: 15,
              padding: '12px 18px',
              border: 0,
              borderRadius: 10,
              background: '#7655ec',
              color: '#fff',
            }}
          >
            Перезагрузить
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Элемент #root не найден в index.html');
}

ReactDOM.createRoot(rootElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);