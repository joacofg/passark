const DEFAULT_API_BASE_URL = "http://localhost:8000/api/v1";

export type AuthenticatedUser = {
  id: number;
  email: string;
  is_active: boolean;
};

export type AuthSessionResponse = {
  user: AuthenticatedUser;
};

export type ProtectedWhoAmIResponse = {
  user: AuthenticatedUser;
  session_id: number;
};

export type AuthApiError = {
  detail?: {
    code?: string;
    message?: string;
  };
};

export class AuthApiRequestError extends Error {
  status: number;

  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AuthApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  );
}

export function getRuntimeEnvironment(): string {
  return process.env.PASSARK_ENV ?? "development";
}

async function parseError(response: Response): Promise<AuthApiRequestError> {
  const fallbackMessage = `Request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as AuthApiError;
    return new AuthApiRequestError(
      response.status,
      payload.detail?.message ?? fallbackMessage,
      payload.detail?.code,
    );
  } catch {
    return new AuthApiRequestError(response.status, fallbackMessage);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(payload: {
  email: string;
  password: string;
}): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readSession(): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>("/auth/session", {
    method: "GET",
    cache: "no-store",
  });
}

export async function logout(): Promise<void> {
  await requestJson<void>("/auth/logout", {
    method: "POST",
  });
}

export async function readProtectedWhoAmI(): Promise<ProtectedWhoAmIResponse> {
  return requestJson<ProtectedWhoAmIResponse>("/protected/whoami", {
    method: "GET",
    cache: "no-store",
  });
}

export function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof AuthApiRequestError &&
    error.status === 401 &&
    error.code === "auth_unauthenticated"
  );
}
