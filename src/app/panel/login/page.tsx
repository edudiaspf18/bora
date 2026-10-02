import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "../actions";

const ERRORS: Record<string, string> = {
  invalid: "E-mail ou senha incorretos.",
  throttled: "Muitas tentativas. Aguarde 15 minutos e tente de novo.",
  no_store: "Sua conta ainda não está vinculada a nenhuma loja.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">Acesse o painel da sua loja.</p>

      <form action={loginAction} className="mt-10 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        ) : null}
        <Button type="submit" className="w-full transition-all duration-200">
          Entrar
        </Button>
      </form>

      <Link
        href="/esqueci-senha"
        className="mt-6 inline-block text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Esqueci minha senha
      </Link>
    </main>
  );
}
