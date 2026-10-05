import { totals } from "@compta/core";
import { Fragment, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Badge, DateFr, Empty, ErrorBox, Field, Hash, Loading, Modal, Money } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import type { Ecriture } from "../../lib/types";
import { useDossier } from "./DossierLayout";

export function EcrituresPage() {
  const { dossier, exercice, base } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const [journal, setJournal] = useState("");
  const [statut, setStatut] = useState("");
  const [compte, setCompte] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [extourne, setExtourne] = useState<Ecriture | null>(null);
  const { data, error, loading, reload } = useApi<Ecriture[]>(`/api/dossiers/${dossier.id}/ecritures${qs({ exerciceId: exercice.id, journal, statut, compte })}`);
  const action = useAction();
  const brouillards = (data ?? []).filter((e) => e.statut === "brouillard");
  const clos = exercice.statut === "cloture";

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const valider = () =>
    action.run(async () => {
      const r = await api.post<{ numero: number }[]>(`/api/dossiers/${dossier.id}/ecritures/valider`, { ids: [...selected] });
      toast(`${r.length} écriture(s) validée(s) — numérotées et scellées`);
      setSelected(new Set());
      reload();
    });

  const supprimer = (e: Ecriture) =>
    action.run(async () => {
      if (!confirm(`Supprimer le brouillard « ${e.libelle} » ?`)) return;
      await api.del(`/api/dossiers/${dossier.id}/ecritures/${e.id}`);
      toast("Brouillard supprimé");
      reload();
    });

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <select value={journal} onChange={(e) => setJournal(e.target.value)} style={{ width: "auto" }} aria-label="Journal">
            <option value="">Tous les journaux</option>
            {dossier.journaux.map((j) => <option key={j.code} value={j.code}>{j.code} — {j.libelle}</option>)}
          </select>
          <select value={statut} onChange={(e) => setStatut(e.target.value)} style={{ width: "auto" }} aria-label="Statut">
            <option value="">Tous statuts</option>
            <option value="brouillard">Brouillard</option>
            <option value="validee">Validées</option>
          </select>
          <input placeholder="Compte (préfixe)" value={compte} onChange={(e) => setCompte(e.target.value)} style={{ width: 160 }} aria-label="Filtrer par compte" />
        </div>
        <div className="row">
          {can("compta:validate") && brouillards.length > 0 && !clos && (
            <>
              <button className="btn sm" onClick={() => setSelected(new Set(brouillards.map((e) => e.id)))}>Tout sélectionner ({brouillards.length})</button>
              <button className="btn primary" disabled={selected.size === 0 || action.pending} onClick={valider}>
                <Icon.lock /> Valider {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </>
          )}
          {can("compta:write") && !clos && <Link className="btn primary" to={`${base}/saisie`}><Icon.plus /> Saisir</Link>}
        </div>
      </div>
      <ErrorBox error={action.error ?? error} />
      {selected.size > 0 && (
        <div className="alert info"><div>La validation rend les écritures <strong>définitives</strong> : elles reçoivent un numéro dans la séquence continue de l'exercice et une empreinte chaînée. Elles ne pourront plus être modifiées ni supprimées.</div></div>
      )}
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty title="Aucune écriture" action={can("compta:write") && !clos && <Link className="btn primary" to={`${base}/saisie`}>Saisir une écriture</Link>}>Aucune écriture ne correspond aux filtres.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>N°</th>
                  <th>Date</th>
                  <th>Jnl</th>
                  <th>Pièce</th>
                  <th>Libellé</th>
                  <th className="num">Montant</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((e) => {
                  const t = totals(e.lignes);
                  return (
                    <Fragment key={e.id}>
                      <tr className={selected.has(e.id) ? "selected" : ""} onClick={() => setExpanded(expanded === e.id ? null : e.id)} style={{ cursor: "pointer" }}>
                        <td onClick={(ev) => ev.stopPropagation()}>
                          {e.statut === "brouillard" && can("compta:validate") && !clos && (
                            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Sélectionner ${e.pieceRef}`} />
                          )}
                        </td>
                        <td className="mono">{e.numero ?? "—"}</td>
                        <td><DateFr iso={e.date} /></td>
                        <td><Badge>{e.journal}</Badge></td>
                        <td className="mono">{e.pieceRef}</td>
                        <td>
                          {e.libelle}
                          {e.extourneDe && <div className="subtle">Contre-passation de l'écriture #{e.extourneDe}</div>}
                          {e.factureId && <div className="subtle">Générée par une facture</div>}
                        </td>
                        <td><Money cents={t.debit} /></td>
                        <td>{e.statut === "validee" ? <Badge tone="ok"><Icon.lock /> Validée</Badge> : <Badge tone="warn">Brouillard</Badge>}</td>
                        <td className="actions" onClick={(ev) => ev.stopPropagation()}>
                          {e.statut === "brouillard" && can("compta:write") && !clos && (
                            <>
                              <Link className="btn ghost sm" to={`${base}/saisie/${e.id}`}>Modifier</Link>
                              {!e.factureId && <button className="btn ghost sm" onClick={() => supprimer(e)} aria-label="Supprimer"><Icon.trash /></button>}
                            </>
                          )}
                          {e.statut === "validee" && can("compta:validate") && !clos && e.journal !== "AN" && (
                            <button className="btn ghost sm" onClick={() => setExtourne(e)}><Icon.undo /> Contre-passer</button>
                          )}
                        </td>
                      </tr>
                      {expanded === e.id && (
                        <tr>
                          <td />
                          <td colSpan={8} style={{ background: "var(--surface-2)" }}>
                            <table>
                              <thead><tr><th>Compte</th><th>Aux.</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th><th>Lettrage</th></tr></thead>
                              <tbody>
                                {e.lignes.map((l) => (
                                  <tr key={l.id}>
                                    <td className="mono">{l.compte}</td>
                                    <td className="mono">{l.compteAux ?? ""}</td>
                                    <td>{l.libelle || e.libelle}{l.tauxTva != null && <span className="subtle"> · TVA {l.tauxTva / 100} %</span>}</td>
                                    <td><Money cents={l.debit} hideZero /></td>
                                    <td><Money cents={l.credit} hideZero /></td>
                                    <td>{l.lettrage && <Badge tone="info">{l.lettrage}</Badge>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {e.hash && <div style={{ marginTop: 8 }} className="subtle">Validée le <DateFr iso={e.validatedAt} withTime /> · empreinte <Hash value={e.hash} /></div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {extourne && <ExtourneModal ecriture={extourne} onClose={() => setExtourne(null)} onDone={reload} />}
    </div>
  );
}

function ExtourneModal({ ecriture, onClose, onDone }: { ecriture: Ecriture; onClose: () => void; onDone: () => void }) {
  const { dossier, exercice } = useDossier();
  const toast = useToast();
  const [date, setDate] = useState(ecriture.date);
  const [motif, setMotif] = useState("");
  const { pending, error, run } = useAction();
  return (
    <Modal title="Contre-passation" onClose={onClose}>
      <div className="stack">
        <p className="muted">
          L'écriture <strong>n° {ecriture.numero}</strong> ({ecriture.libelle}) est intangible. Une écriture inverse sera créée en brouillard pour l'annuler ; vous pourrez ensuite saisir l'écriture correcte.
        </p>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Date de l'extourne"><input type="date" value={date} min={exercice.debut} max={exercice.fin} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Motif" span2><input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. erreur d'imputation" /></Field>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn primary"
            disabled={pending || motif.trim().length < 3}
            onClick={() =>
              run(async () => {
                await api.post(`/api/dossiers/${dossier.id}/ecritures/${ecriture.id}/extourner`, { date, motif });
                toast("Contre-passation créée en brouillard");
                onDone();
                onClose();
              })
            }
          >
            Créer la contre-passation
          </button>
        </div>
      </div>
    </Modal>
  );
}
