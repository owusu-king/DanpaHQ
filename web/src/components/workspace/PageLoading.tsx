/** Shared loading content, inside the shell so navigation remains available. */
export function PageLoading({ label = "Loading page" }: { label?: string }) {
  return (
    <section className="page-loading" aria-label={label} aria-busy="true">
      <p className="page-loading-caption" role="status">
        <span className="page-loading-dot" aria-hidden="true" />
        {label}…
      </p>
      <div className="page-loading-shape" aria-hidden="true">
        <div className="page-loading-heading">
          <span className="page-loading-block is-title" />
          <span className="page-loading-block is-description" />
        </div>
        <div className="page-loading-toolbar">
          <span className="page-loading-block is-search" />
          <span className="page-loading-block is-control" />
        </div>
        <div className="page-loading-records">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="page-loading-record" key={index}>
              <span className="page-loading-block is-mark" />
              <span className="page-loading-lines">
                <span className="page-loading-block" />
                <span className="page-loading-block is-detail" />
              </span>
              <span className="page-loading-block is-meta" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
