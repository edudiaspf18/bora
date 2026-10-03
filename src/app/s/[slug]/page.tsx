import Link from "next/link";
import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { getTenantCached } from "@/server/tenancy/cached";

const VERTICAL_LABEL: Record<string, string> = {
  restaurante: "Restaurante",
  lanchonete: "Lanchonete",
  acaiteria: "Açaiteria",
  quiosque: "Quiosque",
};

export default async function StoreHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-12 md:py-24">
      <header className="flex items-center justify-between">
        <span className="size-3 rounded-full bg-primary" aria-hidden />
        <Link
          href="/entrar"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <User className="size-4" />
          Entrar
        </Link>
      </header>

      <section className="py-24">
        <p className="text-sm text-zinc-500">{Object.hasOwn(VERTICAL_LABEL, tenant.vertical) ? VERTICAL_LABEL[tenant.vertical] : "Loja"}</p>
        <h1 className="mt-3 text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">{tenant.name}</h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-500">
          O cardápio chega em breve. Por enquanto, entre com seu telefone para acompanhar seus pedidos.
        </p>
      </section>
    </main>
  );
}
