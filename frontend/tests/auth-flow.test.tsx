import {
  AuthApiRequestError,
  authenticatedJsonFetch,
  getApiBaseUrl,
  isUnauthenticatedError,
  login,
  logout,
  readClientSession,
  readProtectedWhoAmI,
  readServerSession,
  runVaultAccessProbe,
} from "../lib/auth";

describe("frontend auth client", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend:8000/api/v1";
    vi.restoreAllMocks();
  });

  it("sends credentials on login requests", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 1, email: "admin@passark.local", is_active: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const payload = await login({
      email: "admin@passark.local",
      password: "change-me-now",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(payload.user.email).toBe("admin@passark.local");
  });

  it("exposes an authenticated client fetch helper for protected reads", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const payload = await authenticatedJsonFetch<{ ok: boolean }>("/health", {
      method: "GET",
      cache: "no-store",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/health",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(payload).toEqual({ ok: true });
  });

  it("reads the current backend session with cookies included for client flows", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 1, email: "admin@passark.local", is_active: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await readClientSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/auth/session",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
  });

  it("maps an authenticated server-side session check into a typed session state", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 1, email: "admin@passark.local", is_active: true },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(readServerSession()).resolves.toEqual({
      status: "authenticated",
      session: {
        user: { id: 1, email: "admin@passark.local", is_active: true },
      },
    });
  });

  it("maps the backend unauthenticated contract into a typed server-side unauthenticated state", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            code: "auth_unauthenticated",
            message: "Authentication required.",
          },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const payload = await readServerSession();

    expect(payload.status).toBe("unauthenticated");
    if (payload.status === "unauthenticated") {
      expect(payload.error).toMatchObject({
        status: 401,
        code: "auth_unauthenticated",
        message: "Authentication required.",
      });
    }
  });

  it("preserves non-auth server-side session failures for operator diagnostics", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            code: "backend_unavailable",
            message: "Backend session lookup failed.",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const payload = await readServerSession();

    expect(payload.status).toBe("error");
    if (payload.status === "error") {
      expect(payload.error).toMatchObject({
        message: "Backend session lookup failed.",
      });
    }
  });

  it("loads the protected whoami payload with cookies included", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { id: 1, email: "admin@passark.local", is_active: true },
          session_id: 7,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const payload = await readProtectedWhoAmI();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/protected/whoami",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
    expect(payload.session_id).toBe(7);
  });

  it("posts the audited vault access probe with cookies included", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          operation: "vault_access_probe",
          status: "allowed",
          actor_id: 1,
          audit_event_id: 12,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const payload = await runVaultAccessProbe();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/protected/vault-access-probe",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(payload).toEqual({
      operation: "vault_access_probe",
      status: "allowed",
      actor_id: 1,
      audit_event_id: 12,
    });
  });

  it("converts the backend 401 contract into an unauthenticated request error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            code: "auth_unauthenticated",
            message: "Authentication required.",
          },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(readProtectedWhoAmI()).rejects.toMatchObject({
      name: "AuthApiRequestError",
      status: 401,
      code: "auth_unauthenticated",
      message: "Authentication required.",
    });
  });

  it("preserves audited protected-action failure codes for operator UI diagnostics", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            code: "audit_unavailable",
            message: "Audit logging is unavailable.",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(runVaultAccessProbe()).rejects.toMatchObject({
      name: "AuthApiRequestError",
      status: 503,
      code: "audit_unavailable",
      message: "Audit logging is unavailable.",
    });
  });

  it("identifies unauthenticated errors for redirect/fallback handling", () => {
    const error = new AuthApiRequestError(
      401,
      "Authentication required.",
      "auth_unauthenticated",
    );

    expect(isUnauthenticatedError(error)).toBe(true);
    expect(isUnauthenticatedError(new Error("boom"))).toBe(false);
  });

  it("issues a credentialed logout request", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("falls back to the default API base URL when unset", () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;

    expect(getApiBaseUrl()).toBe("http://localhost:8000/api/v1");
  });
});
