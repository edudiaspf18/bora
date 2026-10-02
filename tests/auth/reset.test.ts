import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { confirmPasswordReset, panelOrigin, requestPasswordReset, type Mailer } from "@/server/auth/reset";
import { closeDb, db } from "@/server/db/client";
import { staffUsers } from "@/server/db/schema";
import { adminSql, closeAdmin, createStaff, resetDb } from "../helpers/db";

vi.mock("@/server/auth/password", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/server/auth/password")>();
  return { ...m, hashPassword: vi.fn(m.hashPassword) };
});

const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  async send(to, subject, text) {
    sent.push({ to, subject, text });
  },
};

function tokenFromMail(): string {
  const match = sent.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("sem token no e-mail");
  return match[1];
}

beforeEach(async () => {
  vi.mocked(hashPassword).mockClear();
  sent.length = 0;
  await resetDb();
  await createStaff("dono@exemplo.com", "senha-antiga-123");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("reset de senha", () => {
  it("e-mail inexistente: não envia nada e não lança", async () => {
    await expect(requestPasswordReset("ninguem@exemplo.com", "1.1.1.1", mailer)).resolves.toBeUndefined();
    expect(sent.length).toBe(0);
  });

  it("fluxo completo troca a senha", async () => {
    await requestPasswordReset("  DONO@exemplo.com ", "1.1.1.1", mailer);
    expect(sent.length).toBe(1);
    const token = tokenFromMail();
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: true });
    const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, "dono@exemplo.com"));
    expect(await verifyPassword(user.passwordHash, "senha-nova-456789")).toBe(true);
    expect(await verifyPassword(user.passwordHash, "senha-antiga-123")).toBe(false);
  });

  it("o token é de uso único", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    await confirmPasswordReset(token, "senha-nova-456789");
    expect(await confirmPasswordReset(token, "outra-senha-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("token expirado (30 min) é recusado", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    await adminSql`update password_reset_tokens set expires_at = now() - interval '1 minute'`;
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("o token fica guardado com hash, nunca em claro", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    const rows = await adminSql`select token_hash from password_reset_tokens`;
    expect(rows[0].token_hash).not.toContain(token);
  });

  it("senha fraca é recusada sem consumir o token", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    expect(await confirmPasswordReset(token, "curta")).toEqual({ ok: false, reason: "weak" });
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: true });
  });

  it("token inventado ou vazio é recusado", async () => {
    expect(await confirmPasswordReset("inventado", "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmPasswordReset("", "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("no máximo 3 pedidos por e-mail em 15 min", async () => {
    for (let i = 0; i < 5; i++) await requestPasswordReset("dono@exemplo.com", `2.2.2.${i}`, mailer);
    expect(sent.length).toBe(3);
  });

  it("pedir novo reset invalida os tokens anteriores", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const first = tokenFromMail();
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    expect(await confirmPasswordReset(first, "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmPasswordReset(tokenFromMail(), "senha-nova-456789")).toEqual({ ok: true });
  });
});

describe("reset de senha: concorrência", () => {
  it("10 pedidos paralelos para o mesmo e-mail enviam no máximo 3 e-mails", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => requestPasswordReset("dono@exemplo.com", `3.3.3.${i}`, mailer)),
    );
    expect(sent.length).toBe(3);
  });

  it("duas confirmações simultâneas do mesmo token: só uma vence", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    const results = await Promise.all([
      confirmPasswordReset(token, "senha-nova-aaaaaa"),
      confirmPasswordReset(token, "senha-nova-bbbbbb"),
    ]);
    expect(results).toContainEqual({ ok: true });
    expect(results).toContainEqual({ ok: false, reason: "invalid" });
  });
});

describe("reset de senha: falha do mailer", () => {
  it("não lança nem vaza o link no log", async () => {
    const failing: Mailer = {
      async send() {
        throw new Error("smtp fora do ar");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(requestPasswordReset("dono@exemplo.com", "1.1.1.1", failing)).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain("token=");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DoS no reset", () => {
  it("token desconhecido não dispara hash Argon2", async () => {
    vi.mocked(hashPassword).mockClear();
    const r = await confirmPasswordReset("token-que-nao-existe", "senha-nova-valida-123");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(hashPassword).not.toHaveBeenCalled();
  });
});

describe("panelOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("produção sem PANEL_ORIGIN lança", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PANEL_ORIGIN", undefined);
    expect(() => panelOrigin()).toThrow(/PANEL_ORIGIN/);
  });
  it("produção com PANEL_ORIGIN usa o valor", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PANEL_ORIGIN", "https://app.bora.app");
    expect(panelOrigin()).toBe("https://app.bora.app");
  });
  it("fora de produção cai no fallback local", () => {
    vi.stubEnv("PANEL_ORIGIN", undefined);
    expect(panelOrigin()).toBe("http://app.localhost:3000");
  });
});
