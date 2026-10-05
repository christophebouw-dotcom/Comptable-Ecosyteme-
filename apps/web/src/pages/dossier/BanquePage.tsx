import { PCG_ACCOUNTS, isCollectifTiers } from "@compta/core";
import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, DateFr, Empty, ErrorBox, Loading, Money, Stat } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import type { Tiers } from "../../lib/types";
import { useDossier } from "./DossierLayout";

interface LigneBancaire {
  id: number;
  date: string;
  libelle: string;
  montant: number;
  statut: "a_traiter" | "rapprochee" | "ignoree";
  suggestion: { compte: string; compteAux?: string | null } | null;
  ia?: { justification: string; confiance: number };
}

interface BanqueData {
  lignes: LigneBancaire[];
  mouvementsNonRapproches: { id: number; date: string; montant: number; libelle: string; piece_ref: string; statut: string }[];
  etat: { soldeComptable: number; totalReleve: number; releveNonComptabilise: number; comptabiliseNonReleve: number; nbATraiter: number };
  regles: { motif: string; compte: string; compteAux: string | null }[];
}

export function BanquePage() {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<BanqueData>(`/api/dossiers/${dossier.id}/banque`);
  const tiers = useApi<Tiers[]>(`/api/dossiers/${dossier.id}/tiers`);
  const [filtre, setFiltre] = useState<"a_traiter" | "tout">("a_traiter");
  const [suggestionsIA, setSuggestionsIA] = useState<Record<number, { compte: string; compteAux: string | null; justification: string; confiance: number }>>({});
  const action = useAction();
  const base = `/api/dossiers/${dossier.id}/banque`;

  const importer = async (file: File) => {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    const format = /\.(ofx|qfx)$/i.test(file.name) || text.includes("<OFX") ? "ofx" : "csv";
    await action.run(async () => {
      const r = await api.post<{ importees: number; doublons: number; erreurs: unknown[] }>(`${base}/import`, { format, content: text, fichier: file.name });
      toast(`${r.importees} opération(s) importée(s)${r.doublons ? `, ${r.doublons} doublon(s) ignoré(s)` : ""}`);
      reload();
    });
  };

  const lignes = (data?.lignes ?? []).filter((l) => filtre === "tout" || l.statut === "a_traiter");
  const ecart = data ? data.etat.soldeComptable - data.etat.totalReleve : 0;

  return (
    <div className="stack">
      <datalist id="pcg-banque">{PCG_ACCOUNTS.map((a) => <option key={a.numero} value={a.numero}>{a.libelle}</option>)}</datalist>
      <datalist id="tiers-banque">{(tiers.data ?? []).map((t) => <option key={t.id} value={t.compteAux}>{t.nom}</option>)}</datalist>
      <div className="row between">
        <div className="row">
          <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)} style={{ width: "auto" }} aria-label="Filtre">
            <option value="a_traiter">À traiter</option>
            <option value="tout">Toutes les opérations</option>
          </select>
        </div>
        {can("compta:write") && (
          <div className="row">
            <label className="btn">
              <Icon.download /> Importer un relevé (CSV, OFX)
              <input type="file" accept=".csv,.txt,.ofx,.qfx" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) void importer(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {dossier.iaAutorisee && (
              <button className="btn" disabled={action.pending || !data?.etat.nbATraiter} onClick={() => action.run(async () => {
                const r = await api.post<{ suggestions: { id: number; compte: string; compteAux: string | null; justification: string; confiance: number }[] }>(`${base}/suggestions-ia`, {});
                setSuggestionsIA(Object.fromEntries(r.suggestions.map((s) => [s.id, s])));
                toast(`${r.suggestions.length} imputation(s) proposée(s) par l'IA — à vérifier avant de comptabiliser`);
              })}>Suggestions IA</button>
            )}
            <button className="btn primary" disabled={action.pending || !data?.etat.nbATraiter} onClick={() => action.run(async () => {
              const r = await api.post<{ rapprochees: number; restantes: number }>(`${base}/rapprochement-auto`, {});
              toast(`${r.rapprochees} opération(s) rapprochée(s) automatiquement`);
              reload();
            })}><Icon.check /> Rapprochement automatique</button>
          </div>
        )}
      </div>
      <ErrorBox error={error ?? action.error} />
      {data && (
        <div className="grid grid-4">
          <Stat label="Solde comptable 512" value={<Money cents={data.etat.soldeComptable} signed />} />
          <Stat label="Opérations à traiter" value={data.etat.nbATraiter} tone={data.etat.nbATraiter ? "danger" : "ok"} hint="Relevé non comptabilisé" />
          <Stat label="Comptabilisé non relevé" value={<Money cents={data.etat.comptabiliseNonReleve} signed />} hint={`${data.mouvementsNonRapproches.length} mouvement(s) en suspens`} />
          <Stat label="Écart à justifier" value={<Money cents={ecart} signed />} hint="Solde comptable - total des relevés importés" />
        </div>
      )}
      <div className="card">
        {loading && !data ? <Loading /> : !lignes.length ? (
          <Empty title={filtre === "a_traiter" ? "Aucune opération à traiter" : "Aucun relevé importé"}>
            Importez le relevé de la banque au format CSV ou OFX : les opérations déjà comptabilisées sont rapprochées automatiquement, les autres sont imputées en un clic.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Libellé bancaire</th><th className="num">Montant</th><th>Imputation</th><th /></tr></thead>
              <tbody>
                {lignes.map((l) => {
                  const ia = suggestionsIA[l.id];
                  const ligne = ia && !l.suggestion ? { ...l, suggestion: { compte: ia.compte, compteAux: ia.compteAux }, ia } : l;
                  return <LigneRow key={`${l.id}-${ia ? "ia" : ""}`} ligne={ligne} base={base} onDone={reload} canWrite={can("compta:write")} />;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && data.mouvementsNonRapproches.length > 0 && (
        <Card title="Écritures comptables non rapprochées" subtitle="Chèques émis non encaissés, remises en cours… à justifier dans l'état de rapprochement" padded={false}>
          <table>
            <thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {data.mouvementsNonRapproches.map((m) => (
                <tr key={m.id}><td><DateFr iso={m.date} /></td><td className="mono">{m.piece_ref}</td><td>{m.libelle} {m.statut === "brouillard" && <Badge tone="warn">Brouillard</Badge>}</td><td><Money cents={m.montant} signed /></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data && data.regles.length > 0 && (
        <Card title="Règles d'imputation mémorisées" subtitle="Appliquées automatiquement aux prochains relevés">
          <div className="row">{data.regles.map((r) => <Badge key={r.motif}>« {r.motif} » → {r.compte}{r.compteAux ? ` / ${r.compteAux}` : ""}</Badge>)}</div>
        </Card>
      )}
      <Alert tone="info">Formats acceptés : CSV exporté depuis la banque en ligne (colonnes date, libellé et montant, ou débit et crédit) et OFX. Les opérations déjà importées sont reconnues et ignorées.</Alert>
    </div>
  );
}

function LigneRow({ ligne: l, base, onDone, canWrite }: { ligne: LigneBancaire; base: string; onDone: () => void; canWrite: boolean }) {
  const toast = useToast();
  const [compte, setCompte] = useState(l.suggestion?.compte ?? "");
  const [aux, setAux] = useState(l.suggestion?.compteAux ?? "");
  const [memoriser, setMemoriser] = useState(!l.suggestion);
  const { pending, error, run } = useAction();
  const collectif = compte ? isCollectifTiers(compte) : null;

  if (l.statut !== "a_traiter") {
    return (
      <tr style={{ opacity: 0.7 }}>
        <td><DateFr iso={l.date} /></td><td>{l.libelle}</td><td><Money cents={l.montant} signed /></td>
        <td>{l.statut === "rapprochee" ? <Badge tone="ok">Rapprochée</Badge> : <Badge>Ignorée</Badge>}</td>
        <td className="actions">{canWrite && <button className="btn ghost sm" onClick={() => run(async () => { await api.post(`${base}/lignes/${l.id}/statut`, { statut: "a_traiter" }); onDone(); })}>Rétablir</button>}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td><DateFr iso={l.date} /></td>
      <td>{l.libelle}{error && <div className="danger-text subtle">{error.detailMessages[0] ?? error.message}</div>}</td>
      <td><Money cents={l.montant} signed /></td>
      <td>
        {canWrite ? (
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input list="pcg-banque" value={compte} onChange={(e) => setCompte(e.target.value.toUpperCase())} placeholder="Compte" style={{ width: 100 }} aria-label="Compte d'imputation" />
            {collectif && <input list="tiers-banque" value={aux} onChange={(e) => setAux(e.target.value.toUpperCase())} placeholder="Tiers" style={{ width: 110 }} aria-label="Compte auxiliaire" />}
            {l.ia ? <span title={l.ia.justification}><Badge tone={l.ia.confiance >= 0.8 ? "info" : "warn"}>IA {Math.round(l.ia.confiance * 100)} %</Badge></span> : l.suggestion && <Badge tone="info">suggéré</Badge>}
            <label className="check" title="Mémoriser pour les prochains relevés" style={{ fontSize: 12 }}><input type="checkbox" checked={memoriser} onChange={(e) => setMemoriser(e.target.checked)} /> règle</label>
          </div>
        ) : <span className="subtle">{l.suggestion?.compte ?? "—"}</span>}
      </td>
      <td className="actions">
        {canWrite && (
          <>
            <button className="btn primary sm" disabled={pending || !compte} onClick={() => run(async () => {
              await api.post(`${base}/lignes/${l.id}/affecter`, { compte, compteAux: aux || null, memoriser });
              toast("Écriture de banque créée en brouillard");
              onDone();
            })}>Comptabiliser</button>
            <button className="btn ghost sm" onClick={() => run(async () => { await api.post(`${base}/lignes/${l.id}/statut`, { statut: "ignoree" }); onDone(); })}>Ignorer</button>
          </>
        )}
      </td>
    </tr>
  );
}
