import { redirect } from "next/navigation";
import { Building2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStaffContext } from "@/server/auth/staff";
import { logoutAction, selectTenantAction } from "./actions";

const ROLE_LABEL = { owner: "Dono", manager: "Gerente", attendant: "Atendente" } as const;

export default async function PanelHome() {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");

  if (!ctx.active) {
    return (
      <main>
        <h1 className="text-4xl font-bold tracking-tight">Escolha a loja</h1>
        <ul className="mt-10 space-y-3">
          {ctx.memberships.map((m) => (
            <li key={m.tenantId}>
              <form action={selectTenantAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between rounded-md border border-zinc-200 px-4 py-4 text-left transition-all duration-200 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-3">
                    <Building2 className="size-4 text-zinc-500" />
                    <span className="font-medium">{m.name}</span>
                  </span>
                  <span className="text-sm text-zinc-500">{ROLE_LABEL[m.role]}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main>
      <p className="text-sm text-zinc-500">{ROLE_LABEL[ctx.active.role]}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">{ctx.active.name}</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">
        Painel em construção. Pedidos, catálogo e estoque chegam nos próximos módulos.
      </p>
      <form action={logoutAction} className="mt-10">
        <Button type="submit" variant="outline" className="transition-all duration-200">
          <LogOut className="size-4" />
          Sair
        </Button>
      </form>
    </main>
  );
}
