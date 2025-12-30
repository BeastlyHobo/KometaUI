import { AuthMode, authHeader, loadStoredAuth } from "./state/auth";

export type HealthResponse = {
  ok: boolean;
  docker_socket: boolean;
  kometa_container_found: boolean;
  config_exists: boolean;
  config_path: string;
  config_root?: string;
  log_dir: string;
};

export type ConfigEntry = {
  path: string;
  exists: boolean;
  last_modified: number | null;
};

export type ConfigListResponse = {
  active: string | null;
  configs: ConfigEntry[];
  root: string;
};

export type FileEntry = {
  path: string;
  last_modified: number | null;
  size: number;
};

export type RunRecord = {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  duration_sec: number | null;
  trigger: string;
  log_file: string | null;
  exit_code: number | null;
  error: string | null;
};

export class ApiError extends Error {
  status: number;
  authMode: AuthMode | null;

  constructor(message: string, status: number, authMode: AuthMode | null) {
    super(message);
    this.status = status;
    this.authMode = authMode;
  }
}

function parseAuthMode(value: string | null): AuthMode | null {
  if (!value) {
    return null;
  }
  const lowered = value.toLowerCase();
  if (lowered.includes("basic")) {
    return "basic";
  }
  if (lowered.includes("bearer")) {
    return "token";
  }
  return null;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = loadStoredAuth();
  const headers = new Headers(init.headers || {});
  const authHeaders = authHeader(auth);
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value));

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    const mode = parseAuthMode(response.headers.get("www-authenticate"));
    throw new ApiError("Unauthorized", 401, mode);
  }
  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(message || "Request failed", response.status, null);
  }
  return response.json() as Promise<T>;
}

export function getHealth() {
  return apiFetch<HealthResponse>("/api/health");
}

export function getConfig() {
  return apiFetch<{ path: string; yaml: string; last_modified: number }>("/api/config");
}

export function listConfigs() {
  return apiFetch<ConfigListResponse>("/api/configs");
}

export function createConfig(payload: {
  path: string;
  create?: boolean;
  content?: string;
  set_active?: boolean;
}) {
  return apiFetch<{ ok: boolean; path?: string; last_modified?: number; error?: string }>(
    "/api/configs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}

export function setActiveConfig(path: string) {
  return apiFetch<{ ok: boolean; path: string }>("/api/configs/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
}

export function validateConfig(yaml: string) {
  return apiFetch<{ ok: boolean; error?: string; line?: number; column?: number }>(
    "/api/config/validate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml })
    }
  );
}

export function saveConfig(yaml: string) {
  return apiFetch<{ ok: boolean; last_modified?: number; error?: string }>("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml })
  });
}

export function listFiles(prefix?: string, extensions?: string[]) {
  const params = new URLSearchParams();
  if (prefix) {
    params.set("prefix", prefix);
  }
  if (extensions && extensions.length) {
    params.set("extensions", extensions.join(","));
  }
  const query = params.toString();
  return apiFetch<FileEntry[]>(`/api/files${query ? `?${query}` : ""}`);
}

export function getFileContent(path: string) {
  return apiFetch<{ path: string; yaml: string; last_modified: number }>(
    `/api/files/content?path=${encodeURIComponent(path)}`
  );
}

export function saveFile(path: string, yaml: string) {
  return apiFetch<{ ok: boolean; last_modified?: number; error?: string; path?: string }>(
    "/api/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, yaml })
    }
  );
}

export function createRun(trigger = "manual") {
  return apiFetch<{ run_id: string }>("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trigger })
  });
}

export function listRuns() {
  return apiFetch<RunRecord[]>("/api/runs");
}

export function getRun(runId: string) {
  return apiFetch<RunRecord>(`/api/runs/${runId}`);
}

export function getRunLogs(runId: string, tail = 500) {
  return apiFetch<{ lines: string[]; has_more: boolean }>(
    `/api/runs/${runId}/logs?tail=${tail}`
  );
}

export function getLatestLogs(tail = 500) {
  return apiFetch<{ lines: string[]; has_more: boolean; file: string }>(
    `/api/logs/latest?tail=${tail}`
  );
}

export async function downloadFile(path: string, filename: string) {
  const auth = loadStoredAuth();
  const headers = new Headers();
  const authHeaders = authHeader(auth);
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value));

  const response = await fetch(path, { headers });
  if (response.status === 401) {
    const mode = parseAuthMode(response.headers.get("www-authenticate"));
    throw new ApiError("Unauthorized", 401, mode);
  }
  if (!response.ok) {
    throw new ApiError("Download failed", response.status, null);
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
