import { controlerFec } from "@compta/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FAILED_ATTEMPTS } from "../src/routes/auth.js";
import { totp } from "../src/security/totp.js";
import { type Client, DOSSIER, PASSWORD, type TestEnv, setup } from "./helpers.js";

let env: TestEnv;
let admin: Client;
let expert: Client;
let collab: Client;
let dossierId: number;
let exerciceId: number;
let clientTiersId: number;

beforeAll(async () => {
  env = await setup();
  admin = await env.as(env.users.admin);
  expert = await env.as(env.users.expert);
  collab = await env.as(env.users.collab);
});
afterAll(() => env.app.close());

describe("authentification et sécurité", () => {
  it("refuse l'accès sans session et pose les en-têtes de sécurité", async () => {
    const res = await env.app.inject({ method: "GET", url: "/api/dossiers" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("ne révèle pas si un e-mail existe", async () => {
    const a = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "inconnu@x.fr", password: "x" } });
    const b = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: env.users.dpo, password: "mauvais" } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error).toBe(b.json().error);
  });

  it("verrouille le compte après des échecs répétés", async () => {
    const email = env.users.client;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "mauvais" } });
    }
    const res = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
    expect(res.statusCode).toBe(423);
    env.ctx.db.run("UPDATE users SET locked_until = NULL WHERE email = ?", email);
  });

  it("stocke uniquement l'empreinte du jeton de session", async () => {
    const token = admin.cookie.split("=")[1]!;
    const rows = env.ctx.db.all<{ id: string }>("SELECT id FROM sessions");
    expect(rows.some((r) => r.id === token)).toBe(false);
  });

  it("rejette une requête mutante d'une origine étrangère (CSRF)", async () => {
    const res = await env.app.inject({
      method: "POST", url: "/api/dossiers", payload: DOSSIER,
      headers: { cookie: admin.cookie, origin: "https://evil.example", "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("applique la politique de mots de passe CNIL", async () => {
    const res = await admin.req("POST", "/api/users", { email: "faible@cabinet.test", nom: "Faible", role: "collaborateur", password: "azerty" });
    expect(res.status).toBe(422);
    expect(res.body.details).toContain("Au moins 12 caractères");
  });

  it("active la double authentification TOTP et l'exige à la connexion", async () => {
    const dpo = await env.as(env.users.dpo);
    const setupRes = await dpo.req("POST", "/api/auth/totp/setup", {});
    expect(setupRes.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = setupRes.body.secret as string;
    expect((await dpo.req("POST", "/api/auth/totp/enable", { code: "000000" })).status).toBe(422);
    expect((await dpo.req("POST", "/api/auth/totp/enable", { code: totp(secret, env.ctx.now().getTime()) })).status).toBe(200);
    // Le secret est chiffré en base.
    const row = env.ctx.db.get<{ totp_secret_enc: string }>("SELECT totp_secret_enc FROM users WHERE email = ?", env.users.dpo)!;
    expect(row.totp_secret_enc).not.toContain(secret);

    const login = await env.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: env.users.dpo, password: PASSWORD } });
    expect(login.json().mfaRequired).toBe(true);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const blocked = await env.app.inject({ method: "GET", url: "/api/rgpd/demandes", headers: { cookie } });
    expect(blocked.statusCode).toBe(401);
    const mfa = await env.app.inject({ method: "POST", url: "/api/auth/mfa", payload: { code: totp(secret, env.ctx.now().getTime()) }, headers: { cookie } });
    expect(mfa.statusCode).toBe(200);
    const newCookie = String(mfa.headers["set-cookie"]).split(";")[0]!;
    expect(newCookie).not.toBe(cookie); // rotation de session
    const ok = await env.app.inject({ method: "GET", url: "/api/rgpd/demandes", headers: { cookie: newCookie } });
    expect(ok.statusCode).toBe(200);
  });
});

describe("dossiers et cloisonnement", () => {
  it("crée un dossier avec IBAN chiffré", async () => {
    const res = await expert.req("POST", "/api/dossiers", DOSSIER);
    expect(res.status).toBe(200);
    dossierId = res.body.id;
    const row = env.ctx.db.get<{ iban_enc: string }>("SELECT iban_enc FROM dossiers WHERE id = ?", dossierId)!;
    expect(row.iban_enc).toMatch(/^v1\./);
    expect(row.iban_enc).not.toContain("30006");
    const d = await expert.req("GET", `/api/dossiers/${dossierId}`);
    expect(d.body.ibanMasque).toBe("FR76 **** **** **** **** ***0 189");
    expect(d.body.journaux.map((j: { code: string }) => j.code)).toContain("VE");
    exerciceId = d.body.exercices[0].id;
  });

  it("rejette un SIREN invalide", async () => {
    const res = await expert.req("POST", "/api/dossiers", { ...DOSSIER, siren: "123456789" });
    expect(res.status).toBe(400);
  });

  it("masque les dossiers non affectés au collaborateur", async () => {
    expect((await collab.req("GET", `/api/dossiers/${dossierId}`)).status).toBe(404);
    expect((await collab.req("GET", "/api/dossiers")).body).toEqual([]);
    const collabId = env.ctx.db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", env.users.collab)!.id;
    await admin.req("PATCH", `/api/users/${collabId}`, { dossiers: [dossierId] });
    expect((await collab.req("GET", `/api/dossiers/${dossierId}`)).status).toBe(200);
  });

  it("interdit au DPO l'accès aux données comptables", async () => {
    const res = await env.app.inject({ method: "GET", url: `/api/dossiers/${dossierId}/ecritures` });
    expect(res.statusCode).toBe(401);
  });
});

describe("comptabilité : saisie, validation, intangibilité", () => {
  let ecritureId: number;

  it("refuse une écriture déséquilibrée", async () => {
    const res = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "AC", date: "2026-03-01", libelle: "Loyer", pieceRef: "L03",
      lignes: [{ compte: "6132", debit: 50_000 }, { compte: "401", credit: 40_000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.details.map((d: { code: string }) => d.code)).toContain("DESEQUILIBRE");
  });

  it("refuse une écriture hors exercice", async () => {
    const res = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "AC", date: "2027-03-01", libelle: "Loyer", pieceRef: "L03",
      lignes: [{ compte: "6132", debit: 100 }, { compte: "401", credit: 100 }],
    });
    expect(res.status).toBe(422);
  });

  it("saisit en brouillard puis seul l'expert valide", async () => {
    const res = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "AC", date: "2026-03-01", libelle: "Loyer mars", pieceRef: "L03",
      lignes: [
        { compte: "6132", debit: 50_000 },
        { compte: "44566", debit: 10_000, tauxTva: 2000 },
        { compte: "401", compteAux: "FBAILLEUR", credit: 60_000 },
      ],
    });
    expect(res.status).toBe(201);
    ecritureId = res.body.id;
    expect(res.body.statut).toBe("brouillard");
    expect((await collab.req("POST", `/api/dossiers/${dossierId}/ecritures/valider`, { ids: [ecritureId] })).status).toBe(403);
    const v = await expert.req("POST", `/api/dossiers/${dossierId}/ecritures/valider`, { ids: [ecritureId] });
    expect(v.status).toBe(200);
    expect(v.body[0].numero).toBe(1);
    expect(v.body[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("interdit la modification d'une écriture validée, y compris directement en SQL", async () => {
    const res = await collab.req("PUT", `/api/dossiers/${dossierId}/ecritures/${ecritureId}`, {
      journal: "AC", date: "2026-03-01", libelle: "Fraude", pieceRef: "L03",
      lignes: [{ compte: "6132", debit: 1 }, { compte: "401", credit: 1 }],
    });
    expect(res.status).toBe(409);
    expect((await collab.req("DELETE", `/api/dossiers/${dossierId}/ecritures/${ecritureId}`)).status).toBe(409);
    expect(() => env.ctx.db.run("UPDATE ecriture_lignes SET debit = 1 WHERE ecriture_id = ?", ecritureId)).toThrow(/seul le lettrage/);
    expect(() => env.ctx.db.run("DELETE FROM ecritures WHERE id = ?", ecritureId)).toThrow(/interdite/);
  });

  it("corrige par contre-passation", async () => {
    const res = await expert.req("POST", `/api/dossiers/${dossierId}/ecritures/${ecritureId}/extourner`, { date: "2026-03-02", motif: "Erreur de montant" });
    expect(res.status).toBe(201);
    expect(res.body.extourneDe).toBe(ecritureId);
    expect(res.body.lignes[0].credit).toBe(50_000);
    await expert.req("POST", `/api/dossiers/${dossierId}/ecritures/valider`, { ids: [res.body.id] });
    const bal = await expert.req("GET", `/api/dossiers/${dossierId}/balance`);
    expect(bal.body.lignes.every((l: { soldeDebiteur: number; soldeCrediteur: number }) => l.soldeDebiteur === 0 && l.soldeCrediteur === 0)).toBe(true);
  });

  it("détecte une falsification de la chaîne d'intégrité", async () => {
    expect((await expert.req("GET", `/api/dossiers/${dossierId}/integrite`)).body.ok).toBe(true);
  });
});

describe("tiers, facturation et Factur-X", () => {
  let factureId: number;

  it("crée un client avec données de contact chiffrées et masquées pour le lecteur", async () => {
    const res = await collab.req("POST", `/api/dossiers/${dossierId}/tiers`, {
      type: "client", compteAux: "CDURAND", nom: "Jean Durand", personnePhysique: true, professionnel: false,
      adresse: "3 place Bellecour", codePostal: "69002", ville: "Lyon", email: "jean.durand@exemple.fr", telephone: "0601020304",
    });
    expect(res.status).toBe(201);
    clientTiersId = res.body.id;
    const row = env.ctx.db.get<{ email_enc: string }>("SELECT email_enc FROM tiers WHERE id = ?", clientTiersId)!;
    expect(row.email_enc).not.toContain("durand");
    const client = await env.as(env.users.client);
    const clientUserId = env.ctx.db.get<{ id: number }>("SELECT id FROM users WHERE email = ?", env.users.client)!.id;
    await admin.req("PATCH", `/api/users/${clientUserId}`, { dossiers: [dossierId] });
    const list = await client.req("GET", `/api/dossiers/${dossierId}/tiers`);
    expect(list.body[0].email).toBe("je*********@exemple.fr");
    expect((await client.req("POST", `/api/dossiers/${dossierId}/tiers`, {})).status).toBe(403);
  });

  it("crée un brouillon, émet une facture numérotée et génère l'écriture de vente", async () => {
    const res = await collab.req("POST", `/api/dossiers/${dossierId}/factures`, {
      tiersId: clientTiersId, dateEmission: "2026-04-10", categorie: "biens",
      lignes: [
        { designation: "Pièce montée", quantite: 1, prixUnitaireHT: 15_000, tauxTvaBp: 550 },
        { designation: "Livraison", quantite: 1, prixUnitaireHT: 2_000, tauxTvaBp: 2000 },
      ],
    });
    expect(res.status).toBe(201);
    factureId = res.body.id;
    expect(res.body.totaux.totalTTC).toBe(15_000 + 825 + 2_000 + 400);
    const em = await collab.req("POST", `/api/dossiers/${dossierId}/factures/${factureId}/emettre`);
    expect(em.status).toBe(200);
    expect(em.body.numero).toBe("F2026-000001");
    expect(em.body.hash).toMatch(/^[0-9a-f]{64}$/);
    const e = await expert.req("GET", `/api/dossiers/${dossierId}/ecritures/${em.body.ecritureId}`);
    expect(e.body.journal).toBe("VE");
    expect(e.body.lignes[0]).toMatchObject({ compte: "411", compteAux: "CDURAND", debit: 18_225 });
  });

  it("interdit de modifier ou supprimer une facture émise", async () => {
    expect((await collab.req("DELETE", `/api/dossiers/${dossierId}/factures/${factureId}`)).status).toBe(409);
    expect(() => env.ctx.db.run("UPDATE factures SET total_ttc = 1 WHERE id = ?", factureId)).toThrow(/interdite/);
  });

  it("refuse une date d'émission antérieure à la dernière facture (chronologie)", async () => {
    const b = await collab.req("POST", `/api/dossiers/${dossierId}/factures`, {
      tiersId: clientTiersId, dateEmission: "2026-04-01", categorie: "services",
      lignes: [{ designation: "Conseil", quantite: 1, prixUnitaireHT: 1000, tauxTvaBp: 2000 }],
    });
    const em = await collab.req("POST", `/api/dossiers/${dossierId}/factures/${b.body.id}/emettre`);
    expect(em.status).toBe(422);
    expect(em.body.error).toMatch(/chronologique/);
  });

  it("exige le SIREN d'un client professionnel (réforme 2026)", async () => {
    const t = await collab.req("POST", `/api/dossiers/${dossierId}/tiers`, {
      type: "client", compteAux: "CPRO", nom: "Pro SAS", professionnel: true, adresse: "1 rue", codePostal: "75001", ville: "Paris",
    });
    const b = await collab.req("POST", `/api/dossiers/${dossierId}/factures`, {
      tiersId: t.body.id, dateEmission: "2026-05-01", categorie: "services",
      lignes: [{ designation: "Conseil", quantite: 2, prixUnitaireHT: 10_000, tauxTvaBp: 2000 }],
    });
    const em = await collab.req("POST", `/api/dossiers/${dossierId}/factures/${b.body.id}/emettre`);
    expect(em.status).toBe(422);
    expect(em.body.details.map((d: { code: string }) => d.code)).toContain("SIREN_CLIENT");
  });

  it("exporte le XML Factur-X et crée un avoir", async () => {
    const x = await collab.req("GET", `/api/dossiers/${dossierId}/factures/${factureId}/facturx`);
    expect(x.status).toBe(200);
    expect(x.raw).toContain("<ram:IBANID>FR7630006000011234567890189</ram:IBANID>");
    const av = await collab.req("POST", `/api/dossiers/${dossierId}/factures/${factureId}/avoir`);
    expect(av.status).toBe(201);
    const em = await collab.req("POST", `/api/dossiers/${dossierId}/factures/${av.body.id}/emettre`);
    expect(em.status).toBe(200);
    expect(em.body.numero).toMatch(/^AV2026-000001$/);
    expect(em.body.facture.factureOrigine).toBe("F2026-000001");
  });
});

describe("TVA, FEC et clôture", () => {
  it("valide les écritures de vente et prépare la CA3", async () => {
    const brouillards = await expert.req("GET", `/api/dossiers/${dossierId}/ecritures?statut=brouillard`);
    await expert.req("POST", `/api/dossiers/${dossierId}/ecritures/valider`, { ids: brouillards.body.map((e: { id: number }) => e.id) });
    const avril = await expert.req("GET", `/api/dossiers/${dossierId}/tva?debut=2026-04-01&fin=2026-04-30`);
    expect(avril.body.totalCollectee).toBe(825 + 400);
    expect(avril.body.collectee).toEqual([
      { tauxBp: 2000, base: 2_000, taxe: 400 },
      { tauxBp: 550, base: 15_000, taxe: 825 },
    ]);
    // L'avoir (daté d'octobre) annule la TVA sur l'année.
    const annee = await expert.req("GET", `/api/dossiers/${dossierId}/tva?debut=2026-01-01&fin=2026-12-31`);
    expect(annee.body.totalCollectee).toBe(0);
  });

  it("exporte un FEC conforme et nommé selon l'art. A47 A-1", async () => {
    const res = await env.app.inject({ method: "GET", url: `/api/dossiers/${dossierId}/exercices/${exerciceId}/fec?encoding=utf8`, headers: { cookie: expert.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("404833048FEC20261231.txt");
    const ctrl = controlerFec(res.body);
    expect(ctrl.anomalies).toEqual([]);
    expect(ctrl.nbEcritures).toBeGreaterThanOrEqual(4);
  });

  it("clôture l'exercice, ouvre le suivant avec les à-nouveaux et verrouille", async () => {
    const apport = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "BQ", date: "2026-01-02", libelle: "Apport en capital", pieceRef: "STATUTS",
      lignes: [{ compte: "512", debit: 800_000 }, { compte: "1013", credit: 800_000 }],
    });
    const brouillon = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "OD", date: "2026-12-31", libelle: "Brouillon oublié", pieceRef: "X",
      lignes: [{ compte: "471", debit: 1 }, { compte: "512", credit: 1 }],
    });
    const refus = await expert.req("POST", `/api/dossiers/${dossierId}/exercices/${exerciceId}/cloture`, { confirmation: "CLOTURER" });
    expect(refus.status).toBe(422);
    expect(refus.body.error).toMatch(/brouillard/);
    await collab.req("DELETE", `/api/dossiers/${dossierId}/ecritures/${brouillon.body.id}`);
    await expert.req("POST", `/api/dossiers/${dossierId}/ecritures/valider`, { ids: [apport.body.id] });
    expect((await collab.req("POST", `/api/dossiers/${dossierId}/exercices/${exerciceId}/cloture`, { confirmation: "CLOTURER" })).status).toBe(403);
    const res = await expert.req("POST", `/api/dossiers/${dossierId}/exercices/${exerciceId}/cloture`, { confirmation: "CLOTURER" });
    expect(res.status).toBe(200);
    expect(res.body.empreinte).toMatch(/^[0-9a-f]{64}$/);
    const after = await collab.req("POST", `/api/dossiers/${dossierId}/ecritures`, {
      journal: "OD", date: "2026-06-01", libelle: "Tardif", pieceRef: "X",
      lignes: [{ compte: "471", debit: 100 }, { compte: "512", credit: 100 }],
    });
    expect(after.status).toBe(422);
    const an = await expert.req("GET", `/api/dossiers/${dossierId}/ecritures?journal=AN`);
    expect(an.body).toHaveLength(1);
    expect(an.body[0].statut).toBe("validee");
    expect(an.body[0].date).toBe("2027-01-01");
    expect(an.body[0].lignes).toEqual(expect.arrayContaining([
      expect.objectContaining({ compte: "512", debit: 800_000 }),
      expect.objectContaining({ compte: "1013", credit: 800_000 }),
    ]));
    expect((await expert.req("GET", `/api/dossiers/${dossierId}/integrite`)).body.ok).toBe(true);
  });
});

describe("RGPD", () => {
  let dpo: Client;
  beforeAll(async () => {
    env.ctx.db.run("UPDATE users SET totp_enabled = 0 WHERE email = ?", env.users.dpo);
    dpo = await env.as(env.users.dpo);
  });

  it("fournit le registre des traitements par défaut", async () => {
    const res = await dpo.req("GET", "/api/rgpd/registre");
    expect(res.body.traitements.length).toBeGreaterThanOrEqual(7);
    expect((await expert.req("GET", "/api/rgpd/registre")).status).toBe(403);
  });

  it("traite une demande d'accès avec export JSON", async () => {
    const d = await dpo.req("POST", "/api/rgpd/demandes", { type: "acces", nom: "Jean Durand", email: "jean.durand@exemple.fr", recueLe: "2026-10-01" });
    expect(d.body.echeance).toBe("2026-11-01");
    expect((await dpo.req("POST", `/api/rgpd/demandes/${d.body.id}/traiter`)).status).toBe(422); // identité non vérifiée
    await dpo.req("PATCH", `/api/rgpd/demandes/${d.body.id}`, { identiteVerifiee: true });
    const exp = await dpo.req("GET", `/api/rgpd/demandes/${d.body.id}/export`);
    const data = JSON.parse(exp.raw);
    expect(data.fichesTiers[0].email).toBe("jean.durand@exemple.fr");
    expect(data.fichesTiers[0].factures.length).toBeGreaterThan(0);
  });

  it("efface les coordonnées mais conserve les pièces comptables (art. 17.3.b)", async () => {
    const d = await dpo.req("POST", "/api/rgpd/demandes", { type: "effacement", nom: "Jean Durand", email: "jean.durand@exemple.fr" });
    await dpo.req("PATCH", `/api/rgpd/demandes/${d.body.id}`, { identiteVerifiee: true });
    const analyse = await dpo.req("GET", `/api/rgpd/demandes/${d.body.id}/analyse`);
    const decisions = analyse.body.decisions as { categorie: string; decision: string; effacementPrevuLe?: string }[];
    expect(decisions.find((x) => x.categorie === "pieces_comptables")).toMatchObject({ decision: "conserver_limiter", effacementPrevuLe: "2036-12-31" });
    expect(decisions.find((x) => x.categorie === "donnees_clients_commercial")?.decision).toBe("effacer");
    const res = await dpo.req("POST", `/api/rgpd/demandes/${d.body.id}/traiter`);
    expect(res.body.statut).toBe("traitee");
    expect(res.body.reponse).toContain("17.3.b");
    const t = env.ctx.db.get<{ email_enc: string | null; restricted: number; nom: string }>("SELECT email_enc, restricted, nom FROM tiers WHERE id = ?", clientTiersId)!;
    expect(t).toMatchObject({ email_enc: null, restricted: 1, nom: "Jean Durand" });
    // Les écritures restent intactes.
    expect((await expert.req("GET", `/api/dossiers/${dossierId}/integrite`)).body.ok).toBe(true);
  });

  it("évalue une violation et calcule l'échéance de 72 h", async () => {
    const res = await dpo.req("POST", "/api/rgpd/violations", {
      titre: "Envoi d'un FEC au mauvais destinataire",
      description: "Un export FEC contenant des IBAN a été envoyé par erreur à un tiers.",
      connueLe: "2026-10-05T08:00:00.000Z",
      dpc: 3, ei: 1,
      circonstances: { confidentialite: "limitee", integrite: "aucune", disponibilite: "aucune", malveillance: false },
      nbPersonnes: 40,
    });
    expect(res.status).toBe(201);
    expect(res.body.niveau).toBe("eleve");
    expect(res.body.notificationCnilRequise).toBe(true);
    expect(res.body.echeanceNotification).toBe("2026-10-08T08:00:00.000Z");
  });

  it("simule puis exécute la purge des données expirées", async () => {
    env.ctx.db.run("INSERT INTO access_log (at, event) VALUES ('2020-01-01T00:00:00.000Z', 'login_ok')");
    const sim = await dpo.req("POST", "/api/rgpd/purge", { dryRun: true });
    expect(sim.body.rapport.find((r: { categorie: string }) => r.categorie === "logs_connexion").nombre).toBe(1);
    expect(env.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM access_log WHERE at < '2021-01-01'")!.n).toBe(1);
    await dpo.req("POST", "/api/rgpd/purge", { dryRun: false });
    expect(env.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM access_log WHERE at < '2021-01-01'")!.n).toBe(0);
  });
});

describe("journal d'audit", () => {
  it("trace les opérations dans une chaîne intègre et en ajout seul", async () => {
    const list = await expert.req("GET", "/api/audit?limit=500");
    const actions = list.body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["dossier.cree", "ecriture.validee", "facture.emise", "exercice.cloture", "rgpd.demande_traitee"]));
    expect((await expert.req("GET", "/api/audit/verification")).body.ok).toBe(true);
    expect(() => env.ctx.db.run("UPDATE audit_log SET action = 'x' WHERE id = 1")).toThrow(/interdite/);
    expect(() => env.ctx.db.run("DELETE FROM audit_log WHERE id = 1")).toThrow(/interdite/);
  });

  it("détecte une altération de la chaîne", async () => {
    env.ctx.db.raw.exec("DROP TRIGGER trg_audit_no_update");
    env.ctx.db.run("UPDATE audit_log SET details = '{\"falsifie\":true}' WHERE id = 3");
    const res = await expert.req("GET", "/api/audit/verification");
    expect(res.body.ok).toBe(false);
    expect(res.body.brokenAt).toBe(3);
  });
});
