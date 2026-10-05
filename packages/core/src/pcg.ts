/**
 * Plan Comptable Général (règlement ANC n° 2014-03 modifié, notamment par le
 * règlement ANC n° 2022-06 applicable aux exercices ouverts à compter du
 * 1er janvier 2025).
 *
 * Sélection des comptes les plus utilisés en cabinet. Les comptes peuvent être
 * subdivisés librement (ex. 401 → 401DUPONT ou 4010001) tant que le préfixe à
 * 3 chiffres existe.
 */

export type AccountClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type AccountNature =
  | "capitaux"
  | "immobilisation"
  | "amortissement"
  | "stock"
  | "tiers"
  | "financier"
  | "charge"
  | "produit"
  | "special";

export interface PcgAccount {
  numero: string;
  libelle: string;
}

export const PCG_ACCOUNTS: readonly PcgAccount[] = [
  // Classe 1 — Comptes de capitaux
  { numero: "101", libelle: "Capital" },
  { numero: "1013", libelle: "Capital souscrit - appelé, versé" },
  { numero: "104", libelle: "Primes liées au capital social" },
  { numero: "106", libelle: "Réserves" },
  { numero: "1061", libelle: "Réserve légale" },
  { numero: "1068", libelle: "Autres réserves" },
  { numero: "108", libelle: "Compte de l'exploitant" },
  { numero: "110", libelle: "Report à nouveau (solde créditeur)" },
  { numero: "119", libelle: "Report à nouveau (solde débiteur)" },
  { numero: "120", libelle: "Résultat de l'exercice (bénéfice)" },
  { numero: "129", libelle: "Résultat de l'exercice (perte)" },
  { numero: "131", libelle: "Subventions d'équipement" },
  { numero: "139", libelle: "Subventions d'investissement inscrites au compte de résultat" },
  { numero: "145", libelle: "Amortissements dérogatoires" },
  { numero: "151", libelle: "Provisions pour risques" },
  { numero: "158", libelle: "Autres provisions pour charges" },
  { numero: "164", libelle: "Emprunts auprès des établissements de crédit" },
  { numero: "165", libelle: "Dépôts et cautionnements reçus" },
  { numero: "168", libelle: "Autres emprunts et dettes assimilées" },
  { numero: "1688", libelle: "Intérêts courus" },
  // Classe 2 — Comptes d'immobilisations
  { numero: "201", libelle: "Frais d'établissement" },
  { numero: "203", libelle: "Frais de développement" },
  { numero: "205", libelle: "Concessions, brevets, licences, logiciels" },
  { numero: "207", libelle: "Fonds commercial" },
  { numero: "211", libelle: "Terrains" },
  { numero: "213", libelle: "Constructions" },
  { numero: "215", libelle: "Installations techniques, matériel et outillage" },
  { numero: "2154", libelle: "Matériel industriel" },
  { numero: "218", libelle: "Autres immobilisations corporelles" },
  { numero: "2182", libelle: "Matériel de transport" },
  { numero: "2183", libelle: "Matériel de bureau et matériel informatique" },
  { numero: "2184", libelle: "Mobilier" },
  { numero: "231", libelle: "Immobilisations corporelles en cours" },
  { numero: "261", libelle: "Titres de participation" },
  { numero: "271", libelle: "Titres immobilisés" },
  { numero: "275", libelle: "Dépôts et cautionnements versés" },
  { numero: "280", libelle: "Amortissements des immobilisations incorporelles" },
  { numero: "2801", libelle: "Amortissements des frais d'établissement" },
  { numero: "2805", libelle: "Amortissements des logiciels" },
  { numero: "281", libelle: "Amortissements des immobilisations corporelles" },
  { numero: "2813", libelle: "Amortissements des constructions" },
  { numero: "2815", libelle: "Amortissements des installations techniques" },
  { numero: "2818", libelle: "Amortissements des autres immobilisations corporelles" },
  { numero: "290", libelle: "Dépréciations des immobilisations incorporelles" },
  { numero: "291", libelle: "Dépréciations des immobilisations corporelles" },
  { numero: "296", libelle: "Dépréciations des participations" },
  // Classe 3 — Comptes de stocks et en-cours
  { numero: "31", libelle: "Matières premières" },
  { numero: "33", libelle: "En-cours de production de biens" },
  { numero: "35", libelle: "Stocks de produits" },
  { numero: "37", libelle: "Stocks de marchandises" },
  { numero: "391", libelle: "Dépréciations des matières premières" },
  { numero: "397", libelle: "Dépréciations des stocks de marchandises" },
  // Classe 4 — Comptes de tiers
  { numero: "401", libelle: "Fournisseurs" },
  { numero: "403", libelle: "Fournisseurs - Effets à payer" },
  { numero: "404", libelle: "Fournisseurs d'immobilisations" },
  { numero: "408", libelle: "Fournisseurs - Factures non parvenues" },
  { numero: "409", libelle: "Fournisseurs débiteurs" },
  { numero: "4091", libelle: "Fournisseurs - Avances et acomptes versés" },
  { numero: "411", libelle: "Clients" },
  { numero: "413", libelle: "Clients - Effets à recevoir" },
  { numero: "416", libelle: "Clients douteux ou litigieux" },
  { numero: "418", libelle: "Clients - Produits non encore facturés" },
  { numero: "419", libelle: "Clients créditeurs" },
  { numero: "4191", libelle: "Clients - Avances et acomptes reçus" },
  { numero: "421", libelle: "Personnel - Rémunérations dues" },
  { numero: "425", libelle: "Personnel - Avances et acomptes" },
  { numero: "428", libelle: "Personnel - Charges à payer" },
  { numero: "431", libelle: "Sécurité sociale" },
  { numero: "437", libelle: "Autres organismes sociaux" },
  { numero: "442", libelle: "Contributions, impôts et taxes recouvrés pour le compte de l'État" },
  { numero: "4421", libelle: "Prélèvements à la source (impôt sur le revenu)" },
  { numero: "444", libelle: "État - Impôts sur les bénéfices" },
  { numero: "445", libelle: "État - Taxes sur le chiffre d'affaires" },
  { numero: "4452", libelle: "TVA due intracommunautaire" },
  { numero: "4455", libelle: "Taxes sur le chiffre d'affaires à décaisser" },
  { numero: "44551", libelle: "TVA à décaisser" },
  { numero: "4456", libelle: "Taxes sur le chiffre d'affaires déductibles" },
  { numero: "44562", libelle: "TVA sur immobilisations" },
  { numero: "44566", libelle: "TVA sur autres biens et services" },
  { numero: "44567", libelle: "Crédit de TVA à reporter" },
  { numero: "4457", libelle: "Taxes sur le chiffre d'affaires collectées" },
  { numero: "44571", libelle: "TVA collectée" },
  { numero: "4458", libelle: "Taxes sur le chiffre d'affaires à régulariser" },
  { numero: "44583", libelle: "Remboursement de taxes sur le CA demandé" },
  { numero: "44586", libelle: "TVA sur factures non parvenues" },
  { numero: "44587", libelle: "TVA sur factures à établir" },
  { numero: "447", libelle: "Autres impôts, taxes et versements assimilés" },
  { numero: "455", libelle: "Associés - Comptes courants" },
  { numero: "4551", libelle: "Associés - Principal" },
  { numero: "457", libelle: "Associés - Dividendes à payer" },
  { numero: "462", libelle: "Créances sur cessions d'immobilisations" },
  { numero: "467", libelle: "Autres comptes débiteurs ou créditeurs" },
  { numero: "471", libelle: "Compte d'attente" },
  { numero: "486", libelle: "Charges constatées d'avance" },
  { numero: "487", libelle: "Produits constatés d'avance" },
  { numero: "491", libelle: "Dépréciations des comptes de clients" },
  // Classe 5 — Comptes financiers
  { numero: "503", libelle: "Actions" },
  { numero: "508", libelle: "Autres valeurs mobilières" },
  { numero: "511", libelle: "Valeurs à l'encaissement" },
  { numero: "512", libelle: "Banques" },
  { numero: "514", libelle: "Chèques postaux" },
  { numero: "517", libelle: "Autres organismes financiers" },
  { numero: "519", libelle: "Concours bancaires courants" },
  { numero: "530", libelle: "Caisse" },
  { numero: "580", libelle: "Virements internes" },
  { numero: "590", libelle: "Dépréciations des valeurs mobilières de placement" },
  // Classe 6 — Comptes de charges
  { numero: "601", libelle: "Achats stockés - Matières premières" },
  { numero: "602", libelle: "Achats stockés - Autres approvisionnements" },
  { numero: "603", libelle: "Variation des stocks" },
  { numero: "6037", libelle: "Variation des stocks de marchandises" },
  { numero: "604", libelle: "Achats d'études et prestations de services" },
  { numero: "606", libelle: "Achats non stockés de matières et fournitures" },
  { numero: "6061", libelle: "Fournitures non stockables (eau, énergie)" },
  { numero: "6063", libelle: "Fournitures d'entretien et petit équipement" },
  { numero: "6064", libelle: "Fournitures administratives" },
  { numero: "607", libelle: "Achats de marchandises" },
  { numero: "609", libelle: "Rabais, remises et ristournes obtenus sur achats" },
  { numero: "611", libelle: "Sous-traitance générale" },
  { numero: "613", libelle: "Locations" },
  { numero: "6132", libelle: "Locations immobilières" },
  { numero: "6135", libelle: "Locations mobilières" },
  { numero: "614", libelle: "Charges locatives et de copropriété" },
  { numero: "615", libelle: "Entretien et réparations" },
  { numero: "616", libelle: "Primes d'assurances" },
  { numero: "618", libelle: "Divers (documentation, colloques)" },
  { numero: "621", libelle: "Personnel extérieur à l'entreprise" },
  { numero: "622", libelle: "Rémunérations d'intermédiaires et honoraires" },
  { numero: "6226", libelle: "Honoraires" },
  { numero: "623", libelle: "Publicité, publications, relations publiques" },
  { numero: "624", libelle: "Transports de biens et transports collectifs du personnel" },
  { numero: "625", libelle: "Déplacements, missions et réceptions" },
  { numero: "626", libelle: "Frais postaux et de télécommunications" },
  { numero: "627", libelle: "Services bancaires et assimilés" },
  { numero: "628", libelle: "Divers (cotisations)" },
  { numero: "631", libelle: "Impôts, taxes sur rémunérations (administration des impôts)" },
  { numero: "633", libelle: "Impôts, taxes sur rémunérations (autres organismes)" },
  { numero: "635", libelle: "Autres impôts, taxes (administration des impôts)" },
  { numero: "6351", libelle: "Impôts directs (CFE, CVAE, taxe foncière)" },
  { numero: "637", libelle: "Autres impôts, taxes (autres organismes)" },
  { numero: "641", libelle: "Rémunérations du personnel" },
  { numero: "6411", libelle: "Salaires, appointements" },
  { numero: "644", libelle: "Rémunération du travail de l'exploitant" },
  { numero: "645", libelle: "Charges de sécurité sociale et de prévoyance" },
  { numero: "646", libelle: "Cotisations sociales personnelles de l'exploitant" },
  { numero: "647", libelle: "Autres charges sociales" },
  { numero: "651", libelle: "Redevances pour concessions, brevets, licences" },
  { numero: "654", libelle: "Pertes sur créances irrécouvrables" },
  { numero: "658", libelle: "Charges diverses de gestion courante" },
  { numero: "661", libelle: "Charges d'intérêts" },
  { numero: "666", libelle: "Pertes de change financières" },
  { numero: "668", libelle: "Autres charges financières" },
  { numero: "671", libelle: "Charges exceptionnelles sur opérations de gestion" },
  { numero: "675", libelle: "Valeurs comptables des éléments d'actif cédés" },
  { numero: "681", libelle: "Dotations aux amortissements, dépréciations et provisions - exploitation" },
  { numero: "6811", libelle: "Dotations aux amortissements sur immobilisations" },
  { numero: "686", libelle: "Dotations aux amortissements, dépréciations et provisions - financières" },
  { numero: "687", libelle: "Dotations aux amortissements, dépréciations et provisions - exceptionnelles" },
  { numero: "691", libelle: "Participation des salariés aux résultats" },
  { numero: "695", libelle: "Impôts sur les bénéfices" },
  // Classe 7 — Comptes de produits
  { numero: "701", libelle: "Ventes de produits finis" },
  { numero: "704", libelle: "Travaux" },
  { numero: "706", libelle: "Prestations de services" },
  { numero: "707", libelle: "Ventes de marchandises" },
  { numero: "708", libelle: "Produits des activités annexes" },
  { numero: "709", libelle: "Rabais, remises et ristournes accordés" },
  { numero: "713", libelle: "Variation des stocks (en-cours de production, produits)" },
  { numero: "721", libelle: "Production immobilisée - immobilisations incorporelles" },
  { numero: "740", libelle: "Subventions d'exploitation" },
  { numero: "751", libelle: "Redevances pour concessions, brevets, licences" },
  { numero: "758", libelle: "Produits divers de gestion courante" },
  { numero: "761", libelle: "Produits de participations" },
  { numero: "764", libelle: "Revenus des valeurs mobilières de placement" },
  { numero: "766", libelle: "Gains de change financiers" },
  { numero: "768", libelle: "Autres produits financiers" },
  { numero: "771", libelle: "Produits exceptionnels sur opérations de gestion" },
  { numero: "775", libelle: "Produits des cessions d'éléments d'actif" },
  { numero: "777", libelle: "Quote-part des subventions d'investissement virée au résultat" },
  { numero: "781", libelle: "Reprises sur amortissements, dépréciations et provisions - exploitation" },
  { numero: "786", libelle: "Reprises sur dépréciations et provisions - financières" },
  { numero: "787", libelle: "Reprises sur dépréciations et provisions - exceptionnelles" },
  { numero: "791", libelle: "Transferts de charges d'exploitation" },
];

const byNumero = new Map(PCG_ACCOUNTS.map((a) => [a.numero, a]));

/** Format d'un numéro de compte : chiffre de classe 1-8 puis chiffres ou lettres. */
const ACCOUNT_FORMAT = /^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/;

export function isValidAccountNumber(numero: string): boolean {
  return ACCOUNT_FORMAT.test(numero);
}

export function accountClass(numero: string): AccountClass {
  const c = Number(numero[0]);
  if (!isValidAccountNumber(numero)) throw new Error(`Numéro de compte invalide : ${numero}`);
  return c as AccountClass;
}

/** Trouve le compte PCG de référence le plus spécifique (préfixe le plus long). */
export function findPcgParent(numero: string): PcgAccount | undefined {
  for (let len = Math.min(numero.length, 6); len >= 2; len--) {
    const hit = byNumero.get(numero.slice(0, len));
    if (hit) return hit;
  }
  return undefined;
}

/** Comptes de dépréciation / amortissement : soldes créditeurs venant en diminution de l'actif. */
export function isContraAsset(numero: string): boolean {
  return /^(28|29|39|49|59)/.test(numero);
}

export function accountNature(numero: string): AccountNature {
  switch (accountClass(numero)) {
    case 1:
      return "capitaux";
    case 2:
      return isContraAsset(numero) ? "amortissement" : "immobilisation";
    case 3:
      return isContraAsset(numero) ? "amortissement" : "stock";
    case 4:
      return "tiers";
    case 5:
      return "financier";
    case 6:
      return "charge";
    case 7:
      return "produit";
    default:
      return "special";
  }
}

/** Les comptes de tiers 401 et 411 se ventilent en comptes auxiliaires. */
export function isCollectifTiers(numero: string): "fournisseur" | "client" | null {
  if (numero.startsWith("401") || numero.startsWith("404")) return "fournisseur";
  if (numero.startsWith("411")) return "client";
  return null;
}

/** Comptes de bilan (classes 1 à 5) dont le solde est reporté à nouveau. */
export function isBalanceSheetAccount(numero: string): boolean {
  const c = accountClass(numero);
  return c >= 1 && c <= 5;
}

/** Libellé par défaut d'un compte, déduit du PCG si non renseigné. */
export function defaultLabel(numero: string): string {
  return byNumero.get(numero)?.libelle ?? findPcgParent(numero)?.libelle ?? `Compte ${numero}`;
}

/** Journaux standards d'un dossier. */
export const STANDARD_JOURNALS = [
  { code: "AC", libelle: "Achats", type: "achat" },
  { code: "VE", libelle: "Ventes", type: "vente" },
  { code: "BQ", libelle: "Banque", type: "tresorerie" },
  { code: "CA", libelle: "Caisse", type: "tresorerie" },
  { code: "OD", libelle: "Opérations diverses", type: "od" },
  { code: "AN", libelle: "À-nouveaux", type: "anouveau" },
] as const;
