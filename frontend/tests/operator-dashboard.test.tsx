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
    readCatalogUserRelationship: vi.fn(),
    updateOrganization: vi.fn(),
    createCatalogUser: vi.fn(),
    updateCatalogUser: vi.fn(),
    createTeam: vi.fn(),
    createScopedRole: vi.fn(),
    createMembership: vi.fn(),
    createAssignment: vi.fn(),
    createApp: vi.fn(),
    createProject: vi.fn(),
    createEnvironment: vi.fn(),
    createResource: vi.fn(),
  };
});

const { logout, readProtectedWhoAmI } = await import("../lib/auth");
const { readCatalogUserRelationship, readCatalogWorkspace } = await import("../lib/catalog");

const logoutMock = vi.mocked(logout);
const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const readCatalogWorkspaceMock = vi.mocked(readCatalogWorkspace);
const readCatalogUserRelationshipMock = vi.mocked(readCatalogUserRelationship);

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
  teams: [
    {
      id: "team_platform",
      organization_id: "org_123",
      name: "Platform Engineering",
      description: "Owns backend systems",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
  scoped_roles: [
    {
      id: "role_team_maintainer",
      organization_id: "org_123",
      name: "Team Maintainer",
      description: "Maintains team resources",
      scope_type: "team" as const,
      scope_id: "team_platform",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      id: "tm_1",
      team_id: "team_platform",
      catalog_user_id: "cu_ada",
      created_at: "2024-01-01T00:00:00Z",
    },
  ],
  assignments: [
    {
      id: "dra_1",
      scoped_role_id: "role_team_maintainer",
      catalog_user_id: "cu_ada",
      created_at: "2024-01-01T00:00:00Z",
    },
  ],
  apps: [
    {
      id: "app_console",
      organization_id: "org_123",
      name: "Operator Console",
      description: "Primary operator interface",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
  projects: [
    {
      id: "proj_identity",
      organization_id: "org_123",
      app_id: "app_console",
      name: "Identity Graph",
      description: "Catalog graph project",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
  environments: [
    {
      id: "env_prod",
      organization_id: "org_123",
      project_id: "proj_identity",
      name: "Production",
      description: "Primary production environment",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
  resources: [
    {
      id: "res_pg",
      organization_id: "org_123",
      app_id: "app_console",
      project_id: "proj_identity",
      environment_id: "env_prod",
      name: "Primary Postgres",
      resource_type: "database" as const,
      container_type: "environment" as const,
      container_id: "env_prod",
      scope_type: "team" as const,
      scope_id: "team_platform",
      description: "Stores catalog state",
      metadata: {
        owner: "platform",
        rotation: "manual",
      },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
};

const relationshipFixture = {
  catalog_user: workspaceFixture.users[0],
  memberships: [
    {
      membership: workspaceFixture.memberships[0],
      team: workspaceFixture.teams[0],
    },
  ],
  assignments: [
    {
      assignment: workspaceFixture.assignments[0],
      scoped_role: workspaceFixture.scoped_roles[0],
    },
  ],
  resources: [
    {
      resource: workspaceFixture.resources[0],
      app: workspaceFixture.apps[0],
      project: workspaceFixture.projects[0],
      environment: workspaceFixture.environments[0],
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
    readCatalogUserRelationshipMock.mockReset();
  });

  it("renders the real catalog workspace after the backend session resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 42,
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce(workspaceFixture);
    readCatalogUserRelationshipMock.mockResolvedValueOnce(relationshipFixture);

    render(<OperatorPage />);

    await waitFor(() => {
      expect(readProtectedWhoAmIMock).toHaveBeenCalledTimes(1);
      expect(readCatalogWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByDisplayValue("PassArk")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Primary org")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit ada lovelace/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Platform Engineering" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team Maintainer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operator Console" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Identity Graph" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Primary Postgres" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /user relationship workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/switch one selected catalog user and inspect memberships, scoped roles, and attached resources/i)).toBeInTheDocument();
    expect(
      screen.getByText(/application → project → environment → typed resource hierarchy/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/validation, conflict, not-found, scope mismatch, and audit-write failures remain visible/i),
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
