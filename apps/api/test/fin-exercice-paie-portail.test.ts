import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RgpdService } from "../src/services/rgpd.js";
import { type Client, DOSSIER, type TestEnv, setup } from "./helpers.js";

let env: TestEnv;
let expert: Client;
let collab: Client;
let client: Client;
let dossierId: number;
let exerciceId: number;
const base = () => `/api/dossiers/${dossierId}`;
const PDF = Buffer.from("%PDF-1.4\n% justificatif\n").toString("base64");

const ecriture = async (e: object) => {
  const r = await collab.req("POST", `${base()}/ecritures`, e);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await expert.req("POST", `${base()}/ecritures/valider`, { ids: [r.body.id] });
  return r.body.id as number;
};

beforeAll(async () => {
  env = await setup();
  expert = await env.as(env.users.expert);
  collab = await env.as(env.users.collab);
  client = await env.as(env.users.client);
  dossierId = (await expert.req("POST", "/api/dossiers", DOSSIER)).body.id;
  exerciceId = (await expert.req("GET", base())).body.exercices[0].id;
  const admin = await env.as(env.users.admin);
  for (const email of [env.users.collab, env.users.client]) {
    const id = env.ctx.db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", email)!.id;
    await admin.req("PATCH", `/api/users/${id}`, { dossiers: [dossierId] });
  }
});
afterAll(() => env.app.close());

describe("écritures d'inventaire", () => {
  it("propose une FNP pour un fournisseur mensuel, la comptabilise et refuse les doublons de suggestion", async () => {
    for (const m of ["09", "10", "11"]) {
      await ecriture({
        journal: "AC", date: `2026-${m}-25`, libelle: `Électricité ${m}`, pieceRef: `EDF-${m}`,
        lignes: [{ compte: "6061", debit: 40_000 }, { compte: "44566", debit: 8_000, tauxTva: 2000 }, { compte: "401", compteAux: "FEDF", credit: 48_000 }],
      });
    }
    const r = await collab.req("GET", `${base()}/regularisations?exerciceId=${exerciceId}`);
    expect(r.status).toBe(200);
    const s = r.body.suggestions.find((x: { type: string }) => x.type === "fnp");
    expect(s).toMatchObject({ compte: "6061", montantHT: 40_000, tauxTvaBp: 2000, compteContrepartie: "408" });

    const cree = await collab.req("POST", `${base()}/regularisations`, { exerciceId, ...s });
    expect(cree.status).toBe(201);
    const e = (await collab.req("GET", `${base()}/ecritures/${cree.body.ecritureId}`)).body;
    expect(e).toMatchObject({ journal: "OD", date: "2026-12-31", statut: "brouillard" });
    expect(e.lignes.map((l: { compte: string; debit: number; credit: number }) => [l.compte, l.debit, l.credit])).toEqual([
      ["6061", 40_000, 0], ["44586", 8_000, 0], ["408", 0, 48_000],
    ]);
    const apres = (await collab.req("GET", `${base()}/regularisations?exerciceId=${exerciceId}`)).body;
    expect(apres.suggestions.find((x: { type: string }) => x.type === "fnp")).toBeUndefined();
    expect(apres.impactResultat).toBe(-40_000);
  });

  it("calcule une CCA au prorata, refuse une période déjà échue et supprime le brouillard avec la régularisation", async () => {
    const cca = await collab.req("POST", `${base()}/regularisations`, {
      exerciceId, type: "cca", libelle: "Assurance multirisque", compte: "616", montantHT: 120_000, periode: { debut: "2026-10-01", fin: "2027-09-30" },
    });
    expect(cca.status).toBe(201);
    expect(cca.body.montant).toBe(Math.round((120_000 * 273) / 365));
    const ko = await collab.req("POST", `${base()}/regularisations`, {
      exerciceId, type: "cca", libelle: "Loyer", compte: "613", montantHT: 10_000, periode: { debut: "2026-01-01", fin: "2026-06-30" },
    });
    expect(ko.status).toBe(422);
    const tmp = await collab.req("POST", `${base()}/regularisations`, { exerciceId, type: "cap", libelle: "Prime annuelle", compte: "6413", montantHT: 50_000 });
    expect((await collab.req("DELETE", `${base()}/regularisations/${tmp.body.id}`)).status).toBe(200);
    expect(env.ctx.db.get("SELECT 1 FROM ecritures WHERE id = ?", tmp.body.ecritureId)).toBeUndefined();
    // Le client ne peut pas saisir de régularisation.
    expect((await client.req("POST", `${base()}/regularisations`, { exerciceId, type: "cap", libelle: "x", compte: "6413", montantHT: 1 })).status).toBe(403);
  });
});

describe("paie", () => {
  let salarieId: number;
  it("crée un salarié avec NIR contrôlé, chiffré et masqué", async () => {
    const corps = "1850775123456";
    const nir = `${corps}${String(97 - Number(BigInt(corps) % 97n)).padStart(2, "0")}`;
    const bad = await collab.req("POST", `${base()}/paie/salaries`, {
      matricule: "S1", nom: "Durand", prenom: "Alice", nir: `${corps}00`, emploi: "Vendeuse", statut: "non_cadre", dateEntree: "2026-01-01", salaireBase: 200_000, tauxPas: 3,
    });
    expect(bad.status).toBe(422);
    const r = await collab.req("POST", `${base()}/paie/salaries`, {
      matricule: "S1", nom: "Durand", prenom: "Alice", nir, emploi: "Vendeuse", statut: "non_cadre", dateEntree: "2026-01-01",
      salaireBase: 200_000, tauxPas: 3, mutuelleSalarie: 2_000, mutuelleEmployeur: 2_000, email: "alice.durand@exemple.fr",
    });
    expect(r.status).toBe(201);
    salarieId = r.body.id;
    const row = env.ctx.db.get<{ nir_enc: string; nom_enc: string; profil: string }>("SELECT nir_enc, nom_enc, profil FROM salaries WHERE id = ?", salarieId)!;
    expect(row.nir_enc).not.toContain(corps);
    expect(row.nom_enc).not.toContain("Durand");
    expect(row.profil).not.toContain("200000");
    const liste = (await collab.req("GET", `${base()}/paie?periode=2026-03`)).body;
    expect(liste.salaries[0]).toMatchObject({ nom: "Durand", nirMasque: expect.stringMatching(/^1 85 ••/), salaireBase: 200_000 });
    expect(JSON.stringify(liste)).not.toContain(nir);
  });

  it("prépare, valide et fige un bulletin, puis génère l'écriture de paie", async () => {
    const prep = await collab.req("POST", `${base()}/paie/bulletins`, { salarieId, periode: "2026-03", variables: { heuresSup25: 4, primes: 10_000 } });
    expect(prep.status).toBe(201);
    expect(prep.body.bulletin.brut).toBeGreaterThan(210_000);
    const id = prep.body.id;
    expect((await collab.req("POST", `${base()}/paie/bulletins`, { salarieId, periode: "2025-12", variables: {} })).status).toBe(422);
    const val = await collab.req("POST", `${base()}/paie/bulletins/${id}/valider`, {});
    expect(val.status).toBe(200);
    expect(val.body.hash).toMatch(/^[0-9a-f]{64}$/);
    const e = (await collab.req("GET", `${base()}/ecritures/${val.body.ecritureId}`)).body;
    expect(e).toMatchObject({ journal: "PA", date: "2026-03-31", pieceRef: "PAIE-202603-S1" });
    expect(e.libelle).not.toContain("Durand");
    const net = e.lignes.find((l: { compte: string }) => l.compte === "421").credit;
    expect(net).toBe(prep.body.bulletin.netAPayer);
    // Intangibilité : ni recalcul, ni suppression, y compris directement en base.
    expect((await collab.req("POST", `${base()}/paie/bulletins`, { salarieId, periode: "2026-03", variables: {} })).status).toBe(409);
    expect((await collab.req("DELETE", `${base()}/paie/bulletins/${id}`)).status).toBe(409);
    expect(() => env.ctx.db.run("UPDATE bulletins SET net_a_payer = 1 WHERE id = ?", id)).toThrow(/interdite/);
    const detail = (await client.req("GET", `${base()}/paie/bulletins/${id}`)).body;
    expect(detail.salarie).toMatchObject({ nom: "Durand", nirMasque: expect.any(String) });
    expect(detail.bulletin.lignes.length).toBeGreaterThan(10);
    // Le client consulte mais ne gère pas la paie.
    expect((await client.req("POST", `${base()}/paie/salaries`, {})).status).toBe(403);
    const recap = (await collab.req("GET", `${base()}/paie?periode=2026-03`)).body;
    expect(recap.totaux.netAPayer).toBe(prep.body.bulletin.netAPayer);
    expect(recap.recapitulatif.map((r: { organisme: string }) => r.organisme)).toEqual(expect.arrayContaining(["urssaf", "retraite", "mutuelle"]));
  });
});

describe("paie et RGPD", () => {
  it("inclut le salarié dans le droit d'accès et conserve la paie lors d'un effacement", () => {
    const rgpd = new RgpdService(env.ctx);
    const exp = rgpd.exportPersonne("alice.durand@exemple.fr");
    expect(exp.salarie).toEqual([expect.objectContaining({ nom: "Durand", matricule: "S1", bulletins: [expect.objectContaining({ periode: "2026-03" })] })]);
    expect(JSON.stringify(exp)).not.toMatch(/18507751234\d{4}/);
    const decisions = rgpd.analyserEffacement("alice.durand@exemple.fr");
    expect(decisions.find((d) => d.categorie === "bulletins_paie")?.decision).toBe("conserver_limiter");
    const res = rgpd.executerEffacement("alice.durand@exemple.fr");
    expect(res.actions.join()).toContain("dossier de paie conservé");
    const s = env.ctx.db.get<{ email_hash: string | null; anonymized_at: string | null }>("SELECT email_hash, anonymized_at FROM salaries WHERE matricule = 'S1'")!;
    expect(s).toEqual({ email_hash: null, anonymized_at: null });
    // La purge ne touche pas un bulletin de moins de 5 ans.
    expect(rgpd.purger(true).rapport.find((r) => r.categorie === "bulletins_paie")?.nombre).toBe(0);
  });
});

describe("portail client", () => {
  let demandeId: number;
  it("le cabinet demande un justificatif pour une opération bancaire", async () => {
    await collab.req("POST", `${base()}/banque/import`, { format: "csv", content: "Date;Libellé;Montant\n14/04/2026;CB AMAZON MARKETPLACE;-89,90\n" });
    const ligne = env.ctx.db.get<{ id: number }>("SELECT id FROM lignes_bancaires WHERE dossier_id = ?", dossierId)!;
    const d = await collab.req("POST", `${base()}/demandes`, { lignesBancaires: [ligne.id], message: "Merci de déposer la facture." });
    expect(d.status).toBe(201);
    demandeId = d.body.ids[0];
    // Idempotent : pas de seconde demande ouverte pour la même opération.
    expect((await collab.req("POST", `${base()}/demandes`, { lignesBancaires: [ligne.id] })).body.ids).toEqual([demandeId]);
  });

  it("le client voit son tableau de bord et ses demandes, sans accès aux autres dossiers", async () => {
    const liste = await client.req("GET", "/api/portail/dossiers");
    expect(liste.body).toEqual([expect.objectContaining({ id: dossierId, demandesOuvertes: 1 })]);
    const tdb = (await client.req("GET", `/api/portail/dossiers/${dossierId}`)).body;
    expect(tdb.indicateurs).toMatchObject({ dettesFournisseurs: expect.any(Number), tresorerie: expect.any(Number) });
    expect(tdb.caMensuel).toHaveLength(12);
    expect(tdb.demandesOuvertes).toBe(1);
    const autre = (await expert.req("POST", "/api/dossiers", { ...DOSSIER, siren: "552100554", raisonSociale: "Autre SAS" })).body.id;
    expect((await client.req("GET", `/api/portail/dossiers/${autre}`)).status).toBe(404);
    expect((await client.req("GET", `/api/dossiers/${autre}/messages`)).status).toBe(404);
    // Aucune information de vigilance LCB-FT n'est communiquée au client (CMF L561-18).
    expect((await client.req("GET", `${base()}/mission`)).status).toBe(403);
    expect((await client.req("GET", "/api/dossiers")).body[0].alertesMission).toEqual([]);
    // Le cabinet n'utilise pas les routes du portail.
    expect((await collab.req("GET", "/api/portail/dossiers")).status).toBe(403);
  });

  it("le client répond par un dépôt de pièce, signalé au cabinet", async () => {
    const r = await client.req("POST", `/api/portail/dossiers/${dossierId}/pieces`, { nomFichier: "amazon.pdf", mime: "application/pdf", contenuBase64: PDF, demandeId });
    expect(r.status).toBe(201);
    expect(r.body.statutLibelle).toBe("Reçue");
    const demandes = (await collab.req("GET", `${base()}/demandes`)).body;
    expect(demandes[0]).toMatchObject({ id: demandeId, statut: "repondue", pieceId: r.body.id });
    const piece = env.ctx.db.get<{ deposee_par_client: number }>("SELECT deposee_par_client FROM pieces WHERE id = ?", r.body.id)!;
    expect(piece.deposee_par_client).toBe(1);
    const aTraiter = (await collab.req("GET", "/api/echanges/a-traiter")).body;
    expect(aTraiter).toEqual([expect.objectContaining({ dossierId, demandesRepondues: 1, piecesClient: 1 })]);
    const docs = (await client.req("GET", `/api/portail/dossiers/${dossierId}/documents`)).body;
    expect(docs.pieces[0]).toMatchObject({ nomFichier: "amazon.pdf", deposeeParClient: true });
    expect(docs.bulletins[0]).toMatchObject({ periode: "2026-03", salarie: "Alice Durand" });
    // Le client ne peut pas comptabiliser ni supprimer.
    expect((await client.req("DELETE", `${base()}/pieces/${r.body.id}`)).status).toBe(403);
  });

  it("échange des messages chiffrés et suit les messages non lus", async () => {
    expect((await client.req("POST", `${base()}/messages`, { contenu: "Bonjour, la facture est déposée." })).status).toBe(201);
    const row = env.ctx.db.get<{ contenu_enc: string }>("SELECT contenu_enc FROM messages ORDER BY id DESC LIMIT 1")!;
    expect(row.contenu_enc).not.toContain("facture");
    expect((await collab.req("GET", "/api/echanges/a-traiter")).body[0].messagesNonLus).toBe(1);
    const fil = (await collab.req("GET", `${base()}/messages`)).body;
    expect(fil).toEqual([expect.objectContaining({ cote: "client", contenu: "Bonjour, la facture est déposée.", moi: false })]);
    expect((await collab.req("GET", "/api/echanges/a-traiter")).body[0].messagesNonLus).toBe(0);
    await collab.req("POST", `${base()}/messages`, { contenu: "Merci, bien reçu." });
    expect((await client.req("GET", "/api/portail/dossiers")).body[0].messagesNonLus).toBe(1);
    // Le contenu des messages n'apparaît pas dans le journal d'audit.
    const audit = env.ctx.db.all<{ details: string | null }>("SELECT details FROM audit_log WHERE action = 'message.envoye'");
    expect(audit.map((a) => a.details ?? "").join()).not.toContain("Merci");
    // Le DPO n'a pas accès aux échanges du dossier.
    const dpo = await env.as(env.users.dpo);
    expect((await dpo.req("GET", `${base()}/messages`)).status).toBe(403);
  });

  it("clôture la demande et le client ne peut plus y répondre", async () => {
    expect((await collab.req("POST", `${base()}/demandes/${demandeId}/statut`, { statut: "close" })).status).toBe(200);
    expect((await client.req("POST", `${base()}/demandes/${demandeId}/repondre`, { reponse: "Encore moi" })).status).toBe(409);
  });
});

describe("extournes à l'ouverture", () => {
  it("extourne les régularisations validées au premier jour de l'exercice suivant", async () => {
    const brouillards = env.ctx.db.all<{ id: number }>("SELECT id FROM ecritures WHERE dossier_id = ? AND statut = 'brouillard'", dossierId).map((r) => r.id);
    expect((await expert.req("POST", `${base()}/ecritures/valider`, { ids: brouillards })).status).toBe(200);
    const cl = await expert.req("POST", `${base()}/exercices/${exerciceId}/cloture`, { confirmation: "CLOTURER" });
    expect(cl.status).toBe(200);
    const suivant = cl.body.nouvelExerciceId;
    const avant = (await collab.req("GET", `${base()}/regularisations?exerciceId=${suivant}`)).body;
    expect(avant.aExtourner).toHaveLength(2);
    const ext = await collab.req("POST", `${base()}/regularisations/extournes`, { exerciceId: suivant });
    expect(ext.body).toEqual({ extournes: 2, nonValidees: 0 });
    const ecr = (await collab.req("GET", `${base()}/ecritures?exerciceId=${suivant}&journal=OD`)).body;
    const fnp = ecr.find((e: { libelle: string }) => e.libelle.startsWith("Extourne : Facture non parvenue"));
    expect(fnp).toMatchObject({ date: "2027-01-01" });
    expect(fnp.lignes.find((l: { compte: string }) => l.compte === "408").debit).toBe(48_000);
    expect((await collab.req("GET", `${base()}/regularisations?exerciceId=${suivant}`)).body.aExtourner).toHaveLength(0);
  });
});
