"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  categoryTickInterval,
  prepareWidgetChart,
  type PreparedChart,
  truncateLabel,
} from "@/lib/chart-axes";

const COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function CategoryTick({
  x = 0,
  y = 0,
  payload,
  rotation = 0,
  vertical = false,
}: {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  rotation?: number;
  vertical?: boolean;
}) {
  const text = truncateLabel(payload?.value, vertical ? 16 : rotation ? 20 : 14);
  const angle =
    rotation === 45 ? -45 : rotation === 90 ? -90 : rotation === -45 ? 45 : 0;
  return (
    <text
      x={x}
      y={y}
      dy={vertical ? 4 : angle === 0 ? 12 : 6}
      dx={vertical ? -6 : 0}
      textAnchor={
        vertical && angle === 0 ? "end" : angle === 0 ? "middle" : angle > 0 ? "start" : "end"
      }
      fill="#334155"
      fontSize={11}
      transform={angle ? `rotate(${angle} ${x} ${y})` : undefined}
    >
      {text}
    </text>
  );
}

function ChartFrame({
  chart,
  children,
}: {
  chart: PreparedChart;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[200px] w-full min-w-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {chart.showYAxis && chart.yTitle ? (
          <div className="flex w-6 shrink-0 items-center justify-center">
            <span className="max-w-[180px] -rotate-90 truncate whitespace-nowrap text-[11px] font-medium text-slate-700">
              {chart.yTitle}
            </span>
          </div>
        ) : null}
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
      {chart.showXAxis && chart.xTitle ? (
        <div className="truncate px-2 pt-1 text-center text-[11px] font-medium text-slate-700">
          {chart.xTitle}
        </div>
      ) : null}
    </div>
  );
}

function AxisPair({ chart }: { chart: PreparedChart }) {
  const interval = categoryTickInterval(chart.data.length, chart.labelRotation);
  const axisHeight = chart.labelRotation === 90 ? 72 : chart.labelRotation === 0 ? 28 : 58;
  if (chart.mode === "scatter") {
    return (
      <>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          hide={!chart.showXAxis}
          domain={chart.xDomain}
          ticks={chart.xTicks}
          tick={chart.showXLabels ? { fontSize: 11, fill: "#334155" } : false}
          tickFormatter={(value) => chart.format(Number(value))}
        />
        <YAxis
          type="number"
          dataKey="y"
          hide={!chart.showYAxis}
          domain={chart.yDomain}
          ticks={chart.yTicks}
          width={64}
          tick={chart.showYLabels ? { fontSize: 11, fill: "#334155" } : false}
          tickFormatter={(value) => chart.format(Number(value))}
        />
        <Tooltip formatter={(value) => chart.format(Number(value))} />
      </>
    );
  }
  if (chart.categoryAxis === "y") {
    return (
      <>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis
          type="number"
          hide={!chart.showXAxis}
          domain={chart.xDomain}
          ticks={chart.xTicks}
          tick={chart.showXLabels ? { fontSize: 11, fill: "#334155" } : false}
          tickFormatter={(value) => chart.format(Number(value))}
        />
        <YAxis
          dataKey="category"
          type="category"
          hide={!chart.showYAxis}
          width={112}
          interval={0}
          tick={
            chart.showYLabels ? (
              <CategoryTick vertical rotation={chart.labelRotation} />
            ) : (
              false
            )
          }
        />
        <Tooltip
          formatter={(value) => chart.format(Number(value))}
          labelFormatter={(label) => String(label ?? "")}
        />
      </>
    );
  }
  return (
    <>
      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
      <XAxis
        dataKey="category"
        type="category"
        hide={!chart.showXAxis}
        interval={interval}
        height={axisHeight}
        tick={
          chart.showXLabels ? (
            <CategoryTick rotation={chart.labelRotation} />
          ) : (
            false
          )
        }
      />
      <YAxis
        type="number"
        hide={!chart.showYAxis}
        domain={chart.yDomain}
        ticks={chart.yTicks}
        width={64}
        tick={chart.showYLabels ? { fontSize: 11, fill: "#334155" } : false}
        tickFormatter={(value) => chart.format(Number(value))}
      />
      <Tooltip
        formatter={(value) => chart.format(Number(value))}
        labelFormatter={(label) => String(label ?? "")}
      />
    </>
  );
}

export function ReportVisualization({
  rows,
  chartType,
  config,
  onDrilldown,
  preAggregated = false,
}: {
  rows: Record<string, any>[];
  chartType: string;
  config?: Record<string, any>;
  onDrilldown: (field: string, value: unknown) => void;
  preAggregated?: boolean;
}) {
  const [hoveredCategory, setHoveredCategory] = React.useState<string | null>(null);
  const prepared = prepareWidgetChart({ rows, chartType, config, preAggregated });
  const pointClick = (entry?: Record<string, any>) => {
    const row = entry?.payload || entry;
    const value = row?.category;
    const field = config?.xAxis || config?.yAxis;
    if (field && value !== undefined && value !== null && value !== "" && value !== "(Blank)") {
      onDrilldown(String(field), value);
    }
  };
  if (prepared.message) {
    return <p className="text-sm text-muted-foreground">{prepared.message}</p>;
  }
  if (prepared.mode === "kpi" || chartType === "number") {
    if (!rows.length) {
      return <p className="text-sm text-muted-foreground">No data available</p>;
    }
    return (
      <div
        className={`flex h-full items-center justify-center text-5xl font-medium tracking-tight ${config?.accentColor === "red" ? "text-red-700" : "text-teal-700"}`}
      >
        {prepared.format(prepared.metricTotal)}
      </div>
    );
  }
  if (!prepared.data.length) {
    return <p className="text-sm text-muted-foreground">No data to display</p>;
  }
  let chartData = prepared.data;
  const total = chartData.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  if ((chartType === "pie" || chartType === "donut") && config?.combineOthers && total > 0) {
    const big = chartData.filter((row) => Number(row.value) / total >= 0.05);
    const smallSum = total - big.reduce((sum, row) => sum + Number(row.value), 0);
    if (chartData.length - big.length > 1) {
      chartData = [...big, { category: "Others", value: smallSum }];
    }
  }
  const decimals =
    config?.decimals === undefined || config?.decimals === "auto"
      ? 0
      : Number(config.decimals);
  if (chartType === "gauge") {
    const span = prepared.gauge.max - prepared.gauge.min || 1;
    const ratio = Math.min(1, Math.max(0, (prepared.gauge.value - prepared.gauge.min) / span));
    return (
      <div className="relative h-full min-h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="62%"
            outerRadius="90%"
            data={[{ name: prepared.yTitle || "Value", value: ratio * 100, fill: COLORS[0] }]}
            startAngle={180}
            endAngle={0}
          >
            <RadialBar dataKey="value" cornerRadius={8} background />
            <Tooltip formatter={() => prepared.format(prepared.gauge.value)} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center">
          <div className="text-3xl font-medium text-slate-900">
            {prepared.format(prepared.gauge.value)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {prepared.format(prepared.gauge.min)} to {prepared.format(prepared.gauge.max)}
            {prepared.gauge.target != null
              ? ` · Target ${prepared.format(prepared.gauge.target)}`
              : ""}
          </div>
        </div>
      </div>
    );
  }
  if (chartType === "pie" || chartType === "donut") {
    return (
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-1 z-10 text-center text-xs font-medium text-foreground">
          {prepared.yTitle || "Record Count"}
        </div>
        <div className="absolute inset-x-0 bottom-0 top-6">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
              <Tooltip formatter={(value) => prepared.format(Number(value))} />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="category"
                cx="31%"
                cy="55%"
                innerRadius="48%"
                outerRadius="68%"
                minAngle={4}
                paddingAngle={1}
                label={({ value }) =>
                  config?.showPercentages
                    ? `${total ? ((Number(value) / total) * 100).toFixed(Number.isFinite(decimals) ? decimals : 0) : 0}%`
                    : config?.showValues === false
                      ? ""
                      : prepared.format(Number(value) || 0)
                }
                labelLine={false}
                onClick={(entry) => pointClick(entry as Record<string, any>)}
              >
                {chartData.map((row, index) => (
                  <Cell key={`${String(row.category)}-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="absolute bottom-1 right-1 top-7 w-[42%] overflow-y-auto overscroll-contain pl-2 text-xs leading-5">
          <p className="sticky top-0 z-10 mb-1 truncate bg-background/95 py-1 font-medium text-foreground">
            {prepared.xTitle || "Category"}
          </p>
          <div className="flex flex-col gap-1">
            {chartData.map((row, index) => (
              <span
                key={`${String(row.category)}-${index}`}
                className={`flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 ${hoveredCategory === String(row.category) ? "bg-slate-100" : ""}`}
                title={String(row.category)}
                onMouseEnter={() => setHoveredCategory(String(row.category))}
                onMouseLeave={() => setHoveredCategory(null)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="truncate">{String(row.category)}</span>
              </span>
            ))}
          </div>
        </div>
        {config?.showTotal !== false && (
          <div className="pointer-events-none absolute left-[31%] top-[55%] z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background px-2 py-1 text-center">
            <span className="whitespace-nowrap text-2xl font-medium leading-none text-foreground">
              {prepared.format(total)}
            </span>
          </div>
        )}
      </div>
    );
  }
  if (chartType === "funnel") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip formatter={(value) => prepared.format(Number(value))} />
          <Funnel dataKey="value" data={chartData} isAnimationActive onClick={(entry) => pointClick(entry as Record<string, any>)}>
            {chartData.map((row, index) => (
              <Cell key={`${String(row.category)}-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
            <LabelList position="right" fill="#111827" stroke="none" dataKey="category" />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }
  const reference =
    prepared.reference != null ? (
      <ReferenceLine
        {...(prepared.categoryAxis === "y"
          ? { x: prepared.reference }
          : { y: prepared.reference })}
        stroke="#dc2626"
        strokeDasharray="4 4"
      />
    ) : null;
  const valueLabels = config?.showValues ? (
    <LabelList
      dataKey="value"
      position={prepared.categoryAxis === "y" ? "right" : "top"}
      fill="#111827"
      formatter={(value: unknown) => prepared.format(Number(value) || 0)}
    />
  ) : null;
  if (chartType === "scatter") {
    return (
      <ChartFrame chart={prepared}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={prepared.margin}>
            <AxisPair chart={prepared} />
            <Scatter data={prepared.data} fill={COLORS[0]} onClick={(entry) => pointClick(entry as Record<string, any>)} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }
  if (chartType === "line") {
    return (
      <ChartFrame chart={prepared}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={prepared.margin}>
            <AxisPair chart={prepared} />
            {reference}
            <Line type="monotone" dataKey="value" name={prepared.yTitle || "Value"} stroke={COLORS[0]} dot={chartData.length < 24} onClick={(entry: any) => pointClick(entry?.payload)} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }
  if (chartType === "area") {
    return (
      <ChartFrame chart={prepared}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={prepared.margin}>
            <AxisPair chart={prepared} />
            {reference}
            <Area type="monotone" dataKey="value" name={prepared.yTitle || "Value"} stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.25} onClick={(entry: any) => pointClick(entry?.payload)} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame chart={prepared}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={prepared.margin}
          layout={prepared.categoryAxis === "y" ? "vertical" : "horizontal"}
          onClick={(state: any) => pointClick(state?.activePayload?.[0]?.payload)}
        >
          <AxisPair chart={prepared} />
          {reference}
          <Bar dataKey="value" name={prepared.categoryAxis === "y" ? prepared.xTitle || "Value" : prepared.yTitle || "Value"} fill={COLORS[0]} maxBarSize={48}>
            {valueLabels}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
