import { migrate } from "../src/server/db/migrate";

export default async function setup() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente (defina TEST_DATABASE_ADMIN_URL)");
  await migrate(url, process.env.APP_DB_PASSWORD!);
}
