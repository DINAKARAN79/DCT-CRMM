#!/usr/bin/env python3
"""Generate DCT-CRMM A-Z Audit Report PDF."""
from fpdf import FPDF
from datetime import datetime

class AuditPDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "DCT-CRMM  |  Comprehensive A-Z Audit Report", align="L")
        self.ln(10)
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def cover(self):
        self.add_page()
        self.ln(50)
        self.set_font("Helvetica", "B", 32)
        self.set_text_color(20, 60, 120)
        self.cell(0, 16, "DCT-CRMM", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(4)
        self.set_font("Helvetica", "B", 22)
        self.set_text_color(40, 40, 40)
        self.cell(0, 12, "Comprehensive A-Z Audit Report", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(8)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "Architecture  |  Database  |  Security  |  Performance  |  Data Flow", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(30)
        self.set_font("Helvetica", "", 11)
        self.set_text_color(60, 60, 60)
        info = [
            ("Date", datetime.now().strftime("%B %d, %Y")),
            ("Repository", "https://github.com/Dhananchezhiyan-A/DCT-CRMM"),
            ("Branch", "main"),
            ("Commit", "1d1111c"),
            ("Validation", "46/46 E2E PASS | tsc 0 errors | prisma validate OK"),
        ]
        for label, value in info:
            self.cell(60, 8, label + ":", align="R")
            self.cell(0, 8, "  " + value, align="L", new_x="LMARGIN", new_y="NEXT")

    def h1(self, text):
        self.ln(4)
        if self.get_y() > 250:
            self.add_page()
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(20, 60, 120)
        self.cell(0, 10, text, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(20, 60, 120)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

    def h2(self, text):
        if self.get_y() > 265:
            self.add_page()
        self.ln(2)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(40, 40, 40)
        self.cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def h3(self, text):
        if self.get_y() > 270:
            self.add_page()
        self.ln(1)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(60, 60, 60)
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")

    def body(self, text):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(self.w - self.l_margin - self.r_margin, 5.5, text)
        self.ln(1)

    def bullet(self, text, indent=10):
        if self.get_y() > 275:
            self.add_page()
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        left = self.l_margin + indent
        self.set_x(left)
        self.cell(5, 5.5, "-")
        self.multi_cell(self.w - self.r_margin - self.get_x(), 5.5, text)

    def kv(self, key, value, indent=10):
        if self.get_y() > 275:
            self.add_page()
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(30, 30, 30)
        left = self.l_margin + indent
        self.set_x(left)
        key_txt = key + ": "
        kw = self.get_string_width(key_txt) + 1
        self.cell(kw, 5.5, key_txt)
        self.set_font("Helvetica", "", 10)
        rem = self.w - self.r_margin - self.get_x()
        if rem < 20:
            self.set_x(left)
            rem = self.w - self.r_margin - left
        self.multi_cell(rem, 5.5, value)

    def code(self, text):
        if self.get_y() > 265:
            self.add_page()
        self.set_x(self.l_margin)
        self.set_font("Courier", "", 9)
        self.set_text_color(0, 80, 0)
        self.set_fill_color(245, 245, 245)
        self.multi_cell(self.w - self.l_margin - self.r_margin, 5, text, fill=True)
        self.ln(1)

    def warn(self, text):
        if self.get_y() > 265:
            self.add_page()
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(180, 60, 0)
        self.set_fill_color(255, 245, 230)
        self.multi_cell(self.w - self.l_margin - self.r_margin, 5.5, text, fill=True)
        self.ln(1)

    def ok(self, text):
        if self.get_y() > 265:
            self.add_page()
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(0, 120, 0)
        self.set_fill_color(235, 255, 235)
        self.multi_cell(self.w - self.l_margin - self.r_margin, 5.5, text, fill=True)
        self.ln(1)

    def table(self, headers, rows, col_widths=None):
        if col_widths is None:
            n = len(headers)
            col_widths = [190 / n] * n
        # header
        if self.get_y() > 250:
            self.add_page()
        self.set_font("Helvetica", "B", 9)
        self.set_fill_color(20, 60, 120)
        self.set_text_color(255, 255, 255)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 7, h, border=1, fill=True)
        self.ln()
        # rows
        self.set_font("Helvetica", "", 9)
        self.set_text_color(30, 30, 30)
        fill = False
        for row in rows:
            if self.get_y() > 272:
                self.add_page()
                self.set_font("Helvetica", "B", 9)
                self.set_fill_color(20, 60, 120)
                self.set_text_color(255, 255, 255)
                for i, h in enumerate(headers):
                    self.cell(col_widths[i], 7, h, border=1, fill=True)
                self.ln()
                self.set_font("Helvetica", "", 9)
                self.set_text_color(30, 30, 30)
            if fill:
                self.set_fill_color(245, 245, 250)
            else:
                self.set_fill_color(255, 255, 255)
            # compute row height for multi-line cells
            max_lines = 1
            for i, cell in enumerate(row):
                lines = self.multi_cell(col_widths[i], 6, str(cell), dry_run=True, output="LINES")
                max_lines = max(max_lines, len(lines))
            h = max(6, max_lines * 6)
            x0 = self.get_x()
            y0 = self.get_y()
            for i, cell in enumerate(row):
                x = x0 + sum(col_widths[:i])
                self.set_xy(x, y0)
                self.multi_cell(col_widths[i], 6, str(cell), border=1, fill=True)
            self.set_xy(x0, y0 + h)
            fill = not fill
        self.ln(2)


pdf = AuditPDF()
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.set_margins(10, 15, 10)

# ============ COVER ============
pdf.cover()

# ============ TOC ============
pdf.add_page()
pdf.h1("Table of Contents")
toc = [
    "1. Executive Summary",
    "2. Architecture Overview",
    "3. Technology Stack & Versions",
    "4. Database Schema (61 Models, 17 Enums)",
    "5. Entity-Relationship Map",
    "6. Indexes & Constraints",
    "7. Tenant Isolation",
    "8. Authentication Flow",
    "9. Authorization & Permission Systems",
    "10. Lead Lifecycle & Workflow",
    "11. Round Robin Assignment",
    "12. Owner History",
    "13. CRM Object Flows (Contacts, Accounts, Customers)",
    "14. Sales Flows (Site Visits, Opportunities, Quotations, Bookings, Payments)",
    "15. Projects, Units & Tasks",
    "16. Reports & Dashboards",
    "17. Metadata / Custom Objects (Object Manager)",
    "18. Notifications",
    "19. Search",
    "20. Audit Logging",
    "21. AI Service",
    "22. Super Admin / Multi-Tenant Admin",
    "23. Frontend Structure & Route Protection",
    "24. Sidebar & Navigation",
    "25. API Route Inventory & Middleware Coverage",
    "26. Security Audit",
    "27. Performance Analysis",
    "28. Data Dictionary",
    "29. Consistency Issues",
    "30. Migrations & Seed Data",
    "31. Environment & Configuration",
    "32. Testing",
    "33. Git History",
    "34. Recommended Fixes (Prioritized)",
    "35. Validation Results",
]
for item in toc:
    pdf.bullet(item)

# ============ 1. EXEC SUMMARY ============
pdf.add_page()
pdf.h1("1. Executive Summary")
pdf.body(
    "DCT-CRMM is a multi-tenant CRM platform built as an npm-workspaces monorepo: a Next.js 14 frontend, "
    "an Express.js + TypeScript API backed by Prisma/PostgreSQL, a Python FastAI microservice, and shared "
    "Zod schema packages. The system supports lead lifecycle management, sales pipeline, projects/units, "
    "reports, custom objects, and a configurable Round Robin assignment engine."
)
pdf.body(
    "This report covers the full stack A-Z: 61 Prisma models, ~260 API endpoints across 40+ route files, "
    "two parallel permission systems, workflow-driven lead statuses, tenant isolation, security posture, "
    "and performance characteristics. Validation at time of report: 46/46 E2E tests pass, TypeScript "
    "strict mode clean on both apps, Prisma schema valid, pushed at commit 1d1111c."
)
pdf.h2("Key Strengths")
pdf.ok("Multi-tenant isolation enforced via tenantId scoping in queries and JWT claims.")
pdf.ok("Workflow engine constrains lead status transitions per profile.")
pdf.ok("Owner history and audit logs capture record mutations.")
pdf.ok("Round Robin is config-driven (DB) with admin UI.")
pdf.ok("Strict TypeScript on both API and Web; Zod validation on input.")
pdf.h2("Key Risks")
pdf.warn("Several metadata/admin routes authenticate but skip authorize()/requirePermission.")
pdf.warn("No Prisma versioned migrations (db push + ad-hoc SQL only).")
pdf.warn("No Next.js middleware - all frontend route protection is client-side.")
pdf.warn("Round Robin cursor stored in Queue.description without transactional locking.")
pdf.warn("Two parallel permission systems (legacy PermissionSet JSON + new Permission catalog).")
pdf.warn("AIMessage lacks onDelete relation; potential orphaned rows.")

# ============ 2. ARCHITECTURE ============
pdf.add_page()
pdf.h1("2. Architecture Overview")
pdf.body(
    "Monorepo with npm workspaces (apps/*, packages/*). Three deployable services and two shared packages:"
)
pdf.table(
    ["Layer", "Path", "Role"],
    [
        ["Frontend", "apps/web", "Next.js 14 App Router, React 18, Tailwind, client-side auth"],
        ["API", "apps/api", "Express 4 + TypeScript, JWT auth, Prisma via @dct-crm/db"],
        ["AI", "apps/ai", "FastAPI + OpenAI, chat/conversation endpoints"],
        ["DB", "packages/db", "Prisma schema, client singleton, seed scripts"],
        ["Shared", "packages/shared", "Zod schemas shared between web and api"],
    ],
    [30, 45, 115],
)
pdf.h2("Request Flow")
pdf.code(
    "Browser -> Next.js (client auth context)\n"
    "        -> /api/proxy/[...path] or direct API (localhost:3001)\n"
    "        -> Express: cookie/JWT parse -> authenticate -> authorize/requirePermission\n"
    "        -> Prisma (packages/db) -> PostgreSQL (port 5432, dct_crm)\n"
    "        -> optional AI service (FastAPI) for chat"
)
pdf.h2("Server Entry")
pdf.body(
    "apps/api/src/index.ts mounts 47 route modules. Helmet, CORS, rate-limit, morgan, cookie-parser "
    "are applied globally. API must be started with npx tsx src/index.ts (node dist path breaks dotenv resolution)."
)

# ============ 3. TECH STACK ============
pdf.add_page()
pdf.h1("3. Technology Stack & Versions")
pdf.table(
    ["Package", "Version / Notes"],
    [
        ["next", "14.2.3"],
        ["react / react-dom", "18.x"],
        ["typescript", "5.4.5 (strict: true both apps)"],
        ["express", "4.19.2"],
        ["@prisma/client / prisma", "5.14.0"],
        ["jsonwebtoken", "9.0.2"],
        ["bcryptjs / bcrypt", "2.4.3 / 6.0.0"],
        ["zod", "3.23.5"],
        ["helmet / cors / express-rate-limit", "7.1.0 / 2.8.5 / 7.2.0"],
        ["axios", "1.6.8"],
        ["recharts", "2.12.4"],
        ["@tanstack/react-table", "8.15.0"],
        ["react-hook-form + @hookform/resolvers", "7.51.3 / 3.3.4"],
        ["@hello-pangea/dnd", "18.0.1"],
        ["vitest", "1.6.0 (api + web)"],
        ["fastapi (ai)", "0.111.0"],
        ["openai (ai)", "1.30.1"],
        ["sqlalchemy / asyncpg (ai)", "2.0.30 / 0.29.0"],
    ],
    [80, 110],
)

# ============ 4. DATABASE ============
pdf.add_page()
pdf.h1("4. Database Schema")
pdf.kv("File", "packages/db/prisma/schema.prisma (~1700 lines)")
pdf.kv("Models", "61")
pdf.kv("Enums", "17")
pdf.kv("@@index count", "142")
pdf.kv("@@unique count", "43")
pdf.kv("onDelete: Cascade", "36")
pdf.kv("@relation count", "158")
pdf.kv("Native Prisma migrations", "None (prisma db push + ad-hoc SQL scripts)")
pdf.ln(2)
pdf.h2("Enums (17)")
enums = [
    ("SharingModel", "PRIVATE, PUBLIC_READ_ONLY, PUBLIC_READ_WRITE"),
    ("SharingAccessLevel", "READ, EDIT"),
    ("LeadStatus", "NEW, INCOMING, PROSPECT, SITE_VISIT_SCHEDULED, SITE_VISIT_HAPPENED, SALES, OPPORTUNITY, QUOTATION, APPROVAL, BOOKING, DUPLICATE, LOST, BOOKED (13 values)"),
    ("LeadSource", "WEBSITE, REFERRAL, COLD_CALL, ADVERTISEMENT, WALK_IN, PORTAL, INSTAGRAM, TWITTER, WHATSAPP, YOUTUBE, OTHER"),
    ("Salutation", "MR, MS, MRS, DR, PROF"),
    ("Industry", "TECHNOLOGY, HEALTHCARE, FINANCE, EDUCATION, MANUFACTURING, RETAIL, REAL_ESTATE, CONSTRUCTION, HOSPITALITY, AUTOMOTIVE, ENERGY, TELECOMMUNICATIONS, MEDIA, GOVERNMENT, OTHER"),
    ("Rating", "HOT, WARM, COLD"),
    ("SiteVisitStatus", "SCHEDULED, CONFIRMED, COMPLETED, NO_SHOW, CANCELLED, RESCHEDULED"),
    ("OpportunityStage", "PROSPECTING, QUALIFICATION, NEEDS_ANALYSIS, PROPOSAL, NEGOTIATION, CLOSED_WON, CLOSED_LOST"),
    ("QuotationStatus", "DRAFT, SUBMITTED, APPROVED, REJECTED, EXPIRED"),
    ("ApprovalStatus", "PENDING, APPROVED, REJECTED"),
    ("BookingStatus", "PENDING, CONFIRMED, CANCELLED, COMPLETED"),
    ("PaymentStatus", "PENDING, VERIFIED, REJECTED, PARTIAL, COMPLETED"),
    ("UnitStatus", "AVAILABLE, HOLD, RESERVED, BOOKED, SOLD, BLOCKED"),
    ("TaskStatus", "PENDING, IN_PROGRESS, COMPLETED, CANCELLED"),
    ("TaskPriority", "LOW, MEDIUM, HIGH, URGENT"),
    ("ActivityType", "CALL, MEETING, WHATSAPP, EMAIL, SITE_VISIT, NOTE, TASK, FOLLOW_UP, SYSTEM"),
]
for name, vals in enums:
    pdf.kv(name, vals, indent=6)
pdf.ln(2)
pdf.h2("Models (61)")
models = [
    "Tenant, User, Role, UserRole, Profile",
    "PermissionSet, PermissionSetRole, Permission, NewPermissionSet, NewPermissionSetItem",
    "UserProfilePermission, UserPermissionAssignment, UserDirectPermission",
    "ProfileObjectPermission, ProfileFieldPermission",
    "PermissionSetObjectPermission, PermissionSetFieldPermission",
    "PermissionSetGroup, PermissionSetGroupItem, UserPermissionSetGroup",
    "Queue, ObjectSharingSetting, SharingRule, RecordShare, RecordTeamMember",
    "Lead, Contact, Account, Customer",
    "SiteVisit, Opportunity, Quotation, QuotationItem, Approval, Booking, Payment",
    "Project, Unit, Task, FollowUp, Activity, Notification",
    "Workflow, Automation, ReportFolder, Report, Dashboard, AuditLog",
    "AIConversation, AIMessage",
    "ObjectDefinition, FieldDefinition, PicklistValue, PageLayout",
    "ObjectPermission, FieldPermission, CustomRecord",
    "Sequence, LeadOwnerHistory, RoundRobinMember, RoundRobinConfig",
]
for m in models:
    pdf.bullet(m, indent=6)
pdf.ln(1)
pdf.h2("Models lacking tenantId (14)")
pdf.body(
    "Tenant (is the tenant), UserRole, PermissionSetRole, Permission, NewPermissionSetItem, "
    "UserProfilePermission, UserPermissionAssignment, UserDirectPermission, "
    "PermissionSetObjectPermission, PermissionSetFieldPermission, PermissionSetGroupItem, "
    "UserPermissionSetGroup, QuotationItem, AIMessage. "
    "Several others (ProfileObjectPermission, FieldDefinition, PicklistValue, ObjectPermission, "
    "FieldPermission) carry tenantId as a plain scalar with no tenant relation."
)

# ============ 5. ER MAP ============
pdf.add_page()
pdf.h1("5. Entity-Relationship Map")
pdf.h2("Core CRM")
pdf.code(
    "Tenant 1---* User *---* Role (via UserRole)\n"
    "Tenant 1---* Profile\n"
    "User *---1 Profile\n"
    "Tenant 1---* Lead 1---* LeadOwnerHistory *---1 User\n"
    "Lead *---* Contact (optional)\n"
    "Lead 1---* SiteVisit *---1 Project\n"
    "Lead 1---* Opportunity 1---* Quotation 1---* QuotationItem\n"
    "Quotation 1---* Approval\n"
    "Lead/Quotation 1---* Booking 1---* Payment\n"
    "Project 1---* Unit\n"
    "User 1---* Task / FollowUp / Activity / Notification"
)
pdf.h2("Metadata / Object Manager")
pdf.code(
    "Tenant 1---* ObjectDefinition 1---* FieldDefinition 1---* PicklistValue\n"
    "ObjectDefinition 1---* PageLayout\n"
    "ObjectDefinition 1---* ObjectPermission / FieldPermission\n"
    "ObjectDefinition 1---* CustomRecord (dynamic data)"
)
pdf.h2("Permissions (two systems)")
pdf.code(
    "LEGACY: PermissionSet (JSON) *---* Role *---* User\n"
    "NEW:    NewPermissionSet 1---* NewPermissionSetItem *---1 Permission\n"
    "        UserDirectPermission, UserProfilePermission,\n"
    "        PermissionSetObject/FieldPermission, *PermissionSetGroup*"
)
pdf.h2("Round Robin")
pdf.code(
    "Tenant 1---* RoundRobinConfig (unique [tenantId, poolType])\n"
    "Tenant 1---* RoundRobinMember (pool membership)\n"
    "Cursor stored in Queue.description as '{poolType}_ROUND_ROBIN' index"
)

# ============ 6. INDEXES ============
pdf.add_page()
pdf.h1("6. Indexes & Constraints")
pdf.body(
    "142 @@index and 43 @@unique declarations. Key patterns: composite indexes on [tenantId, ...] for "
    "list queries, unique [tenantId, poolType] on RoundRobinConfig, unique lead numbers via Sequence."
)
pdf.h2("Cascade Deletes")
pdf.body("36 relations use onDelete: Cascade (e.g., QuotationItem via Quotation, AuditLog children).")
pdf.warn("AIMessage has NO onDelete on its AIConversation relation - risk of orphaned messages.")
pdf.h2("Known Index Additions (performance pass)")
pdf.bullet("Lead: [tenantId, status], [tenantId, ownerId], [tenantId, createdAt]")
pdf.bullet("Activity/FollowUp/Task: [tenantId, dueDate], [tenantId, ownerId]")
pdf.bullet("AuditLog: [tenantId, createdAt], [objectType, objectId]")
pdf.bullet("Notification: [userId, isRead]")

# ============ 7. TENANT ISOLATION ============
pdf.add_page()
pdf.h1("7. Tenant Isolation")
pdf.body(
    "Tenancy is enforced by: (1) JWT claim tenantId set at login, (2) authenticate middleware copying "
    "req.tenantId, (3) route handlers adding where.tenantId = req.tenantId on queries."
)
pdf.h2("Mechanics")
pdf.bullet("Super Admin (isSuperAdmin) bypasses tenant filter and sees all tenants.")
pdf.bullet("Non-superadmin queries always scope by tenantId (leads, contacts, etc.).")
pdf.bullet("Profile-based status scoping further restricts which LeadStatus values a profile can see.")
pdf.bullet("Tenant active + companyStartDate/ExpiryDate checked in auth middleware (403 if expired).")
pdf.h2("Gaps")
pdf.warn("Models without tenantId (see Section 4) rely on parent joins for isolation.")
pdf.warn("dynamicCrud.ts has authenticate only - custom object records depend on handler-level scoping.")
pdf.warn("No database-level RLS (Row Level Security); isolation is application-enforced only.")

# ============ 8. AUTH FLOW ============
pdf.add_page()
pdf.h1("8. Authentication Flow")
pdf.h2("Login")
pdf.code(
    "POST /api/auth/login { email, password }\n"
    " -> bcrypt compare -> JWT signed with JWT_SECRET\n"
    "    claims: { id, email, tenantId, isSuperAdmin, impersonatedBy }\n"
    " -> httpOnly cookie 'token' (24h, sameSite=lax, secure in prod)\n"
    " -> returns user + profile + permissions"
)
pdf.h2("Request Authentication (middleware/auth.ts)")
pdf.bullet("Token from req.cookies.token OR Authorization: Bearer header.")
pdf.bullet("Verifies JWT; loads user + profile + tenant from DB (one query per request).")
pdf.bullet("Rejects inactive user; rejects if tenant inactive or company expired (unless superadmin).")
pdf.bullet("Sets req.user = { id, email, tenantId, isSuperAdmin, impersonatedBy, profileId, profileName, isAdmin } and req.tenantId.")
pdf.h2("Frontend")
pdf.bullet("No middleware.ts - auth is client-side (auth-context) + API proxy.")
pdf.bullet("GET /api/auth/me revalidates session.")
pdf.bullet("Impersonation: POST /api/users/:id/impersonate sets impersonatedBy claim; stop via POST /api/auth/stop-impersonation.")
pdf.h2("Test Credentials")
pdf.kv("Super Admin", "superadmin@dctcrm.com / password123")
pdf.kv("Admin", "admin@dctcrm.com / password123 (DCT Real Estate)")
pdf.kv("Other users", "salesmanager@, priya@, amit@, neha@, finance@dctcrm.com / password123")

# ============ 9. AUTHZ ============
pdf.add_page()
pdf.h1("9. Authorization & Permission Systems")
pdf.body("Two parallel systems are active:")
pdf.h2("System A: Legacy PermissionSet")
pdf.bullet("PermissionSet stores JSON permissions; linked to Roles via PermissionSetRole.")
pdf.bullet("Seeded: 20 CRM objects x 2 profiles (Full Access + Standard Access).")
pdf.h2("System B: New Permission Catalog")
pdf.bullet("Permission (catalog) + NewPermissionSet + NewPermissionSetItem.")
pdf.bullet("Fine-grained: UserDirectPermission, UserProfilePermission, ProfileObject/FieldPermission, PermissionSetObject/FieldPermission, PermissionSetGroup*.")
pdf.bullet("Resolved by EffectivePermissionService (effectivePermissions.ts).")
pdf.h2("Middleware")
pdf.code(
  "requirePermission(name):\n"
  "  - 401 if no user\n"
  "  - BYPASS entirely if isSuperAdmin || isAdmin\n"
  "  - else EffectivePermissionService.requirePermission(userId, name)\n"
  "  - 403 if denied\n"
  "authorize(): used on CRM routes (leads, contacts, ...)\n"
  "requireSuperAdmin: admin.ts, companies.ts"
)
pdf.h2("Coverage Gaps")
pdf.warn("Auth-only (no authorize/requirePermission): ai, dynamicCrud, fieldDefinitions, fieldPermissions, notifications, objectDefinitions, objectPermissions, pageLayouts, picklistValues, roundRobin GETs, search, personal-settings.")
pdf.warn("objectDefinitions imports authorize but never calls it.")

# ============ 10. LEAD LIFECYCLE ============
pdf.add_page()
pdf.h1("10. Lead Lifecycle & Workflow")
pdf.h2("Status Enum vs Workflow")
pdf.body(
    "LeadStatus enum has 13 values; workflow uses 7: NEW, INCOMING, PROSPECT, "
    "SITE_VISIT_SCHEDULED, SITE_VISIT_HAPPENED, BOOKED, LOST."
)
pdf.h2("Allowed Transitions (workflow.ts)")
pdf.table(
    ["From", "To", "Allowed Profiles"],
    [
        ["NEW", "INCOMING", "Marketing, Presales, Admin, CRM Admin"],
        ["INCOMING", "PROSPECT", "Presales, Admin, CRM Admin"],
        ["INCOMING", "LOST", "Presales, Recovery, Admin, CRM Admin"],
        ["PROSPECT", "SITE_VISIT_SCHEDULED", "SVC, Admin, CRM Admin"],
        ["SITE_VISIT_SCHEDULED", "SITE_VISIT_HAPPENED", "SVC, Sales, Admin, CRM Admin"],
        ["SITE_VISIT_HAPPENED", "BOOKED", "CRM, Sales, Admin, CRM Admin"],
        ["BOOKED", "(terminal)", "-"],
        ["LOST", "INCOMING (recovery)", "Recovery, Admin, CRM Admin"],
    ],
    [45, 55, 90],
)
pdf.h2("Round Robin Integration in Lead Flow")
pdf.bullet("POST /api/leads: no ownerId -> getNextPresalesUser() (PRESALES pool); failures swallowed silently.")
pdf.bullet("POST /:id/push-to-svc: requires INCOMING -> getNextSVCUser(); txn: status=PROSPECT, owner, history, audit, notification.")
pdf.bullet("POST /:id/schedule-site-visit: requires PROSPECT -> getNextSalesUser(); txn: SiteVisit + status=SITE_VISIT_SCHEDULED.")
pdf.bullet("PUT /:id/assign: manual owner change with cross-tenant guard + history + audit.")
pdf.h2("Lead Numbers")
pdf.body("Sequence upsert in transaction; format LN000001.")

# ============ 11. ROUND ROBIN ============
pdf.add_page()
pdf.h1("11. Round Robin Assignment")
pdf.h2("Data Model")
pdf.bullet("RoundRobinConfig: poolType, name, profileName, description, isActive; unique [tenantId, poolType].")
pdf.bullet("RoundRobinMember: user membership per pool.")
pdf.bullet("Seeded 3 defaults: PRESALES, SVC, SALES for DCT Real Estate tenant.")
pdf.h2("API (mounted /api/round-robin)")
pdf.table(
    ["Method", "Path", "Notes"],
    [
        ["GET", "/configs", "List configs"],
        ["POST", "/configs", "Create (admin check)"],
        ["DELETE", "/configs/:id", "Soft-delete (admin check)"],
        ["GET", "/:poolType", "Pool detail (line 158)"],
        ["GET", "/", "Grouped configs + members"],
        ["POST", "/", "Add member (admin check)"],
        ["DELETE", "/:id", "Remove member (admin check)"],
        ["GET", "/eligible/:poolType", "Eligible users (line 317)"],
    ],
    [25, 70, 95],
)
pdf.h2("Service (services/roundRobin.ts)")
pdf.bullet("getNextPresalesUser / getNextSVCUser / getNextSalesUser / getNextUserByPool(tenantId, poolType).")
pdf.bullet("Cursor: index stored in Queue.description as '{poolType}_ROUND_ROBIN'; nextIndex = (last+1) % len.")
pdf.bullet("Members ordered createdAt asc; active users only; queue row created if missing.")
pdf.h2("Issues")
pdf.warn("GET /eligible/:poolType registered after GET /:poolType - fragile; bare GET /eligible is captured as poolType='eligible'.")
pdf.warn("No locking/transaction around cursor read-modify-write - race under concurrency.")
pdf.warn("Round Robin failures on lead create are silently swallowed (catch {}).")
pdf.h2("UI")
pdf.body("setup/customization/round-robin: New Round Robin button, create dialog (poolType/name/description/profile), config-driven rendering, delete with active-member guard.")

# ============ 12. OWNER HISTORY ============
pdf.add_page()
pdf.h1("12. Owner History")
pdf.body(
    "LeadOwnerHistory records every owner change: leadId, previousOwnerId, newOwnerId, changedById, "
    "reason, createdAt. Written inside transactions alongside the owner update for:"
)
pdf.bullet("Round Robin auto-assignment (push-to-svc, schedule-site-visit, create).")
pdf.bullet("Manual assign (PUT /api/leads/:id/assign).")
pdf.bullet("Exposed via GET /api/leads/:id/owner-history.")
pdf.body("Ensures full audit trail of lead ownership across the lifecycle.")

# ============ 13. CRM FLOWS ============
pdf.h1("13. CRM Object Flows")
pdf.h2("Contacts / Accounts / Customers")
pdf.body(
    "Standard CRUD (GET /, GET /:id, POST /, PUT /:id, DELETE /:id) with authenticate + authorize per route. "
    "Tenant-scoped queries. Accounts list includes capacity data for superadmin company views."
)
pdf.h2("Companies (Super Admin)")
pdf.body(
    "Mounted at /api/super-admin; requireSuperAdmin. CRUD + activate/deactivate + logo upload/download "
    "multer + capacity get/put + package put. Capacity N+1 fixed in prior performance pass."
)

# ============ 14. SALES FLOWS ============
pdf.add_page()
pdf.h1("14. Sales Flows")
pdf.table(
    ["Object", "Endpoints", "Key Transitions"],
    [
        ["SiteVisit", "CRUD + PATCH /:id/complete", "SCHEDULED -> COMPLETED / NO_SHOW / CANCELLED"],
        ["Opportunity", "CRUD + PATCH /:id/stage", "7-stage pipeline to CLOSED_WON/LOST"],
        ["Quotation", "CRUD + submit/approve/reject", "DRAFT -> SUBMITTED -> APPROVED/REJECTED"],
        ["Approval", "Linked to quotation", "PENDING -> APPROVED/REJECTED"],
        ["Booking", "CRUD + confirm/cancel", "PENDING -> CONFIRMED/COMPLETED"],
        ["Payment", "CRUD + verify/refund", "PENDING -> VERIFIED/PARTIAL/COMPLETED"],
        ["Unit", "CRUD + PATCH /:id/status", "AVAILABLE -> HOLD/RESERVED/BOOKED/SOLD"],
    ],
    [35, 70, 85],
)
pdf.body("All use authenticate + authorize, tenant-scoped, with audit logging on mutations.")

# ============ 15. PROJECTS/TASKS ============
pdf.h1("15. Projects, Units & Tasks")
pdf.bullet("Projects: CRUD; seed creates DCT Heights/Valley/Paradise with 30 units each (90 total).")
pdf.bullet("Tasks: CRUD + status + assign; TaskStatus/TaskPriority enums; dueDate indexed.")
pdf.bullet("FollowUps: CRUD + complete/reopen; my-tasks view for current user.")
pdf.bullet("Activities: CRUD + complete; ActivityType enum (CALL, MEETING, WHATSAPP, etc.).")

# ============ 16. REPORTS ============
pdf.h1("16. Reports & Dashboards")
pdf.h2("Reports")
pdf.body(
    "report-metadata.ts defines available report types; report-engine.ts executes them. "
    "Endpoints: metadata, run, CRUD, move folder, export, execute. ReportFolder sub-router for folders."
)
pdf.h2("Dashboards")
pdf.body(
    "Dashboard CRUD with widgets. POST /:id/widgets/:widgetId/data computes one widget per call - "
    "a dashboard with N widgets fans out N requests (boundary-level N+1). "
    "Metrics: counts, payment.aggregate, lead.groupBy, opportunity.groupBy, recentActivities, topOwners "
    "(topOwners correctly batched). No caching. Unbounded skip/take with raw sortBy (orderBy injection risk)."
)

# ============ 17. METADATA ============
pdf.add_page()
pdf.h1("17. Metadata / Custom Objects")
pdf.body("Object Manager powers custom objects:")
pdf.bullet("ObjectDefinition + FieldDefinition + PicklistValue + PageLayout.")
pdf.bullet("ObjectPermission / FieldPermission gate field access per profile.")
pdf.bullet("CustomRecord stores dynamic data for custom objects (e.g., Property with 10 fields).")
pdf.bullet("dynamicCrud.ts (/api/records/:objectName) provides generic CRUD for CustomRecords.")
pdf.h2("Routes & Gaps")
pdf.body(
    "fieldDefinitions, fieldPermissions, objectDefinitions, objectPermissions, pageLayouts, "
    "picklistValues, dynamicCrud all use authenticate only - no authorize/requirePermission at "
    "router level. objectDefinitions imports authorize but never calls it."
)
pdf.warn("Metadata mutation endpoints are reachable by any authenticated user.")

# ============ 18. NOTIFICATIONS ============
pdf.h1("18. Notifications")
pdf.body(
    "In-app notifications: list, unread-count, mark read, read-all, delete, clear-all. "
    "Created inside lead workflow transactions (assignment, status change). "
    "Authenticate only - correctly user-scoped by userId; no authorize needed for self-notifications."
)

# ============ 19. SEARCH ============
pdf.h1("19. Search")
pdf.body(
    "GET /api/search and /quick - global search across CRM objects. Authenticate only; "
    "should scope by tenant + permissions (verify handler-level filtering)."
)

# ============ 20. AUDIT ============
pdf.h1("20. Audit Logging")
pdf.body(
    "AuditLog model + middleware/audit.ts + routes/audit.ts. Endpoints: list, by id, "
    "by object (objectType/objectId), by user, summary. Written in transactions for lead mutations, "
    "round robin changes, config changes. Queryable per tenant."
)

# ============ 21. AI ============
pdf.add_page()
pdf.h1("21. AI Service")
pdf.body(
    "apps/ai: FastAPI + OpenAI. Models: AIConversation (tenant-scoped) + AIMessage. "
    "Endpoints: list conversations, get conversation, chat, send, delete. "
    "Authenticate only (JWT via python-jose)."
)
pdf.warn("AIMessage lacks onDelete on AIConversation relation - deleting a conversation may orphan messages.")

# ============ 22. SUPER ADMIN ============
pdf.h1("22. Super Admin / Multi-Tenant Admin")
pdf.body(
    "admin.ts (requireSuperAdmin): tenant CRUD, activate/deactivate, stats. "
    "companies.ts (requireSuperAdmin): company CRUD, logos, capacity, packages. "
    "Impersonation flow: superadmin can impersonate users; JWT carries impersonatedBy; "
    "stop-impersonation endpoint restores original session."
)

# ============ 23. FRONTEND ============
pdf.add_page()
pdf.h1("23. Frontend Structure & Route Protection")
pdf.h2("App Router Layout")
pdf.code(
    "apps/web/src/app/\n"
    "  (dashboard)/           # Authenticated shell + sidebar\n"
    "    leads/ contacts/ accounts/ customers/\n"
    "    site-visits/ opportunities/ quotations/ bookings/ payments/\n"
    "    projects/ tasks/ reports/\n"
    "    setup/               # Admin setup incl. round-robin\n"
    "  api/auth/  api/proxy/[...path]/"
)
pdf.h2("Route Protection")
pdf.warn("No middleware.ts exists - all protection is client-side (auth-context redirects).")
pdf.bullet("Dashboard pages check session on mount; redirect to login if absent.")
pdf.bullet("Sidebar nav items gated by permissions (LEAD_READ, SITE_VISIT_READ, etc.).")
pdf.bullet("API remains protected server-side (JWT + authorize).")
pdf.h2("Performance Notes (applied)")
pdf.bullet("Search inputs debounced.")
pdf.bullet("Duplicate layout file removed.")
pdf.bullet("Site visit list over-fetch fixed (pagination).")
pdf.bullet("Dashboard memoized; toast delay fixed.")

# ============ 24. SIDEBAR ============
pdf.h1("24. Sidebar & Navigation")
pdf.h2("Super Admin / Admin")
pdf.body(
    "Dashboard; Companies (superadmin only); CRM {Leads, Contacts, Accounts, Customers}; "
    "Sales {Site Visits, Opportunities, Quotations, Bookings, Payments}; Projects; Tasks; Reports; "
    "Setup {Setup Home}."
)
pdf.h2("Regular Users (permission-gated)")
pdf.body(
    "Dashboard; Leads (LEAD_READ); Site Visits (SITE_VISIT_READ); Opportunities (OPPORTUNITY_READ); "
    "Quotations (QUOTATION_READ); Bookings (BOOKING_READ); Payments (PAYMENT_READ); "
    "Projects (PROJECT_READ); Tasks (TASK_READ); Reports (REPORT_VIEW)."
)
pdf.ok("Duplicate Custom Objects nav entry removed (functionality in Object Manager untouched).")

# ============ 25. ROUTE INVENTORY ============
pdf.add_page()
pdf.h1("25. API Route Inventory & Middleware Coverage")
pdf.body("40+ route files, ~260 handlers, 47 mounts in index.ts.")
pdf.h2("Fully Covered (authenticate + authorize or requirePermission)")
pdf.body(
    "accounts, activities, analytics, audit, auth, bookings, contacts, customers, dashboards, "
    "followUps, leads, opportunities, payments, permissionCatalog, permissionSets, "
    "profilePermissions, profiles, profileSecurity, projects, quotations, reports, roles, "
    "siteVisits, tasks, units, userPermissions, users, workflows, company-settings."
)
pdf.h2("Super-Admin Gated (instead of authorize)")
pdf.body("admin, companies - requireSuperAdmin.")
pdf.h2("Authenticate Only - NO authorize/requirePermission")
pdf.table(
    ["Route File", "Risk"],
    [
        ["dynamicCrud", "Custom record CRUD for any authenticated user"],
        ["fieldDefinitions", "Field schema mutation"],
        ["fieldPermissions", "Field permission mutation"],
        ["objectDefinitions", "Object schema mutation (imports unused authorize)"],
        ["objectPermissions", "Object permission mutation"],
        ["pageLayouts", "Layout mutation"],
        ["picklistValues", "Picklist mutation"],
        ["roundRobin (GETs)", "Pool reads; mutations use in-handler admin check"],
        ["ai", "AI conversation access (user-scoped in handler)"],
        ["notifications", "User-scoped (acceptable)"],
        ["search", "Should scope results by permission"],
        ["personal-settings", "Self-scoped (acceptable)"],
    ],
    [60, 130],
)

# ============ 26. SECURITY ============
pdf.add_page()
pdf.h1("26. Security Audit")
pdf.h2("Strengths")
pdf.ok("JWT + httpOnly cookies; bcrypt cost 12.")
pdf.ok("Helmet, CORS allowlist, express-rate-limit, morgan logging.")
pdf.ok("Tenant isolation in queries; superadmin separate gating.")
pdf.ok("Zod validation on input; workflow status machine.")
pdf.ok("Audit trail on sensitive mutations.")
pdf.h2("Findings")
pdf.warn("CRITICAL: Metadata routes (object/field/layout/picklist/permission definitions) lack authorize - any authenticated user can mutate schema.")
pdf.warn("HIGH: dynamicCrud lacks authorize - depends entirely on handler scoping.")
pdf.warn("HIGH: No frontend middleware.ts - client-side only route guards (API still protected).")
pdf.warn("MEDIUM: requirePermission bypasses entirely for isAdmin (coarse).")
pdf.warn("MEDIUM: orderBy uses raw sortBy (potential column injection in leads, dashboards).")
pdf.warn("MEDIUM: Lead create swallows Round Robin errors silently.")
pdf.warn("LOW: AIMessage no onDelete; orphan risk.")
pdf.warn("LOW: Two permission systems increase confusion/attack surface review complexity.")
pdf.h2("Not Done / Recommended")
pdf.bullet("Add authorize/requirePermission to all metadata + dynamicCrud routes.")
pdf.bullet("Whitelist sortBy columns or map to safe fields.")
pdf.bullet("Add Next.js middleware for edge route protection.")
pdf.bullet("Consider Postgres RLS as defense-in-depth.")
pdf.bullet("Rate-limit auth endpoints aggressively; audit login failures.")

# ============ 27. PERFORMANCE ============
pdf.add_page()
pdf.h1("27. Performance Analysis")
pdf.h2("Applied Optimizations (prior passes)")
pdf.bullet("Auth middleware: reduced user query fields / single query.")
pdf.bullet("Dashboard: groupBy + Promise.all batching; topOwners batched (not per-row).")
pdf.bullet("15+ DB indexes on hot list filters (tenantId+status, ownerId, dueDate, createdAt).")
pdf.bullet("Dynamic CRUD dedup; permissions middleware rewrite.")
pdf.bullet("Search debounce (frontend); duplicate layout removal.")
pdf.bullet("Site visit over-fetch fix; pagination limits (accounts cap 100).")
pdf.bullet("Dashboard memoization; toast delay fix; leads route cleanup.")
pdf.bullet("Companies capacity N+1 fix.")
pdf.h2("Remaining Concerns")
pdf.warn("Dashboard widget data: N widgets = N HTTP calls; no server-side cache.")
pdf.warn("Leads GET: no max cap on limit (accounts caps at 100).")
pdf.warn("Raw sortBy in orderBy (leads, dashboards) - injection + missing index risk.")
pdf.warn("Auth does a DB query per request (user+profile+tenant) - consider short TTL cache.")
pdf.warn("Round Robin cursor update not transactional - contention risk.")
pdf.warn("Prisma connection pool untuned (defaults only in packages/db/src/index.ts).")

# ============ 28. DATA DICTIONARY ============
pdf.add_page()
pdf.h1("28. Data Dictionary (Key Entities)")
pdf.table(
    ["Entity", "Key Fields", "Relations"],
    [
        ["Tenant", "name, slug, currency, timezone, isActive", "1-* User, Lead, Project, ..."],
        ["User", "email, passwordHash, tenantId, profileId, isSuperAdmin, isActive", "*-1 Profile, 1-* Role"],
        ["Profile", "name, isAdmin, isDefault", "1-* User"],
        ["Lead", "leadNumber (LN######), status, source, rating, ownerId, tenantId", "*-1 Owner, 1-* SiteVisit"],
        ["LeadOwnerHistory", "leadId, prev/next ownerId, changedById, reason", "*-1 Lead"],
        ["RoundRobinConfig", "poolType, name, profileName, isActive", "unique [tenantId, poolType]"],
        ["Contact", "name, email, phone, accountId, tenantId", "*-1 Account"],
        ["Opportunity", "stage, value, closeDate, leadId", "*-1 Lead"],
        ["Quotation", "status, total, leadId", "1-* QuotationItem, 1-* Approval"],
        ["Booking", "status, unitId, leadId", "1-* Payment"],
        ["Project", "name, location", "1-* Unit"],
        ["Unit", "unitNumber, status, price", "*-1 Project"],
        ["ObjectDefinition", "name, label, isCustom", "1-* FieldDefinition, 1-* CustomRecord"],
        ["AuditLog", "action, objectType, objectId, userId, tenantId", "indexed [tenantId, createdAt]"],
    ],
    [40, 85, 65],
)

# ============ 29. CONSISTENCY ============
pdf.add_page()
pdf.h1("29. Consistency Issues")
pdf.table(
    ["#", "Issue", "Severity"],
    [
        ["1", "Two parallel permission systems (legacy JSON + new catalog)", "High"],
        ["2", "Metadata routes missing authorize()", "Critical"],
        ["3", "dynamicCrud authenticate-only", "High"],
        ["4", "No Prisma versioned migrations (db push + ad-hoc SQL)", "High"],
        ["5", "No Next.js middleware.ts (client-only guards)", "Medium"],
        ["6", "Round Robin route order fragile (GET /:poolType before literals)", "Medium"],
        ["7", "Round Robin cursor in Queue.description without locking", "Medium"],
        ["8", "LeadStatus enum (13) vs workflow (7) mismatch", "Medium"],
        ["9", "AIMessage no onDelete", "Medium"],
        ["10", "Raw sortBy in orderBy (leads, dashboards)", "Medium"],
        ["11", "14 models lack tenantId (join-dependent isolation)", "Medium"],
        ["12", "requirePermission bypass for all isAdmin", "Medium"],
        ["13", "Leads limit uncapped (accounts caps 100)", "Low"],
        ["14", "objectDefinitions imports unused authorize", "Low"],
        ["15", "Silent catch on Round Robin failure at lead create", "Low"],
        ["16", "Dashboard N-widget fan-out (N API calls)", "Low"],
        ["17", "No Prisma pool tuning", "Low"],
        ["18", "apps/web has no .env.example", "Low"],
    ],
    [10, 145, 35],
)

# ============ 30. MIGRATIONS ============
pdf.h1("30. Migrations & Seed Data")
pdf.h2("Migrations (packages/db/migrations/ - 16 ad-hoc files)")
pdf.body(
    "add_company_fields, check-schema, check-statuses, check_perms, cleanup_final/temp/tenant/test, "
    "create-company-b, final_cleanup, increase-capacity, migrate-lead-statuses, "
    "populate_company_fields, seed-permissions.ts, seed-profiles, set_admin_profiles. "
    "NO prisma/migrations/ directory - schema applied via prisma db push."
)
pdf.warn("No versioned migration history - hard to reproduce environments or roll back.")
pdf.h2("Seed (packages/db/src/seed.ts, 678 lines)")
pdf.bullet("1 tenant (DCT Real Estate), 5 roles, 2 profiles, 20x2 PermissionSets, 6 users.")
pdf.bullet("1 Queue, 3 Projects, 90 Units, 150 Leads (+ visits/opps/bookings), 3 Reports, 1 Dashboard.")
pdf.bullet("Metadata: 10 ObjectDefinitions, custom Property object (10 fields), picklists, layouts, 3 CustomRecords.")
pdf.bullet("Other seeds: seed-profiles, seed-super-admin, seed-layouts, seed-lead-fields, repair-admin-access.")

# ============ 31. ENV ============
pdf.h1("31. Environment & Configuration")
pdf.body("Variables (names only) present in root .env, .env.example, apps/api/.env, packages/db/.env:")
pdf.code(
    "DATABASE_URL\nJWT_SECRET\nJWT_EXPIRES_IN\nCORS_ORIGIN\nPORT\nNODE_ENV\n"
    "OPENAI_API_KEY\nNODE_API_URL\nPUBLIC_API_BASE_URL\nALLOWED_API_HOSTS\nTRUST_PROXY"
)
pdf.bullet("apps/api/.env.example missing.")
pdf.bullet("Customer API links resolve at runtime from PUBLIC_API_BASE_URL or a validated request host.")
pdf.bullet("TS strict: true on both apps; no extra flags (noUncheckedIndexedAccess off).")

# ============ 32. TESTING ============
pdf.h1("32. Testing")
pdf.bullet("test_final.ps1 (261 lines, root): 11 sections, ~46 assertions - 46/46 PASS.")
pdf.bullet("Sections: Login, Lead Number, Presales Workflow, SVC Workflow, Admin Full Access, Status Note, Push-to-SVC, Follow-Up, Task, Note, Site Visit, Tenant Isolation.")
pdf.bullet("Vitest configured in apps/api and apps/web.")
pdf.bullet("users.validation.test.ts for user validation.")
pdf.bullet("Related: test_db.js, test_login.js, test_req.js, test_profiles.ps1.")
pdf.ok("Latest run: 46/46 E2E PASS after Round Robin + sidebar changes.")

# ============ 33. GIT ============
pdf.h1("33. Git History")
pdf.code(
    "origin  https://github.com/Dhananchezhiyan-A/DCT-CRMM\n"
    "branch  main (tracks origin/main)\n\n"
    "1d1111c feat: Round Robin config-driven + Sidebar cleanup (latest, pushed)\n"
    "84625c6 feat: configurable Round Robin - admin UI, DB-driven pools\n"
    "376e76f feat: post-merge repair - schema, TS, Super Admin, workflow\n"
    "c79f2c3 feat: admin sidebar, security hardening, permission seed\n"
    "bec31be feat: Lead Status progression stepper"
)

# ============ 34. RECOMMENDED FIXES ============
pdf.add_page()
pdf.h1("34. Recommended Fixes (Prioritized)")
pdf.h2("P0 - Critical")
pdf.bullet("Add authorize()/requirePermission to ALL metadata routes: objectDefinitions, fieldDefinitions, picklistValues, pageLayouts, objectPermissions, fieldPermissions, dynamicCrud.")
pdf.bullet("Fix objectDefinitions unused authorize import by actually applying it.")
pdf.h2("P1 - High")
pdf.bullet("Add Next.js middleware.ts for edge route protection (defense-in-depth beyond client checks).")
pdf.bullet("Introduce versioned Prisma migrations (prisma migrate) to replace ad-hoc SQL + db push.")
pdf.bullet("Whitelist/map sortBy columns in leads + dashboards orderBy to prevent injection.")
pdf.bullet("Cap leads GET limit (e.g., max 100) like accounts.")
pdf.bullet("Add onDelete (Cascade or SetNull) to AIMessage -> AIConversation.")
pdf.h2("P2 - Medium")
pdf.bullet("Reorder Round Robin routes: register literal paths (GET /eligible/:poolType, GET /configs) before GET /:poolType.")
pdf.bullet("Wrap Round Robin cursor update in a transaction with row-level lock (or dedicated counter table).")
pdf.bullet("Unify permission systems (migrate legacy PermissionSet JSON consumers to new catalog) or document ownership.")
pdf.bullet("Log (not swallow) Round Robin failures on lead create; fall back to unassigned + notify admin.")
pdf.bullet("Align LeadStatus enum with workflow (deprecate unused values or extend workflow).")
pdf.bullet("Scope tenantId on remaining scalar-only models via relations; document join-based isolation.")
pdf.h2("P3 - Low")
pdf.bullet("Cache auth user/profile/tenant lookup briefly (e.g., 30-60s) to cut per-request DB hits.")
pdf.bullet("Batch dashboard widget data (single endpoint returning all widgets) or add short cache.")
pdf.bullet("Tune Prisma pool (connection_limit) in datasource.")
pdf.bullet("Add .env.example for apps/api and apps/web.")
pdf.bullet("Tighten requirePermission: avoid blanket isAdmin bypass or audit admin actions more heavily.")

# ============ 35. VALIDATION ============
pdf.add_page()
pdf.h1("35. Validation Results")
pdf.ok("Prisma schema validate: PASS")
pdf.ok("apps/api TypeScript (tsc --noEmit): 0 errors")
pdf.ok("apps/web TypeScript (tsc --noEmit): 0 errors")
pdf.ok("E2E test_final.ps1: 46/46 PASS")
pdf.ok("Git: committed 1d1111c, pushed to origin/main")
pdf.ok("Working tree: clean (only tsbuildinfo noise)")
pdf.ln(4)
pdf.h2("Runtime")
pdf.kv("API", "localhost:3001 (start: npx tsx src/index.ts)")
pdf.kv("Web", "localhost:3000")
pdf.kv("DB", "PostgreSQL localhost:5432 / dct_crm")
pdf.kv("AI", "FastAPI (apps/ai)")
pdf.ln(6)
pdf.set_font("Helvetica", "I", 10)
pdf.set_text_color(100, 100, 100)
pdf.multi_cell(0, 6,
    "End of report. Generated from live codebase inspection at commit 1d1111c. "
    "No code was modified during report generation."
)

out = r"C:\Users\jay\Desktop\Projects\Projects\DCT-CRMM\DCT-CRMM\DCT-CRMM-Audit-Report.pdf"
pdf.output(out)
print(f"PDF written: {out}")
