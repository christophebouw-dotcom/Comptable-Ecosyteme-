import { randomBytes } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { type AppContext, createContext } from "../src/context.js";
import { Database } from "../src/db/index.js";
import { hashPassword } from "../src/security/crypto.js";
import type { AssistantIA } from "../src/services/ia.js";

export const PASSWORD = "Tr3s-Solide-Mot2Passe!";

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  as: (email: string) => Promise<Client>;
  users: Record<"admin" | "expert" | "collab" | "client" | "dpo", string>;
}

export interface Client {
  cookie: string;
  req: (method: InjectOptions["method"], url: string, payload?: unknown) => Promise<{ status: number; body: any; headers: Record<string, unknown>; raw: string }>;
}

export async function setup(opts: { ia?: AssistantIA } = {}): Promise<TestEnv> {
  const config = loadConfig({ env: "test", databasePath: ":memory:", masterKey: randomBytes(32), logLevel: "silent", webDist: "/nonexistent" });
  const ctx = createContext(config, new Database(":memory:"), opts.ia ?? null);
  ctx.now = () => new Date("2026-10-05T10:00:00.000Z");
  const app = await buildApp(config, ctx);
  const hash = await hashPassword(PASSWORD);
  const users = {
    admin: "admin@cabinet.test",
    expert: "expert@cabinet.test",
    collab: "collab@cabinet.test",
    client: "client@cabinet.test",
    dpo: "dpo@cabinet.test",
  } as const;
  const roles = { admin: "admin", expert: "expert", collab: "collaborateur", client: "client", dpo: "dpo" } as const;
  for (const [k, email] of Object.entries(users)) {
    ctx.db.run("INSERT INTO users (email, nom, role, password_hash) VALUES (?, ?, ?, ?)", email, `Utilisateur ${k}`, roles[k as keyof typeof roles], hash);
  }

  const makeClient = (cookie: string): Client => ({
    cookie,
    req: async (method, url, payload) => {
      const res = await app.inject({
        method,
        url,
        payload: payload as InjectOptions["payload"],
        headers: { cookie, ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
      });
      let body: unknown = null;
      try {
        body = res.json();
      } catch {
        body = null;
      }
      return { status: res.statusCode, body, headers: res.headers, raw: res.body };
    },
  });

  const as = async (email: string) => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
    if (res.statusCode !== 200) throw new Error(`login ${email} : ${res.statusCode} ${res.body}`);
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
    return makeClient(raw.split(";")[0]!);
  };
  return { app, ctx, as, users };
}

export const DOSSIER = {
  raisonSociale: "Boulangerie Martin SARL",
  formeJuridique: "SARL",
  siren: "404833048",
  adresse: "12 rue du Four",
  codePostal: "75006",
  ville: "Paris",
  capital: "8 000 €",
  rcs: "Paris",
  regimeTva: "reel_normal_mensuel",
  impot: "IS",
  emailContact: "contact@martin.test",
  iban: "FR7630006000011234567890189",
  bic: "BNPAFRPP",
  exerciceDebut: "2026-01-01",
  exerciceFin: "2026-12-31",
};
