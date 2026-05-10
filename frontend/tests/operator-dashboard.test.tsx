import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import OperatorPage from "../app/operator/page";
import { AuthApiRequestError } from "../lib/auth";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const refreshMock = vi.fn();
const routerMock = {
  push: pushMock,
  replace: replaceMock,
  refresh: refreshMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");

  return {
    ...actual,
    logout: vi.fn(),
    readProtectedWhoAmI: vi.fn(),
  };
});

vi.mock("../lib/catalog", async () => {
  const actual = await vi.importActual<typeof import("../lib/catalog")>("../lib/catalog");

  return {
    ...actual,
    readCatalogWorkspace: vi.fn(),
    updateOrganization: vi.fn(),
    createCatalogUser: vi.fn(),
    updateCatalogUser: vi.fn(),
  };
});

const { logout, readProtectedWhoAmI } = await import("../lib/auth");
const {
  createCatalogUser,
  readCatalogWorkspace,
  updateCatalogUser,
  updateOrganization,
} = await import("../lib/catalog");

const logoutMock = vi.mocked(logout);
const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const readCatalogWorkspaceMock = vi.mocked(readCatalogWorkspace);
const updateOrganizationMock = vi.mocked(updateOrganization);
const createCatalogUserMock = vi.mocked(createCatalogUser);
const updateCatalogUserMock = vi.mocked(updateCatalogUser);

const workspaceFixture = {
  organization: {
    id: "org_123",
    slug: "passark",
    display_name: "PassArk",
    description: "Primary org",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  users: [
    {
      id: "cu_ada",
      organization_id: "org_123",
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      job_title: "Analyst",
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
};

describe("OperatorPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    logoutMock.mockReset();
    readProtectedWhoAmIMock.mockReset();
    readCatalogWorkspaceMock.mockReset();
    updateOrganizationMock.mockReset();
    createCatalogUserMock.mockReset();
    updateCatalogUserMock.mockReset();
  });

  it("renders the real catalog workspace after the backend session resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 42,
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce(workspaceFixture);

    render(<OperatorPage />);

    await waitFor(() => {
      expect(readProtectedWhoAmIMock).toHaveBeenCalledTimes(1);
      expect(readCatalogWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByDisplayValue("PassArk")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Primary org")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/validation, conflict, and audit-write failures remain visible/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/session token/i)).not.toBeInTheDocument();
  });

  it("redirects unauthenticated browsers back to sign-in with a visible fallback state", async () => {
    readProtectedWhoAmIMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
    expect(screen.getByText(/go to sign-in/i)).toBeInTheDocument();
  });

  it("surfaces protected whoami failures without collapsing them into signed-out copy", async () => {
    readProtectedWhoAmIMock.mockRejectedValueOnce(new Error("Backend session lookup failed."));

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByText("Backend session lookup failed.")).toBeInTheDocument();
    });

    expect(screen.getByText(/unable to load protected data/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("logs out and routes back to sign-in", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce(workspaceFixture);
    logoutMock.mockResolvedValueOnce();

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/login?reason=signed-out");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("surfaces catalog workspace bootstrap failures with stable failure codes", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    readCatalogWorkspaceMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        503,
        "Audit logging is required for organization updates.",
        "organization_update_audit_unavailable",
      ),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(readCatalogWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/unable to load catalog workspace/i)).toBeInTheDocument();
    expect(
      screen.getByText("Failure code: organization_update_audit_unavailable"),
    ).toBeInTheDocument();
  });
});
