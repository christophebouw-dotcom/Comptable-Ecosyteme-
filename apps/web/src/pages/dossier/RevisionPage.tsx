import { type Anomalie, type CalculIs, type Cycle, type Ratio, type Sig, toCents } from "@compta/core";
import { useState } from "react";
import { Alert, Badge, Card, ErrorBox, Field, Loading, Money, Stat } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

interface Point { cycle: Cycle; code: string; libelle: string; statut: "a_faire" | "fait" | "na" | "anomalie"; commentaire: string | null }
interface RevisionData {
  anomalies: Anomalie[];
  sig: Sig;
  caf: { caf: number; dotations: number; reprises: number; vncCedees: number; produitsCessions: number; quotePartSubventions: number; resultatNet: number };
  ratios: Ratio[];
  cycles: Record<Cycle, string>;
  programme: Point[];
}

const NIVEAU: Record<Anomalie["niveau"], { tone: "danger" | "warn" | "info"; label: string }> = {
  bloquant: { tone: "danger", label: "Bloquant" },
  avertissement: { tone: "warn", label: "À vérifier" },
  info: { tone: "info", label: "Info" },
};

export function RevisionPage() {
  const { dossier, exercice } = useDossier();
  const { data, error, loading, reload } = useApi<RevisionData>(`/api/dossiers/${dossier.id}/revision${qs({ exerciceId: exercice.id })}`);
  const [onglet, setOnglet] = useState<"controles" | "sig" | "programme" | "is">("controles");
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const fait = data.programme.filter((p) => p.statut === "fait" || p.statut === "na").length;
  const bloquants = data.anomalies.filter((a) => a.niveau === "bloquant").length;

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Anomalies bloquantes" value={bloquants} tone={bloquants ? "danger" : "ok"} hint={`${data.anomalies.length} point(s) relevé(s) au total`} />
        <Stat label="Programme de travail" value={`${fait} / ${data.programme.length}`} hint="Diligences réalisées" tone={fait === data.programme.length ? "ok" : undefined} />
        <Stat label="Excédent brut d'exploitation" value={<Money cents={data.sig.excedentBrutExploitation} signed />} />
        <Stat label="Capacité d'autofinancement" value={<Money cents={data.caf.caf} signed />} />
      </div>
      <div className="tabs" style={{ marginBottom: 0 }}>
        {([["controles", "Contrôles automatiques"], ["sig", "SIG, CAF et ratios"], ["programme", "Programme de travail"], ["is", "Impôt sur les sociétés"]] as const).map(([k, l]) => (
          <button key={k} className={`tab ${onglet === k ? "active" : ""}`} onClick={() => setOnglet(k)}>{l}</button>
        ))}
      </div>
      {onglet === "controles" && <Controles anomalies={data.anomalies} cycles={data.cycles} />}
      {onglet === "sig" && <SigView data={data} />}
      {onglet === "programme" && <Programme data={data} onChange={reload} />}
      {onglet === "is" && <IsView />}
    </div>
  );
}

function Controles({ anomalies, cycles }: { anomalies: Anomalie[]; cycles: Record<Cycle, string> }) {
  if (anomalies.length === 0) return <Alert tone="ok" title="Aucune anomalie détectée">Les contrôles automatiques de cohérence n'ont relevé aucun point sur les écritures validées.</Alert>;
  return (
    <div className="card">
      <table>
        <thead><tr><th>Niveau</th><th>Cycle</th><th>Constat</th><th className="num">Montant</th><th>Diligence suggérée</th></tr></thead>
        <tbody>
          {anomalies.map((a, i) => (
            <tr key={i}>
              <td><Badge tone={NIVEAU[a.niveau].tone}>{NIVEAU[a.niveau].label}</Badge></td>
              <td className="subtle">{cycles[a.cycle]}</td>
              <td>{a.message}{a.compte && <div className="subtle mono">{a.compte}{a.compteAux ? ` / ${a.compteAux}` : ""}</div>}</td>
              <td>{a.montant !== undefined ? <Money cents={Math.abs(a.montant)} /> : ""}</td>
              <td className="subtle" style={{ maxWidth: 420 }}>{a.suggestion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SigView({ data }: { data: RevisionData }) {
  const s = data.sig;
  const row = (label: string, v: number, kind: "" | "sub" | "total" = "") => (
    <tr className={kind === "sub" ? "subtotal" : kind === "total" ? "total" : ""}><td>{label}</td><td><Money cents={v} signed /></td></tr>
  );
  const fmtRatio = (r: Ratio) => r.valeur === null ? "—" : r.unite === "€" ? `${r.valeur.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €` : r.unite === "%" ? `${r.valeur.toLocaleString("fr-FR")} %` : r.unite === "jours" ? `${r.valeur} j` : `${r.valeur.toLocaleString("fr-FR")}`;
  return (
    <div className="grid grid-2">
      <Card title="Soldes intermédiaires de gestion" subtitle="PCG, système développé" padded={false}>
        <table className="statement">
          <tbody>
            {row("Ventes de marchandises", s.ventesMarchandises)}
            {row("Coût d'achat des marchandises vendues", -s.coutAchatMarchandisesVendues)}
            {row("Marge commerciale", s.margeCommerciale, "sub")}
            {row("Production vendue", s.productionVendue)}
            {row("Production stockée et immobilisée", s.productionStockeeImmobilisee)}
            {row("Production de l'exercice", s.productionExercice, "sub")}
            {row("Consommations en provenance de tiers", -s.consommationsTiers)}
            {row("Valeur ajoutée", s.valeurAjoutee, "sub")}
            {row("Subventions d'exploitation", s.subventionsExploitation)}
            {row("Impôts et taxes", -s.impotsTaxes)}
            {row("Charges de personnel", -s.chargesPersonnel)}
            {row("Excédent brut d'exploitation (EBE)", s.excedentBrutExploitation, "sub")}
            {row("Reprises, transferts et autres produits", s.reprisesTransferts + s.autresProduits)}
            {row("Dotations et autres charges", -(s.dotationsExploitation + s.autresCharges))}
            {row("Résultat d'exploitation", s.resultatExploitation, "sub")}
            {row("Résultat financier", s.produitsFinanciers - s.chargesFinancieres)}
            {row("Résultat courant avant impôts", s.resultatCourantAvantImpots, "sub")}
            {row("Résultat exceptionnel", s.resultatExceptionnel)}
            {row("Participation et impôts sur les bénéfices", -(s.participation + s.impotsBenefices))}
            {row("Résultat net", s.resultatNet, "total")}
          </tbody>
        </table>
      </Card>
      <div className="stack">
        <Card title="Capacité d'autofinancement" subtitle="Méthode additive" padded={false}>
          <table className="statement">
            <tbody>
              {row("Résultat net", data.caf.resultatNet)}
              {row("+ Dotations aux amortissements et provisions", data.caf.dotations)}
              {row("- Reprises", -data.caf.reprises)}
              {row("+ Valeur comptable des actifs cédés", data.caf.vncCedees)}
              {row("- Produits de cession", -data.caf.produitsCessions)}
              {row("- Quote-part des subventions virée au résultat", -data.caf.quotePartSubventions)}
              {row("Capacité d'autofinancement", data.caf.caf, "total")}
            </tbody>
          </table>
        </Card>
        <Card title="Ratios de gestion" padded={false}>
          <table>
            <tbody>
              {data.ratios.map((r) => (
                <tr key={r.code}><td>{r.libelle}<div className="subtle">{r.commentaire}</div></td><td className="num"><strong>{fmtRatio(r)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

const STATUTS_POINT = { a_faire: "À faire", fait: "Fait", na: "Non applicable", anomalie: "Anomalie" };

function Programme({ data, onChange }: { data: RevisionData; onChange: () => void }) {
  const { dossier, exercice } = useDossier();
  const { can } = useAuth();
  const action = useAction();
  const cycles = [...new Set(data.programme.map((p) => p.cycle))];
  const maj = (p: Point, statut: Point["statut"], commentaire = p.commentaire) =>
    action.run(async () => { await api.put(`/api/dossiers/${dossier.id}/revision/points/${p.code}`, { exerciceId: exercice.id, statut, commentaire }); onChange(); });
  return (
    <div className="stack">
      <ErrorBox error={action.error} />
      {cycles.map((c) => (
        <Card key={c} title={data.cycles[c]} padded={false}>
          <table>
            <tbody>
              {data.programme.filter((p) => p.cycle === c).map((p) => (
                <tr key={p.code}>
                  <td className="mono" style={{ width: 50 }}>{p.code}</td>
                  <td>{p.libelle}{p.commentaire && <div className="subtle">{p.commentaire}</div>}</td>
                  <td style={{ width: 170 }}>
                    <select value={p.statut} disabled={!can("compta:write") || exercice.statut === "cloture"} onChange={(e) => {
                      const st = e.target.value as Point["statut"];
                      const com = st === "anomalie" || st === "na" ? prompt("Commentaire (justification)", p.commentaire ?? "") : p.commentaire;
                      void maj(p, st, com);
                    }} aria-label={`Statut ${p.code}`}>
                      {Object.entries(STATUTS_POINT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td style={{ width: 90 }}><Badge tone={p.statut === "fait" ? "ok" : p.statut === "anomalie" ? "danger" : p.statut === "na" ? undefined : "warn"}>{STATUTS_POINT[p.statut]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function IsView() {
  const { dossier, exercice } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ reintegrations: "", deductions: "", deficits: "", eligible: true });
  const [res, setRes] = useState<(CalculIs & { isDejaComptabilise: number }) | null>(null);
  const action = useAction();
  if (dossier.impot !== "IS") return <Alert tone="info">Ce dossier relève de l'impôt sur le revenu : le résultat est imposé au nom de l'exploitant ou des associés.</Alert>;
  const body = () => ({
    exerciceId: exercice.id,
    reintegrations: f.reintegrations ? toCents(f.reintegrations) : 0,
    deductions: f.deductions ? toCents(f.deductions) : 0,
    deficitsAnterieurs: f.deficits ? toCents(f.deficits) : 0,
    eligibleTauxReduit: f.eligible,
  });
  return (
    <div className="grid grid-2">
      <Card title="Passage du résultat comptable au résultat fiscal" subtitle="Tableau 2058-A simplifié">
        <div className="stack">
          <ErrorBox error={action.error} />
          <div className="form-grid">
            <Field label="Réintégrations (€)" hint="Amendes, part non déductible des véhicules (TVS), IS…"><input className="num" inputMode="decimal" value={f.reintegrations} onChange={(e) => setF({ ...f, reintegrations: e.target.value })} /></Field>
            <Field label="Déductions (€)" hint="Produits exonérés, régime mère-fille…"><input className="num" inputMode="decimal" value={f.deductions} onChange={(e) => setF({ ...f, deductions: e.target.value })} /></Field>
            <Field label="Déficits reportables (€)"><input className="num" inputMode="decimal" value={f.deficits} onChange={(e) => setF({ ...f, deficits: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.eligible} onChange={(e) => setF({ ...f, eligible: e.target.checked })} /> PME éligible au taux réduit de 15 % (CA &lt; 10 M€, capital libéré détenu à 75 % par des personnes physiques)</label>
          <div className="row">
            <button className="btn primary" disabled={action.pending} onClick={() => action.run(async () => setRes(await api.post("/api/dossiers/" + dossier.id + "/is/calcul", body())))}>Calculer</button>
            {res && can("compta:write") && exercice.statut === "ouvert" && !res.isDejaComptabilise && res.impotTotal > 0 && (
              <button className="btn" onClick={() => action.run(async () => { await api.post(`/api/dossiers/${dossier.id}/is/ecriture`, body()); toast("Écriture d'IS créée en brouillard (695 / 444)"); })}>Comptabiliser l'IS</button>
            )}
          </div>
        </div>
      </Card>
      {res && (
        <Card title="Impôt sur les sociétés" padded={false}>
          <table className="statement">
            <tbody>
              <tr><td>Résultat comptable avant IS</td><td><Money cents={res.resultatComptable} signed /></td></tr>
              <tr><td>+ Réintégrations</td><td><Money cents={res.reintegrations} /></td></tr>
              <tr><td>- Déductions</td><td><Money cents={-res.deductions} signed /></td></tr>
              <tr><td>- Déficits imputés</td><td><Money cents={-res.deficitsReportes} signed /></td></tr>
              <tr className="subtotal"><td>Résultat fiscal</td><td><Money cents={res.resultatFiscal} signed /></td></tr>
              <tr><td>IS à 15 % sur <Money cents={res.baseTauxReduit} /></td><td><Money cents={res.impotTauxReduit} /></td></tr>
              <tr><td>IS à 25 % sur <Money cents={res.baseTauxNormal} /></td><td><Money cents={res.impotTauxNormal} /></td></tr>
              <tr className="subtotal"><td>Impôt dû</td><td><Money cents={res.impotTotal} /></td></tr>
              <tr><td>- Acomptes versés (444)</td><td><Money cents={-res.acomptesVerses} signed /></td></tr>
              <tr className="total"><td>{res.solde >= 0 ? "Solde à payer (2572)" : "Excédent à restituer"}</td><td><Money cents={Math.abs(res.solde)} /></td></tr>
            </tbody>
          </table>
          <div className="card-body subtle">{res.detail.map((d, i) => <p key={i}>{d}</p>)}{res.isDejaComptabilise ? <p>Un IS de <Money cents={res.isDejaComptabilise} /> est déjà comptabilisé.</p> : null}</div>
        </Card>
      )}
    </div>
  );
}
