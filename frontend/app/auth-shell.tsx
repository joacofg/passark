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
  type CatalogApiError,
  type CatalogUser,
  type CatalogUserCreateInput,
  type CatalogUserUpdateInput,
  type CatalogWorkspaceData,
  createCatalogUser,
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

function userFormFromCatalogUser(user: CatalogUser): CatalogUserFormState {
  return {
    email: user.email,
    full_name: user.full_name,
    job_title: user.job_title ?? "",
    is_active: user.is_active,
  };
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

        {notice ? (
          <div
            className={
              notice.tone === "success" ? "inline-notice inline-notice--success" : "inline-notice inline-notice--error"
            }
            role={notice.tone === "success" ? "status" : "alert"}
          >
            <p>{notice.message}</p>
            {notice.tone === "error" && notice.code ? (
              <p>Failure code: {notice.code}</p>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
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

          {notice ? (
            <div
              className={
                notice.tone === "success" ? "inline-notice inline-notice--success" : "inline-notice inline-notice--error"
              }
              role={notice.tone === "success" ? "status" : "alert"}
            >
              <p>{notice.message}</p>
              {notice.tone === "error" && notice.code ? (
                <p>Failure code: {notice.code}</p>
              ) : null}
            </div>
          ) : null}
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
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
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

  return (
    <section className="hero-card app-shell__hero">
      <p className="eyebrow">Protected operator boundary</p>
      <h1>Operator catalog workspace</h1>
      <p className="lede">
        This workspace validates the backend session first, then loads the single
        organization root plus real catalog-user data from the protected catalog
        API. Auth expiry redirects back to sign-in, while validation and conflict
        failures stay visible here for operator diagnosis.
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
            the organization root and catalog users.
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
                session resolves, then calls the protected organization and user
                endpoints through a typed client.
              </p>
            </article>
            <article className="dashboard-card">
              <h2>Failure diagnosis</h2>
              <p>
                Auth expiry redirects to sign-in, while validation, conflict, and
                audit-write failures remain visible with stable backend failure
                codes for operator troubleshooting.
              </p>
            </article>
          </section>

          {workspaceState.status === "loading" || workspaceState.status === "idle" ? (
            <div className="workspace-card" role="status">
              <h2>Loading catalog workspace…</h2>
              <p className="workspace-copy">
                Fetching the organization root and catalog users from the backend.
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
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
