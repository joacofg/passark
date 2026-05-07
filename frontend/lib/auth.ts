const DEFAULT_API_BASE_URL = "http://localhost:8000/api/v1";

type CredentialMode = RequestCredentials;

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

export type VaultAccessProbeResponse = {
  operation: string;
  status: string;
  actor_id: number;
  audit_event_id: number;
};

export type AuthApiError = {
  detail?: {
    code?: string;
    message?: string;
  };
};

export type SessionReadResult =
  | { status: "authenticated"; session: AuthSessionResponse }
  | { status: "unauthenticated"; error: AuthApiRequestError }
  | { status: "error"; error: Error };

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

function defaultHeaders(init?: RequestInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  };
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

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  credentials: CredentialMode = "include",
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials,
    headers: defaultHeaders(init),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function authenticatedJsonFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return requestJson<T>(path, init, "include");
}

export async function readClientSession(): Promise<AuthSessionResponse> {
  return authenticatedJsonFetch<AuthSessionResponse>("/auth/session", {
    method: "GET",
    cache: "no-store",
  });
}

export async function readServerSession(): Promise<SessionReadResult> {
  try {
    const session = await requestJson<AuthSessionResponse>(
      "/auth/session",
      {
        method: "GET",
        cache: "no-store",
      },
      "include",
    );

    return { status: "authenticated", session };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { status: "unauthenticated", error };
    }

    return {
      status: "error",
      error: error instanceof Error ? error : new Error("Unable to read backend session."),
    };
  }
}

export async function login(payload: {
  email: string;
  password: string;
}): Promise<AuthSessionResponse> {
  return authenticatedJsonFetch<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readSession(): Promise<AuthSessionResponse> {
  return readClientSession();
}

export async function logout(): Promise<void> {
  await authenticatedJsonFetch<void>("/auth/logout", {
    method: "POST",
  });
}

export async function readProtectedWhoAmI(): Promise<ProtectedWhoAmIResponse> {
  return authenticatedJsonFetch<ProtectedWhoAmIResponse>("/protected/whoami", {
    method: "GET",
    cache: "no-store",
  });
}

export async function runVaultAccessProbe(): Promise<VaultAccessProbeResponse> {
  return authenticatedJsonFetch<VaultAccessProbeResponse>(
    "/protected/vault-access-probe",
    {
      method: "POST",
    },
  );
}

export function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof AuthApiRequestError &&
    error.status === 401 &&
    error.code === "auth_unauthenticated"
  );
}
