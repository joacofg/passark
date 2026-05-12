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

const { readProtectedWhoAmI } = await import("../lib/auth");
const {
  createApp,
  createAssignment,
  createCatalogUser,
  createEnvironment,
  createMembership,
  createProject,
  createResource,
  createScopedRole,
  createTeam,
  readCatalogUserRelationship,
  readCatalogWorkspace,
  updateCatalogUser,
  updateOrganization,
} = await import("../lib/catalog");

const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const readCatalogWorkspaceMock = vi.mocked(readCatalogWorkspace);
const readCatalogUserRelationshipMock = vi.mocked(readCatalogUserRelationship);
const updateOrganizationMock = vi.mocked(updateOrganization);
const createCatalogUserMock = vi.mocked(createCatalogUser);
const updateCatalogUserMock = vi.mocked(updateCatalogUser);
const createTeamMock = vi.mocked(createTeam);
const createScopedRoleMock = vi.mocked(createScopedRole);
const createMembershipMock = vi.mocked(createMembership);
const createAssignmentMock = vi.mocked(createAssignment);
const createAppMock = vi.mocked(createApp);
const createProjectMock = vi.mocked(createProject);
const createEnvironmentMock = vi.mocked(createEnvironment);
const createResourceMock = vi.mocked(createResource);

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

const baseRelationship = {
  catalog_user: baseWorkspace.users[0],
  memberships: [
    {
      membership: baseWorkspace.memberships[0],
      team: baseWorkspace.teams[0],
    },
  ],
  assignments: [
    {
      assignment: baseWorkspace.assignments[0],
      scoped_role: baseWorkspace.scoped_roles[0],
    },
  ],
  resources: [
    {
      resource: baseWorkspace.resources[0],
      app: baseWorkspace.apps[0],
      project: baseWorkspace.projects[0],
      environment: baseWorkspace.environments[0],
    },
  ],
};

function queueAuthenticatedWorkspace(
  workspace: typeof baseWorkspace = baseWorkspace,
  relationship = baseRelationship,
) {
  readProtectedWhoAmIMock.mockResolvedValueOnce({
    user: { id: 1, email: "admin@passark.local", is_active: true },
    session_id: 12,
  });
  readCatalogWorkspaceMock.mockResolvedValueOnce(workspace);
  if (workspace.users.length > 0) {
    readCatalogUserRelationshipMock.mockResolvedValueOnce(relationship);
  }
}

describe("catalog workspace", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    readProtectedWhoAmIMock.mockReset();
    readCatalogWorkspaceMock.mockReset();
    readCatalogUserRelationshipMock.mockReset();
    updateOrganizationMock.mockReset();
    createCatalogUserMock.mockReset();
    updateCatalogUserMock.mockReset();
    createTeamMock.mockReset();
    createScopedRoleMock.mockReset();
    createMembershipMock.mockReset();
    createAssignmentMock.mockReset();
    createAppMock.mockReset();
    createProjectMock.mockReset();
    createEnvironmentMock.mockReset();
    createResourceMock.mockReset();
  });

  it("renders the selected user relationship workspace from the protected aggregate", async () => {
    queueAuthenticatedWorkspace();

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: /user relationship workspace/i })).toBeInTheDocument();
    const relationshipWorkspace = screen.getByRole("region", { name: /user relationship workspace/i });
    expect(
      (within(relationshipWorkspace).getByRole("option", { name: "Ada Lovelace" }) as HTMLOptionElement)
        .selected,
    ).toBe(true);
    expect(screen.getByText(/select one catalog user to read memberships, scoped roles, and attached resources/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Platform Engineering" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team Maintainer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Primary Postgres" })).toBeInTheDocument();
    expect(screen.getByText(/database · environment · production · team · platform engineering/i)).toBeInTheDocument();
  });

  it("shows empty relationship states when the selected user has no memberships, roles, or resources", async () => {
    queueAuthenticatedWorkspace(baseWorkspace, {
      catalog_user: baseWorkspace.users[0],
      memberships: [],
      assignments: [],
      resources: [],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/does not belong to any teams yet/i)).toBeInTheDocument();
    expect(screen.getByText(/does not have any direct scoped roles yet/i)).toBeInTheDocument();
    expect(screen.getByText(/does not have any attached resource relationships yet/i)).toBeInTheDocument();
  });

  it("surfaces selected-user relationship not-found failures inline", async () => {
    queueAuthenticatedWorkspace();
    readCatalogUserRelationshipMock.mockReset();
    readCatalogUserRelationshipMock.mockRejectedValueOnce(
      new AuthApiRequestError(404, "Catalog user was not found.", "catalog_user_not_found"),
    );

    render(<OperatorPage />);

    expect(await screen.findByText(/unable to load selected user relationships/i)).toBeInTheDocument();
    expect(screen.getByText("Catalog user was not found.")).toBeInTheDocument();
    expect(screen.getByText("Failure code: catalog_user_not_found")).toBeInTheDocument();
  });

  it("redirects to sign-in if the selected-user relationship read detects auth expiry", async () => {
    queueAuthenticatedWorkspace();
    readCatalogUserRelationshipMock.mockReset();
    readCatalogUserRelationshipMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
  });

  it("shows the loading state before catalog data resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 12,
    });
    readCatalogWorkspaceMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    readCatalogUserRelationshipMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    render(<OperatorPage />);

    expect(await screen.findByText(/loading catalog workspace/i)).toBeInTheDocument();
  });

  it("shows empty-state callouts when the hierarchy catalog is empty", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
      teams: [],
      scoped_roles: [],
      memberships: [],
      assignments: [],
      apps: [],
      projects: [],
      environments: [],
      resources: [],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no teams yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no scoped roles yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no team memberships yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no direct role assignments yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no applications yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no environments yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no resources yet/i)).toBeInTheDocument();
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
    const updatedUserButton = await screen.findByRole("button", { name: /edit ada byron/i });
    const updatedUserCard = updatedUserButton.closest("li");
    expect(updatedUserCard).not.toBeNull();
    expect(within(updatedUserCard as HTMLElement).getByText(/principal analyst · inactive/i)).toBeInTheDocument();
  });

  it("creates apps, projects, environments, and typed resources through the live workspace", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      apps: [],
      projects: [],
      environments: [],
      resources: [],
    });
    createAppMock.mockResolvedValueOnce({
      app: {
        id: "app_billing",
        organization_id: "org_123",
        name: "Billing",
        description: "Customer billing",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      apps: [
        {
          id: "app_billing",
          organization_id: "org_123",
          name: "Billing",
          description: "Customer billing",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      projects: [],
      environments: [],
      resources: [],
    });
    createProjectMock.mockResolvedValueOnce({
      project: {
        id: "proj_payments",
        organization_id: "org_123",
        app_id: "app_billing",
        name: "Payments Core",
        description: "Core payment flows",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      apps: [
        {
          id: "app_billing",
          organization_id: "org_123",
          name: "Billing",
          description: "Customer billing",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      projects: [
        {
          id: "proj_payments",
          organization_id: "org_123",
          app_id: "app_billing",
          name: "Payments Core",
          description: "Core payment flows",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      environments: [],
      resources: [],
    });
    createEnvironmentMock.mockResolvedValueOnce({
      environment: {
        id: "env_staging",
        organization_id: "org_123",
        project_id: "proj_payments",
        name: "Staging",
        description: "Pre-production validation",
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      apps: [
        {
          id: "app_billing",
          organization_id: "org_123",
          name: "Billing",
          description: "Customer billing",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      projects: [
        {
          id: "proj_payments",
          organization_id: "org_123",
          app_id: "app_billing",
          name: "Payments Core",
          description: "Core payment flows",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      environments: [
        {
          id: "env_staging",
          organization_id: "org_123",
          project_id: "proj_payments",
          name: "Staging",
          description: "Pre-production validation",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      resources: [],
    });
    createResourceMock.mockResolvedValueOnce({
      resource: {
        id: "res_queue",
        organization_id: "org_123",
        app_id: "app_billing",
        project_id: "proj_payments",
        environment_id: "env_staging",
        name: "Payments Queue",
        resource_type: "queue",
        container_type: "environment",
        container_id: "env_staging",
        scope_type: "team",
        scope_id: "team_platform",
        description: "Async payment processing",
        metadata: {
          owner: "platform",
          rotation: "manual",
        },
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      apps: [
        {
          id: "app_billing",
          organization_id: "org_123",
          name: "Billing",
          description: "Customer billing",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      projects: [
        {
          id: "proj_payments",
          organization_id: "org_123",
          app_id: "app_billing",
          name: "Payments Core",
          description: "Core payment flows",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      environments: [
        {
          id: "env_staging",
          organization_id: "org_123",
          project_id: "proj_payments",
          name: "Staging",
          description: "Pre-production validation",
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
      resources: [
        {
          id: "res_queue",
          organization_id: "org_123",
          app_id: "app_billing",
          project_id: "proj_payments",
          environment_id: "env_staging",
          name: "Payments Queue",
          resource_type: "queue",
          container_type: "environment",
          container_id: "env_staging",
          scope_type: "team",
          scope_id: "team_platform",
          description: "Async payment processing",
          metadata: {
            owner: "platform",
            rotation: "manual",
          },
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Application name"), {
      target: { value: "Billing" },
    });
    fireEvent.change(screen.getByLabelText("Application description"), {
      target: { value: "Customer billing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create application$/i }));

    await waitFor(() => {
      expect(createAppMock).toHaveBeenCalledWith({
        name: "Billing",
        description: "Customer billing",
      });
    });
    expect(await screen.findByText(/application billing created successfully/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Application"), {
      target: { value: "app_billing" },
    });
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Payments Core" },
    });
    fireEvent.change(screen.getByLabelText("Project description"), {
      target: { value: "Core payment flows" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create project$/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        app_id: "app_billing",
        name: "Payments Core",
        description: "Core payment flows",
      });
    });
    expect(await screen.findByText(/project payments core created successfully/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "proj_payments" },
    });
    fireEvent.change(screen.getByLabelText("Environment name"), {
      target: { value: "Staging" },
    });
    fireEvent.change(screen.getByLabelText("Environment description"), {
      target: { value: "Pre-production validation" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create environment$/i }));

    await waitFor(() => {
      expect(createEnvironmentMock).toHaveBeenCalledWith({
        project_id: "proj_payments",
        name: "Staging",
        description: "Pre-production validation",
      });
    });
    expect(await screen.findByText(/environment staging created successfully/i)).toBeInTheDocument();

    const resourcesWorkspace = screen.getByRole("region", { name: /resources workspace/i });

    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource name"), {
      target: { value: "Payments Queue" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource type"), {
      target: { value: "queue" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Container type"), {
      target: { value: "environment" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Container target"), {
      target: { value: "env_staging" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope type"), {
      target: { value: "team" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope target"), {
      target: { value: "team_platform" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource description"), {
      target: { value: "Async payment processing" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Metadata summary"), {
      target: { value: "owner=platform\nrotation=manual" },
    });
    fireEvent.click(within(resourcesWorkspace).getByRole("button", { name: /^create resource$/i }));

    await waitFor(() => {
      expect(createResourceMock).toHaveBeenCalledWith({
        name: "Payments Queue",
        resource_type: "queue",
        container_type: "environment",
        container_id: "env_staging",
        scope_type: "team",
        scope_id: "team_platform",
        description: "Async payment processing",
        metadata: {
          owner: "platform",
          rotation: "manual",
        },
      });
    });
    expect(await screen.findByText(/resource payments queue created successfully/i)).toBeInTheDocument();
    const createdResourceHeading = await screen.findByRole("heading", { name: "Payments Queue" });
    const createdResourceCard = createdResourceHeading.closest("li");
    expect(createdResourceCard).not.toBeNull();
    expect(screen.getByText(/queue · environment · staging · team · platform engineering/i)).toBeInTheDocument();
    expect(within(createdResourceCard as HTMLElement).getByText(/owner=platform/i)).toBeInTheDocument();
    expect(within(createdResourceCard as HTMLElement).getByText(/rotation=manual/i)).toBeInTheDocument();
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

  it("surfaces audited resource failures in-place without losing the machine-readable code", async () => {
    queueAuthenticatedWorkspace();
    createResourceMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        503,
        "Audit logging is required for this operation.",
        "audit_unavailable",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Primary Postgres" })).toBeInTheDocument();

    const resourcesWorkspace = screen.getByRole("region", { name: /resources workspace/i });

    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource name"), {
      target: { value: "Primary Postgres" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource type"), {
      target: { value: "database" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Container type"), {
      target: { value: "environment" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Container target"), {
      target: { value: "env_prod" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope type"), {
      target: { value: "team" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope target"), {
      target: { value: "team_platform" },
    });
    fireEvent.click(within(resourcesWorkspace).getByRole("button", { name: /^create resource$/i }));

    await waitFor(() => {
      expect(createResourceMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Audit logging is required for this operation.")).toBeInTheDocument();
    expect(await screen.findByText("Failure code: audit_unavailable")).toBeInTheDocument();
  });

  it("surfaces project-not-found failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createEnvironmentMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        404,
        "Project was not found.",
        "project_not_found",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Production" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "proj_identity" },
    });
    fireEvent.change(screen.getByLabelText("Environment name"), {
      target: { value: "Disaster Recovery" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create environment$/i }));

    await waitFor(() => {
      expect(createEnvironmentMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Project was not found.")).toBeInTheDocument();
    expect(await screen.findByText("Failure code: project_not_found")).toBeInTheDocument();
  });

  it("surfaces resource scope mismatch failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createResourceMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        422,
        "Resource scope_type and scope_id do not match a valid catalog hierarchy.",
        "resource_scope_mismatch",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Primary Postgres" })).toBeInTheDocument();

    const resourcesWorkspace = screen.getByRole("region", { name: /resources workspace/i });

    fireEvent.change(within(resourcesWorkspace).getByLabelText("Resource name"), {
      target: { value: "Broken Resource" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope type"), {
      target: { value: "team" },
    });
    fireEvent.change(within(resourcesWorkspace).getByLabelText("Scope target"), {
      target: { value: "team_platform" },
    });
    fireEvent.click(within(resourcesWorkspace).getByRole("button", { name: /^create resource$/i }));

    await waitFor(() => {
      expect(createResourceMock).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText(
        "Resource scope_type and scope_id do not match a valid catalog hierarchy.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("Failure code: resource_scope_mismatch")).toBeInTheDocument();
  });

  it("surfaces resource secret-payload failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createResourceMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        422,
        "Resource metadata must stay descriptive and cannot store secret payloads.",
        "resource_secret_payload_forbidden",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByRole("heading", { name: "Primary Postgres" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Resource name"), {
      target: { value: "Unsafe Resource" },
    });
    fireEvent.change(screen.getByLabelText("Metadata summary"), {
      target: { value: "password=hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create resource$/i }));

    await waitFor(() => {
      expect(createResourceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { password: "hunter2" },
        }),
      );
    });

    expect(
      await screen.findByText(
        "Resource metadata must stay descriptive and cannot store secret payloads.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("Failure code: resource_secret_payload_forbidden")).toBeInTheDocument();
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
