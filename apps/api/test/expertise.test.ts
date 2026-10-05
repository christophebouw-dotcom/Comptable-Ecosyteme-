import { generateFec } from "@compta/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, DOSSIER, type TestEnv, setup } from "./helpers.js";

let env: TestEnv;
let expert: Client;
let collab: Client;
let dossierId: number;
let exerciceId: number;
const base = () => `/api/dossiers/${dossierId}`;

const ecriture = async (c: Client, e: object, valider = true) => {
  const r = await c.req("POST", `${base()}/ecritures`, e);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  if (valider) await expert.req("POST", `${base()}/ecritures/valider`, { ids: [r.body.id] });
  return r.body;
};

beforeAll(async () => {
  env = await setup();
  expert = await env.as(env.users.expert);
  collab = await env.as(env.users.collab);
  const d = await expert.req("POST", "/api/dossiers", DOSSIER);
  dossierId = d.body.id;
  exerciceId = (await expert.req("GET", base())).body.exercices[0].id;
  const collabId = env.ctx.db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", env.users.collab)!.id;
  await (await env.as(env.users.admin)).req("PATCH", `/api/users/${collabId}`, { dossiers: [dossierId] });
});
afterAll(() => env.app.close());

describe("immobilisations", () => {
  it("calcule la dotation de l'exercice et génère l'écriture", async () => {
    const r = await collab.req("POST", `${base()}/immobilisations`, {
      compte: "2183", libelle: "Ordinateurs", dateMiseEnService: "2026-04-01", valeurHT: 300_000, dureeAnnees: 3, mode: "lineaire",
    });
    expect(r.status).toBe(201);
    expect((await collab.req("POST", `${base()}/immobilisations`, { compte: "2183", libelle: "x", dateMiseEnService: "2026-01-01", valeurHT: 1000, dureeAnnees: 2, mode: "degressif" })).status).toBe(422);
    const list = await collab.req("GET", `${base()}/immobilisations?exerciceId=${exerciceId}`);
    expect(list.body.immobilisations[0]).toMatchObject({ dotation: 75_000, vncFin: 225_000, compteAmortissement: "28183" });
    expect(list.body.immobilisations[0].plan).toHaveLength(4);
    const dot = await collab.req("POST", `${base()}/immobilisations/dotations`, { exerciceId });
    expect(dot.status).toBe(201);
    expect(dot.body.lignes).toEqual(expect.arrayContaining([expect.objectContaining({ compte: "28183", credit: 75_000 })]));
    expect((await collab.req("POST", `${base()}/immobilisations/dotations`, { exerciceId })).status).toBe(409);
  });
});

describe("banque", () => {
  it("importe un relevé sans doublon, rapproche et affecte", async () => {
    await ecriture(collab, {
      journal: "BQ", date: "2026-03-10", libelle: "Règlement client Durand", pieceRef: "CHQ1",
      lignes: [{ compte: "512", debit: 50_000 }, { compte: "411", compteAux: "CDURAND", credit: 50_000 }],
    });
    const csv = "Date;Libellé;Montant\n12/03/2026;REMISE CHEQUE DURAND;500,00\n15/03/2026;PRLV SEPA URSSAF IDF;-1 200,00\n20/03/2026;CB BOULANGERIE DU COIN;-12,50\n";
    const imp = await collab.req("POST", `${base()}/banque/import`, { format: "csv", content: csv, fichier: "mars.csv" });
    expect(imp.body).toMatchObject({ importees: 3, doublons: 0 });
    expect((await collab.req("POST", `${base()}/banque/import`, { format: "csv", content: csv })).body).toMatchObject({ importees: 0, doublons: 3 });

    const auto = await collab.req("POST", `${base()}/banque/rapprochement-auto`, {});
    expect(auto.body).toEqual({ rapprochees: 1, restantes: 2 });

    let banque = await collab.req("GET", `${base()}/banque`);
    const urssaf = banque.body.lignes.find((l: { libelle: string }) => l.libelle.includes("URSSAF"));
    expect(urssaf.suggestion.compte).toBe("431");
    const aff = await collab.req("POST", `${base()}/banque/lignes/${urssaf.id}/affecter`, { compte: "431" });
    expect(aff.status).toBe(201);
    expect(aff.body.lignes[0]).toMatchObject({ compte: "512", credit: 120_000 });

    const boul = banque.body.lignes.find((l: { libelle: string }) => l.libelle.includes("BOULANGERIE"));
    await collab.req("POST", `${base()}/banque/lignes/${boul.id}/affecter`, { compte: "625", memoriser: true });
    banque = await collab.req("GET", `${base()}/banque`);
    expect(banque.body.regles).toEqual([{ motif: "boulangerie coin", compte: "625", compteAux: null }]);
    expect(banque.body.etat.nbATraiter).toBe(0);

    // Supprimer le brouillard libère la ligne de relevé (trigger).
    await collab.req("DELETE", `${base()}/ecritures/${aff.body.id}`);
    banque = await collab.req("GET", `${base()}/banque`);
    expect(banque.body.etat.nbATraiter).toBe(1);
  });

  it("exige le compte auxiliaire pour un tiers", async () => {
    const banque = await collab.req("GET", `${base()}/banque`);
    const l = banque.body.lignes.find((x: { statut: string }) => x.statut === "a_traiter");
    expect((await collab.req("POST", `${base()}/banque/lignes/${l.id}/affecter`, { compte: "401" })).status).toBe(422);
  });
});

describe("révision et IS", () => {
  it("produit SIG, ratios, anomalies et programme de travail", async () => {
    await ecriture(collab, {
      journal: "VE", date: "2026-05-01", libelle: "Ventes", pieceRef: "Z5",
      lignes: [{ compte: "530", debit: 12_000_000 }, { compte: "706", credit: 10_000_000 }, { compte: "44571", credit: 2_000_000, tauxTva: 2000 }],
    });
    await ecriture(collab, {
      journal: "OD", date: "2026-05-02", libelle: "En attente", pieceRef: "X1",
      lignes: [{ compte: "471", debit: 1_000 }, { compte: "512", credit: 1_000 }],
    });
    const r = await expert.req("GET", `${base()}/revision?exerciceId=${exerciceId}`);
    expect(r.status).toBe(200);
    expect(r.body.sig.chiffreAffaires).toBe(10_000_000);
    expect(r.body.anomalies.map((a: { code: string }) => a.code)).toEqual(expect.arrayContaining(["ATTENTE", "BROUILLARD"]));
    expect(r.body.programme.length).toBeGreaterThan(20);
    await collab.req("PUT", `${base()}/revision/points/T1`, { exerciceId, statut: "fait", commentaire: "Relevés de mars rapprochés" });
    const r2 = await expert.req("GET", `${base()}/revision?exerciceId=${exerciceId}`);
    expect(r2.body.programme.find((p: { code: string }) => p.code === "T1")).toMatchObject({ statut: "fait", commentaire: "Relevés de mars rapprochés" });
  });

  it("calcule l'IS au taux réduit puis normal et le comptabilise", async () => {
    const calc = await expert.req("POST", `${base()}/is/calcul`, { exerciceId, reintegrations: 100_000 });
    expect(calc.status).toBe(200);
    const attendu = calc.body.resultatComptable + 100_000;
    expect(calc.body.resultatFiscal).toBe(attendu);
    expect(calc.body.impotTauxReduit).toBe(637_500);
    const e = await expert.req("POST", `${base()}/is/ecriture`, { exerciceId, reintegrations: 100_000 });
    expect(e.status).toBe(201);
    expect(e.body.lignes[0]).toMatchObject({ compte: "695", debit: calc.body.impotTotal });
    expect((await expert.req("POST", `${base()}/is/ecriture`, { exerciceId })).status).toBe(409);
  });
});

describe("mission et LCB-FT", () => {
  it("signale l'absence de lettre de mission puis l'enregistre", async () => {
    let list = await expert.req("GET", "/api/dossiers");
    expect(list.body[0].alertesMission[0].code).toBe("MISSION_ABSENTE");
    const put = await expert.req("PUT", `${base()}/mission`, {
      types: ["tenue_presentation", "social"], lettreSigneeLe: "2026-01-05", honorairesAnnuelsHT: 360_000, risqueLcbft: "standard",
      identiteVerifieeLe: "2026-01-05", beneficiairesEffectifs: "Pierre Martin (100 %)", revueLcbftLe: "2026-01-05", ppe: false,
    });
    expect(put.status).toBe(200);
    const m = await expert.req("GET", `${base()}/mission`);
    expect(m.body.alertes).toEqual([]);
    expect(m.body.prochaineRevue).toBe("2028-01-05");
    list = await expert.req("GET", "/api/dossiers");
    expect(list.body[0].alertesMission).toEqual([]);
    expect((await collab.req("PUT", `${base()}/mission`, {})).status).toBe(403);
  });
});

describe("reprise de dossier par FEC", () => {
  it("importe un FEC valide avec création des journaux et des tiers", async () => {
    const d = await expert.req("POST", "/api/dossiers", { ...DOSSIER, siren: "552100554", raisonSociale: "Reprise SAS" });
    const fec = generateFec([
      { journalCode: "VTE", journalLib: "Journal des ventes", ecritureNum: "1", ecritureDate: "2026-02-01", compteNum: "411000", compteLib: "Clients", compAuxNum: "C0042", compAuxLib: "Client historique", pieceRef: "FA1", pieceDate: "2026-02-01", ecritureLib: "Facture FA1", debit: 12_000, credit: 0, validDate: "2026-02-02" },
      { journalCode: "VTE", journalLib: "Journal des ventes", ecritureNum: "1", ecritureDate: "2026-02-01", compteNum: "706000", compteLib: "Honoraires", pieceRef: "FA1", pieceDate: "2026-02-01", ecritureLib: "Facture FA1", debit: 0, credit: 10_000, validDate: "2026-02-02" },
      { journalCode: "VTE", journalLib: "Journal des ventes", ecritureNum: "1", ecritureDate: "2026-02-01", compteNum: "445710", compteLib: "TVA collectée", pieceRef: "FA1", pieceDate: "2026-02-01", ecritureLib: "Facture FA1", debit: 0, credit: 2_000, validDate: "2026-02-02" },
    ]);
    const r = await expert.req("POST", `/api/dossiers/${d.body.id}/fec/import`, { content: fec });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ecritures: 1, tiersCrees: 1 });
    const det = await expert.req("GET", `/api/dossiers/${d.body.id}`);
    expect(det.body.journaux.map((j: { code: string }) => j.code)).toContain("VTE");
    const tiers = await expert.req("GET", `/api/dossiers/${d.body.id}/tiers`);
    expect(tiers.body[0]).toMatchObject({ compteAux: "C0042", nom: "Client historique", type: "client" });
  });

  it("refuse un FEC hors exercice sans rien importer", async () => {
    const fec = generateFec([
      { journalCode: "OD", journalLib: "OD", ecritureNum: "9", ecritureDate: "2024-02-01", compteNum: "471", compteLib: "Attente", pieceRef: "X", pieceDate: "2024-02-01", ecritureLib: "Ancien", debit: 100, credit: 0, validDate: "2024-02-02" },
      { journalCode: "OD", journalLib: "OD", ecritureNum: "9", ecritureDate: "2024-02-01", compteNum: "512", compteLib: "Banque", pieceRef: "X", pieceDate: "2024-02-01", ecritureLib: "Ancien", debit: 0, credit: 100, validDate: "2024-02-02" },
    ]);
    const avant = env.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ecritures WHERE dossier_id = ?", dossierId)!.n;
    const r = await expert.req("POST", `${base()}/fec/import`, { content: fec });
    expect(r.status).toBe(422);
    expect(env.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ecritures WHERE dossier_id = ?", dossierId)!.n).toBe(avant);
  });
});
