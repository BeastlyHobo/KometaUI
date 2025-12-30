import { useCallback, useEffect, useMemo, useState } from "react";
import { parse, stringify } from "yaml";

import schema from "../data/kometa-config-schema.json";
import {
  ApiError,
  createConfig,
  getFileContent,
  listConfigs,
  listFiles,
  listSamplePosters,
  samplePosterUrl,
  saveFile,
  setActiveConfig,
  validateConfig,
  type ConfigEntry,
  type FileEntry,
  type SamplePoster
} from "../api";
import { useAuth } from "../state/auth";

type FileScope = {
  id: "collections" | "overlays" | "playlists" | "other";
  label: string;
  prefix?: string;
  stub: string;
};

type FileType = "config" | "collections" | "overlays" | "playlists" | "other";

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

type CollectionBuilder = {
  key: string;
  label: string;
  placeholder?: string;
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

const COLLECTION_BUILDERS: CollectionBuilder[] = [
  { key: "trakt_list", label: "Trakt List", placeholder: "https://trakt.tv/users/..." },
  { key: "tmdb_list", label: "TMDb List", placeholder: "List ID" },
  { key: "tmdb_collection", label: "TMDb Collection", placeholder: "Collection ID" },
  { key: "tmdb_movie", label: "TMDb Movie", placeholder: "Movie ID" },
  { key: "imdb_chart", label: "IMDb Chart", placeholder: "top_movies" },
  { key: "imdb_search", label: "IMDb Search", placeholder: "type: movie" },
  { key: "plex_search", label: "Plex Search", placeholder: "all: resolution:4K" }
];

const COLLECTION_SYNC_MODES = ["append", "sync", "remove", "append_not"];
const COLLECTION_ORDERS = ["release", "alpha", "custom", "random"];

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

function detectFileType(value: unknown, path: string | null, activeConfig: string | null): FileType {
  if (path && activeConfig && path === activeConfig) {
    return "config";
  }
  if (isConfigCandidate(value)) {
    return "config";
  }
  if (isRecord(value) && "collections" in value) {
    return "collections";
  }
  if (isRecord(value) && "overlays" in value) {
    return "overlays";
  }
  if (isRecord(value) && "playlists" in value) {
    return "playlists";
  }
  return "other";
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return raw;
}

function parseBuilderValue(raw: string): string | number | boolean | string[] {
  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return parseScalar(raw);
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
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
  const [fileDraft, setFileDraft] = useState<ConfigDraft | null>(null);
  const [fileType, setFileType] = useState<FileType>("other");
  const [fileParseError, setFileParseError] = useState<string | null>(null);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [assetDirectoryInput, setAssetDirectoryInput] = useState("");
  const [collectionNameInput, setCollectionNameInput] = useState("");
  const [collectionBuilderInputs, setCollectionBuilderInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const [overlayNameInput, setOverlayNameInput] = useState("");

  const [overlayOptions, setOverlayOptions] = useState<OverlayOption[]>(DEFAULT_OVERLAYS);
  const [posterMode, setPosterMode] = useState<"sample" | "asset">("sample");
  const [assetPosters, setAssetPosters] = useState<FileEntry[]>([]);
  const [posterAssetPath, setPosterAssetPath] = useState("");
  const [samplePosters, setSamplePosters] = useState<SamplePoster[]>([]);

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

  const collectionsMap = useMemo(() => {
    if (!fileDraft || !isRecord(fileDraft.collections)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return fileDraft.collections as Record<string, Record<string, unknown>>;
  }, [fileDraft]);

  const overlaysMap = useMemo(() => {
    if (!fileDraft || !isRecord(fileDraft.overlays)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return fileDraft.overlays as Record<string, Record<string, unknown>>;
  }, [fileDraft]);

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
          const detectedType = detectFileType(parsed, data.path, activeConfig);
          setFileType(detectedType);
          setFileDraft(isRecord(parsed) ? (parsed as ConfigDraft) : {});
          setFileParseError(null);

          if (detectedType === "config") {
            setConfigDraft(isRecord(parsed) ? (parsed as ConfigDraft) : {});
          } else {
            setConfigDraft(null);
          }
        } catch (parseError) {
          setFileType("other");
          setFileDraft(null);
          setConfigDraft(null);
          setFileParseError((parseError as Error).message);
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

  const refreshSamplePosters = useCallback(async () => {
    try {
      const data = await listSamplePosters();
      setSamplePosters(data);
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
    refreshSamplePosters();
  }, [refreshPosterAssets, refreshSamplePosters]);

  const updateConfigDraft = useCallback(
    (mutator: (draft: ConfigDraft) => void) => {
      if (fileType !== "config") {
        return;
      }
      setConfigDraft((prev) => {
        const next = cloneConfig(prev);
        mutator(next);
        setYaml(stringify(next, { indent: 2 }));
        setFileDraft(next);
        return next;
      });
    },
    [fileType]
  );

  const updateFileDraft = useCallback(
    (mutator: (draft: ConfigDraft) => void) => {
      if (fileType === "other" || fileType === "config") {
        return;
      }
      setFileDraft((prev) => {
        const next = cloneConfig(prev);
        mutator(next);
        setYaml(stringify(next, { indent: 2 }));
        return next;
      });
    },
    [fileType]
  );

  const handleSyncFromYaml = () => {
    if (!selectedFile) {
      return;
    }
    try {
      const parsed = parse(yaml) as unknown;
      const detectedType = detectFileType(parsed, selectedFile, activeConfig);
      setFileType(detectedType);
      setFileDraft(isRecord(parsed) ? (parsed as ConfigDraft) : {});
      setFileParseError(null);
      if (detectedType === "config") {
        setConfigDraft(isRecord(parsed) ? (parsed as ConfigDraft) : {});
      } else {
        setConfigDraft(null);
      }
      setMessage("Form synced from YAML.");
    } catch (parseError) {
      setFileParseError((parseError as Error).message);
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

  const handleCollectionAdd = () => {
    if (!collectionNameInput.trim()) {
      return;
    }
    updateFileDraft((draft) => {
      const collections = isRecord(draft.collections) ? { ...draft.collections } : {};
      collections[collectionNameInput.trim()] = collections[collectionNameInput.trim()] ?? {};
      draft.collections = collections;
    });
    setCollectionNameInput("");
  };

  const handleCollectionRemove = (name: string) => {
    updateFileDraft((draft) => {
      if (!isRecord(draft.collections)) {
        return;
      }
      const collections = { ...draft.collections } as Record<string, unknown>;
      delete collections[name];
      draft.collections = collections;
    });
  };

  const handleCollectionRename = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      return;
    }
    updateFileDraft((draft) => {
      if (!isRecord(draft.collections)) {
        return;
      }
      const collections = { ...draft.collections } as Record<string, unknown>;
      const entry = collections[oldName];
      delete collections[oldName];
      collections[newName.trim()] = entry;
      draft.collections = collections;
    });
  };

  const handleCollectionField = (name: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const collections = isRecord(draft.collections) ? { ...draft.collections } : {};
      const entry = isRecord(collections[name]) ? { ...(collections[name] as Record<string, unknown>) } : {};
      if (value === "") {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      collections[name] = entry;
      draft.collections = collections;
    });
  };

  const handleBuilderInput = (collectionName: string, key: string, value: string) => {
    setCollectionBuilderInputs((prev) => ({
      ...prev,
      [collectionName]: { key, value }
    }));
  };

  const handleBuilderAdd = (collectionName: string) => {
    const entry = collectionBuilderInputs[collectionName];
    if (!entry || !entry.key || !entry.value.trim()) {
      return;
    }
    handleCollectionField(collectionName, entry.key, parseBuilderValue(entry.value));
    setCollectionBuilderInputs((prev) => ({
      ...prev,
      [collectionName]: { key: entry.key, value: "" }
    }));
  };

  const handleBuilderRemove = (collectionName: string, key: string) => {
    handleCollectionField(collectionName, key, "");
  };

  const handleOverlayAdd = () => {
    if (!overlayNameInput.trim()) {
      return;
    }
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      overlays[overlayNameInput.trim()] = overlays[overlayNameInput.trim()] ?? {};
      draft.overlays = overlays;
    });
    setOverlayNameInput("");
  };

  const handleOverlayRemove = (name: string) => {
    updateFileDraft((draft) => {
      if (!isRecord(draft.overlays)) {
        return;
      }
      const overlays = { ...draft.overlays } as Record<string, unknown>;
      delete overlays[name];
      draft.overlays = overlays;
    });
  };

  const handleOverlayRename = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      return;
    }
    updateFileDraft((draft) => {
      if (!isRecord(draft.overlays)) {
        return;
      }
      const overlays = { ...draft.overlays } as Record<string, unknown>;
      const entry = overlays[oldName];
      delete overlays[oldName];
      overlays[newName.trim()] = entry;
      draft.overlays = overlays;
    });
  };

  const handleOverlayField = (name: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      const entry = isRecord(overlays[name]) ? { ...(overlays[name] as Record<string, unknown>) } : {};
      if (value === "") {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      overlays[name] = entry;
      draft.overlays = overlays;
    });
  };

  const handleOverlayNestedField = (name: string, section: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      const entry = isRecord(overlays[name]) ? { ...(overlays[name] as Record<string, unknown>) } : {};
      const nested = isRecord(entry[section]) ? { ...(entry[section] as Record<string, unknown>) } : {};
      if (value === "") {
        delete nested[field];
      } else {
        nested[field] = value;
      }
      entry[section] = nested;
      overlays[name] = entry;
      draft.overlays = overlays;
    });
  };

  const handleOverlaySearchField = (name: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      const entry = isRecord(overlays[name]) ? { ...(overlays[name] as Record<string, unknown>) } : {};
      const plexSearch = isRecord(entry.plex_search) ? { ...(entry.plex_search as Record<string, unknown>) } : {};
      const allSearch = isRecord(plexSearch.all) ? { ...(plexSearch.all as Record<string, unknown>) } : {};
      if (value === "") {
        delete allSearch[field];
      } else {
        allSearch[field] = value;
      }
      plexSearch.all = allSearch;
      entry.plex_search = plexSearch;
      overlays[name] = entry;
      draft.overlays = overlays;
    });
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

  const samplePosterMap = useMemo(() => {
    return samplePosters.reduce<Record<string, SamplePoster>>((acc, poster) => {
      acc[poster.id] = poster;
      return acc;
    }, {});
  }, [samplePosters]);

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

      {fileType === "config" && (
        <div className="grid two">
          <div className="card builder">
            <div className="card-header">
              <div>
                <h2>Form-first config</h2>
                <p className="hint">Edit the core Kometa settings without touching YAML.</p>
              </div>
              <button className="ghost" onClick={handleSyncFromYaml}>
                Sync from YAML
              </button>
            </div>
            {fileParseError && <div className="banner error">{fileParseError}</div>}
            <div className="form-stack">
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
      )}

      {fileType === "collections" && (
        <div className="grid two">
          <div className="card builder">
            <div className="card-header">
              <div>
                <h2>Collections builder</h2>
                <p className="hint">Create and edit collection definitions inside this file.</p>
              </div>
              <button className="ghost" onClick={handleSyncFromYaml}>
                Sync from YAML
              </button>
            </div>
            {fileParseError && <div className="banner error">{fileParseError}</div>}
            <div className="field-row">
              <input
                className="input"
                value={collectionNameInput}
                onChange={(event) => setCollectionNameInput(event.target.value)}
                placeholder="New collection name"
              />
              <button className="primary" onClick={handleCollectionAdd}>
                Add collection
              </button>
            </div>
            <div className="collection-list">
              {Object.entries(collectionsMap).map(([name, collection]) => {
                const entry = isRecord(collection) ? collection : {};
                const builderKeys = COLLECTION_BUILDERS.filter((builder) => builder.key in entry);
                const builderInput = collectionBuilderInputs[name] ?? {
                  key: COLLECTION_BUILDERS[0].key,
                  value: ""
                };
                return (
                  <div key={name} className="collection-card">
                    <div className="collection-header">
                      <input
                        className="input title"
                        defaultValue={name}
                        onBlur={(event) => handleCollectionRename(name, event.target.value)}
                      />
                      <button className="ghost" onClick={() => handleCollectionRemove(name)}>
                        Remove
                      </button>
                    </div>
                    <div className="builder-fields">
                      {builderKeys.map((builder) => (
                        <div key={`${name}-${builder.key}`} className="builder-row">
                          <span>{builder.label}</span>
                          <input
                            className="input"
                            value={stringifyValue(entry[builder.key])}
                            onChange={(event) =>
                              handleCollectionField(name, builder.key, parseBuilderValue(event.target.value))
                            }
                          />
                          <button
                            className="ghost"
                            onClick={() => handleBuilderRemove(name, builder.key)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div className="builder-row">
                        <select
                          className="input select"
                          value={builderInput.key}
                          onChange={(event) => handleBuilderInput(name, event.target.value, builderInput.value)}
                        >
                          {COLLECTION_BUILDERS.map((builder) => (
                            <option key={builder.key} value={builder.key}>
                              {builder.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input"
                          value={builderInput.value}
                          placeholder={
                            COLLECTION_BUILDERS.find((builder) => builder.key === builderInput.key)?.placeholder ??
                            "Builder value"
                          }
                          onChange={(event) => handleBuilderInput(name, builderInput.key, event.target.value)}
                        />
                        <button className="ghost" onClick={() => handleBuilderAdd(name)}>
                          Add
                        </button>
                      </div>
                    </div>
                    <div className="field-grid">
                      <label className="field">
                        <span>Summary</span>
                        <textarea
                          className="input"
                          value={stringifyValue(entry.summary)}
                          onChange={(event) => handleCollectionField(name, "summary", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Sort title</span>
                        <input
                          className="input"
                          value={stringifyValue(entry.sort_title)}
                          onChange={(event) => handleCollectionField(name, "sort_title", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Smart label</span>
                        <input
                          className="input"
                          value={stringifyValue(entry.smart_label)}
                          onChange={(event) => handleCollectionField(name, "smart_label", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Sync mode</span>
                        <select
                          className="input select"
                          value={stringifyValue(entry.sync_mode)}
                          onChange={(event) => handleCollectionField(name, "sync_mode", event.target.value)}
                        >
                          <option value="">Choose</option>
                          {COLLECTION_SYNC_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Collection order</span>
                        <select
                          className="input select"
                          value={stringifyValue(entry.collection_order)}
                          onChange={(event) => handleCollectionField(name, "collection_order", event.target.value)}
                        >
                          <option value="">Choose</option>
                          {COLLECTION_ORDERS.map((order) => (
                            <option key={order} value={order}>
                              {order}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Schedule</span>
                        <input
                          className="input"
                          value={stringifyValue(entry.schedule)}
                          onChange={(event) => handleCollectionField(name, "schedule", event.target.value)}
                          placeholder="weekly(monday)"
                        />
                      </label>
                      <label className="field">
                        <span>Build collection</span>
                        <div className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(entry.build_collection ?? true)}
                            onChange={(event) => handleCollectionField(name, "build_collection", event.target.checked)}
                          />
                          <span>{entry.build_collection === false ? "Off" : "On"}</span>
                        </div>
                      </label>
                    </div>
                  </div>
                );
              })}
              {!Object.keys(collectionsMap).length && (
                <p className="hint">No collections defined yet.</p>
              )}
            </div>
          </div>

          <div className="card schema">
            <div className="card-header">
              <div>
                <h2>Common collection fields</h2>
                <p className="hint">Start with builders and basics, advanced YAML for everything else.</p>
              </div>
            </div>
            <div className="pill-row">
              {COLLECTION_BUILDERS.map((builder) => (
                <span key={builder.key} className="pill ghost">
                  {builder.key}
                </span>
              ))}
            </div>
            <p className="hint">
              Kometa supports many more builders. We can add them next once you test the flow.
            </p>
          </div>
        </div>
      )}

      {fileType === "overlays" && (
        <div className="grid two">
          <div className="card builder">
            <div className="card-header">
              <div>
                <h2>Overlays builder</h2>
                <p className="hint">Design overlay definitions and search rules.</p>
              </div>
              <button className="ghost" onClick={handleSyncFromYaml}>
                Sync from YAML
              </button>
            </div>
            {fileParseError && <div className="banner error">{fileParseError}</div>}
            <div className="field-row">
              <input
                className="input"
                value={overlayNameInput}
                onChange={(event) => setOverlayNameInput(event.target.value)}
                placeholder="New overlay name"
              />
              <button className="primary" onClick={handleOverlayAdd}>
                Add overlay
              </button>
            </div>
            <div className="collection-list">
              {Object.entries(overlaysMap).map(([name, overlay]) => {
                const entry = isRecord(overlay) ? overlay : {};
                const overlayConfig = isRecord(entry.overlay) ? (entry.overlay as Record<string, unknown>) : {};
                const plexSearch = isRecord(entry.plex_search)
                  ? (entry.plex_search as Record<string, unknown>)
                  : {};
                const plexAll = isRecord(plexSearch.all) ? (plexSearch.all as Record<string, unknown>) : {};
                return (
                  <div key={name} className="collection-card">
                    <div className="collection-header">
                      <input
                        className="input title"
                        defaultValue={name}
                        onBlur={(event) => handleOverlayRename(name, event.target.value)}
                      />
                      <button className="ghost" onClick={() => handleOverlayRemove(name)}>
                        Remove
                      </button>
                    </div>
                    <div className="field-grid">
                      <label className="field">
                        <span>Overlay text</span>
                        <input
                          className="input"
                          value={
                            typeof overlayConfig.name === "string" && overlayConfig.name.startsWith("text(")
                              ? overlayConfig.name.replace(/^text\(|\)$/g, "")
                              : ""
                          }
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "name", `text(${event.target.value})`)
                          }
                          placeholder="Direct Play"
                        />
                      </label>
                      <label className="field">
                        <span>Default image</span>
                        <input
                          className="input"
                          value={stringifyValue(overlayConfig.default)}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "default", event.target.value)
                          }
                          placeholder="ribbon/yellow/imdb.png"
                        />
                      </label>
                      <label className="field">
                        <span>Image file</span>
                        <input
                          className="input"
                          value={stringifyValue(overlayConfig.file)}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "file", event.target.value)
                          }
                          placeholder="config/overlays/MyOverlay.png"
                        />
                      </label>
                      <label className="field">
                        <span>Image URL</span>
                        <input
                          className="input"
                          value={stringifyValue(overlayConfig.url)}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "url", event.target.value)
                          }
                          placeholder="https://..."
                        />
                      </label>
                      <label className="field">
                        <span>Horizontal align</span>
                        <select
                          className="input select"
                          value={stringifyValue(entry.horizontal_align)}
                          onChange={(event) => handleOverlayField(name, "horizontal_align", event.target.value)}
                        >
                          <option value="">Choose</option>
                          <option value="left">left</option>
                          <option value="center">center</option>
                          <option value="right">right</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Vertical align</span>
                        <select
                          className="input select"
                          value={stringifyValue(entry.vertical_align)}
                          onChange={(event) => handleOverlayField(name, "vertical_align", event.target.value)}
                        >
                          <option value="">Choose</option>
                          <option value="top">top</option>
                          <option value="center">center</option>
                          <option value="bottom">bottom</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Horizontal offset</span>
                        <input
                          className="input"
                          value={stringifyValue(entry.horizontal_offset)}
                          onChange={(event) => handleOverlayField(name, "horizontal_offset", parseScalar(event.target.value) )}
                        />
                      </label>
                      <label className="field">
                        <span>Vertical offset</span>
                        <input
                          className="input"
                          value={stringifyValue(entry.vertical_offset)}
                          onChange={(event) => handleOverlayField(name, "vertical_offset", parseScalar(event.target.value))}
                        />
                      </label>
                      <label className="field">
                        <span>Resolution filter</span>
                        <input
                          className="input"
                          value={stringifyValue(plexAll.resolution)}
                          onChange={(event) =>
                            handleOverlaySearchField(name, "resolution", event.target.value)
                          }
                          placeholder="4K"
                        />
                      </label>
                      <label className="field">
                        <span>HDR only</span>
                        <div className="toggle">
                          <input
                            type="checkbox"
                            checked={Boolean(plexAll.hdr)}
                            onChange={(event) => handleOverlaySearchField(name, "hdr", event.target.checked)}
                          />
                          <span>{plexAll.hdr ? "On" : "Off"}</span>
                        </div>
                      </label>
                    </div>
                  </div>
                );
              })}
              {!Object.keys(overlaysMap).length && <p className="hint">No overlays defined yet.</p>}
            </div>
          </div>

          <div className="card schema">
            <div className="card-header">
              <div>
                <h2>Overlay file basics</h2>
                <p className="hint">Overlays rely on positional attributes and search rules.</p>
              </div>
            </div>
            <ul className="plain-list">
              <li>All overlay coordinates assume 1000x1500 posters.</li>
              <li>Use transparent PNGs for best results.</li>
              <li>Overlays apply in the order they are defined.</li>
              <li>Use horizontal/vertical align + offsets for placement.</li>
            </ul>
          </div>
        </div>
      )}

      {(fileType === "overlays" || fileScope.id === "overlays") && (
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
                    PosterDB samples
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
                <p className="hint">Samples are cached in /data/posters.</p>
              </div>

              <div className="section">
                <h3>Overlay snippet</h3>
                <pre className="code-block">{overlaySnippet}</pre>
                <p className="hint">Placement controls are visual only for now.</p>
              </div>
            </div>

            <div className="overlay-preview">
              {SAMPLE_POSTERS.map((poster) => {
                const cached = samplePosterMap[poster.id];
                const imageUrl = cached ? samplePosterUrl(cached.id) : null;
                return (
                  <div key={poster.id} className="poster-card">
                    <div className="poster-frame">
                      {posterMode === "asset" && posterAssetPath ? (
                        <img
                          src={`/api/files/raw?path=${encodeURIComponent(posterAssetPath)}`}
                          alt="Selected poster asset"
                        />
                      ) : imageUrl ? (
                        <img src={imageUrl} alt={poster.label} />
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
                );
              })}
            </div>
          </div>
        </div>
      )}

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
