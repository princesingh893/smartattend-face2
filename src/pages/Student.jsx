import { useEffect, useState } from 'react';
import { Users, UserCheck, UserX, Percent, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import { Card, CardHeader, StatCard, EmptyState, Badge } from '../components/ui';
import { SkeletonRows } from '../components/ui/Skeleton';

export default function Student() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

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

  const q = search.trim().toLowerCase();
  const filtered = q
    ? summary.filter(
        (s) =>
          String(s.Name || '').toLowerCase().includes(q) ||
          String(s.RollNo || '').toLowerCase().includes(q)
      )
    : summary;

  return (
    <AppShell
      title="Students"
      subtitle="Today's attendance overview"
      actions={
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="Refresh"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Attendance Rate" value={`${rate}%`} icon={Percent} accent={rate >= 75 ? 'green' : rate >= 50 ? 'amber' : 'red'} loading={loading} />
        <StatCard label="Present" value={present} icon={UserCheck} accent="green" loading={loading} />
        <StatCard label="Absent" value={total - present} icon={UserX} accent="red" loading={loading} />
        <StatCard label="Total Students" value={total} icon={Users} accent="slate" loading={loading} />
      </div>

      {/* List */}
      <Card>
        <CardHeader
          title="All Students"
          subtitle={loading ? undefined : `${present} present · ${total - present} absent`}
          action={
            <div className="relative w-44 sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search students"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
          }
        />

        <div className="p-3 sm:p-4">
          {loading ? (
            <SkeletonRows rows={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={q ? 'No students match your search' : 'No students found'}
              description={q ? 'Try a different name or roll number.' : 'Students enrolled by admin will appear here.'}
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((s) => (
                <li
                  key={s.StudentID}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                        s.present
                          ? 'bg-green-50 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {s.Name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {s.Name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {s.RollNo} · {s.Course} Sem {s.Semester}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {s.present ? (
                      <>
                        <Badge variant="success">Present</Badge>
                        {s.time && (
                          <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                            {s.time}
                          </p>
                        )}
                      </>
                    ) : (
                      <Badge variant="danger">Absent</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <p className="text-center text-xs text-slate-400 mt-8">
        © {new Date().getFullYear()} Baudhayan College · SmartAttend
      </p>
    </AppShell>
  );
}
