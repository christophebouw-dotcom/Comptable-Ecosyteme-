import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ErrorBox, Field } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useAuth } from "../lib/hooks";
import type { User } from "../lib/types";

export function LoginPage() {
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "mfa">("password");
  const { pending, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (step === "password") {
        const r = await api.post<{ mfaRequired: boolean; user: User | null }>("/api/auth/login", { email, password });
        setPassword("");
        if (r.mfaRequired) setStep("mfa");
        else setUser(r.user);
      } else {
        const r = await api.post<{ user: User }>("/api/auth/mfa", { code });
        setUser(r.user);
      }
    });
  };

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div>
          <div className="brand" style={{ padding: 0, marginBottom: 40 }}>
            <img src="/favicon.svg" width={34} height={34} alt="" />
            Compta Écosystème
          </div>
          <h1>La plateforme du cabinet, conforme par conception.</h1>
          <ul>
            <li><span>01</span><span>Comptabilité en partie double, écritures intangibles et chaînées, FEC conforme à l'art. A47 A-1 du LPF.</span></li>
            <li><span>02</span><span>Facturation prête pour la réforme 2026 : mentions obligatoires contrôlées et export Factur-X EN 16931.</span></li>
            <li><span>03</span><span>Centre RGPD intégré : registre art. 30, droits des personnes, violations sous 72 h, purge automatique.</span></li>
            <li><span>04</span><span>Données bancaires chiffrées (AES-256-GCM), double authentification, journal d'audit infalsifiable.</span></li>
          </ul>
        </div>
        <p style={{ fontSize: 12.5, opacity: 0.75 }}>Hébergement et traitement des données au sein de l'Union européenne. Aucun traceur, aucune ressource tierce.</p>
      </aside>
      <div className="login-form">
        <form onSubmit={submit} noValidate>
          <div>
            <h1>{step === "password" ? "Connexion" : "Double authentification"}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {step === "password" ? "Accès réservé aux membres du cabinet et à ses clients." : "Saisissez le code à 6 chiffres affiché par votre application d'authentification."}
            </p>
          </div>
          <ErrorBox error={error} />
          {step === "password" ? (
            <>
              <Field label="Adresse e-mail">
                <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </Field>
              <Field label="Mot de passe">
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
            </>
          ) : (
            <Field label="Code de vérification">
              <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus className="num" style={{ fontSize: 20, letterSpacing: 6, textAlign: "center" }} />
            </Field>
          )}
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? "Vérification…" : step === "password" ? "Se connecter" : "Valider"}
          </button>
          <p className="subtle">
            Après 5 tentatives infructueuses, le compte est verrouillé 15 minutes.{" "}
            <Link to="/confidentialite">Politique de confidentialité</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
