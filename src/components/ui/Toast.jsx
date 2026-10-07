import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// ============================================================
// Tiny global toast store (no external dependency)
// Usage anywhere:  toast.success('Saved') / toast.error('Failed')
// Mount <Toaster /> once in App.jsx
// ============================================================

let listeners = [];
let idSeq = 0;

function emit(toasts) {
  listeners.forEach((fn) => fn(toasts));
}

function push(type, message, sub = '') {
  const id = ++idSeq;
  const item = { id, type, message, sub };
  toastStore.items = [...toastStore.items, item].slice(-3);
  emit(toastStore.items);
  setTimeout(() => dismiss(id), 4000);
}

function dismiss(id) {
  toastStore.items = toastStore.items.filter((t) => t.id !== id);
  emit(toastStore.items);
}

const toastStore = { items: [] };

export const toast = {
  success: (m, sub) => push('success', m, sub),
  error: (m, sub) => push('error', m, sub),
  warning: (m, sub) => push('warning', m, sub),
  info: (m, sub) => push('info', m, sub),
};

const config = {
  success: { icon: CheckCircle2, classes: 'border-green-200 bg-white', iconColor: 'text-green-600' },
  error: { icon: XCircle, classes: 'border-red-200 bg-white', iconColor: 'text-red-600' },
  warning: { icon: AlertTriangle, classes: 'border-amber-200 bg-white', iconColor: 'text-amber-600' },
  info: { icon: Info, classes: 'border-sky-200 bg-white', iconColor: 'text-sky-600' },
};

export function Toaster() {
  const [items, setItems] = useState(toastStore.items);

  useEffect(() => {
    const fn = (next) => setItems([...next]);
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  }, []);

  return (
    <div
      className="fixed z-[100] inset-x-0 bottom-20 sm:bottom-6 flex flex-col items-center sm:items-end gap-2 px-4 sm:px-6 pointer-events-none"
      aria-live="polite"
      role="status"
    >
      {items.map((t) => {
        const cfg = config[t.type] || config.info;
        const Icon = cfg.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto w-full max-w-sm flex items-start gap-3 rounded-xl border shadow-lg shadow-slate-900/5 px-4 py-3 animate-fade-in-up ${cfg.classes}`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${cfg.iconColor}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{t.message}</p>
              {t.sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{t.sub}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
