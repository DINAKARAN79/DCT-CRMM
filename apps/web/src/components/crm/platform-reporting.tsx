"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { platformReportingApi } from "@/lib/api";

type Section =
  | "dashboard"
  | "dashboards"
  | "dashboard-detail"
  | "reports"
  | "report-builder"
  | "report-detail"
  | "objects"
  | "tenants";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface RegistryField {
  name: string;
  type: string;
  nullable?: boolean;
  enumValues?: string[];
}

interface RegistryObject {
  name: string;
  scope: "tenant" | "global";
  fields: RegistryField[];
  relations?: Array<{ name: string; target: string; fields: RegistryField[] }>;
}

interface TenantOption {
  id: string;
  name: string;
  isActive?: boolean;
}

interface PlatformMetricCard {
  id: string;
  label: string;
  value: number;
  recordCount: number;
  currency?: string;
}

interface SavedDefinition {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  definition?: Record<string, unknown> & { widgets?: DashboardWidget[] };
  createdAt?: string;
  updatedAt?: string;
}

interface QueryDefinition extends Record<string, unknown> {
  model: string;
  tenantIds?: string[];
  fields?: string[];
  filters: Array<{ field: string; operator: string; value: unknown }>;
  filterLogic?: "AND" | "OR";
  groupBy?: string[];
  aggregates?: Array<{ operation: string; field?: string }>;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page: number;
  pageSize: number;
}

interface DashboardWidget extends Record<string, unknown> {
  id: string;
  title: string;
  query: QueryDefinition;
  width?: number;
  height?: number;
}

interface BuilderFilter {
  field: string;
  operator: string;
  value: string;
}

async function responseData<T>(request: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success || response.data.data === undefined) {
    throw new Error(response.data.error || response.data.message || "The reporting request failed.");
  }
  return response.data.data;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response;
    return response?.data?.error || response?.data?.message || "The reporting request failed.";
  }
  return error instanceof Error ? error.message : "The reporting request failed.";
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-5 rounded-xl border border-sky-100 bg-sky-50/60 p-5 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}

function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;
  return <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>;
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="p-5 text-sm text-slate-500">No results for this scope.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-sky-50 text-xs uppercase text-sky-800">
          <tr>{columns.map((column) => <th key={column} className="border-b px-3 py-2">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || index)} className="border-b last:border-0">
              {columns.map((column) => (
                <td key={column} className="max-w-72 truncate px-3 py-2" title={String(row[column] ?? "")}>
                  {row[column] == null ? "—" : String(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resultRows(value: Record<string, unknown> | null) {
  const nested = value?.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : value;
  if (Array.isArray(nested?.records)) return nested.records as Array<Record<string, unknown>>;
  if (Array.isArray(nested?.rows)) return nested.rows as Array<Record<string, unknown>>;
  if (Array.isArray(nested?.groups)) {
    return (nested.groups as Array<{ by: Record<string, unknown>; values: Record<string, unknown> }>)
      .map((group) => ({ ...group.by, ...group.values }));
  }
  return [];
}

export function PlatformReporting({ section }: { section: Section }) {
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const id = params?.id;
  const editReportId = section === "report-builder" ? searchParams.get("edit") : null;
  const [registry, setRegistry] = React.useState<RegistryObject[]>([]);
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [reports, setReports] = React.useState<SavedDefinition[]>([]);
  const [dashboards, setDashboards] = React.useState<SavedDefinition[]>([]);
  const [currentDashboard, setCurrentDashboard] = React.useState<SavedDefinition | null>(null);
  const [overview, setOverview] = React.useState<Record<string, unknown> | null>(null);
  const [metricCards, setMetricCards] = React.useState<PlatformMetricCard[]>([]);
  const [showMetricHint, setShowMetricHint] = React.useState(false);
  const [leadByTenant, setLeadByTenant] = React.useState<Array<{ tenantId: string; tenantName: string; leadCount: number }>>([]);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [objectName, setObjectName] = React.useState("");
  const [selectedFields, setSelectedFields] = React.useState<string[]>([]);
  const [scopeMode, setScopeMode] = React.useState<"all" | "selected">("all");
  const [selectedTenantIds, setSelectedTenantIds] = React.useState<string[]>([]);
  const [groupBy, setGroupBy] = React.useState("");
  const [aggregation, setAggregation] = React.useState("count");
  const [aggregationField, setAggregationField] = React.useState("");
  const [builderFilters, setBuilderFilters] = React.useState<BuilderFilter[]>([
    { field: "", operator: "contains", value: "" },
  ]);
  const [filterLogic, setFilterLogic] = React.useState<"AND" | "OR">("AND");
  const [sortField, setSortField] = React.useState("");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [widgetReportId, setWidgetReportId] = React.useState("");

  const toggleTenantSelection = (tenantId: string, checked: boolean) => {
    if (checked && selectedTenantIds.length >= 500) {
      setError("A report can compare up to 500 selected tenants at a time.");
      return;
    }
    setError(null);
    setSelectedTenantIds((ids) => checked
      ? ids.includes(tenantId) ? ids : [...ids, tenantId]
      : ids.filter((id) => id !== tenantId));
  };

  const loadRegistry = React.useCallback(async () => {
    const data = await responseData<{ models: RegistryObject[] }>(platformReportingApi.registry());
    const items = data.models;
    setRegistry(items);
    if (!objectName && items.length) setObjectName(items[0].name);
  }, [objectName]);

  const loadTenants = React.useCallback(async () => {
    const firstPage = await responseData<{ items: TenantOption[]; total: number; pageSize: number }>(platformReportingApi.tenants({ page: 1, pageSize: 200 }));
    const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
    const remainingPages = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      responseData<{ items: TenantOption[] }>(platformReportingApi.tenants({ page: index + 2, pageSize: 200 })),
    ));
    setTenants([...firstPage.items, ...remainingPages.flatMap((page) => page.items)]);
  }, []);

  const loadSavedDefinitions = React.useCallback(async () => {
    const [reportData, dashboardData] = await Promise.all([
      responseData<{ items: SavedDefinition[] }>(platformReportingApi.reports()),
      responseData<{ items: SavedDefinition[] }>(platformReportingApi.dashboards()),
    ]);
    setReports(reportData.items);
    setDashboards(dashboardData.items);
  }, []);

  React.useEffect(() => {
    let active = true;
    setError(null);
    if (section === "dashboard-detail") {
      setCurrentDashboard(null);
      setResult(null);
    }
    const load = async () => {
      try {
        await Promise.all([loadRegistry(), loadTenants()]);
        if (section === "dashboard") {
          const [data, tenantData, metricData] = await Promise.all([
            responseData<Record<string, unknown>>(platformReportingApi.overview()),
            responseData<{ items: Array<{ tenantId: string; tenantName: string; leadCount: number }> }>(platformReportingApi.tenantAnalytics()),
            responseData<{ cards: PlatformMetricCard[] }>(platformReportingApi.metricCards()),
          ]);
          if (active) {
            setOverview(data);
            setLeadByTenant(tenantData.items);
            setMetricCards(metricData.cards);
          }
        }
        if (section === "reports" || section === "dashboards" || section === "dashboard-detail") await loadSavedDefinitions();
        if ((section === "report-detail" && id) || editReportId) {
          const reportId = section === "report-detail" ? id! : editReportId!;
          const report = await responseData<SavedDefinition>(platformReportingApi.report(reportId));
          if (active) {
            setName(report.name);
            setDescription(report.description || "");
            if (report.definition) {
              const definition = report.definition as Partial<QueryDefinition>;
              setObjectName(definition.model || "");
              setSelectedFields(definition.fields || []);
              setSelectedTenantIds(definition.tenantIds || []);
              setScopeMode(definition.tenantIds ? "selected" : "all");
              setGroupBy(definition.groupBy?.[0] || "");
              setAggregation(definition.aggregates?.[0]?.operation || "count");
              setAggregationField(definition.aggregates?.[0]?.field || "");
              setSortField(definition.sortBy || "");
              setSortDirection(definition.sortOrder || "asc");
              setBuilderFilters(definition.filters?.length
                ? definition.filters.map((filter) => ({ field: filter.field, operator: filter.operator, value: String(filter.value ?? "") }))
                : [{ field: "", operator: "contains", value: "" }]);
              setFilterLogic(definition.filterLogic === "OR" ? "OR" : "AND");
            }
          }
        }
        if (section === "dashboard-detail" && id) {
          const dashboard = await responseData<SavedDefinition>(platformReportingApi.dashboard(id));
          const firstWidget = dashboard.definition?.widgets?.[0];
          const tenantIds = firstWidget?.query.tenantIds || [];
          if (active) {
            setCurrentDashboard(dashboard);
            setName(dashboard.name);
            setDescription(dashboard.description || "");
            setScopeMode(tenantIds.length ? "selected" : "all");
            setSelectedTenantIds(tenantIds);
            if (dashboard.definition?.widgets?.length) {
              const dashboardResult = await responseData<Record<string, unknown>>(
                platformReportingApi.runDashboard(id, {
                  mode: tenantIds.length ? "selected" : "all",
                  tenantIds,
                }),
              );
              if (active) setResult(dashboardResult);
            }
          }
        }
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      }
    };
    void load();
    return () => { active = false; };
  }, [editReportId, id, loadRegistry, loadSavedDefinitions, loadTenants, section]);

  React.useEffect(() => {
    if (section !== "dashboard") return;
    const key = "platform-report-metric-hint-seen";
    if (window.localStorage.getItem(key)) return;
    setShowMetricHint(true);
    window.localStorage.setItem(key, "true");
  }, [section]);

  React.useEffect(() => {
    if (section !== "report-builder" || editReportId || !registry.length) return;
    const requestedObject = searchParams.get("object");
    if (requestedObject && registry.some((object) => object.name === requestedObject)) {
      setObjectName(requestedObject);
    }
  }, [editReportId, registry, searchParams, section]);

  const selectedObject = registry.find((item) => item.name === objectName);
  const scalarFields = selectedObject?.fields || [];
  const groupableFields = [
    ...scalarFields,
    ...((selectedObject?.scope === "tenant" && selectedObject.relations?.some((relation) => relation.target === "Tenant"))
      ? [{ name: "tenant.name", type: "String", nullable: false }]
      : []),
  ];
  const availableFields = [
    ...scalarFields,
    ...(selectedObject?.relations || []).flatMap((relation) => {
      const target = registry.find((item) => item.name === relation.target);
      return (target?.fields || []).map((field) => ({
        ...field,
        name: `${relation.name}.${field.name}`,
      }));
    }),
  ];

  const typedFilterValue = (fieldName: string, operator: string, value: string) => {
    if (operator === "isNull") return value === "true";
    const field = availableFields.find((candidate) => candidate.name === fieldName);
    const convert = (entry: string): string | number | boolean => {
      if (field?.type === "Int" || field?.type === "Float" || field?.type === "Decimal") return Number(entry);
      if (field?.type === "Boolean") return entry === "true" ? true : entry === "false" ? false : entry;
      return entry;
    };
    return operator === "in" || operator === "notIn"
      ? value.split(",").map((entry) => convert(entry.trim()))
      : convert(value);
  };

  const makeQuery = (): QueryDefinition => ({
    model: objectName,
    tenantIds: scopeMode === "all" ? undefined : selectedTenantIds,
    fields: selectedFields.length ? selectedFields : undefined,
    filters: builderFilters.filter((filter) => filter.field).map(({ field, operator, value }) => ({
      field,
      operator,
      value: typedFilterValue(field, operator, value),
    })),
    filterLogic,
    groupBy: groupBy ? [groupBy] : undefined,
    aggregates: groupBy ? [{ operation: aggregation, field: aggregation === "count" && !aggregationField ? undefined : aggregationField || undefined }] : undefined,
    sortBy: sortField || undefined,
    sortOrder: sortDirection,
    page: 1,
    pageSize: 100,
  });

  const runQuery = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await responseData<Record<string, unknown>>(platformReportingApi.query(makeQuery()));
      setResult(data);
    } catch (queryError) {
      setError(getErrorMessage(queryError));
    } finally {
      setBusy(false);
    }
  };

  const saveReport = async () => {
    setBusy(true);
    setError(null);
    try {
      const definition = {
        name: name.trim(),
        description: description.trim() || undefined,
        definition: makeQuery(),
      };
      const saved = editReportId
        ? await responseData<SavedDefinition>(platformReportingApi.updateReport(editReportId, definition))
        : await responseData<SavedDefinition>(platformReportingApi.createReport(definition));
      window.location.assign(`/platform-reporting/reports/${saved.id}`);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const updateSavedReport = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await responseData(platformReportingApi.updateReport(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        definition: makeQuery(),
      }));
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const createDashboard = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await responseData<SavedDefinition>(platformReportingApi.createDashboard({
        name: name.trim(),
        description: description.trim() || undefined,
        definition: { widgets: [] },
      }));
      window.location.assign(`/platform-reporting/dashboards/${saved.id}`);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const deleteDefinition = async (kind: "report" | "dashboard", definition: SavedDefinition) => {
    if (definition.isSystem || !window.confirm(`Delete "${definition.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "report") await responseData(platformReportingApi.deleteReport(definition.id));
      else await responseData(platformReportingApi.deleteDashboard(definition.id));
      await loadSavedDefinitions();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const duplicateDefinition = async (kind: "report" | "dashboard", definition: SavedDefinition) => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "report") await responseData(platformReportingApi.duplicateReport(definition.id));
      else await responseData(platformReportingApi.duplicateDashboard(definition.id));
      await loadSavedDefinitions();
    } catch (duplicateError) {
      setError(getErrorMessage(duplicateError));
    } finally {
      setBusy(false);
    }
  };

  const runSavedReport = async (reportId: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await responseData<Record<string, unknown>>(platformReportingApi.runReport(reportId));
      setResult(data);
    } catch (runError) {
      setError(getErrorMessage(runError));
    } finally {
      setBusy(false);
    }
  };

  const runSavedDashboard = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const data = await responseData<Record<string, unknown>>(platformReportingApi.runDashboard(id, {
        mode: scopeMode,
        tenantIds: selectedTenantIds,
      }));
      setResult(data);
    } catch (runError) {
      setError(getErrorMessage(runError));
    } finally {
      setBusy(false);
    }
  };

  const updateDashboard = async () => {
    if (!id || !currentDashboard) return;
    setBusy(true);
    setError(null);
    try {
      const widgets = currentDashboard.definition?.widgets || [];
      const saved = await responseData<SavedDefinition>(platformReportingApi.updateDashboard(id, {
        name: name.trim(),
        description: description.trim() || undefined,
        definition: {
          widgets: widgets.map((widget) => ({
            ...widget,
            query: {
              ...widget.query,
              tenantIds: scopeMode === "all" ? undefined : selectedTenantIds,
            },
          })),
        },
      }));
      setCurrentDashboard(saved);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const addDashboardWidget = () => {
    if (!currentDashboard || !reports.length) return;
    const report = reports.find((item) => item.id === widgetReportId) || reports[0];
    if (!report.definition) {
      setError("The selected report has no saved query definition.");
      return;
    }
    const widgets = currentDashboard.definition?.widgets || [];
    const query = report.definition as QueryDefinition;
    setCurrentDashboard({
      ...currentDashboard,
      definition: {
        ...currentDashboard.definition,
        widgets: [
          ...widgets,
          {
            id: crypto.randomUUID(),
            title: report.name,
            query: {
              ...query,
              tenantIds: scopeMode === "all" ? undefined : selectedTenantIds,
            },
            width: 6,
            height: 3,
          },
        ],
      },
    });
  };

  const updateWidget = (index: number, patch: Record<string, unknown>) => {
    if (!currentDashboard) return;
    const widgets = currentDashboard.definition?.widgets || [];
    setCurrentDashboard({
      ...currentDashboard,
      definition: {
        ...currentDashboard.definition,
        widgets: widgets.map((widget, widgetIndex) => widgetIndex === index ? { ...widget, ...patch } : widget),
      },
    });
  };

  const moveWidget = (index: number, direction: -1 | 1) => {
    if (!currentDashboard) return;
    const widgets = [...(currentDashboard.definition?.widgets || [])];
    const target = index + direction;
    if (target < 0 || target >= widgets.length) return;
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    setCurrentDashboard({
      ...currentDashboard,
      definition: { ...currentDashboard.definition, widgets },
    });
  };

  const contentRows = resultRows(result);
  const maxLeadCount = Math.max(1, ...leadByTenant.map((tenant) => tenant.leadCount));
  const sectionTitles: Record<Section, { title: string; description: string }> = {
    dashboard: { title: "Platform Dashboard", description: "Application-wide metrics across the canonical database, independent of tenant dashboard settings." },
    dashboards: { title: "Dashboard Management", description: "Manage platform-level dashboard definitions and widgets." },
    "dashboard-detail": { title: name || "Platform Dashboard", description: "Preview and manage this independent platform dashboard." },
    reports: { title: "Report Management", description: "Create, run, duplicate, and manage platform-wide reports." },
    "report-builder": { title: "Report Builder", description: "Build a validated report from registered objects and fields." },
    "report-detail": { title: name || "Platform Report", description: "Run or export this saved platform report." },
    objects: { title: "Object Explorer", description: "Explore reportable Prisma objects, approved fields, and safe relationships." },
    tenants: { title: "Tenant Analytics", description: "Compare report metrics for one or more selected companies." },
  };
  const title = sectionTitles[section];

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-4">
      <PageTitle eyebrow="Super Admin · Platform Reporting" title={title.title} description={title.description} />
      <ErrorMessage error={error} />

      {section === "dashboard" && (
        <section className="space-y-4">
          {showMetricHint && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Click any card to see the records behind that metric.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview && metricCards.map((card) => {
              const amount = card.currency
                ? new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: /^[A-Z]{3}$/.test(card.currency) ? card.currency : "INR",
                    maximumFractionDigits: 2,
                  }).format(card.value)
                : new Intl.NumberFormat().format(card.value);
              return (
                <Link
                  key={card.id}
                  href={`/platform-reporting/report/${encodeURIComponent(card.id)}`}
                  aria-label={`View report: ${card.label}, ${amount}`}
                  className="group rounded-xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{card.label}</span>
                    <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-sky-700" />
                  </span>
                  <span className="mt-2 block text-2xl font-bold text-slate-900 dark:text-slate-100">{amount}</span>
                  <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">View report</span>
                </Link>
              );
            })}
            {!overview && !error && <p className="rounded-lg border bg-white p-5 text-sm text-slate-500">Loading platform metrics…</p>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {["Tenant", "User"].flatMap((name) => {
              const object = registry.find((entry) => entry.name === name);
              return object ? [object] : [];
            }).map((object) => (
              <Link key={object.name} href={`/platform-reporting/reports/new?object=${encodeURIComponent(object.name)}`} className="rounded-lg border bg-white p-4 text-sm font-medium text-sky-800 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800">
                Build report from {object.name}
              </Link>
            ))}
          </div>
          <section aria-label="Leads by company" className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-slate-900">Leads by company</h2>
            <p className="mb-4 text-xs text-slate-500">All-tenant lead counts from the platform reporting service.</p>
            <div className="space-y-3">
              {leadByTenant.slice().sort((left, right) => right.leadCount - left.leadCount).slice(0, 12).map((tenant) => (
                <div key={tenant.tenantId} className="grid grid-cols-[minmax(7rem,12rem)_1fr_3rem] items-center gap-3 text-sm">
                  <span className="truncate" title={tenant.tenantName}>{tenant.tenantName}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-sky-600" style={{ width: `${(tenant.leadCount / maxLeadCount) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums text-slate-600">{tenant.leadCount}</span>
                </div>
              ))}
              {!leadByTenant.length && <p className="text-sm text-slate-500">No tenant lead data available.</p>}
            </div>
          </section>
          <PlatformNavigation />
        </section>
      )}

      {section === "reports" && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">{reports.length} platform reports</p>
            <Link href="/platform-reporting/reports/new" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">New Report</Link>
          </div>
          {reports.map((report) => (
            <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
              <div><Link href={`/platform-reporting/reports/${report.id}`} className="font-semibold text-sky-800 hover:underline">{report.name}</Link><p className="text-xs text-slate-500">{report.description || "Platform report"}{report.isSystem ? " · System" : ""}</p></div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => void runSavedReport(report.id)} className="rounded border px-3 py-1.5 text-xs">Run</button>
                <button disabled={busy || report.isSystem} onClick={() => void duplicateDefinition("report", report)} className="rounded border px-3 py-1.5 text-xs">Duplicate</button>
                <button disabled={busy || report.isSystem} onClick={() => void deleteDefinition("report", report)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700">Delete</button>
              </div>
            </div>
          ))}
          {result && <DataTable rows={contentRows} />}
        </section>
      )}

      {section === "dashboards" && (
        <section className="space-y-4 rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input aria-label="Dashboard name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New dashboard name" className="h-10 rounded-md border px-3" />
            <input aria-label="Dashboard description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" className="h-10 rounded-md border px-3" />
            <button disabled={busy || !name.trim()} onClick={() => void createDashboard()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create Dashboard</button>
          </div>
          {dashboards.map((dashboard) => (
            <div key={dashboard.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
              <div><Link href={`/platform-reporting/dashboards/${dashboard.id}`} className="font-semibold text-sky-800 hover:underline">{dashboard.name}</Link><p className="text-xs text-slate-500">{dashboard.description || "Platform dashboard"}{dashboard.isSystem ? " · System" : ""}</p></div>
              <div className="flex gap-2">
                <Link href={`/platform-reporting/dashboards/${dashboard.id}`} className="rounded border px-3 py-1.5 text-xs">Open</Link>
                <button disabled={busy || dashboard.isSystem} onClick={() => void duplicateDefinition("dashboard", dashboard)} className="rounded border px-3 py-1.5 text-xs">Duplicate</button>
                <button disabled={busy || dashboard.isSystem} onClick={() => void deleteDefinition("dashboard", dashboard)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700">Delete</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {section === "report-builder" && (
        <section className="space-y-4 rounded-xl border bg-white p-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1 text-sm">Object
              <select aria-label="Report object" className="h-10 w-full rounded-md border px-3" value={objectName} onChange={(event) => { setObjectName(event.target.value); setSelectedFields([]); }}>
                {registry.map((object) => <option key={object.name} value={object.name}>{object.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">Scope
              <select aria-label="Tenant scope" className="h-10 w-full rounded-md border px-3" value={scopeMode} onChange={(event) => setScopeMode(event.target.value as "all" | "selected")}>
                <option value="all">All tenants</option><option value="selected">Selected tenants</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">Group by
              <select aria-label="Group by field" className="h-10 w-full rounded-md border px-3" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                <option value="">No grouping</option>{groupableFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">Aggregation
              <select aria-label="Aggregation" className="h-10 w-full rounded-md border px-3" value={aggregation} onChange={(event) => setAggregation(event.target.value)}>
                <option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option>
              </select>
            </label>
            {aggregation !== "count" && <label className="space-y-1 text-sm">Aggregation field
              <select aria-label="Aggregation field" className="h-10 w-full rounded-md border px-3" value={aggregationField} onChange={(event) => setAggregationField(event.target.value)}>
                <option value="">Choose field</option>{scalarFields.filter((field) => ["Int", "Float", "Decimal"].includes(field.type)).map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
              </select>
            </label>}
            <label className="space-y-1 text-sm">Sort field
              <select aria-label="Sort field" className="h-10 w-full rounded-md border px-3" value={sortField} onChange={(event) => setSortField(event.target.value)}>
                <option value="">Default order</option>{(groupBy ? groupableFields.filter((field) => field.name === groupBy) : scalarFields).map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
              </select>
            </label>
            {sortField && <label className="space-y-1 text-sm">Sort direction
              <select aria-label="Sort direction" className="h-10 w-full rounded-md border px-3" value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}>
                <option value="asc">Ascending</option><option value="desc">Descending</option>
              </select>
            </label>}
          </div>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Filters</legend>
            <div className="flex items-center gap-2 text-sm">
              <span>Match</span>
              <select aria-label="Filter group logic" value={filterLogic} onChange={(event) => setFilterLogic(event.target.value as "AND" | "OR")} className="rounded border px-2 py-1">
                <option value="AND">all conditions (AND)</option><option value="OR">any condition (OR)</option>
              </select>
            </div>
            {builderFilters.map((filter, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1.5fr_auto]">
                <select aria-label={`Filter ${index + 1} field`} value={filter.field} onChange={(event) => {
                  const field = availableFields.find((candidate) => candidate.name === event.target.value);
                  setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index
                    ? { ...item, field: event.target.value, operator: field && (field.type !== "String" || field.enumValues?.length) ? "equals" : item.operator }
                    : item));
                }} className="h-10 rounded-md border px-3">
                  <option value="">Choose field</option>{availableFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                </select>
                <select aria-label={`Filter ${index + 1} operator`} value={filter.operator} onChange={(event) => setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value } : item))} className="h-10 rounded-md border px-3">
                  <option value="equals">Equals</option><option value="not">Does not equal</option><option value="in">Is one of</option><option value="notIn">Is not one of</option><option value="contains">Contains</option><option value="startsWith">Starts with</option><option value="endsWith">Ends with</option><option value="gt">Greater than</option><option value="gte">On or after</option><option value="lt">Less than</option><option value="lte">On or before</option><option value="isNull">Is empty</option>
                </select>
                {filter.operator === "isNull"
                  ? <select aria-label={`Filter ${index + 1} value`} value={filter.value} onChange={(event) => setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="h-10 rounded-md border px-3"><option value="true">Is empty</option><option value="false">Is not empty</option></select>
                  : availableFields.find((field) => field.name === filter.field)?.enumValues?.length
                    ? <select aria-label={`Filter ${index + 1} value`} value={filter.value} onChange={(event) => setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="h-10 rounded-md border px-3">
                      <option value="">Choose value</option>{availableFields.find((field) => field.name === filter.field)?.enumValues?.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    : availableFields.find((field) => field.name === filter.field)?.type === "Boolean"
                      ? <select aria-label={`Filter ${index + 1} value`} value={filter.value} onChange={(event) => setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="h-10 rounded-md border px-3"><option value="">Choose value</option><option value="true">True</option><option value="false">False</option></select>
                      : <input
                    aria-label={`Filter ${index + 1} value`}
                    type={availableFields.find((field) => field.name === filter.field)?.type === "DateTime"
                      ? "date"
                      : ["Int", "Float", "Decimal"].includes(availableFields.find((field) => field.name === filter.field)?.type || "")
                        ? "number"
                        : "text"}
                    value={filter.value}
                    onChange={(event) => setBuilderFilters((filters) => filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                    className="h-10 rounded-md border px-3"
                    placeholder={["in", "notIn"].includes(filter.operator) ? "Comma-separated values" : "Value"}
                  />}
                <button type="button" disabled={builderFilters.length === 1} onClick={() => setBuilderFilters((filters) => filters.filter((_, itemIndex) => itemIndex !== index))} className="rounded-md border px-3 text-sm text-red-700 disabled:opacity-40">Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setBuilderFilters((filters) => [...filters, { field: "", operator: "equals", value: "" }])} className="rounded-md border px-3 py-1.5 text-xs">Add filter</button>
          </fieldset>

          {scopeMode === "selected" && (
            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Choose companies</legend>
              <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                {tenants.map((tenant) => (
                  <label key={tenant.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedTenantIds.includes(tenant.id)} onChange={(event) => toggleTenantSelection(tenant.id, event.target.checked)} />
                    {tenant.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Fields to include</legend>
            <div className="grid max-h-52 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-4">
              {scalarFields.map((field) => (
                <label key={field.name} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedFields.includes(field.name)} onChange={(event) => setSelectedFields((fields) => event.target.checked ? [...fields, field.name] : fields.filter((name) => name !== field.name))} />
                  {field.name}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <input aria-label="Report name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Report name (to save)" className="h-10 rounded-md border px-3" />
            <input aria-label="Report description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" className="h-10 rounded-md border px-3" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !objectName || (scopeMode === "selected" && !selectedTenantIds.length)} onClick={() => void runQuery()} className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Running…" : "Preview report"}</button>
            <button disabled={busy || !name.trim() || !objectName || (scopeMode === "selected" && !selectedTenantIds.length)} onClick={() => void saveReport()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{editReportId ? "Save changes" : "Save report"}</button>
          </div>
          {result && <div className="overflow-hidden rounded-lg border"><DataTable rows={contentRows} /></div>}
        </section>
      )}

      {section === "report-detail" && id && (
        <section className="space-y-4 rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Report name<input aria-label="Report name" value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border px-3" /></label>
            <label className="space-y-1 text-sm">Description<input aria-label="Report description" value={description} onChange={(event) => setDescription(event.target.value)} className="h-10 w-full rounded-md border px-3" /></label>
          </div>
          <p className="text-sm text-slate-600">Saved platform report · {objectName || "Object not selected"}</p>
          <div className="flex gap-2">
            <Link href={`/platform-reporting/reports/new?edit=${encodeURIComponent(id)}`} className="rounded-md border px-4 py-2 text-sm">Edit query</Link>
            <button disabled={busy} onClick={() => void runSavedReport(id)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Run report</button>
            <button disabled={busy || !name.trim()} onClick={() => void updateSavedReport()} className="rounded-md border px-4 py-2 text-sm">Save changes</button>
            <button disabled={busy} onClick={async () => {
              setBusy(true); setError(null);
              try {
                const response = await platformReportingApi.exportReport(id);
                const url = URL.createObjectURL(response.data);
                const anchor = document.createElement("a");
                anchor.href = url; anchor.download = `${name || "platform-report"}.csv`; anchor.click();
                URL.revokeObjectURL(url);
              } catch (exportError) { setError(getErrorMessage(exportError)); }
              finally { setBusy(false); }
            }} className="rounded-md border px-4 py-2 text-sm">Export CSV</button>
          </div>
          {result && <div className="overflow-hidden rounded-lg border"><DataTable rows={contentRows} /></div>}
        </section>
      )}

      {section === "dashboard-detail" && id && (
        <section className="space-y-4 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid min-w-[18rem] flex-1 gap-2 sm:grid-cols-2">
              <input aria-label="Dashboard name" value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-md border px-3" />
              <input aria-label="Dashboard description" value={description} onChange={(event) => setDescription(event.target.value)} className="h-10 rounded-md border px-3" />
            </div>
            <div className="flex gap-2">
              <button disabled={busy || currentDashboard?.isSystem} onClick={() => void updateDashboard()} className="rounded-md border px-4 py-2 text-sm font-semibold">Save dashboard</button>
              <button disabled={busy || (scopeMode === "selected" && !selectedTenantIds.length)} onClick={() => void runSavedDashboard()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Preview dashboard</button>
            </div>
          </div>
          <label className="block max-w-sm space-y-1 text-sm">Widget reporting scope
            <select aria-label="Dashboard reporting scope" disabled={currentDashboard?.isSystem} className="h-10 w-full rounded-md border px-3" value={scopeMode} onChange={(event) => setScopeMode(event.target.value as "all" | "selected")}>
              <option value="all">All tenants</option><option value="selected">Selected tenants</option>
            </select>
          </label>
          {scopeMode === "selected" && (
            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Dashboard tenant scope</legend>
              <div className="grid max-h-40 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                {tenants.map((tenant) => (
                  <label key={tenant.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" disabled={currentDashboard?.isSystem} checked={selectedTenantIds.includes(tenant.id)} onChange={(event) => toggleTenantSelection(tenant.id, event.target.checked)} />
                    {tenant.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div><h2 className="font-semibold">Dashboard widgets</h2><p className="text-xs text-slate-500">Widgets run saved platform reports and can be reordered or resized.</p></div>
            <div className="flex gap-2">
              <select aria-label="Select widget report" disabled={currentDashboard?.isSystem || !reports.length} value={widgetReportId} onChange={(event) => setWidgetReportId(event.target.value)} className="rounded-md border px-3 py-2 text-sm">
                <option value="">Choose report</option>{reports.map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}
              </select>
              <button disabled={busy || currentDashboard?.isSystem || !reports.length || (scopeMode === "selected" && !selectedTenantIds.length)} onClick={addDashboardWidget} className="rounded-md border px-3 py-2 text-sm">Add report widget</button>
            </div>
          </div>
          {(currentDashboard?.definition?.widgets || []).map((widget, index) => (
            <div key={String(widget.id || index)} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-center">
              <div><p className="font-medium">{widget.title}</p><p className="text-xs text-slate-500">Object: {widget.query.model}</p></div>
              <label className="text-xs">Width
                <select aria-label={`Widget ${index + 1} width`} disabled={currentDashboard?.isSystem} value={Number(widget.width || 6)} onChange={(event) => updateWidget(index, { width: Number(event.target.value) })} className="ml-2 rounded border p-1">
                  {[3, 4, 6, 8, 12].map((width) => <option key={width} value={width}>{width}/12</option>)}
                </select>
              </label>
              <label className="text-xs">Height
                <select aria-label={`Widget ${index + 1} height`} disabled={currentDashboard?.isSystem} value={Number(widget.height || 3)} onChange={(event) => updateWidget(index, { height: Number(event.target.value) })} className="ml-2 rounded border p-1">
                  {[2, 3, 4, 6].map((height) => <option key={height} value={height}>{height} rows</option>)}
                </select>
              </label>
              <div className="flex gap-1">
                <button aria-label={`Move widget ${index + 1} up`} disabled={index === 0 || currentDashboard?.isSystem} onClick={() => moveWidget(index, -1)} className="rounded border px-2 py-1">↑</button>
                <button aria-label={`Move widget ${index + 1} down`} disabled={index === (currentDashboard?.definition?.widgets?.length || 0) - 1 || currentDashboard?.isSystem} onClick={() => moveWidget(index, 1)} className="rounded border px-2 py-1">↓</button>
              </div>
              <button disabled={currentDashboard?.isSystem} onClick={() => setCurrentDashboard((dashboard) => dashboard ? {
                ...dashboard,
                definition: {
                  ...dashboard.definition,
                  widgets: (dashboard.definition?.widgets || []).filter((_, widgetIndex) => widgetIndex !== index),
                },
              } : dashboard)} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700">Remove</button>
            </div>
          ))}
          {currentDashboard?.isSystem && <p className="text-xs text-amber-700">System dashboards are protected from editing and deletion.</p>}
          {Array.isArray(result?.widgets) && <div className="space-y-3">
            {(result.widgets as Array<{ id: string; title: string; success: boolean; data?: Record<string, unknown>; error?: string }>).map((widget) => (
              <article key={widget.id} className="rounded-lg border p-3">
                <h3 className="font-semibold">{widget.title}</h3>
                {widget.success && widget.data
                  ? <DataTable rows={resultRows(widget.data)} />
                  : <p role="alert" className="mt-2 text-sm text-red-700">{widget.error || "Widget query failed."}</p>}
              </article>
            ))}
          </div>}
        </section>
      )}

      {section === "objects" && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {registry.map((object) => (
            <article key={object.name} className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold text-slate-900">{object.name}</h2><p className="text-xs text-slate-500">{object.name} · {object.scope === "tenant" ? "tenant-owned" : "platform-wide"}</p></div>
                <span className="rounded-full bg-sky-50 px-2 py-1 text-xs text-sky-800">{object.fields.length} fields</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">{object.fields.map((field) => <span key={field.name} title={`${field.name}: ${field.type}`} className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{field.name}</span>)}</div>
              {!!object.relations?.length && <p className="mt-3 text-xs text-slate-500">Safe relationships: {object.relations.map((relation) => `${relation.name} → ${relation.target}`).join(", ")}</p>}
            </article>
          ))}
          {!registry.length && !error && <p className="rounded-lg border bg-white p-5 text-sm text-slate-500">Loading the reportable object registry…</p>}
        </section>
      )}

      {section === "tenants" && (
        <section className="space-y-4 rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-600">Select tenants to compare lead counts. The reporting API validates the selected companies and aggregates the canonical lead records server-side.</p>
          <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((tenant) => (
              <label key={tenant.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                <input type="checkbox" checked={selectedTenantIds.includes(tenant.id)} onChange={(event) => toggleTenantSelection(tenant.id, event.target.checked)} />
                <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
                <span className={tenant.isActive ? "text-emerald-700" : "text-slate-500"}>{tenant.isActive ? "Active" : "Inactive"}</span>
              </label>
            ))}
          </div>
          <button disabled={busy || !selectedTenantIds.length || !registry.some((object) => object.name === "Lead")} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const data = await responseData<{ items: Array<Record<string, unknown>> }>(platformReportingApi.tenantAnalytics(selectedTenantIds));
              setResult(data);
            } catch (queryError) { setError(getErrorMessage(queryError)); }
            finally { setBusy(false); }
          }} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Compare lead counts</button>
          {result && <div className="overflow-hidden rounded-lg border"><DataTable rows={contentRows} /></div>}
        </section>
      )}

      {section !== "dashboard" && <PlatformNavigation />}
    </div>
  );
}

function PlatformNavigation() {
  const links = [
    ["Dashboard", "/platform-reporting"],
    ["Dashboards", "/platform-reporting/dashboards"],
    ["Reports", "/platform-reporting/reports"],
    ["Report Builder", "/platform-reporting/reports/new"],
    ["Objects", "/platform-reporting/objects"],
    ["Tenants", "/platform-reporting/tenants"],
  ] as const;
  return <nav aria-label="Platform reporting" className="flex flex-wrap gap-2">{links.map(([label, href]) => <Link key={href} href={href} className="rounded-md border bg-white px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-50">{label}</Link>)}</nav>;
}
