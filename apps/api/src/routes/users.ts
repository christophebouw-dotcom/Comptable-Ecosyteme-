import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { intParam, requirePerm } from "../http/guards.js";
import { hashPassword } from "../security/crypto.js";
import { checkPassword } from "../security/password-policy.js";
import { ROLES, ROLE_LABELS, type Role } from "../security/rbac.js";

const roleSchema = z.enum(ROLES as [Role, ...Role[]]);

export async function userRoutes(app: FastifyInstance) {
  const { db, audit } = app.ctx;

  app.get("/api/users", async (req) => {
    requirePerm(req, "users:manage");
    const users = db.all<{ id: number; email: string; nom: string; role: Role; totp_enabled: number; active: number; last_login_at: string | null; locked_until: string | null }>(
      "SELECT id, email, nom, role, totp_enabled, active, last_login_at, locked_until FROM users WHERE anonymized_at IS NULL ORDER BY nom",
    );
    const access = db.all<{ user_id: number; dossier_id: number }>("SELECT user_id, dossier_id FROM dossier_access");
    return users.map((u) => ({
      ...u,
      roleLabel: ROLE_LABELS[u.role],
      dossiers: access.filter((a) => a.user_id === u.id).map((a) => a.dossier_id),
    }));
  });

  app.post("/api/users", async (req) => {
    const admin = requirePerm(req, "users:manage");
    const body = z
      .object({
        email: z.email().max(254),
        nom: z.string().trim().min(2).max(120),
        role: roleSchema,
        password: z.string().max(256),
        dossiers: z.array(z.number().int().positive()).default([]),
      })
      .parse(req.body);
    const policy = checkPassword(body.password, body);
    if (!policy.ok) throw unprocessable("Mot de passe trop faible", policy.errors);
    if (db.get("SELECT 1 FROM users WHERE email = ?", body.email)) throw conflict("Un utilisateur existe déjà avec cet e-mail");
    const passwordHash = await hashPassword(body.password);
    const id = db.transaction(() => {
      const id = db.run("INSERT INTO users (email, nom, role, password_hash) VALUES (?, ?, ?, ?)", body.email, body.nom, body.role, passwordHash).lastInsertRowid;
      for (const d of body.dossiers) db.run("INSERT OR IGNORE INTO dossier_access (user_id, dossier_id) VALUES (?, ?)", id, d);
      return id;
    });
    audit.record({ userId: admin.id, userEmail: admin.email, action: "utilisateur.cree", entity: "user", entityId: id, ip: req.ip, details: { role: body.role, dossiers: body.dossiers } });
    return { id };
  });

  app.patch("/api/users/:id", async (req) => {
    const admin = requirePerm(req, "users:manage");
    const id = intParam(req, "id");
    const body = z
      .object({ role: roleSchema.optional(), active: z.boolean().optional(), dossiers: z.array(z.number().int().positive()).optional(), unlock: z.boolean().optional() })
      .parse(req.body);
    if (!db.get("SELECT 1 FROM users WHERE id = ?", id)) throw notFound();
    if (id === admin.id && (body.active === false || (body.role && body.role !== "admin"))) {
      throw unprocessable("Vous ne pouvez pas vous retirer vos propres droits d'administration");
    }
    db.transaction(() => {
      if (body.role) db.run("UPDATE users SET role = ? WHERE id = ?", body.role, id);
      if (body.active !== undefined) {
        db.run("UPDATE users SET active = ? WHERE id = ?", body.active ? 1 : 0, id);
        if (!body.active) db.run("DELETE FROM sessions WHERE user_id = ?", id);
      }
      if (body.unlock) db.run("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?", id);
      if (body.dossiers) {
        db.run("DELETE FROM dossier_access WHERE user_id = ?", id);
        for (const d of body.dossiers) db.run("INSERT OR IGNORE INTO dossier_access (user_id, dossier_id) VALUES (?, ?)", id, d);
      }
    });
    audit.record({ userId: admin.id, userEmail: admin.email, action: "utilisateur.modifie", entity: "user", entityId: id, ip: req.ip, details: body });
    return { ok: true };
  });
}
