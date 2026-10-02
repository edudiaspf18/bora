import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmResetAction } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Link inválido ou expirado. Peça um novo.",
  weak: "A senha precisa ter de 10 a 128 caracteres.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = first(params.token);
  const error = first(params.error);
  if (!token) {
    return <p className="text-zinc-500">Link inválido. Peça um novo na tela de login.</p>;
  }

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Nova senha</h1>
      <form action={confirmResetAction} className="mt-10 space-y-5">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
        </div>
        {error && Object.hasOwn(ERRORS, error) ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {ERRORS[error]}
          </p>
        ) : null}
        <Button type="submit" className="w-full transition-all duration-200">
          Salvar senha
        </Button>
      </form>
    </main>
  );
}
