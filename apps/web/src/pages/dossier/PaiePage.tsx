import { type Bulletin, type ElementsVariables, formatEUR, toCents } from "@compta/core";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { type BulletinDetail, BulletinView } from "../../components/Bulletin";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, Empty, ErrorBox, Field, Loading, Modal, Money, Stat } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

interface Salarie {
  id: number;
  matricule: string;
  nom: string;
  prenom: string;
  nirMasque: string | null;
  email: string | null;
  ibanMasque: string | null;
  emploi: string;
  statut: "cadre" | "non_cadre";
  dateEntree: string;
  dateSortie: string | null;
  anonymise: boolean;
  salaireBase: number;
  heuresMensuelles: number;
  tauxPas: number | null;
  mutuelleSalarie: number;
  mutuelleEmployeur: number;
}
interface BulletinResume {
  id: number;
  salarieId: number;
  statut: "brouillon" | "valide";
  brut: number;
  netAPayer: number;
  coutEmployeur: number;
  ecritureId: number | null;
  variables: ElementsVariables;
}
interface Parametres { effectif: number; tauxAtMp: number; tauxVersementMobilite: number; convention: string | null; configure: boolean }
interface PaieData {
  periode: string;
  parametres: Parametres;
  bareme: { annee: number; smicHoraire: number; pmss: number };
  salaries: Salarie[];
  bulletins: BulletinResume[];
  recapitulatif: { organisme: string; libelle: string; salarial: number; patronal: number; total: number }[];
  totaux: { brut: number; netAPayer: number; pas: number; coutEmployeur: number };
}

const euros = (c: number) => (c ? (c / 100).toFixed(2).replace(".", ",") : "");
const cents = (s: string) => {
  try {
    return s.trim() ? toCents(s) : 0;
  } catch {
    return Number.NaN;
  }
};

export function PaiePage() {
  const { dossier, exercice, base } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const moisCourant = new Date().toISOString().slice(0, 7);
  const [periode, setPeriode] = useState(moisCourant >= exercice.debut.slice(0, 7) && moisCourant <= exercice.fin.slice(0, 7) ? moisCourant : exercice.debut.slice(0, 7));
  const { data, error, loading, reload } = useApi<PaieData>(`/api/dossiers/${dossier.id}/paie${qs({ periode })}`);
  const [salarie, setSalarie] = useState<Salarie | "nouveau" | null>(null);
  const [bulletinPour, setBulletinPour] = useState<Salarie | null>(null);
  const [parametres, setParametres] = useState(false);
  const action = useAction();
  const gerer = can("paie:manage");
  const actifs = (data?.salaries ?? []).filter((s) => !s.anonymise && s.dateEntree.slice(0, 7) <= periode && (!s.dateSortie || s.dateSortie.slice(0, 7) >= periode));

  return (
    <div className="stack">
      <div className="row between">
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          Période
          <input type="month" value={periode} onChange={(e) => e.target.value && setPeriode(e.target.value)} style={{ width: "auto" }} />
        </label>
        {gerer && (
          <div className="row">
            <button className="btn" onClick={() => setParametres(true)}>Paramètres employeur</button>
            <button className="btn primary" onClick={() => setSalarie("nouveau")}><Icon.plus /> Nouveau salarié</button>
          </div>
        )}
      </div>
      <ErrorBox error={error ?? action.error} />
      {data && !data.parametres.configure && gerer && (
        <Alert tone="warn" title="Paramètres employeur à compléter">
          Effectif, taux accidents du travail notifié par la CARSAT et convention collective conditionnent le calcul des cotisations.{" "}
          <button className="btn sm" onClick={() => setParametres(true)}>Compléter</button>
        </Alert>
      )}
      {data && (
        <div className="grid grid-4">
          <Stat label="Masse salariale brute" value={<Money cents={data.totaux.brut} />} hint={`${data.bulletins.length} bulletin(s) pour la période`} />
          <Stat label="Net à payer" value={<Money cents={data.totaux.netAPayer} />} />
          <Stat label="Prélèvement à la source" value={<Money cents={data.totaux.pas} />} hint="À reverser via la DSN" />
          <Stat label="Coût employeur" value={<Money cents={data.totaux.coutEmployeur} />} />
        </div>
      )}

      <div className="card">
        {loading && !data ? <Loading /> : !data?.salaries.length ? (
          <Empty title="Aucun salarié" action={gerer && <button className="btn primary" onClick={() => setSalarie("nouveau")}>Ajouter un salarié</button>}>
            Saisissez les salariés du dossier : les bulletins sont calculés chaque mois (cotisations, prélèvement à la source, net social) et l'écriture de paie est générée automatiquement.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Matricule</th><th>Salarié</th><th>Emploi</th><th className="num">Salaire de base</th><th>Bulletin {periode}</th><th className="num">Net à payer</th><th /></tr></thead>
              <tbody>
                {data.salaries.map((s) => {
                  const b = data.bulletins.find((x) => x.salarieId === s.id);
                  const actif = actifs.includes(s);
                  return (
                    <tr key={s.id} style={actif ? undefined : { opacity: 0.6 }}>
                      <td className="mono">{s.matricule}</td>
                      <td>
                        {s.prenom} {s.nom}
                        <div className="subtle">{s.statut === "cadre" ? "Cadre" : "Non-cadre"}{s.nirMasque ? ` · ${s.nirMasque}` : ""}{s.dateSortie ? ` · sorti le ${s.dateSortie.split("-").reverse().join("/")}` : ""}</div>
                      </td>
                      <td>{s.emploi}</td>
                      <td><Money cents={s.salaireBase} /></td>
                      <td>
                        {b ? (b.statut === "valide" ? <Badge tone="ok">Validé</Badge> : <Badge tone="warn">Brouillon</Badge>) : actif ? <span className="subtle">À établir</span> : <span className="subtle">Hors contrat</span>}
                        {b?.ecritureId && <> <Link to={`${base}/saisie/${b.ecritureId}`} className="subtle">écriture</Link></>}
                      </td>
                      <td>{b ? <Money cents={b.netAPayer} /> : <span className="subtle">—</span>}</td>
                      <td className="actions">
                        {b && <Link className="btn ghost sm" to={`${base}/paie/bulletins/${b.id}`}>Voir</Link>}
                        {gerer && actif && b?.statut !== "valide" && <button className="btn sm" onClick={() => setBulletinPour(s)}>{b ? "Modifier" : "Préparer"}</button>}
                        {gerer && b?.statut === "brouillon" && (
                          <button className="btn primary sm" disabled={action.pending} onClick={() => action.run(async () => {
                            if (!confirm(`Valider le bulletin de ${s.prenom} ${s.nom} pour ${periode} ? Il ne pourra plus être modifié.`)) return;
                            await api.post(`/api/dossiers/${dossier.id}/paie/bulletins/${b.id}/valider`, {});
                            toast("Bulletin validé — écriture de paie créée en brouillard (journal PA)");
                            reload();
                          })}>Valider</button>
                        )}
                        {gerer && !s.anonymise && <button className="btn ghost sm" aria-label="Modifier la fiche" onClick={() => setSalarie(s)}><Icon.edit /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.recapitulatif.length > 0 && (
        <Card title="Charges sociales de la période par organisme" subtitle="Montants à déclarer et à régler (DSN)" padded={false}>
          <table>
            <thead><tr><th>Organisme</th><th className="num">Part salariale</th><th className="num">Part patronale</th><th className="num">Total</th></tr></thead>
            <tbody>
              {data.recapitulatif.map((r) => (
                <tr key={r.organisme}><td>{r.libelle}</td><td><Money cents={r.salarial} /></td><td><Money cents={r.patronal} /></td><td><strong><Money cents={r.total} /></strong></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data && (
        <Alert tone="info" title={`Barème ${data.bareme.annee} indicatif`}>
          SMIC horaire {formatEUR(data.bareme.smicHoraire)}, plafond mensuel de la sécurité sociale {formatEUR(data.bareme.pmss)}. Taux, plafonds et allègements sont paramétrés dans le moteur de paie et doivent être vérifiés à chaque évolution légale, de même que les taux conventionnels (prévoyance, mutuelle). La DSN se dépose depuis le logiciel de paie agréé ou net-entreprises.fr.
        </Alert>
      )}

      {salarie && <SalarieModal dossierId={dossier.id} salarie={salarie === "nouveau" ? null : salarie} onClose={() => setSalarie(null)} onDone={() => { setSalarie(null); reload(); toast("Fiche salarié enregistrée"); }} />}
      {bulletinPour && data && (
        <BulletinModal dossierId={dossier.id} salarie={bulletinPour} periode={periode} initial={data.bulletins.find((b) => b.salarieId === bulletinPour.id)?.variables}
          onClose={() => setBulletinPour(null)} onDone={() => { setBulletinPour(null); reload(); toast("Bulletin enregistré en brouillon"); }} />
      )}
      {parametres && data && <ParametresModal dossierId={dossier.id} initial={data.parametres} onClose={() => setParametres(false)} onDone={() => { setParametres(false); reload(); }} />}
    </div>
  );
}

function SalarieModal({ dossierId, salarie, onClose, onDone }: { dossierId: number; salarie: Salarie | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    matricule: salarie?.matricule ?? "",
    nom: salarie?.nom ?? "",
    prenom: salarie?.prenom ?? "",
    nir: "",
    email: salarie?.email ?? "",
    iban: "",
    emploi: salarie?.emploi ?? "",
    statut: salarie?.statut ?? ("non_cadre" as const),
    dateEntree: salarie?.dateEntree ?? "",
    dateSortie: salarie?.dateSortie ?? "",
    salaireBase: euros(salarie?.salaireBase ?? 0),
    heuresMensuelles: String(salarie?.heuresMensuelles ?? 151.67).replace(".", ","),
    tauxPas: salarie?.tauxPas == null ? "" : String(salarie.tauxPas).replace(".", ","),
    mutuelleSalarie: euros(salarie?.mutuelleSalarie ?? 0),
    mutuelleEmployeur: euros(salarie?.mutuelleEmployeur ?? 0),
  });
  const { pending, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (s: string) => Number(s.replace(",", "."));
  return (
    <Modal title={salarie ? `${salarie.prenom} ${salarie.nom}` : "Nouveau salarié"} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const body = {
          ...f, nir: f.nir || null, email: f.email || null, iban: f.iban || null, dateSortie: f.dateSortie || null,
          salaireBase: cents(f.salaireBase), heuresMensuelles: num(f.heuresMensuelles), tauxPas: f.tauxPas.trim() ? num(f.tauxPas) : null,
          mutuelleSalarie: cents(f.mutuelleSalarie), mutuelleEmployeur: cents(f.mutuelleEmployeur),
        };
        if (salarie) await api.put(`/api/dossiers/${dossierId}/paie/salaries/${salarie.id}`, body);
        else await api.post(`/api/dossiers/${dossierId}/paie/salaries`, body);
        onDone();
      }); }}>
        <div className="form-grid">
          <Field label="Matricule"><input required value={f.matricule} onChange={set("matricule")} /></Field>
          <Field label="Nom"><input required value={f.nom} onChange={set("nom")} autoComplete="off" /></Field>
          <Field label="Prénom"><input required value={f.prenom} onChange={set("prenom")} autoComplete="off" /></Field>
          <Field label="N° de sécurité sociale" hint={salarie?.nirMasque ? `Enregistré : ${salarie.nirMasque} — laissez vide pour le conserver` : "Chiffré, jamais affiché en clair"}>
            <input value={f.nir} onChange={set("nir")} autoComplete="off" placeholder="1 85 07 75 123 456 78" />
          </Field>
          <Field label="Emploi"><input required value={f.emploi} onChange={set("emploi")} /></Field>
          <Field label="Statut">
            <select value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value as "cadre" | "non_cadre" })}>
              <option value="non_cadre">Non-cadre</option><option value="cadre">Cadre</option>
            </select>
          </Field>
          <Field label="Date d'entrée"><input type="date" required value={f.dateEntree} onChange={set("dateEntree")} /></Field>
          <Field label="Date de sortie"><input type="date" value={f.dateSortie} onChange={set("dateSortie")} /></Field>
          <Field label="Salaire de base mensuel brut (€)"><input required inputMode="decimal" value={f.salaireBase} onChange={set("salaireBase")} /></Field>
          <Field label="Heures mensuelles" hint="151,67 h = 35 h par semaine"><input inputMode="decimal" value={f.heuresMensuelles} onChange={set("heuresMensuelles")} /></Field>
          <Field label="Taux de prélèvement à la source (%)" hint="Taux transmis par la DGFiP (CRM). Vide = taux neutre"><input inputMode="decimal" value={f.tauxPas} onChange={set("tauxPas")} /></Field>
          <Field label="Mutuelle : part salariale (€/mois)"><input inputMode="decimal" value={f.mutuelleSalarie} onChange={set("mutuelleSalarie")} /></Field>
          <Field label="Mutuelle : part patronale (€/mois)" hint="Au moins 50 % de la cotisation (CSS art. L911-7)"><input inputMode="decimal" value={f.mutuelleEmployeur} onChange={set("mutuelleEmployeur")} /></Field>
          <Field label="E-mail (facultatif)"><input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="IBAN (facultatif)" hint={salarie?.ibanMasque ? `Enregistré : ${salarie.ibanMasque}` : undefined}><input value={f.iban} onChange={set("iban")} autoComplete="off" /></Field>
        </div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function BulletinModal({ dossierId, salarie, periode, initial, onClose, onDone }: {
  dossierId: number; salarie: Salarie; periode: string; initial?: ElementsVariables; onClose: () => void; onDone: () => void;
}) {
  const [v, setV] = useState({
    heuresSup25: String(initial?.heuresSup25 ?? ""),
    heuresSup50: String(initial?.heuresSup50 ?? ""),
    primes: euros(initial?.primes ?? 0),
    heuresAbsence: String(initial?.heuresAbsence ?? ""),
    indemnitesNonSoumises: euros(initial?.indemnitesNonSoumises ?? 0),
  });
  const [calc, setCalc] = useState<Bulletin | null>(null);
  const [calcErreur, setCalcErreur] = useState<string | null>(null);
  const { pending, error, run } = useAction();
  const n = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : 0);
  const variables = { heuresSup25: n(v.heuresSup25), heuresSup50: n(v.heuresSup50), primes: cents(v.primes), heuresAbsence: n(v.heuresAbsence), indemnitesNonSoumises: cents(v.indemnitesNonSoumises) };
  const valide = Object.values(variables).every((x) => Number.isFinite(x) && x >= 0);
  const cle = JSON.stringify(variables);
  useEffect(() => {
    if (!valide) return;
    const id = setTimeout(() => {
      api.post<Bulletin>(`/api/dossiers/${dossierId}/paie/calcul`, { salarieId: salarie.id, periode, variables })
        .then((b) => { setCalc(b); setCalcErreur(null); })
        .catch((e: Error) => { setCalc(null); setCalcErreur(e.message); });
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  return (
    <Modal title={`Bulletin ${periode} — ${salarie.prenom} ${salarie.nom}`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 12 }}>Salaire de base <Money cents={salarie.salaireBase} /> pour {String(salarie.heuresMensuelles).replace(".", ",")} h. Saisissez les éléments variables du mois.</p>
      <div className="form-grid">
        <Field label="Heures sup. à 25 %"><input inputMode="decimal" value={v.heuresSup25} onChange={set("heuresSup25")} placeholder="0" /></Field>
        <Field label="Heures sup. à 50 %"><input inputMode="decimal" value={v.heuresSup50} onChange={set("heuresSup50")} placeholder="0" /></Field>
        <Field label="Primes (€ brut)"><input inputMode="decimal" value={v.primes} onChange={set("primes")} placeholder="0,00" /></Field>
        <Field label="Absences non payées (h)"><input inputMode="decimal" value={v.heuresAbsence} onChange={set("heuresAbsence")} placeholder="0" /></Field>
        <Field label="Frais remboursés (€)" hint="Non soumis à cotisations"><input inputMode="decimal" value={v.indemnitesNonSoumises} onChange={set("indemnitesNonSoumises")} placeholder="0,00" /></Field>
      </div>
      {calcErreur && <Alert tone="danger">{calcErreur}</Alert>}
      {calc && (
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <Stat label="Brut" value={<Money cents={calc.brut} />} />
          <Stat label="Net à payer" value={<Money cents={calc.netAPayer} />} hint={`Avant impôt ${formatEUR(calc.netAvantImpot)} · PAS ${formatEUR(calc.pas.montant)}`} />
          <Stat label="Cotisations salariales" value={<Money cents={calc.totalSalarial} />} />
          <Stat label="Coût employeur" value={<Money cents={calc.coutEmployeur} />} hint={`Charges patronales ${formatEUR(calc.totalPatronal)}`} />
        </div>
      )}
      {calc?.avertissements.map((a, i) => <p key={i} className="subtle" style={{ marginTop: 6 }}>{a}</p>)}
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={pending || !calc} onClick={() => run(async () => {
          await api.post(`/api/dossiers/${dossierId}/paie/bulletins`, { salarieId: salarie.id, periode, variables });
          onDone();
        })}>Enregistrer le brouillon</button>
      </div>
    </Modal>
  );
}

function ParametresModal({ dossierId, initial, onClose, onDone }: { dossierId: number; initial: Parametres; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ effectif: String(initial.effectif), tauxAtMp: String(initial.tauxAtMp).replace(".", ","), tauxVersementMobilite: String(initial.tauxVersementMobilite).replace(".", ","), convention: initial.convention ?? "" });
  const { pending, error, run } = useAction();
  const n = (s: string) => Number(s.replace(",", "."));
  return (
    <Modal title="Paramètres employeur" onClose={onClose}>
      <div className="form-grid">
        <Field label="Effectif" hint="Seuils : 11, 20, 50 et 250 salariés"><input inputMode="numeric" value={f.effectif} onChange={(e) => setF({ ...f, effectif: e.target.value })} /></Field>
        <Field label="Taux AT/MP (%)" hint="Notifié chaque année par la CARSAT"><input inputMode="decimal" value={f.tauxAtMp} onChange={(e) => setF({ ...f, tauxAtMp: e.target.value })} /></Field>
        <Field label="Versement mobilité (%)" hint="Dès 11 salariés, selon la commune"><input inputMode="decimal" value={f.tauxVersementMobilite} onChange={(e) => setF({ ...f, tauxVersementMobilite: e.target.value })} /></Field>
        <Field label="Convention collective" span2><input value={f.convention} onChange={(e) => setF({ ...f, convention: e.target.value })} placeholder="Ex. : Boulangerie-pâtisserie artisanale (IDCC 843)" /></Field>
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={pending} onClick={() => run(async () => {
          await api.put(`/api/dossiers/${dossierId}/paie/parametres`, { effectif: Math.round(n(f.effectif)), tauxAtMp: n(f.tauxAtMp), tauxVersementMobilite: n(f.tauxVersementMobilite), convention: f.convention || null });
          onDone();
        })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

export function BulletinPage() {
  const { dossier, base } = useDossier();
  const { bulletinId } = useParams();
  const { data, error, loading } = useApi<BulletinDetail>(`/api/dossiers/${dossier.id}/paie/bulletins/${bulletinId}`);
  return (
    <div className="stack">
      <div className="row between no-print">
        <Link to={`${base}/paie`}>← Retour à la paie</Link>
        <button className="btn" onClick={() => window.print()}>Imprimer / PDF</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && <BulletinView d={data} />}
    </div>
  );
}
