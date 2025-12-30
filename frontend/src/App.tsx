import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import { ApiError, getHealth, type HealthResponse } from "./api";
import Layout from "./components/Layout";
import Config from "./pages/Config";
import Dashboard from "./pages/Dashboard";
import Logs from "./pages/Logs";
import RunDetail from "./pages/RunDetail";
import Runs from "./pages/Runs";
import { useAuth } from "./state/auth";

export default function App() {
  const { authState, setRequiredMode } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refreshHealth = useCallback(() => {
    getHealth()
      .then((data) => {
        setHealth(data);
        setHealthError(null);
      })
      .catch((err: ApiError) => {
        if (err.status === 401) {
          setRequiredMode(err.authMode ?? "basic");
          return;
        }
        setHealthError(err.message || "Failed to load health");
      });
  }, [setRequiredMode]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth, authState]);

  return (
    <Routes>
      <Route
        path="/"
        element={<Layout health={health} healthError={healthError} onRefreshHealth={refreshHealth} />}
      >
        <Route index element={<Dashboard />} />
        <Route path="config" element={<Config />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:runId" element={<RunDetail />} />
        <Route path="logs" element={<Logs />} />
      </Route>
    </Routes>
  );
}
