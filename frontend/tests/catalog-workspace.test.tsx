import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
  };
});

vi.mock("../lib/catalog", async () => {
  const actual = await vi.importActual<typeof import("../lib/catalog")>("../lib/catalog");

  return {
    ...actual,
    readCatalogWorkspace: vi.fn(),
    updateOrganization: vi.fn(),
    createCatalogUser: vi.fn(),
    updateCatalogUser: vi.fn(),
  };
});

const { readProtectedWhoAmI } = await import("../lib/auth");
const {
  createCatalogUser,
  readCatalogWorkspace,
  updateCatalogUser,
  updateOrganization,
} = await import("../lib/catalog");

const readProtectedWhoAmIMock = vi.mocked(readProtectedWhoAmI);
const readCatalogWorkspaceMock = vi.mocked(readCatalogWorkspace);
const updateOrganizationMock = vi.mocked(updateOrganization);
const createCatalogUserMock = vi.mocked(createCatalogUser);
const updateCatalogUserMock = vi.mocked(updateCatalogUser);

const baseWorkspace = {
  organization: {
    id: "org_123",
    slug: "passark",
    display_name: "PassArk",
    description: "Primary organization for this PassArk deployment.",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  users: [
    {
      id: "cu_ada",
      organization_id: "org_123",
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      job_title: "Analyst",
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ],
};

function queueAuthenticatedWorkspace(
  workspace: typeof baseWorkspace = baseWorkspace,
) {
  readProtectedWhoAmIMock.mockResolvedValueOnce({
    user: { id: 1, email: "admin@passark.local", is_active: true },
    session_id: 12,
  });
  readCatalogWorkspaceMock.mockResolvedValueOnce(workspace);
}

describe("catalog workspace", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    readProtectedWhoAmIMock.mockReset();
    readCatalogWorkspaceMock.mockReset();
    updateOrganizationMock.mockReset();
    createCatalogUserMock.mockReset();
    updateCatalogUserMock.mockReset();
  });

  it("shows the loading state before catalog data resolves", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 12,
    });
    readCatalogWorkspaceMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    render(<OperatorPage />);

    expect(await screen.findByText(/loading catalog workspace/i)).toBeInTheDocument();
  });

  it("shows the empty-state callout when no catalog users exist", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/create the first managed user record/i),
    ).toBeInTheDocument();
  });

  it("creates a catalog user and refreshes the live workspace", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
    });
    createCatalogUserMock.mockResolvedValueOnce({
      catalog_user: {
        id: "cu_grace",
        organization_id: "org_123",
        email: "grace@example.com",
        full_name: "Grace Hopper",
        job_title: "Engineer",
        is_active: true,
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      users: [
        {
          id: "cu_grace",
          organization_id: "org_123",
          email: "grace@example.com",
          full_name: "Grace Hopper",
          job_title: "Engineer",
          is_active: true,
          created_at: "2024-01-02T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ],
    });

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "grace@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create user$/i }));

    await waitFor(() => {
      expect(createCatalogUserMock).toHaveBeenCalledWith({
        email: "grace@example.com",
        full_name: "Grace Hopper",
        job_title: "Engineer",
        is_active: true,
      });
    });

    expect(
      await screen.findByText(/catalog user grace hopper created successfully/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("Grace Hopper")).toBeInTheDocument();
  });

  it("edits a catalog user through the live workspace form", async () => {
    queueAuthenticatedWorkspace();
    updateCatalogUserMock.mockResolvedValueOnce({
      catalog_user: {
        ...baseWorkspace.users[0],
        full_name: "Ada Byron",
        job_title: "Principal Analyst",
        is_active: false,
      },
    });
    readCatalogWorkspaceMock.mockResolvedValueOnce({
      ...baseWorkspace,
      users: [
        {
          ...baseWorkspace.users[0],
          full_name: "Ada Byron",
          job_title: "Principal Analyst",
          is_active: false,
        },
      ],
    });

    render(<OperatorPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit ada lovelace/i }));

    const fullNameInput = screen.getByLabelText("Full name") as HTMLInputElement;
    fireEvent.change(fullNameInput, { target: { value: "Ada Byron" } });
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Principal Analyst" },
    });
    fireEvent.click(screen.getByLabelText(/catalog user is active/i));
    fireEvent.click(screen.getByRole("button", { name: /^save user$/i }));

    await waitFor(() => {
      expect(updateCatalogUserMock).toHaveBeenCalledWith("cu_ada", {
        full_name: "Ada Byron",
        job_title: "Principal Analyst",
        is_active: false,
      });
    });

    expect(
      await screen.findByText(/catalog user ada byron updated successfully/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("Ada Byron")).toBeInTheDocument();
    expect(await screen.findByText(/principal analyst · inactive/i)).toBeInTheDocument();
  });

  it("surfaces organization audit failures without losing the machine-readable code", async () => {
    queueAuthenticatedWorkspace();
    updateOrganizationMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        503,
        "Audit logging is required for organization updates.",
        "organization_update_audit_unavailable",
      ),
    );

    render(<OperatorPage />);

    const displayName = await screen.findByDisplayValue("PassArk");
    fireEvent.change(displayName, { target: { value: "PassArk Labs" } });
    fireEvent.click(screen.getByRole("button", { name: /save organization/i }));

    await waitFor(() => {
      expect(updateOrganizationMock).toHaveBeenCalledWith({
        display_name: "PassArk Labs",
        description: "Primary organization for this PassArk deployment.",
      });
    });

    const organizationPanel = screen.getByRole("region", { name: /organization root/i });
    expect(
      await within(organizationPanel).findByText(
        "Audit logging is required for organization updates.",
      ),
    ).toBeInTheDocument();
    expect(
      within(organizationPanel).getByText(
        "Failure code: organization_update_audit_unavailable",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces catalog-user validation failures in-place", async () => {
    queueAuthenticatedWorkspace({
      ...baseWorkspace,
      users: [],
    });
    createCatalogUserMock.mockRejectedValueOnce(
      new AuthApiRequestError(422, "Request failed with status 422."),
    );

    render(<OperatorPage />);

    expect(await screen.findByText(/no catalog users yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "broken@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Broken User" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create user$/i }));

    await waitFor(() => {
      expect(createCatalogUserMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Failure code: validation_error")).toBeInTheDocument();
  });

  it("surfaces catalog-user conflict failures in-place", async () => {
    queueAuthenticatedWorkspace();
    createCatalogUserMock.mockRejectedValueOnce(
      new AuthApiRequestError(
        409,
        "Catalog user already exists.",
        "catalog_user_conflict",
      ),
    );

    render(<OperatorPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create catalog user/i }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create user$/i }));

    await waitFor(() => {
      expect(createCatalogUserMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Catalog user already exists.")).toBeInTheDocument();
    expect(await screen.findByText("Failure code: catalog_user_conflict")).toBeInTheDocument();
  });

  it("redirects to sign-in if the catalog workspace read detects auth expiry", async () => {
    readProtectedWhoAmIMock.mockResolvedValueOnce({
      user: { id: 1, email: "admin@passark.local", is_active: true },
      session_id: 12,
    });
    readCatalogWorkspaceMock.mockRejectedValueOnce(
      new AuthApiRequestError(401, "Authentication required.", "auth_unauthenticated"),
    );

    render(<OperatorPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/login?reason=unauthenticated");
    });

    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
  });
});
