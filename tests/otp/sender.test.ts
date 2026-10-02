import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleSender, getOtpSender } from "@/server/otp/sender";

afterEach(() => vi.unstubAllEnvs());

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
    expect(getOtpSender()).not.toBe(consoleSender);
  });
  it("fora de produção, OTP_SENDER=file basta", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_SENDER", "file");
    expect(getOtpSender()).not.toBe(consoleSender);
  });
});
