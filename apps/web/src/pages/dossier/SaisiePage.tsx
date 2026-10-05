import { PCG_ACCOUNTS, TAUX_TVA_LIST, defaultLabel, formatEUR, isCollectifTiers, toCents } from "@compta/core";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Icon } from "../../components/icons";
import { Alert, Card, ErrorBox, Field } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useToast } from "../../lib/hooks";
import type { Ecriture, Tiers } from "../../lib/types";
import { useDossier } from "./DossierLayout";

interface LigneForm {
  compte: string;
  compteAux: string;
  libelle: string;
  debit: string;
  credit: string;
  tauxTva: string;
}

const emptyLine = (): LigneForm => ({ compte: "", compteAux: "", libelle: "", debit: "", credit: "", tauxTva: "" });

function parse(v: string): number | null {
  if (!v.trim()) return 0;
  try {
    return toCents(v);
  } catch {
    return null;
  }
}

/** Modèles de saisie courants. */
const MODELES: Record<string, { journal: string; libelle: string; lignes: Partial<LigneForm>[] }> = {
  achat: { journal: "AC", libelle: "Facture fournisseur", lignes: [{ compte: "606" }, { compte: "44566", tauxTva: "2000" }, { compte: "401" }] },
  vente: { journal: "VE", libelle: "Facture client", lignes: [{ compte: "411" }, { compte: "706" }, { compte: "44571", tauxTva: "2000" }] },
  encaissement: { journal: "BQ", libelle: "Règlement client", lignes: [{ compte: "512" }, { compte: "411" }] },
  decaissement: { journal: "BQ", libelle: "Règlement fournisseur", lignes: [{ compte: "401" }, { compte: "512" }] },
  salaires: { journal: "OD", libelle: "Salaires du mois", lignes: [{ compte: "641" }, { compte: "645" }, { compte: "431" }, { compte: "421" }] },
};

export function SaisiePage() {
  const { dossier, exercice, base } = useDossier();
  const { ecritureId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tiers = useApi<Tiers[]>(`/api/dossiers/${dossier.id}/tiers`);
  const existing = useApi<Ecriture>(ecritureId ? `/api/dossiers/${dossier.id}/ecritures/${ecritureId}` : null);
  const defaultDate = exercice.debut <= new Date().toISOString().slice(0, 10) && new Date().toISOString().slice(0, 10) <= exercice.fin ? new Date().toISOString().slice(0, 10) : exercice.debut;

  const [journal, setJournal] = useState("AC");
  const [date, setDate] = useState(defaultDate);
  const [pieceRef, setPieceRef] = useState("");
  const [pieceDate, setPieceDate] = useState("");
  const [libelle, setLibelle] = useState("");
  const [lignes, setLignes] = useState<LigneForm[]>([emptyLine(), emptyLine()]);
  const { pending, error, run } = useAction();

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setJournal(e.journal);
    setDate(e.date);
    setPieceRef(e.pieceRef);
    setPieceDate(e.pieceDate);
    setLibelle(e.libelle);
    setLignes(
      e.lignes.map((l) => ({
        compte: l.compte, compteAux: l.compteAux ?? "", libelle: l.libelle ?? "",
        debit: l.debit ? (l.debit / 100).toFixed(2).replace(".", ",") : "",
        credit: l.credit ? (l.credit / 100).toFixed(2).replace(".", ",") : "",
        tauxTva: l.tauxTva != null ? String(l.tauxTva) : "",
      })),
    );
  }, [existing.data]);

  const totals = useMemo(() => {
    let d = 0, c = 0, invalid = false;
    for (const l of lignes) {
      const pd = parse(l.debit), pc = parse(l.credit);
      if (pd === null || pc === null) invalid = true;
      d += pd ?? 0;
      c += pc ?? 0;
    }
    return { d, c, diff: d - c, invalid };
  }, [lignes]);

  const update = (i: number, patch: Partial<LigneForm>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** Équilibre automatiquement la ligne vide suivante. */
  const balance = (i: number) => {
    if (totals.diff === 0) return;
    const l = lignes[i]!;
    if (l.debit || l.credit) return;
    const v = (Math.abs(totals.diff) / 100).toFixed(2).replace(".", ",");
    update(i, totals.diff > 0 ? { credit: v } : { debit: v });
  };

  const applyModele = (k: string) => {
    const m = MODELES[k];
    if (!m) return;
    setJournal(m.journal);
    if (!libelle) setLibelle(m.libelle);
    setLignes(m.lignes.map((l) => ({ ...emptyLine(), ...l })));
  };

  const submit = (e: FormEvent, andNew: boolean) => {
    e.preventDefault();
    void run(async () => {
      const payload = {
        journal, date, pieceRef, pieceDate: pieceDate || undefined, libelle,
        lignes: lignes
          .filter((l) => l.compte || l.debit || l.credit)
          .map((l) => ({
            compte: l.compte.trim(),
            compteAux: l.compteAux || null,
            libelle: l.libelle || undefined,
            debit: parse(l.debit) ?? 0,
            credit: parse(l.credit) ?? 0,
            tauxTva: l.tauxTva ? Number(l.tauxTva) : null,
          })),
      };
      if (ecritureId) {
        await api.put(`/api/dossiers/${dossier.id}/ecritures/${ecritureId}`, payload);
        toast("Brouillard mis à jour");
        navigate(`${base}/ecritures`);
      } else {
        await api.post(`/api/dossiers/${dossier.id}/ecritures`, payload);
        toast("Écriture enregistrée en brouillard");
        if (andNew) {
          setPieceRef("");
          setLibelle("");
          setLignes([emptyLine(), emptyLine()]);
        } else navigate(`${base}/ecritures`);
      }
    });
  };

  if (exercice.statut === "cloture") {
    return <Alert tone="warn" title="Exercice clôturé">Sélectionnez un exercice ouvert pour saisir des écritures.</Alert>;
  }
  if (existing.data?.statut === "validee") {
    return <Alert tone="warn" title="Écriture validée">Une écriture validée est intangible. Utilisez la contre-passation depuis la liste des écritures.</Alert>;
  }

  return (
    <form onSubmit={(e) => submit(e, false)} className="stack">
      <datalist id="pcg">
        {PCG_ACCOUNTS.map((a) => <option key={a.numero} value={a.numero}>{a.libelle}</option>)}
      </datalist>
      <datalist id="tiers-list">
        {(tiers.data ?? []).map((t) => <option key={t.id} value={t.compteAux}>{t.nom}</option>)}
      </datalist>
      <Card
        title={ecritureId ? "Modifier le brouillard" : "Nouvelle écriture"}
        subtitle="Saisie en partie double. L'écriture reste en brouillard jusqu'à sa validation par un expert-comptable."
        actions={
          !ecritureId && (
            <select onChange={(e) => { applyModele(e.target.value); e.target.value = ""; }} defaultValue="" style={{ width: "auto" }} aria-label="Appliquer un modèle">
              <option value="" disabled>Modèle de saisie…</option>
              <option value="achat">Achat avec TVA</option>
              <option value="vente">Vente avec TVA</option>
              <option value="encaissement">Encaissement client</option>
              <option value="decaissement">Paiement fournisseur</option>
              <option value="salaires">Salaires</option>
            </select>
          )
        }
      >
        <ErrorBox error={error} />
        <div className="form-grid" style={{ marginTop: error ? 14 : 0 }}>
          <Field label="Journal">
            <select value={journal} onChange={(e) => setJournal(e.target.value)}>
              {dossier.journaux.filter((j) => j.code !== "AN").map((j) => <option key={j.code} value={j.code}>{j.code} — {j.libelle}</option>)}
            </select>
          </Field>
          <Field label="Date comptable" hint={`Exercice ${exercice.debut} → ${exercice.fin}`}>
            <input type="date" value={date} min={exercice.debut} max={exercice.fin} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Référence de la pièce" hint="Obligatoire (ANC 2014-03, art. 921-3)">
            <input value={pieceRef} onChange={(e) => setPieceRef(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="Date de la pièce"><input type="date" value={pieceDate} onChange={(e) => setPieceDate(e.target.value)} /></Field>
          <Field label="Libellé" span2><input value={libelle} onChange={(e) => setLibelle(e.target.value)} required maxLength={200} /></Field>
        </div>
      </Card>

      <div className="card">
        <div className="table-wrap">
          <table className="entry-lines">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Compte</th>
                <th style={{ width: 150 }}>Auxiliaire</th>
                <th>Libellé de ligne</th>
                <th style={{ width: 100 }}>TVA</th>
                <th className="num" style={{ width: 140 }}>Débit</th>
                <th className="num" style={{ width: 140 }}>Crédit</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const collectif = l.compte ? isCollectifTiers(l.compte) : null;
                return (
                  <tr key={i}>
                    <td>
                      <input list="pcg" value={l.compte} onChange={(e) => update(i, { compte: e.target.value.toUpperCase() })} placeholder="ex. 606" aria-label={`Compte ligne ${i + 1}`} />
                      {l.compte && <div className="subtle" style={{ fontSize: 11.5, marginTop: 2 }}>{defaultLabel(l.compte)}</div>}
                    </td>
                    <td>
                      <input list="tiers-list" value={l.compteAux} onChange={(e) => update(i, { compteAux: e.target.value.toUpperCase() })} disabled={!collectif} placeholder={collectif ? (collectif === "client" ? "Client" : "Fournisseur") : "—"} aria-label={`Auxiliaire ligne ${i + 1}`} />
                    </td>
                    <td><input value={l.libelle} onChange={(e) => update(i, { libelle: e.target.value })} placeholder={libelle} aria-label={`Libellé ligne ${i + 1}`} /></td>
                    <td>
                      <select value={l.tauxTva} onChange={(e) => update(i, { tauxTva: e.target.value })} disabled={!l.compte.startsWith("445")} aria-label={`Taux TVA ligne ${i + 1}`}>
                        <option value="">—</option>
                        {TAUX_TVA_LIST.map((t) => <option key={t} value={t}>{t / 100} %</option>)}
                      </select>
                    </td>
                    <td><input className="num" inputMode="decimal" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} onFocus={() => balance(i)} aria-invalid={parse(l.debit) === null} aria-label={`Débit ligne ${i + 1}`} /></td>
                    <td><input className="num" inputMode="decimal" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-invalid={parse(l.credit) === null} aria-label={`Crédit ligne ${i + 1}`} /></td>
                    <td>
                      <button type="button" className="btn ghost sm" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} disabled={lignes.length <= 2} aria-label="Supprimer la ligne"><Icon.trash /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body row between">
          <button type="button" className="btn sm" onClick={() => setLignes((ls) => [...ls, emptyLine()])}><Icon.plus /> Ajouter une ligne</button>
          <div className="balance-indicator" aria-live="polite">
            <span>Débit <strong>{formatEUR(totals.d)}</strong></span>
            <span>Crédit <strong>{formatEUR(totals.c)}</strong></span>
            {totals.invalid ? (
              <span className="danger-text">Montant invalide</span>
            ) : totals.diff === 0 && totals.d > 0 ? (
              <span className="ok-text"><strong>✓ Équilibrée</strong></span>
            ) : (
              <span className="danger-text">Écart <strong>{formatEUR(Math.abs(totals.diff))}</strong></span>
            )}
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={() => navigate(`${base}/ecritures`)}>Annuler</button>
        {!ecritureId && <button type="button" className="btn" disabled={pending || totals.diff !== 0 || totals.invalid} onClick={(e) => submit(e as unknown as FormEvent, true)}>Enregistrer et nouvelle</button>}
        <button className="btn primary" disabled={pending || totals.diff !== 0 || totals.invalid}>{pending ? "Enregistrement…" : "Enregistrer en brouillard"}</button>
      </div>
    </form>
  );
}
