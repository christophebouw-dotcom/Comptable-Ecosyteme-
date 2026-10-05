import { useState } from "react";
import { Alert, Badge, Card, DateFr, ErrorBox, Field, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApi, useAuth, useToast } from "../lib/hooks";

export function AccountPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const sessions = useApi<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean }[]>("/api/auth/sessions");
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePwd, setDisablePwd] = useState("");
  const pwAction = useAction();
  const totpAction = useAction();

  return (
    <div className="page">
      <PageHeader title="Mon compte" subtitle={`${user!.nom} · ${user!.email} · ${user!.roleLabel}`} />
      <div className="grid grid-2">
        <Card title="Double authentification (TOTP)" subtitle="Recommandée par la CNIL et l'ANSSI pour l'accès à des données financières" actions={user!.totpEnabled ? <Badge tone="ok">Activée</Badge> : <Badge tone="warn">Désactivée</Badge>}>
          <div className="stack">
            <ErrorBox error={totpAction.error} />
            {!user!.totpEnabled && !totpSetup && (
              <>
                <p className="muted">Utilisez une application d'authentification (FreeOTP, Aegis, Microsoft ou Google Authenticator…). Aucun SMS, aucun service tiers.</p>
                <div><button className="btn primary" onClick={() => totpAction.run(async () => setTotpSetup(await api.post("/api/auth/totp/setup")))}>Configurer</button></div>
              </>
            )}
            {!user!.totpEnabled && totpSetup && (
              <>
                <p>1. Dans votre application, ajoutez un compte avec la clé suivante :</p>
                <code style={{ fontSize: 16, letterSpacing: 2, padding: 12, background: "var(--surface-2)", borderRadius: 8, wordBreak: "break-all" }}>{totpSetup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                <details><summary className="subtle" style={{ cursor: "pointer" }}>Lien otpauth:// (pour import)</summary><code style={{ wordBreak: "break-all" }}>{totpSetup.otpauthUri}</code></details>
                <p>2. Saisissez le code à 6 chiffres affiché :</p>
                <div className="row">
                  <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ width: 140, letterSpacing: 4, textAlign: "center" }} aria-label="Code TOTP" />
                  <button className="btn primary" disabled={code.length !== 6 || totpAction.pending} onClick={() => totpAction.run(async () => {
                    await api.post("/api/auth/totp/enable", { code });
                    setUser({ ...user!, totpEnabled: true }); setTotpSetup(null); setCode(""); toast("Double authentification activée");
                  })}>Activer</button>
                </div>
              </>
            )}
            {user!.totpEnabled && (
              <>
                <p className="muted">Un code vous sera demandé à chaque connexion.</p>
                <details>
                  <summary className="subtle" style={{ cursor: "pointer" }}>Désactiver la double authentification</summary>
                  <div className="row" style={{ marginTop: 10 }}>
                    <input type="password" placeholder="Mot de passe" value={disablePwd} onChange={(e) => setDisablePwd(e.target.value)} style={{ width: 220 }} />
                    <button className="btn danger" onClick={() => totpAction.run(async () => {
                      await api.post("/api/auth/totp/disable", { password: disablePwd });
                      setUser({ ...user!, totpEnabled: false }); setDisablePwd(""); toast("Double authentification désactivée");
                    })}>Désactiver</button>
                  </div>
                </details>
              </>
            )}
          </div>
        </Card>

        <Card title="Changer de mot de passe" subtitle="Les autres sessions seront déconnectées">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void pwAction.run(async () => {
            if (pwd.next !== pwd.confirm) throw new Error("La confirmation ne correspond pas");
            await api.post("/api/auth/password", { current: pwd.current, next: pwd.next });
            setPwd({ current: "", next: "", confirm: "" }); toast("Mot de passe modifié"); sessions.reload();
          }); }}>
            <ErrorBox error={pwAction.error} />
            <Field label="Mot de passe actuel"><input type="password" autoComplete="current-password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} /></Field>
            <Field label="Nouveau mot de passe" hint="12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial"><input type="password" autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} /></Field>
            <Field label="Confirmation"><input type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} /></Field>
            <div><button className="btn primary" disabled={pwAction.pending}>Modifier</button></div>
          </form>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}>
        <Card title="Sessions actives" subtitle="Expiration après 30 minutes d'inactivité et 12 heures au maximum" padded={false}>
          <table>
            <thead><tr><th>Ouverte le</th><th>Dernière activité</th><th>Adresse IP</th><th>Navigateur</th><th /></tr></thead>
            <tbody>
              {(sessions.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td><DateFr iso={s.created_at} withTime /></td>
                  <td><DateFr iso={s.last_seen_at} withTime /></td>
                  <td className="mono">{s.ip}</td>
                  <td className="subtle">{s.user_agent.slice(0, 80)}</td>
                  <td>{s.current && <Badge tone="ok">Session actuelle</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}>
        <Alert tone="info" title="Vos droits">Vous pouvez accéder à vos données, les rectifier, demander leur effacement ou leur portabilité en contactant le délégué à la protection des données du cabinet. Voir la <a href="/confidentialite">politique de confidentialité</a>.</Alert>
      </div>
    </div>
  );
}
