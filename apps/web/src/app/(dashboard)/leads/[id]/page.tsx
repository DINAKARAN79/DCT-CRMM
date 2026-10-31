"use client";

import { formatDate, formatDateTime } from "@/lib/date-format";
import {
  crmDateTimeInputValue,
  crmLocalDateTimeToDate,
  PROSPECT_BEDROOM_OPTIONS,
  PROSPECT_BUDGET_OPTIONS,
  PROSPECT_POSSESSION_OPTIONS,
  PROSPECT_PROPERTY_TYPE_OPTIONS,
  PROSPECT_REASON_TO_BUY_OPTIONS,
  SITE_VISIT_FUTURE_TIME_ERROR,
  SITE_VISIT_TYPE_OPTIONS,
  isVersion2Layout,
  parseLayoutDocument,
  replaceLayoutSections,
} from "@dct-crm/shared";
import {
  emptySiteVisitScheduleFormValue,
  siteVisitScheduleIsFuture,
  SiteVisitScheduleFields,
  type SiteVisitScheduleFormValue,
} from "@/components/crm/site-visit-schedule-fields";

import * as React from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { useAuth } from "@/contexts/auth-context";

import { leadApi, siteVisitApi, activityApi, callDetailsApi, followUpApi, objectManagerApi, projectApi, enquiryApi } from "@/lib/api";
import { clickToCallToast, type ClickToCallField } from "@/lib/click-to-call";
import { requestLeadCall } from "@/lib/telephony-client";
import { maskTelephonyNumber, useTelephonyActive, useTelephonyNumberMasking } from "@/lib/telephony-client";
import { ToastAction } from "@/components/ui/toast";
import { notifyLeadListUpdated } from "@/lib/lead-list-events";
import { LeadStatusPath } from "@/components/crm/lead-status-path";
import { useRecordView } from "@/components/crm/list-view-control";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumb";
import { formatPhoneWithCountryCode } from "@/lib/phone-display";
import { sortFollowUpsByStatus } from "@/lib/follow-up-order";
import { selectLeadPageLayout } from "@/lib/lead-profile-layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import LayoutDrivenForm from "@/components/admin/layout-driven-form";
import LeadActivityHistoryCard from "@/components/crm/lead-activity-history-card";
import { LeadBookings } from "@/components/crm/lead-bookings";
import { LeadQuotations } from "@/components/crm/lead-quotations";
import { LeadReceipts } from "@/components/crm/lead-receipts";
import { LeadInstallments } from "@/components/crm/lead-installments";
import StickyNotesCard from "@/components/crm/sticky-notes-card";
import { UserLookup } from "@/components/crm/user-lookup";

import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Separator } from "@/components/ui/separator";

import { Skeleton } from "@/components/ui/skeleton";

import { Textarea } from "@/components/ui/textarea";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  CheckSquare,
  Clock,
  Map,
  History,
  Inbox,
  ArrowLeft,
  AlertTriangle,
  ArrowRight,
  StickyNote,
  Edit3,
  Save,
  X,
  Monitor,
  ChevronDown,
  Trash2,
  CreditCard,
  CalendarClock,
} from "lucide-react";

const RECOVERY_REASONS = [
  "Not Interested",
  "Budget Issue",
  "No Response",
  "Property Not Suitable",
  "Customer Request",
  "Other",
];

interface LeadData {
  id: string;
  leadNumber: string;
  salutation?: string;
  firstName?: string;
  lastName: string;
  title?: string;
  email?: string;
  phone?: string;
  countryCode?: string | null;
  mobile?: string;
  secondaryPhone?: string | null;
  secondaryCountryCode?: string | null;
  tertiaryPhone?: string | null;
  website?: string;
  company: string;
  industry?: string;
  annualRevenue?: number;
  numberOfEmployees?: number;
  source: string;
  status: string;
  statusId?: string;
  statusLabel?: string;
  rating?: string;
  description?: string;
  score?: number;
  budget?: number;
  street?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  postalCode?: string;
  requirements?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  owner?: { id: string; firstName: string; lastName: string; phone?: string | null };
  creator?: { id: string; firstName: string; lastName: string };
  project?: { id: string; name: string; allowedRadiusMeters?: number };
  rrQueue?: { id: string; name: string } | null;
  projectId?: string | null;
  siteVisits?: any[];
  activities?: any[];
  tasks?: any[];
  followUps?: any[];
  auditLogs?: any[];
  ownerHistory?: any[];
  lastModified?: {
    by?: { id: string; firstName: string; lastName: string; email?: string | null } | null;
    at?: string;
    action?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LeadEnquiry {
  id: string;
  enquiryNumber: string;
  leadType: string;
  enquiryType: string;
  source: string;
  subSource?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  secondaryPhone?: string | null;
  secondaryCountryCode?: string | null;
  tertiaryPhone?: string | null;
  tertiaryCountryCode?: string | null;
  email?: string | null;
  secondaryEmail?: string | null;
  tertiaryEmail?: string | null;
  campaign?: string | null;
  campaignId?: string | null;
  subCampaign?: string | null;
  subCampaignId?: string | null;
  medium?: string | null;
  description?: string | null;
  channelPartner?: string | null;
  project?: { id: string; name: string } | null;
  attributes?: Record<string, string | boolean | null>;
  leadNumber?: string | null;
  leadName?: string | null;
  leadOwnerName?: string | null;
  phoneWithCountryCode?: string | null;
  createdDateDisplay?: string | null;
  enquiryDate: string;
  createdAt: string;
}

interface EnquiryEditDraft {
  leadType: string;
  source: string;
  subSource: string;
  campaign: string;
  campaignId: string;
  subCampaign: string;
  subCampaignId: string;
  projectId: string;
  countryCode: string;
  phone: string;
  secondaryCountryCode: string;
  secondaryPhone: string;
  tertiaryCountryCode: string;
  tertiaryPhone: string;
  email: string;
  secondaryEmail: string;
  tertiaryEmail: string;
  medium: string;
  channelPartner: string;
  description: string;
  enquiryDate: string;
  budgetRange: string;
  centRange: string;
  allocatedProject: string;
  purposeOfPurchase: string;
  referralBy: string;
  enquiryStatus: string;
  typeOfLead: string;
  voiceOfCustomer: string;
  genuinelyInterested: string;
  pleaseConfirm: string;
  primary: boolean;
}

interface PushSvcLeadDraft {
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  email: string;
  projectId: string;
}

const LEAD_EDITABLE_FIELDS = [
  "salutation",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "mobile",
  "website",
  "company",
  "industry",
  "annualRevenue",
  "numberOfEmployees",
  "source",
  "status",
  "rating",
  "description",
  "score",
  "budget",
  "street",
  "city",
  "stateProvince",
  "country",
  "postalCode",
  "requirements",
  "notes",
  "projectId",
] as const;

const formatLeadTypeLabel = (leadType?: string | null) => {
  switch (leadType) {
    case "ORIGINAL":
    case "ADDITIONAL":
      return "Fresh";
    case "RE_ENGAGED":
      return "Re-Engaged";
    case "RE_OPENED":
      return "Re-Opened";
    default:
      return leadType ? leadType.replaceAll("_", " ") : "—";
  }
};

function callAnswerLabel(status?: string | null) {
  if (status === "COMPLETED") return "Answer";
  if (status === "NO_ANSWER" || status === "BUSY" || status === "VOICEMAIL" || status === "CANCELLED") return "Not Answer";
  if (!status) return "—";
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function callStatusLabel(status?: string | null) {
  if (status === "COMPLETED") return "Complete";
  if (status === "NO_ANSWER") return "No Answer";
  if (status === "BUSY") return "Busy";
  if (!status) return "—";
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function callEndOneMinuteAfter(startValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startValue)) return "";
  const start = crmLocalDateTimeToDate(startValue.slice(0, 10), startValue.slice(11, 16));
  return crmDateTimeInputValue(new Date(start.getTime() + 60_000));
}

export default function LeadDetailPage() {
  const params = useParams();
  useRecordView("LEAD", typeof params.id === "string" ? params.id : "");
  const router = useRouter();
  const { profile, isLoading: authLoading, hasPermission, hasEffectivePermission, isAdmin, isSuperAdmin, getLeadStatusLabel } = useAuth();
  const telephonyActive = useTelephonyActive();
  useTelephonyNumberMasking();
  const { toast } = useToast();
  const leadId = params.id as string;
  const canEditLead = hasPermission("Lead", "edit") || isAdmin || isSuperAdmin;
  const canEditLeadLayout = isSuperAdmin || (isAdmin && hasEffectivePermission("PROFILE_PERMISSION_MANAGE"));
  const canChangeOwner = canEditLead;

  const [lead, setLead] = React.useState<LeadData | null>(null);
  const status = lead?.status || "";
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isActionLoading, setIsActionLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("overview");
  React.useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab) setActiveTab(requestedTab);
  }, []);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = React.useState(false);
  const [recoveryReason, setRecoveryReason] = React.useState("");
  const [recoveryNote, setRecoveryNote] = React.useState("");
  const [layout, setLayout] = React.useState<any>(null);
  const [fields, setFields] = React.useState<any[]>([]);

  const [followUpDialogOpen, setFollowUpDialogOpen] = React.useState(false);
  const [followUpNote, setFollowUpNote] = React.useState("");
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [followUpTime, setFollowUpTime] = React.useState("");
  const earliestFollowUp = new Date();
  earliestFollowUp.setSeconds(0, 0);
  earliestFollowUp.setMinutes(earliestFollowUp.getMinutes() + 1);
  const followUpMinDate = `${earliestFollowUp.getFullYear()}-${String(earliestFollowUp.getMonth() + 1).padStart(2, "0")}-${String(earliestFollowUp.getDate()).padStart(2, "0")}`;
  const followUpNowTime = `${String(earliestFollowUp.getHours()).padStart(2, "0")}:${String(earliestFollowUp.getMinutes()).padStart(2, "0")}`;
  const followUpScheduledAt = followUpDate && followUpTime ? new Date(`${followUpDate}T${followUpTime}`) : null;
  const followUpScheduleError = followUpScheduledAt && (Number.isNaN(followUpScheduledAt.getTime()) || followUpScheduledAt.getTime() <= Date.now())
    ? "Choose a future date and time."
    : "";
  const [callDialogOpen, setCallDialogOpen] = React.useState(false);
  const [callingField, setCallingField] = React.useState<ClickToCallField | null>(null);
  const [callType, setCallType] = React.useState<"INBOUND" | "OUTBOUND">("OUTBOUND");
  const [callStartAt, setCallStartAt] = React.useState("");
  const [callEndAt, setCallEndAt] = React.useState("");
  const [callFrom, setCallFrom] = React.useState("");
  const [callTo, setCallTo] = React.useState("");
  const [callStatus, setCallStatus] = React.useState("COMPLETED");
  const [callNotes, setCallNotes] = React.useState("");
  const [callSaving, setCallSaving] = React.useState(false);
  const [stickyNotesRefresh, setStickyNotesRefresh] = React.useState(0);

  const [taskDialogOpen, setTaskDialogOpen] = React.useState(false);
  const [taskNote, setTaskNote] = React.useState("");
  const [taskDueDate, setTaskDueDate] = React.useState("");
  const [taskTime, setTaskTime] = React.useState("");

  const [siteVisitDialogOpen, setSiteVisitDialogOpen] = React.useState(false);
  const [siteVisitForm, setSiteVisitForm] = React.useState<SiteVisitScheduleFormValue>(emptySiteVisitScheduleFormValue);
  const [projects, setProjects] = React.useState<any[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [projectsError, setProjectsError] = React.useState<string | null>(null);
  const projectsLoaded = React.useRef(false);
  const projectsRequest = React.useRef<Promise<void> | null>(null);

  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false);
  const [noteContent, setNoteContent] = React.useState("");
  const [noteSubject, setNoteSubject] = React.useState("");

  const [pushSvcDialogOpen, setPushSvcDialogOpen] = React.useState(false);
  const [pushSvcReason, setPushSvcReason] = React.useState("");
  const [pushSvcProjectId, setPushSvcProjectId] = React.useState("");
  const [pushSvcMinimumBudget, setPushSvcMinimumBudget] = React.useState("");
  const [pushSvcMaximumBudget, setPushSvcMaximumBudget] = React.useState("");
  const [pushSvcBedroomPreference, setPushSvcBedroomPreference] = React.useState<string[]>([]);
  const [pushSvcPropertyType, setPushSvcPropertyType] = React.useState<string[]>([]);
  const [pushSvcPossession, setPushSvcPossession] = React.useState("");
  const [pushSvcReasonToBuy, setPushSvcReasonToBuy] = React.useState("");
  const [pushSvcLeadEditing, setPushSvcLeadEditing] = React.useState(false);
  const [pushSvcLeadDraft, setPushSvcLeadDraft] = React.useState<PushSvcLeadDraft>({
    firstName: "",
    lastName: "",
    phone: "",
    company: "",
    email: "",
    projectId: "",
  });

  const [auditLogs, setAuditLogs] = React.useState<any[]>([]);
  const [auditPage, setAuditPage] = React.useState(1);
  const [auditTotalPages, setAuditTotalPages] = React.useState(1);
  const [auditTotal, setAuditTotal] = React.useState(0);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [enquiries, setEnquiries] = React.useState<LeadEnquiry[]>([]);
  const [enquiriesLoading, setEnquiriesLoading] = React.useState(false);
  const [enquiriesError, setEnquiriesError] = React.useState<string | null>(null);
  const [showAllEnquiries, setShowAllEnquiries] = React.useState(false);
  const [showAllFollowUps, setShowAllFollowUps] = React.useState(false);
  const [callDetails, setCallDetails] = React.useState<any[]>([]);
  const [callDetailsLoading, setCallDetailsLoading] = React.useState(false);
  const [callDetailsError, setCallDetailsError] = React.useState<string | null>(null);
  const [showAllSiteVisits, setShowAllSiteVisits] = React.useState(false);
  const [showAllCallDetails, setShowAllCallDetails] = React.useState(false);
  const [showAllFeedbacks, setShowAllFeedbacks] = React.useState(false);
  const [editingEnquiry, setEditingEnquiry] = React.useState<LeadEnquiry | null>(null);
  const [enquiryEditDraft, setEnquiryEditDraft] = React.useState<EnquiryEditDraft | null>(null);
  const [enquiryEditProjects, setEnquiryEditProjects] = React.useState<Array<{ id: string; name: string }>>([]);
  const [enquiryEditProjectsLoading, setEnquiryEditProjectsLoading] = React.useState(false);
  const [enquiryEditError, setEnquiryEditError] = React.useState<string | null>(null);
  const [enquirySaveLoading, setEnquirySaveLoading] = React.useState(false);
  const [enquiryDeleteTarget, setEnquiryDeleteTarget] = React.useState<LeadEnquiry | null>(null);
  const [enquiryDeleteLoading, setEnquiryDeleteLoading] = React.useState(false);

  const [isEditing, setIsEditing] = React.useState(false);
  const [editingFieldName, setEditingFieldName] = React.useState<string | null>(null);
  const [editData, setEditData] = React.useState<Record<string, any>>({});
  const [editFieldErrors, setEditFieldErrors] = React.useState<Record<string, string>>({});

  const [revisitDialogOpen, setRevisitDialogOpen] = React.useState(false);
  const [rescheduleSiteVisitId, setRescheduleSiteVisitId] = React.useState<string | null>(null);
  const [revisitSourceSiteVisitId, setRevisitSourceSiteVisitId] = React.useState<string | null>(null);
  const [revisitForm, setRevisitForm] = React.useState<SiteVisitScheduleFormValue>(emptySiteVisitScheduleFormValue);

  const [cancelSvDialogOpen, setCancelSvDialogOpen] = React.useState(false);
  const [cancelSvReason, setCancelSvReason] = React.useState("");

  const [completeSvDialogOpen, setCompleteSvDialogOpen] = React.useState(false);
  const [completeSvFeedback, setCompleteSvFeedback] = React.useState("");
  const [completeSvNotes, setCompleteSvNotes] = React.useState("");
  const [completeSvTime, setCompleteSvTime] = React.useState("");
  const [completeSvRating, setCompleteSvRating] = React.useState("");

  const [detailDialogOpen, setDetailDialogOpen] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<{ kind: "task" | "followup" | "note" | "activity"; data: any } | null>(null);

  const [ownerDialogOpen, setOwnerDialogOpen] = React.useState(false);
  const [ownerCandidates, setOwnerCandidates] = React.useState<any[]>([]);
  const [newOwnerId, setNewOwnerId] = React.useState("");

  const fetchLead = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const [leadResult, layoutResult, layoutsResult, fieldsResult, assignedResult] = await Promise.allSettled([
        leadApi.get(leadId),
        objectManagerApi.getDefaultLayout("Lead"),
        objectManagerApi.listLayouts("Lead"),
        objectManagerApi.listFields("Lead", { includeSystem: true }),
        objectManagerApi.resolveLayout("Lead"),
      ]);

      if (leadResult.status === "fulfilled" && leadResult.value.data?.success && leadResult.value.data.data) {
        setLoadError(null);
        setLead(leadResult.value.data.data);
      } else {
        const errorMessage = leadResult.status === "rejected"
          ? "Failed to load lead"
          : leadResult.value?.data?.error || "Lead not found";
        setLead(null);
        setLoadError(errorMessage);
        toast({ title: "Error", description: errorMessage, variant: "destructive" as any });
      }

      if (layoutResult.status === "fulfilled") {
        const layouts = layoutsResult.status === "fulfilled" && Array.isArray(layoutsResult.value.data?.data)
          ? layoutsResult.value.data.data
          : [];
        const assignedId = assignedResult.status === "fulfilled" ? assignedResult.value.data?.data?.id : null;
        setLayout(selectLeadPageLayout(
          layouts,
          layoutResult.value.data?.data ?? null,
          profile?.name,
          assignedId,
        ));
      }

      if (fieldsResult.status === "fulfilled") {
        setFields(fieldsResult.value.data?.data || []);
      }
    } catch {
      setLead(null);
      setLoadError("Failed to load lead");
      toast({ title: "Error", description: "Failed to load lead", variant: "destructive" as any });
    } finally {
      setIsLoading(false);
    }
  }, [leadId, profile?.name, toast]);

  const saveLeadLayout = async (sections: { name: string; fields: string[] }[]) => {
    if (!layout?.id) {
      toast({
        title: "Unable to save layout",
        description:         "The Lead page layout could not be identified.",
        variant: "destructive",
      });
      throw new Error("The Lead page layout could not be identified.");
    }
    try {
      const rawSections = typeof layout.sections === "string"
        ? JSON.parse(layout.sections)
        : layout.sections;
      const originalSections = Array.isArray(rawSections) ? rawSections : [];
      const savedSections = sections.map((section) => {
        const original = originalSections.find((item: any) => item.name === section.name);
        return original?.fields?.includes("record_number") && !section.fields.includes("record_number")
          ? { ...section, fields: [...section.fields, "record_number"] }
          : section;
      });
      const storedSections = isVersion2Layout(rawSections)
        ? replaceLayoutSections(parseLayoutDocument(rawSections, layout.name), savedSections)
        : savedSections;
      const response = await objectManagerApi.updateLayout("Lead", layout.id, { sections: storedSections });
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error || "The Lead layout could not be saved.");
      }
      setLayout(response.data.data);
      toast({ title: "Layout saved", description: "The Lead Information field order has been updated." });
    } catch (error: any) {
      toast({
        title: "Unable to save layout",
        description: error?.response?.data?.error || error?.message || "Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const fetchAuditHistory = React.useCallback(
    async (page = 1) => {
      setAuditLoading(true);
      try {
        const res = await leadApi.getAuditHistory(leadId, { page, limit: 20 });
        if (res.data.success) {
          setAuditLogs(res.data.data || []);
          const p = res.data.pagination;
          setAuditPage(p?.page || page);
          setAuditTotalPages(p?.totalPages || 1);
          setAuditTotal(p?.total || 0);
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to load audit history",
          variant: "destructive" as any,
        });
      } finally {
        setAuditLoading(false);
      }
    },
    [leadId, toast],
  );

  const fetchEnquiries = React.useCallback(async () => {
    setEnquiriesLoading(true);
    setEnquiriesError(null);
    try {
      const response = await leadApi.getEnquiries(leadId, { page: 1, limit: 100 });
      if (!response.data.success) {
        throw new Error(response.data.error || "Failed to load enquiries");
      }
      setEnquiries(response.data.data || []);
    } catch (error: any) {
      setEnquiriesError(error?.response?.data?.error || error?.message || "Failed to load enquiries.");
    } finally {
      setEnquiriesLoading(false);
    }
  }, [leadId]);

  const fetchCallDetails = React.useCallback(async () => {
    setCallDetailsLoading(true);
    setCallDetailsError(null);
    try {
      const [activityResponse, callDetailsResponse] = await Promise.all([
        activityApi.list({ leadId, type: "CALL", page: 1, limit: 100 }),
        callDetailsApi.list(leadId),
      ]);
      if (!activityResponse.data.success || !callDetailsResponse.data.success) {
        throw new Error(activityResponse.data.error || callDetailsResponse.data.error || "Failed to load call details");
      }
      setCallDetails([
        ...(callDetailsResponse.data.data || []).map((call: any) => ({ ...call, recordType: "CALL_DETAIL" })),
        ...(activityResponse.data.data || []).map((call: any) => ({ ...call, recordType: "ACTIVITY" })),
      ].sort((left: any, right: any) => new Date(right.startAt || right.createdAt).getTime() - new Date(left.startAt || left.createdAt).getTime()));
    } catch (error: any) {
      setCallDetailsError(error?.response?.data?.error || error?.message || "Failed to load call details.");
    } finally {
      setCallDetailsLoading(false);
    }
  }, [leadId]);

  React.useEffect(() => {
    const refreshFromDialpad = (event: Event) => {
      const detail = (event as CustomEvent<{ leadId?: string }>).detail;
      if (detail?.leadId !== leadId) return;
      void fetchCallDetails();
      void leadApi.get(leadId).then((response) => {
        if (response.data.success && response.data.data) {
          setLead((current) => current ? { ...current, ...response.data.data } : response.data.data);
        }
      }).catch((error: unknown) => toast({
        title: "Unable to refresh lead status",
        description: error instanceof Error ? error.message : "Refresh the lead to see the latest call status.",
        variant: "destructive",
      }));
    };
    window.addEventListener("crm:call-details-updated", refreshFromDialpad);
    return () => window.removeEventListener("crm:call-details-updated", refreshFromDialpad);
  }, [fetchCallDetails, leadId, toast]);

  const customerCallNumber = lead?.phone || lead?.mobile || "";
  const executiveCallNumber = lead?.owner?.phone?.trim() || "";

  const applyCallNumbers = (type: "INBOUND" | "OUTBOUND") => {
    if (type === "OUTBOUND") {
      setCallFrom(executiveCallNumber);
      setCallTo(customerCallNumber);
      return;
    }
    setCallFrom(customerCallNumber);
    setCallTo(executiveCallNumber);
  };

  const openCallDialog = () => {
    const startValue = crmDateTimeInputValue();
    setCallType("OUTBOUND");
    setCallStartAt(startValue);
    setCallEndAt(callEndOneMinuteAfter(startValue));
    setCallFrom(executiveCallNumber);
    setCallTo(customerCallNumber);
    setCallStatus("COMPLETED");
    setCallNotes("");
    setCallDialogOpen(true);
  };

  const handleLogCall = async () => {
    if (!callStartAt || !callEndAt) {
      toast({ title: "Call details required", description: "Enter both the call start time and end time.", variant: "destructive" });
      return;
    }
    const startAt = crmLocalDateTimeToDate(callStartAt.slice(0, 10), callStartAt.slice(11, 16));
    const endAt = crmLocalDateTimeToDate(callEndAt.slice(0, 10), callEndAt.slice(11, 16));
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt < startAt) {
      toast({ title: "Invalid call time", description: "The end time cannot be before the start time. The same time is allowed.", variant: "destructive" });
      return;
    }

    setCallSaving(true);
    try {
      const response = await callDetailsApi.create({
        leadId,
        caseId: leadId,
        callType,
        callFrom: callFrom.trim(),
        callTo: callTo.trim(),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        status: callStatus,
        parentId: leadId,
        parentUrl: new URL(`/leads/${leadId}`, window.location.origin).toString(),
        notes: callNotes.trim() || undefined,
      });
      const savedCall = response.data?.data;
      const statusChanged = savedCall?.leadStatusChanged === true && savedCall?.leadStatus === "INCOMING";

      setCallDialogOpen(false);
      if (statusChanged) {
        setLead((currentLead) => currentLead ? { ...currentLead, status: "INCOMING", statusLabel: "Incoming" } : currentLead);
      }
      await fetchLead();
      notifyLeadListUpdated();
      setStickyNotesRefresh((current) => current + 1);
      toast(statusChanged
        ? { title: "Call logged. Lead status updated to Incoming." }
        : { title: "Call logged", description: "Call details saved to Notes and Activity." });
      setActiveTab("call-details");
    } catch (error: any) {
      toast({
        title: "Unable to log call",
        description: error?.response?.data?.error || error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCallSaving(false);
    }
  };

  const openEnquiryEditor = React.useCallback(async (enquiry: LeadEnquiry) => {
    setEnquiryEditError(null);
    setEditingEnquiry(enquiry);
    setEnquiryEditDraft({
      leadType: enquiry.leadType === "ADDITIONAL" ? "ORIGINAL" : enquiry.leadType || "ORIGINAL",
      source: enquiry.source || "",
      subSource: enquiry.subSource || "",
      campaign: enquiry.campaign || "",
      campaignId: enquiry.campaignId || "",
      subCampaign: enquiry.subCampaign || "",
      subCampaignId: enquiry.subCampaignId || "",
      projectId: enquiry.project?.id || "",
      countryCode: enquiry.countryCode || "",
      phone: enquiry.phone || "",
      secondaryCountryCode: enquiry.secondaryCountryCode || "",
      secondaryPhone: enquiry.secondaryPhone || "",
      tertiaryCountryCode: enquiry.tertiaryCountryCode || "",
      tertiaryPhone: enquiry.tertiaryPhone || "",
      email: enquiry.email || "",
      secondaryEmail: enquiry.secondaryEmail || "",
      tertiaryEmail: enquiry.tertiaryEmail || "",
      medium: enquiry.medium || "",
      channelPartner: enquiry.channelPartner || "",
      description: enquiry.description || "",
      budgetRange: String(enquiry.attributes?.Budget_Range__c || ""),
      centRange: String(enquiry.attributes?.Cent_Range__c || ""),
      allocatedProject: String(enquiry.attributes?.Allocated_Project__c || ""),
      purposeOfPurchase: String(enquiry.attributes?.Purpose_of_Purchase__c || ""),
      referralBy: String(enquiry.attributes?.Referral_By__c || ""),
      enquiryStatus: String(enquiry.attributes?.Status__c || ""),
      typeOfLead: String(enquiry.attributes?.type_of_lead__c || ""),
      voiceOfCustomer: String(enquiry.attributes?.Voice_of_customer__c || ""),
      genuinelyInterested: String(enquiry.attributes?.genuinely_interested_in_buying_a_plot__c || ""),
      pleaseConfirm: String(enquiry.attributes?.Please_confirm__c || ""),
      primary: enquiry.attributes?.Primary__c === true,
      enquiryDate: enquiry.enquiryDate
        ? new Date(new Date(enquiry.enquiryDate).getTime() - new Date(enquiry.enquiryDate).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
        : "",
    });
    setEnquiryEditProjectsLoading(true);
    try {
      const projectList = await projectApi.listAll({ isActive: true });
      setEnquiryEditProjects(projectList);
    } catch (error: any) {
      setEnquiryEditError(error?.response?.data?.error || "Unable to load projects.");
    } finally {
      setEnquiryEditProjectsLoading(false);
    }
  }, []);

  const updateEnquiryDraft = <K extends keyof EnquiryEditDraft>(field: K, value: EnquiryEditDraft[K]) => {
    setEnquiryEditDraft((current) => current ? { ...current, [field]: value } : current);
    setEnquiryEditError(null);
  };

  const saveEnquiryEdits = async () => {
    if (!editingEnquiry || !enquiryEditDraft) return;
    setEnquirySaveLoading(true);
    setEnquiryEditError(null);
    try {
      const {
        budgetRange,
        centRange,
        allocatedProject,
        purposeOfPurchase,
        referralBy,
        enquiryStatus,
        typeOfLead,
        voiceOfCustomer,
        genuinelyInterested,
        pleaseConfirm,
        primary,
        ...enquiryFields
      } = enquiryEditDraft;
      const response = await enquiryApi.update(editingEnquiry.id, {
        ...enquiryFields,
        campaignId: enquiryEditDraft.campaignId || null,
        campaign: enquiryEditDraft.campaign.trim() || null,
        subSource: enquiryEditDraft.subSource.trim() || null,
        subCampaignId: enquiryEditDraft.subCampaignId || null,
        subCampaign: enquiryEditDraft.subCampaign.trim() || null,
        projectId: enquiryEditDraft.projectId || null,
        countryCode: enquiryEditDraft.countryCode.trim() || null,
        phone: enquiryEditDraft.phone.trim() || null,
        secondaryCountryCode: enquiryEditDraft.secondaryCountryCode.trim() || null,
        secondaryPhone: enquiryEditDraft.secondaryPhone.trim() || null,
        tertiaryCountryCode: enquiryEditDraft.tertiaryCountryCode.trim() || null,
        tertiaryPhone: enquiryEditDraft.tertiaryPhone.trim() || null,
        email: enquiryEditDraft.email.trim() || null,
        secondaryEmail: enquiryEditDraft.secondaryEmail.trim() || null,
        tertiaryEmail: enquiryEditDraft.tertiaryEmail.trim() || null,
        medium: enquiryEditDraft.medium.trim() || null,
        channelPartner: enquiryEditDraft.channelPartner.trim() || null,
        description: enquiryEditDraft.description.trim() || null,
        attributes: {
          Budget_Range__c: budgetRange,
          Cent_Range__c: centRange,
          Allocated_Project__c: allocatedProject,
          Purpose_of_Purchase__c: purposeOfPurchase,
          Referral_By__c: referralBy,
          Status__c: enquiryStatus,
          type_of_lead__c: typeOfLead,
          Voice_of_customer__c: voiceOfCustomer,
          genuinely_interested_in_buying_a_plot__c: genuinelyInterested,
          Please_confirm__c: pleaseConfirm,
          Primary__c: primary,
        },
        enquiryDate: enquiryEditDraft.enquiryDate ? new Date(enquiryEditDraft.enquiryDate).toISOString() : undefined,
      });
      if (!response.data.success) throw new Error(response.data.error || "Failed to update enquiry.");
      const updatedEnquiry = response.data.data as LeadEnquiry;
      setEnquiries((current) => current.map((item) => item.id === updatedEnquiry.id ? updatedEnquiry : item));
      setEditingEnquiry(null);
      setEnquiryEditDraft(null);
      toast({ title: "Saved", description: "Related source updated successfully." });
    } catch (error: any) {
      const message = error?.response?.data?.error || error?.message || "Failed to update related source.";
      setEnquiryEditError(message);
      toast({ title: "Error", description: message, variant: "destructive" as any });
    } finally {
      setEnquirySaveLoading(false);
    }
  };

  const deleteEnquiry = async () => {
    if (!enquiryDeleteTarget) return;
    setEnquiryDeleteLoading(true);
    try {
      const response = await enquiryApi.delete(enquiryDeleteTarget.id);
      if (!response.data.success) throw new Error(response.data.error || "Failed to delete enquiry.");
      setEnquiries((current) => current.filter((item) => item.id !== enquiryDeleteTarget.id));
      toast({ title: "Deleted", description: `${enquiryDeleteTarget.enquiryNumber} was deleted.` });
      setEnquiryDeleteTarget(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.response?.data?.error || error?.message || "Failed to delete related source.",
        variant: "destructive" as any,
      });
    } finally {
      setEnquiryDeleteLoading(false);
    }
  };

  const loadProjects = React.useCallback((force = false) => {
    if (!force && projectsLoaded.current) return Promise.resolve();
    if (projectsRequest.current) return projectsRequest.current;

    setProjectsLoading(true);
    setProjectsError(null);
    const request = projectApi.listAll({ isActive: true })
      .then((projectList) => {
        const seenProjectIds = new globalThis.Set<string>();
        const uniqueProjects = projectList.filter((project: { id: string }) => {
          if (seenProjectIds.has(project.id)) return false;
          seenProjectIds.add(project.id);
          return true;
        });
        setProjects(uniqueProjects);
        projectsLoaded.current = true;
      })
      .catch((error: any) => {
        console.error("Failed to load projects for Lead workflow:", error);
        setProjectsError(
          error?.response?.data?.error || error?.message || "Failed to load projects. Please try again.",
        );
      })
      .finally(() => {
        projectsRequest.current = null;
        setProjectsLoading(false);
      });
    projectsRequest.current = request;
    return request;
  }, []);

  React.useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  React.useEffect(() => {
    if (activeTab === "audit-history" && auditLogs.length === 0 && !auditLoading) {
      fetchAuditHistory(1);
    }
  }, [activeTab, auditLogs.length, auditLoading, fetchAuditHistory]);

  React.useEffect(() => {
    if (activeTab === "enquiries") {
      void fetchEnquiries();
    }
  }, [activeTab, fetchEnquiries]);

  React.useEffect(() => {
    if (activeTab === "call-details") {
      void fetchCallDetails();
    }
  }, [activeTab, fetchCallDetails]);

  React.useEffect(() => {
    if (siteVisitDialogOpen || revisitDialogOpen) {
      void loadProjects();
    }
  }, [siteVisitDialogOpen, revisitDialogOpen, loadProjects]);

  const isLeadCustomField = (fieldName: string) => {
    const field = fields.find((item) => item.name === fieldName);
    return Boolean(
      field &&
      field.editable &&
      !field.isStandardField &&
      !field.isSystemField
    );
  };
  const openOwnerDialog = async () => {
    if (!lead) return;
    setIsActionLoading(true);
    try {
      const response = await leadApi.ownerCandidates(lead.id);
      setOwnerCandidates(response.data.data || []);
      setNewOwnerId("");
      setOwnerDialogOpen(true);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || "Failed to load eligible owners",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const changeOwner = async () => {
    if (!newOwnerId) {
      toast({ title: "Validation", description: "New owner is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await leadApi.changeOwner(leadId, newOwnerId);
      setOwnerDialogOpen(false);
      toast({ title: "Success", description: "Lead owner changed successfully" });
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") await fetchAuditHistory(1);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || "Failed to change lead owner",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const startEdit = (fieldName: string) => {
    if (!lead) return;
    const editableData: Record<string, any> = {};
    for (const field of LEAD_EDITABLE_FIELDS) {
      if (lead[field] !== undefined) editableData[field] = lead[field];
    }
    for (const field of fields) {
      if (isLeadCustomField(field.name) && lead.customFields?.[field.name] !== undefined) {
        editableData[field.name] = lead.customFields[field.name];
      }
    }
    editableData.projectId = lead.projectId ?? lead.project?.id ?? null;
    setEditData(editableData);
    setEditFieldErrors({});
    setEditingFieldName(fieldName);
    setActiveTab("overview");
    setIsEditing(true);
    if (fieldName === "projectId") void loadProjects();
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditingFieldName(null);
    setEditData({});
    setEditFieldErrors({});
  };

  const saveEdit = async () => {
    if (!lead || !editingFieldName) return;
    setEditFieldErrors({});
    const updatedValue = editData[editingFieldName];
    const resultingValue = updatedValue === undefined ? lead[editingFieldName as keyof LeadData] : updatedValue;
    const requiredFieldLabels: Record<string, string> = {
      lastName: "Last name",
      company: "Company",
      phone: "Phone number",
    };
    if (editingFieldName in requiredFieldLabels && !String(resultingValue ?? "").trim()) {
      const message = `${requiredFieldLabels[editingFieldName]} is required.`;
      setEditFieldErrors({ [editingFieldName]: message });
      toast({ title: "Validation", description: message, variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const payload: Record<string, any> = {};
      if (LEAD_EDITABLE_FIELDS.includes(editingFieldName as typeof LEAD_EDITABLE_FIELDS[number])) {
        payload[editingFieldName] = updatedValue === "" ? null : updatedValue;
      } else if (isLeadCustomField(editingFieldName)) {
        payload.customFields = { [editingFieldName]: updatedValue === "" ? null : updatedValue };
      } else {
        throw new Error("This Lead field cannot be edited.");
      }
      const response = await leadApi.update(leadId, payload);
      if (!response.data?.success) {
        throw new Error(response.data?.error || "Failed to update lead.");
      }
      toast({ title: "Success", description: "Lead updated successfully" });
      setIsEditing(false);
      setEditingFieldName(null);
      setEditData({});
      setEditFieldErrors({});
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to update lead";
      if (message === "Phone number already exists for another lead.") {
        setEditFieldErrors({ phone: message });
      }
      toast({ title: "Error", description: message, variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const openPushSvcDialog = () => {
    if (!lead) return;
    const customFields = lead.customFields || {};
    const stringValue = (key: string) => typeof customFields[key] === "string" ? customFields[key] as string : "";
    const stringArrayValue = (key: string) => Array.isArray(customFields[key])
      ? customFields[key].filter((value): value is string => typeof value === "string")
      : [];
    setPushSvcReason(stringValue("svc_call_summary_remarks"));
    setPushSvcProjectId(lead.projectId || lead.project?.id || "");
    setPushSvcMinimumBudget(stringValue("svc_minimum_budget"));
    setPushSvcMaximumBudget(stringValue("svc_maximum_budget"));
    setPushSvcBedroomPreference(stringArrayValue("svc_bedroom_preference"));
    setPushSvcPropertyType(stringArrayValue("svc_property_type"));
    setPushSvcPossession(stringValue("svc_possession"));
    setPushSvcReasonToBuy(stringValue("svc_reason_to_buy"));
    setPushSvcDialogOpen(true);
    void loadProjects();
  };

  const togglePushSvcSelection = (
    current: string[],
    setCurrent: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) => {
    setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const handlePushToSVC = async () => {
    if (!pushSvcProjectId) {
      toast({ title: "Validation", description: "Select a project of interest.", variant: "destructive" as any });
      return;
    }
    if (!pushSvcReason.trim()) {
      toast({ title: "Validation", description: "Call summary/remarks are required.", variant: "destructive" as any });
      return;
    }
    if (!pushSvcMinimumBudget || !pushSvcMaximumBudget) {
      toast({ title: "Validation", description: "Select both minimum and maximum budgets.", variant: "destructive" as any });
      return;
    }
    if (
      pushSvcMinimumBudget !== "Not Revealed" &&
      pushSvcMaximumBudget !== "Not Revealed" &&
      PROSPECT_BUDGET_OPTIONS.findIndex((option) => option === pushSvcMinimumBudget) >
        PROSPECT_BUDGET_OPTIONS.findIndex((option) => option === pushSvcMaximumBudget)
    ) {
      toast({ title: "Validation", description: "Maximum budget must be at least the minimum budget.", variant: "destructive" as any });
      return;
    }
    if (!pushSvcBedroomPreference.length || !pushSvcPropertyType.length) {
      toast({ title: "Validation", description: "Select at least one bedroom preference and property type.", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    let updatedLead: LeadData;
    try {
      const response = await leadApi.pushToSVC(leadId, {
        reason: pushSvcReason.trim(),
        projectId: pushSvcProjectId,
        prospectDetails: {
          callSummaryRemarks: pushSvcReason.trim(),
          minimumBudget: pushSvcMinimumBudget,
          maximumBudget: pushSvcMaximumBudget,
          bedroomPreference: pushSvcBedroomPreference,
          propertyType: pushSvcPropertyType,
          ...(pushSvcPossession ? { possession: pushSvcPossession } : {}),
          ...(pushSvcReasonToBuy ? { reasonToBuy: pushSvcReasonToBuy } : {}),
        },
      });
      if (!response.data?.success || !response.data.data) {
        throw new Error(response.data?.error || response.data?.message || "Push to SVC failed");
      }
      updatedLead = response.data.data;
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || err?.message || "Push to SVC failed",
        variant: "destructive" as any,
      });
      setIsActionLoading(false);
      return;
    }

    let metadataRefreshFailed = false;
    try {
      const [layoutResponse, layoutsResponse, fieldsResponse, assignedResponse] = await Promise.all([
        objectManagerApi.getDefaultLayout("Lead"),
        objectManagerApi.listLayouts("Lead"),
        objectManagerApi.listFields("Lead", { includeSystem: true }),
        objectManagerApi.resolveLayout("Lead").catch(() => null),
      ]);
      if (!layoutResponse.data?.data || !Array.isArray(layoutsResponse.data?.data) || !Array.isArray(fieldsResponse.data?.data)) {
        throw new Error("Lead fields were saved, but their display metadata could not be refreshed.");
      }
      setLayout(selectLeadPageLayout(
        layoutsResponse.data.data,
        layoutResponse.data.data,
        profile?.name,
        assignedResponse?.data?.data?.id,
      ));
      setFields(fieldsResponse.data.data);
    } catch (error) {
      console.error("Failed to refresh Lead prospect field metadata after SVC push:", error);
      metadataRefreshFailed = true;
    }

    setLead((currentLead) => currentLead ? { ...currentLead, ...updatedLead } : updatedLead);
    setStickyNotesRefresh((current) => current + 1);
    toast({
      title: "Success",
      description: metadataRefreshFailed
        ? "Lead pushed to SVC and prospect details saved. Refresh the page to see the new Lead fields."
        : "Lead pushed to SVC successfully.",
    });
    setPushSvcDialogOpen(false);
    setPushSvcReason("");
    if (activeTab === "audit-history") {
      fetchAuditHistory(1);
    }
    setIsActionLoading(false);
  };

  const beginPushSvcLeadEdit = () => {
    if (!lead || !canEditLead) return;
    setPushSvcLeadDraft({
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      phone: lead.phone || lead.mobile || "",
      company: lead.company || "",
      email: lead.email || "",
      projectId: lead.projectId || lead.project?.id || "",
    });
    setPushSvcLeadEditing(true);
    void loadProjects();
  };

  const savePushSvcLeadEdit = async () => {
    if (!lead || isActionLoading) return;
    if (!pushSvcLeadDraft.lastName.trim()) {
      toast({ title: "Validation", description: "Last name is required.", variant: "destructive" as any });
      return;
    }
    if (!pushSvcLeadDraft.company.trim()) {
      toast({ title: "Validation", description: "Company is required.", variant: "destructive" as any });
      return;
    }
    if (!pushSvcLeadDraft.phone.trim()) {
      toast({ title: "Validation", description: "Phone number is required.", variant: "destructive" as any });
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await leadApi.update(leadId, {
        firstName: pushSvcLeadDraft.firstName.trim(),
        lastName: pushSvcLeadDraft.lastName.trim(),
        phone: pushSvcLeadDraft.phone.trim(),
        company: pushSvcLeadDraft.company.trim(),
        email: pushSvcLeadDraft.email.trim(),
        projectId: pushSvcLeadDraft.projectId || null,
      });
      if (!response.data?.success || !response.data.data) {
        throw new Error(response.data?.error || response.data?.message || "Failed to update lead information.");
      }
      setLead((currentLead) => currentLead ? { ...currentLead, ...response.data.data } : response.data.data);
      setStickyNotesRefresh((current) => current + 1);
      setPushSvcProjectId(pushSvcLeadDraft.projectId);
      setPushSvcLeadEditing(false);
      toast({ title: "Success", description: "Lead information updated successfully." });
      if (activeTab === "audit-history") {
        void fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.response?.data?.error || err?.message || "Failed to update lead information.",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleMoveToRecovery = async () => {
    if (!recoveryReason) {
      toast({ title: "Validation", description: "Please select a reason", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await leadApi.moveToRecovery(leadId, { recoveryReason, note: recoveryNote || undefined });
      toast({ title: "Success", description: "Lead moved to recovery" });
      setRecoveryDialogOpen(false);
      setRecoveryReason("");
      setRecoveryNote("");
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to move to recovery", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleScheduleSiteVisit = async () => {
    if (!siteVisitForm.projectId.trim()) {
      toast({ title: "Validation", description: "A project is required", variant: "destructive" as any });
      return;
    }
    if (!siteVisitForm.visitType.trim()) {
      toast({ title: "Validation", description: "Site visit type is required", variant: "destructive" as any });
      return;
    }
    if (!siteVisitForm.date || !siteVisitForm.time || !siteVisitScheduleIsFuture(siteVisitForm)) {
      toast({ title: "Validation", description: SITE_VISIT_FUTURE_TIME_ERROR, variant: "destructive" as any });
      return;
    }
    if (!siteVisitForm.minimumBudget || !siteVisitForm.maximumBudget || !siteVisitForm.propertyType.length) {
      toast({ title: "Validation", description: "Minimum budget, maximum budget, and property type are required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const scheduledAt = crmLocalDateTimeToDate(siteVisitForm.date, siteVisitForm.time).toISOString();
      const response = await leadApi.scheduleSiteVisit(leadId, {
        scheduledAt,
        projectId: siteVisitForm.projectId,
        visitType: siteVisitForm.visitType.trim(),
        rating: siteVisitForm.rating || null,
        transport: siteVisitForm.transport || null,
        callSummaryRemarks: siteVisitForm.callSummaryRemarks.trim(),
        minimumBudget: siteVisitForm.minimumBudget,
        maximumBudget: siteVisitForm.maximumBudget,
        propertyType: siteVisitForm.propertyType,
        bedroomPreference: siteVisitForm.bedroomPreference,
      });
      const result = response.data?.data;
      if (!response.data?.success || !result?.lead || !result?.siteVisit) {
        throw new Error(response.data?.error || response.data?.message || "Failed to schedule site visit");
      }
      setLead((currentLead) => ({
        ...(currentLead || result.lead),
        ...result.lead,
        siteVisits: [
          result.siteVisit,
          ...(currentLead?.siteVisits || []).filter((siteVisit: any) => siteVisit.id !== result.siteVisit.id),
        ],
      }));
      setStickyNotesRefresh((current) => current + 1);
      toast({ title: "Success", description: "Site visit scheduled successfully." });
      setSiteVisitDialogOpen(false);
      setSiteVisitForm(emptySiteVisitScheduleFormValue());
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || err?.message || "Failed to schedule site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateFollowUp = async () => {
    if (!followUpNote.trim() || !followUpDate || !followUpTime) {
      toast({ title: "Validation", description: "Note, date, and time are all required", variant: "destructive" as any });
      return;
    }
    const due = new Date(`${followUpDate}T${followUpTime}`);
    if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) {
      toast({ title: "Validation", description: "Follow-up can only be scheduled for a future date and time.", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const dueDate = due.toISOString();
      await followUpApi.create({ title: followUpNote, description: followUpNote, dueDate, leadId });
      toast({ title: "Success", description: "Follow-up created" });
      setFollowUpDialogOpen(false);
      setFollowUpNote("");
      setFollowUpDate("");
      setFollowUpTime("");
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create follow-up", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleFollowUpStatus = async (followUp: any) => {
    setIsActionLoading(true);
    try {
      const response = followUp.isCompleted
        ? await followUpApi.reopen(followUp.id)
        : await followUpApi.complete(followUp.id);
      if (!response.data?.success) {
        throw new Error(response.data?.error || "Failed to update follow-up");
      }
      toast({
        title: followUp.isCompleted ? "Follow-up reopened" : "Follow-up completed",
        description: followUp.title || followUp.description,
      });
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
    } catch (error: any) {
      toast({
        title: "Unable to update follow-up",
        description: error?.response?.data?.error || error?.message || "Please try again.",
        variant: "destructive" as any,
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateTask = async () => {
    if (!taskNote.trim() || !taskDueDate || !taskTime) {
      toast({ title: "Validation", description: "Description, due date, and time are all required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const dueDate = new Date(`${taskDueDate}T${taskTime}`).toISOString();
      await followUpApi.create({ title: taskNote, description: taskNote, dueDate, leadId });
      toast({ title: "Success", description: "Follow-up created" });
      setTaskDialogOpen(false);
      setTaskNote("");
      setTaskDueDate("");
      setTaskTime("");
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create follow-up", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!noteContent.trim()) {
      toast({ title: "Validation", description: "Note content is required", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await activityApi.create({ type: "NOTE", subject: noteSubject || "Note", description: noteContent, leadId });
      toast({ title: "Success", description: "Note added" });
      setNoteDialogOpen(false);
      setNoteContent("");
      setNoteSubject("");
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to add note", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const getActiveSiteVisit = () => {
    const visits = lead?.siteVisits || [];
    return (
      visits.find((sv: any) => ["SCHEDULED", "RESCHEDULED"].includes(String(sv.status).toUpperCase())) ||
      visits[0] ||
      null
    );
  };

  const openRescheduleDialog = (siteVisit: any) => {
    const scheduledVisit = ["SCHEDULED", "RESCHEDULED"].includes(String(siteVisit?.status || "").toUpperCase());
    setRescheduleSiteVisitId(scheduledVisit ? siteVisit.id : null);
    setRevisitSourceSiteVisitId(siteVisit?.id || null);
    setRevisitForm({
      ...emptySiteVisitScheduleFormValue(),
      projectId: siteVisit?.projectId || siteVisit?.project?.id || "",
      visitType: scheduledVisit && (SITE_VISIT_TYPE_OPTIONS as readonly string[]).includes(siteVisit.visitType) ? siteVisit.visitType : "",
      rating: scheduledVisit ? siteVisit.customFields?.schedule_rating || "" : "",
      transport: scheduledVisit ? siteVisit.customFields?.schedule_transport || "" : "",
      callSummaryRemarks: scheduledVisit ? siteVisit.customFields?.schedule_call_summary_remarks || "" : "",
      minimumBudget: scheduledVisit ? siteVisit.customFields?.schedule_minimum_budget || "" : "",
      maximumBudget: scheduledVisit ? siteVisit.customFields?.schedule_maximum_budget || "" : "",
      propertyType: scheduledVisit && Array.isArray(siteVisit.customFields?.schedule_property_type)
        ? siteVisit.customFields.schedule_property_type
        : [],
      bedroomPreference: scheduledVisit && Array.isArray(siteVisit.customFields?.schedule_bedroom_preference)
        ? siteVisit.customFields.schedule_bedroom_preference
        : [],
    });
    setRevisitDialogOpen(true);
  };

  const handleRevisit = async () => {
    const activeSv = lead?.siteVisits?.find((visit: any) => visit.id === revisitSourceSiteVisitId) || null;
    if (!revisitForm.projectId || !revisitForm.date || !revisitForm.time || !siteVisitScheduleIsFuture(revisitForm) || !revisitForm.visitType.trim() ||
      !revisitForm.minimumBudget || !revisitForm.maximumBudget || !revisitForm.propertyType.length) {
      toast({ title: "Validation", description: !siteVisitScheduleIsFuture(revisitForm) && revisitForm.date && revisitForm.time ? SITE_VISIT_FUTURE_TIME_ERROR : "Complete all required site visit fields", variant: "destructive" as any });
      return;
    }
    if (!activeSv) {
      toast({ title: "Error", description: "No site visit found to revisit", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      const scheduledAt = crmLocalDateTimeToDate(revisitForm.date, revisitForm.time).toISOString();
      const updateCustomFields = {
        schedule_call_summary_remarks: revisitForm.callSummaryRemarks.trim() || null,
        schedule_minimum_budget: revisitForm.minimumBudget,
        schedule_maximum_budget: revisitForm.maximumBudget,
        schedule_property_type: revisitForm.propertyType,
        schedule_bedroom_preference: revisitForm.bedroomPreference,
        schedule_rating: revisitForm.rating || null,
        schedule_transport: revisitForm.transport || null,
      };
      if (rescheduleSiteVisitId) {
        await siteVisitApi.update(rescheduleSiteVisitId, {
          scheduledAt,
          projectId: revisitForm.projectId,
          visitType: revisitForm.visitType.trim(),
          customFields: updateCustomFields,
        });
      } else {
        await siteVisitApi.revisit(activeSv.id, {
          reason: revisitForm.callSummaryRemarks.trim() || "Revisit scheduled",
          scheduledAt,
          projectId: revisitForm.projectId,
          notes: revisitForm.callSummaryRemarks.trim() || undefined,
          visitType: revisitForm.visitType.trim(),
          rating: revisitForm.rating || null,
          transport: revisitForm.transport || null,
          callSummaryRemarks: revisitForm.callSummaryRemarks.trim(),
          minimumBudget: revisitForm.minimumBudget,
          maximumBudget: revisitForm.maximumBudget,
          propertyType: revisitForm.propertyType,
          bedroomPreference: revisitForm.bedroomPreference,
        });
      }
      toast({
        title: "Success",
        description: rescheduleSiteVisitId ? "Site visit rescheduled" : "Revisit site visit created",
      });
      setRevisitDialogOpen(false);
      setRescheduleSiteVisitId(null);
      setRevisitSourceSiteVisitId(null);
      setRevisitForm(emptySiteVisitScheduleFormValue());
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to create revisit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelSiteVisit = async () => {
    const activeSv = getActiveSiteVisit();
    if (!cancelSvReason.trim()) {
      toast({ title: "Validation", description: "A reason is required to cancel", variant: "destructive" as any });
      return;
    }
    if (!activeSv) {
      toast({ title: "Error", description: "No scheduled site visit found", variant: "destructive" as any });
      return;
    }
    setIsActionLoading(true);
    try {
      await siteVisitApi.cancel(activeSv.id, cancelSvReason.trim());
      toast({ title: "Success", description: "Site visit cancelled" });
      setCancelSvDialogOpen(false);
      setCancelSvReason("");
      await fetchLead();
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") {
        fetchAuditHistory(1);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || "Failed to cancel site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCompleteSiteVisit = async () => {
    const activeSv = getActiveSiteVisit();
    if (!activeSv) {
      toast({ title: "Error", description: "No scheduled site visit found", variant: "destructive" as any });
      return;
    }
    if (!completeSvTime || !completeSvFeedback.trim() || !completeSvNotes.trim()) {
      toast({ title: "Validation", description: "Completion time, customer feedback, and notes are required", variant: "destructive" as any });
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await siteVisitApi.complete(activeSv.id, {
        completedAt: crmLocalDateTimeToDate(completeSvTime.split("T")[0], completeSvTime.split("T")[1]).toISOString(),
        customerFeedback: completeSvFeedback.trim(),
        completionNotes: completeSvNotes.trim(),
      });
      const result = response.data.data;
      setLead((current) => current ? {
        ...current,
        ...(result.lead || {}),
        status: result.leadStatus || current.status,
        siteVisits: current.siteVisits?.map((visit: any) =>
          visit.id === activeSv.id ? { ...visit, ...result.siteVisit } : visit,
        ),
      } : current);
      toast(result.salesHandoff?.pendingReason
       ? { title: "Site visit completed; Sales assignment pending", description: result.salesHandoff.pendingReason, variant: "destructive" as any }
       : { title: "Success", description: "Site visit marked as happened" });
      setCompleteSvDialogOpen(false);
      setCompleteSvFeedback("");
      setCompleteSvNotes("");
      setCompleteSvTime("");
      setCompleteSvRating("");
      setStickyNotesRefresh((current) => current + 1);
      if (activeTab === "audit-history") fetchAuditHistory(1);
    } catch (err: any) {
      toast({ title: "Error", description: err?.response?.data?.error || err?.message || "Failed to complete site visit", variant: "destructive" as any });
    } finally {
      setIsActionLoading(false);
    }
  };

  const leadProfileName = profile?.name || "";
  const isPresalesProfile = leadProfileName.trim().toLowerCase().replace(/[\s_-]+/g, "") === "presales";
  const canManageSiteVisits = (leadProfileName === "SVC" || isPresalesProfile) && (
    hasEffectivePermission("SITE_VISIT_CREATE") || hasEffectivePermission("SITE_VISIT_UPDATE")
  );
  const canCreateSiteVisit = canEditLead || canManageSiteVisits;

  const getWorkflowActions = (): { label: string; onClick: () => void; variant?: "default" | "outline" | "destructive" | "secondary" }[] => {
    const actions: { label: string; onClick: () => void; variant?: "default" | "outline" | "destructive" | "secondary" }[] = [];

    const prof = profile?.name || "";
    if (!canEditLead && !canManageSiteVisits) return actions;

    const visits = lead?.siteVisits || [];
    const activeSiteVisit =
      visits.find((sv: any) => ["SCHEDULED", "RESCHEDULED"].includes(String(sv.status).toUpperCase())) || null;
    const latestSiteVisit = activeSiteVisit || visits[0] || null;

    const adminLike = isAdmin || isSuperAdmin || prof === "CRM Admin" || prof === "Manager";

    if (status === "INCOMING" && (prof === "Presales" || prof === "Sales Executive" || adminLike)) {
      actions.push({ label: "Push to SVC", onClick: openPushSvcDialog, variant: "default" });
    }

    if (status !== "LOST" && (canEditLead || canManageSiteVisits)) {
      actions.push({ label: "Move to Recovery", onClick: () => setRecoveryDialogOpen(true), variant: "destructive" });
    }

    const leadStatus = String(status).trim().toUpperCase();
    const presalesCanCreateVisit = isPresalesProfile && (leadStatus === "NEW" || leadStatus === "INCOMING" || leadStatus === "PROSPECT");
    if (presalesCanCreateVisit || (leadStatus === "PROSPECT" && (prof === "SVC" || prof === "Sales Executive" || adminLike))) {
      actions.push({ label: "Schedule Site Visit", onClick: () => setSiteVisitDialogOpen(true), variant: "default" });
    }

    if (status === "SITE_VISIT_SCHEDULED" && activeSiteVisit && (prof === "SVC" || prof === "Sales" || prof === "Sales Executive" || adminLike)) {
      actions.push({ label: "Edit Site Visit", onClick: () => router.push(`/site-visits/${activeSiteVisit.id}`), variant: "outline" });
      actions.push({ label: "Reschedule", onClick: () => openRescheduleDialog(activeSiteVisit), variant: "outline" });
      actions.push({ label: "Cancel Site Visit", onClick: () => setCancelSvDialogOpen(true), variant: "destructive" });
      actions.push({ label: "Complete Site Visit", onClick: () => setCompleteSvDialogOpen(true), variant: "default" });
    }

    if (status === "SITE_VISIT_HAPPENED") {
      if (latestSiteVisit) {
        actions.push({ label: "Reschedule", onClick: () => openRescheduleDialog(latestSiteVisit), variant: "outline" });
      }
    }

    return actions;
  };

  const workflowActions = getWorkflowActions();
  const scheduleSiteVisitAction = workflowActions.find((action) => action.label === "Schedule Site Visit");

  const leadRecordName = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || lead?.leadNumber || "";
  useBreadcrumbLabel(typeof params.id === "string" ? params.id : undefined, leadRecordName || undefined);

  const recordNames = React.useMemo(() => {
    const names = new globalThis.Map<string, string>();
    const add = (id?: string | null, label?: string | null) => {
      if (id && label?.trim()) names.set(id, label.trim());
    };
    add(lead?.id, lead?.leadNumber || leadRecordName);
    add(lead?.project?.id, lead?.project?.name);
    add(lead?.owner?.id, [lead?.owner?.firstName, lead?.owner?.lastName].filter(Boolean).join(" "));
    add(lead?.creator?.id, [lead?.creator?.firstName, lead?.creator?.lastName].filter(Boolean).join(" "));
    add(lead?.rrQueue?.id, lead?.rrQueue?.name);
    for (const visit of lead?.siteVisits || []) add(visit.id, visit.siteVisitNumber);
    for (const followUp of lead?.followUps || []) add(followUp.id, followUp.followUpNumber);
    return names;
  }, [lead, leadRecordName]);

  const formatAuditValue = (value: any): string | null => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "string") {
      const named = recordNames.get(value);
      if (named) return named;
      if (/^c[a-z0-9]{20,}$/i.test(value)) return null;
      return value;
    }
    if (value instanceof Date) return formatDateTime(value);
    if (typeof value === "object") {
      const person = [value.firstName, value.lastName].filter(Boolean).join(" ").trim();
      if (person || value.name || value.label) return person || value.name || value.label;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const AUDIT_FIELD_LABELS: Record<string, string> = {
    ownerName: "Owner",
    previousOwnerName: "Previous Owner",
    newOwnerName: "New Owner",
    changedByName: "Changed By",
    roundRobinName: "Round Robin",
    assignmentSource: "Assignment Source",
    assignedTo: "Assigned To",
    cancellationReason: "Cancellation Reason",
    completedById: "Completed By",
    completedByName: "Completed By",
    cancelledById: "Cancelled By",
    changedById: "Changed By",
    createdBy: "Created By",
    updatedBy: "Updated By",
    assignedById: "Assigned By",
    performedById: "Performed By",
  };

  const auditFieldLabel = (field: string): string => {
    if (AUDIT_FIELD_LABELS[field]) return AUDIT_FIELD_LABELS[field];
    return field
      .replace(/Id$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  };

  const getAuditChanges = (entry: any): { field: string; oldValue: any; newValue: any }[] => {
    const oldVals = entry.oldValues || {};
    const newVals = entry.newValues || {};
    // Never render a raw user id when its display-name sibling exists —
    // the name row is shown instead (spec: audit shows names, never raw IDs).
    const hasNameSibling = (field: string): boolean =>
      field.endsWith("Id") &&
      (`${field.slice(0, -2)}Name` in oldVals || `${field.slice(0, -2)}Name` in newVals);
    const fields = new Set([...Object.keys(oldVals), ...Object.keys(newVals)]);
    const changes: { field: string; oldValue: any; newValue: any }[] = [];

    if (entry.action === "CREATE" || entry.action === "FOLLOW_UP_CREATED" || entry.action === "TASK_CREATED" || entry.action === "NOTE_CREATED") {
      for (const field of Object.keys(newVals)) {
        if (field === "reason" || field === "note") continue;
        if (hasNameSibling(field)) continue;
        if (formatAuditValue(newVals[field]) === null) continue;
        changes.push({ field, oldValue: null, newValue: newVals[field] });
      }
      return changes;
    }

    for (const field of fields) {
      if (field === "reason" || field === "note") continue;
      if (hasNameSibling(field)) continue;
      const oldV = oldVals[field];
      const newV = newVals[field];
      if (formatAuditValue(oldV) === null && formatAuditValue(newV) === null) continue;
      if (JSON.stringify(oldV ?? null) !== JSON.stringify(newV ?? null)) {
        changes.push({ field, oldValue: field in oldVals ? oldV : undefined, newValue: newV });
      }
    }
    return changes;
  };

  const getAuditReason = (entry: any): string | null => {
    const newVals = entry.newValues || {};
    return newVals.reason || newVals.note || newVals.recoveryReason || null;
  };

  const lastModifiedBy = lead?.lastModified?.by;
  const lastModifiedAt = lead?.lastModified?.at || lead?.updatedAt;
  const ownerDisplayName = lead?.owner
    ? `${lead.owner.firstName || ""} ${lead.owner.lastName || ""}`.trim()
    : "";
  const systemInformation = {
    record_number: lead?.leadNumber,
    owner: lead?.owner
      ? { id: lead.owner.id, name: ownerDisplayName }
      : null,
    ...(ownerDisplayName ? { ownerName: ownerDisplayName } : {}),
    ...(lead?.rrQueue?.name ? { rrQueueName: lead.rrQueue.name } : {}),
    created_by: lead?.creator
      ? { id: lead.creator.id, name: `${lead.creator.firstName} ${lead.creator.lastName}`.trim() }
      : null,
    created_at: lead?.createdAt,
    updated_at: lastModifiedAt,
  };

  if (isLoading || authLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-20 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{loadError || "Lead not found"}</p>
      </div>
    );
  }

  const leadDisplayName = `${lead.firstName ? lead.firstName + " " : ""}${lead.lastName}`;
  const canCall = hasEffectivePermission("TELEPHONY_CALL") && telephonyActive;
  const placeCall = async (phoneField: ClickToCallField) => {
    if (callingField) return;
    setCallingField(phoneField);
    const result = await requestLeadCall({
      leadId: lead.id,
      phoneField,
      leadName: leadDisplayName || lead.company || lead.leadNumber || "Lead",
    });
    const notice = clickToCallToast(result, Boolean(isAdmin || isSuperAdmin));
    toast({
      title: notice.title,
      description: notice.description,
      variant: notice.variant,
      action: notice.showSettingsLink ? (
        <ToastAction altText="Open telephony settings" onClick={() => router.push("/setup/integrations/telephony")}>
          Open telephony settings
        </ToastAction>
      ) : undefined,
    });
    const updatedLeadStatus = result.leadStatus;
    if (updatedLeadStatus) {
      setLead((current) => current ? {
        ...current,
        status: updatedLeadStatus as typeof current.status,
        statusLabel: result.statusChanged ? getLeadStatusLabel(updatedLeadStatus) : current.statusLabel,
      } : current);
    }
    if (result.callDetailId) void fetchCallDetails();
    if (result.statusChanged) notifyLeadListUpdated();
    setCallingField(null);
  };
  const leadProjectOptions = lead.project && !projects.some((project) => project.id === lead.project?.id)
    ? [...projects, { ...lead.project, isActive: false }]
    : projects;
  const renderProjectLoadState = () => {
    if (projectsLoading) {
      return <p role="status" className="text-sm text-muted-foreground">Loading projects...</p>;
    }
    if (projectsError) {
      return (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
          <span>{projectsError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadProjects(true)}>
            Retry
          </Button>
        </div>
      );
    }
    if (projectsLoaded.current && projects.length === 0) {
      return <p role="status" className="text-sm text-muted-foreground">No projects available for this company.</p>;
    }
    return null;
  };

  const isPresales = leadProfileName.trim().toLowerCase().replace(/[\s_-]+/g, "") === "presales";
  const isSvc = leadProfileName === "SVC";
  const isSales = leadProfileName === "Sales";
  const isCrm = leadProfileName === "CRM";
  const isAdminLike = isAdmin || isSuperAdmin || leadProfileName === "CRM Admin" || leadProfileName === "Manager";
  const showAuditHistory = isAdminLike;
  const showSiteVisits = isSvc || isSales || isCrm || isAdminLike || leadProfileName === "Sales Executive" || isPresales;
  const completedSiteVisits = (lead.siteVisits || []).filter((visit: any) => visit.status === "COMPLETED");
  const showQuotations = completedSiteVisits.length > 0;
  const sortedFollowUps = sortFollowUpsByStatus(lead.followUps || []);

  const openDetail = (kind: "task" | "followup" | "note" | "activity", data: any) => {
    setDetailItem({ kind, data });
    setDetailDialogOpen(true);
  };

  const openFollowUpDetail = (followUpId: string) => {
    router.push(`/follow-ups/${encodeURIComponent(followUpId)}?leadId=${encodeURIComponent(leadId)}`);
  };

  return (
    <div className="space-y-3 font-sans text-[12px]">
      <Card className="overflow-hidden rounded-md border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="grid gap-4 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Lead Record</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="text-[20px] font-semibold leading-6 tracking-tight text-slate-900">{leadDisplayName}</h1>
                <span className="font-mono text-[12px] text-slate-600">{lead.leadNumber}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-[10px] leading-4 text-slate-500">Phone</p>
                  {canCall && (lead.phone || lead.mobile) ? (
                    <button type="button" className="truncate text-left text-[12px] font-medium leading-4 text-[#1479a8] hover:underline disabled:opacity-60" disabled={Boolean(callingField)} onClick={() => void placeCall(lead.phone ? "phone" : "mobile")}>
                      {callingField === (lead.phone ? "phone" : "mobile") ? "Calling..." : maskTelephonyNumber(lead.phone || lead.mobile, lead.countryCode)}
                    </button>
                  ) : (
                    <p className="truncate text-[12px] font-medium leading-4 text-slate-800">{maskTelephonyNumber(lead.phone || lead.mobile, lead.countryCode) || "—"}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] leading-4 text-slate-500">Mobile</p>
                  {canCall && lead.mobile ? (
                    <button type="button" className="truncate text-left text-[12px] font-medium leading-4 text-[#1479a8] hover:underline disabled:opacity-60" disabled={Boolean(callingField)} onClick={() => void placeCall("mobile")}>
                      {callingField === "mobile" ? "Calling..." : maskTelephonyNumber(lead.mobile, lead.countryCode)}
                    </button>
                  ) : (
                    <p className="truncate text-[12px] font-medium leading-4 text-slate-800">{maskTelephonyNumber(lead.mobile, lead.countryCode) || "—"}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] leading-4 text-slate-500">Secondary Phone</p>
                  {canCall && lead.secondaryPhone ? (
                    <button type="button" className="truncate text-left text-[12px] font-medium leading-4 text-[#1479a8] hover:underline disabled:opacity-60" disabled={Boolean(callingField)} onClick={() => void placeCall("secondaryPhone")}>
                      {callingField === "secondaryPhone" ? "Calling..." : maskTelephonyNumber(lead.secondaryPhone, lead.secondaryCountryCode || lead.countryCode)}
                    </button>
                  ) : (
                    <p className="truncate text-[12px] font-medium leading-4 text-slate-800">{maskTelephonyNumber(lead.secondaryPhone, lead.secondaryCountryCode || lead.countryCode) || "—"}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] leading-4 text-slate-500">Owner</p>
                  <p className="truncate text-[12px] font-medium leading-4 text-slate-800">
                    {lead.status === "BOOKED" ? getLeadStatusLabel(lead.status) : lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] leading-4 text-slate-500">Project</p>
                  <p className="truncate text-[12px] font-medium leading-4 text-slate-800">{lead.project?.name || "—"}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-1.5 lg:justify-end">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    className="h-8 px-2.5 text-[10px]"
                    onClick={saveEdit}
                    disabled={isActionLoading}
                  >
                    {isActionLoading ? (
                      <><Clock className="mr-1 h-3.5 w-3.5 animate-spin" />Saving...</>
                    ) : (
                      <><Save className="mr-1 h-3.5 w-3.5" />Save</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-[#5b9fbe] px-2.5 text-[10px] text-[#397b9b] hover:bg-sky-50 hover:text-blue-800"
                    onClick={cancelEdit}
                    disabled={isActionLoading}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />Cancel
                  </Button>
                </>
              ) : (
                <>
                  {canCall && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 p-0 hover:bg-transparent"
                      onClick={() => void placeCall("phone")}
                      disabled={Boolean(callingField)}
                      aria-label="Call"
                      title={callingField ? "Calling..." : "Call"}
                    >
                      <img src="/phone-call.svg" alt="" className="h-8 w-8" />
                    </Button>
                  )}
                  {scheduleSiteVisitAction && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-[#5b9fbe] px-2.5 text-[10px] font-medium text-[#397b9b] hover:bg-sky-50 hover:text-blue-800"
                      onClick={scheduleSiteVisitAction.onClick}
                      disabled={isActionLoading}
                    >
                      <Map className="mr-1 h-3.5 w-3.5" />
                      Schedule Site Visit
                    </Button>
                  )}
                  {hasEffectivePermission("FOLLOW_UP_CREATE") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-[#5b9fbe] px-2.5 text-[10px] font-medium text-[#397b9b] hover:bg-sky-50 hover:text-blue-800"
                      onClick={() => setFollowUpDialogOpen(true)}
                    >
                      <Clock className="mr-1 h-3.5 w-3.5" />Follow-up
                    </Button>
                  )}
                  {workflowActions
                    .filter((action) => action.label === "Push to SVC" || action.label === "Move to Recovery")
                    .map((action) => (
                      <Button
                        key={action.label}
                        variant="outline"
                        size="sm"
                        className="h-8 border-[#5b9fbe] px-2.5 text-[10px] font-medium text-[#397b9b] hover:bg-sky-50 hover:text-blue-800"
                        onClick={action.onClick}
                        disabled={isActionLoading}
                      >
                        {action.label}
                      </Button>
                    ))}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-md border-slate-200 bg-white shadow-sm">
        <CardContent className="p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Lead Status</h2>
          <div className="overflow-x-auto">
            <LeadStatusPath status={lead.status} />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
        <TabsList className="flex h-9 w-full flex-nowrap justify-start gap-0.5 overflow-x-auto rounded-md border border-slate-100 bg-[#f0f3f8] p-1">
          <TabsTrigger value="overview" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <User className="h-4 w-4" />Details
          </TabsTrigger>
          <TabsTrigger value="enquiries" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <Inbox className="h-4 w-4" />Enquiry
          </TabsTrigger>
          <TabsTrigger value="followups" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <Clock className="h-4 w-4" />Follow Up
          </TabsTrigger>
          {showSiteVisits && (
            <TabsTrigger value="site-visits" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
              <Map className="h-4 w-4" />Site Visit
            </TabsTrigger>
          )}
          <TabsTrigger value="call-details" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <Phone className="h-4 w-4" />Call Details
          </TabsTrigger>
          {showQuotations && (
            <TabsTrigger value="quotations" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
              <FileText className="h-4 w-4" />Quotations
            </TabsTrigger>
          )}
          <TabsTrigger value="bookings" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <FileText className="h-4 w-4" />Booking
          </TabsTrigger>
          <TabsTrigger value="receipts" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <CreditCard className="h-4 w-4" />Payment
          </TabsTrigger>
          {(isCrm || isAdminLike) && (
            <TabsTrigger value="installments" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
              <CalendarClock className="h-4 w-4" />Installments
            </TabsTrigger>
          )}
          <TabsTrigger value="feedbacks" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <StickyNote className="h-4 w-4" />Feedbacks
          </TabsTrigger>
          <TabsTrigger value="owner-history" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
            <History className="h-4 w-4" />Owner History
          </TabsTrigger>
          {showAuditHistory && (
            <TabsTrigger value="audit-history" className="h-7 shrink-0 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
              <FileText className="h-4 w-4" />Audit History
            </TabsTrigger>
          )}
        </TabsList>

        {/* Enquiries Tab */}
        <TabsContent value="enquiries">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/40 px-4 py-3">
              <CardTitle className="flex items-center gap-3 text-base font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-500 text-white">
                  <Monitor className="h-5 w-5" aria-hidden="true" />
                </span>
                Enquiry Sources
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {enquiriesLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading enquiries...</p>
              ) : enquiriesError ? (
                <div role="alert" className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {enquiriesError}
                </div>
              ) : enquiries.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="min-w-48 font-semibold">Related Source</TableHead>
                          <TableHead className="min-w-36 font-semibold">Lead Type</TableHead>
                          <TableHead className="min-w-40 font-semibold">Source</TableHead>
                          <TableHead className="min-w-52 font-semibold">Created Date</TableHead>
                          <TableHead className="w-14" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showAllEnquiries ? enquiries : enquiries.slice(0, 1)).map((enquiry) => (
                          <TableRow key={enquiry.id}>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => router.push(`/enquiries/${enquiry.id}`)}
                                className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
                              >
                                {enquiry.enquiryNumber}
                              </button>
                            </TableCell>
                            <TableCell>
                              {formatLeadTypeLabel(enquiry.leadType)}
                            </TableCell>
                            <TableCell>{enquiry.source || "—"}</TableCell>
                            <TableCell>{formatDateTime(enquiry.createdAt)}</TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Actions for ${enquiry.enquiryNumber}`}
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => void openEnquiryEditor(enquiry)}>
                                    <Edit3 className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setEnquiryDeleteTarget(enquiry)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex justify-center border-t py-2">
                    <Button
                      type="button"
                      variant="link"
                      className="h-8 text-sm"
                      onClick={() => setShowAllEnquiries((current) => !current)}
                    >
                      {showAllEnquiries ? "Show Less" : "View All"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <Inbox className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>No enquiries recorded for this lead.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="min-w-0 space-y-6">
              {lead && layout && (
                <LayoutDrivenForm
                  objectName="Lead"
                  mode="detail"
                  editingFieldName={editingFieldName}
                  data={isEditing
                    ? { ...lead.customFields, ...lead, ...editData, ...systemInformation }
                    : { ...lead.customFields, ...lead, ...systemInformation }}
                  onChange={(field, value) => {
                    setEditData((prev) => ({ ...prev, [field]: value }));
                    setEditFieldErrors((prev) => {
                      if (!prev[field]) return prev;
                      const { [field]: _fieldError, ...rest } = prev;
                      return rest;
                    });
                  }}
                  layout={layout}
                  fields={fields}
                  projects={leadProjectOptions}
                  fieldErrors={editFieldErrors}
                  onBeginEdit={canEditLead ? startEdit : undefined}
                  onEditOwner={canChangeOwner ? openOwnerDialog : undefined}
                  canEditLayout={canEditLeadLayout}
                  onSaveLayout={saveLeadLayout}
                  onCallPhone={canCall ? (fieldName) => { void placeCall(fieldName); } : undefined}
                  callingPhoneField={callingField}
                />
              )}

              <Card className="rounded-md border-slate-200 shadow-sm">
                <CardHeader className="border-b border-sky-100 bg-[#f5faff]">
                  <CardTitle className="text-[12px] font-semibold text-slate-700">Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Created</p>
                      <p className="text-xs text-muted-foreground">{formatDate(lead!.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Last Updated</p>
                      <p className="text-xs text-muted-foreground">{formatDate(lead!.updatedAt)}</p>
                    </div>
                  </div>
                  {lead!.creator && (
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Created By</p>
                        <p className="text-xs text-muted-foreground">{lead!.creator.firstName} {lead!.creator.lastName}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Edit3 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Last Modified</p>
                      <p className="text-xs text-muted-foreground">{lastModifiedAt ? formatDateTime(lastModifiedAt) : "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        by{" "}
                        {lastModifiedBy
                          ? `${lastModifiedBy.firstName} ${lastModifiedBy.lastName}`
                          : "Unknown"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <aside className="min-w-0 space-y-4">
              <StickyNotesCard key={`${lead.id}-${stickyNotesRefresh}`} recordId={lead.id} canAdd={canEditLead} />
              <LeadActivityHistoryCard
                leadId={lead.id}
                refreshKey={`${lead.updatedAt}:${lead.activities?.length ?? 0}:${lead.tasks?.length ?? 0}:${lead.followUps?.length ?? 0}:${lead.siteVisits?.length ?? 0}:${stickyNotesRefresh}`}
                canViewAuditHistory={showAuditHistory}
              />
            </aside>
          </div>
        </TabsContent>

        {/* Owner History Tab */}
        <TabsContent value="owner-history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Owner History</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.ownerHistory && lead.ownerHistory.length > 0 ? (
                <div className="space-y-3">
                  {lead.ownerHistory.map((entry: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                      <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.previousOwner && (
                            <span className="text-sm font-medium">
                              {entry.previousOwner.firstName} {entry.previousOwner.lastName}
                            </span>
                          )}
                          {entry.previousOwner && entry.newOwner && (
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          {entry.newOwner && (
                            <span className="text-sm font-medium">
                              {entry.newOwner.firstName} {entry.newOwner.lastName}
                            </span>
                          )}
                          {!entry.previousOwner && entry.newOwner && (
                            <span className="text-sm text-muted-foreground">Initial Assignment</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {entry.previousProfile && <span>{entry.previousProfile}</span>}
                          {entry.previousProfile && entry.newProfile && <span>→</span>}
                          {entry.newProfile && <span>{entry.newProfile}</span>}
                        </div>
                        {entry.handoffReason && (
                          <p className="text-xs text-muted-foreground mt-1">{entry.handoffReason}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{formatDateTime(entry.startDate)}</span>
                          {entry.endDate && <span>→ {formatDateTime(entry.endDate)}</span>}
                          {!entry.endDate && <span>→ Current</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No owner history recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Follow-ups Tab */}
        <TabsContent value="followups">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center gap-4 border-b bg-muted/30 px-4 py-3">
              <CardTitle className="flex items-center gap-3 text-base font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500 text-white">
                  <CheckSquare className="h-5 w-5" aria-hidden="true" />
                </span>
                Follow-ups
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="min-w-48 font-semibold">Follow-up ID</TableHead>
                      <TableHead className="min-w-48 font-semibold">Subject</TableHead>
                      <TableHead className="min-w-32 font-semibold">Status</TableHead>
                      <TableHead className="min-w-48 font-semibold">Scheduled Date</TableHead>
                      <TableHead className="w-14" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedFollowUps.length > 0 ? (showAllFollowUps ? sortedFollowUps : sortedFollowUps.slice(0, 1)).map((fu: any) => (
                      <TableRow key={fu.id}>
                        <TableCell>
                          <button
                            type="button"
                            className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
                            onClick={() => openFollowUpDetail(fu.id)}
                          >
                            {fu.followUpNumber || "—"}
                          </button>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={fu.title || undefined}>
                            {fu.title || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            fu.isCompleted
                              ? "bg-green-100 text-green-800"
                              : fu.isMissed
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                          }>
                            {fu.isCompleted ? "Completed" : fu.isMissed ? "Missed" : "Scheduled"}
                          </Badge>
                        </TableCell>
                        <TableCell>{fu.dueDate ? formatDateTime(fu.dueDate) : "—"}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Follow-up actions" disabled={isActionLoading}>
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openFollowUpDetail(fu.id)}>
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void handleFollowUpStatus(fu)}>
                                {fu.isCompleted ? "Reopen" : "Mark Complete"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          No follow-ups scheduled.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {sortedFollowUps.length > 1 && (
                <div className="flex justify-center border-t py-2">
                  <Button
                    type="button"
                    variant="link"
                    className="h-8 text-sm"
                    onClick={() => setShowAllFollowUps((current) => !current)}
                  >
                    {showAllFollowUps ? "Show Less" : "View More"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Site Visits Tab */}
        {showSiteVisits && (
        <TabsContent value="site-visits">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/40 px-4 py-3">
              <CardTitle className="flex items-center justify-between gap-3 text-base font-semibold">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500 text-white">
                    <Map className="h-5 w-5" aria-hidden="true" />
                  </span>
                  Site Visit ({lead.siteVisits?.length || 0})
                </span>
                {canCreateSiteVisit && status !== "LOST" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-[#5b9fbe] px-2.5 text-[10px] font-medium text-[#397b9b] hover:bg-sky-50 hover:text-blue-800"
                    onClick={() => setSiteVisitDialogOpen(true)}
                    disabled={isActionLoading}
                  >
                    New Site Visit
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="min-w-40 font-semibold">Visit Number</TableHead>
                      <TableHead className="min-w-44 font-semibold">Scheduled Date</TableHead>
                      <TableHead className="min-w-32 font-semibold">Status</TableHead>
                      <TableHead className="min-w-40 font-semibold">Project</TableHead>
                      <TableHead className="w-14" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lead.siteVisits && lead.siteVisits.length > 0 ? (
                      (showAllSiteVisits ? lead.siteVisits : lead.siteVisits.slice(0, 1)).map((sv: any) => (
                        <TableRow key={sv.id}>
                          <TableCell>
                            <Link href={`/site-visits/${sv.id}`} className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                              {sv.siteVisitNumber || "—"}
                            </Link>
                          </TableCell>
                          <TableCell>{sv.scheduledAt ? formatDateTime(sv.scheduledAt) : sv.createdAt ? formatDateTime(sv.createdAt) : "—"}</TableCell>
                          <TableCell>
                            <Badge className={
                              String(sv.status || "").toUpperCase() === "COMPLETED"
                                ? "bg-green-100 text-green-800 hover:bg-green-100"
                                : String(sv.status || "").toUpperCase() === "MISSED"
                                  ? "bg-red-100 text-red-800 hover:bg-red-100"
                                  : String(sv.status || "").toUpperCase() === "CANCELLED"
                                    ? "bg-red-100 text-red-800 hover:bg-red-100"
                                    : String(sv.status || "").toUpperCase() === "RESCHEDULED"
                                      ? "bg-violet-100 text-violet-800 hover:bg-violet-100"
                                    : "bg-blue-100 text-blue-800 hover:bg-blue-100"
                            }>
                              {{
                                SCHEDULED: "Scheduled",
                                COMPLETED: "Completed",
                                CANCELLED: "Cancelled",
                                MISSED: "Missed",
                                RESCHEDULED: "Rescheduled",
                              }[String(sv.status || "SCHEDULED").toUpperCase()] || String(sv.status || "Scheduled").replaceAll("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>{sv.project?.name || "—"}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className="h-8 w-8" aria-label={`Actions for ${sv.siteVisitNumber || "site visit"}`}>
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/site-visits/${sv.id}`}>View Details</Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No site visits scheduled.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {(lead.siteVisits?.length || 0) > 1 && (
                <div className="border-t py-2 text-center">
                  <Button type="button" variant="link" className="h-8 text-sm" onClick={() => setShowAllSiteVisits((current) => !current)}>
                    {showAllSiteVisits ? "Show Less" : "View All"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {showQuotations && (
          <TabsContent value="quotations">
            <LeadQuotations
              lead={lead}
              completedVisits={completedSiteVisits}
              canCreate={canEditLead}
            />
          </TabsContent>
        )}

        <TabsContent value="bookings">
          <LeadBookings leadId={lead.id} />
        </TabsContent>

        <TabsContent value="receipts">
          <LeadReceipts leadId={lead.id} />
        </TabsContent>
        {(isCrm || isAdminLike) && (
          <TabsContent value="installments">
            <LeadInstallments leadId={lead.id} />
          </TabsContent>
        )}

        {/* Call Details Tab */}
        <TabsContent value="call-details">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/40 px-4 py-3">
              <CardTitle className="flex items-center gap-3 text-base font-semibold">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500 text-white">
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </span>
                Call Details ({callDetails.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {callDetailsLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading call details...</p>
              ) : callDetailsError ? (
                <div role="alert" className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{callDetailsError}</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="min-w-40 font-semibold">Call Details Name</TableHead>
                          <TableHead className="min-w-32 font-semibold">Call Type</TableHead>
                          <TableHead className="min-w-36 font-semibold">Call From</TableHead>
                          <TableHead className="min-w-36 font-semibold">Call To</TableHead>
                          <TableHead className="min-w-40 font-semibold">Start Time</TableHead>
                          <TableHead className="min-w-40 font-semibold">End Time</TableHead>
                          <TableHead className="min-w-28 font-semibold">Duration</TableHead>
                          <TableHead className="min-w-28 font-semibold">Status</TableHead>
                          <TableHead className="min-w-48 font-semibold">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {callDetails.length > 0 ? (
                          (showAllCallDetails ? callDetails : callDetails.slice(0, 1)).map((call: any) => (
                            <TableRow key={call.id}>
                              <TableCell className="font-medium">
                                {call.recordType === "CALL_DETAIL" ? (
                                  <Link href={`/call-details/${encodeURIComponent(call.id)}`} className="text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                                    {call.name || call.subject || "Call"}
                                  </Link>
                                ) : (
                                  <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => openDetail("activity", call)}>
                                    {call.name || call.subject || "Call"}
                                  </button>
                                )}
                              </TableCell>
                              <TableCell>{callAnswerLabel(call.status)}</TableCell>
                              <TableCell>{call.callFrom || "—"}</TableCell>
                              <TableCell>{call.callTo || "—"}</TableCell>
                              <TableCell>{call.startAt ? formatDateTime(call.startAt) : "—"}</TableCell>
                              <TableCell>{call.endAt ? formatDateTime(call.endAt) : "—"}</TableCell>
                              <TableCell>{typeof call.duration === "number" ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : "—"}</TableCell>
                              <TableCell><Badge variant="outline">{callStatusLabel(call.status)}</Badge></TableCell>
                              <TableCell className="max-w-72 truncate">{call.description || call.notes || "—"}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={9} className="h-20 text-center text-muted-foreground">No call details recorded.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {callDetails.length > 1 && (
                    <div className="border-t py-2 text-center">
                      <Button type="button" variant="link" className="h-8 text-sm" onClick={() => setShowAllCallDetails((current) => !current)}>
                        {showAllCallDetails ? "Show Less" : "View All"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Feedbacks Tab */}
        <TabsContent value="feedbacks">
          {(() => {
            const feedbacks = showSiteVisits
              ? (lead.siteVisits || []).filter((visit: any) => visit.customerFeedback || visit.feedback)
              : [];
            return (
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/40 px-4 py-3">
                  <CardTitle className="flex items-center gap-3 text-base font-semibold">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500 text-white">
                      <StickyNote className="h-5 w-5" aria-hidden="true" />
                    </span>
                    Feedbacks ({feedbacks.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="min-w-36 font-semibold">Visit Number</TableHead>
                          <TableHead className="min-w-56 font-semibold">Feedback</TableHead>
                          <TableHead className="min-w-24 font-semibold">Rating</TableHead>
                          <TableHead className="min-w-40 font-semibold">Visit Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {feedbacks.length > 0 ? (
                          (showAllFeedbacks ? feedbacks : feedbacks.slice(0, 1)).map((visit: any) => (
                            <TableRow key={visit.id}>
                              <TableCell>
                                <Link href={`/site-visits/${visit.id}`} className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                                  {visit.siteVisitNumber || "—"}
                                </Link>
                              </TableCell>
                              <TableCell className="max-w-96 whitespace-normal">{visit.customerFeedback || visit.feedback}</TableCell>
                              <TableCell>{visit.customFields?.schedule_rating || visit.rating || "—"}</TableCell>
                              <TableCell>{visit.completedAt || visit.scheduledAt ? formatDateTime(visit.completedAt || visit.scheduledAt) : "—"}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No feedback recorded.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {feedbacks.length > 1 && (
                    <div className="border-t py-2 text-center">
                      <Button type="button" variant="link" className="h-8 text-sm" onClick={() => setShowAllFeedbacks((current) => !current)}>
                        {showAllFeedbacks ? "Show Less" : "View All"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        {/* Audit History Tab */}
        {showAuditHistory && (
        <TabsContent value="audit-history">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Audit History</CardTitle>
              <p className="text-xs text-muted-foreground">
                {auditTotal} record{auditTotal === 1 ? "" : "s"} · newest first
              </p>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : auditLogs.length > 0 ? (
                <div className="space-y-3">
                  {auditLogs.map((entry: any) => {
                    const changes = getAuditChanges(entry);
                    const reason = getAuditReason(entry);
                    const baseName = entry.user
                      ? `${entry.user.firstName} ${entry.user.lastName}`
                      : "System";
                    const userName = entry.impersonatedByName
                      ? `${baseName} (via Superadmin: ${entry.impersonatedByName})`
                      : baseName;
                    return (
                      <div key={entry.id} className="p-3 rounded-md bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{entry.action}</Badge>
                            <span className="text-sm font-medium">{userName}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </div>
                        {changes.length > 0 && (
                          <div className="space-y-1">
                            {changes.map((change, idx) => (
                              <div key={idx} className="text-xs flex flex-wrap items-center gap-1">
                                <span className="font-medium">{auditFieldLabel(change.field)}:</span>
                                {change.oldValue !== undefined ? (
                                  <>
                                    <span className="text-muted-foreground">
                                      {formatAuditValue(change.oldValue) || "—"}
                                    </span>
                                    <span aria-hidden="true">→</span>
                                    <span>{formatAuditValue(change.newValue) || "—"}</span>
                                  </>
                                ) : (
                                  <span>{formatAuditValue(change.newValue) || "—"}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {reason && (
                          <p className="text-xs text-muted-foreground">
                            Reason: {reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {auditTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAuditHistory(Math.max(1, auditPage - 1))}
                        disabled={auditPage <= 1 || auditLoading}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {auditPage} of {auditTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchAuditHistory(Math.min(auditTotalPages, auditPage + 1))}
                        disabled={auditPage >= auditTotalPages || auditLoading}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No audit history recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}
      </Tabs>

      <Dialog open={ownerDialogOpen} onOpenChange={setOwnerDialogOpen}>
        <DialogContent className="overflow-x-visible overflow-y-visible">
          <DialogHeader>
            <DialogTitle>Change Lead Owner</DialogTitle>
            <DialogDescription>
              Assign this lead to an eligible active user in the current tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Current Owner: </span>
              <span className="font-medium">
                {lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}
              </span>
            </div>
            <div className="space-y-2">
              <Label>New Owner *</Label>
              <UserLookup
                id="lead-new-owner"
                ariaLabel="New Owner"
                users={ownerCandidates}
                value={newOwnerId}
                onChange={setNewOwnerId}
                placeholder="Search eligible users..."
                localSearch
              />
              {ownerCandidates.length === 0 && (
                <p className="text-sm text-muted-foreground">No eligible users are available.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOwnerDialogOpen(false)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button onClick={changeOwner} disabled={isActionLoading || ownerCandidates.length === 0}>
              {isActionLoading ? "Changing..." : "Change Owner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push to SVC Dialog */}
      <Dialog
        open={pushSvcDialogOpen}
        onOpenChange={(open) => {
          setPushSvcDialogOpen(open);
          if (!open) setPushSvcLeadEditing(false);
        }}
      >
        <DialogContent className="crm-sky flex max-h-[min(92vh,900px)] flex-col overflow-hidden border-sky-100 bg-white p-0 sm:max-w-4xl [&_button.border]:border-sky-200 [&_button.border]:text-[#075d91] [&_label]:font-semibold [&_label]:text-[#1479a8] [&_[role=combobox]]:border-sky-200 [&_textarea]:border-sky-200">
          <DialogHeader className="shrink-0 border-b border-sky-100 bg-gradient-to-r from-sky-50 to-white px-6 pb-4 pt-6">
            <DialogTitle className="text-lg font-bold text-[#075d91]">Prospect</DialogTitle>
            <DialogDescription className="text-[#1479a8]">
              Capture the prospect&apos;s requirements before assigning this lead to SVC.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-sky-100 bg-[#f5fbff] p-3 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-[#075d91]">Lead Information</p>
                {canEditLead && (
                  <div className="flex gap-2">
                    {pushSvcLeadEditing ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPushSvcLeadEditing(false)}
                          disabled={isActionLoading}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={savePushSvcLeadEdit}
                          disabled={isActionLoading}
                        >
                          {isActionLoading ? "Saving..." : "Save"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={beginPushSvcLeadEdit}
                        disabled={isActionLoading}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {pushSvcLeadEditing ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-first-name">First Name</Label>
                    <Input
                      id="push-svc-first-name"
                      value={pushSvcLeadDraft.firstName}
                      onChange={(event) => setPushSvcLeadDraft((draft) => ({ ...draft, firstName: event.target.value }))}
                      disabled={isActionLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-last-name">Last Name *</Label>
                    <Input
                      id="push-svc-last-name"
                      value={pushSvcLeadDraft.lastName}
                      onChange={(event) => setPushSvcLeadDraft((draft) => ({ ...draft, lastName: event.target.value }))}
                      disabled={isActionLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-phone">Phone *</Label>
                    <Input
                      id="push-svc-phone"
                      value={pushSvcLeadDraft.phone}
                      onChange={(event) => setPushSvcLeadDraft((draft) => ({ ...draft, phone: event.target.value }))}
                      disabled={isActionLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-company">Company *</Label>
                    <Input
                      id="push-svc-company"
                      value={pushSvcLeadDraft.company}
                      onChange={(event) => setPushSvcLeadDraft((draft) => ({ ...draft, company: event.target.value }))}
                      disabled={isActionLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-email">Email</Label>
                    <Input
                      id="push-svc-email"
                      type="email"
                      value={pushSvcLeadDraft.email}
                      onChange={(event) => setPushSvcLeadDraft((draft) => ({ ...draft, email: event.target.value }))}
                      disabled={isActionLoading}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="push-svc-project-edit">Project *</Label>
                    <Select
                      value={pushSvcLeadDraft.projectId}
                      onValueChange={(projectId) => setPushSvcLeadDraft((draft) => ({ ...draft, projectId }))}
                      disabled={projectsLoading || Boolean(projectsError) || isActionLoading}
                    >
                      <SelectTrigger id="push-svc-project-edit">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {lead.project?.id && !projects.some((project) => project.id === lead.project?.id) && (
                          <SelectItem value={lead.project.id}>{lead.project.name} (Current)</SelectItem>
                        )}
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {projectsError && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-destructive">{projectsError}</p>
                        <Button type="button" size="sm" variant="outline" onClick={() => void loadProjects(true)}>
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2 border-t pt-2 text-muted-foreground">
                    <p>Lead Number: <span className="font-medium text-foreground">{lead.leadNumber}</span></p>
                    <p>Current Owner: <span className="font-medium text-foreground">{lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}</span></p>
                    <p>Current Status: <span className="font-medium text-foreground">{getLeadStatusLabel(lead.status)}</span></p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                  <p>Lead Number: <span className="font-medium text-foreground">{lead.leadNumber}</span></p>
                  <p>Name: <span className="font-medium text-foreground">{`${lead.firstName || ""} ${lead.lastName || ""}`.trim()}</span></p>
                  <p>Phone: <span className="font-medium text-foreground">{maskTelephonyNumber(lead.phone || lead.mobile, lead.countryCode) || "—"}</span></p>
                  <p>Secondary Phone: <span className="font-medium text-foreground">{maskTelephonyNumber(lead.secondaryPhone || lead.mobile, lead.secondaryCountryCode || lead.countryCode) || "—"}</span></p>
                  <p>Tertiary Phone: <span className="font-medium text-foreground">{lead.tertiaryPhone || "—"}</span></p>
                  <p>Company: <span className="font-medium text-foreground">{lead.company || "—"}</span></p>
                  <p>Email: <span className="font-medium text-foreground">{lead.email || "—"}</span></p>
                  <p>Owner: <span className="font-medium text-foreground">{lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : "Unassigned"}</span></p>
                  <p>Project: <span className="font-medium text-foreground">{lead.project?.name || "—"}</span></p>
                  <p>Status: <span className="font-medium text-foreground">{getLeadStatusLabel(lead.status)}</span></p>
                </div>
              )}
            </div>
            <section className="space-y-4 rounded-xl border border-sky-100 bg-[#f5fbff] p-4">
              <div>
                <h3 className="text-sm font-semibold text-[#075d91]">Prospect requirements</h3>
                <p className="mt-1 text-xs text-[#1479a8]">Required information is saved to the Lead record when you continue.</p>
              </div>
              <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="push-svc-project">Project Interested <span className="text-destructive">*</span></Label>
                  <Select value={pushSvcProjectId} onValueChange={setPushSvcProjectId} disabled={projectsLoading || isActionLoading}>
                    <SelectTrigger id="push-svc-project"><SelectValue placeholder="Select a project" /></SelectTrigger>
                    <SelectContent>
                      {lead?.project?.id && !projects.some((project) => project.id === lead.project?.id) && (
                        <SelectItem value={lead.project.id}>{lead.project.name} (Current)</SelectItem>
                      )}
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {projectsError && (
                    <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
                      <span>{projectsError}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void loadProjects(true)}>Retry</Button>
                    </div>
                  )}
                  {!projectsLoading && !projectsError && projects.length === 0 && !lead?.project?.id && (
                    <p role="status" className="text-xs text-muted-foreground">No active projects are available.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-svc-summary">Call Summary/Remarks <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="push-svc-summary"
                    rows={3}
                    maxLength={2000}
                    required
                    placeholder="Summarize the customer conversation and requirements..."
                    value={pushSvcReason}
                    onChange={(event) => setPushSvcReason(event.target.value)}
                    disabled={isActionLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-svc-minimum-budget">Minimum Budget <span className="text-destructive">*</span></Label>
                  <Select value={pushSvcMinimumBudget} onValueChange={setPushSvcMinimumBudget} disabled={isActionLoading}>
                    <SelectTrigger id="push-svc-minimum-budget"><SelectValue placeholder="Select minimum budget" /></SelectTrigger>
                    <SelectContent>
                      {PROSPECT_BUDGET_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-svc-maximum-budget">Maximum Budget <span className="text-destructive">*</span></Label>
                  <Select value={pushSvcMaximumBudget} onValueChange={setPushSvcMaximumBudget} disabled={isActionLoading}>
                    <SelectTrigger id="push-svc-maximum-budget"><SelectValue placeholder="Select maximum budget" /></SelectTrigger>
                    <SelectContent>
                      {PROSPECT_BUDGET_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bedroom Preference <span className="text-destructive">*</span></Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Bedroom Preference">
                    {PROSPECT_BEDROOM_OPTIONS.map((option) => {
                      const selected = pushSvcBedroomPreference.includes(option);
                      return (
                        <Button
                          key={option}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          aria-pressed={selected}
                          onClick={() => togglePushSvcSelection(pushSvcBedroomPreference, setPushSvcBedroomPreference, option)}
                          disabled={isActionLoading}
                        >
                          {option}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Property Type <span className="text-destructive">*</span></Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Property Type">
                    {PROSPECT_PROPERTY_TYPE_OPTIONS.map((option) => {
                      const selected = pushSvcPropertyType.includes(option);
                      return (
                        <Button
                          key={option}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          aria-pressed={selected}
                          onClick={() => togglePushSvcSelection(pushSvcPropertyType, setPushSvcPropertyType, option)}
                          disabled={isActionLoading}
                        >
                          {option}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-svc-possession">Possession</Label>
                  <Select value={pushSvcPossession} onValueChange={setPushSvcPossession} disabled={isActionLoading}>
                    <SelectTrigger id="push-svc-possession"><SelectValue placeholder="Select possession timeline" /></SelectTrigger>
                    <SelectContent>
                      {PROSPECT_POSSESSION_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="push-svc-reason-to-buy">Reason to Buy</Label>
                  <Select value={pushSvcReasonToBuy} onValueChange={setPushSvcReasonToBuy} disabled={isActionLoading}>
                    <SelectTrigger id="push-svc-reason-to-buy"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                    <SelectContent>
                      {PROSPECT_REASON_TO_BUY_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-sky-100 bg-sky-50/60 px-6 py-4">
            <Button variant="outline" onClick={() => setPushSvcDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handlePushToSVC} disabled={isActionLoading || pushSvcLeadEditing || projectsLoading || !pushSvcReason.trim()}>
              {pushSvcLeadEditing ? "Save Lead Info first" : isActionLoading ? "Saving prospect..." : "Save & Push to SVC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recoveryDialogOpen} onOpenChange={setRecoveryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Lead to Recovery?</DialogTitle>
            <DialogDescription>This lead will be marked as Lost and moved to the Recovery workflow.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleMoveToRecovery(); }}>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="recovery-reason">Reason *</Label>
                <Select value={recoveryReason} onValueChange={setRecoveryReason}>
                  <SelectTrigger id="recovery-reason">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECOVERY_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery-note">Note (optional)</Label>
                <Textarea
                  id="recovery-note"
                  placeholder="Add any additional notes..."
                  value={recoveryNote}
                  onChange={(e) => setRecoveryNote(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecoveryDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
              <Button variant="destructive" type="submit" disabled={isActionLoading}>
                {isActionLoading ? "Moving..." : "Move to Recovery"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Schedule Site Visit Dialog */}
      <Dialog open={siteVisitDialogOpen} onOpenChange={setSiteVisitDialogOpen}>
        <DialogContent className="flex max-h-[min(90vh,900px)] flex-col gap-0 overflow-hidden rounded-xl border-sky-100 bg-[#f5fbff] p-0 shadow-sm sm:max-w-4xl [&_button.border]:border-sky-200 [&_button.border]:text-[#075d91] [&_input]:h-10 [&_input]:border-sky-200 [&_input]:bg-white [&_label]:font-semibold [&_label]:text-[#1479a8] [&_select]:border-sky-200 [&_select]:bg-white [&_textarea]:border-sky-200 [&_textarea]:bg-white [&_[role=combobox]]:h-10 [&_[role=combobox]]:border-sky-200 [&_[role=combobox]]:bg-white">
          <DialogHeader className="shrink-0 border-b border-sky-100 bg-gradient-to-br from-white to-sky-50 px-6 py-4 pr-10 text-left sm:text-left">
            <DialogTitle className="text-lg text-[#075d91]">Schedule Site Visit</DialogTitle>
            <DialogDescription className="text-[12px] text-[#1479a8]">Required information is marked with *.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <SiteVisitScheduleFields
              idPrefix="sv"
              value={siteVisitForm}
              onChange={setSiteVisitForm}
              projects={projects}
              projectsLoading={projectsLoading}
              projectsError={projectsError}
              onRetryProjects={() => void loadProjects(true)}
            />
          </div>
          <DialogFooter className="shrink-0 border-t border-sky-100 bg-sky-50/70 px-6 py-4">
            <Button variant="outline" className="border-sky-200 bg-white text-[#075d91] hover:bg-sky-50" onClick={() => setSiteVisitDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-200 hover:from-blue-700 hover:to-blue-600"
              onClick={handleScheduleSiteVisit}
              disabled={isActionLoading || projectsLoading || Boolean(projectsError) || !projects.length || !siteVisitForm.projectId || !siteVisitForm.visitType.trim() || !siteVisitScheduleIsFuture(siteVisitForm) || !siteVisitForm.minimumBudget || !siteVisitForm.maximumBudget || !siteVisitForm.propertyType.length}
            >
              {isActionLoading ? "Scheduling..." : "Schedule Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={callDialogOpen} onOpenChange={(open) => !callSaving && setCallDialogOpen(open)}>
        <DialogContent className="flex max-h-[min(90vh,800px)] flex-col gap-0 overflow-hidden rounded-xl border-sky-100 bg-[#f5fbff] p-0 shadow-sm sm:max-w-2xl [&_input]:h-10 [&_input]:border-sky-200 [&_input]:bg-white [&_textarea]:border-sky-200 [&_textarea]:bg-white">
          <DialogHeader className="shrink-0 border-b border-sky-100 bg-gradient-to-br from-white to-sky-50 px-6 py-4 pr-10 text-left sm:text-left">
            <DialogTitle className="text-lg text-[#075d91]">Log Call</DialogTitle>
            <DialogDescription className="text-[12px] text-[#1479a8]">Save a call record for this lead. Notes will also be added to Sticky Notes.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[#075d91]">Call information</h3>
                <p className="mt-1 text-xs text-[#1479a8]">Choose the direction, call type, and status.</p>
              </div>
              <div className="crm-form-grid">
                <div className="space-y-1.5">
                  <Label htmlFor="call-direction" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Direction</Label>
                  <Select value={callType} onValueChange={(value: "INBOUND" | "OUTBOUND") => { setCallType(value); applyCallNumbers(value); }}>
                    <SelectTrigger id="call-direction" className="h-10 border-sky-200 bg-white"><SelectValue placeholder="Select direction" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OUTBOUND">Outbound</SelectItem>
                      <SelectItem value="INBOUND">Inbound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="call-answer" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Call Type</Label>
                  <Select
                    value={callStatus === "COMPLETED" ? "COMPLETED" : "NO_ANSWER"}
                    onValueChange={(value) => setCallStatus(value === "COMPLETED" ? "COMPLETED" : callStatus === "BUSY" ? "BUSY" : "NO_ANSWER")}
                  >
                    <SelectTrigger id="call-answer" className="h-10 border-sky-200 bg-white"><SelectValue placeholder="Select call type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COMPLETED">Answer</SelectItem>
                      <SelectItem value="NO_ANSWER">Not Answer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="call-status" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Call Status</Label>
                  <Select value={callStatus === "NO_ANSWER" || callStatus === "BUSY" ? callStatus : "COMPLETED"} onValueChange={setCallStatus}>
                    <SelectTrigger id="call-status" className="h-10 border-sky-200 bg-white"><SelectValue placeholder="Select call status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COMPLETED">Complete</SelectItem>
                      <SelectItem value="NO_ANSWER">No Answer</SelectItem>
                      <SelectItem value="BUSY">Busy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-sky-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-[#075d91]">Call participants</h3>
                <p className="mt-1 text-xs text-[#1479a8]">
                  {callType === "OUTBOUND"
                    ? "From is the executive number. To is the customer number."
                    : "From is the customer number. To is the executive number."}
                </p>
              </div>
              <div className="crm-form-grid">
                <div className="space-y-1.5">
                  <Label htmlFor="call-from" className="text-[12px] font-semibold text-[#1479a8]">Call From</Label>
                  <Input id="call-from" maxLength={255} placeholder="Phone number" value={callFrom} onChange={(event) => setCallFrom(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="call-to" className="text-[12px] font-semibold text-[#1479a8]">Call To</Label>
                  <Input id="call-to" maxLength={50} placeholder="Phone number" value={callTo} onChange={(event) => setCallTo(event.target.value)} />
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-sky-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-[#075d91]">Call timing</h3>
                <p className="mt-1 text-xs text-[#1479a8]">End time can be the same as the start time, or later.</p>
              </div>
              <div className="crm-form-grid">
                <div className="space-y-1.5">
                  <Label htmlFor="call-start-time" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Start Time</Label>
                  <Input
                    id="call-start-time"
                    type="datetime-local"
                    value={callStartAt}
                    onChange={(event) => {
                      const nextStart = event.target.value;
                      setCallStartAt(nextStart);
                      setCallEndAt((current) => (!current || current < nextStart ? nextStart : current));
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="call-end-time" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>End Time</Label>
                  <Input id="call-end-time" type="datetime-local" value={callEndAt} onChange={(event) => setCallEndAt(event.target.value)} />
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-sky-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-[#075d91]">Additional details</h3>
                <p className="mt-1 text-xs text-[#1479a8]">Add notes for this call if you need them.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="call-notes" className="text-[12px] font-semibold text-[#1479a8]">Notes</Label>
                <Textarea id="call-notes" maxLength={5000} rows={4} placeholder="Add a summary of the conversation..." value={callNotes} onChange={(event) => setCallNotes(event.target.value)} />
                <p className="text-xs text-[#1479a8]">Notes are also added to this lead&apos;s Sticky Notes.</p>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-sky-100 bg-sky-50/70 px-6 py-4">
            <Button variant="outline" className="border-sky-200 bg-white text-[#075d91] hover:bg-sky-50" onClick={() => setCallDialogOpen(false)} disabled={callSaving}>Cancel</Button>
            <Button className="bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-200 hover:from-blue-700 hover:to-blue-600" onClick={() => void handleLogCall()} disabled={callSaving}>
              {callSaving ? "Saving..." : "Save Call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Follow-up Dialog */}
      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-xl border-sky-100 bg-[#f5fbff] p-0 shadow-sm sm:max-w-lg [&_input]:h-10 [&_input]:border-sky-200 [&_input]:bg-white [&_textarea]:border-sky-200 [&_textarea]:bg-white">
          <DialogHeader className="border-b border-sky-100 bg-gradient-to-br from-white to-sky-50 px-6 py-4 pr-10 text-center sm:text-center">
            <DialogTitle className="text-lg text-[#075d91]">Create Follow-up</DialogTitle>
            <DialogDescription className="text-[12px] text-[#1479a8]">Schedule a future follow-up. Past dates and times are not allowed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="fu-note" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Note / Reason</Label>
              <Textarea
                id="fu-note"
                placeholder="Enter follow-up note/reason..."
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
              />
            </div>
            <div className="crm-pair">
              <div className="space-y-1.5">
                <Label htmlFor="fu-date" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Date</Label>
                <Input
                  id="fu-date"
                  type="date"
                  min={followUpMinDate}
                  value={followUpDate}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    setFollowUpDate(nextDate);
                    if (nextDate === followUpMinDate && followUpTime && followUpTime < followUpNowTime) setFollowUpTime("");
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-time" className="text-[12px] font-semibold text-[#1479a8]"><span className="mr-1 text-destructive">*</span>Time</Label>
                <Input
                  id="fu-time"
                  type="time"
                  min={followUpDate === followUpMinDate ? followUpNowTime : undefined}
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                />
              </div>
            </div>
            {followUpScheduleError ? (
              <p className="text-xs text-destructive">{followUpScheduleError}</p>
            ) : (
              <p className="text-xs text-[#1479a8]">Only a future date and time can be scheduled.</p>
            )}
          </div>
          <DialogFooter className="border-t border-sky-100 bg-sky-50/70 px-6 py-4">
            <Button variant="outline" className="border-sky-200 bg-white text-[#075d91] hover:bg-sky-50" onClick={() => setFollowUpDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button className="bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-200 hover:from-blue-700 hover:to-blue-600" onClick={handleCreateFollowUp} disabled={isActionLoading || Boolean(followUpScheduleError)}>
              {isActionLoading ? "Creating..." : "Create Follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Follow-up</DialogTitle>
            <DialogDescription>All fields are mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="task-note">Description *</Label>
              <Textarea
                id="task-note"
                placeholder="Enter task description..."
                value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
              />
            </div>
            <div className="crm-pair">
              <div className="space-y-2">
                <Label htmlFor="task-date">Due Date *</Label>
                <Input
                  id="task-date"
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-time">Time *</Label>
                <Input
                  id="task-time"
                  type="time"
                  value={taskTime}
                  onChange={(e) => setTaskTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateTask} disabled={isActionLoading}>
              {isActionLoading ? "Creating..." : "Create Follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>Note content is mandatory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="note-subject">Subject</Label>
              <Input
                id="note-subject"
                placeholder="Note subject..."
                value={noteSubject}
                onChange={(e) => setNoteSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-content">Note Content *</Label>
              <Textarea
                id="note-content"
                placeholder="Enter note content..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button onClick={handleCreateNote} disabled={isActionLoading || !noteContent.trim()}>
              {isActionLoading ? "Adding..." : "Add Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog for Task / Follow-up / Note / Activity */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detailItem?.data.recordType === "CALL_DETAIL" && "Call Details"}
              {detailItem?.kind === "task" && "Task Details"}
              {detailItem?.kind === "followup" && "Follow-up Details"}
              {detailItem?.kind === "note" && "Note Details"}
              {detailItem?.kind === "activity" && "Activity Details"}
            </DialogTitle>
            <DialogDescription>
              {detailItem?.data.recordType === "CALL_DETAIL" && "Full call details record"}
              {detailItem?.kind === "task" && "Full task record"}
              {detailItem?.kind === "followup" && "Full follow-up record"}
              {detailItem?.kind === "note" && "Note content and metadata"}
              {detailItem?.kind === "activity" && "Activity content and metadata"}
            </DialogDescription>
          </DialogHeader>
          {detailItem && (
            detailItem.data.recordType === "CALL_DETAIL" ? (
              <dl className="grid max-h-[60vh] gap-3 overflow-y-auto py-2 sm:grid-cols-2">
                {[
                  ["Call Details Name", detailItem.data.name],
                  ["Call From", detailItem.data.callFrom],
                  ["Call ID", detailItem.data.callId],
                  ["Call To", detailItem.data.callTo],
                  ["Call Type", callAnswerLabel(detailItem.data.status)],
                  ["Direction", detailItem.data.callType],
                  ["Case", detailItem.data.case?.leadNumber || detailItem.data.case?.lastName],
                  ["Created By", [detailItem.data.createdBy?.firstName, detailItem.data.createdBy?.lastName].filter(Boolean).join(" ")],
                  ["Duration", typeof detailItem.data.duration === "number" ? `${Math.floor(detailItem.data.duration / 60)}m ${detailItem.data.duration % 60}s` : ""],
                  ["End Time", detailItem.data.endAt ? formatDateTime(detailItem.data.endAt) : ""],
                  ["Last Modified By", [detailItem.data.lastModifiedBy?.firstName, detailItem.data.lastModifiedBy?.lastName].filter(Boolean).join(" ")],
                  ["Lead", detailItem.data.lead?.leadNumber || detailItem.data.lead?.lastName],
                  ["Owner", [detailItem.data.owner?.firstName, detailItem.data.owner?.lastName].filter(Boolean).join(" ")],
                  ["Parent ID", detailItem.data.parentId],
                  ["Start Time", detailItem.data.startAt ? formatDateTime(detailItem.data.startAt) : ""],
                  ["Status", callStatusLabel(detailItem.data.status)],
                  ["Notes", detailItem.data.notes],
                ].map(([label, value]) => (
                  <div key={label} className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                    <dd className="break-words text-sm">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {detailItem.kind === "task" || detailItem.kind === "followup" ? "Title" : "Subject"}
                </p>
                <p className="text-sm font-medium">
                  {detailItem.data.title || detailItem.data.subject || detailItem.data.description || "—"}
                </p>
              </div>
              {detailItem.data.description && detailItem.data.title && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Description</p>
                  <p className="text-sm whitespace-pre-wrap">{detailItem.data.description}</p>
                </div>
              )}
              {detailItem.data.status && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Status</span>
                  <Badge variant="outline">{detailItem.data.status}</Badge>
                </div>
              )}
              {detailItem.data.priority && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Priority</span>
                  <Badge variant="outline">{detailItem.data.priority}</Badge>
                </div>
              )}
              {detailItem.data.dueDate && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Due Date</span>
                  <span className="text-sm">{formatDateTime(detailItem.data.dueDate)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Created</span>
                <span className="text-sm">{formatDateTime(detailItem.data.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Updated</span>
                <span className="text-sm">{formatDateTime(detailItem.data.updatedAt || detailItem.data.createdAt)}</span>
              </div>
              {detailItem.data.owner && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Owner</span>
                  <span className="text-sm">{detailItem.data.owner.firstName} {detailItem.data.owner.lastName}</span>
                </div>
              )}
              {detailItem.data.user && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Created By</span>
                  <span className="text-sm">{detailItem.data.user.firstName} {detailItem.data.user.lastName}</span>
                </div>
              )}
            </div>
            )
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revisit Dialog */}
      <Dialog open={revisitDialogOpen} onOpenChange={setRevisitDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{rescheduleSiteVisitId ? "Reschedule Site Visit" : "Create Revisit Site Visit"}</DialogTitle>
            <DialogDescription><span className="text-destructive">*</span> Required information</DialogDescription>
          </DialogHeader>
          <SiteVisitScheduleFields
            idPrefix="revisit"
            value={revisitForm}
            onChange={setRevisitForm}
            projects={projects}
            projectsLoading={projectsLoading}
            projectsError={projectsError}
            onRetryProjects={() => void loadProjects(true)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisitDialogOpen(false)} disabled={isActionLoading}>Cancel</Button>
            <Button
              onClick={handleRevisit}
              disabled={isActionLoading || projectsLoading || Boolean(projectsError) || !projects.length || !revisitForm.projectId || !siteVisitScheduleIsFuture(revisitForm) || !revisitForm.visitType.trim() || !revisitForm.minimumBudget || !revisitForm.maximumBudget || !revisitForm.propertyType.length}
            >
              {isActionLoading ? "Saving..." : rescheduleSiteVisitId ? "Reschedule Site Visit" : "Create Revisit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Site Visit Dialog */}
      <Dialog open={cancelSvDialogOpen} onOpenChange={setCancelSvDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Site Visit</DialogTitle>
            <DialogDescription>A reason is required. Lead returns to Prospect.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason *</Label>
              <Textarea
                id="cancel-reason"
                placeholder="Why is this site visit being cancelled?"
                value={cancelSvReason}
                onChange={(e) => setCancelSvReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSvDialogOpen(false)} disabled={isActionLoading}>Back</Button>
            <Button variant="destructive" onClick={handleCancelSiteVisit} disabled={isActionLoading}>
              {isActionLoading ? "Cancelling..." : "Cancel Site Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Site Visit Dialog */}
      <Dialog open={completeSvDialogOpen} onOpenChange={setCompleteSvDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Site Visit</DialogTitle>
            <DialogDescription>Marks the site visit as happened. Lead moves to Site Visit Happened.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="complete-time">Completion Time *</Label>
              <Input id="complete-time" type="datetime-local" value={completeSvTime} onChange={(e) => setCompleteSvTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complete-feedback">Customer Feedback *</Label>
              <Textarea
                id="complete-feedback"
                placeholder="Client feedback..."
                value={completeSvFeedback}
                onChange={(e) => setCompleteSvFeedback(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="complete-notes">Notes *</Label>
              <Textarea id="complete-notes" value={completeSvNotes} onChange={(e) => setCompleteSvNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteSvDialogOpen(false)} disabled={isActionLoading}>Back</Button>
            <Button onClick={handleCompleteSiteVisit} disabled={isActionLoading || !completeSvTime || !completeSvFeedback.trim() || !completeSvNotes.trim()}>
              {isActionLoading ? "Completing..." : "Complete Site Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingEnquiry)}
        onOpenChange={(open) => {
          if (!open && !enquirySaveLoading) {
            setEditingEnquiry(null);
            setEnquiryEditDraft(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="text-center">Edit {editingEnquiry?.enquiryNumber || "Related Source"}</DialogTitle>
            <DialogDescription className="sr-only">Update the enquiry source and contact details linked to this Lead.</DialogDescription>
          </DialogHeader>
          {enquiryEditDraft && (
            <>
              <div className="grid gap-x-8 gap-y-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Related Source</Label>
                  <Input value={editingEnquiry?.enquiryNumber || ""} disabled />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Lead Type</Label>
                  <Select value={enquiryEditDraft.leadType} onValueChange={(value) => updateEnquiryDraft("leadType", value)}>
                    <SelectTrigger><SelectValue placeholder="Select Lead Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ORIGINAL">Fresh</SelectItem>
                      <SelectItem value="RE_OPENED">Re-Opened</SelectItem>
                      <SelectItem value="RE_ENGAGED">Re-Engaged</SelectItem>
                      <SelectItem value="ADDITIONAL">Additional</SelectItem>
                      <SelectItem value="OUTSIDE_REENGAGEMENT_WINDOW">Outside Re-Engagement Window</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Lead ID</Label>
                  <Input value={lead?.leadNumber || ""} disabled />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Source <span className="text-destructive">*</span></Label>
                  <Input value={enquiryEditDraft.source} onChange={(event) => updateEnquiryDraft("source", event.target.value)} maxLength={120} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Campaign</Label>
                  <Input
                    value={enquiryEditDraft.campaign}
                    onChange={(event) => {
                      updateEnquiryDraft("campaign", event.target.value);
                      updateEnquiryDraft("campaignId", "");
                    }}
                    maxLength={160}
                  />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Allocated Project</Label>
                  <Select
                    value={enquiryEditDraft.projectId || "__no_project__"}
                    onValueChange={(value) => updateEnquiryDraft("projectId", value === "__no_project__" ? "" : value)}
                  >
                    <SelectTrigger disabled={enquiryEditProjectsLoading}>
                      <SelectValue placeholder={enquiryEditProjectsLoading ? "Loading projects..." : "Select project"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__no_project__">No Project</SelectItem>
                      {enquiryEditProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Sub Source</Label>
                  <Input value={enquiryEditDraft.subSource} onChange={(event) => updateEnquiryDraft("subSource", event.target.value)} maxLength={120} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Sub Campaign</Label>
                  <Input
                    value={enquiryEditDraft.subCampaign}
                    onChange={(event) => {
                      updateEnquiryDraft("subCampaign", event.target.value);
                      updateEnquiryDraft("subCampaignId", "");
                    }}
                    maxLength={160}
                  />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Country Code</Label>
                  <Input value={enquiryEditDraft.countryCode} onChange={(event) => updateEnquiryDraft("countryCode", event.target.value)} maxLength={8} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Phone</Label>
                  <Input type="tel" value={enquiryEditDraft.phone} onChange={(event) => updateEnquiryDraft("phone", event.target.value)} maxLength={64} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Secondary Country Code</Label>
                  <Input value={enquiryEditDraft.secondaryCountryCode} onChange={(event) => updateEnquiryDraft("secondaryCountryCode", event.target.value)} maxLength={8} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Secondary Phone</Label>
                  <Input type="tel" value={enquiryEditDraft.secondaryPhone} onChange={(event) => updateEnquiryDraft("secondaryPhone", event.target.value)} maxLength={64} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Tertiary Country Code</Label>
                  <Input value={enquiryEditDraft.tertiaryCountryCode} onChange={(event) => updateEnquiryDraft("tertiaryCountryCode", event.target.value)} maxLength={8} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Tertiary Phone</Label>
                  <Input type="tel" value={enquiryEditDraft.tertiaryPhone} onChange={(event) => updateEnquiryDraft("tertiaryPhone", event.target.value)} maxLength={64} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Email</Label>
                  <Input type="email" value={enquiryEditDraft.email} onChange={(event) => updateEnquiryDraft("email", event.target.value)} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Secondary Email</Label>
                  <Input type="email" value={enquiryEditDraft.secondaryEmail} onChange={(event) => updateEnquiryDraft("secondaryEmail", event.target.value)} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Tertiary Email</Label>
                  <Input type="email" value={enquiryEditDraft.tertiaryEmail} onChange={(event) => updateEnquiryDraft("tertiaryEmail", event.target.value)} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Medium</Label>
                  <Input value={enquiryEditDraft.medium} onChange={(event) => updateEnquiryDraft("medium", event.target.value)} maxLength={120} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Channel Partner</Label>
                  <Input value={enquiryEditDraft.channelPartner} onChange={(event) => updateEnquiryDraft("channelPartner", event.target.value)} maxLength={160} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Enquiry Date</Label>
                  <Input type="datetime-local" value={enquiryEditDraft.enquiryDate} onChange={(event) => updateEnquiryDraft("enquiryDate", event.target.value)} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Budget Range</Label>
                  <Input value={enquiryEditDraft.budgetRange} onChange={(event) => updateEnquiryDraft("budgetRange", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Cent Range</Label>
                  <Input value={enquiryEditDraft.centRange} onChange={(event) => updateEnquiryDraft("centRange", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Allocated Project Label</Label>
                  <Input value={enquiryEditDraft.allocatedProject} onChange={(event) => updateEnquiryDraft("allocatedProject", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Purpose of Purchase</Label>
                  <Input value={enquiryEditDraft.purposeOfPurchase} onChange={(event) => updateEnquiryDraft("purposeOfPurchase", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Referral By</Label>
                  <Input value={enquiryEditDraft.referralBy} onChange={(event) => updateEnquiryDraft("referralBy", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Enquiry Status</Label>
                  <Input value={enquiryEditDraft.enquiryStatus} onChange={(event) => updateEnquiryDraft("enquiryStatus", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Type of Lead</Label>
                  <Input value={enquiryEditDraft.typeOfLead} onChange={(event) => updateEnquiryDraft("typeOfLead", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Voice of Customer</Label>
                  <Input value={enquiryEditDraft.voiceOfCustomer} onChange={(event) => updateEnquiryDraft("voiceOfCustomer", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Genuinely Interested</Label>
                  <Input value={enquiryEditDraft.genuinelyInterested} onChange={(event) => updateEnquiryDraft("genuinelyInterested", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label>Please Confirm</Label>
                  <Input value={enquiryEditDraft.pleaseConfirm} onChange={(event) => updateEnquiryDraft("pleaseConfirm", event.target.value)} maxLength={255} />
                </div>
                <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                  <Label htmlFor="enquiry-primary">Primary</Label>
                  <input id="enquiry-primary" type="checkbox" checked={enquiryEditDraft.primary} onChange={(event) => updateEnquiryDraft("primary", event.target.checked)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="related-source-description">Enquiry Details</Label>
                  <Textarea
                    id="related-source-description"
                    className="mt-2"
                    value={enquiryEditDraft.description}
                    onChange={(event) => updateEnquiryDraft("description", event.target.value)}
                    maxLength={5000}
                    rows={3}
                  />
                </div>
                {enquiryEditProjectsLoading && <p className="text-sm text-muted-foreground sm:col-span-2">Loading projects...</p>}
                {enquiryEditError && (
                  <p role="alert" className="text-sm text-destructive sm:col-span-2">{enquiryEditError}</p>
                )}
              </div>
              <DialogFooter className="border-t bg-muted/30 px-6 py-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingEnquiry(null);
                    setEnquiryEditDraft(null);
                  }}
                  disabled={enquirySaveLoading}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveEnquiryEdits()} disabled={enquirySaveLoading || !enquiryEditDraft.source.trim()}>
                  {enquirySaveLoading ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(enquiryDeleteTarget)} onOpenChange={(open) => {
        if (!open && !enquiryDeleteLoading) setEnquiryDeleteTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete related source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {enquiryDeleteTarget?.enquiryNumber || "this enquiry"} from this Lead. The main Lead will not be deleted, and this action will be recorded in audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enquiryDeleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deleteEnquiry();
              }}
              disabled={enquiryDeleteLoading}
            >
              {enquiryDeleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}