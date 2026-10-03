import { auditLog } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";

export async function writeAudit(
  tenantId: string,
  entry: { actor: string; action: string; resource?: string; ip?: string },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.insert(auditLog).values({
      tenantId,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource ?? null,
      ip: entry.ip ?? null,
    }),
  );
}
