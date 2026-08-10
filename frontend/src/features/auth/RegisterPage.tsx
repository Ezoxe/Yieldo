import { motion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { fadeInUp } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { GlassCard } from "../../design/glass/GlassCard";
import { ApiError } from "../../lib/api";
import "./AuthPage.css";
import { useSession } from "./session";

type Strength = 0 | 1 | 2 | 3;

const STRENGTH_LABELS: Record<Strength, string> = {
  0: "Trop faible",
  1: "Faible",
  2: "Moyen",
  3: "Robuste",
};

// A cheap client-side estimate only — the backend is the real gate (422 under
// 8 characters). This just gives the user a hint before they submit.
function estimateStrength(password: string): Strength {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 3) as Strength;
}

export function RegisterPage() {
  const register = useSession((state) => state.register);
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => estimateStrength(password), [password]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    try {
      await register({ name, email, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Une erreur inattendue est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="yd-auth">
      <motion.div
        className="yd-auth__wrap"
        variants={fadeInUp}
        initial={reducedMotion ? false : "hidden"}
        animate="visible"
      >
        <GlassCard as="section" tone="raised" className="yd-auth__card">
          <h1>Créer un compte</h1>

          {/* True regardless of who is registering: an instance with no user yet
              makes the next registration an admin, one with users does not. */}
          <p className="yd-auth__notice">
            Le premier compte créé sur cette instance devient automatiquement
            administrateur.
          </p>

          <form className="yd-auth__form" onSubmit={handleSubmit} noValidate>
            <div className="yd-auth__field">
              <label htmlFor="register-name">Nom</label>
              <input
                id="register-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div className="yd-auth__field">
              <label htmlFor="register-email">Adresse email</label>
              <input
                id="register-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="yd-auth__field">
              <label htmlFor="register-password">Mot de passe</label>
              <input
                id="register-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
              />
              <div className="yd-auth__strength" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className={`yd-auth__strength-bar ${
                      index < strength ? "yd-auth__strength-bar--filled" : ""
                    }`}
                  />
                ))}
              </div>
              <p className="yd-auth__strength-label">{STRENGTH_LABELS[strength]}</p>
            </div>

            <div className="yd-auth__field">
              <label htmlFor="register-confirm-password">Confirmer le mot de passe</label>
              <input
                id="register-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>

            {error ? (
              <p className="yd-auth__alert" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="yd-auth__submit" disabled={submitting}>
              {submitting ? "Création…" : "Créer mon compte"}
            </button>
          </form>

          <p className="yd-auth__footer">
            Déjà un compte ? <Link to="/connexion">Se connecter</Link>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
