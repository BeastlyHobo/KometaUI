import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ApiError,
  downloadFile,
  getRun,
  getRunLogs,
  type RunRecord
} from "../api";
import StatusPill from "../components/StatusPill";
import { useAuth } from "../state/auth";

export default function RunDetail() {
  const { runId } = useParams();
  const { setRequiredMode } = useAuth();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      return;
    }
    let timer: number;
    const fetchRun = async () => {
      try {
        const runData = await getRun(runId);
        setRun(runData);
        const logData = await getRunLogs(runId, 500);
        setLines(logData.lines);
        setHasMore(logData.has_more);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 401) {
          setRequiredMode(apiErr.authMode ?? "basic");
          return;
        }
        setError(apiErr.message || "Failed to load run");
      }
    };

    fetchRun();
    timer = window.setInterval(fetchRun, 5000);
    return () => window.clearInterval(timer);
  }, [runId, setRequiredMode]);

  const handleDownload = async () => {
    if (!runId) {
      return;
    }
    try {
      await downloadFile(`/api/runs/${runId}/download`, `kometa-${runId}.log`);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Download failed");
      }
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Run Detail</h1>
          <p>
            <Link className="text-link" to="/runs">
              Back to runs
            </Link>
          </p>
        </div>
        <button className="ghost" onClick={handleDownload}>
          Download log
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="grid two">
        <div className="card">
          <h2>Run Summary</h2>
          <div className="stat-row">
            <span>Status</span>
            <StatusPill status={run?.status} />
          </div>
          <div className="stat-row">
            <span>Started</span>
            <span>
              {run?.started_at ? new Date(run.started_at * 1000).toLocaleString() : "-"}
            </span>
          </div>
          <div className="stat-row">
            <span>Finished</span>
            <span>
              {run?.finished_at
                ? new Date(run.finished_at * 1000).toLocaleString()
                : "-"}
            </span>
          </div>
          <div className="stat-row">
            <span>Duration</span>
            <span>{run?.duration_sec ? `${run.duration_sec}s` : "-"}</span>
          </div>
          <div className="stat-row">
            <span>Exit code</span>
            <span>{run?.exit_code ?? "-"}</span>
          </div>
          <div className="stat-row">
            <span>Error</span>
            <span>{run?.error ?? "-"}</span>
          </div>
        </div>

        <div className="card">
          <h2>Log Tail</h2>
          {hasMore && <p className="hint">Showing last 500 lines.</p>}
          <div className="log-box">
            <pre>{lines.join("\n") || "No log output yet."}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}
