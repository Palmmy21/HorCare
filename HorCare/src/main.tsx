import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import TenantPortalPage from './components/TenantPortal/TenantPortalPage.tsx'
import TenantGateway from './components/TenantPortal/TenantGateway.tsx'
import StaffWorkPage from './components/WorkOrders/StaffWorkPage.tsx'
import WalkInPage from './components/Market/WalkInPage.tsx'
import ListingPage from './components/Listing/ListingPage.tsx'

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

// Route: /portal            → TenantGateway (LIFF auto-identify → redirect to portal)
// Route: ?p=<link>           → TenantPortalPage (the room's portal link, checked by /api/portal)
//        ?uid=&bid=&rid=    → TenantPortalPage, which explains that old links no longer open a portal
// Route: ?w=<link>           → StaffWorkPage (technician / housekeeper job, opened from LINE)
// Route: ?walkin=1&uid=&bid= → WalkInPage (public form for walk-in market vendors)
// Route: ?listing=<slug>     → ListingPage (public vacancy page + viewing requests, checked by /api/listing)
// Route: everything else    → Owner App
const params = new URLSearchParams(window.location.search);
const isTenantGateway = window.location.pathname === '/portal';
const isTenantPortal = params.has('p') || (params.has('uid') && params.has('bid') && params.has('rid'));
const isStaffWork = params.has('w');
const isWalkIn = params.has('walkin') && params.has('uid') && params.has('bid');
const isListing = params.has('listing');

// eslint-disable-next-line react-refresh/only-export-components
function Root() {
  if (isTenantGateway) return <TenantGateway />;
  if (isStaffWork) return <StaffWorkPage />;
  if (isWalkIn) return <WalkInPage />;
  if (isListing) return <ListingPage />;
  if (isTenantPortal) return <TenantPortalPage />;
  return <App />;
}

import { Toaster } from 'react-hot-toast';

// NOTE: StrictMode removed — React 18 StrictMode double-mounts effects in dev,
// which causes Firebase listeners to cycle create→destroy→create faster than
// Firestore's Watch stream can handle, triggering INTERNAL ASSERTION errors.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Root />
    <Toaster position="top-center" toastOptions={{ duration: 4000, style: { background: '#333', color: '#fff', borderRadius: '12px', fontSize: '14px', fontWeight: 500 } }} />
  </ErrorBoundary>,
)
