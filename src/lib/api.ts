const DEFAULT_TIMEOUT_MS = 8000

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

type RequestOptions = RequestInit & { timeoutMs?: number }

async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  try {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      // Flask always answers with {error, message}. Anything else means the page is served by
      // something with no Flask API behind /api (or Flask is not running).
      throw new ApiError(
        body?.message ||
          `The Flask API was not reached (status ${response.status} from the web server). Run "npm run dev:api" and open the site through "npm run dev".`,
        response.status,
        body?.error,
      )
    }
    return body as T
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The API request timed out.", 0, "timeout")
    }
    if (error instanceof ApiError) throw error
    // fetch() itself failed ("Failed to fetch"): nothing answered at this page's address,
    // i.e. the "npm run dev" server stopped or the network dropped.
    throw new ApiError(
      `The website's server could not be reached. Make sure "npm run dev" and "npm run dev:api" are both running, then reload`,
      0,
      "network_error",
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isRecordArray(
  value: unknown,
): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord)
}

export interface ApiSettings {
  threshold: number
  sprayDuration: number
  autoSpray: boolean
  notifications: boolean
}

/* ------------------------- dashboard writes (CSRF) ------------------------ */
let csrfToken = ""

async function refreshCsrf(): Promise<string> {
  const body = await requestJson<unknown>("/api/csrf")
  csrfToken = isRecord(body) && typeof body.csrfToken === "string" ? body.csrfToken : ""
  return csrfToken
}

/** A CSRF-protected write. Retries once with a fresh token if the old one expired. */
export async function mutateJson<T>(
  path: string,
  method: "PUT" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const send = (token: string) =>
    requestJson<T>(path, {
      method,
      headers: { "X-CSRF-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    return await send(csrfToken || (await refreshCsrf()))
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403) throw error
    return await send(await refreshCsrf())
  }
}

export const setZoneStream = (zoneId: string, streamUrl: string) =>
  mutateJson(`/api/zones/${encodeURIComponent(zoneId)}/stream`, "PUT", { streamUrl })

/* ------------------------------- recordings ------------------------------- */
export const startRecording = (zoneId: string) =>
  mutateJson<unknown>("/api/recordings/start", "POST", { zoneId: Number(zoneId) })

export const stopRecording = (zoneId: string) =>
  mutateJson<unknown>("/api/recordings/stop", "POST", { zoneId: Number(zoneId) })

export const deleteRecording = (id: number) =>
  mutateJson<unknown>(`/api/recordings/${id}`, "DELETE")

/* -------------------------------- settings -------------------------------- */
function parseSettings(value: unknown): ApiSettings & { csrfToken?: string } {
  if (
    !isRecord(value) ||
    typeof value.threshold !== "number" ||
    typeof value.sprayDuration !== "number" ||
    typeof value.autoSpray !== "boolean" ||
    typeof value.notifications !== "boolean"
  ) {
    throw new ApiError(
      "The API returned invalid settings data.",
      0,
      "invalid_response",
    )
  }
  return value as unknown as ApiSettings & { csrfToken?: string }
}

export async function getSettings(): Promise<ApiSettings> {
  const value = parseSettings(await requestJson<unknown>("/api/settings"))
  csrfToken = typeof value.csrfToken === "string" ? value.csrfToken : ""
  return value
}

export async function updateSettings(
  settings: ApiSettings,
): Promise<ApiSettings> {
  return parseSettings(await mutateJson<unknown>("/api/settings", "PUT", settings))
}

export { requestJson }
