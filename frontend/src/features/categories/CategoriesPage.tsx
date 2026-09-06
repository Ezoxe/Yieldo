import { motion } from "motion/react";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { EmptyState } from "../../design/EmptyState";
import { CategoriesIcon, PlusIcon } from "../../design/icons";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { PageHead } from "../../design/PageHead";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import type { Category } from "../../lib/types";
import "./CategoriesPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * The tree, two levels deep, in the order the backend already sorts it.
 *
 * A child whose parent is missing would vanish from the screen while still
 * existing in the database, so it is surfaced as its own root rather than
 * silently dropped — the same rule the picker follows.
 */
export function groupByParent(
  categories: Category[],
): { parent: Category; children: Category[] }[] {
  const parents = categories.filter((category) => category.parent_id === null);
  const known = new Set(parents.map((parent) => parent.id));
  const orphans = categories.filter(
    (category) => category.parent_id !== null && !known.has(category.parent_id),
  );
  return [...parents, ...orphans].map((parent) => ({
    parent,
    children: categories.filter((child) => child.parent_id === parent.id),
  }));
}

/** A monthly ceiling typed by a person, as integer cents — or null for "no
 *  ceiling", which is what an empty field means and what the column stores. */
export function parseBudget(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

const SPAN = {
  tree: { base: 1, md: 6, lg: 8 },
  add: { base: 1, md: 6, lg: 4 },
} satisfies Record<string, BentoSpan>;

interface RowProps {
  category: Category;
  depth: 0 | 1;
  onChanged: () => void;
}

function CategoryRow({ category, depth, onChanged }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [budget, setBudget] = useState(
    category.monthly_budget_cents === null
      ? ""
      : (category.monthly_budget_cents / 100).toFixed(2).replace(".", ","),
  );
  const [essential, setEssential] = useState(category.is_essential);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError("Le nom est obligatoire.");
      return;
    }
    const cents = parseBudget(budget);
    if (cents === undefined) {
      setError("Le budget doit être un nombre positif, avec au plus deux décimales.");
      return;
    }
    setSaving(true);
    try {
      await api.patch<Category>(`/categories/${category.id}`, {
        name: name.trim(),
        color,
        monthly_budget_cents: cents,
        is_essential: essential,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    setSaving(true);
    try {
      await api.delete(`/categories/${category.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      setSaving(false);
    }
  }

  return (
    <li className={`yd-categories__row yd-categories__row--depth-${depth}`}>
      <div className="yd-categories__line">
        <span
          className="yd-categories__dot"
          aria-hidden="true"
          style={{ "--yd-pill": category.color } as CSSProperties}
        />
        <span className="yd-categories__name">{category.name}</span>
        {category.is_essential ? (
          <span className="yd-categories__badge">essentielle</span>
        ) : null}
        <span className="yd-categories__budget yd-num">
          {category.monthly_budget_cents === null
            ? "Sans budget"
            : `${formatCents(category.monthly_budget_cents)} / mois`}
        </span>
        <span className="yd-categories__actions">
          <button type="button" onClick={() => setEditing((open) => !open)} disabled={saving}>
            {editing ? "Fermer" : "Modifier"}
          </button>
          <button type="button" onClick={() => void remove()} disabled={saving}>
            Supprimer
          </button>
        </span>
      </div>

      {editing ? (
        <form className="yd-categories__form" onSubmit={save}>
          <div className="yd-categories__field">
            <label htmlFor={`category-name-${category.id}`}>Nom</label>
            <input
              id={`category-name-${category.id}`}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="yd-categories__field">
            <label htmlFor={`category-color-${category.id}`}>Couleur</label>
            <input
              id={`category-color-${category.id}`}
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
          <div className="yd-categories__field">
            <label htmlFor={`category-budget-${category.id}`}>Budget mensuel (€)</label>
            <input
              id={`category-budget-${category.id}`}
              type="text"
              inputMode="decimal"
              className="yd-num"
              placeholder="Sans budget"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </div>
          <label className="yd-categories__check" htmlFor={`category-essential-${category.id}`}>
            <input
              id={`category-essential-${category.id}`}
              type="checkbox"
              checked={essential}
              onChange={(event) => setEssential(event.target.checked)}
            />
            <span>Dépense essentielle</span>
          </label>
          {error !== null ? (
            <p className="yd-categories__error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="yd-categories__save" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      ) : error !== null ? (
        <p className="yd-categories__error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function NewCategoryForm({
  parents,
  onCreated,
}: {
  parents: Category[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [kind, setKind] = useState("expense");
  const [color, setColor] = useState("#7ee2d6");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim() === "") {
      setError("Le nom est obligatoire.");
      return;
    }
    setSaving(true);
    try {
      await api.post<Category>("/categories", {
        name: name.trim(),
        parent_id: parentId === "" ? null : Number(parentId),
        kind,
        color,
      });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="yd-categories__new" onSubmit={submit}>
      <div className="yd-categories__field">
        <label htmlFor="category-new-name">Nom</label>
        <input
          id="category-new-name"
          type="text"
          placeholder="Abonnements"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="yd-categories__field">
        <label htmlFor="category-new-parent">Rattachée à</label>
        <select
          id="category-new-parent"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">Aucune — catégorie principale</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
      </div>
      <div className="yd-categories__field">
        <label htmlFor="category-new-kind">Type</label>
        <select
          id="category-new-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="expense">Dépense</option>
          <option value="income">Recette</option>
          <option value="transfer">Virement</option>
        </select>
      </div>
      <div className="yd-categories__field">
        <label htmlFor="category-new-color">Couleur</label>
        <input
          id="category-new-color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </div>
      {error !== null ? (
        <p className="yd-categories__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="yd-categories__save" disabled={saving}>
        {saving ? "Création…" : "Ajouter la catégorie"}
      </button>
      <p className="yd-categories__note">
        La hiérarchie s'arrête à deux niveaux. Supprimer une catégorie principale supprime ses
        sous-catégories ; les opérations classées dedans ne sont jamais supprimées, elles
        redeviennent non catégorisées.
      </p>
    </form>
  );
}

/**
 * The category tree, and the screen that was a placeholder.
 *
 * `/api/categories` has carried create, rename, recolour, budget, essential and
 * delete since phase 1; the route rendered "Catégories — à venir." on top of
 * all of it, which meant a monthly ceiling could only be set from the budgets
 * screen and a category could not be renamed at all.
 */
export function CategoriesPage() {
  const reduced = useReducedMotion();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api.get<Category[]>("/categories");
        if (!cancelled) setCategories(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = () => setToken((value) => value + 1);
  const groups = categories === null ? [] : groupByParent(categories);
  const parents = categories === null ? [] : categories.filter((c) => c.parent_id === null);

  return (
    <section className="yd-categories">
      <PageHead icon={CategoriesIcon} title="Catégories">
        <p>
          L'arborescence qui classe vos opérations, et le plafond mensuel de chacune. Une
          correction de catégorie sur une transaction devient une règle ; c'est ici que se règle
          ce dans quoi elle range.
        </p>
      </PageHead>

      {error !== null ? (
        <p role="alert" className="yd-categories__error">
          {error}
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.tree} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={CategoriesIcon}>Votre arborescence</PanelHead>
          {categories !== null && categories.length === 0 ? (
            <EmptyState
              title="Aucune catégorie."
              detail="Les catégories par défaut sont créées avec votre compte ; si la liste est vide, ajoutez-en une à droite."
            />
          ) : (
            <ul className="yd-categories__list" aria-label="Votre arborescence">
              {groups.map(({ parent, children }) => (
                <li key={parent.id} className="yd-categories__group">
                  <ul className="yd-categories__list">
                    <CategoryRow category={parent} depth={0} onChanged={reload} />
                    {children.map((child) => (
                      <CategoryRow
                        key={child.id}
                        category={child}
                        depth={1}
                        onChanged={reload}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.add} className="yd-panel" {...entryProps(reduced)}>
          <PanelHead icon={PlusIcon}>Ajouter une catégorie</PanelHead>
          <NewCategoryForm parents={parents} onCreated={reload} />
        </BentoCell>
      </BentoGrid>
    </section>
  );
}
