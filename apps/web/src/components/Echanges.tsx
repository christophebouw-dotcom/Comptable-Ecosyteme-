import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAction, useApi } from "../lib/hooks";
import { Icon } from "./icons";
import { Badge, DateFr, Empty, ErrorBox, Loading, Money } from "./ui";

export interface Message {
  id: number;
  auteur: string;
  cote: "cabinet" | "client";
  moi: boolean;
  contenu: string;
  createdAt: string;
  lu: boolean;
}

export interface Demande {
  id: number;
  objet: string;
  dateOperation: string | null;
  montant: number | null;
  message: string | null;
  statut: "ouverte" | "repondue" | "close";
  reponse: string | null;
  pieceId: number | null;
  createdAt: string;
  reponduAt: string | null;
}

export const STATUT_DEMANDE: Record<Demande["statut"], { label: string; tone?: "ok" | "warn" | "info" }> = {
  ouverte: { label: "En attente", tone: "warn" },
  repondue: { label: "Répondue", tone: "info" },
  close: { label: "Close", tone: "ok" },
};

/** Fil de discussion chiffré entre le cabinet et le client d'un dossier. */
export function Messagerie({ dossierId, peutEcrire = true, interlocuteur, onLecture }: { dossierId: number; peutEcrire?: boolean; interlocuteur: string; onLecture?: () => void }) {
  const { data, error, loading, reload } = useApi<Message[]>(`/api/dossiers/${dossierId}/messages`);
  // La lecture du fil marque les messages reçus comme lus côté serveur.
  useEffect(() => {
    if (data) onLecture?.();
  }, [data, onLecture]);
  const [texte, setTexte] = useState("");
  const { pending, error: errEnvoi, run } = useAction();
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fin.current?.scrollIntoView({ block: "nearest" });
  }, [data?.length]);
  useEffect(() => {
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const envoyer = () =>
    run(async () => {
      if (!texte.trim()) return;
      await api.post(`/api/dossiers/${dossierId}/messages`, { contenu: texte.trim() });
      setTexte("");
      reload();
    });

  return (
    <div className="messagerie">
      <div className="messagerie-fil" aria-live="polite">
        {loading && !data ? <Loading /> : !data?.length ? (
          <Empty title="Aucun message">Écrivez à {interlocuteur} : les échanges sont chiffrés et conservés dans le dossier.</Empty>
        ) : (
          data.map((m) => (
            <div key={m.id} className={`bulle ${m.moi ? "moi" : ""}`}>
              <div className="bulle-auteur">{m.auteur} · <DateFr iso={m.createdAt} withTime /></div>
              <div className="bulle-texte">{m.contenu}</div>
            </div>
          ))
        )}
        <div ref={fin} />
      </div>
      <ErrorBox error={error ?? errEnvoi} />
      {peutEcrire && (
        <form className="messagerie-saisie" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
          <textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void envoyer(); }}
            placeholder={`Votre message à ${interlocuteur}…`}
            rows={2}
            maxLength={5000}
            aria-label="Message"
          />
          <button className="btn primary" disabled={pending || !texte.trim()}><Icon.message /> Envoyer</button>
        </form>
      )}
    </div>
  );
}

export function DemandeLigne({ d, children }: { d: Demande; children?: ReactNode }) {
  return (
    <li className="demande">
      <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div>
          <strong>{d.objet}</strong>
          <div className="subtle">
            {d.dateOperation && <>Opération du <DateFr iso={d.dateOperation} /> · </>}
            {d.montant != null && <><Money cents={d.montant} signed /> · </>}
            demandé le <DateFr iso={d.createdAt} />
          </div>
          {d.message && <p style={{ marginTop: 4 }}>{d.message}</p>}
          {d.reponse && <p style={{ marginTop: 4 }}><em>Réponse : {d.reponse}</em></p>}
        </div>
        <Badge tone={STATUT_DEMANDE[d.statut].tone}>{STATUT_DEMANDE[d.statut].label}{d.pieceId ? " · pièce jointe" : ""}</Badge>
      </div>
      {children}
    </li>
  );
}
