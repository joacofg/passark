"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AuthApiRequestError,
  login,
  logout,
  type AuthenticatedUser,
  isUnauthenticatedError,
  readProtectedWhoAmI,
} from "@/lib/auth";
import {
  type App,
  type AppCreateInput,
  type CatalogUser,
  type CatalogUserCreateInput,
  type CatalogUserUpdateInput,
  type CatalogWorkspaceData,
  type DirectRoleAssignment,
  type Environment,
  type EnvironmentCreateInput,
  type Project,
  type ProjectCreateInput,
  type Resource,
  type ResourceContainerType,
  type ResourceCreateInput,
  type ResourceType,
  type ScopedRole,
  type ScopedRoleCreateInput,
  type ScopedRoleScopeType,
  type Team,
  type TeamCreateInput,
  type TeamMembership,
  createApp,
  createAssignment,
  createCatalogUser,
  createEnvironment,
  createMembership,
  createProject,
  createResource,
  createScopedRole,
  createTeam,
  decodeCatalogError,
  readCatalogWorkspace,
  updateCatalogUser,
  updateOrganization,
} from "@/lib/catalog";

const DEFAULT_ERROR_MESSAGE = "Unable to sign in with the provided credentials.";
const DEFAULT_WORKSPACE_ERROR_MESSAGE =
  "Unable to load the operator catalog workspace right now.";
const DEFAULT_MUTATION_ERROR_MESSAGE =
  "Unable to save the catalog change right now.";
const RESOURCE_TYPE_OPTIONS: ResourceType[] = [
  "database",
  "bucket",
  "queue",
  "service_account",
  "certificate",
  "secret_ref",
];

const RESOURCE_SCOPE_OPTIONS: ScopedRoleScopeType[] = ["organization", "team"];

const RESOURCE_CONTAINER_OPTIONS: ResourceContainerType[] = [
  "app",
  "project",
  "environment",
];

type OperatorIdentityState =
  | { status: "loading" }
  | { status: "authenticated"; payload: { user: AuthenticatedUser; session_id: number } }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

type WorkspaceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CatalogWorkspaceData }
  | { status: "error"; message: string; code?: string };

type MutationNotice =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string; code?: string }
  | null;

type OrganizationFormState = {
  display_name: string;
  description: string;
};

type CatalogUserFormState = {
  email: string;
  full_name: string;
  job_title: string;
  is_active: boolean;
};

type TeamFormState = {
  name: string;
  description: string;
};

type ScopedRoleFormState = {
  name: string;
  description: string;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
};

type MembershipFormState = {
  team_id: string;
  catalog_user_id: string;
};

type AssignmentFormState = {
  scoped_role_id: string;
  catalog_user_id: string;
};

type AppFormState = {
  name: string;
  description: string;
};

type ProjectFormState = {
  app_id: string;
  name: string;
  description: string;
};

type EnvironmentFormState = {
  project_id: string;
  name: string;
  description: string;
};

type ResourceFormState = {
  name: string;
  resource_type: ResourceType;
  container_type: ResourceContainerType;
  container_id: string;
  scope_type: ScopedRoleScopeType;
  scope_id: string;
  description: string;
  metadata_summary: string;
};

type CatalogUserFormMode =
  | { mode: "create" }
  | { mode: "edit"; catalogUserId: string };

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@passark.local");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ email, password });
      router.push("/operator");
      router.refresh();
    } catch (error) {
      if (error instanceof AuthApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(DEFAULT_ERROR_MESSAGE);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Backend-owned sign-in</p>
      <h1>Authenticate with the local bootstrap operator.</h1>
      <p className="lede auth-page__lede">
        Credentials are verified by the backend and stored in an HTTP-only
        session cookie. Frontend state alone cannot unlock the operator shell.
      </p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            autoComplete="username"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button className="button button--primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}

function formatCatalogError(error: unknown, fallbackMessage: string): MutationNotice {
  const decoded = decodeCatalogError(error);

  return {
    tone: "error",
    message: decoded.message || fallbackMessage,
    code: decoded.code,
  };
}

function deriveWorkspaceError(error: unknown): { message: string; code?: string } {
  const decoded = decodeCatalogError(error);
  return {
    message: decoded.message || DEFAULT_WORKSPACE_ERROR_MESSAGE,
    code: decoded.code !== "unknown_catalog_error" ? decoded.code : undefined,
  };
}

function emptyOrganizationForm(data: CatalogWorkspaceData): OrganizationFormState {
  return {
    display_name: data.organization.display_name,
    description: data.organization.description ?? "",
  };
}

function emptyUserForm(): CatalogUserFormState {
  return {
    email: "",
    full_name: "",
    job_title: "",
    is_active: true,
  };
}

function emptyTeamForm(): TeamFormState {
  return {
    name: "",
    description: "",
  };
}

function emptyRoleForm(organizationId = ""): ScopedRoleFormState {
  return {
    name: "",
    description: "",
    scope_type: "organization",
    scope_id: organizationId,
  };
}

function emptyMembershipForm(): MembershipFormState {
  return {
    team_id: "",
    catalog_user_id: "",
  };
}

function emptyAssignmentForm(): AssignmentFormState {
  return {
    scoped_role_id: "",
    catalog_user_id: "",
  };
}

function emptyAppForm(): AppFormState {
  return {
    name: "",
    description: "",
  };
}

function emptyProjectForm(appId = ""): ProjectFormState {
  return {
    app_id: appId,
    name: "",
    description: "",
  };
}

function emptyEnvironmentForm(projectId = ""): EnvironmentFormState {
  return {
    project_id: projectId,
    name: "",
    description: "",
  };
}

function emptyResourceForm(organizationId = ""): ResourceFormState {
  return {
    name: "",
    resource_type: "database",
    container_type: "app",
    container_id: "",
    scope_type: "organization",
    scope_id: organizationId,
    description: "",
    metadata_summary: "owner=platform\nrotation=manual",
  };
}

function userFormFromCatalogUser(user: CatalogUser): CatalogUserFormState {
  return {
    email: user.email,
    full_name: user.full_name,
    job_title: user.job_title ?? "",
    is_active: user.is_active,
  };
}

function parseMetadataSummary(summary: string): Record<string, string> {
  const entries = summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return [line, ""] as const;
      }
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const;
    });

  return Object.fromEntries(entries);
}

function formatMetadataSummary(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function resolveScopeLabel(role: ScopedRole, teams: Team[]): string {
  if (role.scope_type === "organization") {
    return "Organization";
  }

  const team = teams.find((candidate) => candidate.id === role.scope_id);
  return team ? `Team · ${team.name}` : `Team · ${role.scope_id}`;
}

function countMemberships(teamId: string, memberships: TeamMembership[]): number {
  return memberships.filter((membership) => membership.team_id === teamId).length;
}

function countAssignments(roleId: string, assignments: DirectRoleAssignment[]): number {
  return assignments.filter((assignment) => assignment.scoped_role_id === roleId).length;
}

function resolveUserName(userId: string, users: CatalogUser[]): string {
  return users.find((user) => user.id === userId)?.full_name ?? userId;
}

function resolveTeamName(teamId: string, teams: Team[]): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function resolveRoleName(roleId: string, roles: ScopedRole[]): string {
  return roles.find((role) => role.id === roleId)?.name ?? roleId;
}

function resolveAppName(appId: string, apps: App[]): string {
  return apps.find((app) => app.id === appId)?.name ?? appId;
}

function resolveProjectName(projectId: string, projects: Project[]): string {
  return projects.find((project) => project.id === projectId)?.name ?? projectId;
}

function resolveEnvironmentName(environmentId: string, environments: Environment[]): string {
  return environments.find((environment) => environment.id === environmentId)?.name ?? environmentId;
}

function resolveResourceContainerLabel(
  resource: Resource,
  apps: App[],
  projects: Project[],
  environments: Environment[],
): string {
  if (resource.container_type === "app") {
    return `App · ${resolveAppName(resource.container_id, apps)}`;
  }
  if (resource.container_type === "project") {
    return `Project · ${resolveProjectName(resource.container_id, projects)}`;
  }
  return `Environment · ${resolveEnvironmentName(resource.container_id, environments)}`;
}

function resolveResourceScopeLabel(resource: Resource, organizationId: string, teams: Team[]): string {
  if (resource.scope_type === "organization" && resource.scope_id === organizationId) {
    return "Organization";
  }
  return `Team · ${resolveTeamName(resource.scope_id, teams)}`;
}

function OrganizationPanel({
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  form: OrganizationFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: OrganizationFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Organization root">
      <div>
        <p className="eyebrow">Single-company root</p>
        <h2>Organization record</h2>
        <p className="workspace-copy">
          Update the explicit deployment root that downstream catalog slices will
          reference. Audit persistence remains mandatory for this write path.
        </p>
      </div>

      <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
        <label className="field">
          <span>Display name</span>
          <input
            name="display_name"
            onChange={(event) =>
              onChange({ ...form, display_name: event.target.value })
            }
            required
            value={form.display_name}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            className="field-textarea"
            name="description"
            onChange={(event) =>
              onChange({ ...form, description: event.target.value })
            }
            rows={4}
            value={form.description}
          />
        </label>

        <div className="workspace-form__actions">
          <button className="button button--primary" disabled={isSaving} type="submit">
            {isSaving ? "Saving organization…" : "Save organization"}
          </button>
        </div>

        <NoticeBlock notice={notice} />
      </form>
    </section>
  );
}

function OperatorIdentitySummary({
  user,
  sessionId,
}: {
  user: AuthenticatedUser;
  sessionId: number;
}) {
  return (
    <section className="status-grid" aria-label="Protected operator details">
      <article className="status-card">
        <h2>Authenticated user</h2>
        <p>{user.email}</p>
        <span>User ID {user.id}</span>
      </article>
      <article className="status-card">
        <h2>Session record</h2>
        <p>Session #{sessionId}</p>
        <span>Resolved from the backend protected endpoint.</span>
      </article>
      <article className="status-card">
        <h2>Account state</h2>
        <p>{user.is_active ? "Active" : "Inactive"}</p>
        <span>Protected catalog reads only render after session validation succeeds.</span>
      </article>
    </section>
  );
}

function NoticeBlock({ notice }: { notice: MutationNotice }) {
  if (!notice) {
    return null;
  }

  return (
    <div
      className={
        notice.tone === "success"
          ? "inline-notice inline-notice--success"
          : "inline-notice inline-notice--error"
      }
      role={notice.tone === "success" ? "status" : "alert"}
    >
      <p>{notice.message}</p>
      {notice.tone === "error" && notice.code ? <p>Failure code: {notice.code}</p> : null}
    </div>
  );
}

function CatalogUsersPanel({
  users,
  mode,
  form,
  isSaving,
  notice,
  onStartCreate,
  onStartEdit,
  onCancel,
  onChange,
  onSubmit,
}: {
  users: CatalogUser[];
  mode: CatalogUserFormMode;
  form: CatalogUserFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onStartCreate: () => void;
  onStartEdit: (user: CatalogUser) => void;
  onCancel: () => void;
  onChange: (next: CatalogUserFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const activeEditUserId = mode.mode === "edit" ? mode.catalogUserId : null;

  return (
    <section className="workspace-card" aria-label="Catalog users workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Catalog-grade identities</p>
          <h2>Catalog users</h2>
          <p className="workspace-copy">
            Manage operator-facing people records beyond the bootstrap auth identity.
            Validation, conflict, and auth-expiry errors stay visible in-place.
          </p>
        </div>
        <button className="button button--secondary" onClick={onStartCreate} type="button">
          Create catalog user
        </button>
      </div>

      <div className="catalog-layout">
        <div>
          {users.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No catalog users yet</h3>
              <p>Create the first managed user record for this organization.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Catalog users list">
              {users.map((user) => {
                const isEditing = activeEditUserId === user.id;
                return (
                  <li className="catalog-user-item" key={user.id}>
                    <div>
                      <h3>{user.full_name}</h3>
                      <p>{user.email}</p>
                      <span>
                        {user.job_title ? `${user.job_title} · ` : ""}
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <button
                      className="button button--secondary"
                      onClick={() => onStartEdit(user)}
                      type="button"
                    >
                      {isEditing ? "Editing" : `Edit ${user.full_name}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <div className="workspace-form__title-row">
            <h3>{mode.mode === "create" ? "Create catalog user" : "Edit catalog user"}</h3>
            {mode.mode === "edit" ? (
              <button className="link-button" onClick={onCancel} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>

          <label className="field">
            <span>Email</span>
            <input
              disabled={mode.mode === "edit"}
              name="email"
              onChange={(event) => onChange({ ...form, email: event.target.value })}
              required
              type="email"
              value={form.email}
            />
          </label>

          <label className="field">
            <span>Full name</span>
            <input
              name="full_name"
              onChange={(event) => onChange({ ...form, full_name: event.target.value })}
              required
              value={form.full_name}
            />
          </label>

          <label className="field">
            <span>Job title</span>
            <input
              name="job_title"
              onChange={(event) => onChange({ ...form, job_title: event.target.value })}
              value={form.job_title}
            />
          </label>

          <label className="checkbox-field">
            <input
              checked={form.is_active}
              name="is_active"
              onChange={(event) => onChange({ ...form, is_active: event.target.checked })}
              type="checkbox"
            />
            <span>Catalog user is active</span>
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving
                ? mode.mode === "create"
                  ? "Creating user…"
                  : "Saving user…"
                : mode.mode === "create"
                  ? "Create user"
                  : "Save user"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function TeamsPanel({
  teams,
  memberships,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  teams: Team[];
  memberships: TeamMembership[];
  form: TeamFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: TeamFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Teams workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Container catalog</p>
          <h2>Teams</h2>
          <p className="workspace-copy">
            Create team containers that memberships and team-scoped roles can target.
            Duplicate names stay visible with stable machine-readable conflict codes.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {teams.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No teams yet</h3>
              <p>Create the first team container for scoped access relationships.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Teams list">
              {teams.map((team) => (
                <li className="catalog-user-item" key={team.id}>
                  <div>
                    <h3>{team.name}</h3>
                    <p>{team.description ?? "No description"}</p>
                    <span>{countMemberships(team.id, memberships)} memberships</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create team</h3>

          <label className="field">
            <span>Team name</span>
            <input
              name="team_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Team description</span>
            <textarea
              className="field-textarea"
              name="team_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Creating team…" : "Create team"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function RolesPanel({
  roles,
  teams,
  assignments,
  organizationId,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  roles: ScopedRole[];
  teams: Team[];
  assignments: DirectRoleAssignment[];
  organizationId: string;
  form: ScopedRoleFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: ScopedRoleFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const availableScopeId = form.scope_type === "organization" ? organizationId : form.scope_id;

  return (
    <section className="workspace-card" aria-label="Scoped roles workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Role catalog</p>
          <h2>Scoped roles</h2>
          <p className="workspace-copy">
            Define organization and team-scoped roles against real catalog containers.
            Invalid scope/container combinations preserve the backend failure code inline.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {roles.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No scoped roles yet</h3>
              <p>Create a role before assigning direct role relationships.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Scoped roles list">
              {roles.map((role) => (
                <li className="catalog-user-item" key={role.id}>
                  <div>
                    <h3>{role.name}</h3>
                    <p>{role.description ?? "No description"}</p>
                    <span>
                      {resolveScopeLabel(role, teams)} · {countAssignments(role.id, assignments)} assignments
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create scoped role</h3>

          <label className="field">
            <span>Role name</span>
            <input
              name="role_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Role description</span>
            <textarea
              className="field-textarea"
              name="role_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <label className="field">
            <span>Scope type</span>
            <select
              name="scope_type"
              onChange={(event) =>
                onChange({
                  ...form,
                  scope_type: event.target.value as ScopedRoleScopeType,
                  scope_id: event.target.value === "organization" ? organizationId : "",
                })
              }
              value={form.scope_type}
            >
              <option value="organization">Organization</option>
              <option value="team">Team</option>
            </select>
          </label>

          <label className="field">
            <span>Scope target</span>
            {form.scope_type === "organization" ? (
              <input disabled name="scope_id" value={availableScopeId} />
            ) : (
              <select
                name="scope_id"
                onChange={(event) => onChange({ ...form, scope_id: event.target.value })}
                required
                value={form.scope_id}
              >
                <option value="">Select a team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Creating role…" : "Create role"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function MembershipsPanel({
  memberships,
  teams,
  users,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  memberships: TeamMembership[];
  teams: Team[];
  users: CatalogUser[];
  form: MembershipFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: MembershipFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Memberships workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Relationship graph</p>
          <h2>Team memberships</h2>
          <p className="workspace-copy">
            Attach catalog users to teams through the protected API seam. Duplicate edges,
            missing teams, and missing users remain diagnosable in-place.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {memberships.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No team memberships yet</h3>
              <p>Create a team membership to link a catalog user to a container.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Team memberships list">
              {memberships.map((membership) => (
                <li className="catalog-user-item" key={membership.id}>
                  <div>
                    <h3>{resolveUserName(membership.catalog_user_id, users)}</h3>
                    <p>{resolveTeamName(membership.team_id, teams)}</p>
                    <span>Membership ID {membership.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create team membership</h3>

          <label className="field">
            <span>Team</span>
            <select
              name="membership_team_id"
              onChange={(event) => onChange({ ...form, team_id: event.target.value })}
              required
              value={form.team_id}
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Catalog user</span>
            <select
              name="membership_catalog_user_id"
              onChange={(event) => onChange({ ...form, catalog_user_id: event.target.value })}
              required
              value={form.catalog_user_id}
            >
              <option value="">Select a catalog user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Creating membership…" : "Create membership"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function AssignmentsPanel({
  assignments,
  roles,
  users,
  teams,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  assignments: DirectRoleAssignment[];
  roles: ScopedRole[];
  users: CatalogUser[];
  teams: Team[];
  form: AssignmentFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: AssignmentFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Assignments workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Role relationships</p>
          <h2>Direct role assignments</h2>
          <p className="workspace-copy">
            Assign scoped roles directly to catalog users without leaking into approval or
            grant lifecycle behavior. Duplicate edges and missing references stay explicit.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {assignments.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No direct role assignments yet</h3>
              <p>Create an assignment after defining a scoped role and target catalog user.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Direct role assignments list">
              {assignments.map((assignment) => {
                const role = roles.find((candidate) => candidate.id === assignment.scoped_role_id);
                return (
                  <li className="catalog-user-item" key={assignment.id}>
                    <div>
                      <h3>{resolveUserName(assignment.catalog_user_id, users)}</h3>
                      <p>{resolveRoleName(assignment.scoped_role_id, roles)}</p>
                      <span>
                        {role ? resolveScopeLabel(role, teams) : assignment.scoped_role_id} · Assignment ID {assignment.id}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create direct role assignment</h3>

          <label className="field">
            <span>Scoped role</span>
            <select
              name="assignment_scoped_role_id"
              onChange={(event) => onChange({ ...form, scoped_role_id: event.target.value })}
              required
              value={form.scoped_role_id}
            >
              <option value="">Select a scoped role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({resolveScopeLabel(role, teams)})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Catalog user</span>
            <select
              name="assignment_catalog_user_id"
              onChange={(event) => onChange({ ...form, catalog_user_id: event.target.value })}
              required
              value={form.catalog_user_id}
            >
              <option value="">Select a catalog user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Creating assignment…" : "Create assignment"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function AppsPanel({
  apps,
  projects,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  apps: App[];
  projects: Project[];
  form: AppFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: AppFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Applications workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Application catalog</p>
          <h2>Applications</h2>
          <p className="workspace-copy">
            Register top-level application records that anchor projects, environments, and typed resources.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {apps.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No applications yet</h3>
              <p>Create the first application root for the operator-visible hierarchy.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Applications list">
              {apps.map((app) => (
                <li className="catalog-user-item" key={app.id}>
                  <div>
                    <h3>{app.name}</h3>
                    <p>{app.description ?? "No description"}</p>
                    <span>
                      {projects.filter((project) => project.app_id === app.id).length} projects
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create application</h3>

          <label className="field">
            <span>Application name</span>
            <input
              name="app_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Application description</span>
            <textarea
              className="field-textarea"
              name="app_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Creating application…" : "Create application"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function ProjectsPanel({
  apps,
  projects,
  environments,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  apps: App[];
  projects: Project[];
  environments: Environment[];
  form: ProjectFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: ProjectFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Projects workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Hierarchy middle tier</p>
          <h2>Projects</h2>
          <p className="workspace-copy">
            Create projects only under real applications so environment and resource creation stay properly scoped.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {projects.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No projects yet</h3>
              <p>Create an application first, then add its projects here.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Projects list">
              {projects.map((project) => (
                <li className="catalog-user-item" key={project.id}>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.description ?? "No description"}</p>
                    <span>
                      {resolveAppName(project.app_id, apps)} · {environments.filter((environment) => environment.project_id === project.id).length} environments
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create project</h3>

          <label className="field">
            <span>Application</span>
            <select
              name="project_app_id"
              onChange={(event) => onChange({ ...form, app_id: event.target.value })}
              required
              value={form.app_id}
            >
              <option value="">Select an application</option>
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Project name</span>
            <input
              name="project_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Project description</span>
            <textarea
              className="field-textarea"
              name="project_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving || apps.length === 0} type="submit">
              {isSaving ? "Creating project…" : "Create project"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function EnvironmentsPanel({
  projects,
  environments,
  resources,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  projects: Project[];
  environments: Environment[];
  resources: Resource[];
  form: EnvironmentFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: EnvironmentFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="workspace-card" aria-label="Environments workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Deployment scopes</p>
          <h2>Environments</h2>
          <p className="workspace-copy">
            Create environments under real projects so typed resources can link to a valid deployment container.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {environments.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No environments yet</h3>
              <p>Create a project first, then add environments here.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Environments list">
              {environments.map((environment) => (
                <li className="catalog-user-item" key={environment.id}>
                  <div>
                    <h3>{environment.name}</h3>
                    <p>{environment.description ?? "No description"}</p>
                    <span>
                      {resolveProjectName(environment.project_id, projects)} · {resources.filter((resource) => resource.environment_id === environment.id).length} resources
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create environment</h3>

          <label className="field">
            <span>Project</span>
            <select
              name="environment_project_id"
              onChange={(event) => onChange({ ...form, project_id: event.target.value })}
              required
              value={form.project_id}
            >
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Environment name</span>
            <input
              name="environment_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Environment description</span>
            <textarea
              className="field-textarea"
              name="environment_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <div className="workspace-form__actions">
            <button className="button button--primary" disabled={isSaving || projects.length === 0} type="submit">
              {isSaving ? "Creating environment…" : "Create environment"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

function ResourcesPanel({
  organizationId,
  teams,
  apps,
  projects,
  environments,
  resources,
  form,
  isSaving,
  notice,
  onChange,
  onSubmit,
}: {
  organizationId: string;
  teams: Team[];
  apps: App[];
  projects: Project[];
  environments: Environment[];
  resources: Resource[];
  form: ResourceFormState;
  isSaving: boolean;
  notice: MutationNotice;
  onChange: (next: ResourceFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const containerOptions =
    form.container_type === "app"
      ? apps.map((app) => ({ value: app.id, label: app.name }))
      : form.container_type === "project"
        ? projects.map((project) => ({ value: project.id, label: project.name }))
        : environments.map((environment) => ({ value: environment.id, label: environment.name }));

  const scopeOptions =
    form.scope_type === "organization"
      ? [{ value: organizationId, label: "Organization root" }]
      : teams.map((team) => ({ value: team.id, label: team.name }));

  return (
    <section className="workspace-card" aria-label="Resources workspace">
      <div className="workspace-card__header">
        <div>
          <p className="eyebrow">Typed sensitive metadata</p>
          <h2>Resources</h2>
          <p className="workspace-copy">
            Register descriptive typed resource metadata linked to the catalog graph without storing secret payloads.
          </p>
        </div>
      </div>

      <div className="catalog-layout">
        <div>
          {resources.length === 0 ? (
            <div className="empty-state" role="status">
              <h3>No resources yet</h3>
              <p>Create an app, project, or environment first, then attach typed metadata here.</p>
            </div>
          ) : (
            <ul className="catalog-user-list" aria-label="Resources list">
              {resources.map((resource) => (
                <li className="catalog-user-item" key={resource.id}>
                  <div>
                    <h3>{resource.name}</h3>
                    <p>{resource.description ?? "No description"}</p>
                    <span>
                      {resource.resource_type} · {resolveResourceContainerLabel(resource, apps, projects, environments)} · {resolveResourceScopeLabel(resource, organizationId, teams)}
                    </span>
                    <small>{formatMetadataSummary(resource.metadata)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="workspace-form" onSubmit={(event) => void onSubmit(event)}>
          <h3>Create resource</h3>

          <label className="field">
            <span>Resource name</span>
            <input
              name="resource_name"
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>

          <label className="field">
            <span>Resource type</span>
            <select
              name="resource_type"
              onChange={(event) => onChange({ ...form, resource_type: event.target.value as ResourceType })}
              value={form.resource_type}
            >
              {RESOURCE_TYPE_OPTIONS.map((resourceType) => (
                <option key={resourceType} value={resourceType}>
                  {resourceType}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Container type</span>
            <select
              name="container_type"
              onChange={(event) =>
                onChange({
                  ...form,
                  container_type: event.target.value as ResourceContainerType,
                  container_id: "",
                })
              }
              value={form.container_type}
            >
              {RESOURCE_CONTAINER_OPTIONS.map((containerType) => (
                <option key={containerType} value={containerType}>
                  {containerType}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Container target</span>
            <select
              name="container_id"
              onChange={(event) => onChange({ ...form, container_id: event.target.value })}
              required
              value={form.container_id}
            >
              <option value="">Select a {form.container_type}</option>
              {containerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Scope type</span>
            <select
              name="resource_scope_type"
              onChange={(event) =>
                onChange({
                  ...form,
                  scope_type: event.target.value as ScopedRoleScopeType,
                  scope_id: event.target.value === "organization" ? organizationId : "",
                })
              }
              value={form.scope_type}
            >
              {RESOURCE_SCOPE_OPTIONS.map((scopeType) => (
                <option key={scopeType} value={scopeType}>
                  {scopeType}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Scope target</span>
            <select
              name="resource_scope_id"
              onChange={(event) => onChange({ ...form, scope_id: event.target.value })}
              required
              value={form.scope_id}
            >
              {scopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Resource description</span>
            <textarea
              className="field-textarea"
              name="resource_description"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
              rows={3}
              value={form.description}
            />
          </label>

          <label className="field">
            <span>Metadata summary</span>
            <textarea
              className="field-textarea"
              name="metadata_summary"
              onChange={(event) => onChange({ ...form, metadata_summary: event.target.value })}
              rows={4}
              value={form.metadata_summary}
            />
          </label>

          <div className="workspace-form__actions">
            <button
              className="button button--primary"
              disabled={isSaving || containerOptions.length === 0 || scopeOptions.length === 0}
              type="submit"
            >
              {isSaving ? "Creating resource…" : "Create resource"}
            </button>
          </div>

          <NoticeBlock notice={notice} />
        </form>
      </div>
    </section>
  );
}

export function OperatorShell() {
  const router = useRouter();
  const [identityState, setIdentityState] = useState<OperatorIdentityState>({ status: "loading" });
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({ status: "idle" });
  const [organizationForm, setOrganizationForm] = useState<OrganizationFormState>({
    display_name: "",
    description: "",
  });
  const [organizationNotice, setOrganizationNotice] = useState<MutationNotice>(null);
  const [userMode, setUserMode] = useState<CatalogUserFormMode>({ mode: "create" });
  const [userForm, setUserForm] = useState<CatalogUserFormState>(emptyUserForm());
  const [userNotice, setUserNotice] = useState<MutationNotice>(null);
  const [teamForm, setTeamForm] = useState<TeamFormState>(emptyTeamForm());
  const [teamNotice, setTeamNotice] = useState<MutationNotice>(null);
  const [roleForm, setRoleForm] = useState<ScopedRoleFormState>(emptyRoleForm());
  const [roleNotice, setRoleNotice] = useState<MutationNotice>(null);
  const [membershipForm, setMembershipForm] = useState<MembershipFormState>(emptyMembershipForm());
  const [membershipNotice, setMembershipNotice] = useState<MutationNotice>(null);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(emptyAssignmentForm());
  const [assignmentNotice, setAssignmentNotice] = useState<MutationNotice>(null);
  const [appForm, setAppForm] = useState<AppFormState>(emptyAppForm());
  const [appNotice, setAppNotice] = useState<MutationNotice>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(emptyProjectForm());
  const [projectNotice, setProjectNotice] = useState<MutationNotice>(null);
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentFormState>(emptyEnvironmentForm());
  const [environmentNotice, setEnvironmentNotice] = useState<MutationNotice>(null);
  const [resourceForm, setResourceForm] = useState<ResourceFormState>(emptyResourceForm());
  const [resourceNotice, setResourceNotice] = useState<MutationNotice>(null);
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isSavingMembership, setIsSavingMembership] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [isSavingApp, setIsSavingApp] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [isSavingResource, setIsSavingResource] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const authenticatedPayload =
    identityState.status === "authenticated" ? identityState.payload : null;
  const workspaceData = workspaceState.status === "ready" ? workspaceState.data : null;

  async function redirectToLogin() {
    setIdentityState({ status: "unauthenticated" });
    setWorkspaceState({ status: "idle" });
    router.replace("/login?reason=unauthenticated");
  }

  async function loadWorkspace() {
    setWorkspaceState({ status: "loading" });

    try {
      const data = await readCatalogWorkspace();
      setWorkspaceState({ status: "ready", data });
      setOrganizationForm(emptyOrganizationForm(data));
      setRoleForm((current) => ({
        ...current,
        scope_id:
          current.scope_type === "organization"
            ? data.organization.id
            : current.scope_id,
      }));
      setProjectForm((current) => ({
        ...current,
        app_id: current.app_id || data.apps[0]?.id || "",
      }));
      setEnvironmentForm((current) => ({
        ...current,
        project_id: current.project_id || data.projects[0]?.id || "",
      }));
      setResourceForm((current) => ({
        ...current,
        scope_id:
          current.scope_type === "organization"
            ? data.organization.id
            : current.scope_id,
        container_id:
          current.container_id ||
          (current.container_type === "app"
            ? data.apps[0]?.id
            : current.container_type === "project"
              ? data.projects[0]?.id
              : data.environments[0]?.id) ||
          "",
      }));
      if (userMode.mode === "create") {
        setUserForm(emptyUserForm());
      }
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      const workspaceError = deriveWorkspaceError(error);
      setWorkspaceState({
        status: "error",
        message: workspaceError.message,
        code: workspaceError.code,
      });
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const payload = await readProtectedWhoAmI();
        if (!isMounted) {
          return;
        }
        setIdentityState({ status: "authenticated", payload });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (isUnauthenticatedError(error)) {
          setIdentityState({ status: "unauthenticated" });
          router.replace("/login?reason=unauthenticated");
          return;
        }

        const message = error instanceof Error ? error.message : DEFAULT_WORKSPACE_ERROR_MESSAGE;
        setIdentityState({ status: "error", message });
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (identityState.status !== "authenticated") {
      return;
    }

    void loadWorkspace();
  }, [identityState.status]);

  const selectedUser = useMemo(() => {
    if (!workspaceData || userMode.mode !== "edit") {
      return null;
    }

    return workspaceData.users.find((user) => user.id === userMode.catalogUserId) ?? null;
  }, [userMode, workspaceData]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      router.push("/login?reason=signed-out");
      router.refresh();
      setIsLoggingOut(false);
    }
  }

  async function handleOrganizationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingOrganization(true);
    setOrganizationNotice(null);

    try {
      const response = await updateOrganization({
        display_name: organizationForm.display_name,
        description: organizationForm.description,
      });

      setOrganizationNotice({
        tone: "success",
        message: `Organization saved. Audit event #${response.audit_event_id} captured for ${response.organization.display_name}.`,
      });

      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setOrganizationNotice(
        formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE),
      );
    } finally {
      setIsSavingOrganization(false);
    }
  }

  function handleStartCreateUser() {
    setUserMode({ mode: "create" });
    setUserForm(emptyUserForm());
    setUserNotice(null);
  }

  function handleStartEditUser(user: CatalogUser) {
    setUserMode({ mode: "edit", catalogUserId: user.id });
    setUserForm(userFormFromCatalogUser(user));
    setUserNotice(null);
  }

  function handleCancelEditUser() {
    setUserMode({ mode: "create" });
    setUserForm(emptyUserForm());
    setUserNotice(null);
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingUser(true);
    setUserNotice(null);

    try {
      if (userMode.mode === "create") {
        const payload: CatalogUserCreateInput = {
          email: userForm.email,
          full_name: userForm.full_name,
          job_title: userForm.job_title,
          is_active: userForm.is_active,
        };
        const response = await createCatalogUser(payload);
        setUserNotice({
          tone: "success",
          message: `Catalog user ${response.catalog_user.full_name} created successfully.`,
        });
        setUserForm(emptyUserForm());
      } else {
        const payload: CatalogUserUpdateInput = {
          full_name: userForm.full_name,
          job_title: userForm.job_title,
          is_active: userForm.is_active,
        };
        const response = await updateCatalogUser(userMode.catalogUserId, payload);
        setUserNotice({
          tone: "success",
          message: `Catalog user ${response.catalog_user.full_name} updated successfully.`,
        });
        setUserMode({ mode: "create" });
        setUserForm(emptyUserForm());
      }

      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setUserNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingUser(false);
    }
  }

  async function handleTeamSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingTeam(true);
    setTeamNotice(null);

    try {
      const payload: TeamCreateInput = {
        name: teamForm.name,
        description: teamForm.description,
      };
      const response = await createTeam(payload);
      setTeamNotice({
        tone: "success",
        message: `Team ${response.team.name} created successfully.`,
      });
      setTeamForm(emptyTeamForm());
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setTeamNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingTeam(false);
    }
  }

  async function handleRoleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingRole(true);
    setRoleNotice(null);

    try {
      const organizationId = workspaceData?.organization.id ?? "";
      const payload: ScopedRoleCreateInput = {
        name: roleForm.name,
        description: roleForm.description,
        scope_type: roleForm.scope_type,
        scope_id: roleForm.scope_type === "organization" ? organizationId : roleForm.scope_id,
      };
      const response = await createScopedRole(payload);
      setRoleNotice({
        tone: "success",
        message: `Scoped role ${response.scoped_role.name} created successfully.`,
      });
      setRoleForm(emptyRoleForm(organizationId));
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setRoleNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingRole(false);
    }
  }

  async function handleMembershipSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingMembership(true);
    setMembershipNotice(null);

    try {
      const response = await createMembership(membershipForm);
      const userName = resolveUserName(response.membership.catalog_user_id, workspaceData?.users ?? []);
      const teamName = resolveTeamName(response.membership.team_id, workspaceData?.teams ?? []);
      setMembershipNotice({
        tone: "success",
        message: `Team membership created for ${userName} in ${teamName}.`,
      });
      setMembershipForm(emptyMembershipForm());
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setMembershipNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingMembership(false);
    }
  }

  async function handleAssignmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingAssignment(true);
    setAssignmentNotice(null);

    try {
      const response = await createAssignment(assignmentForm);
      const userName = resolveUserName(response.assignment.catalog_user_id, workspaceData?.users ?? []);
      const roleName = resolveRoleName(response.assignment.scoped_role_id, workspaceData?.scoped_roles ?? []);
      setAssignmentNotice({
        tone: "success",
        message: `Direct role assignment created for ${userName} with ${roleName}.`,
      });
      setAssignmentForm(emptyAssignmentForm());
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setAssignmentNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingAssignment(false);
    }
  }

  async function handleAppSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingApp(true);
    setAppNotice(null);

    try {
      const payload: AppCreateInput = {
        name: appForm.name,
        description: appForm.description,
      };
      const response = await createApp(payload);
      setAppNotice({
        tone: "success",
        message: `Application ${response.app.name} created successfully.`,
      });
      setAppForm(emptyAppForm());
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setAppNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingApp(false);
    }
  }

  async function handleProjectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingProject(true);
    setProjectNotice(null);

    try {
      const payload: ProjectCreateInput = {
        app_id: projectForm.app_id,
        name: projectForm.name,
        description: projectForm.description,
      };
      const response = await createProject(payload);
      setProjectNotice({
        tone: "success",
        message: `Project ${response.project.name} created successfully.`,
      });
      setProjectForm(emptyProjectForm(projectForm.app_id));
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setProjectNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingProject(false);
    }
  }

  async function handleEnvironmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingEnvironment(true);
    setEnvironmentNotice(null);

    try {
      const payload: EnvironmentCreateInput = {
        project_id: environmentForm.project_id,
        name: environmentForm.name,
        description: environmentForm.description,
      };
      const response = await createEnvironment(payload);
      setEnvironmentNotice({
        tone: "success",
        message: `Environment ${response.environment.name} created successfully.`,
      });
      setEnvironmentForm(emptyEnvironmentForm(environmentForm.project_id));
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setEnvironmentNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingEnvironment(false);
    }
  }

  async function handleResourceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingResource(true);
    setResourceNotice(null);

    try {
      const payload: ResourceCreateInput = {
        name: resourceForm.name,
        resource_type: resourceForm.resource_type,
        container_type: resourceForm.container_type,
        container_id: resourceForm.container_id,
        scope_type: resourceForm.scope_type,
        scope_id: resourceForm.scope_id,
        description: resourceForm.description,
        metadata: parseMetadataSummary(resourceForm.metadata_summary),
      };
      const response = await createResource(payload);
      setResourceNotice({
        tone: "success",
        message: `Resource ${response.resource.name} created successfully.`,
      });
      setResourceForm(emptyResourceForm(workspaceData?.organization.id ?? ""));
      await loadWorkspace();
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        await redirectToLogin();
        return;
      }

      setResourceNotice(formatCatalogError(error, DEFAULT_MUTATION_ERROR_MESSAGE));
    } finally {
      setIsSavingResource(false);
    }
  }

  return (
    <section className="hero-card app-shell__hero">
      <p className="eyebrow">Protected operator boundary</p>
      <h1>Operator catalog workspace</h1>
      <p className="lede">
        This workspace validates the backend session first, then loads the single
        organization root, people and team relationships, and the application → project →
        environment → typed resource hierarchy from the protected catalog API.
        Auth expiry redirects back to sign-in, while validation, conflict,
        not-found, and scope mismatch failures stay visible here for operator diagnosis.
      </p>

      {identityState.status === "loading" ? (
        <p className="session-hint" role="status">
          Checking backend session…
        </p>
      ) : null}

      {identityState.status === "unauthenticated" ? (
        <div className="fallback-card" role="alert">
          <h2>Authentication required</h2>
          <p>
            Your backend session is missing or expired. Sign in again to manage
            the organization root and catalog relationships.
          </p>
          <Link className="button button--primary" href="/login">
            Go to sign-in
          </Link>
        </div>
      ) : null}

      {identityState.status === "error" ? (
        <div className="fallback-card" role="alert">
          <h2>Unable to load protected data</h2>
          <p>{identityState.message}</p>
        </div>
      ) : null}

      {authenticatedPayload ? (
        <>
          <div className="hero-actions" role="group" aria-label="Operator actions">
            <button
              className="button button--secondary"
              disabled={isLoggingOut}
              onClick={() => {
                void handleLogout();
              }}
              type="button"
            >
              {isLoggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>

          <OperatorIdentitySummary
            sessionId={authenticatedPayload.session_id}
            user={authenticatedPayload.user}
          />

          <section className="dashboard-grid" aria-label="Operator dashboard status">
            <article className="dashboard-card dashboard-card--highlight">
              <h2>Catalog contract</h2>
              <p>
                The frontend only renders catalog data after the backend-owned
                session resolves, then calls the protected organization, user, team,
                role, app, project, environment, and resource endpoints through a typed client.
              </p>
            </article>
            <article className="dashboard-card">
              <h2>Failure diagnosis</h2>
              <p>
                Auth expiry redirects to sign-in, while validation, conflict,
                not-found, scope mismatch, and audit-write failures remain visible
                with stable backend failure codes for operator troubleshooting.
              </p>
            </article>
          </section>

          {workspaceState.status === "loading" || workspaceState.status === "idle" ? (
            <div className="workspace-card" role="status">
              <h2>Loading catalog workspace…</h2>
              <p className="workspace-copy">
                Fetching the organization root, people graph, and application hierarchy
                records from the backend.
              </p>
            </div>
          ) : null}

          {workspaceState.status === "error" ? (
            <div className="fallback-card" role="alert">
              <h2>Unable to load catalog workspace</h2>
              <p>{workspaceState.message}</p>
              {workspaceState.code ? <p>Failure code: {workspaceState.code}</p> : null}
            </div>
          ) : null}

          {workspaceData ? (
            <div className="workspace-grid">
              <OrganizationPanel
                form={organizationForm}
                isSaving={isSavingOrganization}
                notice={organizationNotice}
                onChange={setOrganizationForm}
                onSubmit={handleOrganizationSubmit}
              />

              <CatalogUsersPanel
                form={userForm}
                isSaving={isSavingUser}
                mode={selectedUser ? userMode : userMode.mode === "edit" ? { mode: "create" } : userMode}
                notice={userNotice}
                onCancel={handleCancelEditUser}
                onChange={setUserForm}
                onStartCreate={handleStartCreateUser}
                onStartEdit={handleStartEditUser}
                onSubmit={handleUserSubmit}
                users={workspaceData.users}
              />

              <TeamsPanel
                form={teamForm}
                isSaving={isSavingTeam}
                memberships={workspaceData.memberships}
                notice={teamNotice}
                onChange={setTeamForm}
                onSubmit={handleTeamSubmit}
                teams={workspaceData.teams}
              />

              <RolesPanel
                assignments={workspaceData.assignments}
                form={roleForm}
                isSaving={isSavingRole}
                notice={roleNotice}
                onChange={setRoleForm}
                onSubmit={handleRoleSubmit}
                organizationId={workspaceData.organization.id}
                roles={workspaceData.scoped_roles}
                teams={workspaceData.teams}
              />

              <MembershipsPanel
                form={membershipForm}
                isSaving={isSavingMembership}
                memberships={workspaceData.memberships}
                notice={membershipNotice}
                onChange={setMembershipForm}
                onSubmit={handleMembershipSubmit}
                teams={workspaceData.teams}
                users={workspaceData.users}
              />

              <AssignmentsPanel
                assignments={workspaceData.assignments}
                form={assignmentForm}
                isSaving={isSavingAssignment}
                notice={assignmentNotice}
                onChange={setAssignmentForm}
                onSubmit={handleAssignmentSubmit}
                roles={workspaceData.scoped_roles}
                teams={workspaceData.teams}
                users={workspaceData.users}
              />

              <AppsPanel
                apps={workspaceData.apps}
                form={appForm}
                isSaving={isSavingApp}
                notice={appNotice}
                onChange={setAppForm}
                onSubmit={handleAppSubmit}
                projects={workspaceData.projects}
              />

              <ProjectsPanel
                apps={workspaceData.apps}
                environments={workspaceData.environments}
                form={projectForm}
                isSaving={isSavingProject}
                notice={projectNotice}
                onChange={setProjectForm}
                onSubmit={handleProjectSubmit}
                projects={workspaceData.projects}
              />

              <EnvironmentsPanel
                environments={workspaceData.environments}
                form={environmentForm}
                isSaving={isSavingEnvironment}
                notice={environmentNotice}
                onChange={setEnvironmentForm}
                onSubmit={handleEnvironmentSubmit}
                projects={workspaceData.projects}
                resources={workspaceData.resources}
              />

              <ResourcesPanel
                apps={workspaceData.apps}
                environments={workspaceData.environments}
                form={resourceForm}
                isSaving={isSavingResource}
                notice={resourceNotice}
                onChange={setResourceForm}
                onSubmit={handleResourceSubmit}
                organizationId={workspaceData.organization.id}
                projects={workspaceData.projects}
                resources={workspaceData.resources}
                teams={workspaceData.teams}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
