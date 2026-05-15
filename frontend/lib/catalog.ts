import {
  AuthApiRequestError,
  authenticatedJsonFetch,
} from "@/lib/auth";

export type Organization = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogUser = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Team = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ScopedRoleScopeType = "organization" | "team";

export type ScopedRole = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
  created_at: string;
  updated_at: string;
};

export type TeamMembership = {
  id: string;
  team_id: string;
  catalog_user_id: string;
  created_at: string;
};

export type DirectRoleAssignment = {
  id: string;
  scoped_role_id: string;
  catalog_user_id: string;
  created_at: string;
};

export type App = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  organization_id: string;
  app_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Environment = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ResourceType =
  | "database"
  | "bucket"
  | "queue"
  | "service_account"
  | "certificate"
  | "secret_ref";

export type ResourceContainerType = "app" | "project" | "environment";

export type Resource = {
  id: string;
  organization_id: string;
  app_id: string | null;
  project_id: string | null;
  environment_id: string | null;
  name: string;
  resource_type: ResourceType;
  container_type: ResourceContainerType;
  container_id: string;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
  description: string | null;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type CatalogUserRelationshipMembership = {
  membership: TeamMembership;
  team: Team;
};

export type CatalogUserRelationshipAssignment = {
  assignment: DirectRoleAssignment;
  scoped_role: ScopedRole;
};

export type CatalogUserRelationshipResource = {
  resource: Resource;
  app: App | null;
  project: Project | null;
  environment: Environment | null;
};

export type CatalogUserRelationship = {
  catalog_user: CatalogUser;
  memberships: CatalogUserRelationshipMembership[];
  assignments: CatalogUserRelationshipAssignment[];
  resources: CatalogUserRelationshipResource[];
};

export type CatalogUserRelationshipEnvelope = {
  item: CatalogUserRelationship;
};

export type OrganizationUpdateResponse = {
  organization: Organization;
  audit_event_id: number;
  correlation_id: string;
};

export type CatalogUserMutationResponse = {
  catalog_user: CatalogUser;
};

export type AuditedMutationMetadata = {
  audit_event_id: number;
  correlation_id: string;
};

export type TeamMutationResponse = {
  team: Team;
} & AuditedMutationMetadata;

export type ScopedRoleMutationResponse = {
  scoped_role: ScopedRole;
};

export type TeamMembershipMutationResponse = {
  membership: TeamMembership;
} & AuditedMutationMetadata;

export type DirectRoleAssignmentMutationResponse = {
  assignment: DirectRoleAssignment;
};

export type AppMutationResponse = {
  app: App;
};

export type ProjectMutationResponse = {
  project: Project;
};

export type EnvironmentMutationResponse = {
  environment: Environment;
};

export type ResourceMutationResponse = {
  resource: Resource;
} & AuditedMutationMetadata;

export type CatalogWorkspaceData = {
  organization: Organization;
  users: CatalogUser[];
  teams: Team[];
  scoped_roles: ScopedRole[];
  memberships: TeamMembership[];
  assignments: DirectRoleAssignment[];
  apps: App[];
  projects: Project[];
  environments: Environment[];
  resources: Resource[];
};

export type CatalogApiErrorCode =
  | "auth_unauthenticated"
  | "catalog_user_conflict"
  | "catalog_user_not_found"
  | "organization_update_audit_unavailable"
  | "audit_unavailable"
  | "validation_error"
  | "team_conflict"
  | "team_not_found"
  | "scoped_role_conflict"
  | "scoped_role_not_found"
  | "team_membership_conflict"
  | "direct_role_assignment_conflict"
  | "scoped_role_scope_mismatch"
  | "app_conflict"
  | "app_not_found"
  | "project_conflict"
  | "project_not_found"
  | "environment_conflict"
  | "environment_not_found"
  | "resource_conflict"
  | "resource_not_found"
  | "resource_scope_mismatch"
  | "resource_container_mismatch"
  | "resource_secret_payload_forbidden"
  | "unknown_catalog_error";

export type CatalogApiErrorKind =
  | "auth"
  | "validation"
  | "conflict"
  | "not_found"
  | "server"
  | "unknown";

export class CatalogApiError extends Error {
  status: number;

  code: CatalogApiErrorCode;

  kind: CatalogApiErrorKind;

  constructor({
    status,
    code,
    kind,
    message,
  }: {
    status: number;
    code: CatalogApiErrorCode;
    kind: CatalogApiErrorKind;
    message: string;
  }) {
    super(message);
    this.name = "CatalogApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

export type CatalogUserCreateInput = {
  email: string;
  full_name: string;
  job_title: string;
  is_active: boolean;
};

export type CatalogUserUpdateInput = {
  full_name: string;
  job_title: string;
  is_active: boolean;
};

export type TeamCreateInput = {
  name: string;
  description: string;
};

export type ScopedRoleCreateInput = {
  name: string;
  description: string;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
};

export type TeamMembershipCreateInput = {
  team_id: string;
  catalog_user_id: string;
};

export type DirectRoleAssignmentCreateInput = {
  scoped_role_id: string;
  catalog_user_id: string;
};

export type AppCreateInput = {
  name: string;
  description: string;
};

export type ProjectCreateInput = {
  app_id: string;
  name: string;
  description: string;
};

export type EnvironmentCreateInput = {
  project_id: string;
  name: string;
  description: string;
};

export type ResourceCreateInput = {
  name: string;
  resource_type: ResourceType;
  container_type: ResourceContainerType;
  container_id: string;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
  description: string;
  metadata: Record<string, string>;
};

export type DecodedCatalogError = {
  message: string;
  code: CatalogApiErrorCode;
  kind: CatalogApiErrorKind;
  status: number;
};

const DEFAULT_ERROR_MESSAGE = "The catalog request failed.";

function normalizeCatalogError(error: unknown): CatalogApiError {
  if (error instanceof CatalogApiError) {
    return error;
  }

  if (error instanceof AuthApiRequestError) {
    const decoded = decodeCatalogError(error);
    return new CatalogApiError({
      status: error.status,
      code: decoded.code,
      kind: decoded.kind,
      message: decoded.message,
    });
  }

  if (error instanceof Error) {
    return new CatalogApiError({
      status: 0,
      code: "unknown_catalog_error",
      kind: "unknown",
      message: error.message || DEFAULT_ERROR_MESSAGE,
    });
  }

  return new CatalogApiError({
    status: 0,
    code: "unknown_catalog_error",
    kind: "unknown",
    message: DEFAULT_ERROR_MESSAGE,
  });
}

export function decodeCatalogError(error: unknown): DecodedCatalogError {
  if (error instanceof CatalogApiError) {
    return {
      message: error.message,
      code: error.code,
      kind: error.kind,
      status: error.status,
    };
  }

  if (error instanceof AuthApiRequestError) {
    const conflictCodes: CatalogApiErrorCode[] = [
      "catalog_user_conflict",
      "team_conflict",
      "scoped_role_conflict",
      "team_membership_conflict",
      "direct_role_assignment_conflict",
      "app_conflict",
      "project_conflict",
      "environment_conflict",
      "resource_conflict",
    ];
    const notFoundCodes: CatalogApiErrorCode[] = [
      "catalog_user_not_found",
      "team_not_found",
      "scoped_role_not_found",
      "app_not_found",
      "project_not_found",
      "environment_not_found",
      "resource_not_found",
    ];
    const validationCodes: CatalogApiErrorCode[] = [
      "scoped_role_scope_mismatch",
      "resource_scope_mismatch",
      "resource_container_mismatch",
      "resource_secret_payload_forbidden",
    ];

    if (error.status === 401 && error.code === "auth_unauthenticated") {
      return {
        message: error.message,
        code: "auth_unauthenticated",
        kind: "auth",
        status: error.status,
      };
    }

    if (error.status === 503) {
      if (error.code === "organization_update_audit_unavailable") {
        return {
          message: error.message,
          code: "organization_update_audit_unavailable",
          kind: "server",
          status: error.status,
        };
      }

      if (error.code === "audit_unavailable") {
        return {
          message: error.message,
          code: "audit_unavailable",
          kind: "server",
          status: error.status,
        };
      }
    }

    if (error.status === 409 && conflictCodes.includes(error.code as CatalogApiErrorCode)) {
      return {
        message: error.message,
        code: error.code as CatalogApiErrorCode,
        kind: "conflict",
        status: error.status,
      };
    }

    if (error.status === 404 && notFoundCodes.includes(error.code as CatalogApiErrorCode)) {
      return {
        message: error.message,
        code: error.code as CatalogApiErrorCode,
        kind: "not_found",
        status: error.status,
      };
    }

    if (
      error.status === 422 &&
      validationCodes.includes(error.code as CatalogApiErrorCode)
    ) {
      return {
        message: error.message,
        code: error.code as CatalogApiErrorCode,
        kind: "validation",
        status: error.status,
      };
    }

    if (error.status === 422) {
      return {
        message: error.message,
        code: "validation_error",
        kind: "validation",
        status: error.status,
      };
    }

    if (error.status >= 500) {
      return {
        message: error.message,
        code: "unknown_catalog_error",
        kind: "server",
        status: error.status,
      };
    }

    return {
      message: error.message,
      code: "unknown_catalog_error",
      kind: "unknown",
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || DEFAULT_ERROR_MESSAGE,
      code: "unknown_catalog_error",
      kind: "unknown",
      status: 0,
    };
  }

  return {
    message: DEFAULT_ERROR_MESSAGE,
    code: "unknown_catalog_error",
    kind: "unknown",
    status: 0,
  };
}

async function catalogJsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await authenticatedJsonFetch<T>(path, init);
  } catch (error) {
    throw normalizeCatalogError(error);
  }
}

export async function readOrganization(): Promise<Organization> {
  return catalogJsonFetch<Organization>("/catalog/organization", {
    method: "GET",
    cache: "no-store",
  });
}

export async function updateOrganization(payload: {
  display_name: string;
  description: string;
}): Promise<OrganizationUpdateResponse> {
  return catalogJsonFetch<OrganizationUpdateResponse>("/catalog/organization", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listCatalogUsers(): Promise<CatalogUser[]> {
  const response = await catalogJsonFetch<{ items: CatalogUser[] }>("/catalog/users", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createCatalogUser(
  payload: CatalogUserCreateInput,
): Promise<CatalogUserMutationResponse> {
  return catalogJsonFetch<CatalogUserMutationResponse>("/catalog/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCatalogUser(
  catalogUserId: string,
  payload: CatalogUserUpdateInput,
): Promise<CatalogUserMutationResponse> {
  return catalogJsonFetch<CatalogUserMutationResponse>(
    `/catalog/users/${catalogUserId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function readCatalogUserRelationship(
  catalogUserId: string,
): Promise<CatalogUserRelationship> {
  const response = await catalogJsonFetch<CatalogUserRelationshipEnvelope>(
    `/catalog/users/${catalogUserId}/relationship`,
    {
      method: "GET",
      cache: "no-store",
    },
  );
  return response.item;
}

export async function listTeams(): Promise<Team[]> {
  const response = await catalogJsonFetch<{ items: Team[] }>("/catalog/teams", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createTeam(
  payload: TeamCreateInput,
): Promise<TeamMutationResponse> {
  return catalogJsonFetch<TeamMutationResponse>("/catalog/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listScopedRoles(): Promise<ScopedRole[]> {
  const response = await catalogJsonFetch<{ items: ScopedRole[] }>("/catalog/roles", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createScopedRole(
  payload: ScopedRoleCreateInput,
): Promise<ScopedRoleMutationResponse> {
  return catalogJsonFetch<ScopedRoleMutationResponse>("/catalog/roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listMemberships(): Promise<TeamMembership[]> {
  const response = await catalogJsonFetch<{ items: TeamMembership[] }>(
    "/catalog/memberships",
    {
      method: "GET",
      cache: "no-store",
    },
  );
  return response.items;
}

export async function createMembership(
  payload: TeamMembershipCreateInput,
): Promise<TeamMembershipMutationResponse> {
  return catalogJsonFetch<TeamMembershipMutationResponse>("/catalog/memberships", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAssignments(): Promise<DirectRoleAssignment[]> {
  const response = await catalogJsonFetch<{ items: DirectRoleAssignment[] }>(
    "/catalog/assignments",
    {
      method: "GET",
      cache: "no-store",
    },
  );
  return response.items;
}

export async function createAssignment(
  payload: DirectRoleAssignmentCreateInput,
): Promise<DirectRoleAssignmentMutationResponse> {
  return catalogJsonFetch<DirectRoleAssignmentMutationResponse>("/catalog/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listApps(): Promise<App[]> {
  const response = await catalogJsonFetch<{ items: App[] }>("/catalog/apps", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createApp(payload: AppCreateInput): Promise<AppMutationResponse> {
  return catalogJsonFetch<AppMutationResponse>("/catalog/apps", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listProjects(): Promise<Project[]> {
  const response = await catalogJsonFetch<{ items: Project[] }>("/catalog/projects", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createProject(
  payload: ProjectCreateInput,
): Promise<ProjectMutationResponse> {
  return catalogJsonFetch<ProjectMutationResponse>("/catalog/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listEnvironments(): Promise<Environment[]> {
  const response = await catalogJsonFetch<{ items: Environment[] }>("/catalog/environments", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createEnvironment(
  payload: EnvironmentCreateInput,
): Promise<EnvironmentMutationResponse> {
  return catalogJsonFetch<EnvironmentMutationResponse>("/catalog/environments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listResources(): Promise<Resource[]> {
  const response = await catalogJsonFetch<{ items: Resource[] }>("/catalog/resources", {
    method: "GET",
    cache: "no-store",
  });
  return response.items;
}

export async function createResource(
  payload: ResourceCreateInput,
): Promise<ResourceMutationResponse> {
  return catalogJsonFetch<ResourceMutationResponse>("/catalog/resources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readCatalogWorkspace(): Promise<CatalogWorkspaceData> {
  const [
    organization,
    users,
    teams,
    scoped_roles,
    memberships,
    assignments,
    apps,
    projects,
    environments,
    resources,
  ] = await Promise.all([
    readOrganization(),
    listCatalogUsers(),
    listTeams(),
    listScopedRoles(),
    listMemberships(),
    listAssignments(),
    listApps(),
    listProjects(),
    listEnvironments(),
    listResources(),
  ]);

  return {
    organization,
    users,
    teams,
    scoped_roles,
    memberships,
    assignments,
    apps,
    projects,
    environments,
    resources,
  };
}
