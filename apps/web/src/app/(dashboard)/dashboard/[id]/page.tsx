"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImagePlus,
  Maximize2,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Table2,
  Trash2,
  Type,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportVisualization } from "@/components/crm/report-visualization";
import {
  WidgetConfigForm,
  type AxisField,
} from "@/components/crm/widget-config-form";
import {
  canonicalAxisConfig,
  fieldsFromSource,
  labelFromKey,
  rowsForWidget,
  selectTableRows,
  widgetTypeFromChart,
} from "@/lib/chart-axes";
import {
  clampGridValue,
  layoutChanged,
  measureGridStride,
  nextAvailablePosition,
  normalizeLayout,
} from "@/lib/dashboard-layout";
import { useAuth } from "@/contexts/auth-context";

type Widget = {
  id: string;
  type:
    | "chart"
    | "table"
    | "metric"
    | "kpi"
    | "text"
    | "image"
    | "column"
    | "line"
    | "area"
    | "pie"
    | "donut"
    | "horizontalBar"
    | "stackedBar"
    | "stackedColumn"
    | "funnel"
    | "gauge"
    | "summary"
    | "progress"
    | "list"
    | "ranking"
    | "custom";
  title: string;
  metric?: string;
  reportId?: string;
  config?: Record<string, any>;
  position: { x: number; y: number; w: number; h: number };
  minW?: number;
  minH?: number;
  minimized?: boolean;
};
type DashboardFilter = { field: string; operator: string; value: string };
type LayoutConfig = {
  gridColumns: 9 | 12;
  spacing: "compact" | "normal" | "wide";
  snapToGrid: boolean;
  autoArrange: boolean;
  showGridLines: boolean;
};
type Dashboard = {
  id: string;
  name: string;
  description?: string | null;
  layout: Widget[];
  filters?: DashboardFilter[] | null;
  refreshInterval?: string;
  visibility?: string;
  ownerId?: string | null;
  folderId?: string | null;
  layoutConfig?: Partial<LayoutConfig> | null;
};
type Report = {
  id: string;
  name: string;
  description?: string | null;
  type?: string;
  objectName: string;
  createdAt: string;
  folder?: { name: string } | null;
  createdByName?: string;
};
type ReportResult = {
  source?: string;
  report?: { name: string };
  result?: {
    rows?: Record<string, any>[];
    groups?: {
      groupValues?: Record<string, string>;
      count?: number;
      summary?: Record<string, any>;
    }[];
    totalRows?: number;
    columns?: string[];
    summary?: Record<string, any>;
  };
};
type WidgetDataResponse = { widget: Widget; data: ReportResult };

function getWidgetReportId(widget: Widget) {
  return widget.reportId || widget.config?.reportId;
}

function normalizeWidgetReport(widget: Widget): Widget {
  // Legacy rows can lack position; default it so normalizeLayout never
  // dereferences undefined (white-screen crash).
  const normalized: Widget = widget.position
    ? widget
    : { ...widget, position: { x: 0, y: 0, w: 4, h: 3 } };
  const reportId = getWidgetReportId(normalized);
  if (!reportId) return normalized;

  const reportName = normalized.config?.reportName || normalized.title;
  return {
    ...normalized,
    reportId,
    title: reportName,
    config: { ...normalized.config, reportId, reportName },
  };
}

function reportWidgetDraft(report: Report, widget: Widget) {
  const chartType =
    widget.config?.chartType ||
    (widget.type === "metric" || widget.type === "kpi"
      ? "number"
      : widget.type === "table"
        ? "table"
        : widget.type === "column"
          ? "column"
          : widget.type === "line"
            ? "line"
            : widget.type === "area"
              ? "area"
              : widget.type === "pie"
                ? "pie"
                : widget.type === "donut"
                  ? "donut"
                  : widget.type === "funnel"
                    ? "funnel"
                    : widget.type === "gauge"
                      ? "gauge"
                      : "bar");
  return canonicalAxisConfig(
    {
      ...(widget.config || {}),
      reportId: report.id,
      reportName: report.name,
      reportType: report.type || widget.config?.reportType,
      reportObject: report.objectName,
      reportFolder: report.folder?.name || "Private Reports",
      reportCreatedAt: report.createdAt,
      chartType,
      aggregation: widget.config?.aggregation || "count",
      legend: "bottom",
      title: report.name,
      showValues: true,
      theme: "light",
    },
    chartType,
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Authentication required");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success)
    throw new Error(body.error || "Request failed");
  return body.data as T;
}

const newWidget = (
  type: Widget["type"],
  position: Widget["position"],
  config?: Record<string, any>,
): Widget => ({
  id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type,
  title:
    type === "text"
      ? "Text widget"
      : type === "image"
        ? "Image widget"
        : "Select a report",
  config,
  position,
});

const GRID_COLUMNS = 12;
const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  gridColumns: 12,
  spacing: "normal",
  snapToGrid: true,
  autoArrange: true,
  showGridLines: true,
};
const MAX_WIDGETS = 20;
const WIDGET_TYPES: { type: Widget["type"]; label: string }[] = [
  { type: "metric", label: "Metric / KPI" },
  { type: "chart", label: "Bar Chart" },
  { type: "column", label: "Column Chart" },
  { type: "line", label: "Line Chart" },
  { type: "area", label: "Area Chart" },
  { type: "pie", label: "Pie Chart" },
  { type: "donut", label: "Donut Chart" },
  { type: "funnel", label: "Funnel Chart" },
  { type: "gauge", label: "Gauge" },
  { type: "table", label: "Table" },
  { type: "horizontalBar", label: "Horizontal Bar Chart" },
  { type: "stackedBar", label: "Stacked Bar Chart" },
  { type: "stackedColumn", label: "Stacked Column Chart" },
  { type: "summary", label: "Summary" },
  { type: "text", label: "Text / Rich Text" },
  { type: "image", label: "Image" },
  { type: "progress", label: "Progress / Target" },
  { type: "list", label: "List" },
  { type: "ranking", label: "Ranking" },
  { type: "custom", label: "Custom Widget" },
];

const DISPLAY_OPTIONS = [
  { value: "bar", label: "Bar", icon: "bars" },
  { value: "pie", label: "Pie", icon: "pie" },
  { value: "table", label: "Table", icon: "table" },
  { value: "number", label: "Number", icon: "number" },
] as const;

function getGridColumnsForViewport() {
  if (typeof window === "undefined") return GRID_COLUMNS;
  if (window.innerWidth < 768) return 1;
  if (window.innerWidth < 1024) return 8;
  return GRID_COLUMNS;
}

export default function DashboardBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const embedded = searchParams.get("embed") === "1";
  const { hasPermission } = useAuth();
  // Save/edit require DASHBOARD_UPDATE on the server; never enter edit mode
  // for users who would only hit a 403 on save.
  const canEdit = hasPermission("Dashboard", "edit");
  const [isEditing, setIsEditing] = React.useState(
    searchParams.get("mode") !== "view" && canEdit,
  );
  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [widgets, setWidgets] = React.useState<Widget[]>([]);
  const [history, setHistory] = React.useState<Widget[][]>([]);
  const [future, setFuture] = React.useState<Widget[][]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [reportSearch, setReportSearch] = React.useState("");
  const [reports, setReports] = React.useState<Report[]>([]);
  const [reportLoadError, setReportLoadError] = React.useState("");
  const [selectedReport, setSelectedReport] = React.useState<Report | null>(
    null,
  );
  const [selectedWidget, setSelectedWidget] = React.useState<Widget | null>(
    null,
  );
  const [widgetData, setWidgetData] = React.useState<
    Record<string, ReportResult | null>
  >({});
  const [widgetLoading, setWidgetLoading] = React.useState<Set<string>>(
    new Set(),
  );
  const [widgetErrors, setWidgetErrors] = React.useState<
    Record<string, string>
  >({});
  const widgetRequests = React.useRef(new Set<string>());
  const autoLoadedWidgets = React.useRef(new Set<string>());
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<DashboardFilter[]>([]);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [draftFilter, setDraftFilter] = React.useState<DashboardFilter>({
    field: "projectName",
    operator: "equals",
    value: "",
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastRefreshed, setLastRefreshed] = React.useState<Date | null>(null);
  const [savedMessage, setSavedMessage] = React.useState("");
  const [expandedWidget, setExpandedWidget] = React.useState<Widget | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [refreshInterval, setRefreshInterval] = React.useState("MANUAL");
  const [autoRefreshWhileEditing, setAutoRefreshWhileEditing] =
    React.useState(false);
  const [drilldown, setDrilldown] = React.useState<ReportResult | null>(null);
  const [widgetConfigOpen, setWidgetConfigOpen] = React.useState(false);
  const [widgetDraft, setWidgetDraft] = React.useState<Record<string, any>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saveAsOpen, setSaveAsOpen] = React.useState(false);
  const [saveAsName, setSaveAsName] = React.useState("");
  const [persistedWidgetIds, setPersistedWidgetIds] = React.useState<
    Set<string>
  >(new Set());
  const [draftSnapshot, setDraftSnapshot] = React.useState<Widget[]>([]);
  const [layoutColumns, setLayoutColumns] = React.useState(() =>
    getGridColumnsForViewport(),
  );
  const [layoutConfig, setLayoutConfig] = React.useState<LayoutConfig>(
    DEFAULT_LAYOUT_CONFIG,
  );
  const [resetLayoutOpen, setResetLayoutOpen] = React.useState(false);
  const [dragState, setDragState] = React.useState<{
    id: string;
    mode: "drag" | "resize";
    handle?: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
    startPointer: { x: number; y: number };
    startPosition: Widget["position"];
  } | null>(null);
  const [axisFields, setAxisFields] = React.useState<AxisField[]>([]);
  const [axisFieldError, setAxisFieldError] = React.useState("");
  const gridRef = React.useRef<HTMLDivElement>(null);
  const widgetsRef = React.useRef(widgets);
  const layoutConfigRef = React.useRef(layoutConfig);
  const layoutColumnsRef = React.useRef(layoutColumns);
  const dragOriginRef = React.useRef<
    Array<{ id: string; position: Widget["position"] }> | null
  >(null);
  widgetsRef.current = widgets;
  layoutConfigRef.current = layoutConfig;
  layoutColumnsRef.current = layoutColumns;

  React.useEffect(() => {
    const syncColumns = () => {
      if (window.innerWidth < 768) setLayoutColumns(1);
      else setLayoutColumns(layoutConfig.gridColumns);
    };
    syncColumns();
    window.addEventListener("resize", syncColumns);
    return () => window.removeEventListener("resize", syncColumns);
  }, [layoutConfig.gridColumns]);

  React.useEffect(() => {
    if (!dragState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const handleMove = (event: MouseEvent) => {
      const deltaX = event.clientX - dragState.startPointer.x;
      const deltaY = event.clientY - dragState.startPointer.y;
      const config = layoutConfigRef.current;
      const currentColumns = layoutColumnsRef.current || GRID_COLUMNS;
      const source = widgetsRef.current.find((widget) => widget.id === dragState.id);
      if (!source) return;
      const stride = measureGridStride(gridRef.current, currentColumns, config.spacing);
      const units = (delta: number, size: number) =>
        config.snapToGrid ? Math.round(delta / size) : Math.trunc(delta / size);

      if (dragState.mode === "drag") {
        const nextPosition = {
          ...dragState.startPosition,
          x: clampGridValue(
            dragState.startPosition.x + units(deltaX, stride.column),
            0,
            Math.max(0, currentColumns - source.position.w),
          ),
          y: Math.max(0, dragState.startPosition.y + units(deltaY, stride.row)),
        };
        const next = normalizeLayout(
          widgetsRef.current.map((widget) =>
            widget.id === dragState.id
              ? { ...widget, position: { ...widget.position, ...nextPosition } }
              : widget,
          ),
          dragState.id,
          currentColumns,
        );
        widgetsRef.current = next;
        setWidgets(next);
        return;
      }

      const next = { ...dragState.startPosition };
      if (dragState.handle?.includes("e")) {
        next.w = clampGridValue(
          Math.round(dragState.startPosition.w + deltaX / stride.column),
          source.minW || 2,
          currentColumns - next.x,
        );
      }
      if (dragState.handle?.includes("s")) {
        next.h = clampGridValue(
          Math.round(dragState.startPosition.h + deltaY / stride.row),
          source.minH || 2,
          24,
        );
      }
      if (dragState.handle?.includes("w")) {
        const nextX = Math.round(dragState.startPosition.x + deltaX / stride.column);
        const widthDelta = dragState.startPosition.x - nextX;
        const newWidth = clampGridValue(
          dragState.startPosition.w + widthDelta,
          source.minW || 2,
          currentColumns,
        );
        next.x = clampGridValue(
          dragState.startPosition.x - (newWidth - dragState.startPosition.w),
          0,
          currentColumns - newWidth,
        );
        next.w = newWidth;
      }
      if (dragState.handle?.includes("n")) {
        const nextY = Math.round(dragState.startPosition.y + deltaY / stride.row);
        const heightDelta = dragState.startPosition.y - nextY;
        const newHeight = clampGridValue(
          dragState.startPosition.h + heightDelta,
          source.minH || 2,
          24,
        );
        next.y = clampGridValue(
          dragState.startPosition.y - (newHeight - dragState.startPosition.h),
          0,
          24 - newHeight,
        );
        next.h = newHeight;
      }

      setWidgets((current) => {
        const updated = current.map((widget) =>
          widget.id === dragState.id
            ? { ...widget, position: { ...widget.position, ...next } }
            : widget,
        );
        const resolved = config.autoArrange
          ? normalizeLayout(updated, dragState.id, currentColumns)
          : updated;
        widgetsRef.current = resolved;
        return resolved;
      });
    };

    const handleUp = () => {
      const currentColumns = layoutColumnsRef.current || GRID_COLUMNS;
      const normalized =
        dragState.mode === "drag"
          ? normalizeLayout(widgetsRef.current, dragState.id, currentColumns)
          : widgetsRef.current;
      if (dragState.mode === "drag") {
        widgetsRef.current = normalized;
        setWidgets(normalized);
      }
      if (layoutChanged(dragOriginRef.current, normalized)) setDirty(true);
      dragOriginRef.current = null;
      setDraggedId(null);
      setDragState(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragState]);

  const loadDashboard = React.useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await readResponse<Dashboard>(
        await fetch(`/api/proxy/api/dashboards/${params.id}`, {
          cache: "no-store",
        }),
      );
      setDashboard(data);
      const savedLayoutConfig = {
        ...DEFAULT_LAYOUT_CONFIG,
        ...(data.layoutConfig || {}),
      } as LayoutConfig;
      setLayoutConfig(savedLayoutConfig);
      setLayoutColumns(savedLayoutConfig.gridColumns);
      widgetRequests.current.clear();
      autoLoadedWidgets.current.clear();
      const loadedWidgets = normalizeLayout(
        Array.isArray(data.layout)
          ? data.layout.map(normalizeWidgetReport)
          : [],
        undefined,
        savedLayoutConfig.gridColumns,
      );
      setWidgets(loadedWidgets);
      setDraftSnapshot(loadedWidgets);
      setPersistedWidgetIds(
        new Set(
          Array.isArray(data.layout)
            ? data.layout.map((widget) => widget.id)
            : [],
        ),
      );
      setFilters(Array.isArray(data.filters) ? data.filters : []);
      setRefreshInterval(data.refreshInterval || "MANUAL");
      setAutoRefreshWhileEditing(
        Boolean(
          (data as Dashboard & { autoRefreshWhileEditing?: boolean })
            .autoRefreshWhileEditing,
        ),
      );
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  React.useEffect(() => {
    setIsEditing(searchParams.get("mode") !== "view");
  }, [searchParams]);
  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "You have unsaved dashboard changes.";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const commit = (next: Widget[]) => {
    setHistory((current) => [...current.slice(-19), widgets]);
    setFuture([]);
    setWidgets(() => normalizeLayout(next, undefined, layoutColumns));
    setDirty(true);
  };
  const updateWidget = (
    id: string,
    patch: Partial<Widget> & { config?: Record<string, any> },
  ) =>
    commit(
      widgets.map((widget) =>
        widget.id === id
          ? {
              ...widget,
              ...patch,
              config: { ...widget.config, ...patch.config },
            }
          : widget,
      ),
    );

  const persistDashboard = async (nextWidgets: Widget[] = widgets) => {
    if (!dashboard) return;
    await readResponse(
      await fetch(`/api/proxy/api/dashboards/${dashboard.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dashboard.name,
          description: dashboard.description || undefined,
          folderId: dashboard.folderId || null,
          visibility: dashboard.visibility,
          layout: nextWidgets,
          layoutConfig,
          filters,
          refreshInterval,
          autoRefreshWhileEditing,
        }),
      }),
    );
    setPersistedWidgetIds(new Set(nextWidgets.map((widget) => widget.id)));
  };
  const save = async () => {
    if (!dashboard) return;
    try {
      setSaving(true);
      await persistDashboard();
      setSavedMessage("Dashboard saved successfully");
      setDirty(false);
      setIsEditing(false);
      router.replace(`/dashboards/${dashboard.id}?mode=view`, {
        scroll: false,
      });
      window.setTimeout(() => setSavedMessage(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save dashboard");
    } finally {
      setSaving(false);
    }
  };
  const enterEditing = () => {
    setDraftSnapshot(widgets);
    setDirty(false);
    setIsEditing(true);
    router.replace(`/dashboards/${dashboard?.id}?mode=edit`, { scroll: false });
  };
  const cancelEditing = () => {
    setWidgets(draftSnapshot);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setIsEditing(false);
    router.replace(`/dashboards/${dashboard?.id}?mode=view`, { scroll: false });
  };
  const saveAs = async () => {
    if (!dashboard || !saveAsName.trim()) return;
    try {
      const copied = await readResponse<Dashboard>(
        await fetch("/api/proxy/api/dashboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: saveAsName.trim(),
            description: dashboard.description || undefined,
            folderId: dashboard.folderId || null,
            layout: widgets,
            layoutConfig,
            filters,
            refreshInterval,
            autoRefreshWhileEditing,
          }),
        }),
      );
      router.replace(`/dashboards/${copied.id}`, { scroll: false });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save dashboard as a new dashboard",
      );
    }
  };
  const deleteCurrentDashboard = async () => {
    if (
      !dashboard ||
      !window.confirm("Delete Dashboard? This action cannot be undone.")
    )
      return;
    try {
      await readResponse(
        await fetch(`/api/proxy/api/dashboards/${dashboard.id}`, {
          method: "DELETE",
        }),
      );
      router.replace("/dashboards", { scroll: false });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Dashboard could not be deleted",
      );
    }
  };
  const finishEditing = async () => {
    if (
      dirty &&
      window.confirm("You have unsaved changes. Save changes before leaving?")
    )
      await save();
    setIsEditing(false);
    router.replace(`/dashboards/${dashboard?.id}?mode=view`, { scroll: false });
  };

  const loadReports = async () => {
    try {
      setReportLoadError("");
      const params = new URLSearchParams({
        view: "all",
        page: "1",
        limit: "100",
      });
      if (reportSearch.trim()) params.set("search", reportSearch.trim());
      const data = await readResponse<{ items?: Report[] } | Report[]>(
        await fetch(`/api/proxy/api/reports?${params.toString()}`, {
          cache: "no-store",
        }),
      );
      const nextReports = Array.isArray(data)
        ? data
        : Array.isArray(data.items)
          ? data.items
          : [];
      setReports(nextReports);
    } catch (err) {
      setReports([]);
      setReportLoadError(
        err instanceof Error ? err.message : "Unable to load reports",
      );
    }
  };

  const openWidgetPicker = () => {
    setMenuOpen(false);
    setSelectedReport(null);
    setPickerOpen(true);
    void loadReports();
  };
  const addWidget = (type: Widget["type"]) => {
    if (widgets.length >= MAX_WIDGETS) {
      setError("Maximum of 20 dashboard components reached.");
      return;
    }
    const widgetWidth = Math.max(1, Math.floor(layoutConfig.gridColumns / 3));
    const widget = newWidget(
      type,
      nextAvailablePosition(
        widgets,
        widgetWidth,
        3,
        layoutConfig.gridColumns,
      ),
    );
    widget.minW = 2;
    widget.minH = 2;

    setHistory((historyValue) => [...historyValue.slice(-19), widgets]);
    setFuture([]);
    setDirty(true);
    setMenuOpen(false);
    if (type !== "text" && type !== "image" && type !== "custom") {
      setSelectedWidget(widget);
      setPickerOpen(true);
      void loadReports();
    }
    setWidgets(normalizeLayout([...widgets, widget], undefined, layoutColumns));
  };
  const duplicateWidget = (widget: Widget) => {
    if (widgets.length >= MAX_WIDGETS) {
      setError("Maximum of 20 dashboard components reached.");
      return;
    }
    const copy: Widget = {
      ...widget,
      id: `${widget.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: `${widget.title} Copy`,
      config: { ...widget.config },
      position: {
        ...widget.position,
        x: widget.position.x + 1,
        y: widget.position.y,
      },
    };
    commit([...widgets, copy]);
  };
  const selectReport = (report: Report) => {
    if (!selectedWidget) return;
    setSelectedReport(report);
    setWidgetDraft(reportWidgetDraft(report, selectedWidget));
  };

  const closeWidgetPicker = () => {
    if (selectedWidget && !getWidgetReportId(selectedWidget)) {
      commit(widgets.filter((widget) => widget.id !== selectedWidget.id));
    }
    setPickerOpen(false);
    setSelectedWidget(null);
    setSelectedReport(null);
  };
  const saveWidgetConfig = () => {
    if (!selectedWidget || !widgetDraft.reportId) return;
    setWidgets((current) => {
      const nextWidgets: Widget[] = current.map((widget) =>
        widget.id === selectedWidget.id
          ? {
              ...widget,
              reportId: widgetDraft.reportId,
              title: String(
                widgetDraft.title || widgetDraft.reportName || "Widget",
              ),
              type: widgetTypeFromChart(
                String(widgetDraft.chartType || "column"),
              ) as Widget["type"],
              config: {
                ...widgetDraft,
                reportId: widgetDraft.reportId,
                reportName: widgetDraft.reportName || widget.title,
              },
            }
          : widget,
      );
      setHistory((historyValue) => [...historyValue.slice(-19), current]);
      setFuture([]);
      setDirty(true);
      setSelectedReport(null);
      setSelectedWidget(null);
      setWidgetConfigOpen(false);
      const savedWidget = nextWidgets.find(
        (widget) => widget.id === selectedWidget.id,
      );
      if (savedWidget) {
        const normalizedWidget = normalizeWidgetReport(savedWidget);
        void (async () => {
          try {
            await persistDashboard(nextWidgets);
            await refreshWidget(normalizedWidget, true);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Unable to save dashboard widget",
            );
          }
        })();
      }
      return normalizeLayout(nextWidgets, undefined, layoutColumns);
    });
  };

  const [previewData, setPreviewData] = React.useState<ReportResult | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const previewWidgetId = selectedWidget?.id;
  const previewReportId = widgetConfigOpen
    ? (widgetDraft.reportId as string | undefined)
    : undefined;
  const dashboardIdForPreview = dashboard?.id;
  React.useEffect(() => {
    if (!previewReportId || !previewWidgetId || !dashboardIdForPreview) {
      setPreviewData(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    fetch(
      `/api/proxy/api/dashboards/${dashboardIdForPreview}/widgets/${previewWidgetId}/data`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: previewReportId, filters: [] }),
      },
    )
      .then((res) => readResponse<WidgetDataResponse>(res))
      .then((res) => {
        if (!cancelled) setPreviewData(res.data);
      })
      .catch(() => {
        if (!cancelled) setPreviewData(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewReportId, previewWidgetId, dashboardIdForPreview]);

  React.useEffect(() => {
    if (!widgetConfigOpen) return;
    const reportId = String(widgetDraft.reportId || "");
    if (!reportId) {
      setAxisFields([]);
      setAxisFieldError("");
      return;
    }
    let cancelled = false;
    const sampleRows = previewData?.result?.rows || [];
    const previewColumns = sampleRows[0] ? Object.keys(sampleRows[0]) : [];
    void (async () => {
      try {
        const report = await readResponse<{
          objectName?: string;
          columns?: unknown;
        }>(
          await fetch(`/api/proxy/api/reports/${reportId}`, { cache: "no-store" }),
        );
        let metadata: AxisField[] = [];
        const objectName = report.objectName || String(widgetDraft.reportObject || "");
        if (objectName) {
          const metadataResponse = await fetch(
            `/api/proxy/api/report-metadata/${encodeURIComponent(objectName)}`,
            { cache: "no-store" },
          );
          if (metadataResponse.ok) {
            const body = await metadataResponse.json();
            const raw = body.data?.fields || body.data?.object?.fields || [];
            metadata = (Array.isArray(raw) ? raw : []).flatMap(
              (field: { key?: string; name?: string; label?: string; type?: string }) => {
                const key = String(field.key || field.name || "");
                if (!key) return [];
                const type =
                  field.type === "number" ||
                  field.type === "date" ||
                  field.type === "enum" ||
                  field.type === "string"
                    ? field.type
                    : "string";
                return [
                  {
                    key,
                    label: String(field.label || key),
                    type,
                  },
                ];
              },
            );
          }
        }
        const reportColumns = Array.isArray(report.columns)
          ? report.columns.map(String)
          : [];
        if (cancelled) return;
        setAxisFields(
          fieldsFromSource({
            metadata,
            reportColumns,
            previewColumns,
            sampleRows,
          }),
        );
        setAxisFieldError("");
      } catch (err) {
        if (cancelled) return;
        setAxisFields(
          fieldsFromSource({
            previewColumns,
            sampleRows,
          }),
        );
        setAxisFieldError(
          err instanceof Error ? err.message : "Unable to load report fields",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetConfigOpen, widgetDraft.reportId, widgetDraft.reportObject, previewData]);

  const refreshWidget = async (widget: Widget, force = false) => {
    const reportId = getWidgetReportId(widget);
    if (!dashboard || !widgetExists(widget.id) || !reportId) return;
    if (!force && widgetRequests.current.has(widget.id)) return;
    widgetRequests.current.add(widget.id);
    setWidgetLoading((current) => new Set(current).add(widget.id));
    setWidgetErrors((current) => {
      const next = { ...current };
      delete next[widget.id];
      return next;
    });
    try {
      const response = await readResponse<WidgetDataResponse>(
        await fetch(
          `/api/proxy/api/dashboards/${dashboard.id}/widgets/${widget.id}/data`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filters }),
          },
        ),
      );
      setWidgetData((current) => ({ ...current, [widget.id]: response.data }));
      setLastRefreshed(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setWidgetErrors((current) => ({
        ...current,
        [widget.id]:
          message === "Saved report not found" || message === "Report not found"
            ? "Report unavailable"
            : "Unable to load report",
      }));
    } finally {
      widgetRequests.current.delete(widget.id);
      setWidgetLoading((current) => {
        const next = new Set(current);
        next.delete(widget.id);
        return next;
      });
    }
  };
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      if (dashboard) {
        await readResponse(
          await fetch(`/api/proxy/api/dashboards/${dashboard.id}/refresh`, {
            method: "POST",
          }),
        );
      }
      await Promise.all(widgets.map((widget) => refreshWidget(widget, true)));
    } catch (err) {
      // Auto-refresh must fail quietly once per tick: no unhandled rejection,
      // no retry loop or request storm on a persistent API error.
      console.error("Dashboard refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };
  // The interval below keeps a stable handle; this ref always points at the
  // latest closure so the timer never refreshes a stale widget list.
  const refreshAllRef = React.useRef(refreshAll);
  React.useEffect(() => {
    refreshAllRef.current = refreshAll;
  });
  const drillInto = async (widget: Widget, field: string, value: unknown) => {
    if (!dashboard) return;
    try {
      const result = await readResponse<ReportResult>(
        await fetch(
          `/api/proxy/api/dashboards/${dashboard.id}/widgets/${widget.id}/drilldown`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field, value }),
          },
        ),
      );
      setDrilldown(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to open filtered report",
      );
    }
  };
  const applyFilter = () => {
    if (!draftFilter.value.trim()) {
      setError("Filter value is required.");
      return;
    }
    setFilters((current) => [
      ...current,
      { ...draftFilter, value: draftFilter.value.trim() },
    ]);
    setFilterOpen(false);
    setDraftFilter({ field: "projectName", operator: "equals", value: "" });
  };
  const removeFilter = (index: number) =>
    setFilters((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  React.useEffect(() => {
    const minutes: Record<string, number> = {
      "5_MINUTES": 5,
      "15_MINUTES": 15,
      "30_MINUTES": 30,
      "1_HOUR": 60,
    };
    if (!autoRefreshWhileEditing || !minutes[refreshInterval]) return;
    const timer = window.setInterval(
      () => void refreshAllRef.current(),
      minutes[refreshInterval] * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [autoRefreshWhileEditing, refreshInterval]);
  React.useEffect(() => {
    widgets
      .filter(
        (widget) =>
          persistedWidgetIds.has(widget.id) &&
          Boolean(getWidgetReportId(widget)),
      )
      .forEach((widget) => {
        const requestKey = `${widget.id}:${getWidgetReportId(widget)}:${JSON.stringify(filters)}`;
        if (autoLoadedWidgets.current.has(requestKey)) return;
        autoLoadedWidgets.current.add(requestKey);
        void refreshWidget(widget);
      }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedWidgetIds, widgets, filters]);

  const widgetExists = React.useCallback(
    (widgetId: string | undefined) =>
      Boolean(widgetId && widgets.some((widget) => widget.id === widgetId)),
    [widgets],
  );

  const resizeWidget = (widget: Widget, delta: number, heightDelta = 0) =>
    updateWidget(widget.id, {
      position: {
        ...widget.position,
        w: Math.max(
          widget.minW || 2,
          Math.min(GRID_COLUMNS, widget.position.w + delta),
        ),
        h: Math.max(widget.minH || 2, widget.position.h + heightDelta),
      },
    });
  const toggleMinimize = (widget: Widget) =>
    updateWidget(widget.id, { minimized: !widget.minimized });
  const updateLayoutConfig = (patch: Partial<LayoutConfig>) => {
    const nextConfig = { ...layoutConfig, ...patch };
    setLayoutConfig(nextConfig);
    if (patch.gridColumns) {
      setLayoutColumns(patch.gridColumns);
      setWidgets((current) =>
        normalizeLayout(
          current,
          undefined,
          patch.gridColumns || layoutConfig.gridColumns,
        ),
      );
    }
    setDirty(true);
  };
  const resetLayout = () => {
    const widgetWidth = Math.max(1, Math.floor(layoutConfig.gridColumns / 3));
    const resetWidgets = widgets.reduce<Widget[]>((arranged, widget) => {
      arranged.push({
        ...widget,
        position: nextAvailablePosition(
          arranged,
          widgetWidth,
          3,
          layoutConfig.gridColumns,
        ),
      });
      return arranged;
    }, []);
    setWidgets(
      normalizeLayout(resetWidgets, undefined, layoutConfig.gridColumns),
    );
    setHistory((current) => [...current.slice(-19), widgets]);
    setFuture([]);
    setDirty(true);
    setResetLayoutOpen(false);
  };
  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((current) => [...current, widgets]);
    setWidgets(previous);
    setHistory((current) => current.slice(0, -1));
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setHistory((current) => [...current, widgets]);
    setWidgets(next);
    setFuture((current) => current.slice(0, -1));
  };

  if (loading)
    return (
      <div className="p-8">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  if (!dashboard)
    return (
      <div className="p-8 text-destructive">
        {error || "Dashboard not found"}
      </div>
    );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-muted/20">
      {resetLayoutOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Reset Dashboard Layout?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This will restore the default widget positions and sizes without
              deleting widgets or reports.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setResetLayoutOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={resetLayout}>
                Reset
              </Button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Dashboard Settings</h2>
                <p className="text-sm text-muted-foreground">
                  Manage visibility and refresh behavior.
                </p>
              </div>
              <button onClick={() => setSettingsOpen(false)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <label className="mb-4 block text-sm font-medium">
              Visibility
              <select
                value={dashboard.visibility || "PRIVATE"}
                onChange={(event) =>
                  setDashboard((current) =>
                    current
                      ? { ...current, visibility: event.target.value }
                      : current,
                  )
                }
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="PRIVATE">Private</option>
                <option value="SHARED">Shared</option>
                <option value="PUBLIC">Public</option>
              </select>
            </label>
            <label className="mb-5 block text-sm font-medium">
              Refresh settings
              <select
                value={refreshInterval}
                onChange={(event) => setRefreshInterval(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="MANUAL">Manual</option>
                <option value="5_MINUTES">Every 5 minutes</option>
                <option value="15_MINUTES">Every 15 minutes</option>
                <option value="30_MINUTES">Every 30 minutes</option>
                <option value="1_HOUR">Every hour</option>
              </select>
            </label>
            <label className="mb-5 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={autoRefreshWhileEditing}
                onChange={(event) =>
                  setAutoRefreshWhileEditing(event.target.checked)
                }
              />
              Allow automatic refresh while editing
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setSettingsOpen(false);
                  void save();
                }}
              >
                Save Settings
              </Button>
            </div>
          </div>
        </div>
      )}
      {filterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Dashboard Filter</h2>
                <p className="text-sm text-muted-foreground">
                  Filters are applied server-side to report widgets.
                </p>
              </div>
              <button onClick={() => setFilterOpen(false)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <label className="mb-3 block text-sm font-medium">
              Field
              <select
                value={draftFilter.field}
                onChange={(event) =>
                  setDraftFilter((current) => ({
                    ...current,
                    field: event.target.value,
                  }))
                }
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="projectName">Project</option>
                <option value="ownerName">Owner</option>
                <option value="status">Status</option>
                <option value="source">Source</option>
                <option value="createdAt">Created Date</option>
              </select>
            </label>
            <label className="mb-3 block text-sm font-medium">
              Operator
              <select
                value={draftFilter.operator}
                onChange={(event) =>
                  setDraftFilter((current) => ({
                    ...current,
                    operator: event.target.value,
                  }))
                }
                className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="equals">Equals</option>
                <option value="notEquals">Not Equals</option>
                <option value="contains">Contains</option>
                <option value="startsWith">Starts With</option>
                <option value="gt">Greater Than</option>
                <option value="lt">Less Than</option>
                <option value="gte">Greater Than or Equal</option>
                <option value="lte">Less Than or Equal</option>
                <option value="isBlank">Is Blank</option>
                <option value="isNotBlank">Is Not Blank</option>
                <option value="in">In</option>
                <option value="notIn">Not In</option>
              </select>
            </label>
            <label className="mb-5 block text-sm font-medium">
              Value
              <Input
                value={draftFilter.value}
                onChange={(event) =>
                  setDraftFilter((current) => ({
                    ...current,
                    value: event.target.value,
                  }))
                }
                placeholder="Haven Crest"
                className="mt-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setFilters([]);
                  setFilterOpen(false);
                }}
              >
                Reset
              </Button>
              <Button variant="outline" onClick={() => setFilterOpen(false)}>
                Cancel
              </Button>
              <Button onClick={applyFilter}>Apply</Button>
            </div>
          </div>
        </div>
      )}
      <header className={`${embedded ? "hidden " : ""}sticky top-0 z-20 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3 shadow-sm sm:px-5`}>
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboards")}
            title="Back to dashboards"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="min-w-0 truncate font-semibold">{dashboard.name}</h1>
              {canEdit && (
                <button
                  title="Edit name"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const name = window.prompt("Dashboard name", dashboard.name);
                    if (name?.trim() && name.trim() !== dashboard.name) {
                      setDashboard({ ...dashboard, name: name.trim() });
                      setDirty(true);
                    }
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Dashboard builder · 12-column layout
            </p>
          </div>
        </div>
        <div
          className={`flex min-w-0 flex-wrap items-center gap-1.5 ${isEditing ? "" : "hidden"}`}
        >
          <Button
            variant="default"
            size="sm"
            onClick={() => addWidget("chart")}
            disabled={widgets.length >= MAX_WIDGETS}
            title={
              widgets.length >= MAX_WIDGETS
                ? "Maximum of 20 dashboard components reached."
                : "Add widget"
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Widget
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterOpen(true)}
            title="Add a dashboard filter"
          >
            Add Filter
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={undo}
            disabled={!history.length}
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={redo}
            disabled={!future.length}
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            <Save className="mr-1.5 h-4 w-4" /> {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" onClick={cancelEditing}>
            Cancel
          </Button>
        </div>
        {!isEditing && canEdit && (
          <Button
            variant="outline"
            onClick={() => {
              enterEditing();
            }}
          >
            Edit
          </Button>
        )}
      </header>
      <main data-dashboard-canvas="" className={`mx-auto w-full max-w-none ${embedded ? "p-2" : "p-5 md:p-8"}`}>
        <div className={`mb-5 flex items-center justify-between ${embedded ? "hidden" : ""}`}>
          <div>
            <p className="text-sm text-muted-foreground">Live dashboard</p>
            <h2 className="text-2xl font-semibold">{dashboard.name}</h2>
          </div>
        </div>
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
            <button className="float-right" onClick={() => setError("")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {filters.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {filters.map((filter, index) => (
              <span
                key={`${filter.field}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs"
              >
                <span className="font-medium">{labelFromKey(filter.field)}</span>
                <span className="text-muted-foreground">
                  {filter.operator} {filter.value}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${labelFromKey(filter.field)} filter`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeFilter(index)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div
          ref={gridRef}
          className={`grid auto-rows-[90px] p-2 md:p-3 ${layoutConfig.spacing === "compact" ? "gap-1" : layoutConfig.spacing === "wide" ? "gap-5" : "gap-3"} ${isEditing && layoutConfig.showGridLines ? "bg-slate-50/80 [background-image:linear-gradient(to_right,rgba(148,163,184,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.22)_1px,transparent_1px)]" : "bg-background/60"}`}
          style={{
            gridTemplateColumns: `repeat(${layoutColumns}, minmax(0, 1fr))`,
            backgroundSize:
              isEditing && layoutConfig.showGridLines && layoutColumns > 1
                ? `calc((100% - ${(layoutColumns - 1) * (layoutConfig.spacing === "compact" ? 4 : layoutConfig.spacing === "wide" ? 20 : 12)}px) / ${layoutColumns}) 90px`
                : "auto",
          }}
        >
          {widgets.length === 0 && (
            <div className="col-span-full flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center">
              <p className="text-lg font-semibold text-slate-700">
                Start building your dashboard
              </p>
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Add components to visualize your CRM data.
              </p>
              <Button
                className="mt-5"
                onClick={() => addWidget("chart")}
                disabled={widgets.length >= MAX_WIDGETS}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Widget
              </Button>
            </div>
          )}
          {widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              result={widgetData[widget.id]}
              loading={widgetLoading.has(widget.id)}
              error={widgetErrors[widget.id]}
              columns={layoutColumns}
              dragging={draggedId === widget.id}
              onDragStart={(event) => {
                if (!isEditing) return;
                event.preventDefault();
                dragOriginRef.current = widgets.map((item) => ({
                  id: item.id,
                  position: { ...item.position },
                }));
                setDraggedId(widget.id);
                setDragState({
                  id: widget.id,
                  mode: "drag",
                  startPointer: { x: event.clientX, y: event.clientY },
                  startPosition: { ...widget.position },
                });
              }}
              isEditing={isEditing}
              onRemove={() => {
                if (window.confirm("Delete this dashboard component?"))
                  commit(widgets.filter((item) => item.id !== widget.id));
              }}
              onRefresh={() => void refreshWidget(widget, true)}
              onDrilldown={(field, value) =>
                void drillInto(widget, field, value)
              }
              onExpand={() => setExpandedWidget(widget)}
              onEdit={() => {
                setSelectedWidget(widget);
                const reportId = getWidgetReportId(widget);
                if (reportId) {
                  setSelectedReport({
                    id: reportId,
                    name: widget.config?.reportName || widget.title,
                    type: widget.config?.reportType,
                    objectName: widget.config?.reportObject || "",
                    createdAt:
                      widget.config?.reportCreatedAt ||
                      new Date(0).toISOString(),
                  });
                  setWidgetDraft(
                    canonicalAxisConfig(
                      {
                        ...widget.config,
                        reportId,
                        reportName: widget.config?.reportName || widget.title,
                        chartType: widget.config?.chartType || "bar",
                      },
                      widget.config?.chartType || "bar",
                    ),
                  );
                  setPickerOpen(false);
                  setWidgetConfigOpen(true);
                } else {
                  setSelectedReport(null);
                  setPickerOpen(true);
                  void loadReports();
                }
              }}
              onResize={(handle, event) => {
                if (!isEditing || !event) return;
                event.preventDefault();
                event.stopPropagation();
                dragOriginRef.current = widgets.map((item) => ({
                  id: item.id,
                  position: { ...item.position },
                }));
                setDragState({
                  id: widget.id,
                  mode: "resize",
                  handle,
                  startPointer: { x: event.clientX, y: event.clientY },
                  startPosition: { ...widget.position },
                });
              }}
              onSetWidth={(width) =>
                updateWidget(widget.id, {
                  position: { ...widget.position, w: width },
                })
              }
              onResizeHeight={(delta) => resizeWidget(widget, 0, delta)}
              onDuplicate={() => duplicateWidget(widget)}
              onToggleMinimize={() => toggleMinimize(widget)}
            />
          ))}
        </div>
      </main>
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[min(720px,90vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl md:flex-row">
            <aside className="hidden w-56 shrink-0 border-r bg-muted/20 p-5 md:block">
              <p className="mb-5 text-sm font-semibold">Reports</p>
              {[
                "Recent",
                "Created by Me",
                "Private Reports",
                "Public Reports",
                "All Reports",
              ].map((item, index) => (
                <button
                  key={item}
                  className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${index === 0 ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {item}
                </button>
              ))}
              <p className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Folders
              </p>
              <p className="px-3 text-sm text-muted-foreground">
                Created by Me
              </p>
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Shared with Me
              </p>
              <p className="px-3 text-sm text-muted-foreground">All Folders</p>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">Select Report</h2>
                  <p className="text-xs text-muted-foreground">
                    Choose a saved report to power this widget.
                  </p>
                </div>
                <button
                  onClick={() => {
                    closeWidgetPicker();
                  }}
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
              <div className="flex gap-2 border-b bg-muted/10 p-4">
                <div className="relative flex-1">
                  <BarChart3 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={reportSearch}
                    onChange={(event) => setReportSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadReports();
                    }}
                    placeholder="Search Reports and Folders..."
                    className="pl-9"
                  />
                </div>
                <Button variant="outline" onClick={() => void loadReports()}>
                  Search
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {reportLoadError ? (
                  <div className="p-12 text-center text-sm text-destructive">
                    <p>{reportLoadError}</p>
                    <button
                      type="button"
                      onClick={() => void loadReports()}
                      className="mt-2 font-medium text-primary hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : reports.length === 0 ? (
                  <div className="p-12 text-center text-sm text-muted-foreground">
                    No saved reports found.
                  </div>
                ) : (
                  reports.map((report) => (
                    <button
                      key={report.id}
                      onClick={() => selectReport(report)}
                      className={`flex w-full items-center justify-between border-b px-5 py-3.5 text-left transition-colors hover:bg-muted/50 ${
                        selectedReport?.id === report.id
                          ? "bg-red-50 ring-1 ring-inset ring-red-500"
                          : ""
                      }`}
                    >
                      <span>
                        <span className="block font-medium">{report.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {report.type || report.objectName} ·{" "}
                          {report.objectName} ·{" "}
                          {report.folder?.name || "Private Reports"}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex justify-end gap-2 border-t bg-background p-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    closeWidgetPicker();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!selectedReport}
                  onClick={() => {
                    setPickerOpen(false);
                    setWidgetConfigOpen(true);
                  }}
                >
                  Select
                </Button>
              </div>
            </section>
          </div>
        </div>
      )}
      {drilldown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Filtered report</h2>
                <p className="text-sm text-muted-foreground">
                  {drilldown.report?.name || "Report"}
                </p>
              </div>
              <button onClick={() => setDrilldown(null)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            {(drilldown.result?.rows || []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No data available
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {Object.keys(drilldown.result?.rows?.[0] || {}).map(
                      (key) => (
                        <th key={key} className="border-b px-3 py-2 text-left">
                          {key}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(drilldown.result?.rows || []).map((row, index) => (
                    <tr key={index}>
                      {Object.keys(drilldown.result?.rows?.[0] || {}).map(
                        (key) => (
                          <td key={key} className="border-b px-3 py-2">
                            {String(row[key] ?? "")}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {expandedWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-8">
          <div className="relative flex h-full max-h-[calc(100vh-2rem)] w-full max-w-[min(1400px,100%)] flex-col rounded-2xl bg-white shadow-2xl">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setExpandedWidget(null)}
              className="absolute -right-2 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-red-600 bg-white text-red-600 shadow hover:bg-red-50"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="shrink-0 border-b px-4 py-3 text-center">
              <h2 className="text-xl font-medium text-slate-900">
                {expandedWidget.title}
              </h2>
            </div>
            <div className="relative min-h-0 flex-1 p-3 sm:px-10 sm:py-4">
              {widgets.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous widget"
                    onClick={() => {
                      const i = widgets.findIndex((w) => w.id === expandedWidget.id);
                      setExpandedWidget(widgets[(i - 1 + widgets.length) % widgets.length]);
                    }}
                    className="absolute left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-red-600 bg-white text-red-600 hover:bg-red-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next widget"
                    onClick={() => {
                      const i = widgets.findIndex((w) => w.id === expandedWidget.id);
                      setExpandedWidget(widgets[(i + 1) % widgets.length]);
                    }}
                    className="absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-red-600 bg-white text-red-600 hover:bg-red-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            <WidgetCard
              fill
              widget={expandedWidget}
              result={widgetData[expandedWidget.id]}
              loading={widgetLoading.has(expandedWidget.id)}
              error={widgetErrors[expandedWidget.id]}
              columns={layoutColumns}
              isEditing={false}
              onDragStart={() => undefined}
              onRemove={() => setExpandedWidget(null)}
              onRefresh={() => void refreshWidget(expandedWidget, true)}
              onEdit={() => {
                setSelectedWidget(expandedWidget);
                setWidgetDraft(
                  canonicalAxisConfig(
                    expandedWidget.config || {},
                    expandedWidget.config?.chartType || "bar",
                  ),
                );
                setWidgetConfigOpen(true);
              }}
              onResize={() => undefined}
              onSetWidth={() => undefined}
              onResizeHeight={() => undefined}
              onDuplicate={() => undefined}
              onToggleMinimize={() => undefined}
              onDrilldown={(field, value) =>
                void drillInto(expandedWidget, field, value)
              }
              onExpand={() => undefined}
            />
            </div>
          </div>
        </div>
      )}
      {widgetConfigOpen && selectedWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="relative flex max-h-[min(820px,94vh)] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl">
            <button
              type="button"
              aria-label="Close"
              className="absolute -right-2 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-red-600 bg-white text-red-600 shadow hover:bg-red-50"
              onClick={() => {
                setWidgetConfigOpen(false);
                setSelectedWidget(null);
              }}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="border-b px-6 py-4 text-center">
              <h2 className="text-2xl font-medium text-slate-900">
                {getWidgetReportId(selectedWidget)
                  ? "Edit Widget"
                  : "Add Widget"}
              </h2>
            </div>
            <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[340px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-r p-5">
                <WidgetConfigForm
                  draft={widgetDraft}
                  setDraft={setWidgetDraft}
                  fields={axisFields}
                  fieldError={axisFieldError}
                  onChangeReport={() => {
                    setWidgetConfigOpen(false);
                    setPickerOpen(true);
                    void loadReports();
                  }}
                />
              </div>
              <div className="min-h-0 overflow-auto bg-muted/20 p-5">
                <p className="mb-3 text-sm font-medium text-muted-foreground">
                  Preview
                </p>
                <div className="h-[420px]">
                  {!widgetDraft.reportId ? (
                    <div className="flex h-full items-center justify-center rounded-2xl border bg-background text-sm text-muted-foreground">
                      Select a report to see a preview.
                    </div>
                  ) : (
                    <WidgetCard
                      fill
                      widget={{
                        ...selectedWidget,
                        title: String(
                          widgetDraft.title ||
                            widgetDraft.reportName ||
                            "Report widget",
                        ),
                        reportId: widgetDraft.reportId as string,
                        config: widgetDraft,
                      }}
                      result={previewData || widgetData[selectedWidget.id]}
                      loading={previewLoading && !previewData}
                      error={undefined}
                      columns={layoutColumns}
                      isEditing={false}
                      onDragStart={() => undefined}
                      onRemove={() => undefined}
                      onRefresh={() => undefined}
                      onEdit={() => undefined}
                      onResize={() => undefined}
                      onSetWidth={() => undefined}
                      onResizeHeight={() => undefined}
                      onDuplicate={() => undefined}
                      onToggleMinimize={() => undefined}
                      onDrilldown={() => undefined}
                      onExpand={() => undefined}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-background p-4">
              <Button
                variant="outline"
                className="rounded-full border-red-600 px-5 text-red-600 hover:bg-red-50"
                onClick={() => {
                  setWidgetConfigOpen(false);
                  setSelectedWidget(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="rounded-full bg-red-600 px-6 text-white hover:bg-red-700"
                onClick={saveWidgetConfig}
                disabled={!widgetDraft.reportId}
              >
                {getWidgetReportId(selectedWidget) ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {saveAsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Save As</h2>
              <button onClick={() => setSaveAsOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <Input
              autoFocus
              value={saveAsName}
              onChange={(event) => setSaveAsName(event.target.value)}
              placeholder="New dashboard name"
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveAsOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!saveAsName.trim()}
                onClick={() => void saveAs()}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  widget,
  result,
  loading,
  error,
  columns,
  isEditing,
  dragging = false,
  onDragStart,
  onRemove,
  onRefresh,
  onEdit,
  onResize,
  onResizeHeight,
  onSetWidth,
  onDuplicate,
  onToggleMinimize,
  onDrilldown,
  onExpand,
  fill = false,
}: {
  widget: Widget;
  result?: ReportResult | null;
  loading?: boolean;
  error?: string;
  columns: number;
  isEditing: boolean;
  dragging?: boolean;
  onDragStart: (event: React.MouseEvent<HTMLElement>) => void;
  onRemove: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onResize: (
    handle: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onResizeHeight: (delta: number) => void;
  onSetWidth: (width: number) => void;
  onDuplicate: () => void;
  onToggleMinimize: () => void;
  onDrilldown: (field: string, value: unknown) => void;
  onExpand: () => void;
  fill?: boolean;
}) {
  const width = Math.min(columns, Math.max(1, widget.position.w));
  const style = fill
    ? { height: "100%", width: "100%" }
    : columns === 1
      ? {
          gridColumn: "1 / -1",
          gridRow: `span ${Math.max(1, widget.position.h)}`,
        }
      : {
          gridColumn: `${widget.position.x + 1} / span ${width}`,
          gridRow: `${widget.position.y + 1} / span ${widget.position.h}`,
        };
  const chartType = widget.config?.chartType || "bar";
  const sourced = rowsForWidget(result, widget.config);
  const tableRows = selectTableRows(
    sourced.rows,
    Array.isArray(widget.config?.tableColumns) ? widget.config.tableColumns : undefined,
  );
  const reportId = getWidgetReportId(widget);
  const updatedAt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  return (
    <article
      style={style}
      className={`group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-[0_2px_5px_rgba(15,23,42,0.16)] ${
        dragging
          ? "z-10 border-blue-500 ring-2 ring-blue-400"
          : isEditing
            ? "border-slate-200 hover:border-blue-300"
            : "border-slate-200"
      }`}
    >
      {isEditing && (
        <>
          <button
            type="button"
            aria-label="Resize from top-left"
            onMouseDown={(event) => onResize("nw", event)}
            className="absolute left-[-5px] top-[-5px] z-20 h-3 w-3 cursor-nwse-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from top"
            onMouseDown={(event) => onResize("n", event)}
            className="absolute left-1/2 top-[-5px] z-20 h-2 w-8 -translate-x-1/2 cursor-ns-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from top-right"
            onMouseDown={(event) => onResize("ne", event)}
            className="absolute right-[-5px] top-[-5px] z-20 h-3 w-3 cursor-nesw-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from right"
            onMouseDown={(event) => onResize("e", event)}
            className="absolute bottom-1/2 right-[-5px] z-20 h-8 w-2 translate-y-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from bottom-right"
            onMouseDown={(event) => onResize("se", event)}
            className="absolute bottom-[-5px] right-[-5px] z-20 h-3 w-3 cursor-nwse-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from bottom"
            onMouseDown={(event) => onResize("s", event)}
            className="absolute bottom-[-5px] left-1/2 z-20 h-2 w-8 -translate-x-1/2 cursor-ns-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from bottom-left"
            onMouseDown={(event) => onResize("sw", event)}
            className="absolute bottom-[-5px] left-[-5px] z-20 h-3 w-3 cursor-nesw-resize rounded-full border border-slate-500 bg-white"
          />
          <button
            type="button"
            aria-label="Resize from left"
            onMouseDown={(event) => onResize("w", event)}
            className="absolute bottom-1/2 left-[-5px] z-20 h-8 w-2 translate-y-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white"
          />
        </>
      )}
      <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          {isEditing && (
            <button
              type="button"
              aria-label="Drag widget"
              title="Drag widget"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDragStart(event);
              }}
              className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-500 hover:bg-blue-50 hover:text-blue-700 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="truncate text-sm font-semibold">{widget.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-red-700">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Edit widget"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                title="Remove widget"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md hover:bg-red-50 hover:text-red-800"
                title="Refresh widget"
                onClick={(event) => {
                  event.stopPropagation();
                  onRefresh();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md hover:bg-red-50 hover:text-red-800"
                title="Expand widget"
                onClick={(event) => {
                  event.stopPropagation();
                  onExpand();
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {!widget.minimized && (
        <div className={`min-h-0 flex-1 px-4 pb-3 pt-1 ${chartType === "pie" || chartType === "donut" ? "overflow-hidden" : "overflow-auto"}`}>
          {widget.type === "text" ? (
            <div className="prose prose-sm">
              <h3>{widget.config?.title || "Text widget"}</h3>
              <p>
                {widget.config?.body || "Double-click to add text content."}
              </p>
            </div>
          ) : widget.type === "image" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <ImagePlus className="mr-2 h-5 w-5" /> Add an image URL in widget
              settings
            </div>
          ) : !getWidgetReportId(widget) ? (
            <div className="flex h-full min-h-24 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Table2 className="mb-2 h-6 w-6" />
              <p>No report selected</p>
              <button
                onClick={onEdit}
                className="mt-1 text-primary hover:underline"
              >
                Select a report
              </button>
            </div>
          ) : loading ? (
            <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">
              Loading report...
            </div>
          ) : error ? (
            <div className="flex h-full min-h-24 flex-col items-center justify-center text-center text-sm text-destructive">
              {error === "Report unavailable" ? (
                <>
                  <p className="font-medium">Report unavailable</p>
                  <p className="mt-1 text-muted-foreground">
                    The selected report could not be loaded.
                  </p>
                  <button
                    type="button"
                    onClick={onEdit}
                    className="mt-2 font-medium text-primary hover:underline"
                  >
                    Select another report
                  </button>
                </>
              ) : (
                <p>{error}</p>
              )}
              <button
                type="button"
                onClick={onRefresh}
                className="mt-2 font-medium text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : chartType === "table" ? (
            tableRows.length === 0 ? (
              <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">
                No data to display
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {Object.keys(tableRows[0] || {}).map((key) => (
                      <th
                        key={key}
                        className="border-b px-2 py-2 text-left font-medium text-muted-foreground"
                      >
                        {labelFromKey(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.slice(0, 8).map((row, index) => (
                    <tr key={index}>
                      {Object.keys(tableRows[0] || {}).map((key) => (
                        <td key={key} className="border-b px-2 py-2">
                          <button
                            type="button"
                            className="text-left hover:text-primary"
                            onClick={() => onDrilldown(key, row[key])}
                          >
                            {String(row[key] ?? "—")}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : sourced.rows.length === 0 ? (
            <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">
              No data available
            </div>
          ) : (
            <ReportVisualization
              rows={sourced.rows}
              chartType={chartType}
              config={widget.config}
              preAggregated={sourced.preAggregated}
              onDrilldown={onDrilldown}
            />
          )}
        </div>
      )}
      <div className="flex items-center justify-between border-t px-4 py-2 text-[11px]">
        {reportId ? (
          <Link
            href={`/reports/${encodeURIComponent(reportId)}`}
            className="font-medium text-red-700 hover:underline"
          >
              View Report ({widget.config?.reportName || widget.title})
          </Link>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="font-medium text-red-700 hover:underline"
          >
            View Report...
          </button>
        )}
        <span className="text-right leading-tight text-muted-foreground">
          {widget.config?.footer || `As of ${updatedAt}`}
        </span>
      </div>
    </article>
  );
}
