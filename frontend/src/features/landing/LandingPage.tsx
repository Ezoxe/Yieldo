import { motion } from "motion/react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";

import { AtmosphericBackground } from "../../design/atmosphere/AtmosphericBackground";
import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import type { BentoSpan } from "../../design/bento/BentoCell";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, fadeInUp, inViewStaggerProps } from "../../design/motion/variants";
import { DashboardPreview } from "./DashboardPreview";
import {
  BankOffIcon,
  ChartIcon,
  ClockIcon,
  ColumnsCheckIcon,
  FileImportIcon,
  HomeShieldIcon,
  KeyOffIcon,
  SearchIcon,
  SlidersIcon,
  TagIcon,
  YieldoMark,
} from "./icons";
import "./LandingPage.css";

interface FeatureCell {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  span: BentoSpan;
}

// Everything claimed here is something phase 1 actually shipped. Budgets,
// recurring-payment detection, multi-account net worth and API keys are later
// phases and appear only in the "pas encore disponible" cell below, marked as
// such -- a landing page that oversells is the one thing this operator cannot
// check before installing.
const CAPABILITIES: FeatureCell[] = [
  {
    icon: FileImportIcon,
    title: "Import d'un relevé CSV",
    body: "Déposez le fichier que vous avez exporté depuis votre banque. Yieldo reconnaît le séparateur, l'encodage et le format de date, vous montre ce qu'il a compris, et écarte les lignes déjà importées.",
    // Every capability is a flat 3 of 6 at the tablet breakpoint — two per row.
    // The asymmetric 7/5 pairing only survives the 12-column grid: measured at
    // 768, a 2-of-6 cell wrapped its body at 18 characters a line.
    span: { md: 3, lg: 7 },
  },
  {
    icon: ColumnsCheckIcon,
    title: "Vous validez les colonnes",
    body: "Rien n'est enregistré tant que vous n'avez pas confirmé à l'écran quelle colonne porte la date, le libellé, le montant. Modifiez la correspondance et l'aperçu est recalculé avant d'aller plus loin.",
    span: { md: 3, lg: 5 },
  },
  {
    icon: TagIcon,
    title: "Une catégorisation qui apprend",
    body: "Des règles classent les opérations à l'import. Quand vous corrigez une catégorie, la correction devient une règle et s'applique aux opérations suivantes.",
    span: { md: 3, lg: 5 },
  },
  {
    icon: ChartIcon,
    title: "Un tableau de bord qui se lit",
    body: "Flux de trésorerie, répartition par catégorie, calendrier des dépenses, entrées et sorties, taux d'épargne — sur la période de votre choix.",
    span: { md: 3, lg: 7 },
  },
  {
    icon: SearchIcon,
    title: "Recherche et recatégorisation",
    body: "Filtrez vos transactions par période, par catégorie ou par libellé, et reclassez-les une par une.",
    span: { md: 3, lg: 6 },
  },
  {
    icon: SlidersIcon,
    title: "Réglé à votre main",
    body: "Thème clair ou sombre, affichage confortable ou compact, animations désactivables. Le réglage vous suit d'un écran à l'autre.",
    span: { md: 3, lg: 6 },
  },
];

const BOUNDARIES: FeatureCell[] = [
  {
    icon: BankOffIcon,
    title: "Ce n'est pas un agrégateur bancaire",
    body: "Yieldo ne se connecte à aucune banque : ni directement, ni par un prestataire d'agrégation. Il n'y a pas de synchronisation à autoriser.",
    // Three across only fits the 12-column grid. At the 6-column breakpoint
    // they go two-then-one-full-width rather than three narrow columns, which
    // measured at 18 characters a line.
    span: { md: 3, lg: 4 },
  },
  {
    icon: KeyOffIcon,
    title: "Vos identifiants bancaires ne sont jamais demandés",
    body: "Aucun écran de l'application n'attend un identifiant, un mot de passe ou un code de banque. Vous importez un fichier que vous avez exporté vous-même.",
    span: { md: 3, lg: 4 },
  },
  {
    icon: HomeShieldIcon,
    title: "Aucune donnée ne quitte la machine",
    body: "Vos opérations restent dans la base de l'instance que vous hébergez. Pas de service tiers, pas de statistiques d'usage, pas même une police de caractères chargée depuis un CDN.",
    span: { md: 6, lg: 4 },
  },
];

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Installez l'instance",
    body: "Sur votre serveur ou sur votre machine, avec Docker. C'est vous qui décidez où vivent les données.",
  },
  {
    title: "Créez votre compte",
    body: "Le premier compte créé devient administrateur. Les inscriptions peuvent ensuite être fermées.",
  },
  {
    title: "Exportez, puis importez",
    body: "Téléchargez le relevé CSV depuis l'espace client de votre banque, déposez-le dans Yieldo, confirmez la correspondance des colonnes.",
  },
  {
    title: "Lisez votre tableau de bord",
    body: "Les opérations sont classées, la période est la vôtre. Corrigez une catégorie et Yieldo la retient.",
  },
];

/** The two paths off this page, side by side. The login path is never nested
 *  behind the signup one: registration can be closed server-side, and an
 *  operator whose instance is closed still has to be able to sign in. */
function CallToAction({ variant }: { variant: "bar" | "block" }) {
  return (
    <div className={`yd-landing__actions yd-landing__actions--${variant}`}>
      <Link to="/inscription" className="yd-landing__cta yd-landing__cta--primary">
        Créer un compte
      </Link>
      <Link to="/connexion" className="yd-landing__cta yd-landing__cta--ghost">
        Se connecter
      </Link>
    </div>
  );
}

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
}

/** A section whose grid arrives once, as the reader reaches it. */
function Section({ id, eyebrow, title, lead, children }: SectionProps) {
  return (
    <section className="yd-landing__section" aria-labelledby={`${id}-title`}>
      <div className="yd-landing__section-head">
        <p className="yd-landing__eyebrow">{eyebrow}</p>
        <h2 className="yd-landing__section-title" id={`${id}-title`}>
          {title}
        </h2>
        {lead ? <p className="yd-landing__section-lead">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function LandingPage() {
  const reducedMotion = useReducedMotion();
  const heroEntry = reducedMotion
    ? {}
    : { variants: fadeInUp, initial: "hidden" as const, animate: "visible" as const };

  return (
    <>
      <AtmosphericBackground />

      <div className="yd-landing">
        {/* The pattern puts a primary CTA in the page's own bar, so it stays
            reachable from anywhere in a long page. */}
        <header className="yd-landing__bar">
          <p className="yd-landing__wordmark">
            <YieldoMark />
            <span>Yieldo</span>
          </p>
          <CallToAction variant="bar" />
        </header>

        <main className="yd-landing__main">
          <section className="yd-landing__hero" aria-labelledby="yd-hero-title">
            <motion.div className="yd-landing__hero-copy" {...heroEntry}>
              <p className="yd-landing__eyebrow">Finances personnelles, auto-hébergées</p>
              <h1 className="yd-landing__hero-title" id="yd-hero-title">
                Vos dépenses au clair, vos données chez vous.
              </h1>
              <p className="yd-landing__hero-lead">
                Yieldo est un gestionnaire de finances personnelles que vous installez
                sur votre propre serveur. Vous importez le relevé que votre banque vous
                laisse exporter ; Yieldo le classe, le met en graphiques, et n'en parle
                à personne.
              </p>
              <CallToAction variant="block" />
              <p className="yd-landing__hero-note">
                Aucune connexion bancaire, aucun identifiant de banque demandé.
                L'instance est la vôtre.
              </p>
            </motion.div>

            <motion.div
              className="yd-landing__hero-preview"
              {...(reducedMotion
                ? {}
                : {
                    variants: fadeInUp,
                    initial: "hidden" as const,
                    animate: "visible" as const,
                    transition: { delay: 0.12 },
                  })}
            >
              <DashboardPreview />
            </motion.div>
          </section>

          <Section
            id="yd-capabilities"
            eyebrow="Ce que fait Yieldo"
            title="Ce qui est en place aujourd'hui"
            lead="Rien de plus que ce que l'application sait déjà faire, sur cette version."
          >
            <BentoGrid as={motion.div} {...inViewStaggerProps(reducedMotion)}>
              {CAPABILITIES.map(({ icon: CellIcon, title, body, span }) => (
                <BentoCell
                  as={motion.div}
                  key={title}
                  span={span}
                  className="yd-landing__cell"
                  {...entryProps(reducedMotion)}
                >
                  <span className="yd-landing__cell-icon">
                    <CellIcon />
                  </span>
                  <h3 className="yd-landing__cell-title">{title}</h3>
                  <p className="yd-landing__cell-body">{body}</p>
                </BentoCell>
              ))}
            </BentoGrid>
          </Section>

          <Section
            id="yd-boundaries"
            eyebrow="Ce que Yieldo ne fait pas"
            title="Et c'est exactement le sujet"
            lead="Les limites ci-dessous ne sont pas des fonctionnalités manquantes : ce sont les raisons d'être du projet."
          >
            <BentoGrid as={motion.div} {...inViewStaggerProps(reducedMotion)}>
              {BOUNDARIES.map(({ icon: CellIcon, title, body, span }) => (
                <BentoCell
                  as={motion.div}
                  key={title}
                  span={span}
                  className="yd-landing__cell yd-landing__cell--boundary"
                  {...entryProps(reducedMotion)}
                >
                  <span className="yd-landing__cell-icon yd-landing__cell-icon--boundary">
                    <CellIcon />
                  </span>
                  <h3 className="yd-landing__cell-title">{title}</h3>
                  <p className="yd-landing__cell-body">{body}</p>
                </BentoCell>
              ))}

              {/* Kept inside this section on purpose: what is missing is a
                  boundary of this version too, and saying so here is cheaper
                  than an operator discovering it after installing. */}
              <BentoCell
                as={motion.div}
                span={{ md: 6, lg: 12 }}
                className="yd-landing__cell yd-landing__cell--pending"
                {...entryProps(reducedMotion)}
              >
                <span className="yd-landing__cell-icon yd-landing__cell-icon--pending">
                  <ClockIcon />
                </span>
                <div>
                  <h3 className="yd-landing__cell-title">Pas encore disponible</h3>
                  <p className="yd-landing__cell-body">
                    Les budgets, la détection des prélèvements récurrents, le patrimoine
                    multi-comptes et les clés API sont prévus pour les versions
                    suivantes. Ils ne sont pas dans celle-ci, et cette page ne les
                    promet pas.
                  </p>
                </div>
              </BentoCell>
            </BentoGrid>
          </Section>

          <Section
            id="yd-steps"
            eyebrow="Comment ça marche"
            title="Quatre étapes, une seule fois"
          >
            <BentoGrid as={motion.div} {...inViewStaggerProps(reducedMotion)}>
              {STEPS.map((step, index) => (
                <BentoCell
                  as={motion.div}
                  key={step.title}
                  span={{ md: 3, lg: 3 }}
                  className="yd-landing__cell yd-landing__cell--step"
                  {...entryProps(reducedMotion)}
                >
                  <span className="yd-num yd-landing__step-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="yd-landing__cell-title">{step.title}</h3>
                  <p className="yd-landing__cell-body">{step.body}</p>
                </BentoCell>
              ))}
            </BentoGrid>
          </Section>

          <section className="yd-landing__closing" aria-labelledby="yd-closing-title">
            <motion.div
              className="yd-landing__closing-card"
              {...(reducedMotion
                ? {}
                : {
                    variants: fadeInUp,
                    initial: "hidden" as const,
                    whileInView: "visible" as const,
                    viewport: { once: true, amount: 0.3 },
                  })}
            >
              <h2 className="yd-landing__closing-title" id="yd-closing-title">
                Prêt à regarder vos comptes ?
              </h2>
              <p className="yd-landing__closing-lead">
                Créez le compte de cette instance, ou connectez-vous si vous en avez
                déjà un.
              </p>
              <CallToAction variant="block" />
              <p className="yd-landing__closing-note">
                Si les inscriptions ont été fermées sur cette instance, demandez un
                accès à la personne qui l'administre.
              </p>
            </motion.div>
          </section>
        </main>

        <footer className="yd-landing__footer">
          <p>Yieldo — gestionnaire de finances personnelles auto-hébergé.</p>
        </footer>
      </div>
    </>
  );
}
