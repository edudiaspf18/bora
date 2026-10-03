import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { first } from "@/lib/search-params";
import { getTenantCached } from "@/server/tenancy/cached";
import { requestCodeAction, verifyCodeAction } from "./actions";

const ERRORS: Record<string, string> = {
  invalid_phone: "Telefone inválido. Use DDD + número.",
  throttled: "Muitas tentativas. Aguarde alguns minutos.",
  invalid: "Código incorreto.",
  expired: "Código expirado. Peça um novo.",
  locked: "Muitas tentativas erradas. Peça um novo código.",
  send_failed: "Não foi possível enviar o código. Tente novamente.",
};

type Param = string | string[] | undefined;

export default async function EnterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ etapa?: Param; tel?: Param; erro?: Param }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const etapa = first(query.etapa);
  const tel = first(query.tel);
  const erro = first(query.erro);
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();
  const message = erro && Object.hasOwn(ERRORS, erro) ? ERRORS[erro] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">{tenant.name}</p>

      {etapa === "codigo" && tel ? (
        <form action={verifyCodeAction} className="mt-10 space-y-5">
          <input type="hidden" name="phone" value={tel} />
          <div className="space-y-2">
            <Label htmlFor="code">Código enviado para {tel}</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              className="text-lg tracking-[0.4em]"
            />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full transition-all duration-200">
            Confirmar
          </Button>
          <Link
            href="/entrar"
            className="inline-block text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Usar outro número ou pedir novo código
          </Link>
        </form>
      ) : (
        <form action={requestCodeAction} className="mt-10 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone com DDD</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" required maxLength={32} />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full transition-all duration-200">
            Receber código
          </Button>
        </form>
      )}
    </main>
  );
}
