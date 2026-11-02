"use client";

import * as React from "react";
import Link from "next/link";
import { BOOKING_DETAIL_FIELDS } from "@dct-crm/shared";
import { CheckCircle2, ChevronDown, History, Loader2, RefreshCw } from "lucide-react";
import { bookingApi, leadApi } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface LeadActivityHistoryCardProps {
  leadId?: string;
  bookingId?: string;
  leadName?: string;
  refreshKey?: string;
  canViewAuditHistory?: boolean;
}

interface ActivityEntry {
  id: string;
  type: string;
  subject: string;
  description?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  location?: string | null;
  priority?: string | null;
  duration?: number;
  callType?: string;
  callFrom?: string | null;
  callTo?: string | null;
  status?: string;
  createdAt: string;
  user?: { firstName: string; lastName: string } | null;
  impersonatedByName?: string | null;
  feedType?: string;
}

export interface HistoryEntry {
  id: string;
  action: string;
  objectType?: string;
  objectId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  createdAt: string;
  user?: { firstName: string; lastName: string } | null;
  impersonatedByName?: string | null;
}

interface DetailRow {
  label: string;
  value: string;
}

type FeedEntry =
  | { kind: "activity"; id: string; date: string; activity: ActivityEntry }
  | { kind: "history"; id: string; date: string; history: HistoryEntry };

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function shortSummary(value?: string | null): string | null {
  const summary = value?.replace(/\s+/g, " ").trim();
  if (!summary) return null;
  return summary.length > 90 ? `${summary.slice(0, 87)}...` : summary;
}

function formatDateTime(value?: string | null, includeYear = false): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function fieldLabel(field: string): string {
  const bookingField = BOOKING_DETAIL_FIELDS.find((entry) => entry.name === field);
  if (bookingField) return bookingField.label;
  return field
    .replace(/Id$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function activityDetailRows(activity: ActivityEntry, userName: string): DetailRow[] {
  const rows: DetailRow[] = [
    { label: "Recorded by", value: userName },
    { label: "Type", value: activityLabel(activity.type) },
  ];
  const add = (label: string, value?: string | number | null) => {
    if (value !== null && value !== undefined && String(value).trim()) {
      rows.push({ label, value: String(value).replace(/_/g, " ") });
    }
  };
  const addDate = (label: string, value?: string | null) => {
    const formatted = formatDateTime(value, true);
    if (formatted) rows.push({ label, value: formatted });
  };

  add("Status", activity.status);
  if (activity.feedType === "CALL_DETAIL") {
    add("Call type", activity.callType);
    add("From", activity.callFrom);
    add("To", activity.callTo);
    if (typeof activity.duration === "number") {
      const minutes = Math.floor(activity.duration / 60);
      const seconds = activity.duration % 60;
      add("Duration", minutes ? `${minutes} min ${seconds} sec` : `${seconds} sec`);
    }
  } else {
    add("Priority", activity.priority);
    addDate(activity.type === "FOLLOW_UP" ? "Follow-up due" : "Due", activity.dueDate);
    addDate("Starts", activity.startAt);
    addDate("Ends", activity.endAt);
    add("Location", activity.location);
  }
  add("Description", activity.description);
  add("Notes", activity.notes);
  return rows;
}

export function historyDetailRows(entry: HistoryEntry, getLeadStatusLabel: (status: string) => string): DetailRow[] {
  const oldValues = entry.oldValues || {};
  const newValues = entry.newValues || {};
  const changes = newValues.changes;
  if (entry.objectType === "Booking" && Array.isArray(changes)) {
    return changes.flatMap((change) => {
      if (!change || typeof change !== "object") return [];
      const item = change as { field?: unknown; label?: unknown; oldValue?: unknown; newValue?: unknown };
      if (typeof item.field !== "string") return [];
      const label = typeof item.label === "string" ? item.label : fieldLabel(item.field);
      const format = (value: unknown) => {
        if (typeof value === "string" && /(At|Date)$/.test(item.field as string)) {
          return formatDateTime(value, true) || displayValue(value).replace(/_/g, " ");
        }
        return displayValue(value).replace(/_/g, " ");
      };
      return [{
        label,
        value: `${format(item.oldValue)} → ${format(item.newValue)}`,
      }];
    });
  }
  if (entry.objectType === "Booking" && Array.isArray(newValues.updatedFields)) {
    return newValues.updatedFields
      .filter((field): field is string => typeof field === "string")
      .map((field) => ({
        label: fieldLabel(field),
        value: "Updated; previous and new values were not recorded.",
      }));
  }
  const ignoredFields = new Set([
    "id", "tenantId", "leadId", "createdAt", "updatedAt", "creatorId", "cancelledById", "completedById",
    "bookingId",
  ]);
  const fields = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);

  return [...fields]
    .filter((field) => !ignoredFields.has(field))
    .filter((field) => JSON.stringify(oldValues[field] ?? null) !== JSON.stringify(newValues[field] ?? null))
    .map((field) => {
      const oldValue = oldValues[field];
      const newValue = newValues[field];
      const formatValue = (value: unknown) => {
        if (entry.objectType === "Lead" && field === "status" && typeof value === "string") {
          return getLeadStatusLabel(value);
        }
        if (typeof value === "string" && /(At|Date)$/.test(field)) {
          return formatDateTime(value, true) || displayValue(value).replace(/_/g, " ");
        }
        return displayValue(value).replace(/_/g, " ");
      };
      return {
        label: fieldLabel(field),
        value: oldValue === undefined
          ? formatValue(newValue)
          : `${formatValue(oldValue)} → ${formatValue(newValue)}`,
      };
    });
}

export function historyDescription(entry: HistoryEntry, getLeadStatusLabel: (status: string) => string): string {
  const recordLabel = entry.objectType === "Booking" ? "Booking" : "Lead";
  const process = bookingProcess(entry);
  if (process === "created") return "Booking was created from a confirmed quotation and its unit was reserved.";
  if (process === "details") {
    const changes = entry.newValues?.changes;
    const fields = Array.isArray(changes)
      ? changes.flatMap((change) => change && typeof change === "object" && "label" in change && typeof change.label === "string" ? [change.label] : [])
      : Array.isArray(entry.newValues?.updatedFields)
        ? entry.newValues.updatedFields.filter((field): field is string => typeof field === "string").map(fieldLabel)
        : [];
    return fields.length
      ? `Changed booking information: ${fields.join(", ")}.`
      : "Booking information was saved; field-level changes were not recorded.";
  }
  if (process === "stage") {
    const from = entry.oldValues?.bookingStage;
    const to = entry.newValues?.bookingStage;
    return from !== undefined && to !== undefined
      ? `Booking stage changed from ${displayValue(from).replace(/_/g, " ")} to ${displayValue(to).replace(/_/g, " ")}.`
      : "Booking stage was changed.";
  }
  if (process === "cancellation-requested") {
    const reason = entry.newValues?.cancellationReason;
    return typeof reason === "string" && reason.trim()
      ? `Cancellation requested for MIS review. Reason: ${reason}`
      : "Cancellation request was sent to MIS for review.";
  }
  if (process === "cancellation-approved") return "MIS approved the cancellation; the booking was cancelled and its unit released.";
  if (process === "cancellation-rejected") {
    const note = entry.newValues?.reviewNote;
    return typeof note === "string" && note.trim()
      ? `MIS rejected the cancellation request. Note: ${note}`
      : "MIS rejected the cancellation request.";
  }
  if (process === "welcome-call") return "Welcome call completed after payment verification; booking confirmed and unit marked booked.";
  if (entry.action === "CREATE") return `${recordLabel} is created.`;
  if (entry.objectType === "Booking" && entry.action === "STATUS_CHANGE") return "Booking status was updated.";
  if (entry.objectType === "Booking" && entry.action === "UPDATE") return "Booking details were updated.";
  if (entry.action === "TASK_CREATED") return "Task created.";
  if (entry.action === "FOLLOW_UP_CREATED") return "Follow-up scheduled.";
  if (entry.action === "NOTE_CREATED") return "Note added to the lead.";
  if (entry.action === "MOVE_TO_RECOVERY") return "Lead marked Lost and moved to Recovery.";
  if (entry.action === "PUSH_TO_SVC") return "Lead moved to Prospect and assigned to SVC.";
  if (entry.action === "SITE_VISIT_SCHEDULED") return "A site visit was scheduled.";
  if (entry.action === "SITE_VISIT_COMPLETED") return "Site visit marked completed.";
  if (entry.action === "SITE_VISIT_MISSED") return "Site visit marked missed.";
  if (entry.action === "SITE_VISIT_CANCELLED") return "Site visit was cancelled.";
  if (entry.action === "SITE_VISIT_CREATED") return "A site visit was scheduled.";
  if (entry.action === "SITE_VISIT_REVISIT_CREATED") return "A site visit revisit was scheduled.";
  if (entry.action === "SITE_VISIT_RESCHEDULED") return "The scheduled date or time for this site visit was changed.";
  if (entry.action === "SITE_VISIT_UPDATED") return "Site visit details were updated.";
  if (entry.action === "TASK_UPDATED") return "Task details or status were updated.";
  if (entry.action === "TASK_COMPLETED") return "Task was completed.";
  if (entry.action === "ASSIGN") return "Task was assigned.";
  if (entry.action === "DELETE") return "A related record was deleted.";
  if (entry.action === "OWNER_CHANGED") return "Lead owner was changed.";
  if (entry.action === "STATUS_CHANGE") {
    const status = entry.newValues?.status;
    return status
      ? `Status changed to ${entry.objectType === "Lead" && typeof status === "string" ? getLeadStatusLabel(status) : displayValue(status).replace(/_/g, " ")}.`
      : "Lead status updated.";
  }
  return `${recordLabel} details updated.`;
}

function activityDescription(activity: ActivityEntry): string {
  if (activity.feedType === "WORKFLOW") return shortSummary(activity.description) || "Lead workflow updated.";
  if (activity.feedType === "CALL_DETAIL") {
    const status = activity.status?.replace(/_/g, " ").toLowerCase() || "logged";
    const duration = typeof activity.duration === "number"
      ? `${Math.floor(activity.duration / 60)} min`
      : null;
    return [status, duration, shortSummary(activity.notes)].filter(Boolean).join(" · ");
  }
  if (activity.type === "FOLLOW_UP") {
    const due = activity.dueDate ? new Date(activity.dueDate) : null;
    const dueDate = due && !Number.isNaN(due.getTime())
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(due)
      : null;
    const note = activity.notes !== activity.subject ? shortSummary(activity.notes) : null;
    return [dueDate ? `Due ${dueDate}` : "Follow-up scheduled", note].filter(Boolean).join(" · ");
  }
  if (activity.type === "TASK") return shortSummary(activity.notes) || "Task created.";
  if (activity.type === "NOTE") return shortSummary(activity.description || activity.notes) || "Note added.";
  const summary = shortSummary(activity.description || activity.notes);
  if (summary) return summary;
  if (activity.status) return activity.status.replace(/_/g, " ").toLowerCase();
  return activity.type.replace(/_/g, " ").toLowerCase();
}

function activityLabel(type: string): string {
  if (type === "FOLLOW_UP") return "Follow-up";
  if (type === "TASK") return "Task";
  if (type === "NOTE") return "Note";
  return type.replace(/_/g, " ").toLowerCase().replace(/^./, (character) => character.toUpperCase());
}

function timelineTitle(title: string): string {
  if (title.includes("_") && title === title.toUpperCase()) {
    return title.replace(/_/g, " ").toLowerCase().replace(/^./, (character) => character.toUpperCase());
  }
  return title;
}

function bookingProcess(entry: HistoryEntry): string | null {
  if (entry.objectType !== "Booking") return null;
  if (entry.action === "BOOKING_CREATED" || entry.action === "CREATE") return "created";
  if (entry.action === "BOOKING_DETAILS_UPDATED") return "details";
  if (entry.action === "BOOKING_STAGE_CHANGED") return "stage";
  if (entry.action === "BOOKING_CANCELLATION_REQUESTED") return "cancellation-requested";
  if (entry.action === "BOOKING_CANCELLATION_APPROVED") return "cancellation-approved";
  if (entry.action === "BOOKING_CANCELLATION_REJECTED") return "cancellation-rejected";
  if (entry.action === "BOOKING_WELCOME_CALL_COMPLETED") return "welcome-call";
  if (entry.action !== "UPDATE") return null;

  const values = entry.newValues || {};
  if ("bookingStage" in values) return "stage";
  if ("cancellationStatus" in values) {
    if (values.cancellationStatus === "PENDING") return "cancellation-requested";
    if (values.cancellationStatus === "APPROVED") return "cancellation-approved";
    if (values.cancellationStatus === "REJECTED") return "cancellation-rejected";
  }
  if ("welcomeCallCompletedAt" in values) return "welcome-call";
  if (Array.isArray(values.changes) || Array.isArray(values.updatedFields)) return "details";
  return null;
}

function bookingWorkflowActivityPattern(process: string | null): RegExp | null {
  if (process === "stage") return /booking status updated/i;
  if (process === "cancellation-requested") return /booking cancellation requested/i;
  if (process === "cancellation-approved") return /booking cancelled by mis/i;
  if (process === "cancellation-rejected") return /booking cancellation rejected by mis/i;
  if (process === "welcome-call") return /welcome call completed/i;
  return null;
}

export function historyTitle(entry: HistoryEntry): string {
  if (entry.objectType === "Booking") {
    const process = bookingProcess(entry);
    if (process === "created") return "Booking Created";
    if (process === "details") return "Booking Details Updated";
    if (process === "stage") return "Booking Stage Changed";
    if (process === "cancellation-requested") return "Booking Cancellation Requested";
    if (process === "cancellation-approved") return "Booking Cancellation Approved";
    if (process === "cancellation-rejected") return "Booking Cancellation Rejected";
    if (process === "welcome-call") return "Welcome Call Completed";
    if (entry.action === "STATUS_CHANGE") return "Booking Status Updated";
    if (entry.action === "UPDATE") return "Booking Record Updated";
  }
  const knownTitles: Record<string, string> = {
    CREATE: "Lead Created",
    OWNER_CHANGED: "Lead Re-Assigned",
    MOVE_TO_RECOVERY: "Lead marked as lost",
    PUSH_TO_SVC: "Pushed to SVC",
    TASK_CREATED: "Task Created",
    FOLLOW_UP_CREATED: "Follow-up Created",
    NOTE_CREATED: "Note Added",
    SITE_VISIT_SCHEDULED: "Site Visit Scheduled",
    SITE_VISIT_COMPLETED: "Site Visit Completed",
    SITE_VISIT_MISSED: "Site Visit Missed",
    SITE_VISIT_CANCELLED: "Site Visit Cancelled",
    SITE_VISIT_CREATED: "Site Visit Scheduled",
    SITE_VISIT_REVISIT_CREATED: "Revisit Scheduled",
    SITE_VISIT_RESCHEDULED: "Site Visit Rescheduled",
    SITE_VISIT_UPDATED: "Site Visit Updated",
    TASK_UPDATED: "Task Updated",
    TASK_COMPLETED: "Task Completed",
    ASSIGN: "Task Assigned",
    UPDATE: "Record Updated",
    STATUS_CHANGE: "Status Updated",
    DELETE: "Record Deleted",
  };
  return knownTitles[entry.action] || timelineTitle(entry.action.replace(/_/g, " "));
}

function timelineMonth(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(parsed);
}

function timelineDate(date: string): string {
  return formatDateTime(date) || "Date unavailable";
}

function actorSummary(entry: FeedEntry, userName: string): string {
  if (entry.kind === "activity") {
    if (entry.activity.feedType === "WORKFLOW") return `${userName} updated this lead`;
    if (entry.activity.feedType === "CALL_DETAIL") return `${userName} logged a call`;
    const label = activityLabel(entry.activity.type).toLowerCase();
    return `${userName} logged ${label}`;
  }
  if (entry.history.action === "TASK_CREATED") return `${userName} had a task`;
  if (entry.history.action === "FOLLOW_UP_CREATED") return `${userName} had a follow-up`;
  const process = bookingProcess(entry.history);
  if (process === "created") return `${userName} created this booking`;
  if (process === "details") return `${userName} changed booking information`;
  if (process === "stage") return `${userName} changed the booking stage`;
  if (process === "cancellation-requested") return `${userName} requested booking cancellation`;
  if (process === "cancellation-approved") return `${userName} approved booking cancellation`;
  if (process === "cancellation-rejected") return `${userName} rejected booking cancellation`;
  if (process === "welcome-call") return `${userName} completed the welcome call`;
  return `${userName} updated this ${entry.history.objectType === "Booking" ? "booking" : "lead"}`;
}

export default function LeadActivityHistoryCard({
  leadId,
  bookingId,
  refreshKey,
  canViewAuditHistory = false,
}: LeadActivityHistoryCardProps) {
  const recordId = bookingId || leadId;
  const isBooking = Boolean(bookingId);
  const { getLeadStatusLabel } = useAuth();
  const [activities, setActivities] = React.useState<ActivityEntry[]>([]);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState<string | null>(null);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setActivityError(null);
    setHistoryError(null);

    const [activityResult, historyResult] = await Promise.all([
      Promise.allSettled([
        isBooking
          ? bookingApi.getActivityHistory(recordId!, { page: 1, limit: 100 })
          : leadApi.getActivityHistory(recordId!, { page: 1, limit: 100 }),
      ]),
      canViewAuditHistory
        ? Promise.allSettled([
            isBooking
              ? bookingApi.getAuditHistory(recordId!, { page: 1, limit: 100 })
              : leadApi.getAuditHistory(recordId!, { page: 1, limit: 100 }),
          ])
        : Promise.resolve([]),
    ]);

    const activity = activityResult[0];
    if (activity.status === "fulfilled" && activity.value.data.success) {
      setActivities(activity.value.data.data || []);
    } else {
      setActivities([]);
      setActivityError(
        activity.status === "rejected"
          ? activity.reason?.response?.data?.error || activity.reason?.message || "Activity entries could not be loaded."
          : activity.value.data.error || "Activity entries could not be loaded.",
      );
    }

    const auditHistory = historyResult[0];
    if (auditHistory?.status === "fulfilled" && auditHistory.value.data.success) {
      setHistory(auditHistory.value.data.data || []);
    } else if (auditHistory) {
      setHistory([]);
      setHistoryError(
        auditHistory.status === "rejected"
          ? auditHistory.reason?.response?.data?.error || auditHistory.reason?.message || "History entries could not be loaded."
          : auditHistory.value.data.error || "History entries could not be loaded.",
      );
    } else {
      setHistory([]);
    }
    setLoading(false);
  }, [canViewAuditHistory, isBooking, recordId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const entries = React.useMemo<FeedEntry[]>(() => {
    const activityEntries: FeedEntry[] = activities.map((activity) => ({
      kind: "activity",
      id: `activity-${activity.id}`,
      date: activity.createdAt,
      activity,
    }));
    const activityIds = new Set(activities.map((activity) => activity.id));
    const visibleHistory = history.filter((entry) => {
      const representedAsActivity =
        entry.action === "TASK_CREATED" || entry.action === "FOLLOW_UP_CREATED";
      const bookingActivityPattern = isBooking ? bookingWorkflowActivityPattern(bookingProcess(entry)) : null;
      const representedByBookingActivity = Boolean(bookingActivityPattern && activities.some((activity) => (
        bookingActivityPattern.test(activity.subject)
        && Math.abs(new Date(activity.createdAt).getTime() - new Date(entry.createdAt).getTime()) < 2 * 60 * 1000
      )));
      const representedByWorkflowFeed = [
        "MOVE_TO_RECOVERY",
        "NOTE_CREATED",
        "OWNER_CHANGED",
        "PUSH_TO_SVC",
        "SITE_VISIT_CANCELLED",
        "SITE_VISIT_COMPLETED",
        "SITE_VISIT_CREATED",
        "SITE_VISIT_MISSED",
        "SITE_VISIT_SCHEDULED",
        "SITE_VISIT_REVISIT_CREATED",
        "SITE_VISIT_RESCHEDULED",
        "SITE_VISIT_UPDATED",
        "TASK_UPDATED",
        "TASK_COMPLETED",
        "ASSIGN",
        "DELETE",
      ].includes(entry.action) ||
      (entry.action === "UPDATE" && ["Lead", "Activity", "CallDetail", "FollowUp"].includes(entry.objectType || "")) ||
      (entry.action === "STATUS_CHANGE" && ["Lead", "Activity", "FollowUp", "Task"].includes(entry.objectType || ""));
      return !representedByWorkflowFeed
        && !representedByBookingActivity
        && (!representedAsActivity || !entry.objectId || !activityIds.has(entry.objectId));
    });
    const historyEntries: FeedEntry[] = visibleHistory.map((entry) => ({
      kind: "history",
      id: `history-${entry.id}`,
      date: entry.createdAt,
      history: entry,
    }));
    return [...activityEntries, ...historyEntries].sort(
      (first, second) => new Date(second.date).getTime() - new Date(first.date).getTime(),
    );
  }, [activities, history, isBooking]);

  const groupedEntries = React.useMemo(() => {
    const groups = new Map<string, FeedEntry[]>();
    for (const entry of entries) {
      const month = timelineMonth(entry.date);
      groups.set(month, [...(groups.get(month) || []), entry]);
    }
    return [...groups.entries()];
  }, [entries]);
  const hasVisibleSourceError = Boolean(activityError || historyError);

  return (
    <Card className="my-0 box-border w-full rounded-md border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3 border-b border-slate-200 bg-white p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#13a9d2]">
            <History className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <h2 className="text-[12px] font-semibold">{isBooking ? "Booking Activity and History" : "Lead Activity and History"}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full bg-[#08749f] text-white hover:bg-[#066487] hover:text-white"
            aria-label={`Refresh ${isBooking ? "booking" : "lead"} activity and history`}
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="border-t p-3">
        <div className="max-h-[350px] space-y-0 overflow-y-auto" aria-live="polite" aria-busy={loading}>
          {loading && entries.length === 0 ? (
            <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading activity and history...
            </div>
          ) : entries.length ? (
            groupedEntries.map(([month, monthEntries]) => (
              <section key={month} className="mb-2">
                <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-sky-100 bg-white py-1.5 text-[11px] text-blue-700">
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  <span className="font-medium">{month}</span>
                </div>
                <div className="pt-2">
                  {monthEntries.map((entry, index) => {
                    const user = entry.kind === "activity" ? entry.activity.user : entry.history.user;
                    const via = entry.kind === "activity" ? entry.activity.impersonatedByName : entry.history.impersonatedByName;
                    const baseName = user ? `${user.firstName} ${user.lastName}`.trim() : "System";
                    const userName = via ? `${baseName} (via Superadmin: ${via})` : baseName;
                    const title = entry.kind === "activity"
                      ? timelineTitle(entry.activity.subject || `${activityLabel(entry.activity.type)} Activity`)
                      : historyTitle(entry.history);
                    const details = entry.kind === "activity"
                      ? activityDescription(entry.activity)
                      : historyDescription(entry.history, getLeadStatusLabel);
                    const detailRows = entry.kind === "activity"
                      ? activityDetailRows(entry.activity, userName)
                      : historyDetailRows(entry.history, getLeadStatusLabel);

                    return (
                      <div key={entry.id} className="relative pb-2 pl-7 last:pb-0">
                        {index < monthEntries.length - 1 && (
                          <span className="absolute bottom-0 left-[7px] top-4 border-l border-slate-300" aria-hidden="true" />
                        )}
                        <span className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-background" aria-hidden="true">
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium leading-4 text-blue-700 underline decoration-dotted underline-offset-2 group-open:no-underline">
                                {title}
                              </span>
                              <span className="block truncate text-[10px] leading-4 text-muted-foreground">
                                {actorSummary(entry, userName)} · {details}
                              </span>
                            </span>
                            <time
                              dateTime={Number.isNaN(new Date(entry.date).getTime()) ? undefined : entry.date}
                              title={formatDateTime(entry.date, true) || "Date unavailable"}
                              className="shrink-0 pt-0.5 text-right text-[10px] leading-4 text-muted-foreground"
                            >
                              {timelineDate(entry.date)}
                            </time>
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 text-muted-foreground">
                              <ChevronDown
                                className="h-3 w-3 transition-transform group-open:rotate-180"
                                aria-hidden="true"
                              />
                            </span>
                          </summary>
                          <div className="mt-2 rounded-sm border-l-2 border-sky-500 bg-muted/30 py-2 pl-3 pr-2 text-[11px]">
                            <p className="font-medium text-slate-800">{title}</p>
                            <p className="mt-1 text-muted-foreground">{details}</p>
                            {detailRows.length > 0 && (
                              <dl className="mt-2 space-y-1">
                                {detailRows.map((row) => (
                                  <div key={row.label} className="grid grid-cols-[auto_1fr] gap-x-2">
                                    <dt className="font-medium text-slate-700">{row.label}</dt>
                                    <dd className="min-w-0 break-words text-muted-foreground">{row.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                            <p className="mt-2 border-t border-slate-200 pt-1.5 text-muted-foreground">
                              {formatDateTime(entry.date, true) || "Date unavailable"}
                            </p>
                            {entry.kind === "activity" && entry.activity.feedType === "CALL_DETAIL" && (
                              <Link href={`/call-details/${entry.activity.id}`} className="mt-1 inline-block font-medium text-sky-700 hover:underline">
                                Open call details
                              </Link>
                            )}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : hasVisibleSourceError ? (
            <p role="alert" className="py-5 text-center text-sm text-destructive">
              {activityError && historyError
                ? `Unable to load activity or history: ${activityError} ${historyError}`
                : `Unable to load ${activityError ? "activity" : "history"}: ${activityError || historyError}`}
            </p>
          ) : (
            <p className="py-5 text-center text-sm text-muted-foreground">
              No activity or history entries found.
            </p>
          )}
          {hasVisibleSourceError && entries.length > 0 && (
            <p role="alert" className="py-2 text-xs text-destructive">
              {`Some entries could not be loaded: ${activityError || historyError}`}
            </p>
          )}
          {!loading && !hasVisibleSourceError && entries.length > 0 && (
            <p className="py-2 text-center text-[10px] text-muted-foreground">
              No more past activities to load.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
