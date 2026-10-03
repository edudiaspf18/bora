import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { tenantDomains, tenants } from "@/server/db/schema";

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  vertical: string;
  timezone: string;
}

const COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  vertical: tenants.vertical,
  timezone: tenants.timezone,
};

export async function findTenantBySegment(segment: string): Promise<TenantRef | null> {
  let value: string;
  try {
    value = decodeURIComponent(segment).toLowerCase();
  } catch {
    return null;
  }

  if (value.includes(".")) {
    const [row] = await db
      .select(COLUMNS)
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(
        and(
          eq(tenantDomains.host, value),
          eq(tenantDomains.verified, true),
          eq(tenants.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select(COLUMNS)
    .from(tenants)
    .where(and(eq(tenants.slug, value), eq(tenants.status, "active")))
    .limit(1);
  return row ?? null;
}
