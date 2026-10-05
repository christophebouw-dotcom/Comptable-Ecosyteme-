import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { type AppContext, type SessionUser, createContext } from "./context.js";
import { HttpError, forbidden, tooMany } from "./http/errors.js";
import { requirePerm } from "./http/guards.js";
import { RateLimiter } from "./http/rate-limit.js";
import { authRoutes, loadSession } from "./routes/auth.js";
import { comptaRoutes } from "./routes/compta.js";
import { dossierRoutes } from "./routes/dossiers.js";
import { expertiseRoutes } from "./routes/expertise.js";
import { paieRoutes } from "./routes/paie.js";
import { pieceRoutes } from "./routes/pieces.js";
import { portailRoutes } from "./routes/portail.js";
import { regularisationRoutes } from "./routes/regularisations.js";
import { factureRoutes } from "./routes/factures.js";
import { rgpdRoutes } from "./routes/rgpd.js";
import { tiersRoutes } from "./routes/tiers.js";
import { userRoutes } from "./routes/users.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export async function buildApp(config: AppConfig, ctx: AppContext = createContext(config)): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            // Minimisation : aucun corps de requête ni cookie dans les journaux techniques.
            redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
          },
    bodyLimit: 60 * 1024 * 1024,
    trustProxy: config.env === "production",
  });
  app.decorate("ctx", ctx);
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);
  await app.register(cookie);

  const globalLimiter = new RateLimiter(600, 60_000);

  app.addHook("onRequest", async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    if (config.env === "production") reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    if (!req.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!globalLimiter.take(req.ip)) throw tooMany();

    // Protection CSRF : cookie SameSite=Strict, corps JSON obligatoire (déclenche
    // un pré-vol CORS) et contrôle de l'origine sur les requêtes mutantes.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== config.publicOrigin && !(config.env !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        throw forbidden("Origine non autorisée");
      }
      const ct = req.headers["content-type"] ?? "";
      if (req.headers["content-length"] && req.headers["content-length"] !== "0" && !ct.startsWith("application/json")) {
        throw new HttpError(415, "Content-Type application/json attendu");
      }
    }
    const s = loadSession(ctx, req);
    if (s) {
      req.user = s.user;
      req.sessionId = s.sessionId;
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({
        error: "Données invalides",
        details: err.issues.map((i) => ({ champ: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    // Violations des triggers d'intégrité SQLite → conflit métier explicite.
    if (e.code === "ERR_SQLITE_ERROR" && e.message && /interdite|clôturé/.test(e.message)) {
      return reply.code(409).send({ error: e.message });
    }
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: "Erreur interne. L'incident a été journalisé." });
  });

  app.get("/api/health", async () => ({ status: "ok", version: "0.1.0" }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(dossierRoutes);
  await app.register(comptaRoutes);
  await app.register(tiersRoutes);
  await app.register(factureRoutes);
  await app.register(expertiseRoutes);
  await app.register(pieceRoutes);
  await app.register(regularisationRoutes);
  await app.register(paieRoutes);
  await app.register(portailRoutes);
  await app.register(rgpdRoutes);

  app.get("/api/audit", async (req) => {
    requirePerm(req, "audit:read");
    const q = z
      .object({ dossierId: z.coerce.number().int().optional(), action: z.string().max(60).optional(), limit: z.coerce.number().int().max(500).optional(), beforeId: z.coerce.number().int().optional() })
      .parse(req.query);
    return ctx.audit.list(q);
  });

  app.get("/api/audit/verification", async (req) => {
    const u = requirePerm(req, "audit:read");
    const res = ctx.audit.verifyChain();
    ctx.audit.record({ userId: u.id, userEmail: u.email, action: "audit.verification", ip: req.ip, details: { ok: res.ok, count: res.count } });
    return res;
  });

  // Front-end compilé (production) avec repli SPA.
  const webDist = config.webDist ?? resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Route inconnue" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
