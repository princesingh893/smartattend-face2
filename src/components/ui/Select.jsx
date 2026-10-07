export default function Select({
  label,
  error,
  children,
  className = '',
  id,
  ...props
}) {
  const selectId = id || `select-${label?.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        aria-invalid={!!error}
        className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500 ${
          error ? 'border-red-400' : 'border-slate-300'
        }`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1.5 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}
