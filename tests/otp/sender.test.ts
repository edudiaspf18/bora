import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleSender, getOtpSender } from "@/server/otp/sender";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("consoleSender", () => {
  it("produção não loga o código", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleSender.send("5511999999999", "123456", { tenantSlug: "x" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("123456");
  });
  it("fora de produção loga o código", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleSender.send("5511999999999", "123456", { tenantSlug: "x" });
    expect(JSON.stringify(log.mock.calls)).toContain("123456");
  });
});

describe("getOtpSender", () => {
  it("produção ignora OTP_SENDER=file", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_SENDER", "file");
    expect(getOtpSender()).toBe(consoleSender);
  });
  it("produção só aceita file com o opt-in explícito de E2E", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_SENDER", "file");
    vi.stubEnv("E2E_UNSAFE_FILE_OTP", "1");
    vi.stubEnv("ROOT_DOMAIN", "localhost");
    expect(getOtpSender()).not.toBe(consoleSender);
  });
  it("fora de produção, OTP_SENDER=file basta", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_SENDER", "file");
    expect(getOtpSender()).not.toBe(consoleSender);
  });
  it.each(["true", "0", ""])("produção: E2E_UNSAFE_FILE_OTP=%j não abre o file sender", (value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_SENDER", "file");
    vi.stubEnv("ROOT_DOMAIN", "localhost");
    vi.stubEnv("E2E_UNSAFE_FILE_OTP", value);
    expect(getOtpSender()).toBe(consoleSender);
  });
  it("produção: file sender exige ROOT_DOMAIN local mesmo com opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_SENDER", "file");
    vi.stubEnv("E2E_UNSAFE_FILE_OTP", "1");
    vi.stubEnv("ROOT_DOMAIN", "bora.app");
    expect(getOtpSender()).toBe(consoleSender);
    vi.stubEnv("ROOT_DOMAIN", "bora.localhost");
    expect(getOtpSender()).not.toBe(consoleSender);
    vi.stubEnv("ROOT_DOMAIN", "localhost");
    expect(getOtpSender()).not.toBe(consoleSender);
  });
});
