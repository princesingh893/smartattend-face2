import { useNavigate } from 'react-router-dom';

export default function BackButton({ label = 'Back', to, className = '' }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => (to ? nav(to) : nav(-1))}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 active:scale-95 text-slate-700 hover:text-indigo-700 text-sm font-semibold transition-all shadow-sm ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}