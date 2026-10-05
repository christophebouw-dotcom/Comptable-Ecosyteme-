/**
 * Génération du XML Factur-X / ZUGFeRD (syntaxe UN/CEFACT CII D16B, profil
 * EN 16931 « COMFORT »), l'un des trois formats socles acceptés par la réforme
 * française de la facturation électronique (avec UBL et CII purs).
 *
 * Le XML produit est destiné à être embarqué dans un PDF/A-3 (fichier
 * « factur-x.xml ») ou transmis tel quel à une plateforme agréée (PA).
 */
import type { Cents } from "./money.js";
import { type Facture, computeTotaux, montantLigneHT } from "./facture.js";

const NS = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  qdt: "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
};

export const FACTURX_PROFILE_EN16931 = "urn:cen.eu:en16931:2017";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const amt = (c: Cents) => (c / 100).toFixed(2);
const date102 = (iso: string) => `<udt:DateTimeString format="102">${iso.replace(/-/g, "")}</udt:DateTimeString>`;
const el = (tag: string, content: string, attrs = "") => `<${tag}${attrs ? " " + attrs : ""}>${content}</${tag}>`;
const txt = (tag: string, value: string | null | undefined, attrs = "") =>
  value ? el(tag, escapeXml(value), attrs) : "";

/** Code catégorie de TVA (UNTDID 5305). */
function categorieTva(tauxBp: number, f: Facture): { code: string; motif?: string } {
  if (tauxBp > 0) return { code: "S" };
  if (f.acheteur.pays !== "FR" && f.acheteur.tvaIntra && f.acheteur.professionnel) {
    return { code: "K", motif: f.mentionExoneration ?? "Exonération de TVA, art. 262 ter I du CGI" };
  }
  return { code: "E", motif: f.mentionExoneration ?? "Exonération de TVA" };
}

function partie(tag: string, p: Facture["vendeur"]): string {
  return el(
    tag,
    [
      txt("ram:Name", p.nom),
      p.siren ? el("ram:SpecifiedLegalOrganization", txt("ram:ID", p.siren.replace(/\s/g, ""), 'schemeID="0002"')) : "",
      el(
        "ram:PostalTradeAddress",
        [txt("ram:PostcodeCode", p.codePostal), txt("ram:LineOne", p.adresse), txt("ram:CityName", p.ville), txt("ram:CountryID", p.pays)].join(""),
      ),
      p.email ? el("ram:URIUniversalCommunication", txt("ram:URIID", p.email, 'schemeID="EM"')) : "",
      p.tvaIntra ? el("ram:SpecifiedTaxRegistration", txt("ram:ID", p.tvaIntra.replace(/\s/g, ""), 'schemeID="VA"')) : "",
    ].join(""),
  );
}

export interface FacturXOptions {
  iban?: string | null;
  bic?: string | null;
}

export function generateFacturX(f: Facture, opts: FacturXOptions = {}): string {
  const t = computeTotaux(f);
  const typeCode = f.type === "avoir" ? "381" : "380";

  const notes = [
    f.mentionExoneration ? el("ram:IncludedNote", txt("ram:Content", f.mentionExoneration)) : "",
    f.acheteur.professionnel
      ? el(
          "ram:IncludedNote",
          txt("ram:Content", `Pénalités de retard : ${f.tauxPenalitesRetard ?? "3 fois le taux d'intérêt légal"}. Indemnité forfaitaire pour frais de recouvrement : 40 €.`) +
            txt("ram:SubjectCode", "PMT"),
        )
      : "",
    f.tvaSurDebits ? el("ram:IncludedNote", txt("ram:Content", "Option pour le paiement de la taxe d'après les débits") + txt("ram:SubjectCode", "TXD")) : "",
  ].join("");

  const lignes = f.lignes
    .map((l, i) => {
      const brut = Math.round(l.prixUnitaireHT * l.quantite);
      const net = montantLigneHT(l);
      const cat = categorieTva(l.tauxTvaBp, f);
      return el(
        "ram:IncludedSupplyChainTradeLineItem",
        [
          el("ram:AssociatedDocumentLineDocument", el("ram:LineID", String(i + 1))),
          el("ram:SpecifiedTradeProduct", txt("ram:Name", l.designation)),
          el("ram:SpecifiedLineTradeAgreement", el("ram:NetPriceProductTradePrice", el("ram:ChargeAmount", amt(l.prixUnitaireHT)))),
          el("ram:SpecifiedLineTradeDelivery", el("ram:BilledQuantity", String(l.quantite), `unitCode="${l.unite ?? "C62"}"`)),
          el(
            "ram:SpecifiedLineTradeSettlement",
            [
              el(
                "ram:ApplicableTradeTax",
                el("ram:TypeCode", "VAT") + el("ram:CategoryCode", cat.code) + el("ram:RateApplicablePercent", String(l.tauxTvaBp / 100)),
              ),
              brut !== net
                ? el(
                    "ram:SpecifiedTradeAllowanceCharge",
                    el("ram:ChargeIndicator", el("udt:Indicator", "false")) +
                      el("ram:ActualAmount", amt(brut - net)) +
                      txt("ram:Reason", "Remise"),
                  )
                : "",
              el("ram:SpecifiedTradeSettlementLineMonetarySummation", el("ram:LineTotalAmount", amt(net))),
            ].join(""),
          ),
        ].join(""),
      );
    })
    .join("");

  // BT-8 (UNTDID 2475) : 5 = date de facture (option débits), 72 = encaissement
  // (prestations de services). Pour les livraisons de biens, la TVA est exigible
  // à la livraison : la zone est omise.
  const exigibilite = f.tvaSurDebits ? "5" : f.categorie === "services" ? "72" : null;

  const taxes = t.ventilation
    .map((v) => {
      const cat = categorieTva(v.tauxBp, f);
      return el(
        "ram:ApplicableTradeTax",
        [
          el("ram:CalculatedAmount", amt(v.tva)),
          el("ram:TypeCode", "VAT"),
          cat.motif ? txt("ram:ExemptionReason", cat.motif) : "",
          el("ram:BasisAmount", amt(v.baseHT)),
          el("ram:CategoryCode", cat.code),
          exigibilite ? el("ram:DueDateTypeCode", exigibilite) : "",
          el("ram:RateApplicablePercent", String(v.tauxBp / 100)),
        ].join(""),
      );
    })
    .join("");

  const paymentMeans = opts.iban
    ? el(
        "ram:SpecifiedTradeSettlementPaymentMeans",
        el("ram:TypeCode", "58") +
          el("ram:PayeePartyCreditorFinancialAccount", txt("ram:IBANID", opts.iban.replace(/\s/g, ""))) +
          (opts.bic ? el("ram:PayeeSpecifiedCreditorFinancialInstitution", txt("ram:BICID", opts.bic)) : ""),
      )
    : "";

  const delivery = f.dateLivraison
    ? el("ram:ActualDeliverySupplyChainEvent", el("ram:OccurrenceDateTime", date102(f.dateLivraison)))
    : "";
  const shipTo = f.adresseLivraison
    ? el("ram:ShipToTradeParty", txt("ram:Name", f.acheteur.nom) + el("ram:PostalTradeAddress", txt("ram:LineOne", f.adresseLivraison) + txt("ram:CountryID", f.acheteur.pays)))
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:qdt="${NS.qdt}" xmlns:udt="${NS.udt}">` +
    el(
      "rsm:ExchangedDocumentContext",
      el("ram:GuidelineSpecifiedDocumentContextParameter", el("ram:ID", FACTURX_PROFILE_EN16931)),
    ) +
    el(
      "rsm:ExchangedDocument",
      txt("ram:ID", f.numero) + el("ram:TypeCode", typeCode) + el("ram:IssueDateTime", date102(f.dateEmission)) + notes,
    ) +
    el(
      "rsm:SupplyChainTradeTransaction",
      [
        lignes,
        el("ram:ApplicableHeaderTradeAgreement", partie("ram:SellerTradeParty", f.vendeur) + partie("ram:BuyerTradeParty", f.acheteur)),
        el("ram:ApplicableHeaderTradeDelivery", shipTo + delivery),
        el(
          "ram:ApplicableHeaderTradeSettlement",
          [
            el("ram:InvoiceCurrencyCode", f.devise ?? "EUR"),
            paymentMeans,
            taxes,
            el("ram:SpecifiedTradePaymentTerms", el("ram:DueDateDateTime", date102(f.dateEcheance))),
            el(
              "ram:SpecifiedTradeSettlementHeaderMonetarySummation",
              [
                el("ram:LineTotalAmount", amt(t.totalHT)),
                el("ram:TaxBasisTotalAmount", amt(t.totalHT)),
                el("ram:TaxTotalAmount", amt(t.totalTVA), `currencyID="${f.devise ?? "EUR"}"`),
                el("ram:GrandTotalAmount", amt(t.totalTTC)),
                el("ram:DuePayableAmount", amt(t.totalTTC)),
              ].join(""),
            ),
            f.factureOrigine ? el("ram:InvoiceReferencedDocument", txt("ram:IssuerAssignedID", f.factureOrigine)) : "",
          ].join(""),
        ),
      ].join(""),
    ) +
    `</rsm:CrossIndustryInvoice>\n`
  );
}
