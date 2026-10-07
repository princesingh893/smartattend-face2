export default function Loader({ text = '', size = 'md', variant = 'primary', full = false }) {
  const sizes = {
    sm: 'w-5 h-5 border-2',
    md: 'w-10 h-10 border-3',
    lg: 'w-16 h-16 border-4',
  };
  const colors = {
    primary: 'border-indigo-200 border-t-indigo-600',
    white: 'border-white/30 border-t-white',
    dark: 'border-slate-600 border-t-white',
  };
  const textColors = {
    primary: 'text-slate-500',
    white: 'text-white/80',
    dark: 'text-white',
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`${sizes[size]} ${colors[variant]} rounded-full animate-spin`} />
      {text && <p className={`text-sm font-medium ${textColors[variant]}`}>{text}</p>}
    </div>
  );

  if (full) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50">
        {content}
      </div>
    );
  }
  return content;
}

export function FullPageLoader({ text = 'Loading...' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="text-center">
        <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-5" />
        <p className="text-slate-600 font-semibold font-heading">{text}</p>
        <p className="text-xs text-slate-400 mt-1">Baudhayan College • SmartAttend</p>
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100">
      <div className="skeleton h-4 w-1/3 rounded-full mb-3" />
      <div className="skeleton h-8 w-2/3 rounded-lg mb-2" />
      <div className="skeleton h-3 w-1/2 rounded-full" />
    </div>
  );
}