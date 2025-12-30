import { NavLink, Outlet } from "react-router-dom";

import type { HealthResponse } from "../api";
import AuthPrompt from "./AuthPrompt";

type LayoutProps = {
  health: HealthResponse | null;
  healthError: string | null;
  onRefreshHealth: () => void;
};

export type LayoutContext = {
  health: HealthResponse | null;
  onRefreshHealth: () => void;
};

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

export default function Layout({ health, healthError, onRefreshHealth }: LayoutProps) {
  return (
    <div className="shell">
      <AuthPrompt />
      {health?.docker_socket && (
        <div className="banner warning">
          Docker socket enabled. This grants root-equivalent control of Docker.
        </div>
      )}
      {healthError && <div className="banner error">{healthError}</div>}
      <header className="header">
        <div className="brand">
          <span className="brand-mark">K</span>
          <div>
            <p className="brand-title">Kometa UI</p>
            <p className="brand-subtitle">Companion container</p>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/config" className={navClass}>
            Config
          </NavLink>
          <NavLink to="/runs" className={navClass}>
            Runs
          </NavLink>
          <NavLink to="/logs" className={navClass}>
            Logs
          </NavLink>
        </nav>
        <button className="ghost" onClick={onRefreshHealth}>
          Refresh Health
        </button>
      </header>
      <main className="content">
        <Outlet context={{ health, onRefreshHealth } satisfies LayoutContext} />
      </main>
    </div>
  );
}
