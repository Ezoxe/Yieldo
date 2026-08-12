import { motion } from "motion/react";

import { CountUp } from "../../design/CountUp";
import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import "./DesignSystemPage.css";

// A sample figure, in cents like every amount in this app.
const SAMPLE_AMOUNT_CENTS = 1_847_320;

const STATUS_SWATCHES = [
  { token: "--yd-accent", label: "accent" },
  { token: "--yd-positive", label: "positif" },
  { token: "--yd-negative", label: "négatif" },
  { token: "--yd-warning", label: "alerte" },
  { token: "--yd-info", label: "info" },
];

/**
 * Development-only instrument: every phase 1.5 visual primitive on one screen,
 * so they can be judged in a browser instead of in jsdom. It is registered in
 * `app/routes.tsx` only when `import.meta.env.DEV` is true, and never appears
 * in the sidebar navigation.
 */
export function DesignSystemPage() {
  const reducedMotion = useReducedMotion();

  return (
    <div>
      <header className="yd-ds__intro">
        <h1>Système visuel</h1>
        <p>
          Écran de contrôle interne. Chaque cellule démontre une primitive : fond
          atmosphérique, grille bento, courbe de mouvement signature, compteur animé.
          {reducedMotion
            ? " Le mouvement est actuellement désactivé : rien ne doit bouger."
            : " Le mouvement est actuellement actif."}
        </p>
      </header>

      <BentoGrid as={motion.div} {...staggerProps(reducedMotion)}>
        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 6, lg: 6 }}
          rows={2}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Primitive</p>
          <h2 className="yd-ds__title">Fond atmosphérique</h2>
          <p className="yd-ds__caption">
            Un dégradé de base, jamais noir pur, et trois halos ambiants flous posés
            au-dessus. Ils oscillent sur 28 s, 36 s et 44 s, décalés pour ne jamais se
            déplacer ensemble : le mouvement doit se sentir sans se regarder. Visible ici
            entre les cellules et autour de la grille.
          </p>
          <p className="yd-ds__caption">
            Sous préférence « mouvement réduit », les halos sont rendus fixes — sans
            animation du tout, pas une animation de durée nulle.
          </p>
          <div className="yd-ds__swatches">
            {STATUS_SWATCHES.map((swatch) => (
              <span
                key={swatch.token}
                className="yd-ds__swatch"
                style={{ color: `var(${swatch.token})` }}
              >
                {swatch.label}
              </span>
            ))}
          </div>
        </BentoCell>

        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 3, lg: 3 }}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Primitive</p>
          <h2 className="yd-ds__title">Compteur animé</h2>
          <CountUp
            value={SAMPLE_AMOUNT_CENTS}
            format={(cents) => formatCents(cents)}
            className="yd-ds__figure"
          />
          <p className="yd-ds__caption">
            Geist Mono en chiffres tabulaires : la largeur des colonnes ne bouge pas
            pendant le décompte.
          </p>
        </BentoCell>

        {/* Rendered as a real <button>, so the focus ring has something to attach
            to. Its children are spans, not headings: a button may only contain
            phrasing content. */}
        <BentoCell
          as={motion.button}
          type="button"
          interactive
          {...entryProps(reducedMotion)}
          span={{ md: 3, lg: 3 }}
          className="yd-ds__cell"
        >
          <span className="yd-ds__label">État</span>
          <span className="yd-ds__title">Cellule interactive</span>
          <span className="yd-ds__caption">
            Survolez : la cellule monte de 2 px et sa bordure se renforce. Tabulez
            jusqu'ici : un anneau de focus visible apparaît. Aucun agrandissement, qui
            décalerait la mise en page.
          </span>
        </BentoCell>

        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 3, lg: 3 }}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Jeton</p>
          <h2 className="yd-ds__title">Courbe signature</h2>
          <p className="yd-ds__code">cubic-bezier(0.16, 1, 0.3, 1)</p>
          <p className="yd-ds__caption">
            Une seule courbe pour tout : <code>--yd-ease</code> côté CSS,
            <code> SIGNATURE_EASE</code> côté JavaScript. Un départ net, une fin longue.
          </p>
        </BentoCell>

        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 3, lg: 3 }}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Primitive</p>
          <h2 className="yd-ds__title">Entrée échelonnée</h2>
          <p className="yd-ds__caption">
            Les cellules de cette grille sont arrivées l'une après l'autre, avec 60 ms
            d'écart, en montant de 18 px. Rechargez la page pour la rejouer.
          </p>
        </BentoCell>

        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 2, lg: 4 }}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Structure</p>
          <h2 className="yd-ds__title">Grille bento</h2>
          <p className="yd-ds__caption">
            12 colonnes au-delà de 1200 px, 6 entre 768 et 1199 px, une seule en dessous.
            La hiérarchie vient de la surface, pas de la graisse du texte.
          </p>
        </BentoCell>

        <BentoCell
          as={motion.div}
          {...entryProps(reducedMotion)}
          span={{ md: 4, lg: 8 }}
          className="yd-ds__cell"
        >
          <p className="yd-ds__label">Surface</p>
          <h2 className="yd-ds__title">Cellule opaque</h2>
          <p className="yd-ds__caption">
            Rayon 16 px, bordure d'un pixel, ombre portée. Une cellule porte des chiffres :
            elle reste opaque. Le flou d'arrière-plan est réservé aux surfaces flottantes,
            tiroir et fenêtres modales.
          </p>
          <p className="yd-ds__code">
            {formatCents(-SAMPLE_AMOUNT_CENTS, { signed: true })} · {formatCents(0)} ·{" "}
            {formatCents(SAMPLE_AMOUNT_CENTS, { signed: true })}
          </p>
        </BentoCell>
      </BentoGrid>
    </div>
  );
}
