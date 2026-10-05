import { useState } from "react";
import { Icon } from "../components/icons";
import { Alert, Badge, DateFr, ErrorBox, Field, Loading, Modal, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApi, useAuth, useToast } from "../lib/hooks";
import type { Dossier, Role } from "../lib/types";

interface UserRow {
  id: number;
  email: string;
  nom: string;
  role: Role;
  roleLabel: string;
  totp_enabled: number;
  active: number;
  last_login_at: string | null;
  locked_until: string | null;
  dossiers: number[];
}

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Administrateur", description: "Tous les droits, gestion des utilisateurs" },
  { value: "expert", label: "Expert-comptable", description: "Tous les dossiers, validation et clôture" },
  { value: "collaborateur", label: "Collaborateur", description: "Saisie sur les dossiers affectés, sans validation" },
  { value: "client", label: "Client", description: "Lecture seule de son propre dossier" },
  { value: "dpo", label: "DPO", description: "Centre RGPD et audit, sans accès comptable" },
];

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<UserRow[]>("/api/users");
  const dossiers = useApi<Dossier[]>("/api/dossiers");
  const [edit, setEdit] = useState<UserRow | "new" | null>(null);
  const action = useAction();

  return (
    <div className="page">
      <PageHeader title="Utilisateurs et habilitations" subtitle="Principe du moindre privilège : chaque profil n'accède qu'aux données nécessaires à sa mission." actions={<button className="btn primary" onClick={() => setEdit("new")}><Icon.plus /> Nouvel utilisateur</button>} />
      <ErrorBox error={error ?? action.error} />
      <div className="card">
        {loading && !data ? <Loading /> : (
          <table>
            <thead><tr><th>Utilisateur</th><th>Profil</th><th>Dossiers</th><th>Sécurité</th><th>Dernière connexion</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.nom}</strong><div className="subtle">{u.email}</div></td>
                  <td>{u.roleLabel}</td>
                  <td>{u.role === "admin" || u.role === "expert" ? <span className="subtle">Tous</span> : u.role === "dpo" ? <span className="subtle">—</span> : u.dossiers.length}</td>
                  <td className="row">
                    {u.totp_enabled ? <Badge tone="ok">2FA</Badge> : <Badge tone="warn">Sans 2FA</Badge>}
                    {!u.active && <Badge tone="danger">Désactivé</Badge>}
                    {u.locked_until && new Date(u.locked_until) > new Date() && <Badge tone="danger">Verrouillé</Badge>}
                  </td>
                  <td><DateFr iso={u.last_login_at} withTime /></td>
                  <td className="actions">
                    {u.locked_until && new Date(u.locked_until) > new Date() && (
                      <button className="btn ghost sm" onClick={() => action.run(async () => { await api.patch(`/api/users/${u.id}`, { unlock: true }); toast("Compte déverrouillé"); reload(); })}>Déverrouiller</button>
                    )}
                    {u.id !== me!.id && <button className="btn ghost sm" onClick={() => setEdit(u)}>Modifier</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <UserForm initial={edit === "new" ? undefined : edit} dossiers={dossiers.data ?? []} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function UserForm({ initial, dossiers, onClose, onSaved }: { initial?: UserRow; dossiers: Dossier[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ email: "", nom: "", password: "", role: initial?.role ?? ("collaborateur" as Role), active: initial ? !!initial.active : true, dossiers: initial?.dossiers ?? [] });
  const { pending, error, run } = useAction();
  const scoped = f.role === "collaborateur" || f.role === "client";

  return (
    <Modal title={initial ? `Modifier ${initial.nom}` : "Nouvel utilisateur"} onClose={onClose}>
      <div className="stack">
        <ErrorBox error={error} />
        {!initial && (
          <div className="form-grid">
            <Field label="Nom complet"><input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
            <Field label="E-mail"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Mot de passe initial" hint="12 caractères min., majuscule, minuscule, chiffre et caractère spécial (CNIL)" span2>
              <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label="Profil">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
          </select>
        </Field>
        {scoped && (
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <legend className="subtle">Dossiers accessibles</legend>
            {dossiers.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={f.dossiers.includes(d.id)} onChange={(e) => setF({ ...f, dossiers: e.target.checked ? [...f.dossiers, d.id] : f.dossiers.filter((x) => x !== d.id) })} />
                {d.raisonSociale}
              </label>
            ))}
          </fieldset>
        )}
        {initial && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Compte actif (désactiver révoque immédiatement les sessions)</label>}
        {!initial && <Alert tone="info">Communiquez le mot de passe par un canal distinct et demandez à l'utilisateur de le changer et d'activer la double authentification à sa première connexion.</Alert>}
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending} onClick={() => run(async () => {
            if (initial) await api.patch(`/api/users/${initial.id}`, { role: f.role, active: f.active, dossiers: scoped ? f.dossiers : [] });
            else await api.post("/api/users", { email: f.email, nom: f.nom, password: f.password, role: f.role, dossiers: scoped ? f.dossiers : [] });
            toast(initial ? "Habilitations mises à jour" : "Utilisateur créé");
            onSaved(); onClose();
          })}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
