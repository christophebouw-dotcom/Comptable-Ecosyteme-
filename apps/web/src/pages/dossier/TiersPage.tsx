import { validateIban, validateSiren, validateVatNumber } from "@compta/core";
import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Badge, Empty, ErrorBox, Field, Loading, Modal } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import type { Tiers } from "../../lib/types";
import { useDossier } from "./DossierLayout";

export function TiersPage() {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const [type, setType] = useState<"" | "client" | "fournisseur">("");
  const { data, error, loading, reload } = useApi<Tiers[]>(`/api/dossiers/${dossier.id}/tiers${type ? `?type=${type}` : ""}`);
  const [edit, setEdit] = useState<Tiers | "new" | null>(null);

  return (
    <div className="stack">
      <div className="row between">
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ width: "auto" }} aria-label="Type de tiers">
          <option value="">Clients et fournisseurs</option>
          <option value="client">Clients (411)</option>
          <option value="fournisseur">Fournisseurs (401)</option>
        </select>
        {can("tiers:write") && <button className="btn primary" onClick={() => setEdit("new")}><Icon.plus /> Nouveau tiers</button>}
      </div>
      {!can("tiers:write") && <Alert tone="info">Les coordonnées personnelles sont masquées selon votre profil (minimisation des données, RGPD art. 5.1.c).</Alert>}
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="Aucun tiers" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Compte</th><th>Nom</th><th>Type</th><th>Identifiants</th><th>Contact</th><th>IBAN</th><th /></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.compteAux}</td>
                    <td>
                      <strong>{t.nom}</strong>
                      <div className="subtle">{[t.codePostal, t.ville].filter(Boolean).join(" ")}</div>
                    </td>
                    <td>
                      <Badge tone={t.type === "client" ? "info" : undefined}>{t.type === "client" ? "Client" : "Fournisseur"}</Badge>{" "}
                      {t.personnePhysique && <Badge>Personne physique</Badge>}{" "}
                      {t.restricted && <Badge tone="warn">Accès restreint (art. 18)</Badge>}{" "}
                      {t.anonymized && <Badge tone="danger">Anonymisé</Badge>}
                    </td>
                    <td className="mono">{t.siren ?? ""}{t.tvaIntra && <div>{t.tvaIntra}</div>}</td>
                    <td>{t.email ?? ""}{t.telephone && <div className="subtle">{t.telephone}</div>}</td>
                    <td className="mono">{t.ibanMasque ?? ""}</td>
                    <td className="actions">{can("tiers:write") && !t.anonymized && <button className="btn ghost sm" onClick={() => setEdit(t)}>Modifier</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <TiersForm initial={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function TiersForm({ initial, onClose, onSaved }: { initial?: Tiers; onClose: () => void; onSaved: () => void }) {
  const { dossier } = useDossier();
  const toast = useToast();
  const [f, setF] = useState({
    type: initial?.type ?? "client",
    compteAux: initial?.compteAux ?? "",
    nom: initial?.nom ?? "",
    personnePhysique: initial?.personnePhysique ?? false,
    professionnel: initial?.professionnel ?? true,
    siren: initial?.siren ?? "",
    tvaIntra: initial?.tvaIntra ?? "",
    adresse: initial?.adresse ?? "",
    codePostal: initial?.codePostal ?? "",
    ville: initial?.ville ?? "",
    pays: initial?.pays ?? "FR",
    email: initial?.restricted ? "" : (initial?.email ?? ""),
    telephone: initial?.restricted ? "" : (initial?.telephone ?? ""),
    iban: "",
    finRelation: initial?.finRelation ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const { pending, error, run } = useAction();
  const checks = {
    siren: f.siren ? validateSiren(f.siren) : null,
    tva: f.tvaIntra ? validateVatNumber(f.tvaIntra) : null,
    iban: f.iban ? validateIban(f.iban) : null,
  };
  const hint = (c: { valid: boolean; reason?: string } | null, def?: string) => (c && !c.valid ? <span className="danger-text">{c.reason}</span> : c?.valid ? <span className="ok-text">Valide</span> : def);

  const submit = () =>
    run(async () => {
      const payload = {
        ...f,
        compteAux: f.compteAux || `${f.type === "client" ? "C" : "F"}${f.nom.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12)}`,
        siren: f.siren || null, tvaIntra: f.tvaIntra || null, email: f.email || null, telephone: f.telephone || null,
        iban: f.iban || null, finRelation: f.finRelation || null,
      };
      if (initial) await api.put(`/api/dossiers/${dossier.id}/tiers/${initial.id}`, payload);
      else await api.post(`/api/dossiers/${dossier.id}/tiers`, payload);
      toast(initial ? "Tiers mis à jour" : "Tiers créé");
      onSaved();
      onClose();
    });

  return (
    <Modal title={initial ? `Modifier ${initial.nom}` : "Nouveau tiers"} onClose={onClose} wide>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Type">
            <select value={f.type} onChange={(e) => set("type", e.target.value as "client" | "fournisseur")}>
              <option value="client">Client</option>
              <option value="fournisseur">Fournisseur</option>
            </select>
          </Field>
          <Field label="Code auxiliaire" hint="Généré à partir du nom si vide"><input value={f.compteAux} onChange={(e) => set("compteAux", e.target.value.toUpperCase())} maxLength={17} /></Field>
          <Field label="Nom ou raison sociale" span2><input value={f.nom} onChange={(e) => set("nom", e.target.value)} required /></Field>
          <label className="check"><input type="checkbox" checked={f.personnePhysique} onChange={(e) => set("personnePhysique", e.target.checked)} /> Personne physique (données personnelles)</label>
          <label className="check"><input type="checkbox" checked={f.professionnel} onChange={(e) => set("professionnel", e.target.checked)} /> Professionnel (B2B)</label>
          <Field label="SIREN" hint={hint(checks.siren, f.professionnel && f.type === "client" ? "Obligatoire sur les factures B2B (2026)" : undefined)}><input value={f.siren} onChange={(e) => set("siren", e.target.value)} aria-invalid={checks.siren ? !checks.siren.valid : undefined} /></Field>
          <Field label="N° TVA intracommunautaire" hint={hint(checks.tva)}><input value={f.tvaIntra} onChange={(e) => set("tvaIntra", e.target.value.toUpperCase())} aria-invalid={checks.tva ? !checks.tva.valid : undefined} /></Field>
          <Field label="Adresse" span2><input value={f.adresse} onChange={(e) => set("adresse", e.target.value)} /></Field>
          <Field label="Code postal"><input value={f.codePostal} onChange={(e) => set("codePostal", e.target.value)} /></Field>
          <Field label="Ville"><input value={f.ville} onChange={(e) => set("ville", e.target.value)} /></Field>
          <Field label="Pays (ISO)"><input value={f.pays} onChange={(e) => set("pays", e.target.value.toUpperCase())} maxLength={2} /></Field>
          <Field label="E-mail" hint="Chiffré au repos"><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Téléphone" hint="Chiffré au repos"><input value={f.telephone} onChange={(e) => set("telephone", e.target.value)} /></Field>
          <Field label={initial?.ibanMasque ? `IBAN (actuel : ${initial.ibanMasque})` : "IBAN"} hint={hint(checks.iban, "Chiffré au repos")} span2><input value={f.iban} onChange={(e) => set("iban", e.target.value)} aria-invalid={checks.iban ? !checks.iban.valid : undefined} placeholder={initial?.ibanMasque ? "Laisser vide pour conserver" : ""} /></Field>
          <Field label="Fin de la relation" hint="Point de départ des durées de conservation"><input type="date" value={f.finRelation} onChange={(e) => set("finRelation", e.target.value)} /></Field>
        </div>
        {f.personnePhysique && (
          <Alert tone="info">Personne physique : ses coordonnées seront anonymisées automatiquement 3 ans après la fin de la relation. Les pièces comptables la concernant restent conservées 10 ans (C. com. art. L123-22).</Alert>
        )}
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending || !f.nom} onClick={submit}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
