import { useEffect, useState } from "react";
import { Link } from "react-router";

import { PanelHead } from "../../design/bento/PanelHead";
import { AlertsIcon } from "../../design/icons";
import { formatCents } from "../../design/theme";
import { api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { AlertReport, ImportBatch } from "../../lib/types";
import "./WhatChangedPanel.css";

/** Whole days between an ISO timestamp and `now`, floored. */
export function daysSince(iso: string, now: Date): number {
  const then = new Date(iso);
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

/** « il y a N jours », with the two short cases said in words. */
export function agoSentence(days: number): string {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}

interface WhatChangedPanelProps {
  /** The clock, passed in so the sentence is testable at any date. */
  now?: Date;
}

/**
 * What the household should know before reading the figures: the alerts in
 * force, and how old the ledger is.
 *
 * Both used to live only on the screen that computed them. An alert raised
 * in March was news in April, when someone opened Alertes; and no screen
 * ever said « your last statement is 23 days old », which is the first
 * thing that decides whether the figures under it mean anything.
 *
 * Two requests of its own, failing separately: a broken alerts engine must
 * not hide the age of the ledger, and the reverse. A failure is printed in
 * its row, never an empty row that reads as « rien à signaler ».
 */
export function WhatChangedPanel({ now = new Date() }: WhatChangedPanelProps) {
  const [alerts, setAlerts] = useState<AlertReport | null | "failed">(null);
  const [batches, setBatches] = useState<ImportBatch[] | null | "failed">(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AlertReport>("/alerts")
      .then((body) => {
        if (!cancelled) setAlerts(body);
      })
      .catch(() => {
        if (!cancelled) setAlerts("failed");
      });
    api
      .get<ImportBatch[]>("/imports")
      .then((body) => {
        if (!cancelled) setBatches(body);
      })
      .catch(() => {
        if (!cancelled) setBatches("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest =
    batches === null || batches === "failed" || batches.length === 0
      ? null
      : batches.reduce((a, b) => (a.created_at >= b.created_at ? a : b));

  return (
    <>
      <PanelHead icon={AlertsIcon}>Ce qui a changé</PanelHead>
      <ul className="yd-changed" data-testid="yd-changed">
        <li className="yd-changed__row">
          {batches === null ? (
            <span className="yd-skeleton yd-changed__skeleton" aria-hidden="true" />
          ) : batches === "failed" ? (
            <span className="yd-changed__failed">L'historique des imports n'a pas pu être lu.</span>
          ) : latest === null ? (
            <span>
              Aucun relevé importé pour l'instant.{" "}
              <Link to="/import" className="yd-changed__link">
                Importer
              </Link>
            </span>
          ) : (
            <span>
              {`Dernier import ${agoSentence(daysSince(latest.created_at, now))} — ${latest.filename}, ${latest.rows_imported} ${plural(latest.rows_imported, "opération", "opérations")}.`}{" "}
              <Link to="/import" className="yd-changed__link">
                Importer
              </Link>
            </span>
          )}
        </li>

        {alerts === null ? (
          <li className="yd-changed__row">
            <span className="yd-skeleton yd-changed__skeleton" aria-hidden="true" />
          </li>
        ) : alerts === "failed" ? (
          <li className="yd-changed__row">
            <span className="yd-changed__failed">Les alertes n'ont pas pu être mesurées.</span>
          </li>
        ) : alerts.alerts.length === 0 ? (
          <li className="yd-changed__row">
            <span>Aucune alerte en cours sur vos relevés.</span>
          </li>
        ) : (
          alerts.alerts.map((alert) => (
            <li key={alert.key} className={`yd-changed__row yd-changed__row--${alert.severity}`}>
              <span className="yd-changed__alert">
                <span className={`yd-changed__severity yd-changed__severity--${alert.severity}`}>
                  {alert.severity_label}
                </span>
                <Link to="/alertes" className="yd-changed__title">
                  {alert.title}
                </Link>
                {alert.amount_cents !== null ? (
                  <span className="yd-num yd-changed__amount">{formatCents(alert.amount_cents)}</span>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
