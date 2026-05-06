import {
  AuthApiRequestError,
  getApiBaseUrl,
  isUnauthenticatedError,
  login,
  logout,
  readProtectedWhoAmI,
  readSession,
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

  it("reads the current backend session with cookies included", async () => {
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

    await readSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/v1/auth/session",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }),
    );
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
