import { migrate } from "../src/server/db/migrate";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente");
  const applied = await migrate(url, process.env.APP_DB_PASSWORD ?? "bora_app_dev");
  console.log(applied.length ? `aplicadas: ${applied.join(", ")}` : "nada a aplicar");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
