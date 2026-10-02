import { migrate } from "../src/server/db/migrate";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente");
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!appPassword) throw new Error("APP_DB_PASSWORD ausente: defina a senha do papel bora_app no .env");
  const applied = await migrate(url, appPassword);
  console.log(applied.length ? `aplicadas: ${applied.join(", ")}` : "nada a aplicar");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
