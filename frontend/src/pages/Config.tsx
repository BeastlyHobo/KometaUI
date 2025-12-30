import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { parse, stringify } from "yaml";

import schema from "../data/kometa-config-schema.json";
import {
  ApiError,
  createConfig,
  getFileContent,
  listConfigs,
  listFiles,
  listDefaultOverlays,
  listSamplePosters,
  renderOverlayPreview,
  samplePosterUrl,
  saveFile,
  setActiveConfig,
  syncDefaultOverlays,
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

type CollectionBuilder = {
  key: string;
  label: string;
  placeholder?: string;
};

type CollectionPreset = {
  id: string;
  label: string;
  builderKey?: string;
  placeholder?: string;
};

const FILE_SCOPES: FileScope[] = [
  { id: "collections", label: "Collections", prefix: "collections", stub: "collections:\n" },
  { id: "overlays", label: "Overlays", prefix: "overlays", stub: "overlays:\n" },
  { id: "playlists", label: "Playlists", prefix: "playlists", stub: "playlists:\n" },
  { id: "other", label: "Other YAML", stub: "libraries: {}\n" }
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
  { key: "tmdb_popular", label: "TMDb Popular", placeholder: "Count" },
  { key: "tmdb_trending_daily", label: "TMDb Trending (Daily)", placeholder: "Count" },
  { key: "tmdb_trending_weekly", label: "TMDb Trending (Weekly)", placeholder: "Count" },
  { key: "imdb_chart", label: "IMDb Chart", placeholder: "top_movies" },
  { key: "imdb_search", label: "IMDb Search", placeholder: "type: movie" },
  { key: "plex_search", label: "Plex Search", placeholder: "all: resolution:4K" }
];

const COLLECTION_PRESETS: CollectionPreset[] = [
  { id: "blank", label: "Blank collection" },
  { id: "tmdb_list", label: "TMDb List", builderKey: "tmdb_list", placeholder: "List ID or URL" },
  { id: "trakt_list", label: "Trakt List", builderKey: "trakt_list", placeholder: "https://trakt.tv/users/..." },
  { id: "imdb_chart", label: "IMDb Chart", builderKey: "imdb_chart", placeholder: "top_movies" },
  { id: "imdb_search", label: "IMDb Search", builderKey: "imdb_search", placeholder: "type: movie" },
  { id: "tmdb_collection", label: "TMDb Collection", builderKey: "tmdb_collection", placeholder: "Collection ID" },
  { id: "plex_search", label: "Plex Search", builderKey: "plex_search", placeholder: "all: resolution:4K" }
];

const DYNAMIC_COLLECTION_TYPES = [
  "tmdb_collection",
  "tmdb_popular_people",
  "original_language",
  "origin_country",
  "imdb_awards",
  "letterboxd_user_lists",
  "trakt_user_lists",
  "trakt_liked_lists",
  "trakt_people_list",
  "actor",
  "director",
  "writer",
  "producer",
  "genre",
  "album_genre",
  "content_rating",
  "year",
  "episode_year",
  "decade",
  "country",
  "resolution",
  "subtitle_language",
  "audio_language",
  "studio",
  "edition",
  "network",
  "mood",
  "album_mood",
  "track_mood",
  "style",
  "album_style",
  "number",
  "custom"
];

const COLLECTION_QUICK_FIELDS = new Set([
  "summary",
  "sort_title",
  "smart_label",
  "sync_mode",
  "collection_order",
  "schedule",
  "build_collection"
]);

const DYNAMIC_QUICK_FIELDS = new Set([
  "type",
  "data",
  "template",
  "title_format",
  "remove_prefix",
  "remove_suffix",
  "include",
  "exclude",
  "addons",
  "other_name",
  "other_template",
  "key_name_override",
  "title_override",
  "template_variables",
  "custom_keys",
  "test",
  "sync"
]);

const TEMPLATE_CONTROL_FIELDS = new Set(["default", "optional", "conditionals", "move_prefix"]);

const OVERLAY_ENTRY_FIELDS = new Set([
  "overlay",
  "scale_width",
  "scale_height",
  "font",
  "font_style",
  "font_size",
  "font_color",
  "stroke_color",
  "stroke_width",
  "back_color",
  "back_align",
  "back_width",
  "back_height",
  "back_padding",
  "back_radius",
  "back_line_color",
  "back_line_width",
  "addon_position",
  "addon_offset",
  "horizontal_align",
  "vertical_align",
  "horizontal_offset",
  "vertical_offset",
  "group",
  "queue",
  "weight",
  "suppress_overlays",
  "builder_level",
  "plex_all",
  "plex_search",
  "filters"
]);

const OVERLAY_SEARCH_FIELDS = new Set(["resolution", "hdr"]);

const COLLECTION_SYNC_MODES = ["append", "sync", "remove", "append_not"];
const COLLECTION_ORDERS = ["release", "alpha", "custom", "random"];

const POSTER_BASE = { width: 1000, height: 1500 };

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

function parseValueInput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (/[\n\[\]\{\}:]/.test(trimmed) || trimmed.startsWith("-")) {
    try {
      return parse(trimmed) as unknown;
    } catch (err) {
      return parseBuilderValue(trimmed);
    }
  }
  return parseBuilderValue(trimmed);
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.some((entry) => entry && typeof entry === "object")) {
      return stringify(value, { indent: 2 }).trim();
    }
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return stringify(value, { indent: 2 }).trim();
  }
  return String(value);
}

function parseOverlayName(value: unknown): { kind: "text" | "blur" | "backdrop" | "image"; text?: string; blur?: number; name?: string } {
  if (typeof value !== "string") {
    return { kind: "image", name: "" };
  }
  if (value.startsWith("text(") && value.endsWith(")")) {
    return { kind: "text", text: value.replace(/^text\(|\)$/g, "") };
  }
  if (value.startsWith("blur(") && value.endsWith(")")) {
    const raw = value.replace(/^blur\(|\)$/g, "");
    const blur = Number(raw);
    return { kind: "blur", blur: Number.isFinite(blur) ? blur : undefined };
  }
  if (value === "backdrop") {
    return { kind: "backdrop" };
  }
  return { kind: "image", name: value };
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePercentValue(value: unknown, base: number): number {
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const parsed = Number(value.trim().replace("%", ""));
    if (Number.isFinite(parsed)) {
      return (parsed / 100) * base;
    }
  }
  const numeric = parseNumeric(value);
  return numeric ?? 0;
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
  const [collectionPresetId, setCollectionPresetId] = useState(COLLECTION_PRESETS[0].id);
  const [collectionPresetValue, setCollectionPresetValue] = useState("");
  const [collectionAttributeInputs, setCollectionAttributeInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const [dynamicAttributeInputs, setDynamicAttributeInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const [templateAttributeInputs, setTemplateAttributeInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const [dynamicCollectionNameInput, setDynamicCollectionNameInput] = useState("");
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [externalTemplateInput, setExternalTemplateInput] = useState("");
  const [overlayNameInput, setOverlayNameInput] = useState("");
  const [overlayAttributeInputs, setOverlayAttributeInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});
  const [overlaySearchInputs, setOverlaySearchInputs] = useState<
    Record<string, { key: string; value: string }>
  >({});

  const [posterMode, setPosterMode] = useState<"sample" | "asset">("sample");
  const [posterSampleId, setPosterSampleId] = useState("movie");
  const [assetPosters, setAssetPosters] = useState<FileEntry[]>([]);
  const [posterAssetPath, setPosterAssetPath] = useState("");
  const [samplePosters, setSamplePosters] = useState<SamplePoster[]>([]);
  const [overlayImages, setOverlayImages] = useState<FileEntry[]>([]);
  const [overlayPreviewSelection, setOverlayPreviewSelection] = useState<Record<string, boolean>>({});
  const [kometaPreviewUrl, setKometaPreviewUrl] = useState<string | null>(null);
  const [kometaPreviewLoading, setKometaPreviewLoading] = useState(false);
  const [kometaPreviewError, setKometaPreviewError] = useState<string | null>(null);
  const [defaultOverlayAssets, setDefaultOverlayAssets] = useState<FileEntry[]>([]);
  const [defaultOverlayQuery, setDefaultOverlayQuery] = useState("");

  const [schemaQuery, setSchemaQuery] = useState("");
  const [posterWidth, setPosterWidth] = useState(0);
  const posterFrameRef = useRef<HTMLDivElement | null>(null);

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

  const dynamicCollectionsMap = useMemo(() => {
    if (!fileDraft || !isRecord(fileDraft.dynamic_collections)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return fileDraft.dynamic_collections as Record<string, Record<string, unknown>>;
  }, [fileDraft]);

  const templatesMap = useMemo(() => {
    if (!fileDraft || !isRecord(fileDraft.templates)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return fileDraft.templates as Record<string, Record<string, unknown>>;
  }, [fileDraft]);

  const externalTemplatesList = useMemo(() => {
    if (!fileDraft || !Array.isArray(fileDraft.external_templates)) {
      return [] as Array<Record<string, unknown>>;
    }
    return fileDraft.external_templates as Array<Record<string, unknown>>;
  }, [fileDraft]);

  const overlaysMap = useMemo(() => {
    if (!fileDraft || !isRecord(fileDraft.overlays)) {
      return {} as Record<string, Record<string, unknown>>;
    }
    return fileDraft.overlays as Record<string, Record<string, unknown>>;
  }, [fileDraft]);

  const overlaySnippet = useMemo(() => {
    const names = Object.keys(overlaysMap);
    if (!names.length) {
      return "# No overlays defined yet";
    }
    const selected = names.filter((name) => overlayPreviewSelection[name] ?? true);
    if (!selected.length) {
      return "# No overlays selected for preview";
    }
    const overlays = selected.reduce<Record<string, unknown>>((acc, name) => {
      acc[name] = overlaysMap[name];
      return acc;
    }, {});
    return stringify({ overlays }, { indent: 2 }).trim();
  }, [overlaysMap, overlayPreviewSelection]);

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

  const refreshOverlayImages = useCallback(async () => {
    try {
      const data = await listFiles("overlays", ["png", "jpg", "jpeg", "webp"]);
      setOverlayImages(data);
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

  const refreshDefaultOverlays = useCallback(async () => {
    try {
      await syncDefaultOverlays();
      const data = await listDefaultOverlays();
      setDefaultOverlayAssets(data);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setError(apiErr.message || "Failed to load default overlays");
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
    refreshOverlayImages();
    refreshSamplePosters();
  }, [refreshOverlayImages, refreshPosterAssets, refreshSamplePosters]);

  useEffect(() => {
    if (fileType === "overlays" || fileScope.id === "overlays") {
      refreshDefaultOverlays();
    }
  }, [fileScope.id, fileType, refreshDefaultOverlays]);

  useEffect(() => {
    const names = Object.keys(overlaysMap);
    setOverlayPreviewSelection((prev) => {
      const next = { ...prev };
      names.forEach((name) => {
        if (!(name in next)) {
          next[name] = true;
        }
      });
      Object.keys(next).forEach((name) => {
        if (!names.includes(name)) {
          delete next[name];
        }
      });
      return next;
    });
  }, [overlaysMap]);

  useEffect(() => {
    const frame = posterFrameRef.current;
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) {
          setPosterWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCollectionPresetValue("");
  }, [collectionPresetId]);

  useEffect(() => {
    setKometaPreviewUrl(null);
  }, [overlaysMap, posterMode, posterAssetPath, posterSampleId]);

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
    const preset = COLLECTION_PRESETS.find((entry) => entry.id === collectionPresetId);
    updateFileDraft((draft) => {
      const collections = isRecord(draft.collections) ? { ...draft.collections } : {};
      const name = collectionNameInput.trim();
      const existing = isRecord(collections[name]) ? (collections[name] as Record<string, unknown>) : {};
      const entry = { ...existing };
      if (preset?.builderKey && collectionPresetValue.trim()) {
        entry[preset.builderKey] = parseValueInput(collectionPresetValue);
      }
      collections[name] = entry;
      draft.collections = collections;
    });
    setCollectionNameInput("");
    setCollectionPresetValue("");
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

  const handleCollectionAttributeInput = (collectionName: string, key: string, value: string) => {
    setCollectionAttributeInputs((prev) => ({
      ...prev,
      [collectionName]: { key, value }
    }));
  };

  const handleCollectionAttributeAdd = (collectionName: string) => {
    const entry = collectionAttributeInputs[collectionName];
    if (!entry || !entry.key.trim() || !entry.value.trim()) {
      return;
    }
    handleCollectionField(collectionName, entry.key.trim(), parseValueInput(entry.value));
    setCollectionAttributeInputs((prev) => ({
      ...prev,
      [collectionName]: { key: entry.key, value: "" }
    }));
  };

  const handleCollectionAttributeRemove = (collectionName: string, key: string) => {
    handleCollectionField(collectionName, key, "");
  };

  const handleCollectionAttributeRename = (collectionName: string, oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) {
      return;
    }
    updateFileDraft((draft) => {
      const collections = isRecord(draft.collections) ? { ...draft.collections } : {};
      const entry = isRecord(collections[collectionName]) ? { ...(collections[collectionName] as Record<string, unknown>) } : {};
      if (!(oldKey in entry)) {
        return;
      }
      entry[newKey.trim()] = entry[oldKey];
      delete entry[oldKey];
      collections[collectionName] = entry;
      draft.collections = collections;
    });
  };

  const handleDynamicCollectionAdd = () => {
    if (!dynamicCollectionNameInput.trim()) {
      return;
    }
    updateFileDraft((draft) => {
      const dynamic = isRecord(draft.dynamic_collections) ? { ...draft.dynamic_collections } : {};
      dynamic[dynamicCollectionNameInput.trim()] = dynamic[dynamicCollectionNameInput.trim()] ?? {};
      draft.dynamic_collections = dynamic;
    });
    setDynamicCollectionNameInput("");
  };

  const handleDynamicCollectionRemove = (name: string) => {
    updateFileDraft((draft) => {
      if (!isRecord(draft.dynamic_collections)) {
        return;
      }
      const dynamic = { ...draft.dynamic_collections } as Record<string, unknown>;
      delete dynamic[name];
      draft.dynamic_collections = dynamic;
    });
  };

  const handleDynamicCollectionRename = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      return;
    }
    updateFileDraft((draft) => {
      if (!isRecord(draft.dynamic_collections)) {
        return;
      }
      const dynamic = { ...draft.dynamic_collections } as Record<string, unknown>;
      const entry = dynamic[oldName];
      delete dynamic[oldName];
      dynamic[newName.trim()] = entry;
      draft.dynamic_collections = dynamic;
    });
  };

  const handleDynamicCollectionField = (name: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const dynamic = isRecord(draft.dynamic_collections) ? { ...draft.dynamic_collections } : {};
      const entry = isRecord(dynamic[name]) ? { ...(dynamic[name] as Record<string, unknown>) } : {};
      if (value === "") {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      dynamic[name] = entry;
      draft.dynamic_collections = dynamic;
    });
  };

  const handleTemplateAdd = () => {
    if (!templateNameInput.trim()) {
      return;
    }
    updateFileDraft((draft) => {
      const templates = isRecord(draft.templates) ? { ...draft.templates } : {};
      templates[templateNameInput.trim()] = templates[templateNameInput.trim()] ?? {};
      draft.templates = templates;
    });
    setTemplateNameInput("");
  };

  const handleTemplateRemove = (name: string) => {
    updateFileDraft((draft) => {
      if (!isRecord(draft.templates)) {
        return;
      }
      const templates = { ...draft.templates } as Record<string, unknown>;
      delete templates[name];
      draft.templates = templates;
    });
  };

  const handleTemplateRename = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      return;
    }
    updateFileDraft((draft) => {
      if (!isRecord(draft.templates)) {
        return;
      }
      const templates = { ...draft.templates } as Record<string, unknown>;
      const entry = templates[oldName];
      delete templates[oldName];
      templates[newName.trim()] = entry;
      draft.templates = templates;
    });
  };

  const handleTemplateField = (name: string, field: string, value: unknown) => {
    updateFileDraft((draft) => {
      const templates = isRecord(draft.templates) ? { ...draft.templates } : {};
      const entry = isRecord(templates[name]) ? { ...(templates[name] as Record<string, unknown>) } : {};
      if (value === "") {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      templates[name] = entry;
      draft.templates = templates;
    });
  };

  const handleDynamicAttributeInput = (name: string, key: string, value: string) => {
    setDynamicAttributeInputs((prev) => ({
      ...prev,
      [name]: { key, value }
    }));
  };

  const handleDynamicAttributeAdd = (name: string) => {
    const entry = dynamicAttributeInputs[name];
    if (!entry || !entry.key.trim() || !entry.value.trim()) {
      return;
    }
    handleDynamicCollectionField(name, entry.key.trim(), parseValueInput(entry.value));
    setDynamicAttributeInputs((prev) => ({
      ...prev,
      [name]: { key: entry.key, value: "" }
    }));
  };

  const handleDynamicAttributeRemove = (name: string, key: string) => {
    handleDynamicCollectionField(name, key, "");
  };

  const handleDynamicAttributeRename = (name: string, oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) {
      return;
    }
    updateFileDraft((draft) => {
      const dynamic = isRecord(draft.dynamic_collections) ? { ...draft.dynamic_collections } : {};
      const entry = isRecord(dynamic[name]) ? { ...(dynamic[name] as Record<string, unknown>) } : {};
      if (!(oldKey in entry)) {
        return;
      }
      entry[newKey.trim()] = entry[oldKey];
      delete entry[oldKey];
      dynamic[name] = entry;
      draft.dynamic_collections = dynamic;
    });
  };

  const handleTemplateAttributeInput = (name: string, key: string, value: string) => {
    setTemplateAttributeInputs((prev) => ({
      ...prev,
      [name]: { key, value }
    }));
  };

  const handleTemplateAttributeAdd = (name: string) => {
    const entry = templateAttributeInputs[name];
    if (!entry || !entry.key.trim() || !entry.value.trim()) {
      return;
    }
    handleTemplateField(name, entry.key.trim(), parseValueInput(entry.value));
    setTemplateAttributeInputs((prev) => ({
      ...prev,
      [name]: { key: entry.key, value: "" }
    }));
  };

  const handleTemplateAttributeRemove = (name: string, key: string) => {
    handleTemplateField(name, key, "");
  };

  const handleTemplateAttributeRename = (name: string, oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) {
      return;
    }
    updateFileDraft((draft) => {
      const templates = isRecord(draft.templates) ? { ...draft.templates } : {};
      const entry = isRecord(templates[name]) ? { ...(templates[name] as Record<string, unknown>) } : {};
      if (!(oldKey in entry)) {
        return;
      }
      entry[newKey.trim()] = entry[oldKey];
      delete entry[oldKey];
      templates[name] = entry;
      draft.templates = templates;
    });
  };

  const handleExternalTemplateAdd = () => {
    if (!externalTemplateInput.trim()) {
      return;
    }
    updateFileDraft((draft) => {
      const list = Array.isArray(draft.external_templates) ? [...draft.external_templates] : [];
      list.push({ file: externalTemplateInput.trim() });
      draft.external_templates = list;
    });
    setExternalTemplateInput("");
  };

  const handleExternalTemplateRemove = (index: number) => {
    updateFileDraft((draft) => {
      if (!Array.isArray(draft.external_templates)) {
        return;
      }
      const list = [...draft.external_templates];
      list.splice(index, 1);
      draft.external_templates = list;
    });
  };

  const handleExternalTemplateField = (index: number, value: string) => {
    updateFileDraft((draft) => {
      if (!Array.isArray(draft.external_templates)) {
        return;
      }
      const list = [...draft.external_templates];
      const entry = isRecord(list[index]) ? { ...(list[index] as Record<string, unknown>) } : {};
      if (!value.trim()) {
        delete entry.file;
      } else {
        entry.file = value.trim();
      }
      list[index] = entry;
      draft.external_templates = list;
    });
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

  const handleOverlayAttributeInput = (name: string, key: string, value: string) => {
    setOverlayAttributeInputs((prev) => ({
      ...prev,
      [name]: { key, value }
    }));
  };

  const handleOverlayAttributeAdd = (name: string) => {
    const entry = overlayAttributeInputs[name];
    if (!entry || !entry.key.trim() || !entry.value.trim()) {
      return;
    }
    handleOverlayField(name, entry.key.trim(), parseValueInput(entry.value));
    setOverlayAttributeInputs((prev) => ({
      ...prev,
      [name]: { key: entry.key, value: "" }
    }));
  };

  const handleOverlayAttributeRemove = (name: string, key: string) => {
    handleOverlayField(name, key, "");
  };

  const handleOverlayAttributeRename = (name: string, oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) {
      return;
    }
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      const entry = isRecord(overlays[name]) ? { ...(overlays[name] as Record<string, unknown>) } : {};
      if (!(oldKey in entry)) {
        return;
      }
      entry[newKey.trim()] = entry[oldKey];
      delete entry[oldKey];
      overlays[name] = entry;
      draft.overlays = overlays;
    });
  };

  const handleOverlaySearchInput = (name: string, key: string, value: string) => {
    setOverlaySearchInputs((prev) => ({
      ...prev,
      [name]: { key, value }
    }));
  };

  const handleOverlaySearchAdd = (name: string) => {
    const entry = overlaySearchInputs[name];
    if (!entry || !entry.key.trim() || !entry.value.trim()) {
      return;
    }
    handleOverlaySearchField(name, entry.key.trim(), parseValueInput(entry.value));
    setOverlaySearchInputs((prev) => ({
      ...prev,
      [name]: { key: entry.key, value: "" }
    }));
  };

  const handleOverlaySearchRemove = (name: string, key: string) => {
    handleOverlaySearchField(name, key, "");
  };

  const handleOverlaySearchRename = (name: string, oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) {
      return;
    }
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      const entry = isRecord(overlays[name]) ? { ...(overlays[name] as Record<string, unknown>) } : {};
      const plexSearch = isRecord(entry.plex_search) ? { ...(entry.plex_search as Record<string, unknown>) } : {};
      const allSearch = isRecord(plexSearch.all) ? { ...(plexSearch.all as Record<string, unknown>) } : {};
      if (!(oldKey in allSearch)) {
        return;
      }
      allSearch[newKey.trim()] = allSearch[oldKey];
      delete allSearch[oldKey];
      plexSearch.all = allSearch;
      entry.plex_search = plexSearch;
      overlays[name] = entry;
      draft.overlays = overlays;
    });
  };

  const handleDefaultOverlayAdd = (path: string) => {
    const prefix = ".kometa-ui/defaults/overlays/images/";
    const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const base = relative.replace(/\.[^.]+$/, "").replace(/[\\/]/g, " ").trim();
    if (!base) {
      return;
    }
    updateFileDraft((draft) => {
      const overlays = isRecord(draft.overlays) ? { ...draft.overlays } : {};
      let name = base;
      let counter = 2;
      while (name in overlays) {
        name = `${base} ${counter}`;
        counter += 1;
      }
      overlays[name] = {
        overlay: {
          name: base,
          default: relative
        }
      };
      draft.overlays = overlays;
    });
  };

  const handleKometaPreview = async () => {
    setKometaPreviewLoading(true);
    setKometaPreviewError(null);
    try {
      const queues = fileDraft && isRecord(fileDraft.queues) ? (fileDraft.queues as Record<string, unknown>) : undefined;
      const response = await renderOverlayPreview({
        overlays: overlaysMap,
        queues,
        overlay_order: Object.keys(overlaysMap),
        poster_mode: posterMode,
        poster_id: posterSampleId,
        poster_path: posterMode === "asset" ? posterAssetPath : undefined
      });
      if (!response.ok || !response.url) {
        setKometaPreviewError(response.error || "Kometa preview failed");
        setKometaPreviewUrl(null);
        return;
      }
      setKometaPreviewUrl(`${response.url}?t=${Date.now()}`);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setRequiredMode(apiErr.authMode ?? "basic");
      } else {
        setKometaPreviewError(apiErr.message || "Kometa preview failed");
      }
    } finally {
      setKometaPreviewLoading(false);
    }
  };

  const handleClearKometaPreview = () => {
    setKometaPreviewUrl(null);
    setKometaPreviewError(null);
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

  const overlayScale = posterWidth ? posterWidth / POSTER_BASE.width : 0;
  const overlayNames = useMemo(() => Object.keys(overlaysMap), [overlaysMap]);
  const allOverlaysSelected = overlayNames.length
    ? overlayNames.every((name) => overlayPreviewSelection[name] ?? true)
    : false;
  const previewOverlays = useMemo(
    () =>
      Object.entries(overlaysMap).filter(([name]) => overlayPreviewSelection[name] ?? true),
    [overlaysMap, overlayPreviewSelection]
  );

  const filteredDefaultOverlays = useMemo(() => {
    const query = defaultOverlayQuery.trim().toLowerCase();
    if (!query) {
      return defaultOverlayAssets;
    }
    return defaultOverlayAssets.filter((asset) => asset.path.toLowerCase().includes(query));
  }, [defaultOverlayAssets, defaultOverlayQuery]);

  const resolveOverlayImage = useCallback(
    (overlayConfig: Record<string, unknown>, fallbackName?: string | null) => {
      const directFile = typeof overlayConfig.file === "string" ? overlayConfig.file.trim() : "";
      if (directFile) {
        return `/api/files/raw?path=${encodeURIComponent(directFile)}`;
      }
      const directUrl = typeof overlayConfig.url === "string" ? overlayConfig.url.trim() : "";
      if (directUrl) {
        return directUrl;
      }
      const defaultPath = typeof overlayConfig.default === "string" ? overlayConfig.default.trim() : "";
      if (defaultPath) {
        const match = overlayImages.find((file) =>
          file.path.toLowerCase().endsWith(defaultPath.toLowerCase())
        );
        if (match) {
          return `/api/files/raw?path=${encodeURIComponent(match.path)}`;
        }
      }
      const overlayName = typeof overlayConfig.name === "string" ? overlayConfig.name.trim() : "";
      const targetName = (overlayName || fallbackName || "").trim();
      if (targetName) {
        const normalizedTarget = targetName.toLowerCase().replace(/\s+/g, "");
        const match = overlayImages.find((file) => {
          const name = file.path.split("/").pop() ?? "";
          const normalized = name.toLowerCase().replace(/\s+/g, "");
          return normalized === `${normalizedTarget}.png` ||
            normalized === `${normalizedTarget}.jpg` ||
            normalized === `${normalizedTarget}.jpeg` ||
            normalized === `${normalizedTarget}.webp`;
        });
        if (match) {
          return `/api/files/raw?path=${encodeURIComponent(match.path)}`;
        }
      }
      return null;
    },
    [overlayImages]
  );

  const buildOverlayPosition = useCallback(
    (entry: Record<string, unknown>) => {
      const horizontalAlign = typeof entry.horizontal_align === "string" ? entry.horizontal_align : "left";
      const verticalAlign = typeof entry.vertical_align === "string" ? entry.vertical_align : "top";
      const offsetX = parsePercentValue(entry.horizontal_offset, POSTER_BASE.width) * overlayScale;
      const offsetY = parsePercentValue(entry.vertical_offset, POSTER_BASE.height) * overlayScale;

      const style: Record<string, string> = {};
      const transforms: string[] = [];

      if (horizontalAlign === "right") {
        style.right = `${offsetX}px`;
      } else if (horizontalAlign === "center") {
        style.left = `calc(50% + ${offsetX}px)`;
        transforms.push("translateX(-50%)");
      } else {
        style.left = `${offsetX}px`;
      }

      if (verticalAlign === "bottom") {
        style.bottom = `${offsetY}px`;
      } else if (verticalAlign === "center") {
        style.top = `calc(50% + ${offsetY}px)`;
        transforms.push("translateY(-50%)");
      } else {
        style.top = `${offsetY}px`;
      }

      if (transforms.length) {
        style.transform = transforms.join(" ");
      }

      return style;
    },
    [overlayScale]
  );

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
          <div className="stack">
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
            <div className="section">
              <h3>New collection</h3>
              <div className="field-grid">
                <label className="field">
                  <span>Collection name</span>
                  <input
                    className="input"
                    value={collectionNameInput}
                    onChange={(event) => setCollectionNameInput(event.target.value)}
                    placeholder="Top 50 Action Movies"
                  />
                </label>
                <label className="field">
                  <span>Preset</span>
                  <select
                    className="input select"
                    value={collectionPresetId}
                    onChange={(event) => setCollectionPresetId(event.target.value)}
                  >
                    {COLLECTION_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Preset value</span>
                  <input
                    className="input"
                    value={collectionPresetValue}
                    onChange={(event) => setCollectionPresetValue(event.target.value)}
                    placeholder={
                      COLLECTION_PRESETS.find((preset) => preset.id === collectionPresetId)?.placeholder ??
                      "Optional"
                    }
                  />
                </label>
              </div>
              <div className="field-row">
                <button className="primary" onClick={handleCollectionAdd}>
                  Add collection
                </button>
                <p className="hint">Pick a preset to auto-fill the first builder.</p>
              </div>
            </div>
            <div className="collection-list">
              {Object.entries(collectionsMap).map(([name, collection]) => {
                const entry = isRecord(collection) ? collection : {};
                const attributeEntries = Object.entries(entry).filter(([key]) => !COLLECTION_QUICK_FIELDS.has(key));
                const attributeInput = collectionAttributeInputs[name] ?? { key: "", value: "" };
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
                    <div className="form-block">
                      <h3>Builders, filters & settings</h3>
                      <div className="builder-fields">
                        {attributeEntries.map(([key, value]) => {
                          const rendered = stringifyValue(value);
                          const multiline = rendered.includes("\n");
                          return (
                            <div key={`${name}-${key}`} className="builder-row">
                              <input
                                className="input"
                                defaultValue={key}
                                onBlur={(event) =>
                                  handleCollectionAttributeRename(name, key, event.target.value)
                                }
                                placeholder="Builder or attribute key"
                              />
                              {multiline ? (
                                <textarea
                                  className="input"
                                  value={rendered}
                                  onChange={(event) =>
                                    handleCollectionField(name, key, parseValueInput(event.target.value))
                                  }
                                />
                              ) : (
                                <input
                                  className="input"
                                  value={rendered}
                                  onChange={(event) =>
                                    handleCollectionField(name, key, parseValueInput(event.target.value))
                                  }
                                />
                              )}
                              <button
                                className="ghost"
                                onClick={() => handleCollectionAttributeRemove(name, key)}
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })}
                        <div className="builder-row">
                          <input
                            className="input"
                            list={`collection-keys-${name}`}
                            value={attributeInput.key}
                            placeholder="Attribute key (ex: tmdb_list, plex_search, filters)"
                            onChange={(event) =>
                              handleCollectionAttributeInput(name, event.target.value, attributeInput.value)
                            }
                          />
                          <datalist id={`collection-keys-${name}`}>
                            {COLLECTION_BUILDERS.map((builder) => (
                              <option key={builder.key} value={builder.key} />
                            ))}
                          </datalist>
                          <input
                            className="input"
                            value={attributeInput.value}
                            placeholder="Value (comma lists ok)"
                            onChange={(event) =>
                              handleCollectionAttributeInput(name, attributeInput.key, event.target.value)
                            }
                          />
                          <button className="ghost" onClick={() => handleCollectionAttributeAdd(name)}>
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!Object.keys(collectionsMap).length && (
                <p className="hint">No collections defined yet.</p>
              )}
            </div>
          </div>
            <div className="card builder">
              <div className="card-header">
                <div>
                  <h2>Dynamic collections</h2>
                  <p className="hint">Generate collections automatically using dynamic rules.</p>
                </div>
              </div>
              <div className="field-row">
                <input
                  className="input"
                  value={dynamicCollectionNameInput}
                  onChange={(event) => setDynamicCollectionNameInput(event.target.value)}
                  placeholder="Dynamic set name"
                />
                <button className="ghost" onClick={handleDynamicCollectionAdd}>
                  Add dynamic set
                </button>
              </div>
              <div className="collection-list">
                {Object.entries(dynamicCollectionsMap).map(([name, collection]) => {
                  const entry = isRecord(collection) ? collection : {};
                  const attributeEntries = Object.entries(entry).filter(([key]) => !DYNAMIC_QUICK_FIELDS.has(key));
                  const attributeInput = dynamicAttributeInputs[name] ?? { key: "", value: "" };
                  return (
                    <div key={name} className="collection-card">
                      <div className="collection-header">
                        <input
                          className="input title"
                          defaultValue={name}
                          onBlur={(event) => handleDynamicCollectionRename(name, event.target.value)}
                        />
                        <button className="ghost" onClick={() => handleDynamicCollectionRemove(name)}>
                          Remove
                        </button>
                      </div>
                      <div className="field-grid">
                        <label className="field">
                          <span>Type</span>
                          <input
                            className="input"
                            list={`dynamic-types-${name}`}
                            value={stringifyValue(entry.type)}
                            onChange={(event) => handleDynamicCollectionField(name, "type", event.target.value)}
                            placeholder="tmdb_collection"
                          />
                          <datalist id={`dynamic-types-${name}`}>
                            {DYNAMIC_COLLECTION_TYPES.map((type) => (
                              <option key={type} value={type} />
                            ))}
                          </datalist>
                        </label>
                        <label className="field">
                          <span>Data</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.data)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "data", parseValueInput(event.target.value))
                            }
                            placeholder="List, map, or scalar"
                          />
                        </label>
                        <label className="field">
                          <span>Template</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.template)}
                            onChange={(event) => handleDynamicCollectionField(name, "template", event.target.value)}
                            placeholder="Template name"
                          />
                        </label>
                        <label className="field">
                          <span>Title format</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.title_format)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "title_format", event.target.value)
                            }
                            placeholder="<<key_name>>"
                          />
                        </label>
                        <label className="field">
                          <span>Remove prefix</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.remove_prefix)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "remove_prefix", parseValueInput(event.target.value))
                            }
                            placeholder="The, A, An"
                          />
                        </label>
                        <label className="field">
                          <span>Remove suffix</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.remove_suffix)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "remove_suffix", parseValueInput(event.target.value))
                            }
                            placeholder="Collection"
                          />
                        </label>
                        <label className="field">
                          <span>Include</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.include)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "include", parseValueInput(event.target.value))
                            }
                            placeholder="List of keys"
                          />
                        </label>
                        <label className="field">
                          <span>Exclude</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.exclude)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "exclude", parseValueInput(event.target.value))
                            }
                            placeholder="List of keys"
                          />
                        </label>
                        <label className="field">
                          <span>Addons</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.addons)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "addons", parseValueInput(event.target.value))
                            }
                            placeholder="Parent: [child, child]"
                          />
                        </label>
                        <label className="field">
                          <span>Other name</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.other_name)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "other_name", event.target.value)
                            }
                            placeholder="Other"
                          />
                        </label>
                        <label className="field">
                          <span>Other template</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.other_template)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "other_template", event.target.value)
                            }
                            placeholder="Template name"
                          />
                        </label>
                        <label className="field">
                          <span>Key name override</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.key_name_override)}
                            onChange={(event) =>
                              handleDynamicCollectionField(
                                name,
                                "key_name_override",
                                parseValueInput(event.target.value)
                              )
                            }
                            placeholder="France: French"
                          />
                        </label>
                        <label className="field">
                          <span>Title override</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.title_override)}
                            onChange={(event) =>
                              handleDynamicCollectionField(name, "title_override", parseValueInput(event.target.value))
                            }
                            placeholder="10: Star Wars Universe"
                          />
                        </label>
                        <label className="field">
                          <span>Template variables</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.template_variables)}
                            onChange={(event) =>
                              handleDynamicCollectionField(
                                name,
                                "template_variables",
                                parseValueInput(event.target.value)
                              )
                            }
                            placeholder="var:\n  key: value"
                          />
                        </label>
                        <label className="field">
                          <span>Custom keys</span>
                          <div className="toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.custom_keys ?? true)}
                              onChange={(event) =>
                                handleDynamicCollectionField(name, "custom_keys", event.target.checked)
                              }
                            />
                            <span>{entry.custom_keys === false ? "Off" : "On"}</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>Test mode</span>
                          <div className="toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.test)}
                              onChange={(event) =>
                                handleDynamicCollectionField(name, "test", event.target.checked)
                              }
                            />
                            <span>{entry.test ? "On" : "Off"}</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>Sync removed</span>
                          <div className="toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.sync)}
                              onChange={(event) =>
                                handleDynamicCollectionField(name, "sync", event.target.checked)
                              }
                            />
                            <span>{entry.sync ? "On" : "Off"}</span>
                          </div>
                        </label>
                      </div>
                      <div className="form-block">
                        <h3>Additional attributes</h3>
                        <div className="builder-fields">
                          {attributeEntries.map(([key, value]) => {
                            const rendered = stringifyValue(value);
                            const multiline = rendered.includes("\n");
                            return (
                              <div key={`${name}-${key}`} className="builder-row">
                                <input
                                  className="input"
                                  defaultValue={key}
                                  onBlur={(event) =>
                                    handleDynamicAttributeRename(name, key, event.target.value)
                                  }
                                  placeholder="Attribute key"
                                />
                                {multiline ? (
                                  <textarea
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleDynamicCollectionField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                ) : (
                                  <input
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleDynamicCollectionField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                )}
                                <button
                                  className="ghost"
                                  onClick={() => handleDynamicAttributeRemove(name, key)}
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                          <div className="builder-row">
                            <input
                              className="input"
                              value={attributeInput.key}
                              placeholder="Attribute key"
                              onChange={(event) =>
                                handleDynamicAttributeInput(name, event.target.value, attributeInput.value)
                              }
                            />
                            <input
                              className="input"
                              value={attributeInput.value}
                              placeholder="Value"
                              onChange={(event) =>
                                handleDynamicAttributeInput(name, attributeInput.key, event.target.value)
                              }
                            />
                            <button className="ghost" onClick={() => handleDynamicAttributeAdd(name)}>
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!Object.keys(dynamicCollectionsMap).length && (
                  <p className="hint">No dynamic collections defined yet.</p>
                )}
              </div>
            </div>

            <div className="card builder">
              <div className="card-header">
                <div>
                  <h2>Templates</h2>
                  <p className="hint">Reusable blocks for collections, playlists, and overlays.</p>
                </div>
              </div>
              <div className="field-row">
                <input
                  className="input"
                  value={templateNameInput}
                  onChange={(event) => setTemplateNameInput(event.target.value)}
                  placeholder="Template name"
                />
                <button className="ghost" onClick={handleTemplateAdd}>
                  Add template
                </button>
              </div>
              <div className="collection-list">
                {Object.entries(templatesMap).map(([name, template]) => {
                  const entry = isRecord(template) ? template : {};
                  const attributeEntries = Object.entries(entry).filter(
                    ([key]) => !TEMPLATE_CONTROL_FIELDS.has(key)
                  );
                  const attributeInput = templateAttributeInputs[name] ?? { key: "", value: "" };
                  return (
                    <div key={name} className="collection-card">
                      <div className="collection-header">
                        <input
                          className="input title"
                          defaultValue={name}
                          onBlur={(event) => handleTemplateRename(name, event.target.value)}
                        />
                        <button className="ghost" onClick={() => handleTemplateRemove(name)}>
                          Remove
                        </button>
                      </div>
                      <div className="field-grid">
                        <label className="field">
                          <span>Default variables</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.default)}
                            onChange={(event) =>
                              handleTemplateField(name, "default", parseValueInput(event.target.value))
                            }
                            placeholder="var: value"
                          />
                        </label>
                        <label className="field">
                          <span>Optional variables</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.optional)}
                            onChange={(event) =>
                              handleTemplateField(name, "optional", parseValueInput(event.target.value))
                            }
                            placeholder="var1, var2"
                          />
                        </label>
                        <label className="field">
                          <span>Conditionals</span>
                          <textarea
                            className="input"
                            value={stringifyValue(entry.conditionals)}
                            onChange={(event) =>
                              handleTemplateField(name, "conditionals", parseValueInput(event.target.value))
                            }
                            placeholder="conditional mapping"
                          />
                        </label>
                        <label className="field">
                          <span>Move prefix</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.move_prefix)}
                            onChange={(event) =>
                              handleTemplateField(name, "move_prefix", parseValueInput(event.target.value))
                            }
                            placeholder="The, A, An"
                          />
                        </label>
                      </div>
                      <div className="form-block">
                        <h3>Template attributes</h3>
                        <div className="builder-fields">
                          {attributeEntries.map(([key, value]) => {
                            const rendered = stringifyValue(value);
                            const multiline = rendered.includes("\n");
                            return (
                              <div key={`${name}-${key}`} className="builder-row">
                                <input
                                  className="input"
                                  defaultValue={key}
                                  onBlur={(event) =>
                                    handleTemplateAttributeRename(name, key, event.target.value)
                                  }
                                  placeholder="Template attribute"
                                />
                                {multiline ? (
                                  <textarea
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleTemplateField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                ) : (
                                  <input
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleTemplateField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                )}
                                <button
                                  className="ghost"
                                  onClick={() => handleTemplateAttributeRemove(name, key)}
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                          <div className="builder-row">
                            <input
                              className="input"
                              value={attributeInput.key}
                              placeholder="Attribute key"
                              onChange={(event) =>
                                handleTemplateAttributeInput(name, event.target.value, attributeInput.value)
                              }
                            />
                            <input
                              className="input"
                              value={attributeInput.value}
                              placeholder="Value"
                              onChange={(event) =>
                                handleTemplateAttributeInput(name, attributeInput.key, event.target.value)
                              }
                            />
                            <button className="ghost" onClick={() => handleTemplateAttributeAdd(name)}>
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!Object.keys(templatesMap).length && <p className="hint">No templates defined yet.</p>}
              </div>
            </div>

            <div className="card builder">
              <div className="card-header">
                <div>
                  <h2>External templates</h2>
                  <p className="hint">Reference templates stored in other YAML files.</p>
                </div>
              </div>
              <div className="field-row">
                <input
                  className="input"
                  value={externalTemplateInput}
                  onChange={(event) => setExternalTemplateInput(event.target.value)}
                  placeholder="config/my_templates.yml"
                />
                <button className="ghost" onClick={handleExternalTemplateAdd}>
                  Add template file
                </button>
              </div>
              <div className="collection-list">
                {externalTemplatesList.map((entry, index) => (
                  <div key={`${index}-${String(entry.file ?? "")}`} className="collection-card">
                    <div className="field-row">
                      <input
                        className="input"
                        value={stringifyValue(entry.file)}
                        onChange={(event) => handleExternalTemplateField(index, event.target.value)}
                        placeholder="config/my_templates.yml"
                      />
                      <button className="ghost" onClick={() => handleExternalTemplateRemove(index)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {!externalTemplatesList.length && <p className="hint">No external templates defined yet.</p>}
              </div>
            </div>
          </div>

          <div className="stack">
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
              <p className="hint">Type any builder key in the attribute list to cover everything.</p>
            </div>
            <div className="card schema">
              <div className="card-header">
                <div>
                  <h2>Dynamic types</h2>
                  <p className="hint">All dynamic collection types from the Kometa docs.</p>
                </div>
              </div>
              <div className="pill-row">
                {DYNAMIC_COLLECTION_TYPES.map((type) => (
                  <span key={type} className="pill ghost">
                    {type}
                  </span>
                ))}
              </div>
            </div>
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
                const overlayMeta = parseOverlayName(overlayConfig.name);
                const overlayType = overlayMeta.kind;
                const overlayText = overlayMeta.kind === "text" ? overlayMeta.text ?? "" : "";
                const overlayBlur = overlayMeta.kind === "blur" ? overlayMeta.blur ?? 50 : 50;
                const plexSearch = isRecord(entry.plex_search)
                  ? (entry.plex_search as Record<string, unknown>)
                  : {};
                const plexAll = isRecord(plexSearch.all) ? (plexSearch.all as Record<string, unknown>) : {};
                const searchEntries = Object.entries(plexAll).filter(
                  ([key]) => !OVERLAY_SEARCH_FIELDS.has(key)
                );
                const searchInput = overlaySearchInputs[name] ?? { key: "", value: "" };
                const extraEntries = Object.entries(entry).filter(([key]) => !OVERLAY_ENTRY_FIELDS.has(key));
                const extraInput = overlayAttributeInputs[name] ?? { key: "", value: "" };
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
                        <span>Overlay type</span>
                        <select
                          className="input select"
                          value={overlayType}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value === "text") {
                              handleOverlayNestedField(name, "overlay", "name", `text(${overlayText || "Text"})`);
                            } else if (value === "blur") {
                              handleOverlayNestedField(name, "overlay", "name", `blur(${overlayBlur || 50})`);
                            } else if (value === "backdrop") {
                              handleOverlayNestedField(name, "overlay", "name", "backdrop");
                            } else {
                              handleOverlayNestedField(name, "overlay", "name", overlayMeta.name || name);
                            }
                          }}
                        >
                          <option value="image">Image</option>
                          <option value="text">Text</option>
                          <option value="backdrop">Backdrop</option>
                          <option value="blur">Blur</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Overlay name</span>
                        <input
                          className="input"
                          value={overlayMeta.name ?? ""}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "name", event.target.value)
                          }
                          placeholder="IMDB-Top-250"
                          disabled={overlayType !== "image"}
                        />
                      </label>
                      <label className="field">
                        <span>Overlay text</span>
                        <input
                          className="input"
                          value={overlayText}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "name", `text(${event.target.value})`)
                          }
                          placeholder="Direct Play"
                          disabled={overlayType !== "text"}
                        />
                      </label>
                      <label className="field">
                        <span>Blur strength</span>
                        <input
                          className="input"
                          value={overlayBlur}
                          onChange={(event) =>
                            handleOverlayNestedField(name, "overlay", "name", `blur(${event.target.value})`)
                          }
                          placeholder="50"
                          disabled={overlayType !== "blur"}
                        />
                      </label>
                    </div>
                    <div className="form-block">
                      <h3>Image sources</h3>
                      <div className="field-grid">
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
                            list={`overlay-files-${name}`}
                            value={stringifyValue(overlayConfig.file)}
                            onChange={(event) =>
                              handleOverlayNestedField(name, "overlay", "file", event.target.value)
                            }
                            placeholder="overlays/4K.png"
                          />
                          <datalist id={`overlay-files-${name}`}>
                            {overlayImages.map((file) => (
                              <option key={file.path} value={file.path} />
                            ))}
                          </datalist>
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
                          <span>Git path</span>
                          <input
                            className="input"
                            value={stringifyValue(overlayConfig.git)}
                            onChange={(event) =>
                              handleOverlayNestedField(name, "overlay", "git", event.target.value)
                            }
                            placeholder="overlays/4K.png"
                          />
                        </label>
                        <label className="field">
                          <span>Repo path</span>
                          <input
                            className="input"
                            value={stringifyValue(overlayConfig.repo)}
                            onChange={(event) =>
                              handleOverlayNestedField(name, "overlay", "repo", event.target.value)
                            }
                            placeholder="overlays/4K.png"
                          />
                        </label>
                        <label className="field">
                          <span>Scale width</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.scale_width)}
                            onChange={(event) =>
                              handleOverlayField(name, "scale_width", parseValueInput(event.target.value))
                            }
                            placeholder="300 or 20%"
                          />
                        </label>
                        <label className="field">
                          <span>Scale height</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.scale_height)}
                            onChange={(event) =>
                              handleOverlayField(name, "scale_height", parseValueInput(event.target.value))
                            }
                            placeholder="120 or 10%"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="form-block">
                      <h3>Text styling</h3>
                      <div className="field-grid">
                        <label className="field">
                          <span>Font</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.font)}
                            onChange={(event) => handleOverlayField(name, "font", event.target.value)}
                            placeholder="fonts/Inter-Medium.ttf"
                          />
                        </label>
                        <label className="field">
                          <span>Font style</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.font_style)}
                            onChange={(event) => handleOverlayField(name, "font_style", event.target.value)}
                            placeholder="italic, bold"
                          />
                        </label>
                        <label className="field">
                          <span>Font size</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.font_size)}
                            onChange={(event) =>
                              handleOverlayField(name, "font_size", parseValueInput(event.target.value))
                            }
                            placeholder="63"
                          />
                        </label>
                        <label className="field">
                          <span>Font color</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.font_color)}
                            onChange={(event) => handleOverlayField(name, "font_color", event.target.value)}
                            placeholder="#FFFFFF"
                          />
                        </label>
                        <label className="field">
                          <span>Stroke color</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.stroke_color)}
                            onChange={(event) => handleOverlayField(name, "stroke_color", event.target.value)}
                            placeholder="#000000"
                          />
                        </label>
                        <label className="field">
                          <span>Stroke width</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.stroke_width)}
                            onChange={(event) =>
                              handleOverlayField(name, "stroke_width", parseValueInput(event.target.value))
                            }
                            placeholder="2"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop color</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_color)}
                            onChange={(event) => handleOverlayField(name, "back_color", event.target.value)}
                            placeholder="#00000099"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop align</span>
                          <select
                            className="input select"
                            value={stringifyValue(entry.back_align)}
                            onChange={(event) => handleOverlayField(name, "back_align", event.target.value)}
                          >
                            <option value="">Choose</option>
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                            <option value="top">top</option>
                            <option value="bottom">bottom</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Backdrop width</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_width)}
                            onChange={(event) =>
                              handleOverlayField(name, "back_width", parseValueInput(event.target.value))
                            }
                            placeholder="300"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop height</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_height)}
                            onChange={(event) =>
                              handleOverlayField(name, "back_height", parseValueInput(event.target.value))
                            }
                            placeholder="100"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop padding</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_padding)}
                            onChange={(event) =>
                              handleOverlayField(name, "back_padding", parseValueInput(event.target.value))
                            }
                            placeholder="30"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop radius</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_radius)}
                            onChange={(event) =>
                              handleOverlayField(name, "back_radius", parseValueInput(event.target.value))
                            }
                            placeholder="30"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop line color</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_line_color)}
                            onChange={(event) => handleOverlayField(name, "back_line_color", event.target.value)}
                            placeholder="#FFFFFF"
                          />
                        </label>
                        <label className="field">
                          <span>Backdrop line width</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.back_line_width)}
                            onChange={(event) =>
                              handleOverlayField(name, "back_line_width", parseValueInput(event.target.value))
                            }
                            placeholder="2"
                          />
                        </label>
                        <label className="field">
                          <span>Addon position</span>
                          <select
                            className="input select"
                            value={stringifyValue(entry.addon_position)}
                            onChange={(event) => handleOverlayField(name, "addon_position", event.target.value)}
                          >
                            <option value="">Choose</option>
                            <option value="left">left</option>
                            <option value="right">right</option>
                            <option value="top">top</option>
                            <option value="bottom">bottom</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Addon offset</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.addon_offset)}
                            onChange={(event) =>
                              handleOverlayField(name, "addon_offset", parseValueInput(event.target.value))
                            }
                            placeholder="25"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="form-block">
                      <h3>Position</h3>
                      <div className="field-grid">
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
                            onChange={(event) =>
                              handleOverlayField(name, "horizontal_offset", parseValueInput(event.target.value))
                            }
                            placeholder="0 or 10%"
                          />
                        </label>
                        <label className="field">
                          <span>Vertical offset</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.vertical_offset)}
                            onChange={(event) =>
                              handleOverlayField(name, "vertical_offset", parseValueInput(event.target.value))
                            }
                            placeholder="150 or 10%"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="form-block">
                      <h3>Grouping & queue</h3>
                      <div className="field-grid">
                        <label className="field">
                          <span>Group</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.group)}
                            onChange={(event) => handleOverlayField(name, "group", event.target.value)}
                            placeholder="audio_language"
                          />
                        </label>
                        <label className="field">
                          <span>Queue</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.queue)}
                            onChange={(event) => handleOverlayField(name, "queue", event.target.value)}
                            placeholder="custom_queue"
                          />
                        </label>
                        <label className="field">
                          <span>Weight</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.weight)}
                            onChange={(event) =>
                              handleOverlayField(name, "weight", parseValueInput(event.target.value))
                            }
                            placeholder="10"
                          />
                        </label>
                        <label className="field">
                          <span>Builder level</span>
                          <select
                            className="input select"
                            value={stringifyValue(entry.builder_level)}
                            onChange={(event) => handleOverlayField(name, "builder_level", event.target.value)}
                          >
                            <option value="">Choose</option>
                            <option value="show">show</option>
                            <option value="season">season</option>
                            <option value="episode">episode</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Suppress overlays</span>
                          <input
                            className="input"
                            value={stringifyValue(entry.suppress_overlays)}
                            onChange={(event) =>
                              handleOverlayField(name, "suppress_overlays", parseValueInput(event.target.value))
                            }
                            placeholder="4K, HDR"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="form-block">
                      <h3>Plex search</h3>
                      <div className="field-grid">
                        <label className="field">
                          <span>Plex all</span>
                          <div className="toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.plex_all)}
                              onChange={(event) => handleOverlayField(name, "plex_all", event.target.checked)}
                            />
                            <span>{entry.plex_all ? "On" : "Off"}</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>Resolution</span>
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
                      <div className="form-block">
                        <h3>Additional search filters</h3>
                        <div className="builder-fields">
                          {searchEntries.map(([key, value]) => {
                            const rendered = stringifyValue(value);
                            const multiline = rendered.includes("\n");
                            return (
                              <div key={`${name}-search-${key}`} className="builder-row">
                                <input
                                  className="input"
                                  defaultValue={key}
                                  onBlur={(event) =>
                                    handleOverlaySearchRename(name, key, event.target.value)
                                  }
                                  placeholder="Search key"
                                />
                                {multiline ? (
                                  <textarea
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleOverlaySearchField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                ) : (
                                  <input
                                    className="input"
                                    value={rendered}
                                    onChange={(event) =>
                                      handleOverlaySearchField(name, key, parseValueInput(event.target.value))
                                    }
                                  />
                                )}
                                <button
                                  className="ghost"
                                  onClick={() => handleOverlaySearchRemove(name, key)}
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                          <div className="builder-row">
                            <input
                              className="input"
                              value={searchInput.key}
                              placeholder="Search key"
                              onChange={(event) =>
                                handleOverlaySearchInput(name, event.target.value, searchInput.value)
                              }
                            />
                            <input
                              className="input"
                              value={searchInput.value}
                              placeholder="Value"
                              onChange={(event) =>
                                handleOverlaySearchInput(name, searchInput.key, event.target.value)
                              }
                            />
                            <button className="ghost" onClick={() => handleOverlaySearchAdd(name)}>
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="form-block">
                      <h3>Extra overlay attributes</h3>
                      <div className="builder-fields">
                        {extraEntries.map(([key, value]) => {
                          const rendered = stringifyValue(value);
                          const multiline = rendered.includes("\n");
                          return (
                            <div key={`${name}-extra-${key}`} className="builder-row">
                              <input
                                className="input"
                                defaultValue={key}
                                onBlur={(event) =>
                                  handleOverlayAttributeRename(name, key, event.target.value)
                                }
                                placeholder="Attribute key"
                              />
                              {multiline ? (
                                <textarea
                                  className="input"
                                  value={rendered}
                                  onChange={(event) =>
                                    handleOverlayField(name, key, parseValueInput(event.target.value))
                                  }
                                />
                              ) : (
                                <input
                                  className="input"
                                  value={rendered}
                                  onChange={(event) =>
                                    handleOverlayField(name, key, parseValueInput(event.target.value))
                                  }
                                />
                              )}
                              <button
                                className="ghost"
                                onClick={() => handleOverlayAttributeRemove(name, key)}
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })}
                        <div className="builder-row">
                          <input
                            className="input"
                            value={extraInput.key}
                            placeholder="Attribute key"
                            onChange={(event) =>
                              handleOverlayAttributeInput(name, event.target.value, extraInput.value)
                            }
                          />
                          <input
                            className="input"
                            value={extraInput.value}
                            placeholder="Value"
                            onChange={(event) =>
                              handleOverlayAttributeInput(name, extraInput.key, event.target.value)
                            }
                          />
                          <button className="ghost" onClick={() => handleOverlayAttributeAdd(name)}>
                            Add
                          </button>
                        </div>
                      </div>
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
                <div className="section-header">
                  <h3>Overlay choices</h3>
                  {overlayNames.length > 0 && (
                    <button
                      className="ghost small"
                      onClick={() =>
                        setOverlayPreviewSelection((prev) => {
                          const next: Record<string, boolean> = {};
                          overlayNames.forEach((name) => {
                            next[name] = !allOverlaysSelected;
                          });
                          return next;
                        })
                      }
                    >
                      {allOverlaysSelected ? "Clear all" : "Select all"}
                    </button>
                  )}
                </div>
                <div className="overlay-list">
                  {overlayNames.map((name) => (
                    <label key={name} className="check-row">
                      <input
                        type="checkbox"
                        checked={overlayPreviewSelection[name] ?? true}
                        onChange={() =>
                          setOverlayPreviewSelection((prev) => ({
                            ...prev,
                            [name]: !(prev[name] ?? true)
                          }))
                        }
                      />
                      {name}
                    </label>
                  ))}
                  {!overlayNames.length && <p className="hint">No overlays defined yet.</p>}
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
                {posterMode === "sample" && (
                  <select
                    className="input select"
                    value={posterSampleId}
                    onChange={(event) => setPosterSampleId(event.target.value)}
                  >
                    {SAMPLE_POSTERS.map((poster) => (
                      <option key={poster.id} value={poster.id}>
                        {poster.label}
                      </option>
                    ))}
                  </select>
                )}
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
                <h3>Kometa preview</h3>
                <div className="field-row">
                  <button
                    className="primary"
                    onClick={handleKometaPreview}
                    disabled={
                      kometaPreviewLoading ||
                      !Object.keys(overlaysMap).length ||
                      (posterMode === "asset" && !posterAssetPath)
                    }
                  >
                    {kometaPreviewLoading ? "Rendering..." : "Render with Kometa"}
                  </button>
                  {kometaPreviewUrl && (
                    <button className="ghost" onClick={handleClearKometaPreview}>
                      Clear
                    </button>
                  )}
                </div>
                {kometaPreviewError && <p className="hint error">{kometaPreviewError}</p>}
                <p className="hint">Runs Kometa inside the container for accurate overlay output.</p>
              </div>

              <div className="section">
                <h3>Overlay snippet</h3>
                <pre className="code-block">{overlaySnippet}</pre>
                <p className="hint">Snippet reflects the overlays selected above.</p>
              </div>

              <div className="section">
                <h3>Default overlays catalog</h3>
                <input
                  className="input"
                  value={defaultOverlayQuery}
                  onChange={(event) => setDefaultOverlayQuery(event.target.value)}
                  placeholder="Search defaults (ex: 4k, imdb, hdr)"
                />
                <div className="overlay-catalog">
                  {filteredDefaultOverlays.map((asset) => (
                    <div key={asset.path} className="overlay-catalog-card">
                      <img
                        src={`/api/files/raw?path=${encodeURIComponent(asset.path)}`}
                        alt={asset.path}
                      />
                      <div className="overlay-catalog-meta">
                        <span>{asset.path.replace(".kometa-ui/defaults/overlays/images/", "")}</span>
                        <button className="ghost small" onClick={() => handleDefaultOverlayAdd(asset.path)}>
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                  {!filteredDefaultOverlays.length && (
                    <p className="hint">No default overlays found.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="overlay-preview">
              {SAMPLE_POSTERS.map((poster) => {
                const cached = samplePosterMap[poster.id];
                const imageUrl = cached ? samplePosterUrl(cached.id) : null;
                const kometaPreview =
                  Boolean(kometaPreviewUrl) &&
                  (posterMode === "asset" ? poster.id === SAMPLE_POSTERS[0].id : poster.id === posterSampleId);
                return (
                  <div key={poster.id} className="poster-card">
                    <div
                      className="poster-frame"
                      ref={poster.id === SAMPLE_POSTERS[0].id ? posterFrameRef : undefined}
                    >
                      {kometaPreview ? (
                        <img src={kometaPreviewUrl ?? ""} alt="Kometa preview" />
                      ) : posterMode === "asset" && posterAssetPath ? (
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
                      {!kometaPreview &&
                        previewOverlays.map(([overlayName, overlayEntry]) => {
                        if (!overlayScale) {
                          return null;
                        }
                        const entry = isRecord(overlayEntry) ? overlayEntry : {};
                        const overlayConfig = isRecord(entry.overlay)
                          ? (entry.overlay as Record<string, unknown>)
                          : {};
                        const overlayMeta = parseOverlayName(overlayConfig.name);
                        const positionStyle = buildOverlayPosition(entry);
                        const baseStyle: CSSProperties = {
                          position: "absolute",
                          pointerEvents: "none",
                          ...positionStyle
                        };

                        const overlayImage =
                          overlayMeta.kind === "text"
                            ? resolveOverlayImage(overlayConfig, null)
                            : resolveOverlayImage(overlayConfig, overlayMeta.name || overlayName);

                        const scaleWidth = parsePercentValue(entry.scale_width, POSTER_BASE.width);
                        const scaleHeight = parsePercentValue(entry.scale_height, POSTER_BASE.height);
                        const imageStyle: CSSProperties = {};
                        if (scaleWidth > 0) {
                          imageStyle.width = `${scaleWidth * overlayScale}px`;
                        }
                        if (scaleHeight > 0) {
                          imageStyle.height = `${scaleHeight * overlayScale}px`;
                        }
                        if (scaleWidth === 0 && scaleHeight === 0 && overlayScale !== 1) {
                          imageStyle.transform = `scale(${overlayScale})`;
                          imageStyle.transformOrigin = "top left";
                        }

                        if (overlayMeta.kind === "image") {
                          return (
                            <div key={`${poster.id}-${overlayName}`} className="overlay-render" style={baseStyle}>
                              {overlayImage ? (
                                <img
                                  src={overlayImage}
                                  alt={overlayName}
                                  style={imageStyle}
                                  className="overlay-image"
                                />
                              ) : (
                                <div className="overlay-fallback">{overlayMeta.name || overlayName}</div>
                              )}
                            </div>
                          );
                        }

                        if (overlayMeta.kind === "backdrop") {
                          const backWidth = parsePercentValue(entry.back_width, POSTER_BASE.width);
                          const backHeight = parsePercentValue(entry.back_height, POSTER_BASE.height);
                          const backdropStyle: CSSProperties = {
                            width: backWidth ? `${backWidth * overlayScale}px` : "100%",
                            height: backHeight ? `${backHeight * overlayScale}px` : "100%",
                            background: String(entry.back_color ?? "rgba(0, 0, 0, 0.4)"),
                            borderRadius: `${(parseNumeric(entry.back_radius) ?? 0) * overlayScale}px`,
                            border:
                              entry.back_line_width || entry.back_line_color
                                ? `${(parseNumeric(entry.back_line_width) ?? 1) * overlayScale}px solid ${
                                    String(entry.back_line_color ?? "rgba(255,255,255,0.4)")
                                  }`
                                : undefined
                          };
                          return (
                            <div key={`${poster.id}-${overlayName}`} className="overlay-render" style={baseStyle}>
                              <div className="overlay-backdrop" style={backdropStyle} />
                            </div>
                          );
                        }

                        if (overlayMeta.kind === "blur") {
                          const blurAmount = parseNumeric(overlayMeta.blur) ?? 20;
                          return (
                            <div key={`${poster.id}-${overlayName}`} className="overlay-render" style={baseStyle}>
                              <div
                                className="overlay-blur"
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  backdropFilter: `blur(${blurAmount}px)`,
                                  background: "rgba(0,0,0,0.15)"
                                }}
                              />
                            </div>
                          );
                        }

                        const fontSize = (parseNumeric(entry.font_size) ?? 60) * overlayScale;
                        const fontColor = String(entry.font_color ?? "#FFFFFF");
                        const fontStyleValue = typeof entry.font_style === "string" ? entry.font_style.toLowerCase() : "";
                        const fontFamily = typeof entry.font === "string" ? entry.font : "Space Grotesk";
                        const strokeWidth = (parseNumeric(entry.stroke_width) ?? 0) * overlayScale;
                        const strokeColor = String(entry.stroke_color ?? "#000000");
                        const backPadding = (parseNumeric(entry.back_padding) ?? 0) * overlayScale;
                        const backRadius = (parseNumeric(entry.back_radius) ?? 0) * overlayScale;
                        const backWidth = parsePercentValue(entry.back_width, POSTER_BASE.width);
                        const backHeight = parsePercentValue(entry.back_height, POSTER_BASE.height);
                        const backLineWidth = (parseNumeric(entry.back_line_width) ?? 0) * overlayScale;
                        const backLineColor = String(entry.back_line_color ?? "#FFFFFF");
                        const addonOffset = (parseNumeric(entry.addon_offset) ?? 0) * overlayScale;
                        const addonPosition =
                          typeof entry.addon_position === "string" ? entry.addon_position : "left";

                        const backAlign = typeof entry.back_align === "string" ? entry.back_align : "center";
                        const alignItems =
                          backAlign === "left"
                            ? "flex-start"
                            : backAlign === "right"
                              ? "flex-end"
                              : "center";
                        const justifyContent =
                          backAlign === "top"
                            ? "flex-start"
                            : backAlign === "bottom"
                              ? "flex-end"
                              : "center";

                        const textStyle: CSSProperties = {
                          fontSize: `${fontSize}px`,
                          color: fontColor,
                          fontFamily,
                          fontStyle: fontStyleValue.includes("italic") ? "italic" : "normal",
                          fontWeight: fontStyleValue.includes("bold") ? 700 : 500,
                          background: entry.back_color ? String(entry.back_color) : "transparent",
                          padding: backPadding ? `${backPadding}px` : "0px",
                          borderRadius: backRadius ? `${backRadius}px` : "0px",
                          border:
                            backLineWidth || entry.back_line_color
                              ? `${backLineWidth || 1}px solid ${backLineColor}`
                              : undefined,
                          width: backWidth ? `${backWidth * overlayScale}px` : "auto",
                          height: backHeight ? `${backHeight * overlayScale}px` : "auto",
                          display: "inline-flex",
                          alignItems,
                          justifyContent,
                          gap: addonOffset ? `${addonOffset}px` : "6px",
                          textAlign: "center"
                        };

                        if (strokeWidth > 0) {
                          textStyle.WebkitTextStroke = `${strokeWidth}px ${strokeColor}`;
                        }

                        const flexDirection =
                          addonPosition === "right"
                            ? "row"
                            : addonPosition === "left"
                              ? "row-reverse"
                              : addonPosition === "top"
                                ? "column-reverse"
                                : "column";

                        return (
                          <div key={`${poster.id}-${overlayName}`} className="overlay-render" style={baseStyle}>
                            <div className="overlay-text" style={{ ...textStyle, flexDirection }}>
                              {overlayImage && (
                                <img
                                  src={overlayImage}
                                  alt="addon"
                                  className="overlay-addon"
                                  style={imageStyle}
                                />
                              )}
                              <span>{overlayMeta.text || overlayName}</span>
                            </div>
                          </div>
                        );
                      })}
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
