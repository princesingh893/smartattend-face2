import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import Header from '../components/Header';
import Loader from '../components/Loader';

export default function Home() {
  const [count, setCount] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const nav = useNavigate();

  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [att, st] = await Promise.all([
        api.getTodayAttendance(),
        api.getStudents(),
      ]);
      setAttendance(att || []);
      setStudents(st || []);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
      if (showRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(), 3000);
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadData]);

  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
      const t = setTimeout(() => nav('/scan'), 300);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, nav]);

  const stats = useMemo(() => {
    const present = attendance.length;
    const total = students.length;
    const absent = Math.max(0, total - present);
    const rate = total ? Math.round((present / total) * 100) : 0;
    return { present, total, absent, rate };
  }, [attendance, students]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50">
      <Header />

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full text-xs font-semibold mb-4 shadow-sm tracking-wide">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            LIVE ATTENDANCE
          </div>

          <h1 className="font-heading text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-700 via-violet-600 to-indigo-700 bg-clip-text text-transparent">
            SmartAttend
          </h1>
          <p className="text-slate-500 mt-2 text-sm sm:text-base font-medium tracking-wide">
            Face Recognition Attendance System
          </p>
        </div>

        <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl shadow-xl shadow-indigo-500/10 border border-white/60 p-6 sm:p-10 mb-8 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-gradient-to-br from-indigo-200/40 to-violet-200/40 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-gradient-to-tr from-emerald-100/50 to-cyan-100/40 rounded-full blur-3xl" />

          <div className="relative">
            {count === null ? (
              <div className="text-center">
                <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-5 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/25 ring-4 ring-emerald-100/50">
                  <svg className="w-10 h-10 sm:w-12 sm:h-12 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>

                <h2 className="font-heading text-xl sm:text-2xl font-bold text-slate-900 mb-1.5 tracking-tight">
                  Ready to take attendance?
                </h2>
                <p className="text-sm text-slate-500 mb-7 max-w-xs mx-auto font-medium">
                  Start face scanning for today's class
                </p>

                <button
                  onClick={() => setCount(3)}
                  className="group inline-flex items-center gap-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white text-base sm:text-lg font-bold px-8 sm:px-10 py-4 rounded-2xl shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/40 active:scale-[0.97] transition-all duration-200"
                >
                  <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Scan Students
                </button>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-slate-500 text-xs font-semibold tracking-widest uppercase mb-3">
                  Starting in
                </p>

                <div className="font-heading text-[110px] sm:text-[140px] leading-none font-extrabold bg-gradient-to-br from-emerald-500 to-cyan-500 bg-clip-text text-transparent tabular-nums">
                  {count > 0 ? count : '✓'}
                </div>

                <div className="mt-6 max-w-[200px] mx-auto h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-cyan-500 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${((3 - count) / 3) * 100}%` }}
                  />
                </div>

                <button
                  onClick={() => setCount(null)}
                  className="mt-7 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-5 py-2 rounded-xl border border-red-100/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          <StatCard
            label="Total Students"
            value={stats.total}
            gradient="from-blue-500 to-indigo-600"
            loading={loading}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />
          <StatCard
            label="Present Today"
            value={stats.present}
            gradient="from-emerald-500 to-green-600"
            loading={loading}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            label="Absent Today"
            value={stats.absent}
            gradient="from-rose-500 to-red-600"
            loading={loading}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            label="Attendance Rate"
            value={`${stats.rate}%`}
            gradient="from-violet-500 to-indigo-600"
            loading={loading}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
        </div>

        {/* <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg shadow-slate-200/40 border border-white/70 overflow-hidden mb-8">
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100/80">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <h2 className="font-heading font-bold text-slate-900 text-base sm:text-lg tracking-tight">
                Today's Attendance
              </h2>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full tracking-wide">
                {stats.present} / {stats.total}
              </span>

              <button
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-indigo-50 flex items-center justify-center text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-60"
                aria-label="Refresh attendance"
              >
                <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-3 sm:p-4 max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="py-10">
                <Loader text="Loading attendance..." size="md" />
              </div>
            ) : attendance.length === 0 ? (
              <div className="text-center py-14">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium text-sm tracking-wide">
                  No attendance marked yet
                </p>
                <p className="text-xs text-slate-400 mt-1.5">
                  Tap "Scan Students" to begin
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {attendance.map((a, i) => (
                  <div
                    key={`${a.StudentID}-${i}`}
                    className="flex items-center justify-between bg-gradient-to-r from-emerald-50/80 to-green-50/60 border border-emerald-100/70 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow"
                  >
                    <div className="font-semibold text-slate-900 text-sm truncate tracking-tight">
                      {a.Name}
                    </div>

                    <div className="text-xs font-semibold text-emerald-700 bg-white/80 px-2.5 py-1 rounded-lg border border-emerald-100/60 whitespace-nowrap tracking-wide">
                      {a.Timestamp}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div> */}

        <div className="grid grid-cols-3 gap-3">
          <NavCard
            to="/scan"
            label="Scan"
            gradient="from-indigo-500 to-blue-600"
            icon={
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <NavCard
            to="/admin-login"
            label="Admin"
            gradient="from-slate-700 to-slate-900"
            icon={
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <NavCard
            to="/student"
            label="Students"
            gradient="from-violet-500 to-purple-600"
            icon={
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            }
          />
        </div>

        <p className="text-center text-xs text-slate-400 mt-10 tracking-wide">
          © {new Date().getFullYear()} Baudhayan College • SmartAttend
        </p>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, gradient, loading }) {
  return (
    <div className="relative bg-white/90 backdrop-blur-sm rounded-2xl p-4 sm:p-5 border border-white/70 shadow-md shadow-slate-200/40 overflow-hidden group hover:shadow-lg transition-shadow">
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${gradient} opacity-[0.07] rounded-full blur-2xl group-hover:opacity-[0.12] transition-opacity`} />

      <div className="relative">
        <div className="flex items-start justify-between mb-2.5">
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
            {label}
          </span>
          <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradient} text-white shadow-sm`}>
            {icon}
          </div>
        </div>

        {loading ? (
          <div className="h-8 w-16 rounded-lg bg-slate-100 animate-pulse" />
        ) : (
          <div className={`font-heading text-2xl sm:text-3xl font-extrabold bg-gradient-to-br ${gradient} bg-clip-text text-transparent tracking-tight`}>
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

function NavCard({ to, icon, label, gradient }) {
  return (
    <Link
      to={to}
      className="group bg-white/90 backdrop-blur-sm rounded-2xl p-4 border border-white/70 shadow-md hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.97] transition-all duration-200 text-center"
    >
      <div className={`w-11 h-11 mx-auto mb-2.5 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-200`}>
        {icon}
      </div>
      <div className="text-xs sm:text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition-colors tracking-wide">
        {label}
      </div>
    </Link>
  );
}