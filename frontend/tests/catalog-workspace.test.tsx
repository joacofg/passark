import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
    createTeam: vi.fn(),
    createScopedRole: vi.fn(),
    createMembership: vi.fn(),
    createAssignment: vi.fn(),
  };
});

const { readProtectedWhoAmI } = await import("../lib/auth");
const {
  createAssignment,
  createCatalogUser,
  createMembership,
  createScopedRole,
  createTeam,
  readCatalogWorkspace,
  updateCatalogUser,
  updateOrganization,
} = await import("../lib/catalog");

const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const readCatalogWorkspaceMock = vi.mocked(readCatalogWorkspace);
const updateOrganizationMock = vi.mocked(updateOrganization);
const createCatalogUserMock = vi.mocked(createCatalogUser);
const updateCatalogUserMock = vi.mocked(updateCatalogUser);
const createTeamMock = vi.mocked(createTeam);
const createScopedRoleMock = vi.mocked(createScopedRole);
const createMembershipMock = vi.mocked(createMembership);
const createAssignmentMock = vi.mocked(createAssignment);

const baseWorkspace = {
  organization: {
    id: "org_123",
    slug: "passark",
    display_name: "PassArk",
    description: "Primary organization for this PassArk deployment.",
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
};

function queueAuthenticatedWorkspace(
  workspace: typeof baseWorkspace = baseWorkspace,
) {
  readProtectedWhoAmIMock.mockResolvedValueOnce({
    user: { id: 1, email: "admin@passark.local", is_active: true },
    session_id: 12,
  });
  readCatalogWorkspaceMock.mockResolvedValueOnce(workspace);
}

describe("catalog workspace", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    readProtectedWhoAmIMock.mockReset();
    readCatalogWorkspaceMock.mockReset();
    updateOrganizationMock.mockReset();
    createCatalogUserMock.mockReset();
    updateCatalogUserMock.mockReset();
    createTeamMock.mockReset();
    createScopedRoleMock.mockReset();
    createMembershipMock.mockReset();
    createAssignmentMock.mockReset();
  });

  it("shows the loading state before catalog data resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 12,
    });
    readCatalogWorkspaceMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    render(<OperatorPage />);

    expect(await screen.findByText(/loading catalog workspace/i)).toBeInTheDocument();
  });

  it("shows empty-state callouts when the relationship catalog is empty", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
      teams: [],
      scoped_roles: [],
      memberships: [],
      assignments: [],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no teams yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no scoped roles yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no team memberships yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no direct role assignments yet/i)).toBeInTheDocument();
  });

  it("creates a catalog user and refreshes the live workspace", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
      memberships: [],
      assignments: [],
    });
    createCatalogUserMock.mockResolvedValueOnce({
      catalog_user: {
        id: "cu_grace",
        organization_id: "org_123",
        email: "grace@example.com",
        full_name: "Grace Hopper",
        job_title: "Engineer",
        is_active: true,
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      users: [
        {
          id: "cu_grace",
          organization_id: "org_123",
          email: "grace@example.com",
          full_name: "Grace Hopper",
          job_title: "Engineer",
          is_active: true,
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      memberships: [],
      assignments: [],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "grace@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create user$/i }));

    await waitFor(() => {
      expect(createCatalogUserMock).toHaveBeenCalledWith({
        email: "grace@example.com",
        full_name: "Grace Hopper",
        job_title: "Engineer",
        is_active: true,
      });
    });

    expect(
      await screen.findByText(/catalog user grace hopper created successfully/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /edit grace hopper/i })).toBeInTheDocument();
  });

  it("edits a catalog user through the live workspace form", async () => {
    queueAuthenticatedWorkspace();
    updateCatalogUserMock.mockResolvedValueOnce({
      catalog_user: {
        ...baseWorkspace.users[0],
        full_name: "Ada Byron",
        job_title: "Principal Analyst",
        is_active: false,
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      users: [
        {
          ...baseWorkspace.users[0],
          full_name: "Ada Byron",
          job_title: "Principal Analyst",
          is_active: false,
        },
      ],
      memberships: [
        {
          ...baseWorkspace.memberships[0],
          catalog_user_id: "cu_ada",
        },
      ],
      assignments: [
        {
          ...baseWorkspace.assignments[0],
          catalog_user_id: "cu_ada",
        },
      ],
    });

    render(<OperatorPage />);

    expect(await screen.findByRole("button", { name: /edit ada lovelace/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit ada lovelace/i }));

    const fullNameInput = screen.getByLabelText("Full name") as HTMLInputElement;
    fireEvent.change(fullNameInput, { target: { value: "Ada Byron" } });
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Principal Analyst" },
    });
    fireEvent.click(screen.getByLabelText(/catalog user is active/i));
    fireEvent.click(screen.getByRole("button", { name: /^save user$/i }));

    await waitFor(() => {
      expect(updateCatalogUserMock).toHaveBeenCalledWith("cu_ada", {
        full_name: "Ada Byron",
        job_title: "Principal Analyst",
        is_active: false,
      });
    });

    expect(
      await screen.findByText(/catalog user ada byron updated successfully/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /edit ada byron/i })).toBeInTheDocument();
    expect(await screen.findByText(/principal analyst · inactive/i)).toBeInTheDocument();
  });

  it("creates teams, roles, memberships, and assignments through the live workspace", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      teams: [],
      scoped_roles: [],
      memberships: [],
      assignments: [],
    });
    createTeamMock.mockResolvedValueOnce({
      team: {
        id: "team_security",
        organization_id: "org_123",
        name: "Security",
        description: "Handles review",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      teams: [
        {
          id: "team_security",
          organization_id: "org_123",
          name: "Security",
          description: "Handles review",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      scoped_roles: [],
      memberships: [],
      assignments: [],
    });
    createScopedRoleMock.mockResolvedValueOnce({
      scoped_role: {
        id: "role_security_admin",
        organization_id: "org_123",
        name: "Security Admin",
        description: "Owns security approvals",
        scope_type: "team",
        scope_id: "team_security",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      teams: [
        {
          id: "team_security",
          organization_id: "org_123",
          name: "Security",
          description: "Handles review",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      scoped_roles: [
        {
          id: "role_security_admin",
          organization_id: "org_123",
          name: "Security Admin",
          description: "Owns security approvals",
          scope_type: "team",
          scope_id: "team_security",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      memberships: [],
      assignments: [],
    });
    createMembershipMock.mockResolvedValueOnce({
      membership: {
        id: "tm_security",
        team_id: "team_security",
        catalog_user_id: "cu_ada",
        created_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      teams: [
        {
          id: "team_security",
          organization_id: "org_123",
          name: "Security",
          description: "Handles review",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      scoped_roles: [
        {
          id: "role_security_admin",
          organization_id: "org_123",
          name: "Security Admin",
          description: "Owns security approvals",
          scope_type: "team",
          scope_id: "team_security",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      memberships: [
        {
          id: "tm_security",
          team_id: "team_security",
          catalog_user_id: "cu_ada",
          created_at: "2024-01-02T00:00:00Z",
        },
      ],
      assignments: [],
    });
    createAssignmentMock.mockResolvedValueOnce({
      assignment: {
        id: "dra_security",
        scoped_role_id: "role_security_admin",
        catalog_user_id: "cu_ada",
        created_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      teams: [
        {
          id: "team_security",
          organization_id: "org_123",
          name: "Security",
          description: "Handles review",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      scoped_roles: [
        {
          id: "role_security_admin",
          organization_id: "org_123",
          name: "Security Admin",
          description: "Owns security approvals",
          scope_type: "team",
          scope_id: "team_security",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      memberships: [
        {
          id: "tm_security",
          team_id: "team_security",
          catalog_user_id: "cu_ada",
          created_at: "2024-01-02T00:00:00Z",
        },
      ],
      assignments: [
        {
          id: "dra_security",
          scoped_role_id: "role_security_admin",
          catalog_user_id: "cu_ada",
          created_at: "2024-01-02T00:00:00Z",
        },
      ],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no teams yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "Security" },
    });
    fireEvent.change(screen.getByLabelText("Team description"), {
      target: { value: "Handles review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create team$/i }));

    await waitFor(() => {
      expect(createTeamMock).toHaveBeenCalledWith({
        name: "Security",
        description: "Handles review",
      });
    });
    expect(await screen.findByText(/team security created successfully/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role name"), {
      target: { value: "Security Admin" },
    });
    fireEvent.change(screen.getByLabelText("Role description"), {
      target: { value: "Owns security approvals" },
    });
    fireEvent.change(screen.getByLabelText("Scope type"), {
      target: { value: "team" },
    });
    fireEvent.change(screen.getByLabelText("Scope target"), {
      target: { value: "team_security" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));

    await waitFor(() => {
      expect(createScopedRoleMock).toHaveBeenCalledWith({
        name: "Security Admin",
        description: "Owns security approvals",
        scope_type: "team",
        scope_id: "team_security",
      });
    });
    expect(await screen.findByText(/scoped role security admin created successfully/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Team"), {
      target: { value: "team_security" },
    });
    fireEvent.change(screen.getAllByLabelText(/^Catalog user$/)[0], {
      target: { value: "cu_ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create membership$/i }));

    await waitFor(() => {
      expect(createMembershipMock).toHaveBeenCalledWith({
        team_id: "team_security",
        catalog_user_id: "cu_ada",
      });
    });
    expect(
      await screen.findByText(/team membership created for ada lovelace in security/i),
    ).toBeInTheDocument();

    const assignmentRoleSelect = screen.getByLabelText("Scoped role");
    const assignmentUserSelect = screen.getAllByLabelText(/^Catalog user$/)[1];
    fireEvent.change(assignmentRoleSelect, {
      target: { value: "role_security_admin" },
    });
    fireEvent.change(assignmentUserSelect, {
      target: { value: "cu_ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create assignment$/i }));

    await waitFor(() => {
      expect(createAssignmentMock).toHaveBeenCalledWith({
        scoped_role_id: "role_security_admin",
        catalog_user_id: "cu_ada",
      });
    });
    expect(
      await screen.findByText(/direct role assignment created for ada lovelace with security admin/i),
    ).toBeInTheDocument();
  });

  it("surfaces organization audit failures without losing the machine-readable code", async () => {
    queueAuthenticatedWorkspace();
    updateOrganizationMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        503,
        "Audit logging is required for organization updates.",
        "organization_update_audit_unavailable",
      ),
    );

    render(<OperatorPage />);

    const displayName = await screen.findByDisplayValue("PassArk");
    fireEvent.change(displayName, { target: { value: "PassArk Labs" } });
    fireEvent.click(screen.getByRole("button", { name: /save organization/i }));

    await waitFor(() => {
      expect(updateOrganizationMock).toHaveBeenCalledWith({
        display_name: "PassArk Labs",
        description: "Primary organization for this PassArk deployment.",
      });
    });

    const organizationPanel = screen.getByRole("region", { name: /organization root/i });
    expect(
      await within(organizationPanel).findByText(
        "Audit logging is required for organization updates.",
      ),
    ).toBeInTheDocument();
    expect(
      within(organizationPanel).getByText(
        "Failure code: organization_update_audit_unavailable",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces duplicate membership failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createMembershipMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        409,
        "Catalog user is already a member of this team.",
        "team_membership_conflict",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Platform Engineering" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Team"), {
      target: { value: "team_platform" },
    });
    fireEvent.change(screen.getAllByLabelText(/^Catalog user$/)[0], {
      target: { value: "cu_ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create membership$/i }));

    await waitFor(() => {
      expect(createMembershipMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Catalog user is already a member of this team.")).toBeInTheDocument();
    expect(
      await screen.findByText("Failure code: team_membership_conflict"),
    ).toBeInTheDocument();
  });

  it("surfaces duplicate assignment failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createAssignmentMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        409,
        "Catalog user already has this scoped role.",
        "direct_role_assignment_conflict",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Team Maintainer" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Scoped role"), {
      target: { value: "role_team_maintainer" },
    });
    fireEvent.change(screen.getAllByLabelText(/^Catalog user$/)[1], {
      target: { value: "cu_ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create assignment$/i }));

    await waitFor(() => {
      expect(createAssignmentMock).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText("Catalog user already has this scoped role."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Failure code: direct_role_assignment_conflict"),
    ).toBeInTheDocument();
  });

  it("surfaces scoped-role scope mismatch failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createScopedRoleMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        422,
        "Scoped role scope_type and scope_id do not match a valid catalog container.",
        "scoped_role_scope_mismatch",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Platform Engineering" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role name"), {
      target: { value: "Broken Role" },
    });
    fireEvent.change(screen.getByLabelText("Scope type"), {
      target: { value: "team" },
    });
    fireEvent.change(screen.getByLabelText("Scope target"), {
      target: { value: "team_platform" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));

    await waitFor(() => {
      expect(createScopedRoleMock).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText(
        "Scoped role scope_type and scope_id do not match a valid catalog container.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Failure code: scoped_role_scope_mismatch"),
    ).toBeInTheDocument();
  });

  it("redirects to sign-in if the catalog workspace read detects auth expiry", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 12,
    });
    readCatalogWorkspaceMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
  });
});
