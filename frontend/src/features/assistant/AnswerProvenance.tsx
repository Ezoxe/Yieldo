import { Shibi } from "../../design/shibi/Shibi";
import { useShibiVisible } from "../../design/shibi/shibiPreference";
import type { ChatAnswer } from "../../lib/types";
import "./AnswerProvenance.css";

/**
 * Who answered, said out loud.
 *
 * "Yieldo a mesuré ceci" and "votre modèle a écrit ceci" are two different
 * claims, and only the first is one this application stands behind. So an
 * answer that came from the household's own model carries a badge naming it,
 * and a model that failed says why beside the refusal that stands in its place
 * — never a silent degradation to the old behaviour.
 *
 * Nothing here is rendered for the ordinary case: a deterministic answer needs
 * no label, because the whole application is the label.
 */
export function AnswerProvenance({ answer }: { answer: ChatAnswer }) {
  const shibi = useShibiVisible();
  const fromModel = answer.answered_by === "modele";

  if (!fromModel && answer.model_notice === null) return null;

  if (fromModel) {
    return (
      <p className="yd-provenance" data-source="modele">
        {shibi ? <Shibi state="reponse" /> : null}
        <span className="yd-provenance__body">
          <span className="yd-provenance__title">
            Répondu par votre modèle
            {answer.model_name !== null ? (
              <code className="yd-provenance__model">{answer.model_name}</code>
            ) : null}
          </span>
          <span className="yd-provenance__note">
            Yieldo n'a pas reconnu la question et l'a confiée au modèle configuré dans
            Réglages → Connexions. Les chiffres qu'il cite viennent des moteurs de
            Yieldo, par les outils listés ci-dessous&nbsp;; la formulation est la
            sienne. Il ne peut rien modifier.
          </span>
        </span>
      </p>
    );
  }

  return (
    <p className="yd-provenance" data-source="echec">
      <span className="yd-provenance__body">
        <span className="yd-provenance__title">Votre modèle n'a pas pris la question</span>
        <span className="yd-provenance__note">{answer.model_notice}</span>
      </span>
    </p>
  );
}
