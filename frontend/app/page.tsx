import React from "react";
import Link from "next/link";

import {
  getApiBaseUrl,
  getRuntimeEnvironment,
  readServerSession,
} from "@/lib/auth";

export default async function HomePage() {
  const sessionState = await readServerSession();
  const hasActiveSession = sessionState.status === "authenticated";
  const runtimeEnvironment = getRuntimeEnvironment();
  const apiBaseUrl = getApiBaseUrl();

  return (
    <main className="app-shell">
      <section className="hero-card app-shell__hero">
        <p className="eyebrow">PassArk operator workspace</p>
        <h1>Sign in to reach the protected operator shell.</h1>
        <p className="lede">
          PassArk now relies on backend-owned cookie sessions. Use the bootstrap
          operator credentials from your local <code>.env</code> to authenticate
          against the real API and unlock protected operator data.
        </p>

        <div className="hero-actions" role="group" aria-label="Primary actions">
          <Link className="button button--primary" href="/login">
            {hasActiveSession ? "Refresh login" : "Sign in"}
          </Link>
          <Link className="button button--secondary" href="/operator">
            Open operator shell
          </Link>
        </div>

        <p className="session-hint" role="status">
          {sessionState.status === "authenticated"
            ? "A backend session is already active in this browser."
            : sessionState.status === "unauthenticated"
              ? "No backend session detected. Protected content stays hidden until sign-in succeeds."
              : "Session status could not be confirmed from this server render. Continue to sign-in or open the operator shell to retry in-browser."}
        </p>
      </section>

      <section className="status-grid" aria-label="Runtime contract overview">
        <article className="status-card">
          <h2>Backend API seam</h2>
          <p>{apiBaseUrl}</p>
          <span>Requests include cookies so backend session truth stays authoritative.</span>
        </article>
        <article className="status-card">
          <h2>Runtime environment</h2>
          <p>{runtimeEnvironment}</p>
          <span>Mirrors PASSARK_ENV for quick operator diagnosis.</span>
        </article>
        <article className="status-card">
          <h2>Landing-page session check</h2>
          <p>
            {sessionState.status === "authenticated"
              ? "Authenticated"
              : sessionState.status === "unauthenticated"
                ? "Unauthenticated"
                : "Unavailable"}
          </p>
          <span>
            {sessionState.status === "error"
              ? sessionState.error.message
              : "Server render only reports safe session state; protected reads still happen in the operator shell."}
          </span>
        </article>
      </section>
    </main>
  );
}
