import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTenantCached, getThemeCached } from "@/server/tenancy/cached";
import { themeToCss } from "@/server/theme/theme";

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  const theme = await getThemeCached(tenant.id);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      {/* Variáveis de tema no HTML do servidor: sem flash de cor errada. */}
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
      <div className="min-h-dvh bg-background font-[family-name:var(--font-store)] text-foreground">
        {children}
      </div>
    </>
  );
}
