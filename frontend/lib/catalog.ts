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

export type OrganizationUpdateResponse = {
  organization: Organization;
  audit_event_id: number;
  correlation_id: string;
};

export type CatalogUserMutationResponse = {
  catalog_user: CatalogUser;
};

export type CatalogWorkspaceData = {
  organization: Organization;
  users: CatalogUser[];
};

export type CatalogApiErrorCode =
  | "auth_unauthenticated"
  | "catalog_user_conflict"
  | "catalog_user_not_found"
  | "organization_update_audit_unavailable"
  | "validation_error"
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
    if (error.status === 401 && error.code === "auth_unauthenticated") {
      return {
        message: error.message,
        code: "auth_unauthenticated",
        kind: "auth",
        status: error.status,
      };
    }

    if (error.status === 409 && error.code === "catalog_user_conflict") {
      return {
        message: error.message,
        code: "catalog_user_conflict",
        kind: "conflict",
        status: error.status,
      };
    }

    if (error.status === 404 && error.code === "catalog_user_not_found") {
      return {
        message: error.message,
        code: "catalog_user_not_found",
        kind: "not_found",
        status: error.status,
      };
    }

    if (
      error.status === 503 &&
      error.code === "organization_update_audit_unavailable"
    ) {
      return {
        message: error.message,
        code: "organization_update_audit_unavailable",
        kind: "server",
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

export async function readCatalogWorkspace(): Promise<CatalogWorkspaceData> {
  const [organization, users] = await Promise.all([
    readOrganization(),
    listCatalogUsers(),
  ]);

  return {
    organization,
    users,
  };
}
