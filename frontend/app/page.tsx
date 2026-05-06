import React from "react";

type RuntimeConfig = {
  apiBaseUrl: string;
  environment: string;
};

function getRuntimeConfig(): RuntimeConfig {
  return {
    apiBaseUrl:
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
    environment: process.env.PASSARK_ENV ?? "development",
  };
}

export default function HomePage() {
  const runtimeConfig = getRuntimeConfig();

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">PassArk operator workspace</p>
        <h1>Single-company secrets and access, staged for local development.</h1>
        <p className="lede">
          This app shell proves the frontend boot path, documents the backend API
          seam, and stays intentionally small until authenticated navigation
          arrives in later slices.
        </p>
      </section>

      <section className="status-grid" aria-label="Runtime contract overview">
        <article className="status-card">
          <h2>Backend API seam</h2>
          <p>{runtimeConfig.apiBaseUrl}</p>
          <span>Configured via NEXT_PUBLIC_API_BASE_URL.</span>
        </article>
        <article className="status-card">
          <h2>Runtime environment</h2>
          <p>{runtimeConfig.environment}</p>
          <span>Mirrors PASSARK_ENV for quick operator diagnosis.</span>
        </article>
      </section>
    </main>
  );
}
