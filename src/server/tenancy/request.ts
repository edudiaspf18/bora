import { effectiveHost, resolveHost, segmentFor } from "./host";
import { findTenantBySegment, type TenantRef } from "./lookup";

/** Resolve a loja pelo host da requisição (nunca por campo enviado pelo cliente). */
export async function tenantFromHeaders(
  h: Headers,
  rootDomain?: string,
): Promise<TenantRef | null> {
  const root = rootDomain ?? process.env.ROOT_DOMAIN ?? "localhost";
  const target = resolveHost(effectiveHost(h.get("host"), h.get("x-forwarded-host"), root), root);
  const seg = segmentFor(target);
  return seg ? findTenantBySegment(seg) : null;
}
