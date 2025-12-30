import { useEffect, useState } from "react";

import { ApiError, getConfig, saveConfig, validateConfig } from "../api";
import { useAuth } from "../state/auth";

export default function Config() {
  const { setRequiredMode } = useAuth();
  const [yaml, setYaml] = useState("");
  const [lastModified, setLastModified] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then((data) => {
        setYaml(data.yaml);
        setLastModified(data.last_modified);
        setLoading(false);
      })
      .catch((err: ApiError) => {
        if (err.status === 401) {
          setRequiredMode(err.authMode ?? "basic");
          return;
        }
        setError(err.message || "Failed to load config");
        setLoading(false);
      });
  }, [setRequiredMode]);

  const handleValidate = async () => {
    setMessage(null);
    setError(null);
    try {
      const result = await validateConfig(yaml);
      if (result.ok) {
        setMessage("YAML looks good.");
      } else {
        setError(`${result.error ?? "Invalid YAML"}`);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Validation failed");
      }
    }
  };

  const handleSave = async () => {
    setMessage(null);
    setError(null);
    try {
      const result = await saveConfig(yaml);
      if (result.ok) {
        setMessage("Config saved.");
        if (result.last_modified) {
          setLastModified(result.last_modified);
        }
      } else {
        setError(result.error ?? "Save failed");
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Save failed");
      }
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Config Editor</h1>
          <p>Edit the shared Kometa YAML configuration.</p>
        </div>
        <div className="meta">
          <span>Last modified</span>
          <strong>{lastModified ? new Date(lastModified * 1000).toLocaleString() : "-"}</strong>
        </div>
      </div>

      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="editor-card">
        <textarea
          value={yaml}
          onChange={(event) => setYaml(event.target.value)}
          placeholder={loading ? "Loading..." : "Start editing config.yml"}
        />
        <div className="editor-actions">
          <button className="ghost" onClick={handleValidate}>
            Validate
          </button>
          <button className="primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
