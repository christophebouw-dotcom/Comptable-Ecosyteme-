import { validateIban, validateSiren } from "@compta/core";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../components/icons";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApi, useAuth, useToast } from "../lib/hooks";
import type { Dossier } from "../lib/types";

export const REGIMES_TVA: Record<string, string> = {
  franchise: "Franchise en base (art. 293 B)",
  reel_simplifie: "Réel simplifié (CA12)",
  reel_normal_mensuel: "Réel normal mensuel (CA3)",
  reel_normal_trimestriel: "Réel normal trimestriel (CA3)",
};

export function DossiersPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<Dossier[]>("/api/dossiers");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const list = (data ?? []).filter((d) => `${d.raisonSociale} ${d.siren}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page">
      <PageHeader
        title="Dossiers clients"
        subtitle="Entreprises dont le cabinet tient ou révise la comptabilité."
        actions={
          <>
            <input placeholder="Rechercher (nom, SIREN)…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} aria-label="Rechercher un dossier" />
            {can("dossiers:write") && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Icon.plus /> Nouveau dossier
              </button>
            )}
          </>
        }
      />
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="Aucun dossier" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Raison sociale</th>
                  <th>SIREN</th>
                  <th>Régime TVA</th>
                  <th>Exercice en cours</th>
                  <th className="num">Brouillards</th>
                  <th className="num">Validées</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/dossiers/${d.id}`}><strong>{d.raisonSociale}</strong></Link>
                      <div className="subtle">{d.formeJuridique} · {d.ville}</div>
                    </td>
                    <td className="mono">{d.siren}</td>
                    <td>{REGIMES_TVA[d.regimeTva] ?? d.regimeTva}</td>
                    <td>{d.exerciceCourant ? `${d.exerciceCourant.debut} → ${d.exerciceCourant.fin}` : <Badge>Aucun</Badge>}</td>
                    <td className="num">{d.brouillards ? <Badge tone="warn">{d.brouillards}</Badge> : 0}</td>
                    <td className="num">{d.validees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <DossierForm onClose={() => setCreating(false)} onSaved={reload} />}
    </div>
  );
}

export function DossierForm({ initial, onClose, onSaved }: { initial?: Dossier; onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    raisonSociale: initial?.raisonSociale ?? "",
    formeJuridique: initial?.formeJuridique ?? "SAS",
    siren: initial?.siren ?? "",
    adresse: initial?.adresse ?? "",
    codePostal: initial?.codePostal ?? "",
    ville: initial?.ville ?? "",
    capital: initial?.capital ?? "",
    rcs: initial?.rcs ?? "",
    regimeTva: initial?.regimeTva ?? "reel_normal_mensuel",
    impot: initial?.impot ?? "IS",
    emailContact: initial?.emailContact ?? "",
    iban: "",
    bic: initial?.bic ?? "",
    prefixeFacture: initial?.prefixeFacture ?? "F",
    exerciceDebut: `${year}-01-01`,
    exerciceFin: `${year}-12-31`,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { pending, error, run } = useAction();
  const sirenCheck = f.siren ? validateSiren(f.siren) : null;
  const ibanCheck = f.iban ? validateIban(f.iban) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const payload = { ...f, iban: f.iban || null, bic: f.bic || null, capital: f.capital || null, rcs: f.rcs || null };
      if (initial) {
        await api.put(`/api/dossiers/${initial.id}`, payload);
        toast("Dossier mis à jour");
      } else {
        const r = await api.post<{ id: number }>("/api/dossiers", payload);
        toast("Dossier créé avec ses journaux et son premier exercice");
        navigate(`/dossiers/${r.id}`);
      }
      onSaved();
      onClose();
    });
  };

  return (
    <Modal title={initial ? "Modifier le dossier" : "Nouveau dossier client"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="form-grid" style={{ marginTop: error ? 14 : 0 }}>
          <Field label="Raison sociale" span2><input value={f.raisonSociale} onChange={set("raisonSociale")} required /></Field>
          <Field label="Forme juridique">
            <select value={f.formeJuridique} onChange={set("formeJuridique")}>
              {["SAS", "SASU", "SARL", "EURL", "SA", "SCI", "SNC", "EI", "Micro-entreprise", "Association"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="SIREN" hint={sirenCheck && !sirenCheck.valid ? <span className="danger-text">{sirenCheck.reason}</span> : sirenCheck?.valid ? <span className="ok-text">Clé de contrôle valide</span> : "9 chiffres"}>
            <input value={f.siren} onChange={set("siren")} required inputMode="numeric" aria-invalid={sirenCheck ? !sirenCheck.valid : undefined} disabled={!!initial} />
          </Field>
          <Field label="Adresse" span2><input value={f.adresse} onChange={set("adresse")} required /></Field>
          <Field label="Code postal"><input value={f.codePostal} onChange={set("codePostal")} required /></Field>
          <Field label="Ville"><input value={f.ville} onChange={set("ville")} required /></Field>
          <Field label="Capital social"><input value={f.capital} onChange={set("capital")} placeholder="10 000 €" /></Field>
          <Field label="Ville du RCS"><input value={f.rcs} onChange={set("rcs")} /></Field>
          <Field label="Régime de TVA">
            <select value={f.regimeTva} onChange={set("regimeTva")}>
              {Object.entries(REGIMES_TVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Imposition des bénéfices">
            <select value={f.impot} onChange={set("impot")}>
              <option value="IS">Impôt sur les sociétés</option>
              <option value="IR">Impôt sur le revenu</option>
            </select>
          </Field>
          <Field label="E-mail de contact"><input type="email" value={f.emailContact} onChange={set("emailContact")} /></Field>
          <Field label="Préfixe de facturation" hint="Ex. F → F2026-000001"><input value={f.prefixeFacture} onChange={set("prefixeFacture")} maxLength={4} /></Field>
          <Field label={initial?.ibanMasque ? `IBAN (actuel : ${initial.ibanMasque})` : "IBAN"} hint={ibanCheck && !ibanCheck.valid ? <span className="danger-text">{ibanCheck.reason}</span> : "Chiffré au repos (AES-256-GCM)"} span2>
            <input value={f.iban} onChange={set("iban")} aria-invalid={ibanCheck ? !ibanCheck.valid : undefined} placeholder={initial ? "Laisser vide pour conserver" : "FR76 …"} />
          </Field>
          <Field label="BIC"><input value={f.bic} onChange={set("bic")} /></Field>
          {!initial && (
            <>
              <Field label="Début du premier exercice"><input type="date" value={f.exerciceDebut} onChange={set("exerciceDebut")} required /></Field>
              <Field label="Fin du premier exercice"><input type="date" value={f.exerciceFin} onChange={set("exerciceFin")} required /></Field>
            </>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </form>
    </Modal>
  );
}
