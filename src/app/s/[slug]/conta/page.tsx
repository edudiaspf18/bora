import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCustomerSession } from "@/server/auth/customer";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getTenantCached } from "@/server/tenancy/cached";
import { customerLogoutAction } from "../entrar/actions";

export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  const session = await getCustomerSession(tenant.id);
  if (!session) redirect("/entrar");

  const [customer] = await db
    .select({ phone: customers.phone })
    .from(customers)
    .where(eq(customers.id, session.customerId))
    .limit(1);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm text-zinc-500">{tenant.name}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Sua conta</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">{customer?.phone}</p>
      <p className="mt-6 leading-relaxed text-zinc-500">Seus pedidos aparecem aqui assim que o cardápio abrir.</p>
      <form action={customerLogoutAction} className="mt-10">
        <Button type="submit" variant="outline" className="transition-all duration-200">
          <LogOut className="size-4" />
          Sair
        </Button>
      </form>
    </main>
  );
}
