import { tenantSettings } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { defaultTheme, themeSchema, type Theme } from "./theme";

export async function loadTenantTheme(tenantId: string): Promise<Theme> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ theme: tenantSettings.theme }).from(tenantSettings).limit(1),
  );
  const stored = row?.theme;
  if (!stored || typeof stored !== "object") return defaultTheme;
  const parsed = themeSchema.safeParse({ ...defaultTheme, ...(stored as Record<string, unknown>) });
  return parsed.success ? parsed.data : defaultTheme;
}
