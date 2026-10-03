import { unstable_cache } from "next/cache";
import { loadTenantTheme } from "@/server/theme/load";
import { findTenantBySegment, type TenantRef } from "./lookup";

class TenantNotFound extends Error {}

// Erros não são cacheados: segmentos inexistentes (escolhidos pelo atacante) não enchem o cache.
const tenantOrThrow = unstable_cache(
  async (segment: string): Promise<TenantRef> => {
    const tenant = await findTenantBySegment(segment);
    if (!tenant) throw new TenantNotFound();
    return tenant;
  },
  ["tenant-by-segment"],
  { revalidate: 60, tags: ["tenants"] },
);

export async function getTenantCached(segment: string): Promise<TenantRef | null> {
  try {
    return await tenantOrThrow(segment);
  } catch (err) {
    if (err instanceof TenantNotFound) return null;
    throw err;
  }
}

export const getThemeCached = unstable_cache(loadTenantTheme, ["tenant-theme"], {
  revalidate: 60,
  tags: ["tenants"],
});
