import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Header from '../components/Header';
import Loader from '../components/Loader';

export default function Student() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const data = await api.getSummary();
      setSummary(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      if (refresh) setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const present = summary.filter(s => s.present).length;
  const total = summary.length;
  const rate = total ? Math.round((present / total) * 100) : 0;
  const rateColor = rate >= 75 ? 'from-emerald-500 to-green-600' : rate >= 50 ? 'from-amber-500 to-orange-500' : 'from-red-500 to-rose-600';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-purple-50">
      <Header />

      <main className="max-w-4xl mx-auto px-3 sm:px-5 py-5 sm:py-8">
        <div className="mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900">Students Overview</h1>
          <p className="text-slate-500 text-sm mt-1">Today's attendance summary</p>
        </div>

        {/* Hero stats */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700 rounded-3xl p-6 sm:p-8 text-white mb-5 shadow-2xl shadow-indigo-500/20 overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-white/10 rounded-full blur-3xl" />

          <div className="relative">
            <p className="text-xs uppercase tracking-wider font-bold text-white/70 mb-1">Overall Attendance Today</p>
            {loading ? (
              <div className="skeleton h-16 w-40 rounded-xl bg-white/10" />
            ) : (
              <div className="flex items-baseline gap-3">
                <span className="font-heading text-6xl sm:text-7xl font-extrabold">{rate}</span>
                <span className="text-3xl font-bold opacity-70">%</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <div className="bg-white/15 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold">
                ✅ {present} Present
              </div>
              <div className="bg-white/15 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold">
                ❌ {total - present} Absent
              </div>
              <div className="bg-white/15 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold">
                👥 {total} Total
              </div>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-heading font-bold text-slate-900">All Students</h2>
            <button onClick={() => load(true)}
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-indigo-100 flex items-center justify-center text-slate-600 hover:text-indigo-600 transition">
              <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>

          <div className="p-3 sm:p-4">
            {loading ? (
              <Loader text="Loading..." />
            ) : summary.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-3 opacity-30">📭</div>
                <p className="text-slate-400 font-medium">No students found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {summary.map((s, i) => (
                  <div
                    key={s.StudentID}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition ${
                      s.present
                        ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-100'
                        : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-100'
                    } animate-fade-in-up`}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-md ${
                        s.present ? 'bg-gradient-to-br from-emerald-500 to-green-600' : 'bg-gradient-to-br from-red-500 to-rose-600'
                      }`}>
                        {s.Name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 text-sm truncate">{s.Name}</div>
                        <div className="text-xs text-slate-500 truncate">{s.RollNo} • {s.Course} Sem {s.Semester}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {s.present ? (
                        <>
                          <div className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                            Present
                          </div>
                          {s.time && <div className="text-[10px] text-slate-400 mt-1">{s.time}</div>}
                        </>
                      ) : (
                        <div className="text-xs font-bold text-red-600 bg-red-100 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                          Absent
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          © {new Date().getFullYear()} Baudhayan College • SmartAttend
        </p>
      </main>
    </div>
  );
}