import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  const panelOrigin = process.env.PANEL_ORIGIN ?? "http://app.localhost:3000";

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-between px-6 py-12 md:py-24">
      <header className="flex items-center justify-between">
        <span className="text-2xl font-bold tracking-tight">
          bora<span className="text-[#EA580C]">.</span>
        </span>
        <a
          href={`${panelOrigin}/login`}
          className="text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Entrar
        </a>
      </header>

      <section className="max-w-3xl py-24">
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
          Seu cardápio no ar.
          <br />
          Seus pedidos na mão.
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-zinc-500">
          Restaurante, lanchonete ou quiosque de açaí: uma vitrine com a cara da sua marca e um painel simples para
          receber e acompanhar cada pedido.
        </p>
        <a
          href={`${panelOrigin}/login`}
          className="mt-12 inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-3 text-sm font-medium text-background transition-all duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Acessar o painel
          <ArrowRight className="size-4" />
        </a>
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
        bora, pedidos sem complicação.
      </footer>
    </main>
  );
}
