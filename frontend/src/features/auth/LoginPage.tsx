import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { fadeInUp } from "../../design/motion/variants";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { GlassCard } from "../../design/glass/GlassCard";
import { ApiError } from "../../lib/api";
import "./AuthPage.css";
import { useSession } from "./session";

export function LoginPage() {
  const login = useSession((state) => state.login);
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate("/", { replace: true });
    } catch (err) {
      // ApiError carries the backend's French message verbatim (e.g. "Identifiants
      // invalides"); anything else (network failure, ...) falls back to a generic
      // French message — never a raw error thrown across the UI unhandled.
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
          <h1>Connexion</h1>

          <form className="yd-auth__form" onSubmit={handleSubmit} noValidate>
            <div className="yd-auth__field">
              <label htmlFor="login-email">Adresse email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="yd-auth__field">
              <label htmlFor="login-password">Mot de passe</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {error ? (
              <p className="yd-auth__alert" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="yd-auth__submit" disabled={submitting}>
              {submitting ? "Connexion…" : "Se connecter"}
            </button>
          </form>

          <p className="yd-auth__footer">
            Pas encore de compte ? <Link to="/inscription">Créer un compte</Link>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}
