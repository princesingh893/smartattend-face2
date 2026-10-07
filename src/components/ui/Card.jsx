export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 ${className}`}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-slate-900 truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
