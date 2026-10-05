import type { FecControle } from "@compta/core";
import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Badge, Card, DateFr, ErrorBox, Field, Hash } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

export function CloturePage() {
  const { dossier, exercice, reload, setExerciceId } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const [sep, setSep] = useState<"tab" | "pipe">("tab");
  const [encoding, setEncoding] = useState<"latin9" | "utf8">("latin9");
  const [confirmation, setConfirmation] = useState("");
  const [controle, setControle] = useState<(FecControle & { fichier: string }) | null>(null);
  const action = useAction();
  const fecUrl = (exId: number) => `/api/dossiers/${dossier.id}/exercices/${exId}/fec?sep=${sep}&encoding=${encoding}`;

  const controler = async (file: File) => {
    const buf = await file.arrayBuffer();
    // Le FEC peut être en ISO 8859-15 ou en UTF-8 : décodage tolérant.
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (text.includes("�")) text = new TextDecoder("iso-8859-15").decode(buf);
    await action.run(async () => {
      const r = await api.post<FecControle>("/api/fec/controle", { content: text });
      setControle({ ...r, fichier: file.name });
    });
  };

  return (
    <div className="stack">
      <ErrorBox error={action.error} />
      <div className="grid grid-2">
        <Card title="Fichier des Écritures Comptables (FEC)" subtitle="LPF art. L47 A-I et A47 A-1 — à remettre sous 15 jours en cas de contrôle fiscal">
          <div className="stack">
            <div className="form-grid">
              <Field label="Séparateur">
                <select value={sep} onChange={(e) => setSep(e.target.value as "tab" | "pipe")}>
                  <option value="tab">Tabulation</option>
                  <option value="pipe">Barre verticale « | »</option>
                </select>
              </Field>
              <Field label="Encodage">
                <select value={encoding} onChange={(e) => setEncoding(e.target.value as "latin9" | "utf8")}>
                  <option value="latin9">ISO 8859-15</option>
                  <option value="utf8">UTF-8</option>
                </select>
              </Field>
            </div>
            <table>
              <thead><tr><th>Exercice</th><th>Statut</th><th /></tr></thead>
              <tbody>
                {dossier.exercices.map((e) => (
                  <tr key={e.id}>
                    <td><DateFr iso={e.debut} /> → <DateFr iso={e.fin} /></td>
                    <td>{e.statut === "cloture" ? <Badge tone="info"><Icon.lock /> Clôturé</Badge> : <Badge tone="ok">Ouvert</Badge>}</td>
                    <td className="actions"><a className="btn sm" href={fecUrl(e.id)} download><Icon.download /> FEC</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="subtle">Seules les écritures validées figurent au FEC, dans l'ordre chronologique de validation. Chaque export est tracé au journal d'audit.</p>
          </div>
        </Card>

        <Card title="Contrôler un FEC" subtitle="Vérification de structure et de cohérence (équivalent simplifié de Test Compta Demat)">
          <div className="stack">
            <input type="file" accept=".txt,.csv,text/plain" onChange={(e) => e.target.files?.[0] && void controler(e.target.files[0])} aria-label="Fichier FEC à contrôler" />
            {controle && (
              <>
                {controle.valide ? (
                  <Alert tone="ok" title={`${controle.fichier} : aucune anomalie`}>{controle.nbLignes} lignes, {controle.nbEcritures} écritures, total débit = total crédit.</Alert>
                ) : (
                  <Alert tone="danger" title={`${controle.fichier} : ${controle.anomalies.length} anomalie(s)`}>
                    <ul>{controle.anomalies.slice(0, 30).map((a, i) => <li key={i}>{a.ligne ? `Ligne ${a.ligne}` : "Fichier"}{a.zone ? ` (${a.zone})` : ""} : {a.message}</li>)}</ul>
                  </Alert>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      <Card title="Clôture de l'exercice" subtitle={`${exercice.debut} → ${exercice.fin}`}>
        {exercice.statut === "cloture" ? (
          <div className="stack">
            <Alert tone="ok" title="Exercice clôturé">
              Clôturé le <DateFr iso={exercice.cloture_at} withTime />. Aucune écriture ne peut plus y être enregistrée (verrou en base de données).
            </Alert>
            <div><span className="subtle">Empreinte de clôture (SHA-256 de la chaîne des écritures) : </span><Hash value={exercice.empreinte_cloture} /></div>
          </div>
        ) : !can("compta:cloture") ? (
          <Alert tone="info">La clôture est réservée aux experts-comptables.</Alert>
        ) : (
          <div className="stack">
            <Alert tone="warn" title="Opération irréversible">
              <ul>
                <li>Toutes les écritures de l'exercice doivent être validées et la balance équilibrée.</li>
                <li>L'intégrité de la chaîne d'empreintes est vérifiée, puis une empreinte de clôture est calculée.</li>
                <li>L'exercice suivant est ouvert et les à-nouveaux (classes 1 à 5, résultat en 120/129) y sont reportés et validés.</li>
                <li>Plus aucune écriture ne pourra être ajoutée à l'exercice clôturé.</li>
              </ul>
            </Alert>
            <div className="row">
              <Field label="Saisissez CLOTURER pour confirmer"><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} style={{ width: 220 }} /></Field>
              <button
                className="btn primary"
                style={{ alignSelf: "flex-end" }}
                disabled={confirmation !== "CLOTURER" || action.pending}
                onClick={() =>
                  action.run(async () => {
                    const r = await api.post<{ nouvelExerciceId: number }>(`/api/dossiers/${dossier.id}/exercices/${exercice.id}/cloture`, { confirmation });
                    toast("Exercice clôturé — à-nouveaux reportés sur l'exercice suivant");
                    setConfirmation("");
                    reload();
                    setExerciceId(r.nouvelExerciceId);
                  })
                }
              >
                <Icon.lock /> Clôturer l'exercice
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
