import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { RgpdService } from "./services/rgpd.js";
import { sauvegarder } from "./services/sauvegarde.js";

const config = loadConfig();
if (config.env === "production") {
  // Les cookies de session « __Host- » exigent HTTPS : refuser une origine en clair.
  if (!config.publicOrigin.startsWith("https://") && !/^http:\/\/localhost(:\d+)?$/.test(config.publicOrigin)) {
    console.error(`PUBLIC_ORIGIN doit être une adresse https:// en production (reçu : ${config.publicOrigin}).`);
    process.exit(1);
  }
  if (!config.backupDir) console.warn("⚠️  BACKUP_DIR non défini : aucune sauvegarde automatique ne sera réalisée.");
}
const ctx = createContext(config);
const app = await buildApp(config, ctx);

// Purge quotidienne selon les durées de conservation (RGPD art. 5.1.e).
const purge = () => {
  try {
    const res = new RgpdService(ctx).purger(false);
    const faits = res.rapport.filter((r) => r.nombre > 0 && r.action !== "à détruire après export d'archive (action manuelle de l'expert-comptable)");
    if (faits.length) {
      ctx.audit.record({ action: "rgpd.purge_automatique", details: { rapport: faits } });
      app.log.info({ rapport: faits }, "Purge RGPD effectuée");
    }
  } catch (err) {
    app.log.error(err, "Échec de la purge RGPD");
  }
};
setInterval(purge, 24 * 3_600_000).unref();
purge();

// Sauvegarde chiffrée quotidienne, avec rotation (RGPD art. 32.1.c).
const sauvegarde = async () => {
  if (!config.backupDir || config.databasePath === ":memory:") return;
  try {
    const r = await sauvegarder(ctx.db, config.masterKey, config.backupDir, config.backupRetentionDays);
    ctx.audit.record({ action: "systeme.sauvegarde", details: { fichier: r.fichier.split("/").pop(), taille: r.taille, supprimees: r.supprimees.length } });
    app.log.info({ fichier: r.fichier, taille: r.taille }, "Sauvegarde chiffrée réalisée");
  } catch (err) {
    ctx.audit.record({ action: "systeme.sauvegarde_echec", details: { erreur: (err as Error).message } });
    app.log.error(err, "Échec de la sauvegarde");
  }
};
setInterval(() => void sauvegarde(), 24 * 3_600_000).unref();
setTimeout(() => void sauvegarde(), 60_000).unref();

const shutdown = async () => {
  await app.close();
  ctx.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
