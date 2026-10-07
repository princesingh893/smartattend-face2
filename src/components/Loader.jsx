export default function Loader({ text = '', size = 'md', variant = 'primary', full = false }) {
  const sizes = {
    sm: 'w-5 h-5 border-2',
    md: 'w-10 h-10 border-[3px]',
    lg: 'w-16 h-16 border-4',
  };
  const colors = {
    primary: 'border-slate-200 border-t-blue-600',
    white: 'border-white/30 border-t-white',
    dark: 'border-slate-600 border-t-white',
  };
  const textColors = {
    primary: 'text-slate-500',
    white: 'text-white/80',
    dark: 'text-white',
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3" role="status" aria-label={text || 'Loading'}>
      <div className={`${sizes[size]} ${colors[variant]} rounded-full animate-spin`} />
      {text && <p className={`text-sm font-medium ${textColors[variant]}`}>{text}</p>}
    </div>
  );

  if (full) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        {content}
      </div>
    );
  }
  return content;
}

export function FullPageLoader({ text = 'Loading...' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-14 h-14 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600 font-semibold text-sm">{text}</p>
        <p className="text-xs text-slate-400 mt-1">SmartAttend · Baudhayan College</p>
      </div>
    </div>
  );
}
