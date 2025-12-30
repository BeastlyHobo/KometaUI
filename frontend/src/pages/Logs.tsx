import { useEffect, useState } from "react";

import { ApiError, downloadFile, getLatestLogs } from "../api";
import { useAuth } from "../state/auth";

export default function Logs() {
  const { setRequiredMode } = useAuth();
  const [lines, setLines] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: number;
    const fetchLogs = async () => {
      try {
        const data = await getLatestLogs(500);
        setLines(data.lines);
        setHasMore(data.has_more);
        setFile(data.file);
        setError(null);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 401) {
          setRequiredMode(apiErr.authMode ?? "basic");
          return;
        }
        setError(apiErr.message || "Failed to load logs");
      }
    };

    fetchLogs();
    timer = window.setInterval(fetchLogs, 5000);
    return () => window.clearInterval(timer);
  }, [setRequiredMode]);

  const handleDownload = async () => {
    try {
      await downloadFile("/api/logs/latest/download", file ?? "latest.log");
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
          <h1>Logs</h1>
          <p>Tail the most recent Kometa log file.</p>
        </div>
        <button className="ghost" onClick={handleDownload}>
          Download full log
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <div className="stat-row">
          <span>Latest file</span>
          <span>{file ?? "-"}</span>
        </div>
        {hasMore && <p className="hint">Showing last 500 lines.</p>}
        <div className="log-box">
          <pre>{lines.join("\n") || "No log output yet."}</pre>
        </div>
      </div>
    </section>
  );
}
