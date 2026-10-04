import { describe, expect, it } from "vitest";
import { itemAvailability, type AvailabilityInput, type Window } from "@/server/catalog/availability";
import { localParts, startOfNextLocalDay, zonedDate } from "@/server/catalog/time";

const SP = "America/Sao_Paulo";
const TUE = 2;
const win = (weekday: number, opensMin: number, closesMin: number): Window => ({ weekday, opensMin, closesMin });
const item = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  pausedUntil: null,
  productSchedules: [],
  categorySchedules: [],
  ...over,
});
const at = (iso: string) => new Date(iso);

describe("time", () => {
  it("localParts devolve dia da semana e minuto no fuso da loja", () => {
    expect(localParts(at("2026-10-06T21:00:00Z"), SP)).toMatchObject({ weekday: TUE, minute: 18 * 60 });
  });
  it("zonedDate converte relógio de parede em instante", () => {
    expect(zonedDate(2026, 10, 6, 11 * 60, SP).toISOString()).toBe("2026-10-06T14:00:00.000Z");
    expect(zonedDate(2026, 10, 6, 1440, SP).toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });
  it("startOfNextLocalDay é a próxima meia-noite local", () => {
    expect(startOfNextLocalDay(at("2026-10-06T21:00:00Z"), SP).toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });
});

describe("itemAvailability", () => {
  it("sem horários ligados: sempre disponível", () => {
    expect(itemAvailability(item(), at("2026-10-06T21:00:00Z"), SP)).toEqual({ state: "available" });
  });

  it("abre inclusive e fecha exclusivo", () => {
    const lunch = item({ categorySchedules: [{ windows: [win(TUE, 660, 900)] }] });
    expect(itemAvailability(lunch, at("2026-10-06T14:00:00Z"), SP).state).toBe("available"); // 11:00
    expect(itemAvailability(lunch, at("2026-10-06T17:59:00Z"), SP).state).toBe("available"); // 14:59
    expect(itemAvailability(lunch, at("2026-10-06T18:00:00Z"), SP).state).toBe("out_of_hours"); // 15:00
  });

  it("fora do horário informa quando volta", () => {
    const lunch = item({ categorySchedules: [{ windows: [win(TUE, 660, 900)] }] });
    expect(itemAvailability(lunch, at("2026-10-06T13:59:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-06T14:00:00Z"),
    });
  });

  it("janela que cruza a meia-noite vale até o dia seguinte", () => {
    const night = item({ categorySchedules: [{ windows: [win(TUE, 1320, 120)] }] }); // ter 22:00–02:00
    expect(itemAvailability(night, at("2026-10-07T02:00:00Z"), SP).state).toBe("available"); // ter 23:00
    expect(itemAvailability(night, at("2026-10-07T04:00:00Z"), SP).state).toBe("available"); // qua 01:00
    expect(itemAvailability(night, at("2026-10-07T05:00:00Z"), SP).state).toBe("out_of_hours"); // qua 02:00
    expect(itemAvailability(night, at("2026-10-07T00:59:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-07T01:00:00Z"), // ter 22:00
    });
  });

  it("24h (0..1440) está sempre aberto no dia", () => {
    const all = item({ categorySchedules: [{ windows: [win(TUE, 0, 1440)] }] });
    expect(itemAvailability(all, at("2026-10-07T02:59:00Z"), SP).state).toBe("available"); // ter 23:59
  });

  it("horário do produto substitui o da categoria", () => {
    const openNow = { windows: [win(TUE, 0, 1440)] };
    const closedNow = { windows: [win(TUE, 0, 60)] };
    const i = item({ categorySchedules: [openNow], productSchedules: [closedNow] });
    expect(itemAvailability(i, at("2026-10-06T21:00:00Z"), SP).state).toBe("out_of_hours");
  });

  it("vários horários: basta um aberto; o retorno é o mais próximo", () => {
    const i = item({
      productSchedules: [
        { windows: [win(TUE, 1200, 1320)] }, // 20:00
        { windows: [win(TUE, 1140, 1200)] }, // 19:00
      ],
    });
    expect(itemAvailability(i, at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-06T22:00:00Z"), // 19:00
    });
    expect(itemAvailability(i, at("2026-10-06T22:30:00Z"), SP).state).toBe("available"); // 19:30
  });

  it("volta na semana seguinte quando a janela é de outro dia", () => {
    const mon = item({ categorySchedules: [{ windows: [win(1, 600, 720)] }] });
    expect(itemAvailability(mon, at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-12T13:00:00Z"), // seg 12/10 10:00 BRT
    });
  });

  it("horário sem janelas: fechado e sem retorno", () => {
    expect(itemAvailability(item({ productSchedules: [{ windows: [] }] }), at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: null,
    });
  });

  it("pausa vence o horário; pausa vencida é ignorada", () => {
    const until = at("2026-10-07T03:00:00Z");
    const now = at("2026-10-06T21:00:00Z");
    expect(itemAvailability(item({ pausedUntil: until }), now, SP)).toEqual({ state: "paused", until });
    expect(itemAvailability(item({ pausedUntil: at("2026-10-06T20:00:00Z") }), now, SP).state).toBe("available");
  });

  it("usa o fuso da loja, não o do servidor (Tóquio)", () => {
    const wed = item({ categorySchedules: [{ windows: [win(3, 540, 720)] }] }); // qua 09:00–12:00 JST
    expect(itemAvailability(wed, at("2026-10-06T21:00:00Z"), "Asia/Tokyo")).toEqual({
      state: "out_of_hours", // qua 06:00 JST
      nextOpensAt: at("2026-10-07T00:00:00Z"),
    });
  });
});
