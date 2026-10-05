import { type ComponentType, Suspense, lazy } from "react";
import { NavLink, Navigate, Outlet, Route, Routes } from "react-router";
import { Icon } from "./components/icons";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/hooks";
import { DossierLayout } from "./pages/dossier/DossierLayout";
import { LoginPage } from "./pages/LoginPage";

/** Chargement à la demande : chaque écran est téléchargé lors de sa première ouverture. */
function page<K extends string>(charger: () => Promise<Record<K, ComponentType>>, nom: K) {
  return lazy(async () => ({ default: (await charger())[nom] }));
}

const AccountPage = page(() => import("./pages/AccountPage"), "AccountPage");
const AuditPage = page(() => import("./pages/AuditPage"), "AuditPage");
const ConfidentialitePage = page(() => import("./pages/ConfidentialitePage"), "ConfidentialitePage");
const DashboardPage = page(() => import("./pages/DashboardPage"), "DashboardPage");
const BalancePage = page(() => import("./pages/dossier/BalancePage"), "BalancePage");
const BanquePage = page(() => import("./pages/dossier/BanquePage"), "BanquePage");
const ImmobilisationsPage = page(() => import("./pages/dossier/ImmobilisationsPage"), "ImmobilisationsPage");
const MissionPage = page(() => import("./pages/dossier/MissionPage"), "MissionPage");
const PiecesPage = page(() => import("./pages/dossier/PiecesPage"), "PiecesPage");
const RevisionPage = page(() => import("./pages/dossier/RevisionPage"), "RevisionPage");
const CloturePage = page(() => import("./pages/dossier/CloturePage"), "CloturePage");
const EcrituresPage = page(() => import("./pages/dossier/EcrituresPage"), "EcrituresPage");
const EchangesPage = page(() => import("./pages/dossier/EchangesPage"), "EchangesPage");
const InventairePage = page(() => import("./pages/dossier/InventairePage"), "InventairePage");
const BulletinPage = page(() => import("./pages/dossier/PaiePage"), "BulletinPage");
const PaiePage = page(() => import("./pages/dossier/PaiePage"), "PaiePage");
const EtatsPage = page(() => import("./pages/dossier/EtatsPage"), "EtatsPage");
const FacturesPage = page(() => import("./pages/dossier/FacturesPage"), "FacturesPage");
const GrandLivrePage = page(() => import("./pages/dossier/GrandLivrePage"), "GrandLivrePage");
const SaisiePage = page(() => import("./pages/dossier/SaisiePage"), "SaisiePage");
const SynthesePage = page(() => import("./pages/dossier/SynthesePage"), "SynthesePage");
const TiersPage = page(() => import("./pages/dossier/TiersPage"), "TiersPage");
const TvaPage = page(() => import("./pages/dossier/TvaPage"), "TvaPage");
const DossiersPage = page(() => import("./pages/DossiersPage"), "DossiersPage");
const PortailApp = page(() => import("./pages/portail/Portail"), "PortailApp");
const RgpdPage = page(() => import("./pages/RgpdPage"), "RgpdPage");
const UsersPage = page(() => import("./pages/UsersPage"), "UsersPage");

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  // Les dirigeants clients disposent d'un espace dédié, simplifié.
  if (user?.role === "client") return <Suspense fallback={<Loading />}><PortailApp /></Suspense>;
  return (
    <Routes>
      <Route path="/confidentialite" element={<Suspense fallback={<Loading />}><ConfidentialitePage /></Suspense>} />
      {!user ? (
        <Route path="*" element={<LoginPage />} />
      ) : (
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="dossiers" element={<DossiersPage />} />
          <Route path="dossiers/:dossierId" element={<DossierLayout />}>
            <Route index element={<SynthesePage />} />
            <Route path="saisie" element={<SaisiePage />} />
            <Route path="saisie/:ecritureId" element={<SaisiePage />} />
            <Route path="ecritures" element={<EcrituresPage />} />
            <Route path="pieces" element={<PiecesPage />} />
            <Route path="banque" element={<BanquePage />} />
            <Route path="immobilisations" element={<ImmobilisationsPage />} />
            <Route path="revision" element={<RevisionPage />} />
            <Route path="mission" element={<MissionPage />} />
            <Route path="balance" element={<BalancePage />} />
            <Route path="grand-livre" element={<GrandLivrePage />} />
            <Route path="etats" element={<EtatsPage />} />
            <Route path="tva" element={<TvaPage />} />
            <Route path="factures" element={<FacturesPage />} />
            <Route path="tiers" element={<TiersPage />} />
            <Route path="inventaire" element={<InventairePage />} />
            <Route path="paie" element={<PaiePage />} />
            <Route path="paie/bulletins/:bulletinId" element={<BulletinPage />} />
            <Route path="echanges" element={<EchangesPage />} />
            <Route path="cloture" element={<CloturePage />} />
          </Route>
          <Route path="rgpd/*" element={<RgpdPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="utilisateurs" element={<UsersPage />} />
          <Route path="compte" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

function Shell() {
  const { user, logout, can } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? "active" : ""}`;
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <img src="/favicon.svg" width={30} height={30} alt="" />
          <div>
            Compta Écosystème
            <small>Cabinet d'expertise comptable</small>
          </div>
        </div>
        <NavLink to="/" end className={link}>
          <Icon.home /> Tableau de bord
        </NavLink>
        {can("dossiers:read") && (
          <NavLink to="/dossiers" className={link}>
            <Icon.folder /> Dossiers clients
          </NavLink>
        )}
        {(can("rgpd:manage") || can("audit:read") || can("users:manage")) && <div className="nav-section">Conformité</div>}
        {can("rgpd:manage") && (
          <NavLink to="/rgpd" className={link}>
            <Icon.shield /> Centre RGPD
          </NavLink>
        )}
        {can("audit:read") && (
          <NavLink to="/audit" className={link}>
            <Icon.log /> Journal d'audit
          </NavLink>
        )}
        {can("users:manage") && (
          <NavLink to="/utilisateurs" className={link}>
            <Icon.users /> Utilisateurs
          </NavLink>
        )}
        <div className="nav-section">Personnel</div>
        <NavLink to="/compte" className={link}>
          <Icon.user /> Mon compte
        </NavLink>
        <div className="sidebar-footer">
          <div className="who">{user!.nom}</div>
          <div>{user!.roleLabel}</div>
          {!user!.totpEnabled && (
            <NavLink to="/compte" style={{ color: "#f0b45a", display: "block", marginTop: 6 }}>
              Activez la double authentification
            </NavLink>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={logout}>
              <Icon.logout /> Déconnexion
            </button>
            <NavLink to="/confidentialite" style={{ color: "var(--sidebar-text)", fontSize: 12 }}>
              Confidentialité
            </NavLink>
          </div>
        </div>
      </nav>
      <main className="main">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
