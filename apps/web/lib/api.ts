/** The backend's JSON API. The URL is public; nothing secret lives in the browser bundle. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "")

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function api<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; token?: string | null } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {})
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) })
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(typeof json["error"] === "string" ? json["error"] : `request failed (${res.status})`, res.status)
  return json as T
}
