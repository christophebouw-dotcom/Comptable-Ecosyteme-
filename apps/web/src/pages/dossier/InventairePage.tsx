import { type Ecriture, LIBELLES_REGULARISATIONS, PCG_ACCOUNTS, type TypeRegularisation, contrepartieParDefaut, defaultLabel, formatEUR, toCents } from "@compta/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, DateFr, Empty, ErrorBox, Field, Loading, Modal, Money, Stat } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

interface Reg {
  type: TypeRegularisation;
  libelle: string;
  compte: string;
  compteAux?: string | null;
  montantHT: number;
  tauxTvaBp?: number | null;
  periode?: { debut: string; fin: string } | null;
  tauxDepreciationBp?: number | null;
  compteContrepartie?: string | null;
}
interface RegEnregistree extends Reg {
  id: number;
  montant: number;
  ecritureId: number | null;
  ecritureStatut: "brouillard" | "validee" | null;
  extourneId: number | null;
  extournable: boolean;
}
interface Suggestion extends Reg {
  cle: string;
  motif: string;
  montant: number;
}
interface Data {
  regularisations: RegEnregistree[];
  suggestions: Suggestion[];
  impactResultat: number;
  totaux: { chargesRattachees: number; produitsRattaches: number; chargesConstateesAvance: number; produitsConstatesAvance: number };
  aExtourner: { id: number; type: TypeRegularisation; libelle: string; montant: number; valide: boolean }[];
}

const TYPES = Object.entries(LIBELLES_REGULARISATIONS) as [TypeRegularisation, (typeof LIBELLES_REGULARISATIONS)[TypeRegularisation]][];

export function InventairePage() {
  const { dossier, exercice, base } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>(`/api/dossiers/${dossier.id}/regularisations${qs({ exerciceId: exercice.id })}`);
  const [form, setForm] = useState<(Reg & { cle?: string }) | null>(null);
  const action = useAction();
  const ouvert = exercice.statut === "ouvert";
  const ecrire = can("compta:write") && ouvert;

  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">
          Écritures d'inventaire au {exercice.fin.split("-").reverse().join("/")} : rattachement des charges et des produits à l'exercice (C. com. art. L123-21).
        </p>
        {ecrire && <button className="btn primary" onClick={() => setForm({ type: "fnp", libelle: "", compte: "", montantHT: 0, tauxTvaBp: 2000 })}><Icon.plus /> Nouvelle régularisation</button>}
      </div>
      <ErrorBox error={error ?? action.error} />

      {data && data.aExtourner.length > 0 && ecrire && (
        <Alert tone="warn" title={`${data.aExtourner.length} régularisation(s) de l'exercice précédent à extourner`}>
          <p>Les factures non parvenues, charges constatées d'avance, etc. de l'exercice précédent doivent être contre-passées au {exercice.debut.split("-").reverse().join("/")} pour ne pas être comptées deux fois.</p>
          <ul>{data.aExtourner.map((r) => <li key={r.id}>{r.libelle} — <Money cents={r.montant} />{!r.valide && <> <Badge tone="warn">écriture non validée</Badge></>}</li>)}</ul>
          <button className="btn primary sm" style={{ marginTop: 8 }} disabled={action.pending} onClick={() => action.run(async () => {
            const r = await api.post<{ extournes: number; nonValidees: number }>(`/api/dossiers/${dossier.id}/regularisations/extournes`, { exerciceId: exercice.id });
            toast(`${r.extournes} extourne(s) passée(s) en brouillard`);
            reload();
          })}>Passer les extournes</button>
        </Alert>
      )}

      {data && (
        <div className="grid grid-4">
          <Stat label="Charges rattachées" value={<Money cents={data.totaux.chargesRattachees} />} hint="FNP, charges à payer, dépréciations, provisions" />
          <Stat label="Produits rattachés" value={<Money cents={data.totaux.produitsRattaches} />} hint="Factures à établir, produits à recevoir" />
          <Stat label="Constatés d'avance" value={<Money cents={data.totaux.chargesConstateesAvance - data.totaux.produitsConstatesAvance} signed />} hint={`Charges reportées ${formatEUR(data.totaux.chargesConstateesAvance)} · produits reportés ${formatEUR(data.totaux.produitsConstatesAvance)}`} />
          <Stat label="Impact sur le résultat" value={<Money cents={data.impactResultat} signed />} tone={data.impactResultat < 0 ? "danger" : "ok"} />
        </div>
      )}

      {data && data.suggestions.length > 0 && ecrire && (
        <Card title={`${data.suggestions.length} point(s) de cut-off détecté(s)`} subtitle="Indices tirés des écritures de l'exercice — à vérifier avant de comptabiliser" padded={false}>
          <table>
            <thead><tr><th>Type</th><th>Motif</th><th className="num">Montant estimé</th><th /></tr></thead>
            <tbody>
              {data.suggestions.map((s) => (
                <tr key={s.cle}>
                  <td><Badge tone="info">{LIBELLES_REGULARISATIONS[s.type].libelle}</Badge></td>
                  <td><strong>{s.libelle}</strong><div className="subtle">{s.motif}</div></td>
                  <td><Money cents={s.montant} /></td>
                  <td className="actions"><button className="btn sm" onClick={() => setForm({ ...s })}>Examiner</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="card">
        {loading && !data ? <Loading /> : !data?.regularisations.length ? (
          <Empty title="Aucune régularisation" action={ecrire && <button className="btn primary" onClick={() => setForm({ type: "fnp", libelle: "", compte: "", montantHT: 0, tauxTvaBp: 2000 })}>Ajouter une régularisation</button>}>
            Factures non parvenues ou à établir, charges et produits constatés d'avance, charges à payer, dépréciations de créances et provisions : chaque régularisation génère son écriture au journal OD, datée du jour de clôture.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Libellé</th><th>Comptes</th><th className="num">Montant</th><th>Écriture</th><th /></tr></thead>
              <tbody>
                {data.regularisations.map((r) => (
                  <tr key={r.id}>
                    <td><Badge>{LIBELLES_REGULARISATIONS[r.type].libelle}</Badge></td>
                    <td>
                      {r.libelle}
                      {r.periode && <div className="subtle">Période <DateFr iso={r.periode.debut} /> → <DateFr iso={r.periode.fin} /> · facture <Money cents={r.montantHT} /></div>}
                    </td>
                    <td className="mono">{r.compte || (r.type === "depreciation_client" ? "6817" : "6815")} / {r.compteContrepartie || contrepartieParDefaut(r.type, r.compte)}</td>
                    <td><strong><Money cents={r.montant} /></strong></td>
                    <td>
                      {r.ecritureId && <Link to={`${base}/saisie/${r.ecritureId}`}>{r.ecritureStatut === "validee" ? <Badge tone="ok">Validée</Badge> : <Badge tone="warn">Brouillard</Badge>}</Link>}
                      {r.extourneId && <> <Badge tone="info">Extournée</Badge></>}
                      {!r.extournable && <div className="subtle">Reprise à la clôture suivante</div>}
                    </td>
                    <td className="actions">
                      {ecrire && r.ecritureStatut !== "validee" && (
                        <button className="btn ghost sm" aria-label="Supprimer" onClick={() => action.run(async () => {
                          if (!confirm("Supprimer cette régularisation et son écriture en brouillard ?")) return;
                          await api.del(`/api/dossiers/${dossier.id}/regularisations/${r.id}`);
                          reload();
                        })}><Icon.trash /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Alert tone="info">
        Les écritures sont créées en brouillard pour validation par l'expert-comptable. Les FNP, FAE, CCA, PCA, charges à payer et produits à recevoir sont extournés au premier jour de l'exercice suivant ; les dépréciations et provisions sont réexaminées et reprises à la clôture suivante.
      </Alert>
      {form && <RegularisationModal initial={form} exerciceId={exercice.id} dossierId={dossier.id} dateCloture={exercice.fin} onClose={() => setForm(null)} onDone={() => { setForm(null); reload(); toast("Régularisation comptabilisée en brouillard"); }} />}
    </div>
  );
}

function RegularisationModal({ initial, exerciceId, dossierId, dateCloture, onClose, onDone }: {
  initial: Reg & { cle?: string }; exerciceId: number; dossierId: number; dateCloture: string; onClose: () => void; onDone: () => void;
}) {
  const [r, setR] = useState(initial);
  const [montant, setMontant] = useState(initial.montantHT ? (initial.montantHT / 100).toFixed(2).replace(".", ",") : "");
  const [taux, setTaux] = useState(initial.tauxDepreciationBp ? String(initial.tauxDepreciationBp / 100) : "100");
  const [apercu, setApercu] = useState<{ controles: { champ: string; message: string }[]; montant: number; ecriture: Ecriture | null } | null>(null);
  const { pending, error, run } = useAction();
  const t = LIBELLES_REGULARISATIONS[r.type];
  const avecTva = r.type === "fnp" || r.type === "fae";
  const avecPeriode = r.type === "cca" || r.type === "pca";
  const avecCompte = r.type !== "depreciation_client" && r.type !== "provision_risque";

  let montantHT = 0;
  try {
    montantHT = montant ? toCents(montant) : 0;
  } catch {
    montantHT = 0;
  }
  const corps = {
    exerciceId, ...r, montantHT, cle: initial.cle,
    tauxTvaBp: avecTva ? (r.tauxTvaBp ?? 0) : null,
    periode: avecPeriode ? r.periode ?? null : null,
    tauxDepreciationBp: r.type === "depreciation_client" ? Math.round(Number(taux.replace(",", ".")) * 100) : null,
    compte: avecCompte ? r.compte : "",
  };
  const cle = JSON.stringify(corps);
  useEffect(() => {
    if (!montantHT || (avecCompte && !r.compte)) {
      setApercu(null);
      return;
    }
    const id = setTimeout(() => {
      api.post<NonNullable<typeof apercu>>(`/api/dossiers/${dossierId}/regularisations/apercu`, corps).then(setApercu).catch(() => setApercu(null));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  return (
    <Modal title="Régularisation de fin d'exercice" onClose={onClose} wide>
      <datalist id="pcg-reg">{PCG_ACCOUNTS.filter((a) => /^[67]/.test(a.numero)).map((a) => <option key={a.numero} value={a.numero}>{a.libelle}</option>)}</datalist>
      <div className="form-grid">
        <Field label="Type" span2 hint={t.aide}>
          <select value={r.type} onChange={(e) => setR({ ...r, type: e.target.value as TypeRegularisation, compteContrepartie: null })}>
            {TYPES.map(([k, v]) => <option key={k} value={k}>{v.libelle}</option>)}
          </select>
        </Field>
        <Field label="Libellé" span2><input value={r.libelle} onChange={(e) => setR({ ...r, libelle: e.target.value })} placeholder="Ex. : Électricité décembre — EDF" /></Field>
        {avecCompte && (
          <Field label={t.sens === "charge" ? "Compte de charge" : "Compte de produit"} hint={r.compte ? defaultLabel(r.compte) : undefined}>
            <input list="pcg-reg" value={r.compte} onChange={(e) => setR({ ...r, compte: e.target.value.toUpperCase().trim() })} placeholder={t.sens === "charge" ? "606" : "706"} />
          </Field>
        )}
        <Field label={avecPeriode ? "Montant HT de la facture" : r.type === "depreciation_client" ? "Créance HT" : "Montant HT"}>
          <input inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0,00" />
        </Field>
        {avecTva && (
          <Field label="TVA">
            <select value={r.tauxTvaBp ?? 0} onChange={(e) => setR({ ...r, tauxTvaBp: Number(e.target.value) })}>
              {[2000, 1000, 550, 210, 0].map((v) => <option key={v} value={v}>{v === 0 ? "Sans TVA" : `${(v / 100).toLocaleString("fr-FR")} %`}</option>)}
            </select>
          </Field>
        )}
        {avecPeriode && (
          <>
            <Field label="Période couverte du"><input type="date" value={r.periode?.debut ?? ""} onChange={(e) => setR({ ...r, periode: { debut: e.target.value, fin: r.periode?.fin ?? "" } })} /></Field>
            <Field label="au"><input type="date" value={r.periode?.fin ?? ""} onChange={(e) => setR({ ...r, periode: { debut: r.periode?.debut ?? "", fin: e.target.value } })} /></Field>
          </>
        )}
        {r.type === "depreciation_client" && (
          <Field label="Taux de dépréciation (%)" hint="Selon le risque de non-recouvrement"><input inputMode="decimal" value={taux} onChange={(e) => setTaux(e.target.value)} /></Field>
        )}
        <Field label="Contrepartie" hint="Laissez vide pour le compte usuel">
          <input value={r.compteContrepartie ?? ""} onChange={(e) => setR({ ...r, compteContrepartie: e.target.value.toUpperCase().trim() || null })} placeholder="auto" />
        </Field>
      </div>

      {apercu && (
        <div style={{ marginTop: 16 }}>
          {apercu.controles.length > 0 ? (
            <Alert tone="warn" title="À corriger"><ul>{apercu.controles.map((c, i) => <li key={i}>{c.message}</li>)}</ul></Alert>
          ) : apercu.ecriture && (
            <>
              <strong>Écriture au <DateFr iso={dateCloture} /></strong>
              {avecPeriode && <span className="subtle"> — part postérieure à la clôture : <Money cents={apercu.montant} /></span>}
              <table style={{ marginTop: 8 }}>
                <thead><tr><th>Compte</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th></tr></thead>
                <tbody>{apercu.ecriture.lignes.map((l, i) => (
                  <tr key={i}><td className="mono">{l.compte}</td><td>{defaultLabel(l.compte)}</td><td><Money cents={l.debit} hideZero /></td><td><Money cents={l.credit} hideZero /></td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={pending || !apercu?.ecriture || !r.libelle.trim()} onClick={() => run(async () => {
          await api.post(`/api/dossiers/${dossierId}/regularisations`, corps);
          onDone();
        })}>Comptabiliser</button>
      </div>
    </Modal>
  );
}
