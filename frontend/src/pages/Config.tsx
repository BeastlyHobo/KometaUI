import { useCallback, useEffect, useMemo, useState } from "react";
import { parse, stringify } from "yaml";

import schema from "../data/kometa-config-schema.json";
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

type ConfigDraft = Record<string, unknown>;

type OverlayPosition = {
  id: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  label: string;
};

type OverlayOption = {
  id: string;
  label: string;
  defaultKey: string;
  enabled: boolean;
  position: OverlayPosition["id"];
};

const FILE_SCOPES: FileScope[] = [
  { id: "collections", label: "Collections", prefix: "collections", stub: "collections:\n" },
  { id: "overlays", label: "Overlays", prefix: "overlays", stub: "overlays:\n" },
  { id: "playlists", label: "Playlists", prefix: "playlists", stub: "playlists:\n" },
  { id: "other", label: "Other YAML", stub: "libraries: {}\n" }
];

const OVERLAY_POSITIONS: OverlayPosition[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" }
];

const DEFAULT_OVERLAYS: OverlayOption[] = [
  { id: "resolution", label: "Resolution", defaultKey: "resolution", enabled: true, position: "top-right" },
  { id: "imdb", label: "IMDb Score", defaultKey: "ratings", enabled: false, position: "top-left" },
  { id: "rotten", label: "Rotten Tomatoes", defaultKey: "ratings", enabled: false, position: "bottom-left" },
  { id: "audio", label: "Audio Codec", defaultKey: "audio_codec", enabled: false, position: "bottom-left" },
  { id: "ribbon", label: "Ribbon", defaultKey: "ribbon", enabled: false, position: "bottom-right" }
];

const SAMPLE_POSTERS = [
  { id: "movie", label: "Sample Movie" },
  { id: "show", label: "Sample Series" }
];

function cloneConfig(value: ConfigDraft | null): ConfigDraft {
  if (!value) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isConfigCandidate(value: unknown): value is ConfigDraft {
  if (!isRecord(value)) {
    return false;
  }
  return "libraries" in value || "plex" in value || "tmdb" in value;
}

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null);
  const [configParseError, setConfigParseError] = useState<string | null>(null);
  const [isConfigFile, setIsConfigFile] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [assetDirectoryInput, setAssetDirectoryInput] = useState("");

  const [overlayOptions, setOverlayOptions] = useState<OverlayOption[]>(DEFAULT_OVERLAYS);
  const [posterMode, setPosterMode] = useState<"sample" | "asset">("sample");
  const [assetPosters, setAssetPosters] = useState<FileEntry[]>([]);
  const [posterAssetPath, setPosterAssetPath] = useState("");

  const [schemaQuery, setSchemaQuery] = useState("");

  const selectedConfig = useMemo(
    () => configs.find((config) => config.path === activeConfig),
    [activeConfig, configs]
  );

  const schemaKeys = useMemo(() => {
    const properties = (schema as Record<string, unknown>).properties;
    if (!isRecord(properties)) {
      return [] as string[];
    }
    return Object.keys(properties).sort();
  }, []);

  const filteredSchemaKeys = useMemo(() => {
    if (!schemaQuery.trim()) {
      return schemaKeys.slice(0, 12);
    }
    const query = schemaQuery.toLowerCase();
    return schemaKeys.filter((key) => key.toLowerCase().includes(query)).slice(0, 20);
  }, [schemaKeys, schemaQuery]);

  const libraries = useMemo(() => {
    if (!configDraft || !isRecord(configDraft.libraries)) {
      return [] as string[];
    }
    return Object.keys(configDraft.libraries as Record<string, unknown>);
  }, [configDraft]);

  const overlaySnippet = useMemo(() => {
    const active = overlayOptions.filter((option) => option.enabled);
    if (!active.length) {
      return "# No overlays selected yet";
    }
    return [
      "overlay_files:",
      ...active.map((option) => `  - default: ${option.defaultKey}  # ${option.label}`)
    ].join("\n");
  }, [overlayOptions]);

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

        try {
          const parsed = parse(data.yaml) as unknown;
          if (isConfigCandidate(parsed) || data.path === activeConfig) {
            const draft = isConfigCandidate(parsed) ? parsed : {};
            setConfigDraft(draft as ConfigDraft);
            setIsConfigFile(true);
            setConfigParseError(null);
          } else {
            setConfigDraft(null);
            setIsConfigFile(false);
            setConfigParseError(null);
          }
        } catch (parseError) {
          setConfigDraft(null);
          setIsConfigFile(data.path === activeConfig);
          setConfigParseError((parseError as Error).message);
        }
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
    [activeConfig, setRequiredMode]
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

  const refreshPosterAssets = useCallback(async () => {
    try {
      const data = await listFiles("assets", ["png", "jpg", "jpeg", "webp"]);
      setAssetPosters(data);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      }
    }
  }, [setRequiredMode]);

  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  useEffect(() => {
    refreshFiles(fileScope);
  }, [fileScope, refreshFiles]);

  useEffect(() => {
    refreshPosterAssets();
  }, [refreshPosterAssets]);

  const updateConfigDraft = useCallback(
    (mutator: (draft: ConfigDraft) => void) => {
      if (!isConfigFile) {
        return;
      }
      setConfigDraft((prev) => {
        const next = cloneConfig(prev);
        mutator(next);
        setYaml(stringify(next, { indent: 2 }));
        return next;
      });
    },
    [isConfigFile]
  );

  const handleSyncFromYaml = () => {
    if (!isConfigFile) {
      return;
    }
    try {
      const parsed = parse(yaml) as unknown;
      if (isConfigCandidate(parsed)) {
        setConfigDraft(parsed as ConfigDraft);
        setConfigParseError(null);
        setMessage("Form synced from YAML.");
      } else {
        setConfigParseError("Config root must be a mapping.");
      }
    } catch (parseError) {
      setConfigParseError((parseError as Error).message);
    }
  };

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

  const handleLibraryAdd = () => {
    if (!newLibraryName.trim()) {
      return;
    }
    const name = newLibraryName.trim();
    updateConfigDraft((draft) => {
      const librariesDraft = isRecord(draft.libraries) ? draft.libraries : {};
      if (!isRecord(librariesDraft)) {
        draft.libraries = {};
      }
      const updated = isRecord(draft.libraries) ? { ...draft.libraries } : {};
      updated[name] = updated[name] ?? {};
      draft.libraries = updated;
    });
    setNewLibraryName("");
  };

  const handleLibraryRemove = (name: string) => {
    updateConfigDraft((draft) => {
      if (!isRecord(draft.libraries)) {
        return;
      }
      const updated = { ...draft.libraries } as Record<string, unknown>;
      delete updated[name];
      draft.libraries = updated;
    });
  };

  const handleAssetDirectoryAdd = () => {
    if (!assetDirectoryInput.trim()) {
      return;
    }
    updateConfigDraft((draft) => {
      const settings = isRecord(draft.settings) ? { ...draft.settings } : {};
      const assetDirectory = Array.isArray(settings.asset_directory)
        ? [...settings.asset_directory]
        : settings.asset_directory
          ? [settings.asset_directory]
          : [];
      assetDirectory.push(assetDirectoryInput.trim());
      settings.asset_directory = assetDirectory;
      draft.settings = settings;
    });
    setAssetDirectoryInput("");
  };

  const handleOverlayToggle = (id: string) => {
    setOverlayOptions((prev) =>
      prev.map((option) =>
        option.id === id ? { ...option, enabled: !option.enabled } : option
      )
    );
  };

  const handleOverlayPosition = (id: string, position: OverlayPosition["id"]) => {
    setOverlayOptions((prev) =>
      prev.map((option) => (option.id === id ? { ...option, position } : option))
    );
  };

  const plexUrl = isRecord(configDraft?.plex) ? (configDraft?.plex as Record<string, unknown>).url ?? "" : "";
  const plexToken = isRecord(configDraft?.plex)
    ? (configDraft?.plex as Record<string, unknown>).token ?? ""
    : "";
  const tmdbKey = isRecord(configDraft?.tmdb) ? (configDraft?.tmdb as Record<string, unknown>).apikey ?? "" : "";
  const cacheEnabled = isRecord(configDraft?.settings)
    ? Boolean((configDraft?.settings as Record<string, unknown>).cache)
    : false;
  const assetDirectory = isRecord(configDraft?.settings)
    ? (configDraft?.settings as Record<string, unknown>).asset_directory
    : undefined;
  const assetDirectoryList = Array.isArray(assetDirectory)
    ? assetDirectory
    : assetDirectory
      ? [assetDirectory]
      : [];

  return (
    <section className="page config-studio">
      <div className="page-header">
        <div>
          <p className="eyebrow">Config Studio</p>
          <h1>Visual builder for Kometa</h1>
          <p>Fill in the essentials, then drop into advanced YAML only when you need it.</p>
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
              <h2>Config files</h2>
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
              <h2>YAML library</h2>
              <p className="hint">Browse collections, overlays, playlists, or open any YAML path.</p>
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

      <div className="grid two">
        <div className="card builder">
          <div className="card-header">
            <div>
              <h2>Form-first config</h2>
              <p className="hint">Edit the core Kometa settings without touching YAML.</p>
            </div>
            <button className="ghost" onClick={handleSyncFromYaml} disabled={!isConfigFile}>
              Sync from YAML
            </button>
          </div>
          {!isConfigFile && (
            <div className="empty-state">
              <p>Select a config YAML file to unlock the form builder.</p>
            </div>
          )}
          {isConfigFile && (
            <div className="form-stack">
              {configParseError && <div className="banner error">{configParseError}</div>}
              <div className="section">
                <h3>Connections</h3>
                <div className="field-grid">
                  <label className="field">
                    <span>Plex URL</span>
                    <input
                      className="input"
                      value={String(plexUrl)}
                      onChange={(event) =>
                        updateConfigDraft((draft) => {
                          const plex = isRecord(draft.plex) ? { ...draft.plex } : {};
                          plex.url = event.target.value;
                          draft.plex = plex;
                        })
                      }
                      placeholder="http://192.168.1.12:32400"
                    />
                    <small>Required. Use your server URL, not app.plex.tv.</small>
                  </label>
                  <label className="field">
                    <span>Plex Token</span>
                    <input
                      className="input"
                      value={String(plexToken)}
                      onChange={(event) =>
                        updateConfigDraft((draft) => {
                          const plex = isRecord(draft.plex) ? { ...draft.plex } : {};
                          plex.token = event.target.value;
                          draft.plex = plex;
                        })
                      }
                      placeholder="Paste token"
                    />
                    <small>Required to authenticate with Plex.</small>
                  </label>
                  <label className="field">
                    <span>TMDb API Key</span>
                    <input
                      className="input"
                      value={String(tmdbKey)}
                      onChange={(event) =>
                        updateConfigDraft((draft) => {
                          const tmdb = isRecord(draft.tmdb) ? { ...draft.tmdb } : {};
                          tmdb.apikey = event.target.value;
                          draft.tmdb = tmdb;
                        })
                      }
                      placeholder="TMDb API key"
                    />
                    <small>Required for metadata and defaults.</small>
                  </label>
                </div>
              </div>

              <div className="section">
                <h3>Libraries</h3>
                <p className="hint">Match Plex library names exactly. Add at least one.</p>
                <div className="pill-row">
                  {libraries.map((name) => (
                    <span key={name} className="pill">
                      {name}
                      <button onClick={() => handleLibraryRemove(name)} aria-label={`Remove ${name}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  {!libraries.length && <span className="hint">No libraries yet.</span>}
                </div>
                <div className="field-row">
                  <input
                    className="input"
                    value={newLibraryName}
                    onChange={(event) => setNewLibraryName(event.target.value)}
                    placeholder="Movies"
                  />
                  <button className="ghost" onClick={handleLibraryAdd}>
                    Add library
                  </button>
                </div>
              </div>

              <div className="section">
                <h3>Settings</h3>
                <div className="field-grid">
                  <label className="field">
                    <span>Cache Enabled</span>
                    <div className="toggle">
                      <input
                        type="checkbox"
                        checked={cacheEnabled}
                        onChange={(event) =>
                          updateConfigDraft((draft) => {
                            const settings = isRecord(draft.settings) ? { ...draft.settings } : {};
                            settings.cache = event.target.checked;
                            draft.settings = settings;
                          })
                        }
                      />
                      <span>{cacheEnabled ? "On" : "Off"}</span>
                    </div>
                    <small>Kometa cache speeds up repeated runs.</small>
                  </label>
                  <label className="field">
                    <span>Asset directories</span>
                    <div className="pill-row">
                      {assetDirectoryList.map((entry, index) => (
                        <span key={`${entry}-${index}`} className="pill">
                          {String(entry)}
                        </span>
                      ))}
                      {!assetDirectoryList.length && <span className="hint">No directories yet.</span>}
                    </div>
                    <div className="field-row">
                      <input
                        className="input"
                        value={assetDirectoryInput}
                        onChange={(event) => setAssetDirectoryInput(event.target.value)}
                        placeholder="config/assets"
                      />
                      <button className="ghost" onClick={handleAssetDirectoryAdd}>
                        Add path
                      </button>
                    </div>
                    <small>Where Kometa stores artwork and overlay assets.</small>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card schema">
          <div className="card-header">
            <div>
              <h2>Kometa settings index</h2>
              <p className="hint">Search every config key (schema bundled in repo).</p>
            </div>
          </div>
          <div className="field-row">
            <input
              className="input"
              value={schemaQuery}
              onChange={(event) => setSchemaQuery(event.target.value)}
              placeholder="Search settings (ex: radarr, overlays, schedules)"
            />
          </div>
          <div className="pill-row">
            {filteredSchemaKeys.map((key) => (
              <span key={key} className="pill ghost">
                {key}
              </span>
            ))}
            {!filteredSchemaKeys.length && <span className="hint">No matches yet.</span>}
          </div>
          <p className="hint">
            Full schema-driven forms are next. This shows you every setting Kometa knows.
          </p>
        </div>
      </div>

      <div className="card overlay-designer">
        <div className="card-header">
          <div>
            <h2>Overlay designer</h2>
            <p className="hint">
              Compose overlays visually, then translate them to Kometa overlay files.
            </p>
          </div>
          <span className="tag">Preview only</span>
        </div>

        <div className="overlay-layout">
          <div className="overlay-controls">
            <div className="section">
              <h3>Overlay choices</h3>
              <div className="overlay-list">
                {overlayOptions.map((option) => (
                  <div key={option.id} className="overlay-item">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={option.enabled}
                        onChange={() => handleOverlayToggle(option.id)}
                      />
                      {option.label}
                    </label>
                    <select
                      className="input select"
                      value={option.position}
                      onChange={(event) =>
                        handleOverlayPosition(
                          option.id,
                          event.target.value as OverlayPosition["id"]
                        )
                      }
                    >
                      {OVERLAY_POSITIONS.map((position) => (
                        <option key={position.id} value={position.id}>
                          {position.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <h3>Poster source</h3>
              <div className="segmented">
                <button
                  className={posterMode === "sample" ? "active" : ""}
                  onClick={() => setPosterMode("sample")}
                >
                  Samples
                </button>
                <button
                  className={posterMode === "asset" ? "active" : ""}
                  onClick={() => setPosterMode("asset")}
                  disabled={!assetPosters.length}
                >
                  From assets
                </button>
              </div>
              {posterMode === "asset" && (
                <select
                  className="input select"
                  value={posterAssetPath}
                  onChange={(event) => setPosterAssetPath(event.target.value)}
                >
                  <option value="">Select an asset poster</option>
                  {assetPosters.map((poster) => (
                    <option key={poster.path} value={poster.path}>
                      {poster.path}
                    </option>
                  ))}
                </select>
              )}
              <p className="hint">Overlay files live under `/config/overlays` and assets under `/config/assets`.</p>
            </div>

            <div className="section">
              <h3>Overlay snippet</h3>
              <pre className="code-block">{overlaySnippet}</pre>
              <p className="hint">Placement controls are visual only for now.</p>
            </div>
          </div>

          <div className="overlay-preview">
            {SAMPLE_POSTERS.map((poster) => (
              <div key={poster.id} className="poster-card">
                <div className="poster-frame">
                  {posterMode === "asset" && posterAssetPath ? (
                    <img
                      src={`/api/files/raw?path=${encodeURIComponent(posterAssetPath)}`}
                      alt="Selected poster asset"
                    />
                  ) : (
                    <div className={`poster-sample poster-${poster.id}`}>
                      <span>{poster.label}</span>
                    </div>
                  )}
                  {overlayOptions
                    .filter((option) => option.enabled)
                    .map((option) => (
                      <div key={`${poster.id}-${option.id}`} className={`overlay-chip ${option.position}`}>
                        {option.label}
                      </div>
                    ))}
                </div>
                <p className="poster-caption">{poster.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="editor-card">
        <div className="editor-toolbar">
          <div>
            <h2>Advanced YAML</h2>
            <p className="hint">
              {selectedFile ? `Editing ${selectedFile}` : "Select a file to edit."}
            </p>
          </div>
          <div className="editor-actions">
            <button className="ghost" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? "Hide YAML" : "Show YAML"}
            </button>
            <button className="ghost" onClick={handleValidate}>
              Validate
            </button>
            <button className="primary" onClick={handleSave} disabled={!selectedFile}>
              Save
            </button>
          </div>
        </div>
        {showAdvanced && (
          <textarea
            value={yaml}
            onChange={(event) => setYaml(event.target.value)}
            placeholder={editorLoading ? "Loading..." : "Select a file to start editing."}
          />
        )}
      </div>
    </section>
  );
}
