// ============================================
// Admin Auth — token-based (NO password in code)
// ============================================

const STORAGE_KEY = 'smartattend_admin_session';

export function saveAdminSession(token, email) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    token,
    email,
    ts: Date.now(),
  }));
}

export function getAdminSession() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // 7 days expiry
    if (Date.now() - parsed.ts > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isAdminLoggedIn() {
  return !!getAdminSession();
}

export function logoutAdmin() {
  localStorage.removeItem(STORAGE_KEY);
}