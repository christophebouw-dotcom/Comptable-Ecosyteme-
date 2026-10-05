import { type ExtractionPiece, type Facture, generateFacturX } from "@compta/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AssistantIA, ErreurIA } from "../src/services/ia.js";
import { type Client, DOSSIER, type TestEnv, setup } from "./helpers.js";

/** Assistant factice : renvoie l'extraction programmée et compte les appels. */
class FakeIA implements AssistantIA {
  readonly modele = "fake-model";
  appels = 0;
  prochaine: ExtractionPiece | Error | null = null;
  async extrairePiece() {
    this.appels++;
    const r = this.prochaine;
    if (r instanceof Error) throw r;
    return { extraction: r!, usage: { modele: this.modele, tokensEntree: 1000, tokensSortie: 200 } };
  }
  async suggererImputations(lignes: { id: number }[]) {
    this.appels++;
    return {
      suggestions: [
        { id: lignes[0]!.id, compte: "626", compteAux: null, confiance: 0.9, justification: "Télécoms" },
        { id: 999_999, compte: "626", compteAux: null, confiance: 0.9, justification: "id inconnu, filtré" },
      ],
      usage: { modele: this.modele, tokensEntree: 500, tokensSortie: 100 },
    };
  }
}

const facture = (over: Partial<ExtractionPiece> = {}): ExtractionPiece => ({
  typeDocument: "facture_achat",
  emetteur: { nom: "Moulins de Beauce", siren: "775672272", tvaIntra: "FR20775672272", adresse: "Chartres", iban: "FR7630006000011234567890189" },
  destinataire: { nom: "Boulangerie Martin SARL", siren: "404833048", tvaIntra: null, adresse: null, iban: null },
  numero: "FA-777",
  dateFacture: "2026-06-10",
  dateEcheance: "2026-07-10",
  devise: "EUR",
  lignes: [{ designation: "Farine", montantHT: 100_000, tauxTvaBp: 550 }],
  ventilationTva: [{ tauxBp: 550, baseHT: 100_000, tva: 5_500 }],
  totalHT: 100_000,
  totalTVA: 5_500,
  totalTTC: 105_500,
  compteSuggere: "607",
  justificationCompte: "Marchandises",
  confiance: 0.97,
  remarques: [],
  source: "ia",
  ...over,
});

const PDF = (n: number) => Buffer.from(`%PDF-1.7\n% facture ${n}\n%%EOF`).toString("base64");

let env: TestEnv;
let expert: Client;
let collab: Client;
let ia: FakeIA;
let dossierId: number;
const base = () => `/api/dossiers/${dossierId}`;

beforeAll(async () => {
  ia = new FakeIA();
  env = await setup({ ia });
  expert = await env.as(env.users.expert);
  collab = await env.as(env.users.collab);
  dossierId = (await expert.req("POST", "/api/dossiers", DOSSIER)).body.id;
  const collabId = env.ctx.db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", env.users.collab)!.id;
  await (await env.as(env.users.admin)).req("PATCH", `/api/users/${collabId}`, { dossiers: [dossierId] });
  // Fournisseur connu, déjà imputé en 601 par le passé (habitude du dossier).
  await collab.req("POST", `${base()}/tiers`, { type: "fournisseur", compteAux: "FMOULIN", nom: "Moulins de Beauce SAS", siren: "775672272" });
  await collab.req("POST", `${base()}/ecritures`, {
    journal: "AC", date: "2026-02-01", libelle: "Farine", pieceRef: "OLD1",
    lignes: [{ compte: "601", debit: 1000 }, { compte: "401", compteAux: "FMOULIN", credit: 1000 }],
  });
});
afterAll(() => env.app.close());

describe("dépôt de pièces et IA", () => {
  it("n'envoie rien à l'IA tant que le dossier ne l'autorise pas", async () => {
    ia.prochaine = facture();
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "fa-1.pdf", mime: "application/pdf", contenuBase64: PDF(1) });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe("a_traiter");
    expect(ia.appels).toBe(0);
    expect((await collab.req("PUT", `${base()}/ia`, { autorisee: true })).status).toBe(403);
    expect((await expert.req("PUT", `${base()}/ia`, { autorisee: true })).status).toBe(200);
  });

  it("refuse un fichier dont le contenu ne correspond pas au type, et les doublons", async () => {
    const faux = await collab.req("POST", `${base()}/pieces`, { nomFichier: "x.pdf", mime: "application/pdf", contenuBase64: Buffer.from("MZ binaire").toString("base64") });
    expect(faux.status).toBe(422);
    const dbl = await collab.req("POST", `${base()}/pieces`, { nomFichier: "copie.pdf", mime: "application/pdf", contenuBase64: PDF(1) });
    expect(dbl.status).toBe(409);
  });

  it("lit une facture, retrouve le fournisseur et privilégie l'imputation habituelle", async () => {
    ia.prochaine = facture();
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "fa-2.pdf", mime: "application/pdf", contenuBase64: PDF(2) });
    expect(r.body).toMatchObject({ statut: "a_valider", source: "ia", iaModele: "fake-model" });
    expect(r.body.analyse.tiers).toMatchObject({ methode: "siren", compteAux: "FMOULIN" });
    expect(r.body.analyse.compte).toMatchObject({ numero: "601", origine: "habitude" });
    expect(r.body.analyse.controles.filter((c: { niveau: string }) => c.niveau === "bloquant")).toEqual([]);
    expect(r.body.analyse.ecriture.lignes.at(-1)).toMatchObject({ compte: "401", compteAux: "FMOULIN", credit: 105_500 });

    // Le fichier est stocké chiffré mais restitué à l'identique.
    const row = env.ctx.db.get<{ contenu_enc: string }>("SELECT contenu_enc FROM pieces WHERE id = ?", r.body.id)!;
    expect(row.contenu_enc).toMatch(/^v1\./);
    const f = await env.app.inject({ method: "GET", url: `${base()}/pieces/${r.body.id}/fichier`, headers: { cookie: collab.cookie } });
    expect(f.rawPayload.toString("base64")).toBe(PDF(2));

    const c = await collab.req("POST", `${base()}/pieces/${r.body.id}/comptabiliser`, { compte: "601", compteAux: "FMOULIN" });
    expect(c.status).toBe(201);
    expect(c.body.ecriture).toMatchObject({ journal: "AC", statut: "brouillard", pieceRef: "FA-777" });
    expect((await collab.req("DELETE", `${base()}/pieces/${r.body.id}`)).status).toBe(409);

    // Supprimer le brouillard rend la pièce à nouveau « à valider ».
    expect((await collab.req("DELETE", `${base()}/ecritures/${c.body.ecritureId}`)).status).toBe(200);
    expect((await collab.req("GET", `${base()}/pieces/${r.body.id}`)).body.statut).toBe("a_valider");
  });

  it("crée le fournisseur inconnu à la comptabilisation (IBAN chiffré)", async () => {
    ia.prochaine = facture({ emetteur: { nom: "Imprimerie Nouvelle", siren: "552100554", tvaIntra: null, adresse: "Lyon", iban: "FR7630006000011234567890189" }, compteSuggere: "6064", numero: "IMP-1" });
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "imp.pdf", mime: "application/pdf", contenuBase64: PDF(3) });
    expect(r.body.analyse.tiers).toMatchObject({ existant: null, compteAux: "FIMPRIMERIENO" });
    expect(r.body.analyse.compte).toMatchObject({ numero: "6064", origine: "ia" });
    const c = await collab.req("POST", `${base()}/pieces/${r.body.id}/comptabiliser`, { compte: "6064", compteAux: "FIMPRIMERIENO" });
    expect(c.body.tiersCree).toBe(true);
    const t = env.ctx.db.get<{ siren: string; iban_enc: string }>("SELECT siren, iban_enc FROM tiers WHERE compte_aux = 'FIMPRIMERIENO'")!;
    expect(t.siren).toBe("552100554");
    expect(t.iban_enc).toMatch(/^v1\./);
  });

  it("bloque une lecture incohérente puis accepte la correction humaine", async () => {
    ia.prochaine = facture({ totalTTC: 999_999, numero: "BAD-1" });
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "bad.pdf", mime: "application/pdf", contenuBase64: PDF(4) });
    expect(r.body.analyse.controles.map((c: { code: string }) => c.code)).toContain("TOTAUX");
    expect(r.body.analyse.ecriture).toBeNull();
    expect((await collab.req("POST", `${base()}/pieces/${r.body.id}/comptabiliser`, { compte: "601", compteAux: "FMOULIN" })).status).toBe(422);
    const corr = await collab.req("PUT", `${base()}/pieces/${r.body.id}/extraction`, { ...r.body.extraction, totalTTC: 105_500 });
    expect(corr.body.analyse.ecriture).not.toBeNull();
    expect((await collab.req("POST", `${base()}/pieces/${r.body.id}/comptabiliser`, { compte: "601", compteAux: "FMOULIN" })).status).toBe(201);
  });

  it("consigne une erreur du service d'IA sans perdre la pièce", async () => {
    ia.prochaine = new ErreurIA("Service d'IA momentanément saturé");
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "err.jpg", mime: "image/jpeg", contenuBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64") });
    expect(r.body).toMatchObject({ statut: "erreur", erreur: "Service d'IA momentanément saturé" });
    ia.prochaine = facture({ numero: "RETRY-1" });
    expect((await collab.req("POST", `${base()}/pieces/${r.body.id}/relire`)).body.statut).toBe("a_valider");
  });

  it("lit une facture électronique Factur-X exactement, sans IA", async () => {
    const avant = ia.appels;
    const f: Facture = {
      type: "facture", numero: "EDF-2026-06", dateEmission: "2026-06-30", dateEcheance: "2026-07-15", categorie: "services",
      vendeur: { nom: "EDF Entreprises", adresse: "Paris", codePostal: "75008", ville: "Paris", pays: "FR", siren: "552081317", tvaIntra: "FR03552081317" },
      acheteur: { nom: "Boulangerie Martin", adresse: "12 rue du Four", codePostal: "75006", ville: "Paris", pays: "FR", siren: "404833048", professionnel: true },
      lignes: [{ designation: "Électricité juin", quantite: 1, prixUnitaireHT: 45_000, tauxTvaBp: 2000 }],
    };
    const xml = Buffer.from(generateFacturX(f)).toString("base64");
    const r = await collab.req("POST", `${base()}/pieces`, { nomFichier: "edf.xml", mime: "application/xml", contenuBase64: xml });
    expect(r.body).toMatchObject({ statut: "a_valider", source: "facturx" });
    expect(r.body.extraction).toMatchObject({ totalHT: 45_000, totalTVA: 9_000, totalTTC: 54_000, confiance: 1 });
    expect(ia.appels).toBe(avant);
  });

  it("propose des imputations bancaires et écarte les réponses invalides", async () => {
    await collab.req("POST", `${base()}/banque/import`, { format: "csv", content: "Date;Libellé;Montant\n05/06/2026;PRLV ORANGE PRO;-59,90\n" });
    const r = await collab.req("POST", `${base()}/banque/suggestions-ia`, {});
    expect(r.status).toBe(200);
    expect(r.body.suggestions).toHaveLength(1);
    expect(r.body.suggestions[0]).toMatchObject({ compte: "626" });
  });

  it("trace chaque appel à l'IA au journal d'audit, sans le contenu", async () => {
    const logs = env.ctx.audit.list({ action: "ia.", limit: 100 });
    expect(logs.length).toBeGreaterThanOrEqual(5);
    expect(logs[0]!.details).toHaveProperty("modele", "fake-model");
    expect(JSON.stringify(logs)).not.toContain("Farine");
  });
});
