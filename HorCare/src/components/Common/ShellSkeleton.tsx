/**
 * Loading placeholders in the shape of what is coming — boxes that shimmer, like the branch picker — instead of a
 * spinner on an empty screen. They make a branch or a page feel as if it is already there.
 */

/** The content area while a page's code or data arrives: a title, a row of figures, two panels. */
export function PageSkeleton() {
  return (
    <div className="sk-page" role="status" aria-label="กำลังโหลด">
      <div className="sk-head">
        <span className="sk sk-title" />
        <span className="sk sk-sub" />
      </div>
      <div className="sk-stats">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="sk-card">
            <span className="sk sk-line" style={{ width: '45%' }} />
            <span className="sk sk-figure" />
            <span className="sk sk-line" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
      <div className="sk-panels">
        <div className="sk-card sk-panel">
          <span className="sk sk-line" style={{ width: '30%', height: 16 }} />
          {[92, 78, 85, 64, 88].map((w, i) => <span key={i} className="sk sk-row" style={{ width: `${w}%` }} />)}
        </div>
        <div className="sk-card sk-panel">
          <span className="sk sk-line" style={{ width: '40%', height: 16 }} />
          <span className="sk sk-block" />
        </div>
      </div>
    </div>
  );
}

/** The whole app while a branch loads: the sidebar's frame and the page placeholder. */
export function AppSkeleton() {
  return (
    <div className="app-container sk-app">
      <aside className="sidebar sk-sidebar" aria-hidden>
        <div className="sk-brand"><span className="sk sk-logo" /><span className="sk sk-line" style={{ width: 90 }} /></div>
        <span className="sk sk-branch" />
        {[70, 55, 80, 62, 74, 50, 66, 58].map((w, i) => (
          <div key={i} className="sk-nav"><span className="sk sk-icon" /><span className="sk sk-line" style={{ width: `${w}%` }} /></div>
        ))}
        <div className="sk-foot"><span className="sk sk-avatar" /><span className="sk sk-line" style={{ width: '55%' }} /></div>
      </aside>
      <main className="main-content">
        <PageSkeleton />
      </main>
    </div>
  );
}
