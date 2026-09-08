import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { PanelHead } from "../../design/bento/PanelHead";
import { AppearanceIcon, AssistantIcon, SettingsIcon } from "../../design/icons";
import { PageHead } from "../../design/PageHead";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { Shibi } from "../../design/shibi/Shibi";
import {
  SHIBI_ANIMATIONS,
  SHIBI_PALETTE,
  SHIBI_PALETTE_ROLES,
  SHIBI_SIZE,
  shibiColors,
  shibiGrid,
  type ShibiColorName,
  type ShibiState,
} from "../../design/shibi/sprite";
import { useShibiVisible } from "../../design/shibi/shibiPreference";
import "./ShibiSheetPage.css";

const SPAN: Record<string, BentoSpan> = {
  stage: { md: 6, lg: 5 },
  states: { md: 6, lg: 7 },
  full: { md: 6, lg: 12 },
  half: { md: 6, lg: 6 },
};

/** The sizes he is actually drawn at in the application, and where. */
const USED_AT: { zoom: number; where: string }[] = [
  { zoom: 1, where: "En-tête, tiroir de l'assistant, et sur chaque étape de la trace" },
  { zoom: 2, where: "Formulaire de l'assistant, et les six lignes ci-contre" },
  { zoom: 4, where: "Page d'accueil" },
  { zoom: 6, where: "Le portrait en haut de cette planche" },
];

/**
 * The shibi's model sheet, inside the application it belongs to.
 *
 * It exists for whoever works on Yieldo next — a person or an assistant — and
 * that is why it is a screen rather than a document: it reads `sprite.ts` at
 * run time, so it cannot describe a character the application no longer draws.
 * Every figure on it (the number of states, of frames, of colours) is counted
 * from the data, never typed in beside it.
 *
 * Reachable from Réglages → Apparence, beside the switch that turns him off.
 */
export function ShibiSheetPage() {
  const reduced = useReducedMotion();
  const visible = useShibiVisible();
  const [state, setState] = useState<ShibiState>("repos");

  const frameCount = SHIBI_ANIMATIONS.reduce((total, a) => total + a.frames.length, 0);
  const colourCount = shibiColors().size;

  return (
    <section className="yd-shibi-sheet">
      <PageHead
        icon={AssistantIcon}
        title="Le shibi"
        shortLead={
          <p>
            Le visage de l'assistant, en pixel art sur une toile de {SHIBI_SIZE}×
            {SHIBI_SIZE}. Six états, {frameCount} images.
          </p>
        }
      >
        <p>
          Le petit personnage cubique de Yieldo, dessiné en pixel art sur une toile de{" "}
          {SHIBI_SIZE}×{SHIBI_SIZE}. Impersonnel par construction : un cube, deux yeux
          carrés, aucune bouche. Tout ce qu'il exprime passe par la couleur de sa diode
          et la forme de ses yeux — c'est ce qui l'empêche d'en dire plus que
          l'assistant n'en sait. Cette planche lit directement le sprite&nbsp;: elle ne
          peut pas décrire un personnage que l'application ne dessine plus.
        </p>
      </PageHead>

      {!visible ? (
        <p className="yd-shibi-sheet__off" role="status">
          Le shibi est masqué dans Réglages → Apparence. Il reste dessiné ici, pour que
          cette planche puisse être lue même quand il ne l'est pas ailleurs.
        </p>
      ) : null}

      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell
          as={motion.div}
          span={SPAN.stage}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={AssistantIcon}>En grand</PanelHead>
          <div className="yd-shibi-stage">
            <Shibi state={state} scale={6} label={`Le shibi, état ${state}`} />
          </div>
          <div className="yd-shibi-picker" role="group" aria-label="Choisir l'état">
            {SHIBI_ANIMATIONS.map((animation) => (
              <button
                key={animation.key}
                type="button"
                className="yd-shibi-picker__chip"
                aria-pressed={animation.key === state}
                onClick={() => setState(animation.key)}
              >
                {animation.name}
              </button>
            ))}
          </div>
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.states}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={AssistantIcon}>
            Les six états, et ce que chacun veut dire
          </PanelHead>
          <ul className="yd-shibi-states">
            {SHIBI_ANIMATIONS.map((animation) => (
              <li key={animation.key} className="yd-shibi-states__row">
                <Shibi state={animation.key} scale={2} />
                <div className="yd-shibi-states__body">
                  <p className="yd-shibi-states__name">
                    {animation.name}
                    <span className="yd-shibi-states__meta yd-num">
                      {animation.frames.length} images · {animation.fps} i/s ·{" "}
                      {animation.hue}
                    </span>
                  </p>
                  <p className="yd-shibi-states__note">{animation.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.half}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={SettingsIcon}>À l'échelle où il est dessiné</PanelHead>
          <p className="yd-shibi-sheet__lead">
            Un sprite se juge à la taille où il sera affiché. Le facteur est toujours un
            nombre entier&nbsp;: à 1,5× la moitié de ses pixels feraient deux points
            d'écran et l'autre moitié trois.
          </p>
          <ul className="yd-shibi-scales">
            {USED_AT.map(({ zoom, where }) => (
              <li key={zoom} className="yd-shibi-scales__row">
                <Shibi state="repos" scale={zoom} />
                <div>
                  <p className="yd-shibi-scales__size yd-num">
                    {SHIBI_SIZE * zoom} px · {zoom}×
                  </p>
                  <p className="yd-shibi-scales__where">{where}</p>
                </div>
              </li>
            ))}
          </ul>
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.half}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={AppearanceIcon}>
            La palette, {colourCount} couleurs
          </PanelHead>
          <p className="yd-shibi-sheet__lead">
            Treize couleurs nommées, plus trois niveaux de diode par accent. Un état qui
            introduirait une couleur mélangée tomberait sur{" "}
            <code>design/shibi/sprite.test.ts</code>.
          </p>
          <ul className="yd-shibi-ramp">
            {(Object.keys(SHIBI_PALETTE) as ShibiColorName[]).map((name) => (
              <li key={name} className="yd-shibi-ramp__item">
                <span
                  className="yd-shibi-ramp__chip"
                  style={{ background: SHIBI_PALETTE[name] }}
                  aria-hidden="true"
                />
                <span className="yd-shibi-ramp__role">{SHIBI_PALETTE_ROLES[name]}</span>
                <code className="yd-shibi-ramp__hex yd-num">{SHIBI_PALETTE[name]}</code>
              </li>
            ))}
          </ul>
        </BentoCell>

        <BentoCell
          as={motion.div}
          span={SPAN.full}
          className="yd-panel"
          {...entryProps(reduced)}
        >
          <PanelHead icon={AssistantIcon}>
            La planche de sprites, une ligne par état
          </PanelHead>
          <div className="yd-shibi-sheet__scroll">
            <SpriteSheet />
          </div>
        </BentoCell>
      </BentoGrid>
    </section>
  );
}

/** Every frame of every state, laid out the way a sprite sheet is. */
function SpriteSheet() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = 3;
  const columns = Math.max(...SHIBI_ANIMATIONS.map((a) => a.frames.length));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    SHIBI_ANIMATIONS.forEach((animation, row) => {
      animation.frames.forEach((_, index) => {
        const grid = shibiGrid(animation.key, index);
        for (let y = 0; y < SHIBI_SIZE; y++) {
          for (let x = 0; x < SHIBI_SIZE; x++) {
            const colour = grid[y * SHIBI_SIZE + x];
            if (colour === null) continue;
            ctx.fillStyle = colour;
            ctx.fillRect(
              (index * SHIBI_SIZE + x) * zoom,
              (row * SHIBI_SIZE + y) * zoom,
              zoom,
              zoom,
            );
          }
        }
      });
    });
  }, [columns]);

  return (
    <canvas
      ref={canvasRef}
      className="yd-shibi-sheet__canvas"
      width={columns * SHIBI_SIZE * zoom}
      height={SHIBI_ANIMATIONS.length * SHIBI_SIZE * zoom}
      role="img"
      aria-label={`Planche de sprites : ${SHIBI_ANIMATIONS.length} lignes, une par état`}
    />
  );
}
