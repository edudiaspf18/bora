import { migrate } from "../src/server/db/migrate";

export default async function setup() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("TEST_DATABASE_ADMIN_URL ausente");
  await migrate(url, process.env.APP_DB_PASSWORD ?? "bora_app_dev");
}
