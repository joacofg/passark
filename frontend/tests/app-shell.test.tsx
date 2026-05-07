import React from "react";
import { render, screen } from "@testing-library/react";

import HomePage from "../app/page";

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");

  return {
    ...actual,
    readServerSession: vi.fn(),
  };
});

const { readServerSession } = await import("../lib/auth");
const readServerSessionMock = vi.mocked(readServerSession);

describe("HomePage", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend:8000/api/v1";
    process.env.PASSARK_ENV = "test";
    readServerSessionMock.mockReset();
  });

  it("renders the login-first shell when no backend session exists", async () => {
    readServerSessionMock.mockResolvedValueOnce({
      status: "unauthenticated",
      error: new Error("Authentication required."),
    });

    render(await HomePage());

    expect(
      screen.getByRole("heading", {
        name: /sign in to reach the protected operator shell/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no backend session detected/i),
    ).toBeInTheDocument();
    expect(screen.getByText("http://backend:8000/api/v1")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("Unauthenticated")).toBeInTheDocument();
  });

  it("surfaces an active backend session without rendering protected data", async () => {
    readServerSessionMock.mockResolvedValueOnce({
      status: "authenticated",
      session: {
        user: {
          id: 1,
          email: "admin@passark.local",
          is_active: true,
        },
      },
    });

    render(await HomePage());

    expect(
      screen.getByText(/a backend session is already active in this browser/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/session #/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Authenticated")).toBeInTheDocument();
  });

  it("surfaces server-render auth seam failures without claiming the browser is signed out", async () => {
    readServerSessionMock.mockResolvedValueOnce({
      status: "error",
      error: new Error("Backend session lookup failed."),
    });

    render(await HomePage());

    expect(
      screen.getByText(/session status could not be confirmed from this server render/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Backend session lookup failed.")).toBeInTheDocument();
    expect(
      screen.queryByText(/no backend session detected/i),
    ).not.toBeInTheDocument();
  });
});
