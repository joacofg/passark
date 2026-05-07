"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AuthApiRequestError,
  AuthenticatedUser,
  ProtectedWhoAmIResponse,
  VaultAccessProbeResponse,
  isUnauthenticatedError,
  login,
  logout,
  readProtectedWhoAmI,
  runVaultAccessProbe,
} from "@/lib/auth";

const DEFAULT_ERROR_MESSAGE = "Unable to sign in with the provided credentials.";
const DEFAULT_PROBE_ERROR_MESSAGE =
  "Unable to complete the protected vault access check right now.";

type OperatorState =
  | { status: "loading" }
  | { status: "authenticated"; payload: ProtectedWhoAmIResponse }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

type ProbeState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; payload: VaultAccessProbeResponse }
  | { status: "error"; message: string; code?: string };

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

function OperatorSummary({
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
        <span>Unauthenticated browsers never receive this protected payload.</span>
      </article>
    </section>
  );
}

function ProbePanel({
  state,
  onRun,
}: {
  state: ProbeState;
  onRun: () => Promise<void>;
}) {
  return (
    <section className="probe-panel" aria-label="Audited operator action">
      <div className="probe-panel__copy">
        <p className="eyebrow">Audited sensitive action</p>
        <h2>Vault access probe</h2>
        <p className="probe-panel__lede">
          Trigger the backend&rsquo;s audited <code>vault-access-probe</code> route to
          confirm protected actions resolve the current operator and surface
          stable failure codes without exposing secrets.
        </p>
      </div>

      <div className="probe-panel__body">
        <button
          className="button button--primary"
          disabled={state.status === "running"}
          onClick={() => {
            void onRun();
          }}
          type="button"
        >
          {state.status === "running" ? "Running audit check…" : "Run vault access probe"}
        </button>

        <div className="probe-status" aria-live="polite">
          {state.status === "idle" ? (
            <p className="probe-status__hint" role="status">
              Ready to confirm audited protected access.
            </p>
          ) : null}

          {state.status === "running" ? (
            <p className="probe-status__hint" role="status">
              Running audited protected action…
            </p>
          ) : null}

          {state.status === "success" ? (
            <div className="probe-status__success" role="status">
              <h3>Protected action allowed</h3>
              <p>
                Operation <code>{state.payload.operation}</code> completed for operator #{" "}
                {state.payload.actor_id}.
              </p>
              <ul>
                <li>Status: {state.payload.status}</li>
                <li>Audit event: #{state.payload.audit_event_id}</li>
              </ul>
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="probe-status__error" role="alert">
              <h3>Protected action failed</h3>
              <p>{state.message}</p>
              {state.code ? <p>Failure code: {state.code}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function OperatorShell() {
  const router = useRouter();
  const [state, setState] = useState<OperatorState>({ status: "loading" });
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const authenticatedPayload =
    state.status === "authenticated" ? state.payload : null;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const payload = await readProtectedWhoAmI();
        if (isMounted) {
          setState({ status: "authenticated", payload });
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (isUnauthenticatedError(error)) {
          setState({ status: "unauthenticated" });
          router.replace("/login?reason=unauthenticated");
          return;
        }

        const message = error instanceof Error ? error.message : "Unable to load operator data.";
        setState({ status: "error", message });
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [router]);

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

  async function handleVaultAccessProbe() {
    setProbeState({ status: "running" });

    try {
      const payload = await runVaultAccessProbe();
      setProbeState({ status: "success", payload });
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        setState({ status: "unauthenticated" });
        setProbeState({
          status: "error",
          message: error.message,
          code: error.code,
        });
        router.replace("/login?reason=unauthenticated");
        return;
      }

      if (error instanceof AuthApiRequestError) {
        setProbeState({
          status: "error",
          message: error.message,
          code: error.code,
        });
        return;
      }

      setProbeState({
        status: "error",
        message: DEFAULT_PROBE_ERROR_MESSAGE,
      });
    }
  }

  return (
    <section className="hero-card app-shell__hero">
      <p className="eyebrow">Protected operator boundary</p>
      <h1>Operator shell</h1>
      <p className="lede">
        This page fetches real protected data from <code>/protected/whoami</code>
        with cookies included. Anonymous browsers are redirected away before
        protected content is shown.
      </p>

      {state.status === "loading" ? (
        <p className="session-hint" role="status">
          Checking backend session…
        </p>
      ) : null}

      {state.status === "unauthenticated" ? (
        <div className="fallback-card" role="alert">
          <h2>Authentication required</h2>
          <p>
            Your backend session is missing or expired. Sign in again to view
            protected operator data.
          </p>
          <Link className="button button--primary" href="/login">
            Go to sign-in
          </Link>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="fallback-card" role="alert">
          <h2>Unable to load protected data</h2>
          <p>{state.message}</p>
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

          <OperatorSummary
            sessionId={authenticatedPayload.session_id}
            user={authenticatedPayload.user}
          />

          <section className="dashboard-grid" aria-label="Operator dashboard status">
            <article className="dashboard-card dashboard-card--highlight">
              <h2>Session trust boundary</h2>
              <p>
                The backend owns authentication state. This shell only renders
                operator details after the protected session resolves.
              </p>
            </article>
            <article className="dashboard-card">
              <h2>Failure diagnosis</h2>
              <p>
                Missing sessions redirect to sign-in, protected fetch failures
                stay visible here, and audited action denials surface stable
                backend error codes.
              </p>
            </article>
          </section>

          <ProbePanel onRun={handleVaultAccessProbe} state={probeState} />
        </>
      ) : null}
    </section>
  );
}
