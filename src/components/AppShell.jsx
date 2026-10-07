import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ScanFace,
  Users,
  ShieldCheck,
  ChevronLeft,
} from 'lucide-react';
import { isAdminLoggedIn } from '../lib/auth';

// ============================================================
// AppShell — professional application layout
// Desktop: left sidebar + top header + main content
// Mobile:  compact top bar + bottom navigation
// ============================================================

function navItems() {
  return [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/scan', label: 'Scan', icon: ScanFace },
    { to: '/student', label: 'Students', icon: Users },
    {
      to: isAdminLoggedIn() ? '/admin' : '/admin-login',
      label: 'Admin',
      icon: ShieldCheck,
    },
  ];
}

function Logo({ compact = false }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 min-w-0">
      <img
        src="/BCMT_logo.png"
        alt="Baudhayan College logo"
        className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0"
      />
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 leading-tight truncate">
          SmartAttend
        </p>
        {!compact && (
          <p className="text-[11px] text-slate-500 leading-tight truncate">
            Baudhayan College of Management & Technology
          </p>
        )}
      </div>
    </Link>
  );
}

export default function AppShell({
  title,
  subtitle,
  actions,
  children,
  maxW = 'max-w-5xl',
  flush = false, // true → content controls its own padding (used by Scan)
}) {
  const loc = useLocation();
  const nav = useNavigate();
  const items = navItems();
  const isHome = loc.pathname === '/';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ============ DESKTOP SIDEBAR ============ */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-40">
        <div className="px-5 py-5 border-b border-slate-100">
          <Logo />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
          {items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <item.icon className="w-[18px] h-[18px]" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-slate-100">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Affiliated to Aryabhatta Knowledge University · AICTE Approved
          </p>
        </div>
      </aside>

      {/* ============ MOBILE TOP BAR ============ */}
      <header className="lg:hidden sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 h-14 px-3">
          {!isHome && (
            <button
              onClick={() => nav(-1)}
              aria-label="Go back"
              className="shrink-0 w-10 h-10 -ml-1 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            {isHome ? (
              <Logo compact />
            ) : (
              <h1 className="text-[15px] font-semibold text-slate-900 truncate">
                {title || 'SmartAttend'}
              </h1>
            )}
          </div>
          {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
        </div>
      </header>

      {/* ============ MAIN COLUMN ============ */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        {/* Desktop top header */}
        {(title || actions) && (
          <div className="hidden lg:block sticky top-0 z-30 bg-slate-50/95 backdrop-blur border-b border-slate-200">
            <div className={`${maxW} mx-auto px-8 h-16 flex items-center justify-between gap-4`}>
              <div className="min-w-0">
                {title && (
                  <h1 className="text-xl font-semibold text-slate-900 truncate">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-xs text-slate-500 truncate">{subtitle}</p>
                )}
              </div>
              {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
            </div>
          </div>
        )}

        <main
          className={
            flush
              ? 'flex-1 flex flex-col'
              : `flex-1 w-full ${maxW} mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-24 lg:pb-10`
          }
        >
          {children}
        </main>
      </div>

      {/* ============ MOBILE BOTTOM NAV ============ */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-safe"
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-4 h-16">
          {items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 text-[11px] font-medium min-h-[44px] transition-colors ${
                  isActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`
              }
            >
              <item.icon className="w-5 h-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
