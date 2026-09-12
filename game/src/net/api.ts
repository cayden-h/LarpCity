// game/src/net/api.ts
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Overrides `import.meta.env.VITE_API_BASE_URL` — used for tests. */
  baseUrl?: string;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { baseUrl, ...init } = options;
  // `import.meta.env` is only populated by Vite's transform; guard against it
  // being undefined when this module runs under plain Node (e.g. tests/scripts).
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const base = baseUrl ?? env?.VITE_API_BASE_URL ?? "";
  const url = `${base}/api${path}`;

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, `${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
