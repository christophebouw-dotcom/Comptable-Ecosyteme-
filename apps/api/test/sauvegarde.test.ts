import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "../src/db/index.js";
import { listerSauvegardes, restaurer, sauvegarder } from "../src/services/sauvegarde.js";

const dir = mkdtempSync(join(tmpdir(), "compta-sauv-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("sauvegardes chiffrées", () => {
  const cle = randomBytes(32);
  const db = new Database(join(dir, "source.db"));
  db.run("INSERT INTO users (email, nom, role, password_hash) VALUES ('a@b.fr', 'Jeanne Secrète', 'admin', 'x')");

  it("produit un fichier chiffré, illisible sans la clé, et le restaure à l'identique", async () => {
    const r = await sauvegarder(db, cle, join(dir, "sauv"), 30, new Date("2026-10-05T03:00:00Z"));
    expect(r.fichier).toMatch(/compta-20261005-030000\.db\.enc$/);
    const brut = readFileSync(r.fichier);
    expect(brut.subarray(0, 8).toString()).toBe("CESAUV01");
    expect(brut.includes(Buffer.from("Jeanne Secrète"))).toBe(false);
    expect(brut.includes(Buffer.from("SQLite format"))).toBe(false);

    const cible = join(dir, "restauree.db");
    const res = await restaurer(r.fichier, cle, cible);
    expect(res.integrite).toBe("ok");
    const copie = new Database(cible);
    expect(copie.get<{ nom: string }>("SELECT nom FROM users")?.nom).toBe("Jeanne Secrète");
    copie.close();
  });

  it("refuse une mauvaise clé et un fichier altéré", async () => {
    const [s] = listerSauvegardes(join(dir, "sauv"));
    await expect(restaurer(s!.fichier, randomBytes(32), join(dir, "x.db"))).rejects.toThrow(/clé maîtresse différente ou fichier altéré/);
    const altere = join(dir, "altere.db.enc");
    const buf = readFileSync(s!.fichier);
    buf[100] = buf[100]! ^ 0xff;
    writeFileSync(altere, buf);
    await expect(restaurer(altere, cle, join(dir, "y.db"))).rejects.toThrow(/altéré/);
  });

  it("supprime les sauvegardes au-delà de la durée de conservation", async () => {
    const vieille = await sauvegarder(db, cle, join(dir, "sauv"), 30, new Date("2026-08-01T03:00:00Z"));
    utimesSync(vieille.fichier, new Date("2026-08-01"), new Date("2026-08-01"));
    const r = await sauvegarder(db, cle, join(dir, "sauv"), 30, new Date("2026-10-06T03:00:00Z"));
    expect(r.supprimees).toEqual([vieille.fichier]);
    expect(listerSauvegardes(join(dir, "sauv")).map((x) => x.date.toISOString().slice(0, 10))).toEqual(["2026-10-05", "2026-10-06"]);
  });
});

describe("sauvegardes simultanées", () => {
  it("deux sauvegardes dans la même seconde produisent deux fichiers valides", async () => {
    const cle = randomBytes(32);
    const db = new Database(join(dir, "simul.db"));
    const now = new Date("2026-10-07T03:00:00Z");
    const [a, b] = await Promise.all([sauvegarder(db, cle, join(dir, "simul"), 30, now), sauvegarder(db, cle, join(dir, "simul"), 30, now)]);
    expect(a.fichier).not.toBe(b.fichier);
    for (const f of [a.fichier, b.fichier]) expect((await restaurer(f, cle, join(dir, `r-${f.length}-${Math.random()}.db`))).integrite).toBe("ok");
  });
});
