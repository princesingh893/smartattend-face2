import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { saveAdminSession, isAdminLoggedIn } from '../lib/auth';
import AppShell from '../components/AppShell';
import { Button, Card, Input } from '../components/ui';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    if (isAdminLoggedIn()) nav('/admin', { replace: true });
  }, [nav]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.adminLogin(email, password);
      if (res.success) {
        saveAdminSession(res.token, res.email);
        nav('/admin', { replace: true });
      } else {
        setError(res.message || 'Invalid credentials');
        setLoading(false);
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <AppShell title="Admin Login" subtitle="Authorized personnel only">
      <div className="flex items-start justify-center pt-4 sm:pt-10">
        <div className="w-full max-w-sm">
          <Card className="p-6 sm:p-7">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Admin Login
                </h2>
                <p className="text-xs text-slate-500">
                  Sign in to manage students
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div
                  className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium animate-fade-in"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <Input
                label="Email"
                type="email"
                icon={Mail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="admin@email.com"
                autoComplete="email"
              />

              <div>
                <label
                  htmlFor="admin-password"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                    aria-hidden
                  />
                  <input
                    id="admin-password"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-11 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 disabled:bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((s) => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md"
                  >
                    {showPass ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                icon={LogIn}
                loading={loading}
                className="w-full"
              >
                {loading ? 'Verifying…' : 'Sign In'}
              </Button>
            </form>
          </Card>

          <p className="text-center text-xs text-slate-400 mt-5">
            Secure access · Baudhayan College
          </p>
        </div>
      </div>
    </AppShell>
  );
}
