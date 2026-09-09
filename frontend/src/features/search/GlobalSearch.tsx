import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { SCREENS, type NavItem } from "../../app/navigation";
import {
  CategoriesIcon,
  CoinsIcon,
  DebtsIcon,
  GoalsIcon,
  RecurrencesIcon,
  SearchIcon,
  TransactionsIcon,
  type IconComponent,
} from "../../design/icons";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { SearchGroup, SearchResults } from "../../lib/types";
import "./GlobalSearch.css";

const DEBOUNCE_MS = 250;
/** One letter matches half the ledger; two is where an answer starts. */
const MIN_TERM = 2;

/** Accents off, case off — "recurrences" must find « Récurrences ». */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The screens the term names, in sidebar order.
 *
 * Client-side and free: the list of destinations is already in the bundle, so
 * typing "Import" reaches the screen with no round trip and no spinner. The
 * aliases in `app/navigation.ts` are what let a household find a screen by the
 * word they use for it rather than the word the sidebar prints.
 */
export function matchScreens(term: string, screens: NavItem[] = SCREENS): NavItem[] {
  const needle = fold(term.trim());
  if (needle.length === 0) return [];
  return screens.filter(
    (screen) =>
      fold(screen.label).includes(needle) ||
      (screen.aliases ?? []).some((alias) => fold(alias).includes(needle)),
  );
}

const GROUP_ICONS: Record<string, IconComponent> = {
  transaction: TransactionsIcon,
  account: CoinsIcon,
  category: CategoriesIcon,
  recurrence: RecurrencesIcon,
  goal: GoalsIcon,
  debt: DebtsIcon,
};

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function messageFor(err: unknown): string {
  return err instanceof ApiError
    ? err.detail
    : "La recherche dans vos données n'a pas abouti.";
}

/**
 * One box for the whole application, in the header.
 *
 * It answers from two places and says which is which. The SCREENS come from
 * the bundle and cost nothing; the DATA comes from `GET /search`, read-only and
 * scoped to this account by the same dependency every other route uses. When
 * the server cannot be reached the screens are still listed and the failure is
 * printed beside them — a search that quietly returned "rien trouvé" because
 * the network was down would be the silent fallback this codebase refuses.
 *
 * It replaces the ledger-mode control that used to sit here. That control set a
 * reading once in a while; this one is used to get somewhere, which is what a
 * permanent slot in the header is for.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K, the shortcut every search box of this shape answers to.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setResults(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_TERM) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    // `cancelled` is the whole concurrency story: a slower answer to an older
    // term must never overwrite the newer one on screen.
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api
        .get<SearchResults>("/search", { q: term, limit: 5 })
        .then((body) => {
          if (cancelled) return;
          setResults(body);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setResults(null);
          setError(messageFor(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  const screens = useMemo(() => matchScreens(query), [query]);
  const groups: SearchGroup[] = results?.groups ?? [];
  const dataCount = groups.reduce((total, group) => total + group.items.length, 0);
  const term = query.trim();
  const searched = term.length >= MIN_TERM;
  const nothing =
    searched && !loading && error === null && screens.length === 0 && dataCount === 0;

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="yd-search">
      <button
        ref={triggerRef}
        type="button"
        className="yd-search__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <SearchIcon />
        {/* Visually hidden below 900px, where the header holds the menu, this
            and the assistant on one 375px line. The accessible name never
            changes: a control is never named by a drawing alone. */}
        <span className="yd-search__trigger-label">Rechercher</span>
        <kbd className="yd-search__kbd" aria-hidden="true">Ctrl K</kbd>
      </button>

      {open ? (
        <>
          <div className="yd-search__scrim" onClick={close} aria-hidden="true" />
          <div className="yd-search__panel" role="dialog" aria-modal="true" aria-label="Recherche">
            <label className="yd-search__field">
              <span className="sr-only">Rechercher partout</span>
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                placeholder="Une transaction, un compte, une catégorie, un écran…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="yd-search__results">
              {screens.length > 0 ? (
                <section className="yd-search__group">
                  <p className="yd-search__group-head">Écrans</p>
                  <ul>
                    {screens.map((screen) => (
                      <li key={screen.to}>
                        <Link to={screen.to} onClick={close} className="yd-search__hit">
                          <span className="yd-search__hit-mark" aria-hidden="true">
                            <screen.icon />
                          </span>
                          <span className="yd-search__hit-label">{screen.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {groups
                .filter((group) => group.items.length > 0)
                .map((group) => {
                  const GroupIcon = GROUP_ICONS[group.kind] ?? SearchIcon;
                  return (
                    <section className="yd-search__group" key={group.kind}>
                      <p className="yd-search__group-head">{group.label}</p>
                      <ul>
                        {group.items.map((hit) => (
                          <li key={`${hit.kind}-${hit.id}`}>
                            <Link
                              to={hit.kind === "transaction"
                                ? `${hit.route}?q=${encodeURIComponent(hit.label)}`
                                : hit.route}
                              onClick={close}
                              className="yd-search__hit"
                            >
                              <span className="yd-search__hit-mark" aria-hidden="true">
                                <GroupIcon />
                              </span>
                              {/* Label and figures in one wrapper, because at
                                  375px they cannot share a line: the label is
                                  what tells two hits apart, so it keeps the
                                  full width and the figures drop below it. On
                                  a wide row the wrapper is a single line. */}
                              <span className="yd-search__hit-body">
                                <span className="yd-search__hit-label">{hit.label}</span>
                                <span className="yd-search__hit-meta">
                                  {hit.detail !== null ? (
                                    <span className="yd-search__hit-detail">{hit.detail}</span>
                                  ) : null}
                                  {hit.date !== null ? (
                                    <span className="yd-search__hit-detail">
                                      {formatDay(hit.date)}
                                    </span>
                                  ) : null}
                                  {hit.amount_cents !== null ? (
                                    <span className="yd-search__hit-amount yd-num">
                                      {formatCents(hit.amount_cents)}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}

              {error !== null ? (
                <p className="yd-search__error" role="alert">
                  {error} Les écrans restent accessibles ci-dessus.
                </p>
              ) : null}

              {loading ? <p className="yd-search__note">Recherche en cours…</p> : null}

              {nothing ? (
                <p className="yd-search__note">
                  Rien ne correspond à « {term} », ni dans vos données ni dans les écrans.
                </p>
              ) : null}

              {!searched && error === null ? (
                <p className="yd-search__note">
                  Tapez au moins deux lettres : un libellé, un montant, une date, un
                  compte, une catégorie ou le nom d'un écran.
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
