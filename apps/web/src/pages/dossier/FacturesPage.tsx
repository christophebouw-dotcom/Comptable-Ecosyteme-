import { TAUX_TVA_LIST, computeTotaux, formatTaux, toCents } from "@compta/core";
import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Badge, DateFr, Empty, ErrorBox, Field, Hash, Loading, Modal, Money, STATUT_FACTURE } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import type { FactureDetail, FactureResume, Tiers } from "../../lib/types";
import { useDossier } from "./DossierLayout";

export function FacturesPage() {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<FactureResume[]>(`/api/dossiers/${dossier.id}/factures`);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const emises = (data ?? []).filter((f) => f.statut !== "brouillon");
  const encours = emises.filter((f) => f.statut === "emise" && f.type === "facture").reduce((a, f) => a + f.totalTTC, 0);
  const retard = emises.filter((f) => f.enRetard);

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <Badge tone="info">Encours clients : <Money cents={encours} /></Badge>
          {retard.length > 0 && <Badge tone="danger" dot>{retard.length} facture(s) en retard</Badge>}
        </div>
        {can("factures:write") && <button className="btn primary" onClick={() => setCreating(true)}><Icon.plus /> Nouvelle facture</button>}
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty title="Aucune facture" action={can("factures:write") && <button className="btn primary" onClick={() => setCreating(true)}>Créer une facture</button>}>
            Les factures émises sont numérotées en séquence continue, figées et comptabilisées automatiquement.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Numéro</th><th>Client</th><th>Émission</th><th>Échéance</th><th className="num">HT</th><th className="num">TTC</th><th>Statut</th></tr></thead>
              <tbody>
                {data.map((f) => (
                  <tr key={f.id} onClick={() => setOpen(f.id)} style={{ cursor: "pointer" }}>
                    <td className="mono">{f.numero ?? <span className="subtle">brouillon #{f.id}</span>}{f.type === "avoir" && <> <Badge tone="warn">Avoir</Badge></>}</td>
                    <td>{f.client}</td>
                    <td><DateFr iso={f.dateEmission} /></td>
                    <td><DateFr iso={f.dateEcheance} /> {f.enRetard && <Badge tone="danger">Retard</Badge>}</td>
                    <td><Money cents={f.totalHT} /></td>
                    <td><Money cents={f.totalTTC} /></td>
                    <td><Badge tone={STATUT_FACTURE[f.statut]?.tone}>{STATUT_FACTURE[f.statut]?.label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <FactureModal id={open} onClose={() => setOpen(null)} onChanged={reload} onOpen={setOpen} />}
      {creating && <FactureForm onClose={() => setCreating(false)} onSaved={(id) => { reload(); setOpen(id); }} />}
    </div>
  );
}

function FactureModal({ id, onClose, onChanged, onOpen }: { id: number; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void }) {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<FactureDetail>(`/api/dossiers/${dossier.id}/factures/${id}`);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const url = `/api/dossiers/${dossier.id}/factures/${id}`;
  const after = (msg: string) => { toast(msg); reload(); onChanged(); };

  if (editing && data) return <FactureForm initial={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} />;
  const f = data?.facture;
  const bloquants = data?.controles.filter((c) => c.bloquant) ?? [];

  return (
    <Modal title={data ? (data.numero ? `${data.type === "avoir" ? "Avoir" : "Facture"} ${data.numero}` : "Brouillon de facture") : "Facture"} onClose={onClose} wide>
      <ErrorBox error={error ?? action.error} />
      {!data || !f ? <Loading /> : (
        <div className="stack">
          <div className="row between">
            <Badge tone={STATUT_FACTURE[data.statut]?.tone}>{STATUT_FACTURE[data.statut]?.label}</Badge>
            <div className="row">
              {data.statut === "brouillon" && can("factures:write") && (
                <>
                  <button className="btn danger sm" onClick={() => action.run(async () => { if (!confirm("Supprimer ce brouillon ?")) return; await api.del(url); toast("Brouillon supprimé"); onChanged(); onClose(); })}><Icon.trash /> Supprimer</button>
                  <button className="btn sm" onClick={() => setEditing(true)}>Modifier</button>
                  <button className="btn primary" disabled={action.pending || bloquants.length > 0} onClick={() => action.run(async () => {
                    if (!confirm("L'émission attribue un numéro définitif et fige la facture. Continuer ?")) return;
                    await api.post(`${url}/emettre`); after("Facture émise et comptabilisée en brouillard (journal VE)");
                  })}><Icon.check /> Émettre</button>
                </>
              )}
              {data.statut !== "brouillon" && (
                <a className="btn sm" href={`${url}/facturx`} download><Icon.download /> XML Factur-X</a>
              )}
              {data.statut === "emise" && can("factures:write") && data.type === "facture" && (
                <>
                  <button className="btn sm" onClick={() => action.run(async () => { const r = await api.post<{ id: number }>(`${url}/avoir`); toast("Avoir créé en brouillon"); onChanged(); onOpen(r.id); })}>Créer un avoir</button>
                  <button className="btn primary sm" onClick={() => action.run(async () => { await api.post(`${url}/payer`, { date: new Date().toISOString().slice(0, 10) }); after("Facture marquée payée"); })}>Marquer payée</button>
                </>
              )}
              <button className="btn sm" onClick={() => window.print()}>Imprimer</button>
            </div>
          </div>

          {data.statut === "brouillon" && data.controles.length > 0 && (
            <Alert tone={bloquants.length ? "danger" : "warn"} title={bloquants.length ? "Mentions obligatoires à compléter avant émission" : "Points d'attention"}>
              <ul>{data.controles.map((c, i) => <li key={i}>{c.message} <span className="subtle">({c.reference})</span></li>)}</ul>
            </Alert>
          )}

          <div className="card card-body">
            <div className="grid grid-2">
              <div>
                <div className="subtle">Émetteur</div>
                <strong>{f.vendeur.nom}</strong>
                <div>{f.vendeur.adresse}</div>
                <div>{f.vendeur.codePostal} {f.vendeur.ville}</div>
                <div className="subtle">SIREN {f.vendeur.siren}{f.vendeur.tvaIntra && ` · TVA ${f.vendeur.tvaIntra}`}</div>
              </div>
              <div>
                <div className="subtle">Client</div>
                <strong>{f.acheteur.nom}</strong>
                <div>{f.acheteur.adresse}</div>
                <div>{f.acheteur.codePostal} {f.acheteur.ville}</div>
                {f.acheteur.siren && <div className="subtle">SIREN {f.acheteur.siren}</div>}
              </div>
            </div>
            <div className="row" style={{ marginTop: 16, gap: 24 }}>
              <span>Date : <strong><DateFr iso={f.dateEmission} /></strong></span>
              <span>Échéance : <strong><DateFr iso={f.dateEcheance} /></strong></span>
              <span>Opération : <strong>{f.categorie === "biens" ? "Livraison de biens" : f.categorie === "services" ? "Prestation de services" : "Mixte"}</strong></span>
              {f.factureOrigine && <span>Facture d'origine : <strong>{f.factureOrigine}</strong></span>}
            </div>
            <table style={{ marginTop: 16 }}>
              <thead><tr><th>Désignation</th><th className="num">Qté</th><th className="num">PU HT</th><th className="num">Remise</th><th className="num">TVA</th><th className="num">Total HT</th></tr></thead>
              <tbody>
                {f.lignes.map((l, i) => (
                  <tr key={i}>
                    <td>{l.designation}</td>
                    <td className="num">{l.quantite.toLocaleString("fr-FR")}</td>
                    <td><Money cents={l.prixUnitaireHT} /></td>
                    <td className="num">{l.remisePct ? `${l.remisePct} %` : ""}</td>
                    <td className="num">{formatTaux(l.tauxTvaBp)}</td>
                    <td><Money cents={data.totaux.lignes[i]!.montantHT} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <table style={{ width: 340 }}>
                <tbody>
                  {data.totaux.ventilation.map((v) => (
                    <tr key={v.tauxBp}><td className="muted">TVA {formatTaux(v.tauxBp)} sur <Money cents={v.baseHT} /></td><td><Money cents={v.tva} /></td></tr>
                  ))}
                  <tr><td>Total HT</td><td><Money cents={data.totaux.totalHT} /></td></tr>
                  <tr><td>Total TVA</td><td><Money cents={data.totaux.totalTVA} /></td></tr>
                </tbody>
                <tfoot><tr><td>Net à payer</td><td><Money cents={data.totaux.totalTTC} /></td></tr></tfoot>
              </table>
            </div>
            <div style={{ marginTop: 16 }} className="subtle">
              {data.mentions.map((m, i) => <p key={i}>{m}</p>)}
            </div>
          </div>
          {data.hash && <p className="subtle">Facture figée le <DateFr iso={data.emittedAt} withTime /> · empreinte SHA-256 <Hash value={data.hash} /></p>}
        </div>
      )}
    </Modal>
  );
}

interface LigneForm { designation: string; quantite: string; prix: string; taux: string; remise: string }

function FactureForm({ initial, onClose, onSaved }: { initial?: FactureDetail; onClose: () => void; onSaved: (id: number) => void }) {
  const { dossier } = useDossier();
  const toast = useToast();
  const tiers = useApi<Tiers[]>(`/api/dossiers/${dossier.id}/tiers?type=client`);
  const b = initial?.brouillon as
    | { tiersId: number; dateEmission?: string; delaiPaiementJours: number; categorie: string; tvaSurDebits: boolean; mentionExoneration?: string; lignes: { designation: string; quantite: number; prixUnitaireHT: number; tauxTvaBp: number; remisePct?: number }[]; type: string; factureOrigineId?: number }
    | undefined;
  const franchise = dossier.regimeTva === "franchise";
  const [tiersId, setTiersId] = useState<number | "">(b?.tiersId ?? "");
  const [dateEmission, setDateEmission] = useState(b?.dateEmission ?? new Date().toISOString().slice(0, 10));
  const [delai, setDelai] = useState(String(b?.delaiPaiementJours ?? 30));
  const [categorie, setCategorie] = useState(b?.categorie ?? "services");
  const [debits, setDebits] = useState(b?.tvaSurDebits ?? false);
  const [lignes, setLignes] = useState<LigneForm[]>(
    b?.lignes.map((l) => ({ designation: l.designation, quantite: String(l.quantite), prix: (l.prixUnitaireHT / 100).toFixed(2).replace(".", ","), taux: String(l.tauxTvaBp), remise: l.remisePct ? String(l.remisePct) : "" })) ??
      [{ designation: "", quantite: "1", prix: "", taux: franchise ? "0" : "2000", remise: "" }],
  );
  const { pending, error, run } = useAction();

  const parsed = lignes.map((l) => {
    let prix = 0;
    try { prix = toCents(l.prix || "0"); } catch { prix = NaN; }
    return { designation: l.designation, quantite: Number(l.quantite.replace(",", ".")), prixUnitaireHT: prix, tauxTvaBp: Number(l.taux), remisePct: l.remise ? Number(l.remise.replace(",", ".")) : undefined };
  });
  const valid = parsed.every((l) => Number.isFinite(l.prixUnitaireHT) && l.quantite > 0);
  const t = valid ? computeTotaux({ lignes: parsed }) : null;
  const update = (i: number, patch: Partial<LigneForm>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () =>
    run(async () => {
      const payload = {
        tiersId: Number(tiersId), type: b?.type ?? "facture", factureOrigineId: b?.factureOrigineId, dateEmission, delaiPaiementJours: Number(delai), categorie, tvaSurDebits: debits,
        mentionExoneration: franchise ? "TVA non applicable, art. 293 B du CGI" : (b?.mentionExoneration ?? undefined),
        lignes: parsed,
      };
      if (initial) {
        await api.put(`/api/dossiers/${dossier.id}/factures/${initial.id}`, payload);
        toast("Brouillon mis à jour");
        onSaved(initial.id);
      } else {
        const r = await api.post<{ id: number }>(`/api/dossiers/${dossier.id}/factures`, payload);
        toast("Brouillon de facture créé");
        onSaved(r.id);
      }
      onClose();
    });

  return (
    <Modal title={initial ? "Modifier le brouillon" : "Nouvelle facture"} onClose={onClose} wide>
      <div className="stack">
        <ErrorBox error={error} />
        {tiers.data && tiers.data.length === 0 && <Alert tone="warn">Créez d'abord un client dans l'onglet « Tiers ».</Alert>}
        <div className="form-grid">
          <Field label="Client" span2>
            <select value={tiersId} onChange={(e) => setTiersId(Number(e.target.value))} required>
              <option value="">Sélectionner…</option>
              {(tiers.data ?? []).filter((x) => !x.anonymized).map((x) => <option key={x.id} value={x.id}>{x.nom} ({x.compteAux}){x.professionnel ? "" : " — particulier"}</option>)}
            </select>
          </Field>
          <Field label="Date d'émission"><input type="date" value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} /></Field>
          <Field label="Délai de paiement" hint="60 jours maximum (C. com. L441-10)">
            <select value={delai} onChange={(e) => setDelai(e.target.value)}>
              {[0, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d === 0 ? "À réception" : `${d} jours`}</option>)}
            </select>
          </Field>
          <Field label="Catégorie de l'opération" hint="Mention obligatoire (réforme 2026)">
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
              <option value="services">Prestation de services</option>
              <option value="biens">Livraison de biens</option>
              <option value="mixte">Mixte</option>
            </select>
          </Field>
          {categorie !== "biens" && !franchise && (
            <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={debits} onChange={(e) => setDebits(e.target.checked)} /> Option pour la TVA sur les débits</label>
          )}
        </div>
        {franchise && <Alert tone="info">Franchise en base : la mention « TVA non applicable, art. 293 B du CGI » sera portée sur la facture.</Alert>}
        <table className="entry-lines">
          <thead><tr><th>Désignation</th><th style={{ width: 90 }}>Qté</th><th style={{ width: 130 }}>PU HT (€)</th><th style={{ width: 90 }}>Remise %</th><th style={{ width: 100 }}>TVA</th><th className="num" style={{ width: 120 }}>Total HT</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td><input value={l.designation} onChange={(e) => update(i, { designation: e.target.value })} aria-label="Désignation" /></td>
                <td><input className="num" inputMode="decimal" value={l.quantite} onChange={(e) => update(i, { quantite: e.target.value })} aria-label="Quantité" /></td>
                <td><input className="num" inputMode="decimal" value={l.prix} onChange={(e) => update(i, { prix: e.target.value })} aria-label="Prix unitaire HT" /></td>
                <td><input className="num" inputMode="decimal" value={l.remise} onChange={(e) => update(i, { remise: e.target.value })} aria-label="Remise" /></td>
                <td>
                  <select value={l.taux} onChange={(e) => update(i, { taux: e.target.value })} disabled={franchise} aria-label="Taux de TVA">
                    {TAUX_TVA_LIST.map((x) => <option key={x} value={x}>{formatTaux(x)}</option>)}
                  </select>
                </td>
                <td className="num">{t ? <Money cents={t.lignes[i]!.montantHT} /> : "—"}</td>
                <td><button className="btn ghost sm" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} disabled={lignes.length === 1} aria-label="Supprimer la ligne"><Icon.trash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between">
          <button className="btn sm" onClick={() => setLignes((ls) => [...ls, { designation: "", quantite: "1", prix: "", taux: franchise ? "0" : "2000", remise: "" }])}><Icon.plus /> Ajouter une ligne</button>
          {t && <div className="balance-indicator"><span>HT <strong><Money cents={t.totalHT} /></strong></span><span>TVA <strong><Money cents={t.totalTVA} /></strong></span><span>TTC <strong><Money cents={t.totalTTC} /></strong></span></div>}
        </div>
        <div className="form-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={pending || !tiersId || !valid} onClick={submit}>Enregistrer le brouillon</button>
        </div>
      </div>
    </Modal>
  );
}
