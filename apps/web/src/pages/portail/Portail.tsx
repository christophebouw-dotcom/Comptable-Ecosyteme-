/**
 * Portail client : espace simplifié du dirigeant (tableau de bord, dépôt de
 * justificatifs, demandes du cabinet, messagerie, documents).
 */
import { type Echeance, formatEUR } from "@compta/core";
import { type DragEvent, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, Route, Routes, useOutletContext, useParams } from "react-router";
import { type BulletinDetail, BulletinView } from "../../components/Bulletin";
import { type Demande, DemandeLigne, Messagerie } from "../../components/Echanges";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, DateFr, Empty, ErrorBox, Loading, Money, Stat } from "../../components/ui";
import { api } from "../../lib/api";
import { ACCEPT_PIECES, corpsDepot } from "../../lib/fichiers";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { AccountPage } from "../AccountPage";
import { ConfidentialitePage } from "../ConfidentialitePage";

interface DossierPortail {
  id: number;
  raisonSociale: string;
  siren: string;
  ville: string;
  demandesOuvertes: number;
  messagesNonLus: number;
}

interface TableauDeBord {
  dossier: { id: number; raisonSociale: string; siren: string };
  exercice: { debut: string; fin: string; statut: string };
  indicateurs: { chiffreAffaires: number; resultat: number; tresorerie: number; creancesClients: number; dettesFournisseurs: number };
  caMensuel: { mois: string; ca: number }[];
  pieces: { enCours: number; comptabilisees: number };
  demandesOuvertes: number;
  messagesNonLus: number;
  echeances: Echeance[];
  alertes: string[];
  provisoire: boolean;
}

interface PortailCtx {
  dossier: DossierPortail;
  dossiers: DossierPortail[];
  rafraichir: () => void;
}
const usePortail = () => useOutletContext<PortailCtx>();

export function PortailApp() {
  return (
    <Routes>
      <Route path="/confidentialite" element={<ConfidentialitePage />} />
      <Route element={<PortailShell />}>
        <Route index element={<ChoixDossier />} />
        <Route path="compte" element={<AccountPage />} />
        <Route path="espace/:dossierId" element={<EspaceDossier />}>
          <Route index element={<Accueil />} />
          <Route path="deposer" element={<Deposer />} />
          <Route path="demandes" element={<Demandes />} />
          <Route path="messages" element={<Messages />} />
          <Route path="documents" element={<Documents />} />
          <Route path="bulletins/:bulletinId" element={<BulletinClient />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function PortailShell() {
  const { user, logout } = useAuth();
  const dossiers = useApi<DossierPortail[]>("/api/portail/dossiers");
  return (
    <div className="portail">
      <header className="portail-header">
        <Link to="/" className="portail-brand">
          <img src="/favicon.svg" width={28} height={28} alt="" />
          <span>Mon espace comptable</span>
        </Link>
        <div className="row">
          <NavLink to="/compte" className="btn ghost sm"><Icon.user /> {user!.nom}</NavLink>
          <button className="btn ghost sm" onClick={logout}><Icon.logout /> Déconnexion</button>
        </div>
      </header>
      <ErrorBox error={dossiers.error} />
      {dossiers.loading && !dossiers.data ? <Loading /> : <Outlet context={{ dossiers: dossiers.data ?? [], rafraichir: dossiers.reload }} />}
      <footer className="portail-footer subtle">
        Vos documents sont chiffrés et hébergés dans l'Union européenne. <Link to="/confidentialite">Confidentialité et vos droits</Link>
      </footer>
    </div>
  );
}

function ChoixDossier() {
  const { dossiers } = useOutletContext<{ dossiers: DossierPortail[] }>();
  if (dossiers.length === 1) return <Navigate to={`/espace/${dossiers[0]!.id}`} replace />;
  return (
    <div className="portail-page">
      <h1>Vos entreprises</h1>
      {!dossiers.length ? (
        <Empty title="Aucun dossier">Votre cabinet ne vous a pas encore donné accès à un dossier.</Empty>
      ) : (
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          {dossiers.map((d) => (
            <Link key={d.id} to={`/espace/${d.id}`} className="card portail-choix">
              <strong>{d.raisonSociale}</strong>
              <span className="subtle">SIREN {d.siren} · {d.ville}</span>
              <div className="row">
                {d.demandesOuvertes > 0 && <Badge tone="warn">{d.demandesOuvertes} document(s) demandé(s)</Badge>}
                {d.messagesNonLus > 0 && <Badge tone="info">{d.messagesNonLus} message(s)</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function EspaceDossier() {
  const { dossierId } = useParams();
  const { dossiers, rafraichir } = useOutletContext<{ dossiers: DossierPortail[]; rafraichir: () => void }>();
  const dossier = dossiers.find((d) => String(d.id) === dossierId);
  if (!dossier) return <div className="portail-page"><Alert tone="danger" title="Dossier introuvable" /></div>;
  const base = `/espace/${dossier.id}`;
  const lien = ({ isActive }: { isActive: boolean }) => `portail-onglet ${isActive ? "active" : ""}`;
  return (
    <div className="portail-page">
      <div className="row between portail-titre">
        <div>
          <h1>{dossier.raisonSociale}</h1>
          <span className="subtle">SIREN {dossier.siren}</span>
        </div>
        {dossiers.length > 1 && <Link to="/" className="btn sm">Changer d'entreprise</Link>}
      </div>
      <nav className="portail-nav" aria-label="Mon espace">
        <NavLink to={base} end className={lien}><Icon.home /> Accueil</NavLink>
        <NavLink to={`${base}/deposer`} className={lien}><Icon.upload /> Déposer</NavLink>
        <NavLink to={`${base}/demandes`} className={lien}><Icon.inbox /> Demandes{dossier.demandesOuvertes > 0 && <span className="pastille">{dossier.demandesOuvertes}</span>}</NavLink>
        <NavLink to={`${base}/messages`} className={lien}><Icon.message /> Messages{dossier.messagesNonLus > 0 && <span className="pastille">{dossier.messagesNonLus}</span>}</NavLink>
        <NavLink to={`${base}/documents`} className={lien}><Icon.file /> Documents</NavLink>
      </nav>
      <Outlet context={{ dossier, dossiers, rafraichir } satisfies PortailCtx} />
    </div>
  );
}

// -- Accueil -------------------------------------------------------------------

function Accueil() {
  const { dossier } = usePortail();
  const { user } = useAuth();
  const { data, error, loading } = useApi<TableauDeBord>(`/api/portail/dossiers/${dossier.id}`);
  const base = `/espace/${dossier.id}`;
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const i = data.indicateurs;
  return (
    <div className="stack">
      <p className="muted">Bonjour {user!.nom.split(" ")[0]}, voici la situation de l'exercice {data.exercice.debut.slice(0, 4)} au {new Date().toLocaleDateString("fr-FR")}.</p>
      {(data.demandesOuvertes > 0 || data.messagesNonLus > 0) && (
        <Alert tone="warn" title="Votre cabinet attend un retour de votre part">
          <div className="row" style={{ marginTop: 6 }}>
            {data.demandesOuvertes > 0 && <Link className="btn sm primary" to={`${base}/demandes`}>{data.demandesOuvertes} document(s) à fournir</Link>}
            {data.messagesNonLus > 0 && <Link className="btn sm" to={`${base}/messages`}>{data.messagesNonLus} nouveau(x) message(s)</Link>}
          </div>
        </Alert>
      )}
      <div className="grid grid-3">
        <Stat label="Chiffre d'affaires" value={<Money cents={i.chiffreAffaires} />} hint={`Depuis le ${data.exercice.debut.split("-").reverse().join("/")}`} />
        <Stat label="Résultat provisoire" value={<Money cents={i.resultat} signed />} tone={i.resultat < 0 ? "danger" : "ok"} hint="Comptabilité en cours, non révisée" />
        <Stat label="Trésorerie" value={<Money cents={i.tresorerie} signed />} hint="Banque et caisse, selon la comptabilité" />
        <Stat label="Clients à encaisser" value={<Money cents={i.creancesClients} />} />
        <Stat label="Fournisseurs à payer" value={<Money cents={i.dettesFournisseurs} />} />
        <Stat label="Justificatifs" value={`${data.pieces.comptabilisees} traités`} hint={data.pieces.enCours ? `${data.pieces.enCours} en cours de traitement` : "Aucun en attente"} />
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Card title="Chiffre d'affaires mensuel (HT)">
          <GraphiqueCa mois={data.caMensuel} />
        </Card>
        <Card title="Prochaines échéances fiscales">
          {data.echeances.length ? (
            <ul className="echeances">
              {data.echeances.map((e, k) => (
                <li key={k}><DateFr iso={e.date} /> <span>{e.libelle}</span></li>
              ))}
            </ul>
          ) : <Empty title="Aucune échéance proche" />}
          <p className="subtle" style={{ marginTop: 8 }}>Dates indicatives : votre cabinet vous confirme les montants.</p>
        </Card>
      </div>
      <Link to={`${base}/deposer`} className="card portail-cta">
        <Icon.upload />
        <div>
          <strong>Déposer des factures ou tickets</strong>
          <div className="subtle">PDF ou photo prise avec votre téléphone : votre cabinet s'occupe du reste.</div>
        </div>
      </Link>
      {data.provisoire && <p className="subtle">Situation provisoire établie à partir de la comptabilité en cours, non révisée par l'expert-comptable.</p>}
    </div>
  );
}

function GraphiqueCa({ mois }: { mois: { mois: string; ca: number }[] }) {
  const max = Math.max(1, ...mois.map((m) => m.ca));
  if (mois.every((m) => m.ca === 0)) return <Empty title="Pas encore de ventes enregistrées" />;
  return (
    <div className="graphique" role="img" aria-label="Chiffre d'affaires par mois">
      {mois.map((m) => (
        <div key={m.mois} className="barre" title={`${m.mois} : ${formatEUR(m.ca)}`}>
          <div className="barre-valeur" style={{ height: `${Math.max(0, (m.ca / max) * 100)}%` }} />
          <span>{new Date(`${m.mois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "narrow" })}</span>
        </div>
      ))}
    </div>
  );
}

// -- Dépôt de justificatifs ----------------------------------------------------------

function useDepot(dossierId: number, onFin: () => void) {
  const toast = useToast();
  const [envoi, setEnvoi] = useState<{ total: number; fait: number; courant: string } | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const deposer = async (files: FileList | File[], extra: { demandeId?: number } = {}) => {
    const liste = [...files];
    setErreurs([]);
    let ok = 0;
    for (let k = 0; k < liste.length; k++) {
      const f = liste[k]!;
      setEnvoi({ total: liste.length, fait: k, courant: f.name });
      try {
        await api.post(`/api/portail/dossiers/${dossierId}/pieces`, { ...(await corpsDepot(f)), ...extra });
        ok++;
      } catch (e) {
        setErreurs((x) => [...x, `${f.name} : ${(e as Error).message}`]);
      }
    }
    setEnvoi(null);
    if (ok) toast(`${ok} document(s) transmis à votre cabinet`);
    onFin();
  };
  return { envoi, erreurs, deposer };
}

function Deposer() {
  const { dossier, rafraichir } = usePortail();
  const [recents, setRecents] = useState(0);
  const { envoi, erreurs, deposer } = useDepot(dossier.id, () => { setRecents((n) => n + 1); rafraichir(); });
  const [survol, setSurvol] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setSurvol(false);
    if (e.dataTransfer.files.length) void deposer(e.dataTransfer.files);
  };
  return (
    <div className="stack">
      <label className={`dropzone ${survol ? "survol" : ""}`} onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)} onDrop={onDrop}>
        <input type="file" multiple accept={ACCEPT_PIECES} style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) void deposer(e.target.files); e.target.value = ""; }} />
        {envoi ? (
          <div>
            <strong>Envoi en cours… {envoi.fait + 1} / {envoi.total}</strong>
            <div className="subtle">{envoi.courant}</div>
            <div className="progress"><div style={{ width: `${((envoi.fait + 0.5) / envoi.total) * 100}%` }} /></div>
          </div>
        ) : (
          <div>
            <Icon.upload />
            <strong>Glissez vos factures, tickets et notes de frais ici</strong>
            <div className="subtle">ou cliquez pour choisir des fichiers — PDF, JPG, PNG ou facture électronique XML, 10 Mo maximum</div>
          </div>
        )}
      </label>
      <label className="btn primary portail-photo">
        <Icon.upload /> Prendre une photo d'un ticket
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) void deposer(e.target.files); e.target.value = ""; }} />
      </label>
      {erreurs.length > 0 && <Alert tone="danger" title="Certains fichiers n'ont pas pu être envoyés"><ul>{erreurs.map((e, k) => <li key={k}>{e}</li>)}</ul></Alert>}
      {recents > 0 && <Alert tone="ok" title="Documents transmis">Votre cabinet les traitera rapidement. Vous pouvez suivre leur avancement dans « Documents ».</Alert>}
      <Card title="Conseils">
        <ul>
          <li>Une facture par fichier, lisible et entière (photo à plat, bien éclairée).</li>
          <li>Les doublons sont détectés automatiquement : pas de risque de compter deux fois une dépense.</li>
          <li>Conservez les originaux papier des documents qui le nécessitent (actes, contrats).</li>
        </ul>
      </Card>
    </div>
  );
}

// -- Demandes du cabinet --------------------------------------------------------------

function Demandes() {
  const { dossier, rafraichir } = usePortail();
  const { data, error, loading, reload } = useApi<Demande[]>(`/api/dossiers/${dossier.id}/demandes`);
  const ouvertes = (data ?? []).filter((d) => d.statut === "ouverte");
  const autres = (data ?? []).filter((d) => d.statut !== "ouverte");
  const fin = () => { reload(); rafraichir(); };
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <Card title={`Documents demandés par votre cabinet (${ouvertes.length})`} padded={false}>
        {loading && !data ? <Loading /> : !ouvertes.length ? <Empty title="Rien à fournir pour le moment">Merci ! Toutes les demandes ont reçu une réponse.</Empty> : (
          <ul className="demandes">{ouvertes.map((d) => <DemandeOuverte key={d.id} d={d} dossierId={dossier.id} onDone={fin} />)}</ul>
        )}
      </Card>
      {autres.length > 0 && (
        <Card title="Historique" padded={false}>
          <ul className="demandes">{autres.slice(0, 30).map((d) => <DemandeLigne key={d.id} d={d} />)}</ul>
        </Card>
      )}
    </div>
  );
}

function DemandeOuverte({ d, dossierId, onDone }: { d: Demande; dossierId: number; onDone: () => void }) {
  const { envoi, erreurs, deposer } = useDepot(dossierId, onDone);
  const [texte, setTexte] = useState("");
  const [repondre, setRepondre] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <DemandeLigne d={d}>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="btn primary sm">
          <Icon.upload /> {envoi ? "Envoi…" : "Joindre le document"}
          <input type="file" accept={ACCEPT_PIECES} style={{ display: "none" }} disabled={!!envoi} onChange={(e) => { if (e.target.files?.length) void deposer(e.target.files, { demandeId: d.id }); e.target.value = ""; }} />
        </label>
        <button className="btn sm" onClick={() => setRepondre(!repondre)}>Je n'ai pas de document</button>
      </div>
      {repondre && (
        <form className="row" style={{ marginTop: 8, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); void run(async () => {
          await api.post(`/api/dossiers/${dossierId}/demandes/${d.id}/repondre`, { reponse: texte });
          onDone();
        }); }}>
          <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={2} style={{ flex: 1, minWidth: 220 }} placeholder="Ex. : dépense personnelle payée par erreur avec la carte de la société" aria-label="Explication" />
          <button className="btn sm" disabled={pending || texte.trim().length < 2}>Envoyer</button>
        </form>
      )}
      {erreurs.map((e, k) => <div key={k} className="danger-text subtle">{e}</div>)}
      <ErrorBox error={error} />
    </DemandeLigne>
  );
}

// -- Messages et documents ------------------------------------------------------------

function Messages() {
  const { dossier, rafraichir } = usePortail();
  return (
    <Card title="Messagerie avec votre cabinet" subtitle="Échanges chiffrés — réponse habituelle sous 48 heures ouvrées">
      <MessagerieClient dossierId={dossier.id} onLu={rafraichir} />
    </Card>
  );
}

function MessagerieClient({ dossierId, onLu }: { dossierId: number; onLu: () => void }) {
  // Les messages sont marqués lus à l'ouverture du fil : on rafraîchit ensuite les compteurs.
  useEffect(() => {
    const id = setTimeout(onLu, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Messagerie dossierId={dossierId} interlocuteur="votre cabinet" />;
}

interface DocumentsData {
  pieces: { id: number; nomFichier: string; statut: string; statutLibelle: string; deposeeParClient: boolean; createdAt: string }[];
  factures: { id: number; numero: string; type: string; dateEmission: string; totalTtc: number; statut: string; client: string }[];
  bulletins: { id: number; periode: string; salarie: string; netAPayer: number }[];
}

function Documents() {
  const { dossier } = usePortail();
  const { data, error, loading } = useApi<DocumentsData>(`/api/portail/dossiers/${dossier.id}/documents`);
  const [onglet, setOnglet] = useState<"pieces" | "factures" | "bulletins">("pieces");
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const tone = (s: string) => (s === "comptabilisee" ? "ok" : s === "rejetee" ? undefined : "info");
  return (
    <div className="stack">
      <div className="row">
        <button className={`btn sm ${onglet === "pieces" ? "primary" : ""}`} onClick={() => setOnglet("pieces")}>Justificatifs ({data.pieces.length})</button>
        <button className={`btn sm ${onglet === "factures" ? "primary" : ""}`} onClick={() => setOnglet("factures")}>Factures émises ({data.factures.length})</button>
        <button className={`btn sm ${onglet === "bulletins" ? "primary" : ""}`} onClick={() => setOnglet("bulletins")}>Bulletins de paie ({data.bulletins.length})</button>
      </div>
      <div className="card">
        {onglet === "pieces" && (!data.pieces.length ? <Empty title="Aucun justificatif" /> : (
          <table>
            <thead><tr><th>Document</th><th>Déposé le</th><th>État</th></tr></thead>
            <tbody>{data.pieces.map((p) => (
              <tr key={p.id}>
                <td><a href={`/api/dossiers/${dossier.id}/pieces/${p.id}/fichier`} target="_blank" rel="noopener">{p.nomFichier}</a>{!p.deposeeParClient && <span className="subtle"> · transmis par le cabinet</span>}</td>
                <td><DateFr iso={p.createdAt} /></td>
                <td><Badge tone={tone(p.statut)}>{p.statutLibelle}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {onglet === "factures" && (!data.factures.length ? <Empty title="Aucune facture émise depuis la plateforme" /> : (
          <table>
            <thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th className="num">TTC</th><th>Statut</th></tr></thead>
            <tbody>{data.factures.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.numero}{f.type === "avoir" && <> <Badge>Avoir</Badge></>}</td>
                <td>{f.client}</td>
                <td><DateFr iso={f.dateEmission} /></td>
                <td><Money cents={f.totalTtc} /></td>
                <td>{f.statut === "payee" ? <Badge tone="ok">Payée</Badge> : <Badge tone="info">Émise</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {onglet === "bulletins" && (!data.bulletins.length ? <Empty title="Aucun bulletin de paie validé" /> : (
          <table>
            <thead><tr><th>Période</th><th>Salarié</th><th className="num">Net à payer</th><th /></tr></thead>
            <tbody>{data.bulletins.map((b) => (
              <tr key={b.id}>
                <td>{new Date(`${b.periode}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                <td>{b.salarie}</td>
                <td><Money cents={b.netAPayer} /></td>
                <td className="actions"><Link className="btn sm" to={`/espace/${dossier.id}/bulletins/${b.id}`}>Ouvrir</Link></td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

function BulletinClient() {
  const { dossier } = usePortail();
  const { bulletinId } = useParams();
  const { data, error, loading } = useApi<BulletinDetail>(`/api/dossiers/${dossier.id}/paie/bulletins/${bulletinId}`);
  return (
    <div className="stack">
      <div className="row between no-print">
        <Link to={`/espace/${dossier.id}/documents`}>← Documents</Link>
        <button className="btn" onClick={() => window.print()}>Imprimer / PDF</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && <BulletinView d={data} />}
    </div>
  );
}
