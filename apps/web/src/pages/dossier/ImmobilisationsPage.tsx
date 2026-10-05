import { type AnnuitePlan, coefficientDegressif, toCents } from "@compta/core";
import { Fragment, useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Badge, DateFr, Empty, ErrorBox, Field, Loading, Modal, Money } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

interface Immo {
  id: number;
  compte: string;
  libelle: string;
  dateMiseEnService: string;
  valeurHT: number;
  dureeAnnees: number;
  mode: "lineaire" | "degressif" | "non_amortissable";
  dateSortie: string | null;
  amortissementsAnterieurs: number;
  compteAmortissement: string;
  cumulDebut: number;
  dotation: number;
  cumulFin: number;
  vncFin: number;
  plan: AnnuitePlan[];
}

const MODES = { lineaire: "Linéaire", degressif: "Dégressif", non_amortissable: "Non amortissable" };

export function ImmobilisationsPage() {
  const { dossier, exercice } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ immobilisations: Immo[]; totaux: { valeurBrute: number; dotation: number; cumulFin: number; vncFin: number }; dotationsComptabilisees: boolean }>(
    `/api/dossiers/${dossier.id}/immobilisations${qs({ exerciceId: exercice.id })}`,
  );
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const action = useAction();

  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">Registre des immobilisations et plans d'amortissement — exercice {exercice.debut.slice(0, 4)}.</p>
        {can("compta:write") && exercice.statut === "ouvert" && (
          <div className="row">
            <button className="btn" onClick={() => setCreating(true)}><Icon.plus /> Nouvelle immobilisation</button>
            <button className="btn primary" disabled={action.pending || !data?.totaux.dotation || data.dotationsComptabilisees} onClick={() => action.run(async () => {
              await api.post(`/api/dossiers/${dossier.id}/immobilisations/dotations`, { exerciceId: exercice.id });
              toast("Écriture de dotations créée en brouillard (journal OD)");
              reload();
            })}>{data?.dotationsComptabilisees ? "Dotations comptabilisées" : "Comptabiliser les dotations"}</button>
          </div>
        )}
      </div>
      <ErrorBox error={error ?? action.error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.immobilisations.length ? (
          <Empty title="Aucune immobilisation" action={can("compta:write") && <button className="btn primary" onClick={() => setCreating(true)}>Ajouter une immobilisation</button>}>
            Les dotations aux amortissements sont calculées automatiquement (linéaire prorata temporis ou dégressif fiscal).
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Compte</th><th>Désignation</th><th>Mise en service</th><th>Mode</th><th className="num">Valeur brute</th><th className="num">Amort. début</th><th className="num">Dotation</th><th className="num">VNC fin</th><th /></tr></thead>
              <tbody>
                {data.immobilisations.map((i) => (
                  <Fragment key={i.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === i.id ? null : i.id)}>
                      <td className="mono">{i.compte}</td>
                      <td>{i.libelle}{i.dateSortie && <> <Badge tone="warn">Sortie le <DateFr iso={i.dateSortie} /></Badge></>}</td>
                      <td><DateFr iso={i.dateMiseEnService} /></td>
                      <td>{MODES[i.mode]}{i.mode !== "non_amortissable" && <span className="subtle"> · {i.dureeAnnees} ans{i.mode === "degressif" ? ` · coef. ${coefficientDegressif(i.dureeAnnees)}` : ""}</span>}</td>
                      <td><Money cents={i.valeurHT} /></td>
                      <td><Money cents={i.cumulDebut} hideZero /></td>
                      <td><strong><Money cents={i.dotation} hideZero /></strong></td>
                      <td><Money cents={i.vncFin} /></td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        {can("compta:write") && <button className="btn ghost sm" aria-label="Supprimer" onClick={() => action.run(async () => {
                          if (!confirm(`Supprimer la fiche « ${i.libelle} » ? Les écritures déjà passées ne sont pas modifiées.`)) return;
                          await api.del(`/api/dossiers/${dossier.id}/immobilisations/${i.id}`); reload();
                        })}><Icon.trash /></button>}
                      </td>
                    </tr>
                    {open === i.id && (
                      <tr><td /><td colSpan={8} style={{ background: "var(--surface-2)" }}>
                        <strong>Plan d'amortissement</strong> <span className="subtle">— compte d'amortissement {i.compteAmortissement}</span>
                        <table style={{ marginTop: 8 }}>
                          <thead><tr><th>Exercice</th><th className="num">Dotation</th><th className="num">Cumul</th><th className="num">VNC</th></tr></thead>
                          <tbody>{i.plan.map((p) => (
                            <tr key={p.debut} className={p.debut === exercice.debut ? "selected" : ""}><td><DateFr iso={p.debut} /> → <DateFr iso={p.fin} /></td><td><Money cents={p.dotation} /></td><td><Money cents={p.cumul} /></td><td><Money cents={p.vnc} /></td></tr>
                          ))}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Totaux</td><td><Money cents={data.totaux.valeurBrute} /></td><td /><td><Money cents={data.totaux.dotation} /></td><td><Money cents={data.totaux.vncFin} /></td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
      {creating && <ImmoForm onClose={() => setCreating(false)} onSaved={reload} />}
    </div>
  );
}

function ImmoForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { dossier, exercice } = useDossier();
  const [f, setF] = useState({ compte: "2183", libelle: "", dateMiseEnService: exercice.debut, valeur: "", dureeAnnees: "3", mode: "lineaire", anterieurs: "" });
  const { pending, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const DUREES: Record<string, string> = { "2183": "3", "2184": "10", "2182": "5", "2154": "5", "213": "25", "205": "1", "2181": "10" };
  return (
    <Modal title="Nouvelle immobilisation" onClose={onClose}>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Compte">
            <select value={f.compte} onChange={(e) => setF({ ...f, compte: e.target.value, dureeAnnees: DUREES[e.target.value] ?? f.dureeAnnees, mode: e.target.value === "211" ? "non_amortissable" : f.mode })}>
              <option value="205">205 — Logiciels, licences</option>
              <option value="211">211 — Terrains</option>
              <option value="213">213 — Constructions</option>
              <option value="2154">2154 — Matériel industriel</option>
              <option value="2181">2181 — Agencements, installations</option>
              <option value="2182">2182 — Matériel de transport</option>
              <option value="2183">2183 — Matériel de bureau et informatique</option>
              <option value="2184">2184 — Mobilier</option>
            </select>
          </Field>
          <Field label="Désignation"><input value={f.libelle} onChange={set("libelle")} /></Field>
          <Field label="Date de mise en service"><input type="date" value={f.dateMiseEnService} onChange={set("dateMiseEnService")} /></Field>
          <Field label="Valeur d'origine HT (€)"><input className="num" inputMode="decimal" value={f.valeur} onChange={set("valeur")} /></Field>
          <Field label="Mode">
            <select value={f.mode} onChange={set("mode")}>
              <option value="lineaire">Linéaire</option>
              <option value="degressif">Dégressif (biens neufs, durée ≥ 3 ans)</option>
              <option value="non_amortissable">Non amortissable</option>
            </select>
          </Field>
          <Field label="Durée (années)" hint="Durée d'usage"><input className="num" inputMode="numeric" value={f.dureeAnnees} onChange={set("dureeAnnees")} disabled={f.mode === "non_amortissable"} /></Field>
          <Field label="Amortissements antérieurs (€)" hint="Reprise d'un dossier existant"><input className="num" inputMode="decimal" value={f.anterieurs} onChange={set("anterieurs")} /></Field>
        </div>
        <Alert tone="info">La fiche calcule le plan d'amortissement. L'acquisition elle-même doit être comptabilisée par ailleurs (facture fournisseur au débit du compte {f.compte}).</Alert>
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending || !f.libelle || !f.valeur} onClick={() => run(async () => {
            await api.post(`/api/dossiers/${dossier.id}/immobilisations`, {
              compte: f.compte, libelle: f.libelle, dateMiseEnService: f.dateMiseEnService, valeurHT: toCents(f.valeur),
              dureeAnnees: Number(f.dureeAnnees) || 1, mode: f.mode, amortissementsAnterieurs: f.anterieurs ? toCents(f.anterieurs) : 0,
            });
            onSaved(); onClose();
          })}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}
