import { useEffect, useState } from "react";
import { Link } from "react-router";
import { type Demande, DemandeLigne, Messagerie } from "../../components/Echanges";
import { Card, Empty, ErrorBox, Field, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

/** Échanges avec le client : justificatifs demandés et messagerie. */
export function EchangesPage() {
  const { dossier, base, rafraichirEchanges } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const demandes = useApi<Demande[]>(`/api/dossiers/${dossier.id}/demandes`);
  const [objet, setObjet] = useState("");
  const [message, setMessage] = useState("");
  const action = useAction();
  const ecrire = can("compta:write");
  useEffect(() => {
    if (demandes.data) rafraichirEchanges();
  }, [demandes.data, rafraichirEchanges]);
  const ouvertes = (demandes.data ?? []).filter((d) => d.statut !== "close");
  const closes = (demandes.data ?? []).filter((d) => d.statut === "close");

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        {ecrire && (
          <Card title="Demander un document au client" subtitle="Le client le retrouve dans son espace et y répond en déposant le fichier">
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
              await api.post(`/api/dossiers/${dossier.id}/demandes`, { objet, message: message || undefined });
              setObjet(""); setMessage("");
              toast("Demande envoyée au client");
              demandes.reload();
            }); }}>
              <Field label="Document demandé"><input value={objet} onChange={(e) => setObjet(e.target.value)} placeholder="Ex. : Relevé de compte courant d'associé au 31/12" minLength={3} required /></Field>
              <Field label="Précisions (facultatif)"><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} /></Field>
              <ErrorBox error={action.error} />
              <div><button className="btn primary" disabled={action.pending}>Envoyer la demande</button></div>
            </form>
            <p className="subtle" style={{ marginTop: 10 }}>Pour une opération bancaire sans justificatif, utilisez « Demander au client » dans l'onglet <Link to={`${base}/banque`}>Banque</Link>.</p>
          </Card>
        )}
        <Card title={`Demandes en cours (${ouvertes.length})`} padded={false}>
          <ErrorBox error={demandes.error} />
          {demandes.loading && !demandes.data ? <Loading /> : !ouvertes.length ? <Empty title="Aucune demande en cours" /> : (
            <ul className="demandes">
              {ouvertes.map((d) => (
                <DemandeLigne key={d.id} d={d}>
                  {ecrire && (
                    <div className="row" style={{ marginTop: 8 }}>
                      {d.pieceId && <Link className="btn sm" to={`${base}/pieces`}>Traiter la pièce</Link>}
                      <button className="btn ghost sm" onClick={() => action.run(async () => {
                        await api.post(`/api/dossiers/${dossier.id}/demandes/${d.id}/statut`, { statut: "close" });
                        demandes.reload();
                      })}>Clore</button>
                    </div>
                  )}
                </DemandeLigne>
              ))}
            </ul>
          )}
        </Card>
        {closes.length > 0 && (
          <Card title={`Demandes closes (${closes.length})`} padded={false}>
            <ul className="demandes">{closes.slice(0, 20).map((d) => <DemandeLigne key={d.id} d={d} />)}</ul>
          </Card>
        )}
      </div>
      <Card title="Messagerie avec le client" subtitle="Échanges chiffrés, conservés dans le dossier">
        <Messagerie dossierId={dossier.id} peutEcrire={ecrire} interlocuteur="votre client" onLecture={rafraichirEchanges} />
      </Card>
    </div>
  );
}
