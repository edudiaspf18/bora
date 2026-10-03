import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { hit, resetThrottle, retryAfterMs } from "@/server/auth/throttle";
import { adminSql, closeAdmin, resetDb } from "../helpers/db";

const OPTS = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const T0 = new Date("2026-01-01T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(resetDb);
afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("throttle", () => {
  it("hit concorrente com resetThrottle nunca lança", async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.all([hit("race", OPTS), resetThrottle("race"), hit("race", OPTS)]);
    }
  });

  it("window_start ilegível falha fechado (bloqueia)", async () => {
    await hit("k", OPTS, T0);
    await adminSql`update throttles set window_start = 'infinity' where key = 'k'`;
    // infinity vira Invalid Date no cliente: não pode liberar
    const res = await hit("k", OPTS, at(1));
    expect(res.blocked).toBe(true);
  });

  it("chave nova não está bloqueada", async () => {
    expect(await retryAfterMs("k", T0)).toBe(0);
  });

  it("a 5ª ocorrência bloqueia; as 4 primeiras não", async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await hit("k", OPTS, at(i))).blocked).toBe(false);
    }
    expect((await hit("k", OPTS, at(5))).blocked).toBe(true);
    expect(await retryAfterMs("k", at(6))).toBeGreaterThan(14 * 60_000);
  });

  it("libera depois do tempo de bloqueio e recomeça a contar", async () => {
    for (let i = 0; i < 5; i++) await hit("k", OPTS, at(i));
    expect(await retryAfterMs("k", at(OPTS.blockMs + 10))).toBe(0);
    expect((await hit("k", OPTS, at(OPTS.blockMs + 10))).blocked).toBe(false);
  });

  it("a janela expirada zera a contagem", async () => {
    for (let i = 0; i < 4; i++) await hit("k", OPTS, at(i));
    const later = at(OPTS.windowMs + 1000);
    expect((await hit("k", OPTS, later)).blocked).toBe(false);
    const [row] = await adminSql`select failures from throttles where key = 'k'`;
    expect(row.failures).toBe(1);
  });

  it("resetThrottle limpa", async () => {
    for (let i = 0; i < 5; i++) await hit("k", OPTS, at(i));
    await resetThrottle("k");
    expect(await retryAfterMs("k", at(10))).toBe(0);
  });

  it("chaves são independentes", async () => {
    for (let i = 0; i < 5; i++) await hit("a", OPTS, at(i));
    expect(await retryAfterMs("b", at(10))).toBe(0);
  });

  it("20 ocorrências concorrentes não escapam do bloqueio", async () => {
    await Promise.all(Array.from({ length: 20 }, () => hit("c", OPTS, T0)));
    expect(await retryAfterMs("c", at(1))).toBeGreaterThan(0);
    const [row] = await adminSql`select failures, blocked_until from throttles where key = 'c'`;
    expect(row.blocked_until).not.toBeNull();
    expect(row.failures).toBe(5);
  });

  it("4 ocorrências concorrentes contam exatamente 4 e não bloqueiam", async () => {
    await Promise.all(Array.from({ length: 4 }, () => hit("d", OPTS, T0)));
    const [row] = await adminSql`select failures, blocked_until from throttles where key = 'd'`;
    expect(row.failures).toBe(4);
    expect(row.blocked_until).toBeNull();
  });

  it("hit enquanto bloqueado não incrementa nem altera blocked_until", async () => {
    for (let i = 1; i <= 5; i++) await hit("k", OPTS, at(i));
    const [before] = await adminSql`select failures, blocked_until from throttles where key = 'k'`;
    for (let i = 6; i <= 8; i++) {
      expect(await hit("k", OPTS, at(i))).toEqual({ blocked: true });
    }
    const [after] = await adminSql`select failures, blocked_until from throttles where key = 'k'`;
    expect(after.failures).toBe(5);
    expect(after.blocked_until).toEqual(before.blocked_until);
  });

  it("hit espera o lock da linha (FOR UPDATE) e relê o valor commitado", async () => {
    for (let i = 1; i <= 3; i++) await hit("k", OPTS, at(i));
    let p!: Promise<{ blocked: boolean }>;
    await adminSql.begin(async (t) => {
      await t`select * from throttles where key = 'k' for update`;
      p = hit("k", OPTS, at(10));
      await new Promise((r) => setTimeout(r, 200)); // hit fica parado no lock
      await t`update throttles set failures = 4 where key = 'k'`;
    });
    expect(await p).toEqual({ blocked: true });
    const [row] = await adminSql`select failures, blocked_until from throttles where key = 'k'`;
    expect(row.failures).toBe(5);
    expect(row.blocked_until).not.toBeNull();
  });
});
