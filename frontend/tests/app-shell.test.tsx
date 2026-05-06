import React from "react";
import { render, screen } from "@testing-library/react";

import HomePage from "../app/page";

describe("HomePage", () => {
  it("renders the PassArk shell with the configured backend seam", () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend:8000";
    process.env.PASSARK_ENV = "test";

    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /single-company secrets and access, staged for local development/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("http://backend:8000")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(
      screen.getByText(/configured via next_public_api_base_url/i),
    ).toBeInTheDocument();
  });
});
