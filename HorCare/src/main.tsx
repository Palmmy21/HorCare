import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import TenantPortalPage from './components/TenantPortal/TenantPortalPage.tsx'

// ── Firestore internal assertion error → auto silent reload ──────────────────
// Firebase SDK can enter a broken state when too many listeners are created /
// destroyed quickly (React dev double-mount, tab switching, etc.).
// The only reliable recovery is a page reload; do it silently so users never
// see the error screen for this specific SDK bug.
function isFirestoreInternalError(msg: string) {
  return msg.includes('FIRESTORE') && msg.includes('INTERNAL ASSERTION FAILED');
}

window.addEventListener('error', (e) => {
  if (isFirestoreInternalError(e.message ?? '')) {
    console.warn('[HorCare] Firestore internal error — reloading...', e.message);
    window.location.reload();
  }
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message ?? String(e.reason ?? '');
  if (isFirestoreInternalError(msg)) {
    console.warn('[HorCare] Firestore internal error (promise) — reloading...', msg);
    e.preventDefault();
    window.location.reload();
  }
});

// Route: ถ้า URL มี query params ?uid= &bid= &rid= → แสดงหน้า Tenant Portal
// Route: ถ้าเป็น path อื่น → แสดง Owner App ปกติ
const params = new URLSearchParams(window.location.search);
const isTenantPortal = params.has('uid') && params.has('bid') && params.has('rid');

// NOTE: StrictMode removed — React 18 StrictMode double-mounts effects in dev,
// which causes Firebase listeners to cycle create→destroy→create faster than
// Firestore's Watch stream can handle, triggering INTERNAL ASSERTION errors.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {isTenantPortal ? <TenantPortalPage /> : <App />}
  </ErrorBoundary>,
)
