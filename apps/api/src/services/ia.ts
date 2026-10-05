/**
 * Assistance par intelligence artificielle (Claude, Anthropic).
 *
 * Rôle limité et encadré :
 *  - l'IA LIT les pièces (factures PDF, photos de tickets) et PROPOSE une
 *    imputation ; elle ne valide jamais rien ;
 *  - toute donnée extraite repasse par les contrôles déterministes du cœur
 *    métier (cohérence HT + TVA = TTC, taux, SIREN, dates) ;
 *  - l'écriture reste en brouillard jusqu'à la validation humaine.
 *
 * RGPD : Anthropic agit en sous-traitant (art. 28). L'IA est désactivée par
 * défaut et doit être autorisée dossier par dossier ; seules les données
 * nécessaires sont transmises (minimisation, art. 5.1.c).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type ExtractionPiece, PCG_ACCOUNTS, type TypePiece } from "@compta/core";
import { z } from "zod";

export interface DocumentSource {
  nomFichier: string;
  mime: string;
  base64: string;
}

export interface ContexteDossier {
  raisonSociale: string;
  siren: string;
  /** Imputations habituelles du dossier (fournisseur → compte), pour la cohérence. */
  habitudes: { tiers: string; compte: string }[];
}

export interface UsageIA {
  modele: string;
  tokensEntree: number;
  tokensSortie: number;
}

export interface SuggestionImputation {
  id: number;
  compte: string;
  compteAux: string | null;
  confiance: number;
  justification: string;
}

export interface AssistantIA {
  readonly modele: string;
  extrairePiece(doc: DocumentSource, ctx: ContexteDossier): Promise<{ extraction: ExtractionPiece; usage: UsageIA }>;
  suggererImputations(
    lignes: { id: number; date: string; libelle: string; montant: number }[],
    ctx: ContexteDossier & { tiers: { compteAux: string; nom: string; type: string }[] },
  ): Promise<{ suggestions: SuggestionImputation[]; usage: UsageIA }>;
}

export class ErreurIA extends Error {
  override name = "ErreurIA";
}

// ---------------------------------------------------------------------------
// Schémas de sortie structurée (montants en euros, convertis en centimes ensuite)
// ---------------------------------------------------------------------------

const partieSchema = z.object({
  nom: z.string().nullable(),
  siren: z.string().nullable().describe("9 chiffres, sans espaces ; déduit du SIRET ou du n° de TVA FR si nécessaire"),
  tvaIntra: z.string().nullable(),
  adresse: z.string().nullable(),
  iban: z.string().nullable(),
});

const TYPES: [TypePiece, ...TypePiece[]] = ["facture_achat", "avoir_achat", "facture_vente", "avoir_vente", "ticket", "note_frais", "autre"];

const extractionSchema = z.object({
  typeDocument: z.enum(TYPES),
  emetteur: partieSchema,
  destinataire: partieSchema,
  numero: z.string().nullable(),
  dateFacture: z.string().nullable().describe("Format AAAA-MM-JJ"),
  dateEcheance: z.string().nullable().describe("Format AAAA-MM-JJ"),
  devise: z.string().describe("Code ISO 4217, ex. EUR"),
  lignes: z.array(z.object({ designation: z.string(), montantHT: z.number(), tauxTva: z.number().describe("En pourcentage, ex. 20 ou 5.5") })),
  ventilationTva: z.array(z.object({ tauxTva: z.number(), baseHT: z.number(), tva: z.number() })),
  totalHT: z.number(),
  totalTVA: z.number(),
  totalTTC: z.number(),
  compteSuggere: z.string().nullable().describe("Numéro de compte du PCG français (classe 6 pour une charge, 2 pour une immobilisation, 7 pour une vente)"),
  justificationCompte: z.string().nullable(),
  confiance: z.number().describe("Entre 0 et 1 : 1 si tout est parfaitement lisible"),
  remarques: z.array(z.string()),
});

const suggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.number(),
      compte: z.string(),
      compteAux: z.string().nullable(),
      confiance: z.number(),
      justification: z.string(),
    }),
  ),
});

const euros = (n: number) => Math.round(n * 100);
const taux = (pct: number) => Math.round(pct * 100);

/** Plan comptable abrégé transmis au modèle (classes 2, 6 et 7), stable pour le cache. */
const PLAN_ABREGE = PCG_ACCOUNTS.filter((a) => /^(2[0-1]|6|7)/.test(a.numero))
  .map((a) => `${a.numero} ${a.libelle}`)
  .join("\n");

const SYSTEM_EXTRACTION = `Tu es un assistant de saisie comptable pour un cabinet d'expertise comptable français.
Tu lis une pièce justificative (facture, avoir, ticket, note de frais) et tu en extrais les données de façon exacte.

Règles :
- Recopie les montants tels qu'imprimés ; n'invente aucune valeur. Si une donnée est absente ou illisible, renvoie null (ou une liste vide) et baisse la confiance.
- Les montants sont en euros, avec deux décimales. Les taux de TVA sont en pourcentage (20, 10, 5.5, 2.1, 0).
- "facture_achat" si le dossier est le client (destinataire) ; "facture_vente" si le dossier est l'émetteur ; "avoir_*" pour un avoir ou une note de crédit.
- Propose le compte du Plan Comptable Général le plus précis possible, en privilégiant les habitudes du dossier quand le fournisseur est connu. Un bien durable de plus de 500 € HT va en classe 2.
- Signale dans "remarques" tout point douteux : montant raturé, TVA absente, mentions obligatoires manquantes, document qui n'est pas une pièce comptable.

Plan comptable de référence (extrait) :
${PLAN_ABREGE}`;

const SYSTEM_BANQUE = `Tu es un assistant comptable français. Pour chaque opération bancaire, propose le compte du Plan Comptable Général à mouvementer en contrepartie du compte de banque 512.
- Paiement d'un fournisseur connu : 401 avec son code auxiliaire. Encaissement d'un client connu : 411 avec son code auxiliaire.
- Sinon, le compte de charge ou de produit le plus probable (627 frais bancaires, 6061 énergie, 626 télécoms, 431 URSSAF, 44551 TVA à payer, 421 salaires, 455 compte courant d'associé…).
- N'utilise un code auxiliaire que s'il figure dans la liste des tiers fournie.
- Confiance entre 0 et 1 ; en cas de doute réel, propose 471 (compte d'attente) avec une confiance faible.

Plan comptable de référence (extrait) :
${PLAN_ABREGE}`;

// ---------------------------------------------------------------------------
// Implémentation Claude
// ---------------------------------------------------------------------------

export class ClaudeAssistant implements AssistantIA {
  private readonly client: Anthropic;

  constructor(readonly modele = "claude-opus-5-5", client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  private verifierReponse(r: { stop_reason: string | null }) {
    if (r.stop_reason === "refusal") throw new ErreurIA("Le modèle a refusé de traiter ce document");
    if (r.stop_reason === "max_tokens") throw new ErreurIA("Réponse tronquée : document trop volumineux");
  }

  async extrairePiece(doc: DocumentSource, ctx: ContexteDossier) {
    const bloc: Anthropic.Beta.BetaContentBlockParam =
      doc.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } }
        : { type: "image", source: { type: "base64", media_type: doc.mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: doc.base64 } };
    const habitudes = ctx.habitudes.length
      ? `Imputations habituelles du dossier :\n${ctx.habitudes.map((h) => `- ${h.tiers} → ${h.compte}`).join("\n")}`
      : "Aucune imputation habituelle connue.";
    try {
      const r = await this.client.beta.messages.parse({
        model: this.modele,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(extractionSchema) },
        system: [{ type: "text", text: SYSTEM_EXTRACTION, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              bloc,
              { type: "text", text: `Dossier : ${ctx.raisonSociale} (SIREN ${ctx.siren}).\n${habitudes}\nFichier : ${doc.nomFichier}\nExtrais les données de cette pièce.` },
            ],
          },
        ],
      });
      this.verifierReponse(r);
      const o = r.parsed_output;
      if (!o) throw new ErreurIA("Réponse de l'IA illisible");
      const extraction: ExtractionPiece = {
        typeDocument: o.typeDocument,
        emetteur: o.emetteur,
        destinataire: o.destinataire,
        numero: o.numero,
        dateFacture: o.dateFacture,
        dateEcheance: o.dateEcheance,
        devise: o.devise || "EUR",
        lignes: o.lignes.map((l) => ({ designation: l.designation, montantHT: euros(l.montantHT), tauxTvaBp: taux(l.tauxTva) })),
        ventilationTva: o.ventilationTva.map((v) => ({ tauxBp: taux(v.tauxTva), baseHT: euros(v.baseHT), tva: euros(v.tva) })),
        totalHT: euros(o.totalHT),
        totalTVA: euros(o.totalTVA),
        totalTTC: euros(o.totalTTC),
        compteSuggere: o.compteSuggere,
        justificationCompte: o.justificationCompte,
        confiance: Math.min(1, Math.max(0, o.confiance)),
        remarques: o.remarques,
        source: "ia",
      };
      return { extraction, usage: { modele: r.model, tokensEntree: r.usage.input_tokens, tokensSortie: r.usage.output_tokens } };
    } catch (err) {
      throw traduireErreur(err);
    }
  }

  async suggererImputations(
    lignes: { id: number; date: string; libelle: string; montant: number }[],
    ctx: ContexteDossier & { tiers: { compteAux: string; nom: string; type: string }[] },
  ) {
    const liste = lignes.map((l) => `${l.id} | ${l.date} | ${l.libelle} | ${(l.montant / 100).toFixed(2)} €`).join("\n");
    const tiers = ctx.tiers.map((t) => `${t.compteAux} — ${t.nom} (${t.type})`).join("\n") || "(aucun)";
    try {
      const r = await this.client.beta.messages.parse({
        model: this.modele,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(suggestionsSchema) },
        system: [{ type: "text", text: SYSTEM_BANQUE, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Dossier : ${ctx.raisonSociale}.\nTiers connus :\n${tiers}\n\nImputations habituelles :\n${ctx.habitudes.map((h) => `${h.tiers} → ${h.compte}`).join("\n") || "(aucune)"}\n\nOpérations (id | date | libellé | montant, négatif = sortie) :\n${liste}`,
          },
        ],
      });
      this.verifierReponse(r);
      // Le filtrage des réponses invalides est fait par l'appelant (routes/pieces.ts).
      const suggestions = r.parsed_output?.suggestions ?? [];
      return { suggestions, usage: { modele: r.model, tokensEntree: r.usage.input_tokens, tokensSortie: r.usage.output_tokens } };
    } catch (err) {
      throw traduireErreur(err);
    }
  }
}

function traduireErreur(err: unknown): Error {
  if (err instanceof ErreurIA) return err;
  if (err instanceof Anthropic.AuthenticationError) return new ErreurIA("Clé d'API Anthropic invalide : vérifiez la configuration du serveur");
  if (err instanceof Anthropic.RateLimitError) return new ErreurIA("Service d'IA momentanément saturé : réessayez dans quelques instants");
  if (err instanceof Anthropic.BadRequestError) return new ErreurIA(`Document refusé par le service d'IA : ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new ErreurIA("Service d'IA injoignable");
  if (err instanceof Anthropic.APIError) return new ErreurIA(`Erreur du service d'IA (${err.status})`);
  return err instanceof Error ? err : new Error(String(err));
}

/** Crée l'assistant si une clé d'API est configurée et l'IA non désactivée. */
export function creerAssistantDepuisEnv(): AssistantIA | null {
  if (process.env.IA_ACTIVE === "false") return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new ClaudeAssistant(process.env.IA_MODELE || "claude-opus-5-5");
}
