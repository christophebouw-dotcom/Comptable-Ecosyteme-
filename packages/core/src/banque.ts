/**
 * Relevés bancaires : import (CSV des banques françaises, OFX), rapprochement
 * automatique avec le compte 512 et suggestion d'imputation.
 */
import { type Cents, toCents } from "./money.js";

export interface LigneReleve {
  date: string; // ISO
  libelle: string;
  /** Montant signé : positif = crédit sur le relevé (encaissement), négatif = débit (décaissement). */
  montant: Cents;
  /** Identifiant unique fourni par la banque (OFX FITID), pour éviter les doublons. */
  ref?: string | null;
}

export interface ResultatImport {
  lignes: LigneReleve[];
  erreurs: { ligne: number; message: string }[];
}

function dateFr(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})[/.-](\d{2})[/.-](\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Lit un relevé CSV. Les colonnes sont détectées par leur en-tête :
 * date (« date », « date opération »), libellé (« libellé », « description »),
 * et soit un montant signé (« montant »), soit deux colonnes débit / crédit.
 */
export function parseReleveCsv(text: string): ResultatImport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const erreurs: ResultatImport["erreurs"] = [];
  if (lines.length < 2) return { lignes: [], erreurs: [{ ligne: 0, message: "Fichier vide ou sans en-tête" }] };
  // Certaines banques ajoutent des lignes d'information avant l'en-tête.
  let headerIdx = lines.findIndex((l) => /date/i.test(l) && /(montant|debit|débit|credit|crédit)/i.test(l));
  if (headerIdx < 0) headerIdx = 0;
  const headerLine = lines[headerIdx]!;
  const sep = [";", "\t", ","].map((s) => [s, headerLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const headers = splitCsv(headerLine, sep).map(norm);
  const find = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
  const iDate = find("date operation", "date op", "date");
  const iLib = find("libelle", "description", "intitule", "operation", "detail");
  const iMontant = find("montant", "amount");
  const iDebit = find("debit");
  const iCredit = find("credit");
  if (iDate < 0 || iLib < 0 || (iMontant < 0 && (iDebit < 0 || iCredit < 0))) {
    return { lignes: [], erreurs: [{ ligne: headerIdx + 1, message: "Colonnes attendues : date, libellé, et montant (ou débit et crédit)" }] };
  }
  const lignes: LigneReleve[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const f = splitCsv(lines[i]!, sep);
    const date = dateFr(f[iDate] ?? "");
    if (!date) {
      erreurs.push({ ligne: i + 1, message: `Date illisible : « ${f[iDate] ?? ""} »` });
      continue;
    }
    try {
      let montant: Cents;
      if (iMontant >= 0 && f[iMontant]) montant = toCents(f[iMontant]!.replace(/^\+/, ""));
      else {
        const deb = f[iDebit] ? Math.abs(toCents(f[iDebit]!)) : 0;
        const cred = f[iCredit] ? Math.abs(toCents(f[iCredit]!)) : 0;
        montant = cred - deb;
      }
      if (montant === 0) continue;
      lignes.push({ date, libelle: (f[iLib] ?? "").replace(/\s+/g, " ").trim(), montant });
    } catch {
      erreurs.push({ ligne: i + 1, message: "Montant illisible" });
    }
  }
  return { lignes, erreurs };
}

/** Lit un relevé OFX (1.x SGML ou 2.x XML). */
export function parseOfx(text: string): ResultatImport {
  const lignes: LigneReleve[] = [];
  const erreurs: ResultatImport["erreurs"] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => new RegExp(`<${t}>([^<\\r\\n]*)`, "i").exec(b)?.[1]?.trim() ?? "";
  blocks.forEach((b, i) => {
    const date = dateFr(tag(b, "DTPOSTED"));
    const amt = tag(b, "TRNAMT");
    if (!date || !amt) {
      erreurs.push({ ligne: i + 1, message: "Transaction OFX incomplète" });
      return;
    }
    try {
      const libelle = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" ").replace(/\s+/g, " ");
      lignes.push({ date, libelle, montant: toCents(amt.replace(",", ".").replace(/^\+/, "")), ref: tag(b, "FITID") || null });
    } catch {
      erreurs.push({ ligne: i + 1, message: "Montant OFX illisible" });
    }
  });
  if (blocks.length === 0) erreurs.push({ ligne: 0, message: "Aucune transaction <STMTTRN> trouvée" });
  return { lignes, erreurs };
}

/** Clé de déduplication d'une ligne de relevé. */
export function cleReleve(l: LigneReleve): string {
  return l.ref ? `ref:${l.ref}` : `${l.date}|${l.montant}|${norm(l.libelle).replace(/\s+/g, "")}`;
}

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

export interface MouvementComptable {
  id: number;
  date: string;
  /** Montant signé vu de la banque : débit 512 = +, crédit 512 = -. */
  montant: Cents;
  libelle: string;
}

export interface Rapprochement {
  releveIndex: number;
  mouvementId: number;
  ecartJours: number;
}

const ecart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Rapproche les lignes de relevé et les mouvements du compte 512 : même
 * montant, dates distantes d'au plus `toleranceJours`. Pour chaque montant,
 * les deux listes sont triées par date puis appariées dans l'ordre, ce qui
 * minimise l'écart total de dates (appariement optimal en dimension 1).
 */
export function rapprocher(releve: LigneReleve[], mouvements: MouvementComptable[], toleranceJours = 10): Rapprochement[] {
  const groupes = new Map<Cents, { r: number[]; m: MouvementComptable[] }>();
  releve.forEach((l, i) => {
    const g = groupes.get(l.montant) ?? { r: [], m: [] };
    g.r.push(i);
    groupes.set(l.montant, g);
  });
  for (const m of mouvements) groupes.get(m.montant)?.m.push(m);
  const out: Rapprochement[] = [];
  for (const g of groupes.values()) {
    const r = [...g.r].sort((a, b) => releve[a]!.date.localeCompare(releve[b]!.date));
    const m = [...g.m].sort((a, b) => a.date.localeCompare(b.date));
    let i = 0;
    let j = 0;
    while (i < r.length && j < m.length) {
      const dr = releve[r[i]!]!.date;
      const dm = m[j]!.date;
      const e = ecart(dr, dm);
      if (e <= toleranceJours) {
        out.push({ releveIndex: r[i]!, mouvementId: m[j]!.id, ecartJours: Math.round(e) });
        i++;
        j++;
      } else if (dr < dm) i++;
      else j++;
    }
  }
  return out.sort((a, b) => a.releveIndex - b.releveIndex);
}

// ---------------------------------------------------------------------------
// Imputation suggérée
// ---------------------------------------------------------------------------

export interface RegleImputation {
  motif: string;
  compte: string;
  compteAux?: string | null;
  tauxTva?: number | null;
}

/** Règles par défaut, fondées sur les libellés bancaires usuels. */
export const REGLES_PAR_DEFAUT: RegleImputation[] = [
  { motif: "urssaf", compte: "431" },
  { motif: "dgfip tva", compte: "44551" },
  { motif: "impot.*societe|dgfip is|acompte is", compte: "444" },
  { motif: "dgfip|impots|tresor public", compte: "447" },
  { motif: "salaire|paie|virement salaire", compte: "421" },
  { motif: "frais|commission|cotisation carte|abonnement banque|agios", compte: "627", tauxTva: null },
  { motif: "interets debiteurs|agios", compte: "661" },
  { motif: "loyer", compte: "6132" },
  { motif: "edf|engie|total ?energies|eau ", compte: "6061" },
  { motif: "orange|sfr|bouygues|free ", compte: "626" },
  { motif: "assurance|axa|allianz|maif|macif|generali", compte: "616" },
  { motif: "carburant|station|total |esso|shell", compte: "6061" },
  { motif: "retraite|prevoyance|mutuelle|malakoff|humanis|ag2r", compte: "437" },
  { motif: "emprunt|echeance pret|remboursement pret", compte: "164" },
];

/**
 * Suggère un compte d'imputation pour une ligne de relevé : règles propres au
 * dossier d'abord (apprises des affectations précédentes), puis règles par
 * défaut. Retourne null si aucune règle ne correspond.
 */
export function suggererImputation(libelle: string, regles: RegleImputation[]): RegleImputation | null {
  const l = ` ${norm(libelle).replace(/[^a-z0-9]+/g, " ")} `;
  const correspond = (motif: string) => {
    // Règles par défaut : expressions alternatives (a|b) ; règles apprises : tous les mots présents.
    if (motif.includes("|")) return new RegExp(norm(motif)).test(l);
    const mots = norm(motif).split(/\s+/).filter(Boolean);
    return mots.length > 0 && mots.every((m) => l.includes(` ${m} `) || l.includes(` ${m}`));
  };
  for (const r of [...regles, ...REGLES_PAR_DEFAUT]) {
    try {
      if (correspond(r.motif)) return r;
    } catch {
      /* motif invalide : ignoré */
    }
  }
  return null;
}

/** Motif réutilisable déduit d'un libellé bancaire (on retire dates, montants et références). */
export function motifDepuisLibelle(libelle: string): string {
  return norm(libelle)
    .replace(/\d{2}[/.]\d{2}([/.]\d{2,4})?/g, " ")
    .replace(/\b[a-z]*\d[a-z0-9]*\b/g, " ")
    .replace(/\b(prlv|prelevement|vir|virement|sepa|cb|carte|recu|emis|de|du|la|le|des|ref|facture)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");
}
