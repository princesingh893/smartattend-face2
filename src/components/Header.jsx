import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function Header({ onLogout, isAdmin = false }) {
    const nav = useNavigate();
    const loc = useLocation();
    const showBack = loc.pathname !== '/';

    return (
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-lg border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 sm:py-3">
                <div className="flex items-center gap-2 sm:gap-3">
                    {/* Back button */}
                    {showBack && (
                        <button
                            onClick={() => nav(-1)}
                            aria-label="Go back"
                            className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 hover:bg-indigo-100 active:scale-95 flex items-center justify-center text-slate-600 hover:text-indigo-600 transition-all"
                        >
                            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}

                    {/* Logo + College Info */}
                    <Link to="/" className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 active:opacity-80">
                        {/* Emblem */}
                        {/* Logo */}
                        <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl overflow-hidden bg-white flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-2 ring-indigo-100">
                            <img
                                src="/BCMT_logo.png"
                                alt="Baudhayan College Logo"
                                className="w-full h-full object-contain p-0.5"
                            />
                        </div>

                        <div className="min-w-0 flex-1">
                            <h1 className="font-heading font-bold text-[11px] sm:text-[15px] leading-tight text-slate-900 truncate">
                                Baudhayan College of Management And Technology
                            </h1>
                            <p className="text-[8px] sm:text-[10.5px] text-[#d59a08] font-medium">
                                Affiliated to Aryabhatta Knowledge University <span className="text-[#d59a08]">||</span> AICTE Approved
                            </p>
                        </div>
                    </Link>

                    {/* Admin logout */}
                    {isAdmin && onLogout && (
                        <button
                            onClick={onLogout}
                            className="shrink-0 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 active:scale-95 text-red-600 text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            <span className="hidden sm:inline">Logout</span>
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
}