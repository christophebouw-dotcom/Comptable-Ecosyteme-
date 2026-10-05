import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext, SessionUser } from "../context.js";
import { HttpError, badRequest, tooMany, unauthorized, unprocessable } from "../http/errors.js";
import { requireUser } from "../http/guards.js";
import { RateLimiter } from "../http/rate-limit.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../security/crypto.js";
import { checkPassword } from "../security/password-policy.js";
import { ROLE_LABELS, type Role, permissionsOf } from "../security/rbac.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../security/totp.js";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

interface UserRow {
  id: number;
  email: string;
  nom: string;
  role: Role;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  failed_attempts: number;
  locked_until: string | null;
  active: number;
}

export function cookieName(ctx: AppContext) {
  // Le préfixe __Host- impose Secure, Path=/ et l'absence de Domain (anti-fixation de cookie).
  return ctx.config.env === "production" ? "__Host-sid" : "sid";
}

function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string) {
  reply.setCookie(cookieName(ctx), token, {
    httpOnly: true,
    secure: ctx.config.env === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ctx.config.sessionMaxHours * 3600,
  });
}

function createSession(ctx: AppContext, req: FastifyRequest, userId: number, mfaOk: boolean): string {
  const token = randomToken();
  const now = ctx.now();
  const expires = new Date(now.getTime() + ctx.config.sessionMaxHours * 3_600_000);
  ctx.db.run(
    "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, mfa_ok, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    sha256(token), userId, now.toISOString(), now.toISOString(), expires.toISOString(), mfaOk ? 1 : 0, req.ip,
    String(req.headers["user-agent"] ?? "").slice(0, 200),
  );
  return token;
}

/** Charge l'utilisateur de la session (hook onRequest). */
export function loadSession(ctx: AppContext, req: FastifyRequest): { user: SessionUser; sessionId: string } | null {
  const token = req.cookies[cookieName(ctx)];
  if (!token) return null;
  const id = sha256(token);
  const row = ctx.db.get<{
    user_id: number; expires_at: string; last_seen_at: string; mfa_ok: number;
    email: string; nom: string; role: Role; totp_enabled: number; active: number;
  }>(
    `SELECT s.user_id, s.expires_at, s.last_seen_at, s.mfa_ok, u.email, u.nom, u.role, u.totp_enabled, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row) return null;
  const now = ctx.now();
  const idleLimit = new Date(Date.parse(row.last_seen_at) + ctx.config.sessionIdleMinutes * 60_000);
  if (!row.active || now > new Date(row.expires_at) || now > idleLimit) {
    ctx.db.run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  if (now.getTime() - Date.parse(row.last_seen_at) > 60_000) {
    ctx.db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", now.toISOString(), id);
  }
  return {
    sessionId: id,
    user: { id: row.user_id, email: row.email, nom: row.nom, role: row.role, totpEnabled: !!row.totp_enabled, mfaOk: !!row.mfa_ok },
  };
}

export function publicUser(u: SessionUser) {
  return {
    id: u.id, email: u.email, nom: u.nom, role: u.role, roleLabel: ROLE_LABELS[u.role],
    totpEnabled: u.totpEnabled, permissions: permissionsOf(u.role),
  };
}

const loginSchema = z.object({ email: z.string().trim().max(254), password: z.string().min(1).max(256) });

// Empreinte factice pour égaliser le temps de réponse quand l'e-mail est inconnu.
let dummyHash: Promise<string> | null = null;

export async function authRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const ipLimiter = new RateLimiter(20, 15 * 60_000);
  const emailLimiter = new RateLimiter(10, 15 * 60_000);
  dummyHash ??= hashPassword("dummy-password-for-timing!A1");

  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const emailHash = ctx.cipher.blindIndex(email);
    if (!ipLimiter.take(`ip:${req.ip}`) || !emailLimiter.take(`email:${emailHash}`)) throw tooMany();

    const logAccess = (event: string, userId: number | null = null) =>
      ctx.db.run(
        "INSERT INTO access_log (user_id, email_hash, event, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
        userId, emailHash, event, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 200),
      );

    const user = ctx.db.get<UserRow>("SELECT * FROM users WHERE email = ? AND anonymized_at IS NULL", email);
    if (!user || !user.active) {
      await verifyPassword(password, await dummyHash!);
      logAccess("login_fail_unknown");
      throw unauthorized("Identifiants invalides");
    }
    const now = ctx.now();
    if (user.locked_until && new Date(user.locked_until) > now) {
      logAccess("login_locked", user.id);
      throw new HttpError(423, `Compte temporairement verrouillé après ${MAX_FAILED_ATTEMPTS} échecs. Réessayez après ${new Date(user.locked_until).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}.`);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
      ctx.db.run("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?", lock ? 0 : attempts, lock, user.id);
      logAccess(lock ? "login_fail_locked" : "login_fail", user.id);
      if (lock) ctx.audit.record({ userId: user.id, userEmail: user.email, action: "auth.verrouillage", ip: req.ip });
      throw unauthorized("Identifiants invalides");
    }
    ctx.db.run("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now.toISOString(), user.id);
    const mfaRequired = !!user.totp_enabled;
    const token = createSession(ctx, req, user.id, !mfaRequired);
    setSessionCookie(ctx, reply, token);
    logAccess(mfaRequired ? "login_password_ok" : "login_ok", user.id);
    const su: SessionUser = { id: user.id, email: user.email, nom: user.nom, role: user.role, totpEnabled: mfaRequired, mfaOk: !mfaRequired };
    return { mfaRequired, user: mfaRequired ? null : publicUser(su) };
  });

  app.post("/api/auth/mfa", async (req, reply) => {
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    if (!req.user || !req.sessionId) throw unauthorized();
    if (!ipLimiter.take(`mfa:${req.user.id}`)) throw tooMany();
    const row = ctx.db.get<{ totp_secret_enc: string | null }>("SELECT totp_secret_enc FROM users WHERE id = ?", req.user.id);
    const secret = ctx.cipher.decrypt(row?.totp_secret_enc);
    if (!secret || !verifyTotp(secret, code, ctx.now().getTime())) {
      ctx.db.run("INSERT INTO access_log (user_id, event, ip) VALUES (?, 'mfa_fail', ?)", req.user.id, req.ip);
      throw unauthorized("Code invalide");
    }
    // Rotation de l'identifiant de session après élévation (anti-fixation).
    ctx.db.run("DELETE FROM sessions WHERE id = ?", req.sessionId);
    setSessionCookie(ctx, reply, createSession(ctx, req, req.user.id, true));
    ctx.db.run("INSERT INTO access_log (user_id, event, ip) VALUES (?, 'login_ok', ?)", req.user.id, req.ip);
    return { user: publicUser({ ...req.user, mfaOk: true }) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.sessionId) ctx.db.run("DELETE FROM sessions WHERE id = ?", req.sessionId);
    if (req.user) ctx.db.run("INSERT INTO access_log (user_id, event, ip) VALUES (?, 'logout', ?)", req.user.id, req.ip);
    reply.clearCookie(cookieName(ctx), { path: "/" });
    return { ok: true };
  });

  // Pas d'erreur 401 pour un visiteur non connecté : l'interface interroge cette route au démarrage.
  app.get("/api/auth/me", async (req) => {
    const u = req.user;
    if (!u) return { user: null };
    if (u.totpEnabled && !u.mfaOk) return { user: null, mfaRequired: true };
    return { user: publicUser(u) };
  });

  app.post("/api/auth/password", async (req) => {
    const u = requireUser(req);
    const { current, next } = z.object({ current: z.string(), next: z.string().max(256) }).parse(req.body);
    const row = ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
    if (!(await verifyPassword(current, row.password_hash))) throw unauthorized("Mot de passe actuel incorrect");
    const policy = checkPassword(next, { email: u.email, nom: u.nom });
    if (!policy.ok) throw unprocessable("Mot de passe trop faible", policy.errors);
    if (await verifyPassword(next, row.password_hash)) throw unprocessable("Le nouveau mot de passe doit être différent");
    ctx.db.run("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", await hashPassword(next), ctx.now().toISOString(), u.id);
    // Révocation des autres sessions.
    ctx.db.run("DELETE FROM sessions WHERE user_id = ? AND id <> ?", u.id, req.sessionId!);
    ctx.audit.record({ userId: u.id, userEmail: u.email, action: "auth.mot_de_passe_modifie", ip: req.ip });
    return { ok: true };
  });

  app.post("/api/auth/totp/setup", async (req) => {
    const u = requireUser(req);
    if (u.totpEnabled) throw badRequest("La double authentification est déjà activée");
    const secret = generateTotpSecret();
    ctx.db.run("UPDATE users SET totp_secret_enc = ? WHERE id = ?", ctx.cipher.encrypt(secret), u.id);
    return { secret, otpauthUri: otpauthUri(secret, u.email) };
  });

  app.post("/api/auth/totp/enable", async (req) => {
    const u = requireUser(req);
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const row = ctx.db.get<{ totp_secret_enc: string | null }>("SELECT totp_secret_enc FROM users WHERE id = ?", u.id);
    const secret = ctx.cipher.decrypt(row?.totp_secret_enc);
    if (!secret) throw badRequest("Lancez d'abord la configuration");
    if (!verifyTotp(secret, code, ctx.now().getTime())) throw unprocessable("Code invalide");
    ctx.db.run("UPDATE users SET totp_enabled = 1 WHERE id = ?", u.id);
    ctx.db.run("UPDATE sessions SET mfa_ok = 1 WHERE id = ?", req.sessionId!);
    ctx.audit.record({ userId: u.id, userEmail: u.email, action: "auth.totp_active", ip: req.ip });
    return { ok: true };
  });

  app.post("/api/auth/totp/disable", async (req) => {
    const u = requireUser(req);
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const row = ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
    if (!(await verifyPassword(password, row.password_hash))) throw unauthorized("Mot de passe incorrect");
    ctx.db.run("UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?", u.id);
    ctx.audit.record({ userId: u.id, userEmail: u.email, action: "auth.totp_desactive", ip: req.ip });
    return { ok: true };
  });

  app.get("/api/auth/sessions", async (req) => {
    const u = requireUser(req);
    return ctx.db
      .all<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }>(
        "SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
        u.id,
      )
      .map((s) => ({ ...s, id: s.id.slice(0, 12), current: s.id === req.sessionId }));
  });
}
