import type { BoardLayout, SessionSummary, DeviceInfo, PairingInfo, RecentTask, LiveChat, LiveOutput, LiveState } from "../shared/live";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

let launchCapability: string | null = null;
let activeSession: string | null = null;

/** Which named Herdr session the app is showing. Null is the default session. */
export function setActiveSession(name: string | null): void {
  activeSession = name;
}

function withSession(path: string): string {
  if (!activeSession || !path.startsWith("/api/v2/") || path.startsWith("/api/v2/sessions")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}session=${encodeURIComponent(activeSession)}`;
}

export function consumeLaunchCapability(): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const candidate = fragment.get("launch");
  if (candidate && /^[A-Za-z0-9_-]{43}$/u.test(candidate)) {
    launchCapability = candidate;
    try { sessionStorage.setItem("hcc.launch", candidate); } catch { /* storage may be unavailable */ }
  } else {
    try { launchCapability = sessionStorage.getItem("hcc.launch"); } catch { launchCapability = null; }
  }
  if (url.hash || url.search) window.history.replaceState(null, "", url.pathname);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(withSession(path), {
      ...init,
      cache: "no-store",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(launchCapability ? { Authorization: `Bearer ${launchCapability}` } : {}),
      },
    });
  } catch {
    throw new ApiError("Control Center could not be reached.", 0);
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new ApiError(message ?? "Request failed.", response.status);
  }
  return body as T;
}

export const fetchState = () => request<LiveState>("/api/v2/state");
export const fetchOutput = (paneId: string, lines = 160) =>
  request<LiveOutput>(`/api/v2/agents/${encodeURIComponent(paneId)}/output?lines=${lines}`);
export const sendPrompt = (paneId: string, text: string) =>
  request<{ ok: true }>(`/api/v2/agents/${encodeURIComponent(paneId)}/prompt`, { method: "POST", body: JSON.stringify({ text }) });
export const sendKeys = (paneId: string, keys: string[]) =>
  request<{ ok: true }>(`/api/v2/agents/${encodeURIComponent(paneId)}/keys`, { method: "POST", body: JSON.stringify({ keys }) });

export const fetchChat = (paneId: string) => request<LiveChat>(`/api/v2/agents/${encodeURIComponent(paneId)}/chat`);
export const renameAgent = (paneId: string, name: string | null) =>
  request<{ ok: true }>(`/api/v2/agents/${encodeURIComponent(paneId)}/rename`, { method: "POST", body: JSON.stringify({ name }) });
export const closeAgent = (paneId: string) =>
  request<{ ok: true }>(`/api/v2/agents/${encodeURIComponent(paneId)}/close`, { method: "POST", body: JSON.stringify({ confirm: true }) });
export const fetchRecent = () => request<{ tasks: RecentTask[] }>("/api/v2/recent");

export const fetchDevices = () => request<{ devices: DeviceInfo[]; remote: boolean }>("/api/devices");
export const revokeDevice = (id: string) => request<{ ok: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
export const createPairing = () => request<PairingInfo>("/api/devices/pairing", { method: "POST", body: JSON.stringify({}) });

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/u.test(ua) ? "iPhone" : /iPad/u.test(ua) ? "iPad" : /Android/u.test(ua) ? "Android" : /Mac/u.test(ua) ? "Mac" : /Windows/u.test(ua) ? "Windows" : /Linux/u.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//u.test(ua) ? "Edge" : /Chrome\//u.test(ua) ? "Chrome" : /Firefox\//u.test(ua) ? "Firefox" : /Safari\//u.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

export let pairingResult: "paired" | "failed" | null = null;

/** Exchanges a #pair=<code> link for a device cookie, then removes the code from the address bar. */
export async function consumePairing(): Promise<void> {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const code = fragment.get("pair");
  if (!code) return;
  window.history.replaceState(null, "", url.pathname);
  try {
    await request<{ device: DeviceInfo }>("/api/pair", { method: "POST", body: JSON.stringify({ code, name: deviceName() }) });
    pairingResult = "paired";
  } catch { pairingResult = "failed"; }
}
export const fetchSessions = () => request<{ sessions: SessionSummary[] }>("/api/v2/sessions");
export type PaneClass = "agent" | "console" | "shell" | "unknown";
export const fetchProcess = (paneId: string) =>
  request<{ cls: PaneClass; command: string | null }>(`/api/v2/agents/${encodeURIComponent(paneId)}/process`);
export const fetchLayout = () => request<{ layout: BoardLayout | null }>("/api/v2/layout");
