import { type ControlePiece, type Ecriture as EcritureCore, type ExtractionPiece, LIBELLES_TYPES_PIECE, PCG_ACCOUNTS, defaultLabel, formatTaux, toCents } from "@compta/core";
import { type DragEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, DateFr, Empty, ErrorBox, Field, Loading, Money } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import type { Tiers } from "../../lib/types";
import { useDossier } from "./DossierLayout";

interface Analyse {
  controles: ControlePiece[];
  tiers: { existant: { nom: string; compteAux: string } | null; methode: string | null; compteAux: string; type: string; nom: string | null };
  compte: { numero: string; origine: "habitude" | "ia" | "facturx" | "defaut"; justification: string | null };
  ecriture: EcritureCore | null;
}
interface Piece {
  id: number;
  nomFichier: string;
  mime: string;
  taille: number;
  statut: "a_traiter" | "a_valider" | "comptabilisee" | "rejetee" | "erreur";
  source: "ia" | "facturx" | null;
  erreur: string | null;
  ecritureId: number | null;
  iaModele: string | null;
  createdAt: string;
  extraction: ExtractionPiece | null;
  typeLibelle: string | null;
  analyse: Analyse | null;
}

const STATUTS: Record<Piece["statut"], { label: string; tone?: "ok" | "warn" | "danger" | "info" }> = {
  a_traiter: { label: "À saisir", tone: "warn" },
  a_valider: { label: "À valider", tone: "info" },
  comptabilisee: { label: "Comptabilisée", tone: "ok" },
  rejetee: { label: "Rejetée" },
  erreur: { label: "Erreur", tone: "danger" },
};

const ORIGINE_COMPTE = { habitude: "habitude du dossier", ia: "proposé par l'IA", facturx: "facture électronique", defaut: "par défaut" };

const MIME_PAR_EXTENSION: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", xml: "application/xml" };

function lireBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function PiecesPage() {
  const { dossier, base } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ ia: { active: boolean; autorisee: boolean; modele: string | null }; pieces: Piece[] }>(`/api/dossiers/${dossier.id}/pieces`);
  const [selection, setSelection] = useState<number | null>(null);
  const [filtre, setFiltre] = useState<"a_faire" | "tout">("a_faire");
  const [envoi, setEnvoi] = useState<{ total: number; fait: number; courant: string } | null>(null);
  const [survol, setSurvol] = useState(false);
  const [erreurs, setErreurs] = useState<string[]>([]);

  const pieces = (data?.pieces ?? []).filter((p) => filtre === "tout" || ["a_traiter", "a_valider", "erreur"].includes(p.statut));
  const courante = data?.pieces.find((p) => p.id === selection) ?? null;
  useEffect(() => {
    if (!selection && pieces[0]) setSelection(pieces[0].id);
  }, [pieces, selection]);

  const deposer = async (files: FileList | File[]) => {
    const liste = [...files];
    setErreurs([]);
    let derniere: number | null = null;
    for (let i = 0; i < liste.length; i++) {
      const f = liste[i]!;
      setEnvoi({ total: liste.length, fait: i, courant: f.name });
      const mime = f.type || MIME_PAR_EXTENSION[f.name.split(".").pop()?.toLowerCase() ?? ""] || "";
      try {
        if (f.size > 10 * 1024 * 1024) throw new Error("fichier supérieur à 10 Mo");
        const r = await api.post<Piece>(`/api/dossiers/${dossier.id}/pieces`, { nomFichier: f.name, mime: mime === "text/xml" ? "application/xml" : mime, contenuBase64: await lireBase64(f) });
        derniere = r.id;
      } catch (e) {
        setErreurs((x) => [...x, `${f.name} : ${(e as Error).message}`]);
      }
    }
    setEnvoi(null);
    reload();
    if (derniere) setSelection(derniere);
    toast(`${liste.length} pièce(s) traitée(s)`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setSurvol(false);
    if (e.dataTransfer.files.length) void deposer(e.dataTransfer.files);
  };

  const aFaire = (data?.pieces ?? []).filter((p) => p.statut === "a_valider").length;

  return (
    <div className="stack">
      {data && !data.ia.active && (
        <Alert tone="info" title="Lecture automatique par IA non configurée">
          Les factures électroniques (XML Factur-X) sont lues automatiquement. Pour lire aussi les PDF et les photos, l'administrateur doit renseigner une clé d'API Anthropic sur le serveur (variable ANTHROPIC_API_KEY).
        </Alert>
      )}
      {data?.ia.active && !data.ia.autorisee && (
        <Alert tone="warn" title="Assistance IA non autorisée pour ce dossier">
          Les pièces sont conservées mais ne sont pas transmises à l'IA. L'autorisation se donne dans l'onglet <Link to={`${base}/mission`}>Mission</Link>, après accord du client.
        </Alert>
      )}

      {can("compta:write") && (
        <label
          className={`dropzone ${survol ? "survol" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
          onDragLeave={() => setSurvol(false)}
          onDrop={onDrop}
        >
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.xml" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) void deposer(e.target.files); e.target.value = ""; }} />
          {envoi ? (
            <div>
              <strong>Lecture en cours… {envoi.fait + 1} / {envoi.total}</strong>
              <div className="subtle">{envoi.courant}</div>
              <div className="progress"><div style={{ width: `${((envoi.fait + 0.5) / envoi.total) * 100}%` }} /></div>
            </div>
          ) : (
            <div>
              <Icon.download />
              <strong>Déposez vos factures, tickets et notes de frais</strong>
              <div className="subtle">PDF, photos (JPG, PNG) ou factures électroniques XML — plusieurs fichiers à la fois, 10 Mo maximum chacun</div>
            </div>
          )}
        </label>
      )}
      {erreurs.length > 0 && <Alert tone="danger" title="Certains fichiers n'ont pas pu être déposés"><ul>{erreurs.map((e, i) => <li key={i}>{e}</li>)}</ul></Alert>}
      <ErrorBox error={error} />

      <div className="pieces-layout">
        <div className="card">
          <div className="card-header">
            <h3>{aFaire} pièce(s) à valider</h3>
            <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)} style={{ width: "auto" }} aria-label="Filtre">
              <option value="a_faire">À traiter</option>
              <option value="tout">Toutes</option>
            </select>
          </div>
          {loading && !data ? <Loading /> : pieces.length === 0 ? <Empty title="Rien à traiter">Les pièces déposées apparaîtront ici.</Empty> : (
            <ul className="piece-list">
              {pieces.map((p) => (
                <li key={p.id} className={p.id === selection ? "active" : ""} onClick={() => setSelection(p.id)}>
                  <div className="row between" style={{ flexWrap: "nowrap" }}>
                    <strong className="ellipsis">{p.extraction?.emetteur.nom && p.extraction.typeDocument.endsWith("achat") ? p.extraction.emetteur.nom : p.extraction?.destinataire.nom && p.extraction.typeDocument.endsWith("vente") ? p.extraction.destinataire.nom : p.nomFichier}</strong>
                    {p.extraction ? <Money cents={p.extraction.totalTTC} /> : null}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <Badge tone={STATUTS[p.statut].tone}>{STATUTS[p.statut].label}</Badge>
                    {p.source === "ia" && <Badge>IA</Badge>}
                    {p.source === "facturx" && <Badge tone="ok">Factur-X</Badge>}
                    {p.analyse?.controles.some((c) => c.niveau === "bloquant") && <Badge tone="danger">Anomalie</Badge>}
                    <span className="subtle">{p.extraction?.dateFacture ? <DateFr iso={p.extraction.dateFacture} /> : p.nomFichier}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{courante ? <DetailPiece key={`${courante.id}-${courante.statut}-${courante.extraction?.totalTTC}`} piece={courante} onChange={reload} /> : <div className="card"><Empty title="Sélectionnez une pièce" /></div>}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Form {
  typeDocument: ExtractionPiece["typeDocument"];
  tiersNom: string;
  tiersSiren: string;
  tiersTva: string;
  numero: string;
  dateFacture: string;
  dateEcheance: string;
  totalHT: string;
  totalTVA: string;
  totalTTC: string;
  taux: string;
}

const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");

function formDepuis(e: ExtractionPiece | null): Form {
  const vente = e?.typeDocument.endsWith("vente");
  const t = vente ? e?.destinataire : e?.emetteur;
  return {
    typeDocument: e?.typeDocument ?? "facture_achat",
    tiersNom: t?.nom ?? "",
    tiersSiren: t?.siren ?? "",
    tiersTva: t?.tvaIntra ?? "",
    numero: e?.numero ?? "",
    dateFacture: e?.dateFacture ?? "",
    dateEcheance: e?.dateEcheance ?? "",
    totalHT: e ? eur(e.totalHT) : "",
    totalTVA: e ? eur(e.totalTVA) : "",
    totalTTC: e ? eur(e.totalTTC) : "",
    taux: String(e?.ventilationTva[0]?.tauxBp ?? 2000),
  };
}

function DetailPiece({ piece: p, onChange }: { piece: Piece; onChange: () => void }) {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const tiers = useApi<Tiers[]>(`/api/dossiers/${dossier.id}/tiers`);
  const [f, setF] = useState<Form>(formDepuis(p.extraction));
  const [compte, setCompte] = useState(p.analyse?.compte.numero ?? "606");
  const [compteAux, setCompteAux] = useState(p.analyse?.tiers.compteAux ?? "");
  const [modifie, setModifie] = useState(false);
  const action = useAction();
  const url = `/api/dossiers/${dossier.id}/pieces/${p.id}`;
  const ecriture = !modifie ? p.analyse?.ecriture : null;
  const lecture = p.statut === "comptabilisee" || !can("compta:write");
  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setModifie(true); };

  /** Reconstitue l'extraction à partir du formulaire (les lignes détaillées sont conservées). */
  const extractionCorrigee = (): ExtractionPiece => {
    const e = p.extraction;
    const vente = f.typeDocument.endsWith("vente");
    const partie = { nom: f.tiersNom || null, siren: f.tiersSiren || null, tvaIntra: f.tiersTva || null, adresse: (vente ? e?.destinataire : e?.emetteur)?.adresse ?? null, iban: (vente ? e?.destinataire : e?.emetteur)?.iban ?? null };
    const vide = { nom: null, siren: null, tvaIntra: null, adresse: null, iban: null };
    const ht = toCents(f.totalHT || "0");
    const tva = toCents(f.totalTVA || "0");
    const ventilationInchangee = e && e.totalHT === ht && e.totalTVA === tva && e.ventilationTva.length > 0;
    return {
      typeDocument: f.typeDocument,
      emetteur: vente ? (e?.emetteur ?? { ...vide, nom: dossier.raisonSociale, siren: dossier.siren }) : partie,
      destinataire: vente ? partie : (e?.destinataire ?? { ...vide, nom: dossier.raisonSociale, siren: dossier.siren }),
      numero: f.numero || null,
      dateFacture: f.dateFacture || null,
      dateEcheance: f.dateEcheance || null,
      devise: e?.devise ?? "EUR",
      lignes: e?.lignes ?? [],
      ventilationTva: ventilationInchangee ? e.ventilationTva : [{ tauxBp: Number(f.taux), baseHT: ht, tva }],
      totalHT: ht,
      totalTVA: tva,
      totalTTC: toCents(f.totalTTC || "0"),
      compteSuggere: compte,
      justificationCompte: e?.justificationCompte ?? null,
      confiance: e?.confiance ?? 1,
      remarques: e?.remarques ?? [],
      source: e?.source ?? "ia",
    };
  };

  const enregistrer = () => action.run(async () => { await api.put(url, extractionCorrigee()); setModifie(false); toast("Corrections enregistrées"); onChange(); });
  const comptabiliser = () => action.run(async () => {
    if (modifie) await api.put(url, extractionCorrigee());
    await api.post(`${url}/comptabiliser`, { compte, compteAux });
    toast("Pièce comptabilisée en brouillard — à valider par l'expert-comptable");
    onChange();
  });

  const controles = p.analyse?.controles ?? [];
  const bloquant = controles.some((c) => c.niveau === "bloquant");
  const e = p.extraction;

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <Card title={p.nomFichier} subtitle={`${(p.taille / 1024).toFixed(0)} Ko · déposée le ${new Date(p.createdAt).toLocaleDateString("fr-FR")}`} padded={false}
        actions={<a className="btn sm" href={`${url}/fichier`} target="_blank" rel="noreferrer">Ouvrir</a>}>
        {p.mime.startsWith("image/") ? (
          <img src={`${url}/fichier`} alt={`Pièce ${p.nomFichier}`} style={{ width: "100%", display: "block" }} />
        ) : p.mime === "application/pdf" ? (
          <iframe src={`${url}/fichier`} title={p.nomFichier} style={{ width: "100%", height: 640, border: 0 }} />
        ) : (
          <div className="card-body subtle">Facture électronique structurée (XML) : les données ont été lues exactement, sans interprétation.</div>
        )}
      </Card>

      <div className="stack">
        {p.statut === "erreur" && <Alert tone="danger" title="Lecture impossible">{p.erreur}</Alert>}
        {p.statut === "comptabilisee" && <Alert tone="ok" title="Pièce comptabilisée">L'écriture a été créée en brouillard ; elle sera définitive après validation par l'expert-comptable. Le justificatif est archivé (chiffré) pour 10 ans.</Alert>}
        {p.statut === "a_traiter" && <Alert tone="info" title="Saisie manuelle">Cette pièce n'a pas été lue automatiquement : complétez les champs ci-dessous à partir du document.</Alert>}
        {e && (
          <div className="row">
            {e.source === "ia" && <Badge tone={e.confiance >= 0.85 ? "ok" : e.confiance >= 0.7 ? "warn" : "danger"}>Lecture IA · confiance {Math.round(e.confiance * 100)} %</Badge>}
            {e.source === "facturx" && <Badge tone="ok">Facture électronique : données exactes</Badge>}
            {p.typeLibelle && <Badge>{p.typeLibelle}</Badge>}
          </div>
        )}
        {controles.length > 0 && p.statut !== "comptabilisee" && (
          <Alert tone={bloquant ? "danger" : "warn"} title={bloquant ? "À corriger avant comptabilisation" : "Points d'attention"}>
            <ul>{controles.map((c, i) => <li key={i}>{c.niveau === "info" ? "ℹ︎ " : ""}{c.message}</li>)}</ul>
          </Alert>
        )}
        {e?.remarques.length && e.source === "ia" ? <Alert tone="info" title="Remarques de l'IA"><ul>{e.remarques.map((r, i) => <li key={i}>{r}</li>)}</ul></Alert> : null}

        <Card title="Données de la pièce">
          <fieldset disabled={lecture} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              <Field label="Type">
                <select value={f.typeDocument} onChange={set("typeDocument")}>
                  {Object.entries(LIBELLES_TYPES_PIECE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label={f.typeDocument.endsWith("vente") ? "Client" : "Fournisseur"}><input value={f.tiersNom} onChange={set("tiersNom")} /></Field>
              <Field label="SIREN"><input value={f.tiersSiren} onChange={set("tiersSiren")} /></Field>
              <Field label="N° TVA intracom."><input value={f.tiersTva} onChange={set("tiersTva")} /></Field>
              <Field label="N° de facture"><input value={f.numero} onChange={set("numero")} /></Field>
              <Field label="Date"><input type="date" value={f.dateFacture} onChange={set("dateFacture")} /></Field>
              <Field label="Échéance"><input type="date" value={f.dateEcheance} onChange={set("dateEcheance")} /></Field>
              <Field label="Taux principal">
                <select value={f.taux} onChange={set("taux")}>{[2000, 1000, 550, 210, 0].map((t) => <option key={t} value={t}>{formatTaux(t)}</option>)}</select>
              </Field>
              <Field label="Total HT (€)"><input className="num" inputMode="decimal" value={f.totalHT} onChange={set("totalHT")} /></Field>
              <Field label="TVA (€)"><input className="num" inputMode="decimal" value={f.totalTVA} onChange={set("totalTVA")} /></Field>
              <Field label="Total TTC (€)"><input className="num" inputMode="decimal" value={f.totalTTC} onChange={set("totalTTC")} /></Field>
            </div>
          </fieldset>
          {e && e.ventilationTva.length > 1 && !modifie && (
            <p className="subtle" style={{ marginTop: 10 }}>Ventilation : {e.ventilationTva.map((v) => `${formatTaux(v.tauxBp)} sur ${eur(v.baseHT)} € = ${eur(v.tva)} €`).join(" ; ")}</p>
          )}
        </Card>

        {p.statut !== "comptabilisee" && p.statut !== "rejetee" && (
          <Card title="Imputation">
            <datalist id="pcg-pieces">{PCG_ACCOUNTS.filter((a) => /^[267]/.test(a.numero)).map((a) => <option key={a.numero} value={a.numero}>{a.libelle}</option>)}</datalist>
            <datalist id="tiers-pieces">{(tiers.data ?? []).map((t) => <option key={t.id} value={t.compteAux}>{t.nom}</option>)}</datalist>
            <fieldset disabled={lecture} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="form-grid">
                <Field label="Compte de charge / produit" hint={p.analyse ? `${defaultLabel(compte)} · ${ORIGINE_COMPTE[p.analyse.compte.origine]}` : defaultLabel(compte)}>
                  <input list="pcg-pieces" value={compte} onChange={(e) => setCompte(e.target.value.toUpperCase())} />
                </Field>
                <Field label="Compte du tiers" hint={p.analyse?.tiers.existant ? `${p.analyse.tiers.existant.nom} (reconnu par ${p.analyse.tiers.methode})` : "Nouveau tiers : il sera créé"}>
                  <input list="tiers-pieces" value={compteAux} onChange={(e) => setCompteAux(e.target.value.toUpperCase())} />
                </Field>
              </div>
            </fieldset>
            {p.analyse?.compte.justification && <p className="subtle" style={{ marginTop: 8 }}>{p.analyse.compte.justification}</p>}
            {ecriture && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Compte</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th></tr></thead>
                <tbody>
                  {ecriture.lignes.map((l, i) => (
                    <tr key={i}><td className="mono">{l.compte === p.analyse?.compte.numero ? compte : l.compte}{l.compteAux ? ` / ${compteAux}` : ""}</td><td>{l.libelle}</td><td><Money cents={l.debit} hideZero /></td><td><Money cents={l.credit} hideZero /></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <ErrorBox error={action.error} />
            {!lecture && (
              <div className="form-actions">
                <button className="btn ghost" onClick={() => action.run(async () => { await api.post(`${url}/rejeter`); onChange(); })}>Rejeter</button>
                {p.source === "ia" || p.statut === "erreur" ? <button className="btn" disabled={action.pending} onClick={() => action.run(async () => { await api.post(`${url}/relire`); onChange(); })}>Relire</button> : null}
                {modifie && <button className="btn" disabled={action.pending} onClick={enregistrer}>Enregistrer et recontrôler</button>}
                <button className="btn primary" disabled={action.pending || (bloquant && !modifie) || !compte || !compteAux} onClick={comptabiliser}><Icon.check /> Comptabiliser</button>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
