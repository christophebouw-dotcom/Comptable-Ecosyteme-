import { describe, expect, it } from "vitest";
import {
  frenchVatNumber, maskIban, validateBic, validateIban, validateSiren, validateSiret, validateVatNumber,
} from "../src/index.js";

describe("SIREN / SIRET", () => {
  it("accepte un SIREN valide et rejette une clé fausse", () => {
    expect(validateSiren("404 833 048").valid).toBe(true);
    expect(validateSiren("404833049").valid).toBe(false);
    expect(validateSiren("12345").reason).toMatch(/9 chiffres/);
  });
  it("valide un SIRET (Luhn) et la règle spécifique La Poste", () => {
    expect(validateSiret("40483304800022").valid).toBe(true);
    expect(validateSiret("40483304800023").valid).toBe(false);
    expect(validateSiret("35600000049837").valid).toBe(true); // somme des chiffres multiple de 5
  });
});

describe("TVA intracommunautaire", () => {
  it("calcule la clé française à partir du SIREN", () => {
    expect(frenchVatNumber("404833048")).toBe("FR83404833048");
  });
  it("valide les numéros français et européens", () => {
    expect(validateVatNumber("FR 83 404833048").valid).toBe(true);
    expect(validateVatNumber("FR84404833048").valid).toBe(false);
    expect(validateVatNumber("DE123456789").valid).toBe(true);
    expect(validateVatNumber("XX123").valid).toBe(false);
  });
});

describe("IBAN / BIC", () => {
  it("valide la clé mod 97", () => {
    expect(validateIban("FR76 3000 6000 0112 3456 7890 189").valid).toBe(true);
    expect(validateIban("FR7630006000011234567890188").valid).toBe(false);
    expect(validateIban("DE89370400440532013000").valid).toBe(true);
    expect(validateIban("FR763000600001").reason).toMatch(/27/);
  });
  it("masque un IBAN pour l'affichage", () => {
    expect(maskIban("FR7630006000011234567890189")).toBe("FR76 **** **** **** **** ***0 189");
  });
  it("valide un BIC", () => {
    expect(validateBic("BNPAFRPP").valid).toBe(true);
    expect(validateBic("BNPAFRPPXXX").valid).toBe(true);
    expect(validateBic("BNP").valid).toBe(false);
  });
});
