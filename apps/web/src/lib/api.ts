import axios, { AxiosInstance, AxiosError } from 'axios';

const API_BASE_URL = '/api/proxy';
const SESSION_TOKEN_KEY = 'crm-session-token';
const SESSION_LAST_ACTIVITY_KEY = 'crm-session-last-activity';
export const SUPERADMIN_SESSION_KEY = 'crm-superadmin-session';
export const IMPERSONATION_META_KEY = 'crm-impersonation-meta';
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function impersonationMeta(): { returnPath: string } | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(IMPERSONATION_META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { returnPath?: string };
    return { returnPath: parsed.returnPath || '/admin/companies' };
  } catch {
    return { returnPath: '/admin/companies' };
  }
}

export function rememberSuperadminSession(token: string, returnPath: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SUPERADMIN_SESSION_KEY, token);
  window.sessionStorage.setItem(IMPERSONATION_META_KEY, JSON.stringify({ returnPath }));
}

export function restoreSuperadminSession(token?: string | null) {
  if (typeof window === 'undefined') return null;
  const saved = window.sessionStorage.getItem(SUPERADMIN_SESSION_KEY);
  const meta = impersonationMeta();
  window.sessionStorage.removeItem(SUPERADMIN_SESSION_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_META_KEY);
  const next = token || saved;
  if (next) setSessionToken(next, false);
  else clearSessionToken();
  return meta?.returnPath || '/admin/companies';
}

function recoverImpersonationFailure() {
  const meta = impersonationMeta();
  if (!meta || typeof window === 'undefined') return false;
  const saved = window.sessionStorage.getItem(SUPERADMIN_SESSION_KEY);
  window.sessionStorage.removeItem(SUPERADMIN_SESSION_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_META_KEY);
  if (!saved) return false;
  setSessionToken(saved, false);
  window.location.replace(meta.returnPath);
  return true;
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string, updateLastActivity = true): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  if (updateLastActivity) {
    window.sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
  }
}

export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  window.sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
  window.sessionStorage.removeItem(SUPERADMIN_SESSION_KEY);
  window.sessionStorage.removeItem(IMPERSONATION_META_KEY);
}

export function getSessionLastActivity(): number {
  if (typeof window === 'undefined') return 0;
  const lastActivity = Number(window.sessionStorage.getItem(SESSION_LAST_ACTIVITY_KEY));
  return Number.isFinite(lastActivity) ? lastActivity : 0;
}

export function recordSessionActivity(): void {
  if (getSessionToken()) {
    window.sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
  }
}

function getSetupTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname;
  const supportsCompanySetupContext =
    pathname === '/setup' ||
    pathname.startsWith('/setup/') ||
    pathname === '/cp-portal-accounts' ||
    pathname.startsWith('/admin/object-manager') ||
    pathname.startsWith('/admin/customize-home') ||
    pathname.startsWith('/reports') ||
    pathname.startsWith('/dashboards');
  return supportsCompanySetupContext
    ? new URLSearchParams(window.location.search).get('tenantId')
    : null;
}

export async function fetchAuthenticatedImage(url: string): Promise<string> {
  const response = await window.fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load authenticated image (${response.status})`);
  }
  return URL.createObjectURL(await response.blob());
}

if (
  typeof window !== 'undefined' &&
  !(window as Window & { __crmSessionFetchInstalled?: boolean }).__crmSessionFetchInstalled
) {
  const originalFetch = window.fetch.bind(window);
  (window as Window & { __crmSessionFetchInstalled?: boolean }).__crmSessionFetchInstalled = true;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = input instanceof Request
      ? input.url
      : String(input);
    const url = new URL(inputUrl, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/proxy/')) {
      return originalFetch(input, init);
    }
    const setupTenantId = getSetupTenantId();
    if (setupTenantId) url.searchParams.set('tenantId', setupTenantId);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('x-session-auth', 'required');
    const token = getSessionToken();
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }

    return originalFetch(input, { ...init, headers }).then((response) => {
      if (
        response.status === 401 &&
        token &&
        !url.pathname.includes('/api/gre/public/') &&
        window.location.pathname !== '/login'
      ) {
        if (!recoverImpersonationFailure()) {
          clearSessionToken();
          window.location.replace('/login');
        }
      }
      return response;
    });
  };
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  config.headers.set('x-session-auth', 'required');
  const token = getSessionToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  const setupTenantId = getSetupTenantId();
  if (setupTenantId) {
    if (config.params instanceof URLSearchParams) {
      config.params.set('tenantId', setupTenantId);
    } else {
      config.params = { ...config.params, tenantId: setupTenantId };
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const token = response.data?.data?.token;
    if (
      typeof token === 'string' &&
      (response.config.url?.includes('/auth/refresh') ||
        response.config.url?.includes('/auth/heartbeat') ||
        response.config.url?.includes('/auth/stop-impersonation') ||
        response.config.url?.includes('/impersonate'))
    ) {
      setSessionToken(token, false);
    }
    return response;
  },
  (error: AxiosError) => {
    const requestUrl = error.config?.url || '';
    if (
      error.response?.status === 401 &&
      !requestUrl.includes('/api/auth/login') &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login'
    ) {
      if (!recoverImpersonationFailure()) {
        clearSessionToken();
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

// Anonymous client for the public GRE registration links. Those endpoints answer
// 401/410 for a missing or expired form session, which the form handles itself —
// it must not be bounced to /login the way authenticated API calls are.
const publicApi: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  apiKey?: string;
  warning?: string;
  ok?: boolean;
  code?: string;
  step?: "blocked_before_send" | "sent_to_provider";
  summary?: Record<string, number>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const listViewApi = {
  catalog: (module: string) => api.get<ApiResponse>('/api/list-views', { params: { module } }),
  create: (data: Record<string, unknown>) => api.post<ApiResponse>('/api/list-views', data),
  update: (id: string, data: Record<string, unknown>) => api.patch<ApiResponse>(`/api/list-views/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/api/list-views/${id}`),
  duplicate: (id: string, module: string) => api.post<ApiResponse>(`/api/list-views/${encodeURIComponent(id)}/duplicate`, { module }),
  select: (module: string, viewKey: string) => api.post<ApiResponse>('/api/list-views/select', { module, viewKey }),
  pin: (module: string, viewKey: string, pinned: boolean) => api.post<ApiResponse>('/api/list-views/pin', { module, viewKey, pinned }),
  recordView: (module: string, recordId: string) => api.post<ApiResponse>('/api/list-views/record-view', { module, recordId }),
};

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<ApiResponse>('/api/auth/login', { email, password }),
  logout: () => api.post<ApiResponse>('/api/auth/logout'),
  me: () => api.get<ApiResponse>('/api/auth/me'),
  refresh: () => api.post<ApiResponse>('/api/auth/refresh'),
  heartbeat: () => api.post<ApiResponse>('/api/auth/heartbeat'),
  sessions: () => api.get<ApiResponse>('/api/auth/sessions'),
  endSession: (id: string) => api.post<ApiResponse>(`/api/auth/sessions/${id}/end`),
  stopImpersonation: () => api.post<ApiResponse>('/api/auth/stop-impersonation'),
};

export const presenceApi = {
  activeUsers: (params?: Record<string, string | boolean>) => api.get<ApiResponse>('/api/admin/active-users', {
    params,
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  }),
  settings: () => api.get<ApiResponse>('/api/admin/presence-settings'),
  saveSettings: (data: { idleTimeoutSeconds: number; heartbeatIntervalSeconds: number }) => api.put<ApiResponse>('/api/admin/presence-settings', data),
  forceLogoutUser: (userId: string) => api.post<ApiResponse>(`/api/admin/active-users/${userId}/force-logout`),
  forceLogoutSession: (sessionId: string) => api.post<ApiResponse>(`/api/admin/active-users/sessions/${sessionId}/force-logout`),
  companyCounts: () => api.get<ApiResponse>('/api/super-admin/presence-counts'),
};

export const impersonationApi = {
  exit: () => api.post<ApiResponse>('/api/impersonation/exit'),
  status: () => api.get<ApiResponse>('/api/impersonation/status'),
};

// Lead API
export const leadApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/leads', { params }),
  statuses: () =>
    api.get<ApiResponse>('/api/leads/statuses'),
  salesUsers: () =>
    api.get<ApiResponse>('/api/leads/sales-users'),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/leads/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/leads', data),
  checkDuplicates: (data: any) =>
    api.post<ApiResponse>('/api/leads/duplicates', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/leads/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/leads/${id}`),
  recovery: (id: string, data: { recoveryReason: string; note?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/move-to-recovery`, data),
  changeOwner: (id: string, ownerId: string, reason?: string) =>
    api.patch<ApiResponse>(`/api/leads/${id}/owner`, { ownerId, ...(reason ? { reason } : {}) }),
  ownerCandidates: (id: string) =>
    api.get<ApiResponse>(`/api/leads/${id}/owner-candidates`),
  pushToSVC: (id: string, data: {
    reason: string;
    projectId: string;
    prospectDetails: {
      callSummaryRemarks: string;
      minimumBudget: string;
      maximumBudget: string;
      bedroomPreference: string[];
      propertyType: string[];
      possession?: string;
      reasonToBuy?: string;
    };
  }) =>
    api.post<ApiResponse>(`/api/leads/${id}/push-to-svc`, data),
  moveToRecovery: (id: string, data: { recoveryReason: string; note?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/move-to-recovery`, data),
  scheduleSiteVisit: (id: string, data: {
    scheduledAt: string;
    projectId: string;
    visitType: string;
    rating: string | null;
    transport: string | null;
    callSummaryRemarks: string;
    minimumBudget: string;
    maximumBudget: string;
    propertyType: string[];
    bedroomPreference: string[];
  }) =>
    api.post<ApiResponse>(`/api/leads/${id}/schedule-site-visit`, data),
  convert: (id: string, data?: { projectId?: string; unitId?: string; name?: string; amount?: number; expectedCloseDate?: string; probability?: number; description?: string }) =>
    api.post<ApiResponse>(`/api/leads/${id}/convert`, data || {}),
  getAuditHistory: (id: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/leads/${id}/audit-history`, { params }),
  getActivityHistory: (id: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/leads/${id}/activity-history`, { params }),
  getEnquiries: (id: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/leads/${id}/enquiries`, { params }),
};

// Enquiry API
export const enquiryApi = {
  get: (id: string) =>
    api.get<ApiResponse>(`/api/enquiries/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<ApiResponse>(`/api/enquiries/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/enquiries/${id}`),
};

// Site Visit API
export const siteVisitApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/site-visits', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/site-visits/${id}`),
  getHistory: (id: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/site-visits/${id}/history`, { params }),
  create: (data: any) =>
    api.post<ApiResponse>('/api/site-visits', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/site-visits/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/site-visits/${id}`),
  complete: (id: string, data: {
    completedAt: string;
    customerFeedback: string;
    completionNotes: string;
  }) =>
    api.patch<ApiResponse>(`/api/site-visits/${id}/complete`, data || {}),
  completeAsAdmin: (id: string, data: {
    completedAt: string;
    rating: string;
    feedback: string;
    minimumBudget?: string;
    maximumBudget?: string;
    propertyType?: string[];
    bedroomPreference?: string[];
  }) =>
    api.post<ApiResponse>(`/api/site-visits/${id}/complete`, data),
  cancel: (id: string, reason: string) =>
    api.patch<ApiResponse>(`/api/site-visits/${id}/cancel`, { reason }),
  revisit: (id: string, data: {
    reason?: string;
    scheduledAt: string;
    projectId: string;
    assigneeId?: string;
    notes?: string;
    visitType: string;
    rating: string | null;
    transport: string | null;
    callSummaryRemarks: string;
    minimumBudget: string;
    maximumBudget: string;
    propertyType: string[];
    bedroomPreference: string[];
  }) =>
    api.post<ApiResponse>(`/api/site-visits/${id}/revisit`, data),
};

// Lead quotation API
export const quotationApi = {
  listForLead: (leadId: string) =>
    api.get<ApiResponse>(`/api/quotations/lead/${leadId}`),
  createForLead: (leadId: string, data: Record<string, unknown>) =>
    api.post<ApiResponse>(`/api/quotations/lead/${leadId}`, data),
  downloadPdf: (leadId: string, quotationId: string) =>
    api.get<Blob>(`/api/quotations/lead/${leadId}/${quotationId}/pdf`, { responseType: 'blob' }),
};

export const bookingApi = {
  createFromQuotation: (leadId: string, quotationId: string, data: Record<string, unknown>) =>
    api.post<ApiResponse>(`/api/bookings/lead/${leadId}/quotation/${quotationId}`, data),
  listAll: (params?: Record<string, unknown>) => api.get<ApiResponse>(`/api/bookings`, { params }),
  requestCancellation: (bookingId: string, notes: string) =>
    api.post<ApiResponse>(`/api/bookings/${bookingId}/cancel-request`, { notes }),
  listCancellationRequests: () => api.get<ApiResponse>(`/api/bookings/cancellation-requests`),
  reviewCancellation: (bookingId: string, decision: "APPROVE" | "REJECT", note?: string) =>
    api.post<ApiResponse>(`/api/bookings/${bookingId}/cancellation-review`, { decision, note }),
  get: (bookingId: string) => api.get<ApiResponse>(`/api/bookings/${bookingId}`),
  getActivityHistory: (bookingId: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/bookings/${bookingId}/activity-history`, { params }),
  getAuditHistory: (bookingId: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/bookings/${bookingId}/audit-history`, { params }),
  updateDetails: (bookingId: string, details: Record<string, string | number | boolean | null>) =>
    api.patch<ApiResponse>(`/api/bookings/${bookingId}/details`, { details }),
  updateStage: (bookingId: string, stage: string) =>
    api.patch<ApiResponse>(`/api/bookings/${bookingId}/stage`, { stage }),
  listForLead: (leadId: string) =>
    api.get<ApiResponse>(`/api/bookings/lead/${leadId}`),
  completeWelcomeCall: (leadId: string, bookingId: string, notes?: string) =>
    api.post<ApiResponse>(`/api/bookings/lead/${leadId}/${bookingId}/welcome-call`, { notes }),
  downloadPdf: (leadId: string, bookingId: string) =>
    api.get<Blob>(`/api/bookings/lead/${leadId}/${bookingId}/pdf`, { responseType: 'blob' }),
};

export const receiptApi = {
  listForLead: (leadId: string) =>
    api.get<ApiResponse>(`/api/receipts/lead/${leadId}`),
  createForLead: (leadId: string, data: Record<string, unknown>) =>
    api.post<ApiResponse>(`/api/receipts/lead/${leadId}`, data),
  createCustomerReceipt: (leadId: string, bookingId: string, data: Record<string, unknown>) =>
    api.post<ApiResponse>(`/api/receipts/lead/${leadId}/bookings/${bookingId}/customer-receipt`, data),
  downloadPdf: (leadId: string, receiptId: string) =>
    api.get<Blob>(`/api/receipts/lead/${leadId}/${receiptId}/pdf`, { responseType: 'blob' }),
  listApprovals: (params?: Record<string, unknown>) =>
    api.get<ApiResponse>('/api/receipts/approvals', { params }),
  reviewApproval: (receiptId: string, data: { decision: 'APPROVE' | 'REJECT'; note?: string }) =>
    api.post<ApiResponse>(`/api/receipts/approvals/${receiptId}/review`, data),
};

// Notes API resolves the record type from its tenant-scoped record ID.
export const notesApi = {
  get: (recordId: string) =>
    api.get<ApiResponse<{ notes: string }>>(`/api/notes/${recordId}`),
  add: (recordId: string, note: string) =>
    api.post<ApiResponse<{ notes: string; number: number }>>(`/api/notes/${recordId}`, { note }),
};

// Project API
export const projectApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/projects', { params }),
  listAll: async (params?: Record<string, any>) => {
    const limit = 100;
    const firstPage = await api.get<ApiResponse<any[]>>('/api/projects', { params: { ...params, page: 1, limit } });
    const firstProjects = firstPage.data.data || [];
    const totalPages = firstPage.data.pagination?.totalPages || 1;
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        api.get<ApiResponse<any[]>>('/api/projects', { params: { ...params, page: index + 2, limit } })
      )
    );
    return [...firstProjects, ...remainingPages.flatMap((response) => response.data.data || [])];
  },
  get: (id: string) =>
    api.get<ApiResponse>(`/api/projects/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/projects', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/projects/${id}`, data),
  parseMapUrl: (url: string) =>
    api.post<ApiResponse<{ latitude: number; longitude: number }>>('/api/projects/parse-map-url', { url }),
  reverseGeocode: (latitude: number, longitude: number) =>
    api.post<ApiResponse<{ locationName: string; city: string | null; state: string | null }>>(
      '/api/projects/geocode',
      { latitude, longitude },
    ),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/projects/${id}`),
  unitFacets: (id: string) =>
    api.get<ApiResponse>(`/api/projects/${id}/unit-facets`),
  units: (id: string, params?: Record<string, string | number>) =>
    api.get<ApiResponse>(`/api/projects/${id}/units`, { params }),
};

// Unit API
export const unitApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/units', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/units/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/units', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/units/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/units/${id}`),
  updateStatus: (id: string, status: string) =>
    api.patch<ApiResponse>(`/api/units/${id}/status`, { status }),
};

// Task API
export const taskApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/tasks', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/tasks/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/tasks', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/tasks/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/tasks/${id}`),
  updateStatus: (id: string, status: string) =>
    api.put<ApiResponse>(`/api/tasks/${id}/status`, { status }),
  getMy: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/tasks/my', { params }),
};

// Follow-up API
export const followUpApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/follow-ups', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/follow-ups/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/follow-ups', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/follow-ups/${id}`),
  complete: (id: string) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}/complete`),
  reopen: (id: string) =>
    api.put<ApiResponse>(`/api/follow-ups/${id}/reopen`),
};

// Activity API
export const activityApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/activities', { params }),
  summary: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/activities/summary', { params }),
  options: () =>
    api.get<ApiResponse>('/api/activities/options'),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/activities/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/activities', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/activities/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/activities/${id}`),
};

export const callDetailsApi = {
  list: (leadId: string) =>
    api.get<ApiResponse>(`/api/call-details`, { params: { leadId } }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/call-details/${id}`),
  update: (id: string, data: Record<string, unknown>) =>
    api.put<ApiResponse>(`/api/call-details/${id}`, data),
  create: (data: {
    leadId: string;
    caseId?: string;
    callType: "INBOUND" | "OUTBOUND";
    callFrom?: string;
    callTo?: string;
    startAt: string;
    endAt: string;
    executiveContactNo?: string;
    landingNumber?: string;
    parentId?: string;
    parentUrl?: string;
    recordingFile?: string;
    status?: string;
    notes?: string;
  }) =>
    api.post<ApiResponse>("/api/call-details", data),
};

// Object Definition API
export const objectDefinitionApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/objects', { params }),
  get: (name: string) =>
    api.get<ApiResponse>(`/api/objects/${name}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/objects', data),
  update: (name: string, data: any) =>
    api.put<ApiResponse>(`/api/objects/${name}`, data),
  delete: (name: string) =>
    api.delete<ApiResponse>(`/api/objects/${name}`),
  fields: (objectName: string, params?: { includeSystem?: boolean; includeInactive?: boolean }) =>
    api.get<ApiResponse>(`/api/fields/${objectName}`, { params }),
};

// Data Administration API
export const dataAdministrationApi = {
  import: (objectName: string, fields: string[], csv: string) =>
    api.post<ApiResponse>('/api/data-administration/import', { objectName, fields, csv }),
  export: (objectName: string, params?: Record<string, any>) =>
    api.get(`/api/data-administration/export/${objectName}`, {
      params,
      responseType: 'text',
      headers: { Accept: 'text/csv' },
    }),
};

// Report API
export const reportApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/reports', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/reports/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/reports', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/reports/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/reports/${id}`),
  execute: (id: string, params?: Record<string, any>) =>
    api.post<ApiResponse>(`/api/reports/${id}/execute`, params),
};

// Dashboard API
export const dashboardApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/dashboards', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/dashboards/${id}`),
  getDefault: () =>
    api.get<ApiResponse>('/api/dashboards/default'),
  create: (data: any) =>
    api.post<ApiResponse>('/api/dashboards', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/dashboards/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/dashboards/${id}`),
  getWidgetData: (id: string, widgetId: string, filters?: any) =>
    api.post<ApiResponse>(`/api/dashboards/${id}/widgets/${widgetId}/data`, { filters }),
};

// Search API
export const searchApi = {
  search: (query: string, params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/search', { params: { q: query, ...params } }),
  quick: (query: string) =>
    api.get<ApiResponse>('/api/search/quick', { params: { q: query } }),
};

// Analytics API
export const telephonySettingsApi = {
  get: (tenantId?: string) =>
    api.get<ApiResponse>('/api/setup/telephony', { params: tenantId ? { tenantId } : undefined }),
  update: (data: Record<string, unknown>, tenantId?: string) =>
    api.put<ApiResponse>('/api/setup/telephony', data, { params: tenantId ? { tenantId } : undefined }),
  checkEmbedding: (origin: string, tenantId?: string) =>
    api.post<ApiResponse>('/api/setup/telephony/check-embedding', { origin }, { params: tenantId ? { tenantId } : undefined }),
  testConnection: (tenantId?: string) =>
    api.post<ApiResponse>('/api/setup/telephony/test-connection', {}, { params: tenantId ? { tenantId } : undefined }),
  testCall: (tenantId?: string) =>
    api.post<ApiResponse>('/api/setup/telephony/test-call', {}, { params: tenantId ? { tenantId } : undefined }),
  agents: (tenantId?: string) =>
    api.get<ApiResponse>('/api/setup/telephony/agents', { params: tenantId ? { tenantId } : undefined }),
  updateAgents: (data: { userIds?: string[]; profileId?: string; enabled: boolean }, tenantId?: string) =>
    api.put<ApiResponse>('/api/setup/telephony/agents', data, { params: tenantId ? { tenantId } : undefined }),
  logs: (tenantId?: string) =>
    api.get<ApiResponse>('/api/setup/telephony/logs', { params: tenantId ? { tenantId } : undefined }),
};

export const clickToCallApi = {
  place: (data: { leadId: string; phoneField?: 'phone' | 'mobile' | 'secondaryPhone' }) =>
    api.post<ApiResponse>('/api/telephony/click-to-call', data),
  clientConfig: () =>
    api.get<ApiResponse>('/api/telephony/client-config'),
  dialpadCallStarted: (data: { leadId: string; phoneField: 'phone' | 'mobile' | 'secondaryPhone' }) =>
    api.post<ApiResponse>('/api/telephony/dialpad-call-started', data),
  dialpadEvent: (data: Record<string, unknown>) =>
    api.post<ApiResponse>('/api/telephony/dialpad-event', data),
};

export const analyticsApi = {
  getLeads: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/leads', { params }),
  getProjects: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/analytics/projects', { params }),
};

// AI API
export const aiApi = {
  chat: (message: string, conversationId?: string) =>
    api.post<ApiResponse>('/api/ai/chat', { message, conversation_id: conversationId }),
  getConversation: (id: string) =>
    api.get<ApiResponse>(`/api/ai/conversations/${id}`),
  listConversations: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/ai/conversations', { params }),
  deleteConversation: (id: string) =>
    api.delete<ApiResponse>(`/api/ai/conversations/${id}`),
};

// User API
export const userApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/setup/users', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/setup/users/${id}`),
  create: (data: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    profileId?: string;
    roleId?: string | null;
    roleIds?: string[];
    password?: string;
    isActive?: boolean;
  }) =>
    api.post<ApiResponse>('/api/setup/users', data),
  update: (
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      profileId?: string | null;
      roleId?: string | null;
      roleIds?: string[];
      isActive?: boolean;
    }
  ) =>
    api.put<ApiResponse>(`/api/setup/users/${id}`, data),
  assignRoles: (id: string, roleIds: string[]) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/roles`, { roleIds }),
  deactivate: (id: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/deactivate`),
  activate: (id: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/activate`),
  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse>(`/api/setup/users/${id}/password`, { password }),
  impersonate: (id: string) =>
    api.post<ApiResponse>(`/api/setup/users/${id}/impersonate`),
};

// Role API
export const roleApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/roles', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/roles/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/roles', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/roles/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/roles/${id}`),
};

// Notification API
export const notificationApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/notifications', { params }),
  markRead: (id: string) =>
    api.put<ApiResponse>(`/api/notifications/${id}/read`),
  markAllRead: () =>
    api.put<ApiResponse>('/api/notifications/read-all'),
  getUnreadCount: () =>
    api.get<ApiResponse>('/api/notifications/unread-count'),
  clearAll: () =>
    api.delete<ApiResponse>('/api/notifications/clear-all'),
};

// Audit API
export const auditApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/audit', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/audit/${id}`),
  getByObject: (type: string, objectId: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/audit/object/${type}/${objectId}`, { params }),
  getByUser: (userId: string) =>
    api.get<ApiResponse>(`/api/audit/user/${userId}`),
  getSummary: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/audit/summary', { params }),
};

// Object Manager API
export const objectManagerApi = {
  listObjects: (includeInactive?: boolean) =>
    api.get<ApiResponse>('/api/objects', { params: { includeInactive } }),
  getObject: (name: string) =>
    api.get<ApiResponse>(`/api/objects/${name}`),
  createObject: (data: any) =>
    api.post<ApiResponse>('/api/objects', data),
  updateObject: (name: string, data: any) =>
    api.put<ApiResponse>(`/api/objects/${name}`, data),
  deleteObject: (name: string) =>
    api.delete<ApiResponse>(`/api/objects/${name}`),

  listFields: (objectName: string, params?: { includeSystem?: boolean; includeInactive?: boolean }) =>
    api.get<ApiResponse>(`/api/fields/${objectName}`, { params }),
  getField: (objectName: string, fieldId: string) =>
    api.get<ApiResponse>(`/api/fields/${objectName}/${fieldId}`),
  createField: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/fields/${objectName}`, data),
  updateField: (objectName: string, fieldId: string, data: any) =>
    api.put<ApiResponse>(`/api/fields/${objectName}/${fieldId}`, data),
  toggleField: (objectName: string, fieldId: string) =>
    api.patch<ApiResponse>(`/api/fields/${objectName}/${fieldId}/toggle`),
  reorderFields: (objectName: string, fieldOrders: { id: string; displayOrder: number }[]) =>
    api.patch<ApiResponse>(`/api/fields/${objectName}/reorder`, { fieldOrders }),
  deleteField: (objectName: string, fieldId: string) =>
    api.delete<ApiResponse>(`/api/fields/${objectName}/${fieldId}`),

  listPicklistValues: (fieldId: string) =>
    api.get<ApiResponse>(`/api/picklist-values/${fieldId}`),
  createPicklistValue: (fieldId: string, data: any) =>
    api.post<ApiResponse>(`/api/picklist-values/${fieldId}`, data),
  updatePicklistValue: (fieldId: string, valueId: string, data: any) =>
    api.put<ApiResponse>(`/api/picklist-values/${fieldId}/${valueId}`, data),
  deletePicklistValue: (fieldId: string, valueId: string) =>
    api.delete<ApiResponse>(`/api/picklist-values/${fieldId}/${valueId}`),

  listLayouts: (objectName: string) =>
    api.get<ApiResponse>(`/api/setup/layouts/${objectName}`),
  getDefaultLayout: (objectName: string) =>
    api.get<ApiResponse>(`/api/setup/layouts/${objectName}/default`),
  createLayout: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/setup/layouts/${objectName}`, data),
  updateLayout: (objectName: string, layoutId: string, data: any) =>
    api.put<ApiResponse>(`/api/setup/layouts/${objectName}/${layoutId}`, data),
  deleteLayout: (objectName: string, layoutId: string) =>
    api.delete<ApiResponse>(`/api/setup/layouts/${objectName}/${layoutId}`),
  resolveLayout: (objectName: string) =>
    api.get<ApiResponse>("/api/layout-assignments/resolve", { params: { object: objectName } }),

  getObjectPermissions: (objectName: string) =>
    api.get<ApiResponse>(`/api/object-permissions/${objectName}`),
  setObjectPermissions: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/object-permissions/${objectName}`, data),
  bulkSetObjectPermissions: (objectName: string, permissions: any[]) =>
    api.post<ApiResponse>(`/api/object-permissions/${objectName}/bulk`, { permissions }),
  deleteObjectPermission: (objectName: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/object-permissions/${objectName}/${permissionId}`),

  getFieldPermissions: (objectName: string, roleId?: string) =>
    api.get<ApiResponse>(`/api/field-permissions/${objectName}`, { params: { roleId } }),
  setFieldPermissions: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/field-permissions/${objectName}`, data),
  bulkSetFieldPermissions: (objectName: string, permissions: any[]) =>
    api.post<ApiResponse>(`/api/field-permissions/${objectName}/bulk`, { permissions }),
  deleteFieldPermission: (objectName: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/field-permissions/${objectName}/${permissionId}`),

};

// Modules API
export const modulesApi = {
  list: (includeInactive = true) =>
    api.get<ApiResponse>('/api/setup/modules', { params: { includeInactive } }),
  create: (data: any) => api.post<ApiResponse>('/api/setup/modules', data),
  update: (name: string, data: any) => api.put<ApiResponse>(`/api/setup/modules/${name}`, data),
  delete: (name: string) => api.delete<ApiResponse>(`/api/setup/modules/${name}`),
};

// Fields API
export const fieldsApi = {
  list: (moduleName: string, includeInactive = true) =>
    api.get<ApiResponse>(`/api/setup/fields/${moduleName}`, { params: { includeInactive } }),
  create: (moduleName: string, data: any) => api.post<ApiResponse>(`/api/setup/fields/${moduleName}`, data),
  update: (moduleName: string, fieldId: string, data: any) => api.put<ApiResponse>(`/api/setup/fields/${moduleName}/${fieldId}`, data),
  toggle: (moduleName: string, fieldId: string) => api.patch<ApiResponse>(`/api/setup/fields/${moduleName}/${fieldId}/toggle`),
};

// Dynamic Record API
export const dynamicRecordApi = {
  list: (objectName: string, params?: Record<string, any>) =>
    api.get<ApiResponse>(`/api/records/${objectName}`, { params }),
  get: (objectName: string, id: string) =>
    api.get<ApiResponse>(`/api/records/${objectName}/${id}`),
  create: (objectName: string, data: any) =>
    api.post<ApiResponse>(`/api/records/${objectName}`, data),
  update: (objectName: string, id: string, data: any) =>
    api.put<ApiResponse>(`/api/records/${objectName}/${id}`, data),
  delete: (objectName: string, id: string) =>
    api.delete<ApiResponse>(`/api/records/${objectName}/${id}`),
  bulkCreate: (objectName: string, records: any[]) =>
    api.post<ApiResponse>(`/api/records/${objectName}/bulk`, { records }),
};

// Profile API
export const profileApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/profiles', { params }),
  get: (id: string, tenantId?: string) =>
    api.get<ApiResponse>(`/api/profiles/${id}`, { params: tenantId ? { tenantId } : undefined }),
  create: (data: any) =>
    api.post<ApiResponse>('/api/profiles', data),
  update: (id: string, data: any, tenantId?: string) =>
    api.put<ApiResponse>(`/api/profiles/${id}`, data, { params: tenantId ? { tenantId } : undefined }),
  delete: (id: string, tenantId?: string) =>
    api.delete<ApiResponse>(`/api/profiles/${id}`, { params: tenantId ? { tenantId } : undefined }),
};

// Permission Catalog API
export const permissionApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/permissions', { params }),
  getModules: () =>
    api.get<ApiResponse>('/api/permissions/modules'),
};

// New PermissionSet API (effective permission system)
export const newPermissionSetApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/new-permission-sets', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/new-permission-sets/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/new-permission-sets', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/new-permission-sets/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/new-permission-sets/${id}`),
  assign: (id: string, userIds: string[]) =>
    api.post<ApiResponse>(`/api/new-permission-sets/${id}/assign`, { userIds }),
  unassign: (id: string, userId: string) =>
    api.delete<ApiResponse>(`/api/new-permission-sets/${id}/assign/${userId}`),
};

// User Permissions API (direct permissions + permission set assignments)
export const userPermissionApi = {
  getDirectPermissions: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions`),
  addDirectPermissions: (userId: string, permissionIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions`, { permissionIds }),
  removeDirectPermission: (userId: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/user-permissions/${userId}/direct-permissions/${permissionId}`),
  getUserPermissionSets: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permissions/${userId}/permission-sets`),
  assignPermissionSets: (userId: string, permissionSetIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permissions/${userId}/permission-sets`, { permissionSetIds }),
  unassignPermissionSet: (userId: string, permissionSetId: string) =>
    api.delete<ApiResponse>(`/api/user-permissions/${userId}/permission-sets/${permissionSetId}`),
};

// Permission Set Groups API
export const permissionSetGroupApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/permission-set-groups', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/permission-set-groups/${id}`),
  create: (data: any) =>
    api.post<ApiResponse>('/api/permission-set-groups', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/permission-set-groups/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/permission-set-groups/${id}`),
  assignPermissionSets: (groupId: string, permissionSetIds: string[]) =>
    api.post<ApiResponse>(`/api/permission-set-groups/${groupId}/permission-sets`, { permissionSetIds }),
  removePermissionSet: (groupId: string, permissionSetId: string) =>
    api.delete<ApiResponse>(`/api/permission-set-groups/${groupId}/permission-sets/${permissionSetId}`),
};

// User Permission Set Groups API
export const userPermissionSetGroupApi = {
  list: (userId: string) =>
    api.get<ApiResponse>(`/api/user-permission-set-groups/${userId}`),
  assign: (userId: string, groupIds: string[]) =>
    api.post<ApiResponse>(`/api/user-permission-set-groups/${userId}`, { groupIds }),
  unassign: (userId: string, groupId: string) =>
    api.delete<ApiResponse>(`/api/user-permission-set-groups/${userId}/${groupId}`),
};

// Effective Permissions API
export const effectivePermissionApi = {
  getMine: () =>
    api.get<ApiResponse>('/api/effective-permissions/me'),
  getUserPermissions: (userId: string) =>
    api.get<ApiResponse>(`/api/effective-permissions/user/${userId}`),
  check: (permissionName: string) =>
    api.get<ApiResponse>(`/api/effective-permissions/check/${permissionName}`),
};

// Profile Permissions API
export const profilePermissionApi = {
  getPermissions: (profileId: string) =>
    api.get<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`),
  setPermissions: (profileId: string, permissionIds: string[]) =>
    api.put<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`, { permissionIds }),
  addPermissions: (profileId: string, permissionIds: string[]) =>
    api.post<ApiResponse>(`/api/profile-permissions/${profileId}/permissions`, { permissionIds }),
  removePermission: (profileId: string, permissionId: string) =>
    api.delete<ApiResponse>(`/api/profile-permissions/${profileId}/permissions/${permissionId}`),
};

// Profile Security API
export const profileSecurityApi = {
  get: (profileId: string, tenantId?: string) =>
    api.get<ApiResponse>(`/api/profile-security/${profileId}/security`, { params: tenantId ? { tenantId } : undefined }),
  update: (profileId: string, data: any, tenantId?: string) =>
    api.put<ApiResponse>(`/api/profile-security/${profileId}/security`, data, { params: tenantId ? { tenantId } : undefined }),
};

// Company Settings API
export const companySettingsApi = {
  get: () => api.get<ApiResponse>('/api/setup/company-settings'),
  update: (data: any) => api.put<ApiResponse>('/api/setup/company-settings', data),
};

export const leadStatusSettingsApi = {
  get: () => api.get<ApiResponse>('/api/setup/lead-statuses'),
  update: (statuses: Array<{ statusId: string; label: string; enabled: boolean }>) =>
    api.put<ApiResponse>('/api/setup/lead-statuses', { statuses }),
};

// Personal Settings API
export const personalSettingsApi = {
  get: () => api.get<ApiResponse>('/api/setup/personal-settings'),
  update: (data: any) => api.put<ApiResponse>('/api/setup/personal-settings', data),
};

export default api;

// Company Management API (Super Admin)
export const companyApi = {
  list: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/super-admin/companies', { params }),
  get: (id: string) =>
    api.get<ApiResponse>(`/api/super-admin/companies/${id}`),
  statistics: (id: string, type: 'users' | 'roles' | 'leads' | 'projects', params?: { page?: number; limit?: number; search?: string }) =>
    api.get<ApiResponse>(`/api/super-admin/companies/${id}/statistics/${type}`, { params }),
  resetUserPassword: (id: string, userId: string, password: string) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/users/${userId}/password`, { password }),
  create: (data: any) =>
    api.post<ApiResponse>('/api/super-admin/companies', data),
  update: (id: string, data: any) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse>(`/api/super-admin/companies/${id}`),
  activate: (id: string) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/activate`),
  deactivate: (id: string) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/deactivate`),
  uploadLogo: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post<ApiResponse>(`/api/super-admin/companies/${id}/logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeLogo: (id: string) =>
    api.delete<ApiResponse>(`/api/super-admin/companies/${id}/logo`),
  getCapacity: (id: string) =>
    api.get<ApiResponse>(`/api/super-admin/companies/${id}/capacity`),
  updateCapacity: (id: string, data: { maxTotalUsers?: number; maxAdminUsers?: number }) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/capacity`, data),
  updatePackage: (id: string, data: { packageName?: string | null; packageStatus?: string; packageStartDate?: string | null; packageExpiryDate?: string | null; packageNotes?: string | null }) =>
    api.put<ApiResponse>(`/api/super-admin/companies/${id}/package`, data),
  impersonate: (tenantId: string, data: {
    adminUserId?: string;
    viewOnly?: boolean;
    confirmInactive?: boolean;
    password?: string;
  }) => api.post<ApiResponse>(`/api/admin/companies/${tenantId}/impersonate`, data),
  impersonationLog: (tenantId: string) =>
    api.get<ApiResponse>(`/api/admin/companies/${tenantId}/impersonation-log`),
  impersonationSettings: (tenantId: string) =>
    api.get<ApiResponse>(`/api/admin/companies/${tenantId}/impersonation-settings`),
  updateImpersonationSettings: (tenantId: string, notifyOnAccess: boolean) =>
    api.put<ApiResponse>(`/api/admin/companies/${tenantId}/impersonation-settings`, { notifyOnAccess }),
  apiKey: {
    get: (tenantId: string) =>
      api.get<ApiResponse>(`/api/admin/companies/${tenantId}/api-key`),
    reveal: (tenantId: string, password: string, purpose: 'show' | 'copy') =>
      api.post<ApiResponse & { apiKey?: string }>(`/api/admin/companies/${tenantId}/api-key/reveal`, { password, purpose }),
    generate: (tenantId: string) =>
      api.post<ApiResponse>(`/api/admin/companies/${tenantId}/api-key/generate`),
    rotate: (tenantId: string) =>
      api.post<ApiResponse>(`/api/admin/companies/${tenantId}/api-key/rotate`),
    revoke: (tenantId: string) =>
      api.post<ApiResponse>(`/api/admin/companies/${tenantId}/api-key/revoke`),
    updateScopes: (tenantId: string, allowDelete: boolean) =>
      api.patch<ApiResponse>(`/api/admin/companies/${tenantId}/api-key/scopes`, { allowDelete }),
    updateHeaderSettings: (tenantId: string, customHeaderName: string | null, acceptOnlyCustomHeader: boolean) =>
      api.patch<ApiResponse>(`/api/admin/companies/${tenantId}/api-key/header-settings`, { customHeaderName, acceptOnlyCustomHeader }),
    setupGet: (tenantId?: string) =>
      api.get<ApiResponse>('/api/setup/api-key', { params: tenantId ? { tenantId } : undefined }),
    setupRevealOnce: (tenantId?: string) =>
      api.post<ApiResponse & { apiKey?: string }>('/api/setup/api-key/reveal-once', {}, { params: tenantId ? { tenantId } : undefined }),
    setupRotate: (tenantId?: string) =>
      api.post<ApiResponse>('/api/setup/api-key/rotate', {}, { params: tenantId ? { tenantId } : undefined }),
    setupRevoke: (tenantId?: string) =>
      api.post<ApiResponse>('/api/setup/api-key/revoke', {}, { params: tenantId ? { tenantId } : undefined }),
    setupUpdateScopes: (allowDelete: boolean, tenantId?: string) =>
      api.patch<ApiResponse>('/api/setup/api-key/scopes', { allowDelete }, { params: tenantId ? { tenantId } : undefined }),
    setupUpdateHeaderSettings: (customHeaderName: string | null, acceptOnlyCustomHeader: boolean, tenantId?: string) =>
      api.patch<ApiResponse>('/api/setup/api-key/header-settings', { customHeaderName, acceptOnlyCustomHeader }, { params: tenantId ? { tenantId } : undefined }),
  },
  apiCatalog: () => api.get<ApiResponse>('/api/admin/api-reference'),
  apiBaseUrl: () => api.get<ApiResponse>('/api/admin/api-reference/base-url'),
  testApiBaseUrl: () => api.get<ApiResponse>('/api/admin/api-reference/base-url/test'),
  telephony: {
    list: (tenantId: string) => api.get<ApiResponse>(`/api/super-admin/companies/${tenantId}/telephony`),
    create: (tenantId: string, data: { name?: string; rateLimitPerMinute?: number; ipAllowlist?: string[] }) =>
      api.post<ApiResponse & { integrationKey?: string }>(`/api/super-admin/companies/${tenantId}/telephony`, data),
    rotate: (tenantId: string, integrationId: string) =>
      api.post<ApiResponse & { integrationKey?: string }>(`/api/super-admin/companies/${tenantId}/telephony/${integrationId}/rotate`),
    revoke: (tenantId: string, integrationId: string) =>
      api.post<ApiResponse>(`/api/super-admin/companies/${tenantId}/telephony/${integrationId}/revoke`),
    testLead: (tenantId: string, style: 'header' | 'url-token') =>
      api.post<ApiResponse>(`/api/super-admin/companies/${tenantId}/telephony/test-lead`, { style }),
  },
  validateApiCatalog: (data: { objectName: string; operationId: string; body: unknown }) =>
    api.post<ApiResponse>('/api/super-admin/api-catalog/validate', data),
  tryApiCatalog: (data: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: unknown;
    headerName?: string;
    sandbox?: boolean;
    objectName: string;
    operationId: string;
  }, apiKey?: string, customHeaderName?: string | null) =>
    api.post<ApiResponse>('/api/super-admin/api-catalog/try', data, {
      headers: apiKey
        ? { [customHeaderName || 'X-API-Key']: apiKey }
        : undefined,
    }),
};

export const projectLayoutsApi = {
  list: (tenantId: string, projectId: string) =>
    api.get<ApiResponse>(`/api/super-admin/project-layouts`, { params: { tenantId, projectId } }),
  all: (params: { page: number; limit: number; search?: string; tenantId?: string; projectId?: string; status?: string }) =>
    api.get<ApiResponse>(`/api/super-admin/project-layouts`, { params: { ...params, overview: true } }),
  get: (layoutId: string, tenantId: string, projectId: string) =>
    api.get<ApiResponse>(`/api/super-admin/project-layouts/${encodeURIComponent(layoutId)}`, { params: { tenantId, projectId } }),
  delete: (layoutId: string, tenantId: string, projectId: string) =>
    api.delete<ApiResponse>(`/api/super-admin/project-layouts/${encodeURIComponent(layoutId)}`, { params: { tenantId, projectId } }),
  units: (tenantId: string, projectId: string, params?: { page?: number; limit?: number; search?: string }) =>
    api.get<ApiResponse>(`/api/super-admin/project-layouts/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/units`, { params }),
  upload: (tenantId: string, projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('drawing', file);
    return api.post<ApiResponse>(
      `/api/super-admin/project-layouts/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/upload`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  drawing: (layoutId: string, tenantId: string, projectId: string) =>
    api.get<Blob>(`/api/super-admin/project-layouts/${encodeURIComponent(layoutId)}/drawing`, { params: { tenantId, projectId }, responseType: 'blob' }),
  save: (layoutId: string, tenantId: string, projectId: string, data: {
    selectedPage: number;
    finalize?: boolean;
    shapes: Array<{ id: string; kind: 'RECTANGLE' | 'POLYGON'; unitId: string | null; geometry: object }>;
  }) => api.put<ApiResponse>(`/api/super-admin/project-layouts/${encodeURIComponent(layoutId)}`, data, { params: { tenantId, projectId } }),
};

export const projectLayoutQuotationApi = {
  getForProject: (projectId: string) =>
    api.get<ApiResponse>(`/api/project-layouts/projects/${encodeURIComponent(projectId)}`),
  drawing: (projectId: string, layoutId: string) =>
    api.get<Blob>(
      `/api/project-layouts/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(layoutId)}/drawing`,
      { responseType: 'blob' },
    ),
};

export const roundRobinApi = {
  getAll: () => api.get<ApiResponse>('/api/round-robin'),
  getPool: (poolType: string) => api.get<ApiResponse>(`/api/round-robin/${poolType}`),
  addMember: (userId: string, poolType: string) => api.post<ApiResponse>('/api/round-robin', { userId, poolType }),
  removeMember: (id: string) => api.delete<ApiResponse>(`/api/round-robin/${id}`),
  getEligible: (poolType: string) => api.get<ApiResponse>(`/api/round-robin/eligible/${poolType}`),
  getConfigs: () => api.get<ApiResponse>('/api/round-robin/configs'),
  createConfig: (data: { poolType: string; name: string; description?: string; profileName: string }) => api.post<ApiResponse>('/api/round-robin/configs', data),
  deleteConfig: (id: string) =>
    api.delete<ApiResponse>(`/api/round-robin/configs/${id}`),
};

// Customize Home (Homepage layouts per profile)
export const homepageApi = {
  list: (tenantId?: string) =>
    api.get<ApiResponse>('/api/homepages', { params: tenantId ? { tenantId } : undefined }),
  assigned: () =>
    api.get<ApiResponse>('/api/homepages/assigned'),
  get: (id: string, tenantId?: string) =>
    api.get<ApiResponse>(`/api/homepages/${id}`, { params: tenantId ? { tenantId } : undefined }),
  create: (data: { name: string; description?: string; layout: Array<string | { id: string; x: number; y: number; width: number; height: number }>; profileIds: string[] }, tenantId?: string) =>
    api.post<ApiResponse>('/api/homepages', data, { params: tenantId ? { tenantId } : undefined }),
  update: (id: string, data: { name: string; description?: string; layout: Array<string | { id: string; x: number; y: number; width: number; height: number }>; profileIds: string[] }, tenantId?: string) =>
    api.put<ApiResponse>(`/api/homepages/${id}`, data, { params: tenantId ? { tenantId } : undefined }),
  updateStatus: (id: string, isActive: boolean, tenantId?: string) =>
    api.patch<ApiResponse>(`/api/homepages/${id}/status`, { isActive }, { params: tenantId ? { tenantId } : undefined }),
  delete: (id: string, tenantId?: string) =>
    api.delete<ApiResponse>(`/api/homepages/${id}`, { params: tenantId ? { tenantId } : undefined }),
};

export const rrQueueApi = {
  list: (params?: Record<string, string>) => api.get<ApiResponse>('/api/rrqueues', { params }),
  options: () => api.get<ApiResponse>('/api/rrqueues/options'),
  get: (id: string) => api.get<ApiResponse>(`/api/rrqueues/${id}`),
  create: (data: { name: string; projectId: string; active?: boolean; leadStatus?: string[]; leadSource?: string[]; projectInterested?: string[]; ownerId?: string | null }) => api.post<ApiResponse>('/api/rrqueues', data),
  update: (id: string, data: Partial<{ name: string; projectId: string; active: boolean; leadStatus: string[]; leadSource: string[]; projectInterested: string[]; ownerId: string | null }>) => api.put<ApiResponse>(`/api/rrqueues/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/api/rrqueues/${id}`),
  members: (id: string, params?: Record<string, number>) => api.get<ApiResponse>(`/api/rrqueues/${id}/members`, { params }),
  member: (id: string, memberId: string) => api.get<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`),
  addMember: (id: string, data: { userId: string; userType: 'Pre Sales' | 'Sales' | 'Post Sales' | 'Recovery' | 'Channel Partner' | 'SVC' | 'CRM'; activeMember?: boolean }) => api.post<ApiResponse>(`/api/rrqueues/${id}/members`, data),
  updateMember: (id: string, memberId: string, data: { activeMember?: boolean; userId?: string; userType?: 'Pre Sales' | 'Sales' | 'Post Sales' | 'Recovery' | 'Channel Partner' | 'SVC' | 'CRM'; isAvailable?: boolean; isWorking?: boolean; weekOff?: boolean; maxLeadCapacity?: number }) => api.put<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`, data),
  setMemberActive: (id: string, memberId: string, activeMember: boolean) => api.put<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`, { activeMember }),
  removeMember: (id: string, memberId: string) => api.delete<ApiResponse>(`/api/rrqueues/${id}/members/${memberId}`),
  history: (id: string, params?: Record<string, number>) => api.get<ApiResponse>(`/api/rrqueues/${id}/history`, { params }),
  assign: (id: string, leadId: string) => api.post<ApiResponse>(`/api/rrqueues/${id}/assign`, { leadId }),
};

// GRE (General Registration Enquiry) API
const greSessionHeaders = (sessionToken: string) => ({ 'x-gre-session': sessionToken });

export const greApi = {
  // Setup (admin)
  listForms: () => api.get<ApiResponse>('/api/gre/forms'),
  createForm: (data: { name: string; defaultProjectId: string }) =>
    api.post<ApiResponse>('/api/gre/forms', data),
  updateForm: (id: string, data: { name?: string; isActive?: boolean; defaultProjectId?: string }) =>
    api.patch<ApiResponse>(`/api/gre/forms/${id}`, data),
  deleteForm: (id: string) =>
    api.delete<ApiResponse>(`/api/gre/forms/${id}`),
  listSubmissions: (params?: Record<string, any>) =>
    api.get<ApiResponse>('/api/gre/submissions', { params }),

  // Public registration form
  getPublicForm: (token: string) =>
    publicApi.get<ApiResponse>(`/api/gre/public/${token}`),
  startPublicSession: (token: string, data: { countryCode: string; phone: string; alternatePhone?: string }) =>
    publicApi.post<ApiResponse>(`/api/gre/public/${token}/sessions`, data),
  getPublicSession: (token: string, sessionToken: string) =>
    publicApi.get<ApiResponse>(`/api/gre/public/${token}/session`, { headers: greSessionHeaders(sessionToken) }),
  submitPublicSession: (token: string, sessionToken: string, draft: any, location: { latitude: number; longitude: number; accuracy: number; capturedAt: string }) =>
    publicApi.post<ApiResponse>(`/api/gre/public/${token}/submit`, { draft, location }, { headers: greSessionHeaders(sessionToken) }),
};