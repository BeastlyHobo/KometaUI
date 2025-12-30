import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  createConfig,
  getFileContent,
  listConfigs,
  listFiles,
  saveFile,
  setActiveConfig,
  validateConfig,
  type ConfigEntry,
  type FileEntry
} from "../api";
import { useAuth } from "../state/auth";

type FileScope = {
  id: "collections" | "overlays" | "playlists" | "other";
  label: string;
  prefix?: string;
  stub: string;
};

const FILE_SCOPES: FileScope[] = [
  { id: "collections", label: "Collections", prefix: "collections", stub: "collections:\n" },
  { id: "overlays", label: "Overlays", prefix: "overlays", stub: "overlays:\n" },
  { id: "playlists", label: "Playlists", prefix: "playlists", stub: "playlists:\n" },
  { id: "other", label: "Other YAML", stub: "libraries: {}\n" }
];

export default function Config() {
  const { setRequiredMode } = useAuth();
  const [configRoot, setConfigRoot] = useState<string | null>(null);
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [activeConfig, setActiveConfigState] = useState<string | null>(null);

  const [fileScope, setFileScope] = useState<FileScope>(FILE_SCOPES[0]);
  const [files, setFiles] = useState<FileEntry[]>([]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [yaml, setYaml] = useState("");
  const [lastModified, setLastModified] = useState<number | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPathInput, setConfigPathInput] = useState("");
  const [createNewConfig, setCreateNewConfig] = useState(true);
  const [setActiveOnCreate, setSetActiveOnCreate] = useState(true);
  const [filePathInput, setFilePathInput] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const selectedConfig = useMemo(
    () => configs.find((config) => config.path === activeConfig),
    [activeConfig, configs]
  );

  const openFile = useCallback(
    async (path: string) => {
      setEditorLoading(true);
      setMessage(null);
      setError(null);
      try {
        const data = await getFileContent(path);
        setSelectedFile(data.path);
        setYaml(data.yaml);
        setLastModified(data.last_modified);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 401) {
          setRequiredMode(apiErr.authMode ?? "basic");
        } else {
          setError(apiErr.message || "Failed to load file");
        }
      } finally {
        setEditorLoading(false);
      }
    },
    [setRequiredMode]
  );

  const refreshConfigs = useCallback(async () => {
    try {
      const data = await listConfigs();
      setConfigRoot(data.root);
      setConfigs(data.configs);
      setActiveConfigState(data.active);
      if (!selectedFile && data.active) {
        await openFile(data.active);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to load configs");
      }
    }
  }, [openFile, selectedFile, setRequiredMode]);

  const refreshFiles = useCallback(
    async (scope: FileScope) => {
      setFilesLoading(true);
      try {
        const data = await listFiles(scope.prefix);
        setFiles(data);
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.status === 401) {
          setRequiredMode(apiErr.authMode ?? "basic");
        } else {
          setError(apiErr.message || "Failed to load files");
        }
      } finally {
        setFilesLoading(false);
      }
    },
    [setRequiredMode]
  );

  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  useEffect(() => {
    refreshFiles(fileScope);
  }, [fileScope, refreshFiles]);

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
      if (!selectedFile) {
        setError("Select a file to save.");
        return;
      }
      const result = await saveFile(selectedFile, yaml);
      if (result.ok) {
        setMessage("File saved.");
        if (result.last_modified) {
          setLastModified(result.last_modified);
        }
        refreshFiles(fileScope);
        refreshConfigs();
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

  const handleSetActive = async (path: string) => {
    setMessage(null);
    setError(null);
    try {
      await setActiveConfig(path);
      setActiveConfigState(path);
      setMessage(`Active config set to ${path}.`);
      await openFile(path);
      refreshConfigs();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to set active config");
      }
    }
  };

  const handleAddConfig = async () => {
    if (!configPathInput.trim()) {
      setError("Enter a config path.");
      return;
    }
    setMessage(null);
    setError(null);
    try {
      const result = await createConfig({
        path: configPathInput.trim(),
        create: createNewConfig,
        set_active: setActiveOnCreate
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to add config");
        return;
      }
      setMessage("Config registered.");
      setConfigPathInput("");
      await refreshConfigs();
      if (setActiveOnCreate && result.path) {
        setActiveConfigState(result.path);
        await openFile(result.path);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to add config");
      }
    }
  };

  const handleOpenPath = async () => {
    if (!filePathInput.trim()) {
      setError("Enter a file path to open.");
      return;
    }
    await openFile(filePathInput.trim());
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) {
      setError("Enter a filename.");
      return;
    }
    const basePrefix = fileScope.prefix ? `${fileScope.prefix}/` : "";
    const normalizedName = newFileName.endsWith(".yml") || newFileName.endsWith(".yaml")
      ? newFileName
      : `${newFileName}.yml`;
    const path = `${basePrefix}${normalizedName}`;
    setMessage(null);
    setError(null);
    try {
      const result = await saveFile(path, fileScope.stub);
      if (!result.ok) {
        setError(result.error ?? "Failed to create file");
        return;
      }
      setMessage(`Created ${path}.`);
      setNewFileName("");
      await refreshFiles(fileScope);
      await openFile(path);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to create file");
      }
    }
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>Config Studio</h1>
          <p>Manage configs and the YAML files that power collections, overlays, and playlists.</p>
        </div>
        <div className="meta">
          <span>Active config</span>
          <strong>{selectedConfig?.path ?? "-"}</strong>
        </div>
      </div>

      {message && <div className="banner success">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="grid two">
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Config Files</h2>
              <p className="hint">Root: {configRoot ?? "-"}</p>
            </div>
          </div>

          <div className="list">
            {configs.map((config) => (
              <div key={config.path} className="list-item">
                <div>
                  <p className="item-title">{config.path}</p>
                  <p className="item-subtitle">
                    {config.exists
                      ? `Modified ${config.last_modified ? new Date(config.last_modified * 1000).toLocaleString() : "-"}`
                      : "Missing on disk"}
                  </p>
                </div>
                <div className="item-actions">
                  {activeConfig === config.path ? (
                    <span className="tag active">Active</span>
                  ) : (
                    <button
                      className="ghost"
                      onClick={() => handleSetActive(config.path)}
                      disabled={!config.exists}
                    >
                      Set active
                    </button>
                  )}
                  <button className="ghost" onClick={() => openFile(config.path)} disabled={!config.exists}>
                    Open
                  </button>
                </div>
              </div>
            ))}
            {!configs.length && <p className="hint">No configs registered yet.</p>}
          </div>

          <div className="form-block">
            <h3>Add a config</h3>
            <div className="field-row">
              <input
                className="input"
                value={configPathInput}
                onChange={(event) => setConfigPathInput(event.target.value)}
                placeholder="configs/movies.yml"
              />
              <button className="primary" onClick={handleAddConfig}>
                {createNewConfig ? "Create" : "Register"}
              </button>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={createNewConfig}
                onChange={(event) => setCreateNewConfig(event.target.checked)}
              />
              Create new file if missing
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={setActiveOnCreate}
                onChange={(event) => setSetActiveOnCreate(event.target.checked)}
              />
              Make this config active
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>YAML Library</h2>
              <p className="hint">Browse YAML files by purpose, or open any path.</p>
            </div>
          </div>
          <div className="segmented">
            {FILE_SCOPES.map((scope) => (
              <button
                key={scope.id}
                className={scope.id === fileScope.id ? "active" : ""}
                onClick={() => setFileScope(scope)}
              >
                {scope.label}
              </button>
            ))}
          </div>
          <div className="list">
            {filesLoading && <p className="hint">Loading files...</p>}
            {!filesLoading &&
              files.map((file) => (
                <div key={file.path} className="list-item">
                  <div>
                    <p className="item-title">{file.path}</p>
                    <p className="item-subtitle">
                      {file.last_modified
                        ? `Modified ${new Date(file.last_modified * 1000).toLocaleString()}`
                        : "Unknown"}
                    </p>
                  </div>
                  <div className="item-actions">
                    <button className="ghost" onClick={() => openFile(file.path)}>
                      Open
                    </button>
                  </div>
                </div>
              ))}
            {!filesLoading && !files.length && (
              <p className="hint">No YAML files found in this scope yet.</p>
            )}
          </div>

          <div className="form-block">
            <h3>Open by path</h3>
            <div className="field-row">
              <input
                className="input"
                value={filePathInput}
                onChange={(event) => setFilePathInput(event.target.value)}
                placeholder="overlays/Movies/ratings.yml"
              />
              <button className="ghost" onClick={handleOpenPath}>
                Open
              </button>
            </div>
          </div>

          <div className="form-block">
            <h3>Create a new YAML file</h3>
            <div className="field-row">
              <input
                className="input"
                value={newFileName}
                onChange={(event) => setNewFileName(event.target.value)}
                placeholder="new-collection.yml"
              />
              <button className="primary" onClick={handleCreateFile}>
                Create
              </button>
            </div>
            <p className="hint">
              New files are created in {fileScope.prefix ? `/${fileScope.prefix}` : "the config root"}.
            </p>
          </div>
        </div>
      </div>

      <div className="editor-card">
        <div className="editor-toolbar">
          <div>
            <h2>Editor</h2>
            <p className="hint">{selectedFile ? `Editing ${selectedFile}` : "Select a file to edit."}</p>
          </div>
          <div className="meta">
            <span>Last modified</span>
            <strong>
              {lastModified ? new Date(lastModified * 1000).toLocaleString() : "-"}
            </strong>
          </div>
        </div>
        <textarea
          value={yaml}
          onChange={(event) => setYaml(event.target.value)}
          placeholder={editorLoading ? "Loading..." : "Select a file to start editing."}
        />
        <div className="editor-actions">
          <button className="ghost" onClick={handleValidate}>
            Validate
          </button>
          <button className="primary" onClick={handleSave} disabled={!selectedFile}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
