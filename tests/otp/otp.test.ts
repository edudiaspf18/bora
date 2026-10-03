import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { generateCode, issueOtp, verifyOtp } from "@/server/otp/otp";
import type { OtpSender } from "@/server/otp/sender";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const PHONE_RAW = "(62) 99828-6169";
const PHONE = "+5562998286169";
const sent: { phone: string; code: string }[] = [];
const sender: OtpSender = {
  async send(phone, code) {
    sent.push({ phone, code });
  },
};

let tenantA: string;
let tenantB: string;

const issue = (over: Partial<Parameters<typeof issueOtp>[0]> = {}) =>
  issueOtp({
    tenantId: tenantA,
    tenantSlug: "loja-a",
    rawPhone: PHONE_RAW,
    ip: "1.1.1.1",
    sender,
    ...over,
  });

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  tenantA = await createTenant("loja-a");
  tenantB = await createTenant("loja-b");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("generateCode", () => {
  it("sempre 6 dígitos, preservando zeros à esquerda", () => {
    for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe("issueOtp", () => {
  it("falha do sender vira send_failed tipado, sem lançar", async () => {
    const failing: OtpSender = {
      async send() {
        throw new Error("provedor fora");
      },
    };
    expect(await issue({ sender: failing })).toEqual({ ok: false, reason: "send_failed" });
  });

  it("telefone inválido é recusado sem enviar", async () => {
    expect(await issue({ rawPhone: "abc" })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(sent.length).toBe(0);
  });
  it("envia o código e guarda só o hash", async () => {
    expect(await issue()).toEqual({ ok: true, phone: PHONE });
    expect(sent).toHaveLength(1);
    expect(sent[0].phone).toBe(PHONE);
    const [row] = await adminSql`select code_hash from otp_codes`;
    expect(row.code_hash).not.toContain(sent[0].code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("o 6º pedido seguido para o mesmo telefone é barrado", async () => {
    for (let i = 0; i < 5; i++) expect((await issue({ ip: `3.3.3.${i}` })).ok).toBe(true);
    expect(await issue({ ip: "3.3.3.99" })).toEqual({ ok: false, reason: "throttled" });
  });
  it("10 pedidos paralelos para o mesmo telefone enviam exatamente 5", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => issue({ ip: `5.5.5.${i}` })),
    );
    expect(sent.length).toBe(5);
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === "throttled")).toHaveLength(5);
  });
  it("após 10 pedidos paralelos sobra exatamente 1 código não consumido", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => issue({ ip: `6.6.6.${i}` })));
    const rows = await adminSql`
      select 1 from otp_codes
      where tenant_id = ${tenantA} and phone = ${PHONE} and consumed_at is null`;
    expect(rows).toHaveLength(1);
  });
  it("um IP não pode pedir códigos sem fim para telefones diferentes", async () => {
    let blocked = false;
    for (let i = 0; i < 25; i++) {
      // 25 telefones válidos e distintos: (62) 9XXXX-XXXX
      const r = await issue({ rawPhone: `(62) 9${String(10_000_000 + i)}`, ip: "4.4.4.4" });
      if (!r.ok && r.reason === "throttled") blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe("verifyOtp", () => {
  it("código certo autentica e cria cliente + perfil da loja", async () => {
    await issue();
    const r = await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: sent[0].code });
    expect(r.ok).toBe(true);
    const customers = await adminSql`select phone from customers`;
    expect(customers.map((c) => c.phone)).toEqual([PHONE]);
    const profiles = await adminSql`select tenant_id from customer_profiles`;
    expect(profiles.map((p) => p.tenant_id)).toEqual([tenantA]);
  });

  it("código com zeros à esquerda funciona como texto", async () => {
    await issue({ generate: () => "004213" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "004213" })).ok).toBe(true);
  });

  it("código só vale uma vez", async () => {
    await issue({ generate: () => "123456" });
    await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" });
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("formato inválido é recusado sem gastar tentativa", async () => {
    await issue({ generate: () => "123456" });
    for (const bad of ["12345", "1234567", "abcdef", "", "12 456"]) {
      expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: bad })).toEqual({ ok: false, reason: "invalid" });
    }
    const [row] = await adminSql`select attempts from otp_codes`;
    expect(row.attempts).toBe(0);
  });

  it("5 erros travam: nem o código certo passa depois", async () => {
    await issue({ generate: () => "123456" });
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "000000" })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "locked" });
  });

  it("código expira em 10 minutos", async () => {
    const t0 = new Date("2026-01-01T12:00:00Z");
    await issue({ generate: () => "123456", now: t0 });
    const late = new Date(t0.getTime() + 10 * 60_000 + 1000);
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456", now: late })).toEqual({ ok: false, reason: "expired" });
  });

  it("um novo código invalida o anterior", async () => {
    await issue({ generate: () => "111111" });
    await issue({ generate: () => "222222" });
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "111111" })).toEqual({ ok: false, reason: "invalid" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "222222" })).ok).toBe(true);
  });

  it("código de uma loja não vale em outra", async () => {
    await issue({ generate: () => "123456" });
    expect(await verifyOtp({ tenantId: tenantB, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("o mesmo telefone vira um único cliente global com perfis por loja", async () => {
    await issue({ generate: () => "111111" });
    await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "111111" });
    await issueOtp({ tenantId: tenantB, tenantSlug: "loja-b", rawPhone: PHONE_RAW, ip: "1.1.1.1", sender, generate: () => "222222" });
    await verifyOtp({ tenantId: tenantB, rawPhone: PHONE_RAW, code: "222222" });
    expect((await adminSql`select 1 from customers`).length).toBe(1);
    expect((await adminSql`select 1 from customer_profiles`).length).toBe(2);
  });

  it("código antigo não ressuscita depois que o novo é consumido", async () => {
    await issue({ generate: () => "111111" });
    await issue({ generate: () => "222222" });
    // Simula a corrida: duas linhas não consumidas para o mesmo telefone.
    await adminSql`update otp_codes set consumed_at = null`;
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "222222" })).ok).toBe(true);
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "111111" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("aceita outros formatos do mesmo número", async () => {
    await issue({ generate: () => "123456" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: "+55 62 998286169", code: "123456" })).ok).toBe(true);
    await issue({ generate: () => "654321", ip: "2.2.2.2" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: "+5562998286169", code: "654321" })).ok).toBe(true);
  });
});
