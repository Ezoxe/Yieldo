import { Link } from "react-router";

import { YieldoMark } from "../../design/icons";

/**
 * Whose door this is. The sign-in and sign-up cards floated alone on the
 * atmosphere, with no mark and no way back to the landing page: a reader
 * who arrived from a bookmark could not tell which application was asking
 * for a password, and a visitor who clicked « Se connecter » by mistake had
 * only the browser's back button. The mark is the one drawn for the sidebar;
 * the link is the landing page.
 */
export function AuthBrand() {
  return (
    <div className="yd-auth__brand">
      <Link to="/" className="yd-auth__brand-link">
        <YieldoMark />
        <span>Yieldo</span>
      </Link>
      <Link to="/" className="yd-auth__home">
        Accueil
      </Link>
    </div>
  );
}
