import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, listRuns, type RunRecord } from "../api";
import StatusPill from "../components/StatusPill";
import { useAuth } from "../state/auth";

export default function Runs() {
  const { setRequiredMode } = useAuth();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Runs</h1>
          <p>History of manual Kometa runs.</p>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Trigger</th>
              <th>Log</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.started_at * 1000).toLocaleString()}</td>
                <td>
                  <StatusPill status={run.status} />
                </td>
                <td>{run.duration_sec ? `${run.duration_sec}s` : "-"}</td>
                <td>{run.trigger}</td>
                <td>
                  <Link to={`/runs/${run.id}`}>View</Link>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5}>No runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
