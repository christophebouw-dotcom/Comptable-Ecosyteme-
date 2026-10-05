import { Link } from "react-router";
import { Card } from "../components/ui";

/**
 * Information des personnes (RGPD art. 13 et 14). Modèle à adapter par le
 * cabinet (identité, coordonnées du DPO, hébergeur).
 */
export function ConfidentialitePage() {
  return (
    <div className="page" style={{ maxWidth: 900, margin: "0 auto" }}>
      <p><Link to="/">← Retour</Link></p>
      <h1 style={{ margin: "12px 0 6px" }}>Politique de confidentialité</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Information des personnes concernées — articles 13 et 14 du RGPD.</p>
      <div className="stack">
        <Card title="Responsable de traitement">
          <p>[Raison sociale du cabinet], société d'expertise comptable inscrite au tableau de l'Ordre des experts-comptables, [adresse], SIREN [•]. Délégué à la protection des données : [nom], dpo@[domaine].</p>
        </Card>
        <Card title="Données traitées, finalités et bases légales">
          <ul>
            <li><strong>Tenue de la comptabilité et établissement des comptes</strong> des entreprises clientes : exécution de la lettre de mission (art. 6.1.b). Le cabinet agit alors en qualité de sous-traitant de ses clients (art. 28).</li>
            <li><strong>Paie et déclarations sociales</strong> : obligation légale (art. 6.1.c — Code du travail, Code de la sécurité sociale).</li>
            <li><strong>Lutte contre le blanchiment</strong> : obligation légale (Code monétaire et financier, art. L561-2 et s.).</li>
            <li><strong>Sécurité de la plateforme et journalisation</strong> : intérêt légitime (art. 6.1.f) à protéger les données confiées.</li>
            <li><strong>Lettre d'information</strong> : consentement (art. 6.1.a), retirable à tout moment.</li>
          </ul>
        </Card>
        <Card title="Durées de conservation">
          <ul>
            <li>Pièces et livres comptables, factures : 10 ans à compter de la clôture de l'exercice (Code de commerce, art. L123-22).</li>
            <li>Documents fiscaux : 6 ans (Livre des procédures fiscales, art. L102 B).</li>
            <li>Bulletins de paie (double employeur) : 5 ans (Code du travail, art. L3243-4).</li>
            <li>Documents d'identification LCB-FT : 5 ans après la fin de la relation (CMF, art. L561-12).</li>
            <li>Journaux de connexion : 12 mois. Comptes inactifs : anonymisés après 2 ans.</li>
            <li>Données de prospects : 3 ans après le dernier contact.</li>
          </ul>
          <p className="subtle" style={{ marginTop: 8 }}>Une purge automatique quotidienne applique ces durées.</p>
        </Card>
        <Card title="Destinataires et hébergement">
          <p>Collaborateurs habilités du cabinet, administrations (DGFiP, URSSAF) dans le cadre des obligations déclaratives, commissaire aux comptes le cas échéant. Les données sont hébergées dans l'Union européenne ; aucun transfert hors UE. L'application ne charge aucune ressource tierce et ne dépose aucun traceur : seul un cookie de session strictement nécessaire est utilisé (exempté de consentement, art. 82 de la loi Informatique et Libertés).</p>
        </Card>
        <Card title="Intelligence artificielle">
          <p>Lorsque votre lettre de mission le prévoit, les pièces justificatives (factures, tickets) et les libellés bancaires peuvent être lus par un service d'intelligence artificielle (Claude, édité par Anthropic) afin d'en extraire les données comptables. Anthropic agit en qualité de sous-traitant ; le transfert vers les États-Unis est encadré par les garanties prévues aux articles 45 et 46 du RGPD. L'IA ne prend aucune décision : chaque proposition est contrôlée puis validée par un collaborateur du cabinet. Vous pouvez refuser ce traitement sans conséquence sur la mission.</p>
        </Card>
        <Card title="Sécurité">
          <p>Chiffrement des données bancaires et de contact (AES-256-GCM), mots de passe hachés (scrypt), double authentification, contrôle d'accès par profil et par dossier, journal d'audit infalsifiable, verrouillage après échecs répétés, sessions limitées dans le temps.</p>
        </Card>
        <Card title="Vos droits">
          <p>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, de portabilité et d'opposition, ainsi que du droit de retirer votre consentement et de définir des directives relatives au sort de vos données après votre décès. Contact : dpo@[domaine]. Réponse sous un mois.</p>
          <p style={{ marginTop: 8 }}>Certaines données ne peuvent être effacées avant l'expiration des délais légaux de conservation (art. 17.3.b) : elles sont alors placées en accès restreint.</p>
          <p style={{ marginTop: 8 }}>Vous pouvez introduire une réclamation auprès de la CNIL : www.cnil.fr.</p>
        </Card>
      </div>
    </div>
  );
}
