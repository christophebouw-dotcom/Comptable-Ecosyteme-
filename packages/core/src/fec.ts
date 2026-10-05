/**
 * Fichier des Écritures Comptables (FEC).
 *
 * Références :
 *  - Livre des procédures fiscales, art. L47 A-I (remise du FEC lors d'un contrôle) ;
 *  - LPF, art. A47 A-1 (structure : 18 zones, ordre chronologique de validation) ;
 *  - BOI-CF-IOR-60-40-20 (format et normes du fichier).
 *
 * Nom du fichier : <SIREN>FEC<AAAAMMJJ>.txt, où AAAAMMJJ est la date de clôture.
 * Séparateur : tabulation ou « | ». Montants avec virgule décimale, sans
 * séparateur de milliers. Dates au format AAAAMMJJ.
 */
import { type Cents, formatDecimalComma, toCents } from "./money.js";
import { isIsoDate } from "./ledger.js";
import { validateSiren } from "./validators.js";

export const FEC_COLUMNS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

export type FecColumn = (typeof FEC_COLUMNS)[number];

export interface FecLigne {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: string; // ISO
  compteNum: string;
  compteLib: string;
  compAuxNum?: string | null;
  compAuxLib?: string | null;
  pieceRef: string;
  pieceDate: string; // ISO
  ecritureLib: string;
  debit: Cents;
  credit: Cents;
  ecritureLet?: string | null;
  dateLet?: string | null; // ISO
  validDate: string; // ISO
  montantDevise?: Cents | null;
  idevise?: string | null;
}

export type FecSeparator = "\t" | "|";

export function fecFileName(siren: string, dateCloture: string): string {
  const check = validateSiren(siren);
  if (!check.valid) throw new Error(`SIREN invalide pour le FEC : ${check.reason}`);
  return `${siren.replace(/\s/g, "")}FEC${dateCloture.replace(/-/g, "")}.txt`;
}

const toFecDate = (iso?: string | null) => (iso ? iso.slice(0, 10).replace(/-/g, "") : "");

/** Neutralise les séparateurs et retours à la ligne dans les champs texte. */
function clean(value: string | null | undefined, sep: FecSeparator): string {
  if (!value) return "";
  return value.replace(/[\r\n\t]+/g, " ").split(sep).join(" ").trim();
}

/**
 * Génère le contenu texte du FEC. Les lignes doivent être fournies dans l'ordre
 * chronologique de validation des écritures (art. A47 A-1).
 */
export function generateFec(lignes: FecLigne[], separator: FecSeparator = "\t"): string {
  const rows: string[] = [FEC_COLUMNS.join(separator)];
  for (const l of lignes) {
    rows.push(
      [
        clean(l.journalCode, separator),
        clean(l.journalLib, separator),
        clean(l.ecritureNum, separator),
        toFecDate(l.ecritureDate),
        clean(l.compteNum, separator),
        clean(l.compteLib, separator),
        clean(l.compAuxNum, separator),
        clean(l.compAuxLib, separator),
        clean(l.pieceRef, separator),
        toFecDate(l.pieceDate),
        clean(l.ecritureLib, separator),
        formatDecimalComma(l.debit),
        formatDecimalComma(l.credit),
        clean(l.ecritureLet, separator),
        toFecDate(l.dateLet),
        toFecDate(l.validDate),
        l.montantDevise != null ? formatDecimalComma(l.montantDevise) : "",
        clean(l.idevise, separator),
      ].join(separator),
    );
  }
  return rows.join("\r\n") + "\r\n";
}

/** Table ISO 8859-15 pour les caractères qui diffèrent de l'ISO 8859-1. */
const LATIN9_SPECIFIC: Record<string, number> = {
  "€": 0xa4, "Š": 0xa6, "š": 0xa8, "Ž": 0xb4, "ž": 0xb8, "Œ": 0xbc, "œ": 0xbd, "Ÿ": 0xbe,
};
const LATIN9_REPLACED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

/**
 * Encode une chaîne en ISO 8859-15 (encodage admis par l'administration
 * fiscale pour le FEC). Les caractères non représentables sont remplacés par « ? ».
 */
export function encodeLatin9(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) {
    const special = LATIN9_SPECIFIC[ch];
    const code = ch.codePointAt(0)!;
    if (special !== undefined) out[i++] = special;
    else if (code < 0x100 && !LATIN9_REPLACED.has(code)) out[i++] = code;
    else out[i++] = 0x3f;
  }
  return out.subarray(0, i);
}

// ---------------------------------------------------------------------------
// Contrôle d'un FEC (équivalent simplifié de l'outil « Test Compta Demat »)
// ---------------------------------------------------------------------------

export interface FecAnomalie {
  ligne: number;
  zone?: FecColumn;
  message: string;
}

export interface FecControle {
  valide: boolean;
  nbLignes: number;
  nbEcritures: number;
  totalDebit: Cents;
  totalCredit: Cents;
  anomalies: FecAnomalie[];
}

const fromFecDate = (v: string) => (v ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : "");

/** Contrôle la structure et la cohérence d'un fichier FEC. */
export function controlerFec(content: string, maxAnomalies = 500): FecControle {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const anomalies: FecAnomalie[] = [];
  const push = (a: FecAnomalie) => {
    if (anomalies.length < maxAnomalies) anomalies.push(a);
  };
  const result: FecControle = { valide: false, nbLignes: 0, nbEcritures: 0, totalDebit: 0, totalCredit: 0, anomalies };
  if (lines.length === 0) {
    push({ ligne: 0, message: "Fichier vide" });
    return result;
  }
  const header = lines[0]!;
  const sep: FecSeparator = header.includes("\t") ? "\t" : "|";
  const cols = header.split(sep);
  if (cols.length !== FEC_COLUMNS.length || cols.some((c, i) => c.trim() !== FEC_COLUMNS[i])) {
    push({ ligne: 1, message: "En-tête non conforme : les 18 zones de l'art. A47 A-1 sont attendues dans l'ordre" });
    return result;
  }

  const parEcriture = new Map<string, { debit: Cents; credit: Cents; date: string; first: number }>();
  let lastValid = "";
  for (let i = 1; i < lines.length; i++) {
    const n = i + 1;
    const f = lines[i]!.split(sep);
    if (f.length !== FEC_COLUMNS.length) {
      push({ ligne: n, message: `${f.length} zones au lieu de 18` });
      continue;
    }
    result.nbLignes++;
    const get = (c: FecColumn) => f[FEC_COLUMNS.indexOf(c)]!.trim();
    for (const req of ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "PieceRef", "PieceDate", "EcritureLib", "ValidDate"] as const) {
      if (!get(req)) push({ ligne: n, zone: req, message: "Zone obligatoire non renseignée" });
    }
    for (const dz of ["EcritureDate", "PieceDate", "ValidDate", "DateLet"] as const) {
      const v = get(dz);
      if (v && !(/^\d{8}$/.test(v) && isIsoDate(fromFecDate(v)))) {
        push({ ligne: n, zone: dz, message: `Date invalide « ${v} » (format AAAAMMJJ attendu)` });
      }
    }
    if (get("CompAuxNum") && !get("CompAuxLib")) {
      push({ ligne: n, zone: "CompAuxLib", message: "Libellé du compte auxiliaire manquant" });
    }
    let debit = 0;
    let credit = 0;
    try {
      debit = toCents(get("Debit") || "0");
      credit = toCents(get("Credit") || "0");
    } catch {
      push({ ligne: n, zone: "Debit", message: "Montant non numérique" });
    }
    if (debit !== 0 && credit !== 0) push({ ligne: n, message: "Débit et crédit renseignés sur la même ligne" });
    result.totalDebit += debit;
    result.totalCredit += credit;

    const validDate = get("ValidDate");
    if (validDate && lastValid && validDate < lastValid) {
      push({ ligne: n, zone: "ValidDate", message: "Ordre chronologique de validation non respecté" });
    }
    if (validDate) lastValid = validDate;
    if (validDate && get("EcritureDate") && validDate < get("EcritureDate") && get("JournalCode") !== "AN") {
      // Admis (saisie anticipée impossible), on signale simplement l'incohérence.
      push({ ligne: n, zone: "ValidDate", message: "Date de validation antérieure à la date d'écriture" });
    }

    const key = `${get("JournalCode")}|${get("EcritureNum")}`;
    const cur = parEcriture.get(key) ?? { debit: 0, credit: 0, date: get("EcritureDate"), first: n };
    cur.debit += debit;
    cur.credit += credit;
    if (cur.date !== get("EcritureDate")) {
      push({ ligne: n, zone: "EcritureDate", message: `Écriture ${key} : dates différentes entre ses lignes` });
    }
    parEcriture.set(key, cur);
  }
  for (const [key, e] of parEcriture) {
    if (e.debit !== e.credit) push({ ligne: e.first, message: `Écriture ${key} déséquilibrée` });
  }
  result.nbEcritures = parEcriture.size;
  if (result.totalDebit !== result.totalCredit) {
    push({ ligne: 0, message: "Le total des débits diffère du total des crédits" });
  }
  result.valide = anomalies.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Lecture d'un FEC (reprise d'un dossier tenu dans un autre logiciel)
// ---------------------------------------------------------------------------

export interface EcritureFec {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  date: string;
  pieceRef: string;
  pieceDate: string;
  libelle: string;
  lignes: {
    compte: string;
    compteLib: string;
    compteAux: string | null;
    compteAuxLib: string | null;
    libelle: string;
    debit: Cents;
    credit: Cents;
  }[];
}

/**
 * Lit un FEC et regroupe ses lignes par écriture (JournalCode + EcritureNum).
 * Le fichier doit avoir passé controlerFec au préalable.
 */
export function parseFec(content: string): EcritureFec[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const sep: FecSeparator = lines[0]!.includes("\t") ? "\t" : "|";
  const map = new Map<string, EcritureFec>();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i]!.split(sep).map((x) => x.trim());
    if (f.length !== FEC_COLUMNS.length) continue;
    const g = (c: FecColumn) => f[FEC_COLUMNS.indexOf(c)]!;
    const key = `${g("JournalCode")}|${g("EcritureNum")}`;
    let e = map.get(key);
    if (!e) {
      e = {
        journalCode: g("JournalCode"),
        journalLib: g("JournalLib"),
        ecritureNum: g("EcritureNum"),
        date: fromFecDate(g("EcritureDate")),
        pieceRef: g("PieceRef") || g("EcritureNum"),
        pieceDate: fromFecDate(g("PieceDate") || g("EcritureDate")),
        libelle: g("EcritureLib"),
        lignes: [],
      };
      map.set(key, e);
    }
    e.lignes.push({
      compte: g("CompteNum"),
      compteLib: g("CompteLib"),
      compteAux: g("CompAuxNum") || null,
      compteAuxLib: g("CompAuxLib") || null,
      libelle: g("EcritureLib"),
      debit: toCents(g("Debit") || "0"),
      credit: toCents(g("Credit") || "0"),
    });
  }
  return [...map.values()];
}
