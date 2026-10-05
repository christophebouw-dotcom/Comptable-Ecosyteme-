import { type CategorieDonnees, type DecisionEffacement, type EvaluationViolation, REGLES_CONSERVATION, type RegleConservation, type Traitement } from "@compta/core";
import { useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { Icon } from "../components/icons";
import { Alert, Badge, Card, DateFr, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Stat } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApi, useAuth, useToast } from "../lib/hooks";

export function RgpdPage() {
  const { can } = useAuth();
  if (!can("rgpd:manage")) return <div className="page"><Alert tone="danger">Accès réservé au délégué à la protection des données et aux administrateurs.</Alert></div>;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? "active" : ""}`;
  return (
    <div className="page">
      <PageHeader title="Centre RGPD" subtitle="Pilotage de la conformité au Règlement (UE) 2016/679 et à la loi Informatique et Libertés." />
      <nav className="tabs">
        <NavLink to="/rgpd" end className={tab}>Vue d'ensemble</NavLink>
        <NavLink to="/rgpd/demandes" className={tab}>Demandes de droits</NavLink>
        <NavLink to="/rgpd/violations" className={tab}>Violations de données</NavLink>
        <NavLink to="/rgpd/registre" className={tab}>Registre des traitements</NavLink>
        <NavLink to="/rgpd/conservation" className={tab}>Durées de conservation</NavLink>
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="demandes" element={<Demandes />} />
        <Route path="violations" element={<Violations />} />
        <Route path="registre" element={<Registre />} />
        <Route path="conservation" element={<Conservation />} />
        <Route path="*" element={<Navigate to="/rgpd" replace />} />
      </Routes>
    </div>
  );
}

// -- Vue d'ensemble ---------------------------------------------------------------

interface Dashboard {
  demandesEnCours: number;
  demandesUrgentes: number;
  violationsOuvertes: number;
  notificationsEnAttente: { id: number; titre: string; heuresRestantes: number | null; echeanceNotification: string }[];
  traitements: number;
  aipdRequises: { reference: string; nom: string }[];
  simulationPurge: { libelle: string; nombre: number; action: string; baseLegale: string }[];
}

function Overview() {
  const { data, error } = useApi<Dashboard>("/api/rgpd/tableau-de-bord");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {data.notificationsEnAttente.map((v) => (
        <Alert key={v.id} tone="danger" title={`Notification CNIL requise : ${v.titre}`}>
          Échéance légale (72 h, art. 33) : <DateFr iso={v.echeanceNotification} withTime /> —{" "}
          {v.heuresRestantes !== null && v.heuresRestantes >= 0 ? `${v.heuresRestantes} h restantes` : "délai dépassé : notifiez sans délai en motivant le retard"}.
          Téléservice : notifications.cnil.fr
        </Alert>
      ))}
      <div className="grid grid-4">
        <Stat label="Demandes en cours" value={data.demandesEnCours} hint={`${data.demandesUrgentes} urgente(s) ou en retard`} tone={data.demandesUrgentes ? "danger" : undefined} />
        <Stat label="Violations ouvertes" value={data.violationsOuvertes} tone={data.violationsOuvertes ? "danger" : "ok"} />
        <Stat label="Traitements recensés" value={data.traitements} hint="Registre art. 30" />
        <Stat label="AIPD requises" value={data.aipdRequises.length} hint="Analyses d'impact (art. 35)" />
      </div>
      <div className="grid grid-2">
        <Card title="Données arrivées à échéance" subtitle="Simulation de la purge quotidienne automatique">
          {data.simulationPurge.length === 0 ? (
            <Alert tone="ok">Aucune donnée en dépassement de sa durée de conservation.</Alert>
          ) : (
            <ul className="timeline">
              {data.simulationPurge.map((r, i) => (
                <li key={i}><Badge tone="warn">{r.nombre}</Badge><span>{r.libelle} — <span className="subtle">{r.action} ({r.baseLegale})</span></span></li>
              ))}
            </ul>
          )}
          <PurgeButton />
        </Card>
        <Card title="Analyses d'impact (AIPD)" subtitle="Traitements figurant sur la liste CNIL des opérations nécessitant une AIPD">
          {data.aipdRequises.length === 0 ? <Empty title="Aucune" /> : (
            <ul className="timeline">
              {data.aipdRequises.map((t) => <li key={t.reference}><Badge>{t.reference}</Badge><span>{t.nom}</span></li>)}
            </ul>
          )}
          <p className="subtle" style={{ marginTop: 10 }}>L'outil PIA de la CNIL permet de conduire et documenter ces analyses.</p>
        </Card>
      </div>
    </div>
  );
}

function PurgeButton() {
  const toast = useToast();
  const { pending, error, run } = useAction();
  return (
    <div style={{ marginTop: 14 }}>
      <ErrorBox error={error} />
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          run(async () => {
            if (!confirm("Exécuter maintenant la purge des données arrivées à échéance ? Les suppressions et anonymisations sont définitives.")) return;
            const r = await api.post<{ rapport: { nombre: number }[] }>("/api/rgpd/purge", { dryRun: false });
            toast(`Purge effectuée : ${r.rapport.reduce((a, x) => a + x.nombre, 0)} élément(s) traité(s)`);
          })
        }
      >
        Exécuter la purge maintenant
      </button>
    </div>
  );
}

// -- Demandes de droits ------------------------------------------------------------

interface Demande {
  id: number;
  type: string;
  typeLibelle: string;
  article: string;
  statut: string;
  demandeur: string;
  email: string;
  canal: string;
  recueLe: string;
  echeance: string;
  prolongee: boolean;
  identiteVerifiee: boolean;
  joursRestants: number | null;
  urgence: "ok" | "attention" | "urgent" | "depassee" | null;
  reponse: string | null;
  clotureeLe: string | null;
  analyse: { actions?: string[] } | null;
}

const STATUTS: Record<string, string> = {
  recue: "Reçue", identite_a_verifier: "Identité à vérifier", en_cours: "En cours", prolongee: "Prolongée", traitee: "Traitée", refusee: "Refusée",
};

function Demandes() {
  const { data, error, loading, reload } = useApi<Demande[]>("/api/rgpd/demandes");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Demande | null>(null);
  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">Délai de réponse : 1 mois, prolongeable de 2 mois si nécessaire (art. 12.3). Réponse gratuite.</p>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon.plus /> Enregistrer une demande</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="Aucune demande" /> : (
          <table>
            <thead><tr><th>Demande</th><th>Demandeur</th><th>Reçue le</th><th>Échéance</th><th>Statut</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} onClick={() => setOpen(d)} style={{ cursor: "pointer" }}>
                  <td><strong>{d.typeLibelle}</strong><div className="subtle">{d.article}</div></td>
                  <td>{d.demandeur}<div className="subtle">{d.email}</div></td>
                  <td><DateFr iso={d.recueLe} /></td>
                  <td>
                    <DateFr iso={d.echeance} />{" "}
                    {d.joursRestants !== null && (
                      <Badge tone={d.urgence === "depassee" ? "danger" : d.urgence === "urgent" ? "warn" : d.urgence === "attention" ? "info" : undefined}>
                        {d.joursRestants < 0 ? `${-d.joursRestants} j de retard` : `J-${d.joursRestants}`}
                      </Badge>
                    )}
                  </td>
                  <td><Badge tone={d.statut === "traitee" ? "ok" : d.statut === "refusee" ? "danger" : "warn"}>{STATUTS[d.statut] ?? d.statut}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <NouvelleDemande onClose={() => setCreating(false)} onSaved={reload} />}
      {open && <DemandeModal demande={open} onClose={() => setOpen(null)} onChanged={(d) => { setOpen(d); reload(); }} />}
    </div>
  );
}

function NouvelleDemande({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ type: "acces", nom: "", email: "", canal: "e-mail", recueLe: new Date().toISOString().slice(0, 10) });
  const { pending, error, run } = useAction();
  return (
    <Modal title="Nouvelle demande d'exercice des droits" onClose={onClose}>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Droit exercé">
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="acces">Accès (art. 15)</option>
              <option value="rectification">Rectification (art. 16)</option>
              <option value="effacement">Effacement (art. 17)</option>
              <option value="limitation">Limitation (art. 18)</option>
              <option value="portabilite">Portabilité (art. 20)</option>
              <option value="opposition">Opposition (art. 21)</option>
              <option value="retrait_consentement">Retrait du consentement (art. 7.3)</option>
            </select>
          </Field>
          <Field label="Reçue le" hint="Point de départ du délai d'un mois"><input type="date" value={f.recueLe} onChange={(e) => setF({ ...f, recueLe: e.target.value })} /></Field>
          <Field label="Nom du demandeur"><input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Field>
          <Field label="E-mail du demandeur" hint="Sert à retrouver ses données (index chiffré)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Canal de réception"><input value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending} onClick={() => run(async () => { await api.post("/api/rgpd/demandes", f); onSaved(); onClose(); })}>Enregistrer</button>
        </div>
      </div>
    </Modal>
  );
}

function DemandeModal({ demande: d, onClose, onChanged }: { demande: Demande; onClose: () => void; onChanged: (d: Demande) => void }) {
  const toast = useToast();
  const analyse = useApi<{ inventaire: { categorie: string; description: string; dateDepart: string }[]; decisions: DecisionEffacement[] | null }>(d.identiteVerifiee ? `/api/rgpd/demandes/${d.id}/analyse` : null);
  const action = useAction();
  const [refus, setRefus] = useState("");
  const patch = (body: object, msg: string) => action.run(async () => { onChanged(await api.patch<Demande>(`/api/rgpd/demandes/${d.id}`, body)); toast(msg); });
  const clos = !!d.clotureeLe;

  return (
    <Modal title={`${d.typeLibelle} — ${d.demandeur}`} onClose={onClose} wide>
      <div className="stack">
        <ErrorBox error={action.error ?? analyse.error} />
        <div className="row">
          <Badge>{d.article}</Badge>
          <Badge tone={clos ? "ok" : "warn"}>{STATUTS[d.statut]}</Badge>
          <span className="subtle">Reçue le <DateFr iso={d.recueLe} /> par {d.canal} · échéance <DateFr iso={d.echeance} />{d.prolongee && " (prolongée)"}</span>
        </div>

        {!clos && !d.identiteVerifiee && (
          <Alert tone="warn" title="Étape 1 — Vérifier l'identité du demandeur">
            En cas de doute raisonnable, demandez des informations complémentaires (art. 12.6) — sans exiger systématiquement une pièce d'identité.
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary sm" onClick={() => patch({ identiteVerifiee: true }, "Identité vérifiée")}>Identité vérifiée</button>
            </div>
          </Alert>
        )}

        {d.identiteVerifiee && analyse.data && (
          <Card title="Données détenues sur la personne">
            {analyse.data.inventaire.length === 0 ? <p className="muted">Aucune donnée trouvée pour cette adresse e-mail.</p> : (
              <ul className="timeline">
                {analyse.data.inventaire.map((x, i) => <li key={i}><Badge>{REGLES_CONSERVATION[x.categorie as CategorieDonnees]?.libelle ?? x.categorie}</Badge><span>{x.description}</span></li>)}
              </ul>
            )}
            {analyse.data.decisions && (
              <>
                <h3 style={{ margin: "16px 0 8px" }}>Analyse de l'effacement</h3>
                <table>
                  <tbody>
                    {analyse.data.decisions.map((x, i) => (
                      <tr key={i}>
                        <td>{x.description}</td>
                        <td>{x.decision === "effacer" ? <Badge tone="ok">Effacer</Badge> : <Badge tone="warn">Conserver (accès restreint)</Badge>}</td>
                        <td className="subtle">{x.motif}{x.effacementPrevuLe && <> Suppression prévue le <DateFr iso={x.effacementPrevuLe} />.</>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        )}

        {!clos && d.identiteVerifiee && (
          <div className="row">
            <button className="btn primary" disabled={action.pending} onClick={() => action.run(async () => {
              if (d.type === "effacement" && !confirm("Exécuter l'effacement ? Les données effaçables seront supprimées définitivement.")) return;
              onChanged(await api.post<Demande>(`/api/rgpd/demandes/${d.id}/traiter`)); toast("Demande traitée");
            })}><Icon.check /> Traiter et clôturer</button>
            {(d.type === "acces" || d.type === "portabilite") && <a className="btn" href={`/api/rgpd/demandes/${d.id}/export`} download><Icon.download /> Export JSON</a>}
            {!d.prolongee && <button className="btn" onClick={() => patch({ prolonger: true }, "Délai prolongé de 2 mois — informez le demandeur")}>Prolonger de 2 mois</button>}
          </div>
        )}
        {!clos && (
          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>Refuser la demande (manifestement infondée ou excessive, art. 12.5)</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <textarea value={refus} onChange={(e) => setRefus(e.target.value)} placeholder="Motivation du refus, communiquée au demandeur avec les voies de recours (CNIL, juridiction)" />
              <button className="btn danger" disabled={refus.length < 10} onClick={() => patch({ refuser: refus }, "Demande refusée")}>Refuser</button>
            </div>
          </details>
        )}
        {d.analyse?.actions && <Alert tone="ok" title="Actions réalisées"><ul>{d.analyse.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></Alert>}
        {d.reponse && (
          <Card title="Réponse au demandeur" actions={<button className="btn sm" onClick={() => { void navigator.clipboard.writeText(d.reponse!); toast("Réponse copiée"); }}>Copier</button>}>
            <pre className="letter">{d.reponse}</pre>
          </Card>
        )}
      </div>
    </Modal>
  );
}

// -- Violations ---------------------------------------------------------------------

interface Violation {
  id: number;
  titre: string;
  description: string;
  connueLe: string;
  echeanceNotification: string;
  heuresRestantes: number | null;
  score: number;
  niveau: string;
  notificationCnilRequise: boolean;
  notifieeCnilLe: string | null;
  informationPersonnesRequise: boolean;
  personnesInformeesLe: string | null;
  nbPersonnes: number | null;
  mesures: string | null;
  statut: string;
}

const NIVEAUX: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" }> = {
  faible: { label: "Faible", tone: "ok" },
  moyen: { label: "Moyen", tone: "info" },
  eleve: { label: "Élevé", tone: "warn" },
  tres_eleve: { label: "Très élevé", tone: "danger" },
};

function Violations() {
  const { data, error, loading, reload } = useApi<{ violations: Violation[]; contextes: Record<string, string> }>("/api/rgpd/violations");
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const now = () => new Date().toISOString();
  const patch = (id: number, body: object) => action.run(async () => { await api.patch(`/api/rgpd/violations/${id}`, body); reload(); });

  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">Toute violation est documentée (art. 33.5). Notification à la CNIL sous 72 h si risque ; information des personnes si risque élevé (art. 34).</p>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon.plus /> Déclarer une violation</button>
      </div>
      <ErrorBox error={error ?? action.error} />
      {loading && !data ? <Loading /> : !data?.violations.length ? <div className="card"><Empty title="Aucune violation enregistrée" /></div> : data.violations.map((v) => (
        <Card key={v.id} title={v.titre} subtitle={<>Connue le <DateFr iso={v.connueLe} withTime /> · {v.nbPersonnes ?? "?"} personne(s) concernée(s)</>} actions={<><Badge tone={NIVEAUX[v.niveau]?.tone}>Gravité {NIVEAUX[v.niveau]?.label} ({v.score})</Badge>{v.statut === "cloturee" && <Badge tone="ok">Clôturée</Badge>}</>}>
          <div className="stack">
            <p>{v.description}</p>
            <div className="grid grid-2">
              <div>
                <h3>Notification CNIL (art. 33)</h3>
                {!v.notificationCnilRequise ? <p className="muted">Non requise (risque improbable) — documentation interne uniquement.</p> : v.notifieeCnilLe ? (
                  <p className="ok-text">Notifiée le <DateFr iso={v.notifieeCnilLe} withTime /></p>
                ) : (
                  <div className="stack">
                    <p className={v.heuresRestantes !== null && v.heuresRestantes < 24 ? "danger-text" : ""}>
                      Avant le <DateFr iso={v.echeanceNotification} withTime /> ({v.heuresRestantes !== null && v.heuresRestantes >= 0 ? `${v.heuresRestantes} h restantes` : "délai dépassé"})
                    </p>
                    <button className="btn sm" onClick={() => patch(v.id, { notifieeCnilLe: now() })}>Marquer comme notifiée</button>
                  </div>
                )}
              </div>
              <div>
                <h3>Information des personnes (art. 34)</h3>
                {!v.informationPersonnesRequise ? <p className="muted">Non requise.</p> : v.personnesInformeesLe ? (
                  <p className="ok-text">Informées le <DateFr iso={v.personnesInformeesLe} withTime /></p>
                ) : (
                  <button className="btn sm" onClick={() => patch(v.id, { personnesInformeesLe: now() })}>Marquer comme informées</button>
                )}
              </div>
            </div>
            {v.mesures && <p><strong>Mesures :</strong> {v.mesures}</p>}
            {v.statut !== "cloturee" && <div><button className="btn sm" onClick={() => patch(v.id, { cloturer: true })}>Clôturer l'incident</button></div>}
          </div>
        </Card>
      ))}
      {creating && data && <NouvelleViolation contextes={data.contextes} onClose={() => setCreating(false)} onSaved={reload} />}
    </div>
  );
}

function NouvelleViolation({ contextes, onClose, onSaved }: { contextes: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    titre: "", description: "", connueLe: new Date().toISOString().slice(0, 16), dpc: 1, ei: 0.5, nbPersonnes: "", categoriesDonnees: "", mesures: "",
    confidentialite: "limitee", integrite: "aucune", disponibilite: "aucune", malveillance: false,
  });
  const [evaluation, setEvaluation] = useState<EvaluationViolation | null>(null);
  const { pending, error, run } = useAction();
  const circonstances = { confidentialite: f.confidentialite, integrite: f.integrite, disponibilite: f.disponibilite, malveillance: f.malveillance };
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setEvaluation(null); };

  return (
    <Modal title="Déclarer une violation de données" onClose={onClose} wide>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Intitulé" span2><input value={f.titre} onChange={(e) => set({ titre: e.target.value })} /></Field>
          <Field label="Date et heure de prise de connaissance" hint="Point de départ du délai de 72 h"><input type="datetime-local" value={f.connueLe} onChange={(e) => set({ connueLe: e.target.value })} /></Field>
          <Field label="Personnes concernées (nombre)"><input inputMode="numeric" value={f.nbPersonnes} onChange={(e) => set({ nbPersonnes: e.target.value })} /></Field>
          <Field label="Description des faits" span2><textarea value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Nature des données (contexte)" span2>
            <select value={f.dpc} onChange={(e) => set({ dpc: Number(e.target.value) })}>
              {Object.entries(contextes).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
            </select>
          </Field>
          <Field label="Facilité d'identification des personnes">
            <select value={f.ei} onChange={(e) => set({ ei: Number(e.target.value) })}>
              <option value={0.25}>Négligeable (données pseudonymisées)</option>
              <option value={0.5}>Limitée</option>
              <option value={0.75}>Importante</option>
              <option value={1}>Maximale (nom, e-mail…)</option>
            </select>
          </Field>
          <Field label="Perte de confidentialité">
            <select value={f.confidentialite} onChange={(e) => set({ confidentialite: e.target.value })}>
              <option value="aucune">Aucune</option><option value="limitee">Limitée (destinataires connus)</option><option value="large">Large (diffusion, Internet)</option>
            </select>
          </Field>
          <Field label="Perte d'intégrité">
            <select value={f.integrite} onChange={(e) => set({ integrite: e.target.value })}>
              <option value="aucune">Aucune</option><option value="recuperable">Altération récupérable</option><option value="irrecuperable">Altération irrécupérable</option>
            </select>
          </Field>
          <Field label="Perte de disponibilité">
            <select value={f.disponibilite} onChange={(e) => set({ disponibilite: e.target.value })}>
              <option value="aucune">Aucune</option><option value="temporaire">Temporaire</option><option value="definitive">Définitive</option>
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={f.malveillance} onChange={(e) => set({ malveillance: e.target.checked })} /> Intention malveillante (vol, piratage)</label>
          <Field label="Mesures prises ou envisagées" span2><textarea value={f.mesures} onChange={(e) => set({ mesures: e.target.value })} /></Field>
        </div>
        {evaluation && (
          <Alert tone={evaluation.notificationCnil ? "danger" : "ok"} title={`Gravité : ${NIVEAUX[evaluation.niveau]?.label} (score ENISA ${evaluation.score})`}>{evaluation.justification}</Alert>
        )}
        <div className="form-actions">
          <button className="btn" onClick={() => run(async () => setEvaluation(await api.post<EvaluationViolation>("/api/rgpd/violations/evaluer", { dpc: f.dpc, ei: f.ei, circonstances })))}>Évaluer la gravité</button>
          <button className="btn primary" disabled={pending || !f.titre || f.description.length < 10} onClick={() => run(async () => {
            await api.post("/api/rgpd/violations", {
              titre: f.titre, description: f.description, connueLe: new Date(f.connueLe).toISOString(), dpc: f.dpc, ei: f.ei, circonstances,
              nbPersonnes: f.nbPersonnes ? Number(f.nbPersonnes) : undefined, categoriesDonnees: f.categoriesDonnees || undefined, mesures: f.mesures || undefined,
            });
            onSaved(); onClose();
          })}>Enregistrer au registre</button>
        </div>
      </div>
    </Modal>
  );
}

// -- Registre -----------------------------------------------------------------------

function Registre() {
  const { data, error, loading } = useApi<{ traitements: (Traitement & { updatedAt: string })[]; basesLegales: Record<string, string>; conservation: Record<string, RegleConservation> }>("/api/rgpd/registre");
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading />;
  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">Registre des activités de traitement (art. 30). Le cabinet agit comme responsable de traitement et comme sous-traitant de ses clients (art. 28).</p>
        <button className="btn" onClick={() => window.print()}>Imprimer le registre</button>
      </div>
      {data.traitements.map((t) => (
        <Card key={t.reference} title={<><span className="mono">{t.reference}</span> — {t.nom}</>} actions={<>
          <Badge tone={t.role === "responsable" ? "info" : undefined}>{t.role === "responsable" ? "Responsable de traitement" : "Sous-traitant (art. 28)"}</Badge>
          {t.donneesSensibles && <Badge tone="warn">Données sensibles / NIR</Badge>}
          {t.aipdRequise && <Badge tone="danger">AIPD requise</Badge>}
        </>}>
          <dl className="kv">
            <dt>Finalités</dt><dd>{t.finalites.join(" ; ")}</dd>
            <dt>Base légale</dt><dd>{data.basesLegales[t.baseLegale]}{t.precisionBaseLegale && <div className="subtle">{t.precisionBaseLegale}</div>}</dd>
            <dt>Personnes concernées</dt><dd>{t.personnesConcernees.join(", ")}</dd>
            <dt>Catégories de données</dt><dd>{t.categoriesDonnees.join(", ")}</dd>
            <dt>Destinataires</dt><dd>{t.destinataires.join(", ")}</dd>
            <dt>Transferts hors UE</dt><dd>{t.transfertsHorsUE}</dd>
            <dt>Conservation</dt><dd>{t.conservation.map((c) => { const r = data.conservation[c]; return r ? `${r.libelle} : ${r.dureeMois / 12} an(s)` : c; }).join(" ; ")}</dd>
            <dt>Mesures de sécurité</dt><dd>{t.mesuresSecurite.join(" ; ")}</dd>
          </dl>
        </Card>
      ))}
    </div>
  );
}

// -- Conservation ---------------------------------------------------------------------

function Conservation() {
  const { data } = useApi<{ conservation: Record<string, RegleConservation> }>("/api/rgpd/registre");
  if (!data) return <Loading />;
  return (
    <div className="card">
      <table>
        <thead><tr><th>Catégorie</th><th>Point de départ</th><th className="num">Durée</th><th>En fin de durée</th><th>Fondement</th><th>Bloque l'effacement</th></tr></thead>
        <tbody>
          {Object.values(data.conservation).map((r) => (
            <tr key={r.categorie}>
              <td><strong>{r.libelle}</strong></td>
              <td>{r.pointDeDepart}</td>
              <td className="num">{r.dureeMois % 12 === 0 ? `${r.dureeMois / 12} an${r.dureeMois > 12 ? "s" : ""}` : `${r.dureeMois} mois`}</td>
              <td>{r.action}</td>
              <td className="subtle">{r.baseLegale}</td>
              <td>{r.obligationLegale ? <Badge tone="warn">Oui (art. 17.3)</Badge> : <Badge>Non</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
