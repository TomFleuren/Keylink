import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { VERSION } from "./version.js";

const config = loadConfig();
const app = await buildApp({ config });

const close = async () => {
  await app.close();
  app.ctx.db.close();
};

process.on("SIGINT", () => {
  void close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().then(() => process.exit(0));
});

await app.listen({ port: config.port, host: config.host });
if (config.usingDevSecrets) {
  app.log.warn("KEYLINK_MASTER_KEY or KEYLINK_ADMIN_PASSWORD is unset. Development defaults are in use.");
}
app.log.info({ version: VERSION, port: config.port }, "Keylink listening");
