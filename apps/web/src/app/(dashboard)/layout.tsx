"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb, BreadcrumbLabels } from "@/components/layout/breadcrumb";
import { Chatbot } from "@/components/ai/chatbot";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { impersonationMeta } from "@/lib/api";
import { ImpersonationBanner } from "@/components/crm/impersonation-banner";
import { PhoneRequiredBanner } from "@/components/crm/phone-required-banner";
import { BizcallDialpadDock } from "@/components/crm/bizcall-dialpad-dock";

function UserImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  if (!user?.impersonatedBy || impersonationMeta()) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
      <span>You are logged in as <strong>{user.firstName} {user.lastName}</strong>.</span>
      <Button size="sm" variant="outline" onClick={() => void stopImpersonating()}>
        <LogOut className="mr-2 h-4 w-4" />
        Return to admin
      </Button>
    </div>
  );
}

function DashboardAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, isAuthenticated, isSuperAdmin, isAdmin, hasFullAccess, hasEffectivePermission } = useAuth();

  const requiredPermission =
    pathname === "/reports/new" ? "REPORT_CREATE" :
    pathname === "/leads/new" ? "LEAD_CREATE" :
    pathname === "/tasks/new" ? "FOLLOW_UP_CREATE" :
    pathname.startsWith("/leads") ? "LEAD_READ" :
    pathname.startsWith("/tasks") ? "FOLLOW_UP_READ" :
    pathname.startsWith("/site-visits") ? "SITE_VISIT_READ" :
    pathname.startsWith("/projects") ? "PROJECT_READ" :
    pathname.startsWith("/dashboards") || pathname.startsWith("/dashboard/") ? "DASHBOARD_READ" :
    pathname.startsWith("/reports") ? "REPORT_VIEW" :
    null;

  const isCustomizeHomeRoute =
    pathname === "/admin/customize-home" ||
    pathname.startsWith("/admin/customize-home/");
  const isObjectManagerRoute =
    pathname === "/admin/object-manager" ||
    pathname.startsWith("/admin/object-manager/");
  const isSuperAdminOnlyObjectRoute =
    /^\/admin\/object-manager\/(?:company|companiesapi)(?:\/|$)/i.test(pathname);
  const canManageObjects =
    isSuperAdmin ||
    (isAdmin && (hasFullAccess || hasEffectivePermission("PROFILE_PERMISSION_MANAGE")));
  const isRestrictedAdminRoute =
    pathname.startsWith("/admin") &&
    !isCustomizeHomeRoute &&
    !isSuperAdmin &&
    (isSuperAdminOnlyObjectRoute || !(isObjectManagerRoute && canManageObjects));

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    } else if (!isLoading && requiredPermission && !(isSuperAdmin || hasFullAccess || hasEffectivePermission(requiredPermission))) {
      router.replace("/home");
    } else if (!isLoading && pathname.startsWith("/setup") && !isAdmin && !isSuperAdmin) {
      router.replace("/home");
    } else if (!isLoading && isCustomizeHomeRoute && !isAdmin && !isSuperAdmin) {
      router.replace("/home");
    } else if (!isLoading && isRestrictedAdminRoute) {
      router.replace("/home");
    }
  }, [hasEffectivePermission, hasFullAccess, isAdmin, isLoading, isAuthenticated, isSuperAdmin, isCustomizeHomeRoute, isRestrictedAdminRoute, pathname, requiredPermission, router]);

  if (isLoading || !isAuthenticated) return null;
  if (requiredPermission && !(isSuperAdmin || hasFullAccess || hasEffectivePermission(requiredPermission))) return null;
  if (pathname.startsWith("/setup") && !isAdmin && !isSuperAdmin) return null;
  if (isCustomizeHomeRoute && !isAdmin && !isSuperAdmin) return null;
  if (isRestrictedAdminRoute) return null;
  return <>{children}</>;
}

function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathRoot = pathname.split("/").filter(Boolean)[0] || "";
  const knownRoots = new Set([
    "setup", "bookings", "reports", "leads", "admin", "site-visits", "follow-ups",
    "projects", "units", "profiles", "tasks", "mis-approvals", "calendar",
    "call-details", "dashboard", "dashboards", "cp-portal-accounts", "enquiries",
    "home", "objects",
  ]);
  const hideBreadcrumb =
    pathname === "/reports" ||
    pathname.startsWith("/reports/") ||
    pathname.startsWith("/profiles") ||
    (Boolean(pathRoot) && !knownRoots.has(pathRoot));
  const standaloneReport =
    pathname.startsWith("/reports/") && pathname !== "/reports/new";
  const embedded = searchParams.get("embed") === "1";
  const companiesApiConsole = pathname === "/admin/companies" && searchParams.get("view") === "api";

  if (embedded) {
    return (
      <AuthProvider>
        <main className="min-w-0 max-w-full overflow-x-clip bg-background p-2">
          <ImpersonationBanner />
          <PhoneRequiredBanner />
          <React.Suspense fallback={<div className="min-h-[40vh]" aria-hidden="true" />}>
            {children}
          </React.Suspense>
        </main>
      </AuthProvider>
    );
  }

  if (standaloneReport) {
    return (
      <AuthProvider>
        <div className="min-h-screen min-w-0 max-w-full bg-background">
          <div className="p-4 pb-0"><ImpersonationBanner /><PhoneRequiredBanner /></div>
          <DashboardAccessGuard>
            <React.Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
              {children}
            </React.Suspense>
          </DashboardAccessGuard>
          <Toaster />
        </div>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <BreadcrumbLabels>
      <div className={`${companiesApiConsole ? "min-h-screen lg:h-dvh lg:overflow-hidden" : "min-h-screen"} min-w-0 max-w-full bg-background`}>
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className={`${companiesApiConsole ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col" : ""} min-w-0 max-w-full overflow-x-clip lg:pl-14`}>
          <React.Suspense fallback={<div className="h-14" aria-hidden="true" />}>
            <Header onMenuClick={() => setSidebarOpen(true)} />
          </React.Suspense>
          <main className={`dashboard-page-content ${companiesApiConsole ? "lg:flex lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:flex-col lg:overflow-hidden" : "min-h-[calc(100dvh-3.5rem)]"} min-w-0 max-w-full overflow-x-clip p-4`}>
            <ImpersonationBanner />
            {!hideBreadcrumb && <Breadcrumb className="mb-3" />}
            <UserImpersonationBanner />
            <PhoneRequiredBanner />
            <DashboardAccessGuard>
              <React.Suspense fallback={<div className={companiesApiConsole ? "lg:min-h-0 lg:flex-1" : "min-h-[40vh]"} aria-hidden="true" />}>
                <div className={companiesApiConsole ? "lg:min-h-0 lg:flex-1" : ""}>
                  {children}
                </div>
              </React.Suspense>
            </DashboardAccessGuard>
          </main>
        </div>
        <Chatbot />
        <BizcallDialpadDock />
        <Toaster />
      </div>
      </BreadcrumbLabels>
    </AuthProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-background" />}>
      <DashboardShell>{children}</DashboardShell>
    </React.Suspense>
  );
}