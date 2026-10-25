import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { PanelHead } from "../../design/bento/PanelHead";
import { AssistantIcon } from "../../design/icons";
import { entryProps } from "../../design/motion/variants";
import { ApiError, api, fetchFile } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { PendingImport } from "../../lib/types";
import { batchDateTime } from "./ImportHistory";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

interface PreparedImportsProps {
  /** Hands the prepared file to the wizard, on its own account. */
  onOpen: (item: PendingImport, file: File) => Promise<void>;
  span: BentoSpan;
  reduced: boolean;
  disabled?: boolean;
}

/**
 * « Préparé par Claude » — statements the Yieldo Finance connector analysed
 * and left here.
 *
 * Nothing in this list is imported. « Ouvrir » downloads the file and gives it
 * to the ordinary wizard, so the columns are confirmed by the household on
 * the very step a dropped file goes through. Renders nothing while there is
 * nothing prepared: the panel is not a feature to discover, it is a message.
 */
export function PreparedImports({ onOpen, span, reduced, disabled = false }: PreparedImportsProps) {
  const [items, setItems] = useState<PendingImport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<PendingImport[]>("/imports/pending"));
      setError(null);
    } catch (err) {
      setItems(null);
      setError(messageFor(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(item: PendingImport) {
    setBusyId(item.id);
    setError(null);
    try {
      const blob = await fetchFile(`/imports/pending/${item.id}/file`);
      await onOpen(item, new File([blob], item.filename, { type: "text/csv" }));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusyId(null);
    }
  }

  async function setAside(item: PendingImport) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.delete(`/imports/pending/${item.id}`);
      setItems((current) => (current ?? []).filter((row) => row.id !== item.id));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusyId(null);
    }
  }

  if (error === null && (items === null || items.length === 0)) return null;

  return (
    <BentoCell
      as={motion.section}
      span={span}
      className="yd-panel yd-prepared"
      aria-labelledby="yd-prepared-title"
      {...entryProps(reduced)}
    >
      <PanelHead icon={AssistantIcon}>
        <span id="yd-prepared-title">Préparé par Claude</span>
      </PanelHead>
      <p className="yd-import__hint">
        Claude a lu ces relevés sans rien importer. Ouvrez-en un pour vérifier ses colonnes,
        puis validez-le comme un fichier que vous auriez déposé.
      </p>

      {error ? (
        <p role="alert" className="yd-import__alert">
          {error}
        </p>
      ) : null}

      {items && items.length > 0 ? (
        <ul className="yd-import-history__list">
          {items.map((item) => (
            <li className="yd-import-history__item" key={item.id}>
              <div className="yd-import-history__head">
                <span className="yd-import-history__filename">{item.filename}</span>
                <span className="yd-import-history__date">
                  {item.account_name} · {batchDateTime(item.created_at)} ·{" "}
                  <span className="yd-num">{item.rows}</span>{" "}
                  {plural(item.rows, "ligne lue", "lignes lues")}
                </span>
              </div>
              <div className="yd-prepared__actions">
                <button
                  type="button"
                  className="yd-prepared__open"
                  onClick={() => void open(item)}
                  disabled={disabled || busyId !== null}
                >
                  Ouvrir
                </button>
                <button
                  type="button"
                  className="yd-import-history__rollback"
                  onClick={() => void setAside(item)}
                  disabled={busyId !== null}
                >
                  Écarter
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </BentoCell>
  );
}
