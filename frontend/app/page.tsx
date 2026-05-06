import Link from "next/link";

import { getApiBaseUrl, getRuntimeEnvironment, readSession } from "@/lib/auth";

export default async function HomePage() {
  let hasActiveSession = false;

  try {
    await readSession();
    hasActiveSession = true;
  } catch {
    hasActiveSession = false;
  }

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
          {hasActiveSession
            ? "A backend session is already active in this browser."
            : "No backend session detected. Protected content stays hidden until sign-in succeeds."}
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
      </section>
    </main>
  );
}
