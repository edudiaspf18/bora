import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction } from "./actions";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sent = first((await searchParams).sent);

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Esqueci a senha</h1>
      {sent ? (
        <p role="status" className="mt-6 leading-relaxed text-zinc-500">
          Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 30 minutos.
        </p>
      ) : (
        <form action={requestResetAction} className="mt-10 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required maxLength={254} />
          </div>
          <Button type="submit" className="w-full transition-all duration-200">
            Enviar link
          </Button>
        </form>
      )}
      <Link
        href="/login"
        className="mt-6 inline-block text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Voltar ao login
      </Link>
    </main>
  );
}
