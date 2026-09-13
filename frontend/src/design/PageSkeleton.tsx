import "./Skeleton.css";
import "./PageSkeleton.css";

/**
 * What a screen looks like before its own code has arrived.
 *
 * Every route is loaded on demand (see app/routes.tsx), and the moment
 * between the click and the chunk landing is this: the shape of a PageHead
 * and three panels, drawn with the same shimmering bar every screen uses
 * for its own data. It says nothing — no title, because the title is in the
 * chunk — and it is announced as busy so a screen reader hears a wait, not
 * an empty page.
 */
export function PageSkeleton() {
  return (
    <div className="yd-page-skeleton" role="status" aria-busy="true" aria-label="Chargement de l'écran">
      <div className="yd-page-skeleton__head">
        <div className="yd-skeleton yd-page-skeleton__mark" aria-hidden="true" />
        <div className="yd-page-skeleton__titles">
          <div className="yd-skeleton yd-page-skeleton__title" aria-hidden="true" />
          <div className="yd-skeleton yd-page-skeleton__lead" aria-hidden="true" />
        </div>
      </div>
      <div className="yd-page-skeleton__panels">
        <div className="yd-skeleton yd-page-skeleton__panel" aria-hidden="true" />
        <div className="yd-skeleton yd-page-skeleton__panel" aria-hidden="true" />
        <div className="yd-skeleton yd-page-skeleton__panel yd-page-skeleton__panel--wide" aria-hidden="true" />
      </div>
    </div>
  );
}
