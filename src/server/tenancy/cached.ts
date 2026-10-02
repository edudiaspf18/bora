import { unstable_cache } from "next/cache";
import { loadTenantTheme } from "@/server/theme/load";
import { findTenantBySegment } from "./lookup";

export const getTenantCached = unstable_cache(findTenantBySegment, ["tenant-by-segment"], {
  revalidate: 60,
  tags: ["tenants"],
});

export const getThemeCached = unstable_cache(loadTenantTheme, ["tenant-theme"], {
  revalidate: 60,
  tags: ["tenants"],
});
