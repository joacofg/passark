import React from "react";
import { render, screen } from "@testing-library/react";

import HomePage from "../app/page";

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");

  return {
    ...actual,
    readSession: vi.fn(),
  };
});

const { readSession } = await import("../lib/auth");
const readSessionMock = vi.mocked(readSession);

describe("HomePage", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend:8000/api/v1";
    process.env.PASSARK_ENV = "test";
    readSessionMock.mockReset();
  });

  it("renders the login-first shell when no backend session exists", async () => {
    readSessionMock.mockRejectedValueOnce(new Error("unauthenticated"));

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
  });

  it("surfaces an active backend session without rendering protected data", async () => {
    readSessionMock.mockResolvedValueOnce({
      user: {
        id: 1,
        email: "admin@passark.local",
        is_active: true,
      },
    });

    render(await HomePage());

    expect(
      screen.getByText(/a backend session is already active in this browser/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/session #/i),
    ).not.toBeInTheDocument();
  });
});
