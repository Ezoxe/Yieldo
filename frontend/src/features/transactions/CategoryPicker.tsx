import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import type { Category } from "../../lib/types";

interface CategoryOption {
  id: number | null;
  label: string;
  depth: 0 | 1;
}

interface CategoryGroup {
  parent: Category;
  options: CategoryOption[];
}

interface CategoryPickerProps {
  value: number | null;
  onChange: (categoryId: number | null) => void;
  categories: Category[];
  placeholder?: string;
  label?: string;
}

const RESET_OPTION: CategoryOption = { id: null, label: "Toutes les catégories", depth: 0 };

// A searchable combobox grouped by parent category: the two-level tree the
// backend hands over flat (parent_id-linked) is rebuilt here, same as every
// other consumer of GET /api/categories.
export function CategoryPicker({
  value,
  onChange,
  categories,
  placeholder = "Toutes les catégories",
  label = "Catégorie",
}: CategoryPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const parents = useMemo(() => categories.filter((c) => c.parent_id === null), [categories]);
  const selected = categories.find((c) => c.id === value) ?? null;

  const groups: CategoryGroup[] = useMemo(
    () =>
      parents.map((parent) => ({
        parent,
        options: [
          { id: parent.id, label: parent.name, depth: 0 as const },
          ...categories
            .filter((child) => child.parent_id === parent.id)
            .map((child) => ({ id: child.id, label: child.name, depth: 1 as const })),
        ],
      })),
    [parents, categories],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups
      .map((group) => {
        const parentMatches = group.parent.name.toLowerCase().includes(normalizedQuery);
        const options = parentMatches
          ? group.options
          : group.options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
        return { parent: group.parent, options };
      })
      .filter((group) => group.options.length > 0);
  }, [groups, normalizedQuery]);

  const flatOptions: CategoryOption[] = useMemo(
    () => [RESET_OPTION, ...visibleGroups.flatMap((group) => group.options)],
    [visibleGroups],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeAndReset();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // Only re-subscribes when the list opens or closes -- closeAndReset itself
    // is stable in everything that matters (it only touches local state setters).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openPicker() {
    setOpen(true);
    setQuery("");
    setActiveIndex(0);
  }

  function closeAndReset() {
    setOpen(false);
    setQuery("");
  }

  function choose(option: CategoryOption) {
    onChange(option.id);
    closeAndReset();
  }

  function onBlur() {
    // Deferred: a mousedown on an option already called preventDefault (see
    // below), so focus never actually left the input for a click-to-select --
    // this only fires closeAndReset for a genuine focus-out (Tab, click elsewhere
    // that isn't caught by the document mousedown listener yet).
    window.setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        closeAndReset();
      }
    }, 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        openPicker();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, flatOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = flatOptions[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndReset();
    }
  }

  const inputId = "yd-category-picker-input";
  const listId = "yd-category-picker-list";

  return (
    <div className="yd-category-picker" ref={containerRef}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className="yd-category-picker__input"
        placeholder={placeholder}
        value={open ? query : (selected?.name ?? "")}
        onFocus={openPicker}
        onBlur={onBlur}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" className="yd-category-picker__list">
          {flatOptions.map((option, index) => (
            <li
              key={option.id ?? "all"}
              role="option"
              aria-selected={option.id === value}
              data-depth={option.depth}
              data-active={index === activeIndex || undefined}
              className="yd-category-picker__option"
              onMouseDown={(event) => {
                // mousedown, not click: firing before blur keeps the input
                // focused so onBlur's outside-click check never sees it as gone.
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {option.label}
            </li>
          ))}
          {flatOptions.length === 1 ? (
            <li className="yd-category-picker__empty" role="presentation">
              Aucune catégorie ne correspond.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
