import { Skeleton } from './Skeleton';

const accents = {
  blue: 'text-blue-600 bg-blue-50',
  green: 'text-green-600 bg-green-50',
  red: 'text-red-600 bg-red-50',
  amber: 'text-amber-600 bg-amber-50',
  slate: 'text-slate-600 bg-slate-100',
};

export default function StatCard({ label, value, icon: Icon, accent = 'blue', loading = false }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {Icon && (
          <span className={`p-1.5 rounded-lg ${accents[accent]}`}>
            <Icon className="w-4 h-4" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">
          {value}
        </div>
      )}
    </div>
  );
}
