import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/admin/object-manager/lead",
  hasObjectPermission: true,
  hasReportPermission: true,
  isSuperAdmin: false,
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => state.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    isSuperAdmin: state.isSuperAdmin,
    isAdmin: true,
    hasFullAccess: false,
    hasEffectivePermission: (permission: string) =>
      (permission === "PROFILE_PERMISSION_MANAGE" && state.hasObjectPermission) ||
      (["REPORT_VIEW", "REPORT_CREATE"].includes(permission) && state.hasReportPermission),
    user: {},
    stopImpersonating: vi.fn(),
  }),
}));

vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => <div>Sidebar</div> }));
vi.mock("@/components/layout/header", () => ({ Header: () => <div>Header</div> }));
vi.mock("@/components/layout/breadcrumb", () => ({
  Breadcrumb: () => null,
  BreadcrumbLabels: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ai/chatbot", () => ({ Chatbot: () => null }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));

import DashboardLayout from "../app/(dashboard)/layout";

describe("dashboard admin route access", () => {
  beforeEach(() => {
    state.pathname = "/admin/object-manager/lead";
    state.hasObjectPermission = true;
    state.hasReportPermission = true;
    state.isSuperAdmin = false;
    state.router.replace.mockClear();
  });

  it("allows admins with object-management permission to open object details", () => {
    render(
      <DashboardLayout>
        <div>Object details</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Object details")).toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalledWith("/home");
  });

  it("redirects admins without object-management permission", () => {
    state.hasObjectPermission = false;

    render(
      <DashboardLayout>
        <div>Object details</div>
      </DashboardLayout>,
    );

    expect(screen.queryByText("Object details")).not.toBeInTheDocument();
    expect(state.router.replace).toHaveBeenCalledWith("/home");
  });

  it("restricts Company object settings to super admins", () => {
    state.pathname = "/admin/object-manager/company";

    render(
      <DashboardLayout>
        <div>Company object details</div>
      </DashboardLayout>,
    );

    expect(screen.queryByText("Company object details")).not.toBeInTheDocument();
    expect(state.router.replace).toHaveBeenCalledWith("/home");
  });

  it("allows super admins to open Company object settings", () => {
    state.pathname = "/admin/object-manager/company";
    state.isSuperAdmin = true;

    render(
      <DashboardLayout>
        <div>Company object details</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Company object details")).toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalledWith("/home");
  });

  it("keeps the CRM sidebar and header visible on report details", () => {
    state.pathname = "/reports/report-1";

    render(
      <DashboardLayout>
        <div>Report details</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Report details")).toBeInTheDocument();
    expect(screen.getByText("Sidebar")).toBeInTheDocument();
    expect(screen.getByText("Header")).toBeInTheDocument();
  });

  it("keeps the CRM shell on the report creation page", () => {
    state.pathname = "/reports/new";

    render(
      <DashboardLayout>
        <div>Report builder</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Report builder")).toBeInTheDocument();
    expect(screen.getByText("Sidebar")).toBeInTheDocument();
    expect(screen.getByText("Header")).toBeInTheDocument();
  });

  it("allows super admins to open reports without company report permissions", () => {
    state.pathname = "/reports/new";
    state.hasReportPermission = false;
    state.isSuperAdmin = true;

    render(
      <DashboardLayout>
        <div>Report builder</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Report builder")).toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalledWith("/home");
  });

  it("allows super admins to open dashboard management without company dashboard permissions", () => {
    state.pathname = "/dashboards";
    state.hasReportPermission = false;
    state.isSuperAdmin = true;

    render(
      <DashboardLayout>
        <div>Dashboard manager</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("Dashboard manager")).toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalledWith("/home");
  });
});
