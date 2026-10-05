import { describe, expect, it } from "vitest";
import { allocate, applyRate, formatDecimalComma, toCents } from "../src/index.js";

describe("montants", () => {
  it("convertit sans erreur d'arrondi flottant", () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
    expect(toCents("1 234,56 €")).toBe(123456);
    expect(toCents("1.234,5")).toBe(123450);
    expect(toCents("-12,3")).toBe(-1230);
    expect(() => toCents("abc")).toThrow();
  });
  it("arrondit les taux au centime (half away from zero)", () => {
    expect(applyRate(10000, 2000)).toBe(2000);
    expect(applyRate(1005, 550)).toBe(55); // 55,275 → 55
    expect(applyRate(-1005, 2000)).toBe(-201);
  });
  it("répartit sans perdre de centime", () => {
    const parts = allocate(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b)).toBe(10000);
  });
  it("formate pour le FEC", () => {
    expect(formatDecimalComma(123456)).toBe("1234,56");
    expect(formatDecimalComma(5)).toBe("0,05");
  });
});
