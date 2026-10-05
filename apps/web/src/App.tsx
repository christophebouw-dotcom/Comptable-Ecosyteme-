import { NavLink, Navigate, Outlet, Route, Routes } from "react-router";
import { Icon } from "./components/icons";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/hooks";
import { AccountPage } from "./pages/AccountPage";
import { AuditPage } from "./pages/AuditPage";
import { ConfidentialitePage } from "./pages/ConfidentialitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { DossierLayout } from "./pages/dossier/DossierLayout";
import { BalancePage } from "./pages/dossier/BalancePage";
import { CloturePage } from "./pages/dossier/CloturePage";
import { EcrituresPage } from "./pages/dossier/EcrituresPage";
import { EtatsPage } from "./pages/dossier/EtatsPage";
import { FacturesPage } from "./pages/dossier/FacturesPage";
import { GrandLivrePage } from "./pages/dossier/GrandLivrePage";
import { SaisiePage } from "./pages/dossier/SaisiePage";
import { SynthesePage } from "./pages/dossier/SynthesePage";
import { TiersPage } from "./pages/dossier/TiersPage";
import { TvaPage } from "./pages/dossier/TvaPage";
import { DossiersPage } from "./pages/DossiersPage";
import { LoginPage } from "./pages/LoginPage";
import { RgpdPage } from "./pages/RgpdPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/confidentialite" element={<ConfidentialitePage />} />
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
            <Route path="balance" element={<BalancePage />} />
            <Route path="grand-livre" element={<GrandLivrePage />} />
            <Route path="etats" element={<EtatsPage />} />
            <Route path="tva" element={<TvaPage />} />
            <Route path="factures" element={<FacturesPage />} />
            <Route path="tiers" element={<TiersPage />} />
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
        <Outlet />
      </main>
    </div>
  );
}
