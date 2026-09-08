import { motion } from "motion/react";
import { Suspense, lazy, useCallback, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";

import { AtmosphericBackground } from "../../design/atmosphere/AtmosphericBackground";
import { BentoCell } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { useCardSpotlight } from "../../design/bento/useCardSpotlight";
import type { BentoSpan } from "../../design/bento/BentoCell";
import { AssistantIcon, ProposalsIcon } from "../../design/icons";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, fadeInUp, fadeInUpDelayed, inViewStaggerProps } from "../../design/motion/variants";
import { useResolvedTheme } from "../../design/useResolvedTheme";
import { DashboardPreview } from "./DashboardPreview";
import { ShibiShowcase } from "./ShibiShowcase";
import {
  BankOffIcon,
  ChartIcon,
  CloudUploadIcon,
  ColumnsCheckIcon,
  CompassIcon,
  FileImportIcon,
  GaugeIcon,
  HomeShieldIcon,
  KeyOffIcon,
  SearchIcon,
  SlidersIcon,
  TagIcon,
  TrendIcon,
  YieldoMark,
} from "./icons";
import "./LandingPage.css";

/**
 * The sculpture in the hero. Lazily loaded, and only after this page has
 * established that the machine can actually draw it — three.js is the largest
 * dependency in the project, and an authenticated screen must never pay for a
 * chunk the landing page alone uses.
 */
const HeroScene = lazy(() => import("./HeroScene"));

/**
 * Whether this browser can give us a WebGL context at all.
 *
 * Asked before the import rather than after: a machine with no WebGL should
 * not download 150kB of renderer to find out. The probe's own context is
 * released immediately — a browser allows a small number of live contexts, and
 * leaking one here would cost the scene the very slot it needs.
 */
function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const context =
      probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!context) return false;
    const lose = (context as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface FeatureCell {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  span: BentoSpan;
}

// Everything claimed here is something the application actually ships, and the
// list is only correct for as long as someone keeps it level with the app: it
// stood for months announcing budgets, recurrence detection, net worth and API
// keys as "not in this version" after all four had been delivered, which is the
// same defect as overselling, pointed the other way. A landing page that
// disagrees with the product is the one thing this operator cannot check
// before installing.
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
    body: "Flux de trésorerie, répartition par catégorie, calendrier des dépenses, et ce que la période a réellement mis de côté — un virement vers votre livret n'est pas une dépense, et Yieldo refuse de le compter comme telle.",
    span: { md: 3, lg: 7 },
  },
  {
    icon: GaugeIcon,
    title: "Budgets, abonnements et alertes",
    body: "Un plafond mensuel par catégorie et son suivi. Les prélèvements récurrents détectés sur vos relevés, ceux que vous déclarez vous-même, un calendrier des échéances, et l'alerte quand l'un d'eux change de montant.",
    span: { md: 3, lg: 6 },
  },
  {
    icon: CompassIcon,
    title: "Un plan prévisionnel, et trois lectures",
    body: "Déclarez ce que vous payez chaque mois, puis choisissez la lecture de vos chiffres : le réel de vos relevés, l'estimé du plan seul, ou le réel complété par ce qui n'est pas encore passé. Une dépense déjà sur le relevé n'est jamais comptée deux fois.",
    span: { md: 3, lg: 6 },
  },
  {
    icon: TrendIcon,
    title: "Patrimoine, projection, faisabilité",
    body: "Comptes d'investissement et positions, valorisation et allocation, projection à douze mois, dettes et objectifs — et « est-ce que je peux me le permettre ? » posé sur un projet, quel qu'il soit.",
    // Three across only fits the 12-column grid; at the 6-column breakpoint
    // they go two-then-one-full-width, the same shape the boundaries take.
    span: { md: 3, lg: 4 },
  },
  {
    icon: AssistantIcon,
    title: "Un assistant qui montre son travail",
    body: "Posez la question en français. La réponse cite le calcul qu'elle a lancé, le nombre de lignes qu'elle a lues dans votre propre journal et l'écran où le même chiffre est affiché — puis elle désigne à l'écran l'élément dont elle parle.",
    span: { md: 3, lg: 4 },
  },
  {
    icon: ProposalsIcon,
    title: "Un agent, et votre dernier mot",
    body: "Des clés d'agent ouvrent le journal en lecture, jamais le compte lui-même. Tout ce que l'agent veut écrire arrive dans Propositions et attend votre validation.",
    span: { md: 3, lg: 4 },
  },
  {
    icon: SearchIcon,
    title: "Recherche et recatégorisation",
    body: "Filtrez par période, par compte, par catégorie ou par libellé, et reclassez une opération sans quitter la liste. Les virements entre vos propres comptes en sont écartés par défaut, et le compteur dit combien.",
    span: { md: 3, lg: 6 },
  },
  {
    icon: SlidersIcon,
    title: "Réglé à votre main",
    body: "Thème clair ou sombre, affichage confortable ou compact, animations désactivables, export de vos données. Le réglage vous suit d'un écran à l'autre.",
    span: { md: 6, lg: 6 },
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
    body: "Vos opérations restent dans la base de l'instance que vous hébergez. Pas de statistiques d'usage, pas même une police de caractères chargée depuis un CDN, et aucun service tiers tant que vous n'en branchez pas un vous-même.",
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
  const resolvedTheme = useResolvedTheme();
  useCardSpotlight();

  // Decided once, on the first render: a machine either draws WebGL or it does
  // not, and re-probing on every render would create and drop a context each
  // time. `sceneBroken` is the second gate — a context the driver refuses
  // after the probe said yes — and the hero simply centres its copy instead.
  const [sceneSupported] = useState(webglAvailable);
  const [sceneBroken, setSceneBroken] = useState(false);
  const showScene = sceneSupported && !sceneBroken;
  const onSceneUnavailable = useCallback(() => setSceneBroken(true), []);

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
          <section
            className={`yd-landing__hero${showScene ? "" : " yd-landing__hero--copy-only"}`}
            aria-labelledby="yd-hero-title"
          >
            <motion.div className="yd-landing__hero-copy" {...heroEntry}>
              <p className="yd-landing__eyebrow">Finances personnelles, auto-hébergées</p>
              <h1 className="yd-landing__hero-title" id="yd-hero-title">
                Vos dépenses au clair,{" "}
                <span className="yd-landing__hero-accent">vos données chez vous.</span>
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

            {/* Always in the document, even on a machine that cannot draw it:
                the entry stagger behind the copy is a property of the hero's
                layout, and a wrapper that appears and disappears with a driver
                capability is a layout nobody can reason about. CSS collapses
                it under `--copy-only`. */}
            <motion.div
                className="yd-landing__hero-stage"
                {...(reducedMotion
                  ? {}
                  : {
                      // fadeInUpDelayed, not fadeInUp with a `transition` prop: the
                      // variant's own transition wins once it declares one, so a
                      // sibling `transition` prop here is silently ignored and the
                      // 120ms stagger behind the copy never happens.
                      variants: fadeInUpDelayed,
                      initial: "hidden" as const,
                      animate: "visible" as const,
                    })}
              >
                {/* No fallback element while the chunk loads: an empty stage for
                    a few hundred milliseconds is quieter than a placeholder that
                    is replaced by something of a different shape. */}
                {showScene ? (
                  <Suspense fallback={null}>
                    <HeroScene
                      resolved={resolvedTheme}
                      still={reducedMotion}
                      onUnavailable={onSceneUnavailable}
                    />
                  </Suspense>
                ) : null}
            </motion.div>
          </section>

          {/* The sculpture above says how the application feels; this says what
              it actually looks like. The figures in it are invented and the
              caption says so — see DashboardPreview. */}
          <Section
            id="yd-preview"
            eyebrow="À quoi ça ressemble"
            title="Le tableau de bord, tel qu'il se lit"
            lead="Une période, ce qu'elle a fait entrer, ce qu'elle a fait sortir, et ce qu'il en reste."
          >
            <motion.div
              className="yd-landing__preview"
              {...(reducedMotion
                ? {}
                : {
                    variants: fadeInUp,
                    initial: "hidden" as const,
                    whileInView: "visible" as const,
                    viewport: { once: true, amount: 0.15 },
                  })}
            >
              <DashboardPreview />
            </motion.div>
          </Section>

          {/* The assistant, introduced by its own face. It sits before the
              capability list on purpose: the shibi is the thing a visitor
              remembers, and the list reads better once they know who is
              running down it. */}
          <Section
            id="yd-shibi"
            eyebrow="L'assistant"
            title="Le shibi vous montre avec quoi il a répondu"
            lead="Posez la question en français. Il exécute, puis il redescend la trace en désignant chaque outil qui a servi — le moteur, le relevé, la période, le calcul. Rien n'est deviné, et rien n'est caché."
          >
            <motion.div
              {...(reducedMotion
                ? {}
                : {
                    variants: fadeInUp,
                    initial: "hidden" as const,
                    whileInView: "visible" as const,
                    viewport: { once: true, amount: 0.15 },
                  })}
            >
              <ShibiShowcase />
            </motion.div>
          </Section>

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

              {/* Kept inside this section on purpose. The three cells above
                  say what never leaves; this one says what CAN, so the promise
                  above stays exact instead of quietly excluding two features
                  that do reach the outside once the reader turns them on. */}
              <BentoCell
                as={motion.div}
                span={{ md: 6, lg: 12 }}
                className="yd-landing__cell yd-landing__cell--caveat"
                {...entryProps(reducedMotion)}
              >
                <span className="yd-landing__cell-icon yd-landing__cell-icon--caveat">
                  <CloudUploadIcon />
                </span>
                <div>
                  <h3 className="yd-landing__cell-title">
                    Ce qui peut sortir, seulement si vous le branchez
                  </h3>
                  <p className="yd-landing__cell-body">
                    Deux fonctions appellent un service extérieur : les cours de marché
                    du patrimoine, et l'assistant lorsqu'il s'appuie sur un modèle de
                    langage. Ni l'une ni l'autre n'est active tant que vous n'avez pas
                    saisi votre propre clé dans Réglages → Connexions ; sans clé, aucun
                    appel n'est tenté. Tout le reste — import, catégorisation, budgets,
                    plan, projections — se calcule sur votre instance.
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
