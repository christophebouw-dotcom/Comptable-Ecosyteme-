import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { RgpdService } from "./services/rgpd.js";

const config = loadConfig();
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

const shutdown = async () => {
  await app.close();
  ctx.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
