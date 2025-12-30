import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { ApiError, createRun, listRuns, type RunRecord } from "../api";
import StatusPill from "../components/StatusPill";
import { useAuth } from "../state/auth";
import type { LayoutContext } from "../components/Layout";

function formatTimestamp(value: number | null) {
  if (!value) {
    return "-";
  }
  return new Date(value * 1000).toLocaleString();
}

export default function Dashboard() {
  const { health } = useOutletContext<LayoutContext>();
  const { setRequiredMode } = useAuth();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const latestRun = useMemo(() => runs[0], [runs]);

  useEffect(() => {
    listRuns()
      .then(setRuns)
      .catch((err: ApiError) => {
        if (err.status === 401) {
          setRequiredMode(err.authMode ?? "basic");
          return;
        }
        setError(err.message || "Failed to load runs");
      });
  }, [setRequiredMode]);

  const handleRunNow = async () => {
    setRunning(true);
    setError(null);
    try {
      await createRun("manual");
      const updated = await listRuns();
      setRuns(updated);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to start run");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Manual runs, health signals, and quick actions.</p>
        </div>
        <button className="primary" onClick={handleRunNow} disabled={running}>
          {running ? "Starting run..." : "Run Now"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="grid two">
        <div className="card">
          <h2>Last Run</h2>
          <div className="stat-row">
            <span>Status</span>
            <StatusPill status={latestRun?.status} />
          </div>
          <div className="stat-row">
            <span>Started</span>
            <span>{formatTimestamp(latestRun?.started_at ?? null)}</span>
          </div>
          <div className="stat-row">
            <span>Duration</span>
            <span>
              {latestRun?.duration_sec ? `${latestRun.duration_sec}s` : "-"}
            </span>
          </div>
          <div className="stat-row">
            <span>Trigger</span>
            <span>{latestRun?.trigger ?? "-"}</span>
          </div>
          {latestRun && (
            <Link className="text-link" to={`/runs/${latestRun.id}`}>
              View run detail
            </Link>
          )}
        </div>

        <div className="card">
          <h2>Health</h2>
          <div className="health-grid">
            <div className={`health-item ${health?.config_exists ? "ok" : "bad"}`}>
              <span>Config</span>
              <strong>{health?.config_exists ? "Found" : "Missing"}</strong>
            </div>
            <div className={`health-item ${health?.docker_socket ? "ok" : "bad"}`}>
              <span>Docker Socket</span>
              <strong>{health?.docker_socket ? "Mounted" : "Not mounted"}</strong>
            </div>
            <div
              className={`health-item ${
                health?.kometa_container_found ? "ok" : "bad"
              }`}
            >
              <span>Kometa Container</span>
              <strong>{health?.kometa_container_found ? "Reachable" : "Missing"}</strong>
            </div>
            <div className="health-item note">
              <span>Config Path</span>
              <strong>{health?.config_path ?? "-"}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card quick-links">
        <h2>Quick Links</h2>
        <div className="link-row">
          <Link to="/config">Edit config</Link>
          <Link to="/runs">Run history</Link>
          <Link to="/logs">Tail logs</Link>
        </div>
      </div>
    </section>
  );
}
