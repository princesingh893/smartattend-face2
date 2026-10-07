import { Check, X, Clock, AlertTriangle, Info } from 'lucide-react';

const styles = {
  success: 'bg-green-50 text-green-700 border-green-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
};

const dots = {
  success: 'bg-green-600',
  danger: 'bg-red-600',
  warning: 'bg-amber-600',
  info: 'bg-sky-600',
  neutral: 'bg-slate-400',
};

const icons = {
  success: Check,
  danger: X,
  warning: AlertTriangle,
  info: Info,
  neutral: Clock,
};

export default function Badge({
  variant = 'neutral',
  children,
  className = '',
}) {
  const Icon = icons[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${styles[variant]} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dots[variant]}`} aria-hidden />
      <Icon className="w-3 h-3" aria-hidden />
      {children}
    </span>
  );
}
