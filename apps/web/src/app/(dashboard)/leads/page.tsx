"use client";

import * as React from "react";

import { useAuth } from "@/contexts/auth-context";

import { useRouter } from "next/navigation";

import { leadApi } from "@/lib/api";
import { clickToCallToast } from "@/lib/click-to-call";
import { requestLeadCall } from "@/lib/telephony-client";
import { maskTelephonyNumber, useTelephonyActive, useTelephonyNumberMasking, useTelephonyReasonCode } from "@/lib/telephony-client";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";

import { LeadList, Lead } from "@/components/crm/lead-list";

import { Plus, AlertCircle, Link2, Layers3, UsersRound } from "lucide-react";
import { CommonFilterPanel, FilterDate, FilterSearch, FilterSelect } from "@/components/crm/common-filter-panel";
import { useListView } from "@/components/crm/list-view-control";
import { subscribeToLeadListUpdates } from "@/lib/lead-list-events";
import { ListPageHeader, listPageActionClassName } from "@/components/crm/list-page-header";

const SOURCE_OPTIONS = [
  { label: "Website", value: "WEBSITE" },
  { label: "Referral", value: "REFERRAL" },
  { label: "Cold Call", value: "COLD_CALL" },
  { label: "Advertisement", value: "ADVERTISEMENT" },
  { label: "Instagram", value: "INSTAGRAM" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Walk-in", value: "WALK_IN" },
];

function mapApiLeadToLead(apiLead: any, maskNumbers: boolean): Lead {
  const statusLower = (apiLead.status || "NEW").toLowerCase();
  return {
    id: apiLead.id,
    leadNumber: apiLead.leadNumber || "",
    firstName: apiLead.firstName || "",
    lastName: apiLead.lastName || "",
    company: apiLead.company || "",
    email: apiLead.email || "",
    phone: maskNumbers ? maskTelephonyNumber(apiLead.phone, apiLead.countryCode) : apiLead.phone || "",
    source: apiLead.source || "",
    status: statusLower,
    statusLabel: apiLead.statusLabel || statusLower.replaceAll("_", " "),
    rating: apiLead.rating || "",
    assignedTo: statusLower === "booked"
      ? "Booked"
      : apiLead.owner
      ? `${apiLead.owner.firstName} ${apiLead.owner.lastName}`
      : "",
    createdAt: apiLead.createdAt,
    updatedAt: apiLead.updatedAt,
  };
}

export default function LeadsPage() {
  const { leadStatuses, hasPermission, hasEffectivePermission, isAdmin, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const listViews = useListView("LEAD");
  const telephonyActive = useTelephonyActive();
  const telephonyReasonCode = useTelephonyReasonCode();
  const maskNumbers = useTelephonyNumberMasking();
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalItems, setTotalItems] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const allowedStatuses = leadStatuses.filter((status) => status.enabled);

  const canCreateLead = React.useMemo(() => hasPermission("Lead", "create"), [hasPermission]);
  const canDeleteLead = React.useMemo(() => hasPermission("Lead", "delete"), [hasPermission]);
  const canCall = hasEffectivePermission("TELEPHONY_CALL") && telephonyActive;
  const [callingLeadId, setCallingLeadId] = React.useState<string | null>(null);

  const callLead = async (lead: Lead) => {
    if (!lead.phone || callingLeadId) return;
    setCallingLeadId(lead.id);
    const result = await requestLeadCall({
      leadId: lead.id,
      phoneField: "phone",
      leadName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company || lead.leadNumber,
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
    setCallingLeadId(null);
  };

  const fetchLeads = React.useCallback(async () => {
    if (!listViews.ready) return;
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = {
        page: currentPage,
        limit: 20,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (sourceFilter) params.source = sourceFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      Object.assign(params, listViews.params);
      const res = await leadApi.list(params);
      if (res.data.success && res.data.data) {
        const items = Array.isArray(res.data.data)
          ? res.data.data
          : res.data.data.leads || [];
        setLeads(items.map((item: any) => mapApiLeadToLead(item, maskNumbers)));
        setTotalItems(res.data.pagination?.total || items.length);
      } else {
        setError(res.data.error || "Failed to load leads");
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load leads");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, debouncedSearch, statusFilter, sourceFilter, dateFrom, dateTo, listViews.ready, listViews.queryKey, maskNumbers]);

  React.useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  React.useEffect(() => subscribeToLeadListUpdates(() => {
    void fetchLeads();
  }), [fetchLeads]);

  const handleDeleteLead = React.useCallback(async (lead: Lead) => {
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber || "this lead";
    const confirmed = window.confirm(`Delete ${leadName}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await leadApi.delete(lead.id);
      await fetchLeads();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to delete lead");
    }
  }, [fetchLeads]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="space-y-4">
      <ListPageHeader
        icon={<UsersRound className="h-6 w-6" />}
        title="Leads"
        subtitle="Manage your leads and track their progress"
        view={listViews.control}
        actions={canCreateLead ? (
          <Button className={`${listPageActionClassName} bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-200 hover:from-blue-700 hover:to-blue-600`} onClick={() => router.push("/leads/new")}>
            <Plus className="h-4 w-4" />
            Create Lead
          </Button>
        ) : null}
      />

      {listViews.dialog}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CommonFilterPanel
        className="crm-filter-panel-inline"
        onReset={() => {
          setSearch("");
          setDebouncedSearch("");
          setStatusFilter("");
          setSourceFilter("");
          setDateFrom("");
          setDateTo("");
          setCurrentPage(1);
        }}
      >
        <FilterSearch value={search} onChange={setSearch} placeholder="Search leads..." />
        <FilterSelect
          label="Status"
          icon={Layers3}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value);
            setCurrentPage(1);
          }}
          options={[
            { label: "All Statuses", value: "" },
            ...allowedStatuses.map((status) => ({ label: status.label, value: status.statusId })),
          ]}
        />
        <FilterSelect
          label="Source"
          icon={Link2}
          value={sourceFilter}
          onChange={(value) => {
            setSourceFilter(value);
            setCurrentPage(1);
          }}
          options={[
            { label: "All Sources", value: "" },
            ...SOURCE_OPTIONS,
          ]}
        />
        <FilterDate
          label="From Date"
          value={dateFrom}
          onChange={(value) => {
            setDateFrom(value);
            setCurrentPage(1);
          }}
        />
        <FilterDate
          label="To Date"
          value={dateTo}
          onChange={(value) => {
            setDateTo(value);
            setCurrentPage(1);
          }}
        />
      </CommonFilterPanel>

      <LeadList
        leads={leads}
        isLoading={isLoading}
        totalItems={totalItems}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        canDelete={canDeleteLead}
        onDelete={handleDeleteLead}
        canCall={canCall}
        telephonyReasonCode={telephonyReasonCode}
        isAdmin={Boolean(isAdmin || isSuperAdmin)}
        callingLeadId={callingLeadId}
        onCall={(lead) => { void callLead(lead); }}
        sorting={listViews.sorting ? [listViews.sorting] : []}
        onSortingChange={(next) => {
          listViews.onSortingChange(next[0] || null);
          setCurrentPage(1);
        }}
      />
    </div>
  );
}
