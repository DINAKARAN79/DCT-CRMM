"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Download, Save } from "lucide-react";
import { platformReportingApi } from "@/lib/api";

type Summary = {
  id: string;
  label: string;
  model: string;
  total: number;
  value: number;
  currency?: string;
  fields: string[];
  defaultFilters: Array<{ field: string; operator: string; value: unknown }>;
  defaultTenantIds?: string[];
  supportsOwnerFilter: boolean;
  supportsProjectFilter: boolean;
  companyBreakdown: Array<{ companyId: string; company: string; count: number; value?: number }>;
  companyBreakdownTruncated: boolean;
  statusBreakdown: Array<{ companyId: string; company: string; status: string; count: number }>;
  asOf: string;
};
type MetricRows = {
  records: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
  currency?: string;
};
type TenantOption = { id: string; name: string };
type Envelope<T> = { success: boolean; data?: T; error?: string; message?: string };

async function responseData<T>(request: Promise<{ data: Envelope<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success || response.data.data === undefined) {
    throw new Error(response.data.error || response.data.message || "The report request failed.");
  }
  return response.data.data;
}

function dateParam(value: string, endOfDay = false) {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`).toISOString();
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

export function PlatformMetricReport() {
  const params = useParams<{ metricId: string }>();
  const metricId = decodeURIComponent(params.metricId);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [result, setResult] = React.useState<MetricRows | null>(null);
  const [tenants, setTenants] = React.useState<TenantOption[]>([]);
  const [tenantSearch, setTenantSearch] = React.useState("");
  const [tenantPage, setTenantPage] = React.useState(1);
  const [tenantTotal, setTenantTotal] = React.useState(0);
  const [selectedCompanies, setSelectedCompanies] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [sort, setSort] = React.useState("");
  const [order, setOrder] = React.useState<"asc" | "desc">("desc");
  const [visibleColumns, setVisibleColumns] = React.useState<string[]>([]);
  const [selectedRecord, setSelectedRecord] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const queryParams = React.useMemo(() => ({
    page,
    pageSize,
    sort: sort || undefined,
    order,
    search: appliedSearch || undefined,
    companyIds: selectedCompanies.length ? selectedCompanies.join(",") : undefined,
    dateFrom: dateParam(dateFrom),
    dateTo: dateParam(dateTo, true),
    status: status || undefined,
    ownerId: ownerId || undefined,
    projectId: projectId || undefined,
  }), [appliedSearch, dateFrom, dateTo, order, ownerId, page, pageSize, projectId, selectedCompanies, sort, status]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextRows] = await Promise.all([
        responseData<Summary>(platformReportingApi.metricSummary(metricId, queryParams)),
        responseData<MetricRows>(platformReportingApi.metricRecords(metricId, queryParams)),
      ]);
      setSummary(nextSummary);
      setResult(nextRows);
      setVisibleColumns((current) => current.length
        ? current.filter((column) => ["company", ...Object.keys(nextRows.records[0] || {})].includes(column))
        : ["company", ...Object.keys(nextRows.records[0] || {})]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load metric report.");
    } finally {
      setLoading(false);
    }
  }, [metricId, queryParams]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void responseData<{ items: TenantOption[]; total: number }>(
        platformReportingApi.tenants({ page: tenantPage, pageSize: 100, search: tenantSearch.trim() || undefined }),
      )
        .then((response) => {
          if (!active) return;
          setTenantTotal(response.total);
          setTenants((current) => {
            const options = new Map<string, TenantOption>();
            [...current, ...response.items].forEach((tenant) => options.set(tenant.id, tenant));
            return [...options.values()];
          });
        })
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load companies."); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [tenantPage, tenantSearch]);

  const columns = React.useMemo(() => {
    const row = result?.records[0];
    return row ? ["company", ...Object.keys(row).filter((key) => key !== "company")] : ["company"];
  }, [result]);
  const changeFilter = (setValue: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setValue(event.target.value);
  };

  const exportReport = async (format: "csv" | "xlsx") => {
    setExporting(true);
    setError(null);
    try {
      const response = await platformReportingApi.exportMetric(metricId, format, queryParams);
      const blob = new Blob([response.data], { type: String(response.headers["content-type"] || "application/octet-stream") });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `platform-${metricId}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : `Unable to export ${format.toUpperCase()}.`);
    } finally {
      setExporting(false);
    }
  };

  const saveAsReport = async () => {
    if (!summary || !result) return;
    setSaving(true);
    setError(null);
    try {
      const selectedFields = columns.filter((column) => column !== "company" && column !== "tenantId");
      const filters: Array<{ field: string; operator: string; value: unknown }> = summary.defaultFilters
        .filter((filter) => !((dateFrom || dateTo) && filter.field === "createdAt"));
      if (dateFrom) filters.push({ field: "createdAt", operator: "gte", value: dateParam(dateFrom) });
      if (dateTo) filters.push({ field: "createdAt", operator: "lte", value: dateParam(dateTo, true) });
      if (status) filters.push({ field: summary.model === "Receipt" ? "approvalStatus" : "status", operator: "equals", value: status });
      if (ownerId) filters.push({ field: summary.model === "SiteVisit" ? "assigneeId" : "ownerId", operator: "equals", value: ownerId });
      if (projectId) filters.push({ field: "projectId", operator: "equals", value: projectId });
      if (appliedSearch) {
        const searchField = summary.fields.find((field) =>
          ["name", "leadNumber", "siteVisitNumber", "quotationNumber", "bookingNumber", "receiptNumber", "unitCode"].includes(field),
        );
        if (searchField) filters.push({ field: searchField, operator: "contains", value: appliedSearch });
      }
      await responseData(platformReportingApi.createReport({
        name: summary.label,
        description: `Saved from Platform Dashboard metric ${summary.label}.`,
        definition: {
          model: summary.model,
          tenantIds: selectedCompanies.length
            ? summary.defaultTenantIds
              ? selectedCompanies.filter((companyId) => summary.defaultTenantIds?.includes(companyId))
              : selectedCompanies
            : summary.defaultTenantIds,
          fields: selectedFields.length ? selectedFields : undefined,
          filters,
          sortBy: sort || undefined,
          sortOrder: order,
          page: 1,
          pageSize: 100,
        },
      }));
      window.location.assign("/platform-reporting/reports");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save this report.");
    } finally {
      setSaving(false);
    }
  };

  const totalPages = result ? Math.max(1, Math.ceil(Math.min(result.total, 50_000) / pageSize)) : 1;
  const formattedValue = summary?.currency && /^[A-Z]{3}$/.test(summary.currency)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: summary.currency, maximumFractionDigits: 2 }).format(summary.value)
    : new Intl.NumberFormat().format(summary?.value || 0);

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-4">
      <header className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Link href="/platform-reporting" className="inline-flex items-center gap-2 text-sm text-sky-700 hover:underline dark:text-sky-300">
          <ArrowLeft className="h-4 w-4" /> Platform Dashboard
        </Link>
        <nav aria-label="Breadcrumb" className="mt-3 text-xs text-slate-500">Platform Dashboard &gt; {summary?.label || "Loading metric"}</nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{summary?.label || "Platform metric report"}</h1>
            <p className="mt-1 text-sm text-slate-500">Read-only records from the canonical platform data.</p>
            {summary && <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formattedValue}</p>}
            {summary && <p className="mt-1 text-sm text-slate-500">{summary.total.toLocaleString()} matching records</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" onClick={() => void exportReport("csv")} disabled={exporting || loading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={() => void exportReport("xlsx")} disabled={exporting || loading} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
              <Download className="h-4 w-4" /> XLSX
            </button>
            <button type="button" onClick={() => void saveAsReport()} disabled={saving || !result} className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              <Save className="h-4 w-4" /> Save as report
            </button>
          </div>
        </div>
        {summary && <p className="mt-2 text-xs text-slate-500">Last updated {new Date(summary.asOf).toLocaleString()}</p>}
      </header>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <span>{error}</span><button type="button" onClick={() => void reload()} className="font-semibold underline">Retry</button>
      </div>}
      {loading && <div aria-label="Loading report" className="space-y-3">
        <div className="h-20 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-72 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      </div>}

      {!loading && summary && result && (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            {summary.companyBreakdown.length > 0 && (
              <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="font-semibold">By company</h2>
                {summary.companyBreakdownTruncated && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Company breakdown is capped at 10,000 groups.</p>}
                <div className="mt-3 space-y-2">
                  {summary.companyBreakdown.map((item) => (
                    <button key={item.company} type="button" onClick={() => {
                      setSelectedCompanies([item.companyId]);
                      setPage(1);
                    }} className="grid w-full grid-cols-[minmax(7rem,12rem)_1fr_4rem] items-center gap-3 rounded px-1 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <span className="truncate">{item.company}</span>
                      <span className="h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-700"><span className="block h-full bg-sky-600" style={{ width: `${summary.total ? Math.min(100, item.count / summary.total * 100) : 0}%` }} /></span>
                      <span className="text-right tabular-nums">
                        {item.count} · {item.value !== undefined && summary.currency
                          ? new Intl.NumberFormat(undefined, { style: "currency", currency: /^[A-Z]{3}$/.test(summary.currency) ? summary.currency : "INR", maximumFractionDigits: 2 }).format(item.value)
                          : null}
                        {summary.total ? ` · ${(item.count / summary.total * 100).toFixed(1)}%` : " · 0.0%"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {summary.statusBreakdown.length > 0 && (
              <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <h2 className="font-semibold">By status</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.statusBreakdown.map((item) => (
                    <button key={`${item.companyId}:${item.status}`} type="button" onClick={() => {
                      setSelectedCompanies([item.companyId]);
                      setStatus(item.status);
                      setPage(1);
                    }} className="rounded-full border px-3 py-1.5 text-xs hover:border-sky-500">
                      {item.company} · {item.status}: {item.count}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Find company
                <input value={tenantSearch} onChange={(event) => {
                  setTenantSearch(event.target.value);
                  setTenantPage(1);
                }} placeholder="Search name or company code" className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Companies
                <select multiple value={selectedCompanies} onChange={(event) => {
                  setSelectedCompanies(Array.from(event.target.selectedOptions, (option) => option.value));
                  setPage(1);
                }} className="mt-1 h-24 w-full rounded border bg-white px-2 py-1 text-sm dark:bg-slate-950">
                  {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                </select>
                <span className="mt-1 flex items-center justify-between gap-2 font-normal">
                  <button type="button" disabled={tenantPage <= 1} onClick={() => setTenantPage((current) => current - 1)} className="underline disabled:opacity-40">Previous</button>
                  <span>{tenantTotal.toLocaleString()} companies</span>
                  <button type="button" disabled={tenantPage * 100 >= tenantTotal} onClick={() => setTenantPage((current) => current + 1)} className="underline disabled:opacity-40">Next</button>
                </span>
              </label>
              {summary.fields.includes("createdAt") && <>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">From
                  <input type="date" value={dateFrom} onChange={changeFilter(setDateFrom)} className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
                </label>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">To
                  <input type="date" value={dateTo} onChange={changeFilter(setDateTo)} className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
                </label>
              </>}
              {summary.statusBreakdown.length > 0 && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Status
                <select value={status} onChange={changeFilter(setStatus)} className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950">
                  <option value="">All statuses</option>
                  {[...new Set(summary.statusBreakdown.map((item) => item.status))].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>}
              {summary.supportsOwnerFilter && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Owner ID
                <input value={ownerId} onChange={changeFilter(setOwnerId)} placeholder="Filter by owner" className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
              </label>}
              {summary.supportsProjectFilter && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Project ID
                <input value={projectId} onChange={changeFilter(setProjectId)} placeholder="Filter by project" className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
              </label>}
              <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()); setPage(1); }}>
                <label className="flex-1 text-xs font-medium text-slate-600 dark:text-slate-300">Search
                  <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full rounded border px-2 py-2 text-sm dark:bg-slate-950" />
                </label>
                <button className="rounded bg-slate-800 px-3 py-2 text-sm text-white">Search</button>
              </form>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">{result.total.toLocaleString()} records</p>
              <details className="relative">
                <summary className="cursor-pointer rounded border px-3 py-1.5 text-sm">Columns</summary>
                <div className="absolute right-0 z-10 mt-1 max-h-64 w-56 overflow-auto rounded border bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {columns.map((column) => <label key={column} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={visibleColumns.includes(column)} disabled={column === "company"} onChange={(event) => setVisibleColumns((current) => event.target.checked ? [...current, column] : current.filter((entry) => entry !== column))} />
                    {column}
                  </label>)}
                </div>
              </details>
            </div>
            {result.capped && <p role="status" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-100">Showing the first 50,000 rows. Narrow your filters or export up to 100,000 rows as CSV/XLSX.</p>}
            {!result.records.length ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">No records match.</p> : (
              <div className="overflow-auto rounded border">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase dark:bg-slate-800">
                    <tr>{visibleColumns.map((column) => <th key={column} className="whitespace-nowrap border-b px-3 py-2">
                      <button type="button" onClick={() => { setSort(column); setOrder((current) => current === "asc" ? "desc" : "asc"); setPage(1); }}>{column}{sort === column ? order === "asc" ? " ↑" : " ↓" : ""}</button>
                    </th>)}</tr>
                  </thead>
                  <tbody>{result.records.map((record, index) => <tr key={String(record.id || index)} className="cursor-pointer border-b last:border-0 hover:bg-sky-50 dark:hover:bg-slate-800" onClick={() => setSelectedRecord(record)}>
                    {visibleColumns.map((column) => <td key={column} className="max-w-72 truncate px-3 py-2" title={formatValue(record[column])}>{formatValue(record[column])}</td>)}
                  </tr>)}</tbody>
                  <tfoot><tr className="bg-slate-50 font-semibold dark:bg-slate-800">{visibleColumns.map((column, index) => {
                    const sum = result.records.reduce((total, record) => total + (typeof record[column] === "number" ? record[column] as number : 0), 0);
                    return <td key={column} className="px-3 py-2">{index === 0 ? "Page total" : result.records.some((record) => typeof record[column] === "number") ? sum.toLocaleString() : ""}</td>;
                  })}</tr></tfoot>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm">Rows per page
                <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="ml-2 rounded border bg-white px-2 py-1 dark:bg-slate-950">
                  {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-2 text-sm">
                <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded border p-1 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                Page {page} of {totalPages}
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded border p-1 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </section>
          {selectedRecord && <div role="dialog" aria-modal="true" aria-label="Read-only record details" className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setSelectedRecord(null)}>
            <aside className="h-full w-full max-w-xl overflow-auto bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Record details</h2><button type="button" onClick={() => setSelectedRecord(null)} className="rounded border px-3 py-1 text-sm">Close</button></div>
              <dl className="mt-4 divide-y">{Object.entries(selectedRecord).map(([field, value]) => <div key={field} className="grid grid-cols-[minmax(8rem,0.7fr)_1fr] gap-3 py-2 text-sm">
                <dt className="text-slate-500">{field}</dt><dd className="break-words">{formatValue(value)}</dd>
              </div>)}</dl>
              <p className="mt-4 text-xs text-slate-500">Read-only platform view. No tenant CRM navigation or impersonation is started.</p>
            </aside>
          </div>}
        </>
      )}
    </div>
  );
}
