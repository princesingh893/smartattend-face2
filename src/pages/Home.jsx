import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScanFace,
  Users,
  UserCheck,
  UserX,
  Percent,
  RefreshCw,
  ClipboardList,
} from 'lucide-react';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import { Button, Card, CardHeader, StatCard, EmptyState, Badge } from '../components/ui';
import { SkeletonRows } from '../components/ui/Skeleton';

export default function Home() {
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

  const stats = useMemo(() => {
    const present = attendance.length;
    const total = students.length;
    const absent = Math.max(0, total - present);
    const rate = total ? Math.round((present / total) * 100) : 0;
    return { present, total, absent, rate };
  }, [attendance, students]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <AppShell
      title="Dashboard"
      subtitle={today}
      actions={
        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          aria-label="Refresh attendance"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {/* Greeting + primary CTA */}
      <div className="mb-6">
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">
          {greeting} 👋
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {loading
            ? 'Fetching today’s attendance…'
            : `${stats.present} of ${stats.total} students present today`}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Total Students" value={stats.total} icon={Users} accent="slate" loading={loading} />
        <StatCard label="Present Today" value={stats.present} icon={UserCheck} accent="green" loading={loading} />
        <StatCard label="Absent Today" value={stats.absent} icon={UserX} accent="red" loading={loading} />
        <StatCard label="Attendance Rate" value={`${stats.rate}%`} icon={Percent} accent="blue" loading={loading} />
      </div>

      {/* Primary action */}
      <Card className="mb-6 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ScanFace className="w-6 h-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900">
              Take attendance
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Start the face scanner — multiple students are recognised automatically.
            </p>
          </div>
        </div>
        <Button
          size="lg"
          icon={ScanFace}
          className="w-full sm:w-auto shrink-0"
          onClick={() => nav('/scan')}
        >
          Start Attendance
        </Button>
      </Card>

      {/* Today's attendance */}
      <Card>
        <CardHeader
          title="Today's Attendance"
          subtitle={loading ? undefined : `${stats.present} / ${stats.total} marked`}
          action={
            stats.present > 0 ? <Badge variant="success">Live</Badge> : undefined
          }
        />
        <div className="p-3 sm:p-4">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : attendance.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No attendance marked yet"
              description="Start your first attendance session to see records here."
              actionLabel="Start Attendance"
              onAction={() => nav('/scan')}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {attendance.map((a, i) => (
                <li
                  key={`${a.StudentID}-${i}`}
                  className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-green-50 text-green-700 flex items-center justify-center text-sm font-semibold shrink-0">
                      {String(a.Name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {a.Name}
                      </p>
                      {a.RollNo && (
                        <p className="text-xs text-slate-500 truncate">{a.RollNo}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-400 tabular-nums">
                      {a.Timestamp}
                    </span>
                    <Badge variant="success">Present</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <p className="text-center text-xs text-slate-400 mt-10">
        © {new Date().getFullYear()} Baudhayan College · SmartAttend
      </p>
    </AppShell>
  );
}
