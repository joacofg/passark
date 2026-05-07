import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    runVaultAccessProbe: vi.fn(),
  };
});

const { logout, readProtectedWhoAmI, runVaultAccessProbe } = await import("../lib/auth");
const logoutMock = vi.mocked(logout);
const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const runVaultAccessProbeMock = vi.mocked(runVaultAccessProbe);

describe("OperatorPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    logoutMock.mockReset();
    readProtectedWhoAmIMock.mockReset();
    runVaultAccessProbeMock.mockReset();
  });

  it("renders the protected operator dashboard after the backend session resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 42,
    });

    render(<OperatorPage />);

    await waitFor(() => {
      expect(readProtectedWhoAmIMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("admin@passark.local")).toBeInTheDocument();
    });

    expect(screen.getByText(/session #42/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /run vault access probe/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/stable backend error codes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/session token/i)).not.toBeInTheDocument();
  });

  it("redirects unauthenticated browsers back to sign-in with a visible fallback state", async () => {
    readProtectedWhoAmIMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
    expect(screen.getByText(/go to sign-in/i)).toBeInTheDocument();
  });

  it("surfaces protected whoami failures without collapsing them into signed-out copy", async () => {
    readProtectedWhoAmIMock.mockRejectedValueOnce(new Error("Backend session lookup failed."));

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByText("Backend session lookup failed.")).toBeInTheDocument();
    });

    expect(screen.getByText(/unable to load protected data/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows audited protected-action success details after the vault probe completes", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    runVaultAccessProbeMock.mockResolvedValueOnce({
      operation: "vault_access_probe",
      status: "allowed",
      actor_id: 1,
      audit_event_id: 91,
    });

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run vault access probe/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /run vault access probe/i }));

    await waitFor(() => {
      expect(runVaultAccessProbeMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/protected action allowed/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/operation/i)).toBeInTheDocument();
    expect(screen.getByText(/vault_access_probe/i)).toBeInTheDocument();
    expect(screen.getByText("Status: allowed")).toBeInTheDocument();
    expect(screen.getByText("Audit event: #91")).toBeInTheDocument();
  });

  it("surfaces audited protected-action failures with backend failure codes", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    runVaultAccessProbeMock.mockRejectedValueOnce(
      new AuthApiRequestError(503, "Audit logging is unavailable.", "audit_unavailable"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run vault access probe/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /run vault access probe/i }));

    await waitFor(() => {
      expect(runVaultAccessProbeMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Failure code: audit_unavailable")).toBeInTheDocument();
    });

    expect(screen.getByText(/protected action failed/i)).toBeInTheDocument();
    expect(screen.getByText("Audit logging is unavailable.")).toBeInTheDocument();
  });

  it("returns to sign-in if the audited action discovers an expired session", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    runVaultAccessProbeMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run vault access probe/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /run vault access probe/i }));

    await waitFor(() => {
      expect(runVaultAccessProbeMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(screen.getByText(/authentication required/i)).toBeInTheDocument();
    expect(
      screen.getByText(/your backend session is missing or expired/i),
    ).toBeInTheDocument();
  });

  it("issues logout and routes back to sign-in", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 7,
    });
    logoutMock.mockResolvedValueOnce();

    render(<OperatorPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith("/login?reason=signed-out");
      expect(refreshMock).toHaveBeenCalled();
    });
  });
});
