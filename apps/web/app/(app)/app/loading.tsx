/**
 * Shown inside the shell while a page's data loads: the same shape as every page (header, a row
 * of tiles, a panel of rows) so the eye lands where the content will appear. The navigation and
 * top bar come from the layout and stay put.
 */
export default function Loading() {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-label="Loading">
      <div className="page-skeleton__header">
        <span className="page-skeleton__line page-skeleton__line--kicker" />
        <span className="page-skeleton__line page-skeleton__line--title" />
        <span className="page-skeleton__line page-skeleton__line--intro" />
      </div>
      <div className="app-panel page-skeleton__panel">
        <div className="metric-grid">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="page-skeleton__tile" />
          ))}
        </div>
      </div>
      <div className="app-panel page-skeleton__panel">
        <span className="page-skeleton__line page-skeleton__line--kicker" />
        <span className="page-skeleton__line page-skeleton__line--heading" />
        {[0, 1, 2].map((index) => (
          <span key={index} className="page-skeleton__row" />
        ))}
      </div>
      <span className="visually-hidden">Loading…</span>
    </div>
  );
}
