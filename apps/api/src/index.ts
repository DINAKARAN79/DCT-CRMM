import './loadEnv';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { authRoutes as authRouter } from './routes/auth';
import { leadRoutes as leadRouter } from './routes/leads';
import enquiryRouter from './routes/enquiries';
import siteVisitRouter from './routes/siteVisits';
import quotationRouter from './routes/quotations';
import bookingRouter from './routes/bookings';
import receiptRouter from './routes/receipts';
import projectRouter from './routes/projects';
import unitRouter from './routes/units';
import { followUpRoutes as followUpRouter } from './routes/followUps';
import { activityRoutes as activityRouter } from './routes/activities';
import { userRoutes as userRouter } from './routes/users';
import { roleRoutes as roleRouter } from './routes/roles';
import { profileRoutes as profileRouter } from './routes/profiles';
import reportRouter, { reportFolderRouter, reportMetadataRouter } from './routes/reports';
import { dashboardRoutes as dashboardRouter } from './routes/dashboards';
import { homepageRoutes as homepageRouter } from './routes/homepages';
import { searchRoutes as searchRouter } from './routes/search';
import { analyticsRoutes as analyticsRouter } from './routes/analytics';
import { aiRoutes as aiRouter } from './routes/ai';
import { adminRoutes as adminRouter } from './routes/admin';
import { auditRoutes as auditRouter } from './routes/audit';
import { notificationRoutes as notificationRouter } from './routes/notifications';
import { objectDefinitionRoutes as objectDefinitionRouter } from './routes/objectDefinitions';
import { fieldDefinitionRoutes as fieldDefinitionRouter } from './routes/fieldDefinitions';
import { picklistValueRoutes as picklistValueRouter } from './routes/picklistValues';
import { pageLayoutRoutes as pageLayoutRouter } from './routes/pageLayouts';
import { pageLayoutRestRoutes } from './routes/pageLayoutRest';
import { layoutAssignmentRoutes } from './routes/layoutAssignments';
import { objectPermissionRoutes as objectPermissionRouter } from './routes/objectPermissions';
import { fieldPermissionRoutes as fieldPermissionRouter } from './routes/fieldPermissions';
import { dynamicCrudRoutes as dynamicCrudRouter } from './routes/dynamicCrud';
import { permissionCatalogRoutes as permissionCatalogRouter } from './routes/permissionCatalog';
import { newPermissionSetRoutes as newPermissionSetRouter } from './routes/permissionSets';
import { userPermissionRoutes as userPermissionRouter } from './routes/userPermissions';
import { effectivePermissionRoutes as effectivePermissionRouter } from './routes/effectivePermissions';
import { profilePermissionRoutes as profilePermissionRouter } from './routes/profilePermissions';
import { permissionSetGroupRoutes, userPermissionSetGroupRoutes } from './routes/permissionSetGroups';
import { dataAdministrationRoutes as dataAdministrationRouter } from './routes/dataAdministration';
import { mountExternalApi } from './middleware/requireApiKey';
import { companyRoutes as companyRouter } from './routes/companies';
import companyApiKeyRouter, { setupCompanyApiKeyRouter } from './routes/companyApiKeys';
import companyApiCatalogRouter from './routes/companyApiCatalog';
import companyTelephonyRouter from './routes/companyTelephony';
import telephonyWebhookRouter from './routes/telephonyWebhook';
import telephonyClickToCallRouter from './routes/telephonyClickToCall';
import setupTelephonyRouter from './routes/setup/telephony';
import activeUsersRouter, { presenceCountsRouter } from './routes/activeUsers';
import { sweepIdleSessions } from './services/userPresence';
import { greRoutes as greRouter } from './routes/gre';
import listViewRouter from './routes/listViews';
import setupUsersRouter from './routes/setup/users';
import setupCompanySettingsRouter from './routes/setup/company-settings';
import setupLeadStatusesRouter from './routes/setup/lead-statuses';
import setupPersonalSettingsRouter from './routes/setup/personal-settings';
import profileSecurityRouter from './routes/profileSecurity';
import rrQueueRouter from './routes/rrQueues';
import notesRouter from './routes/notes';
import callDetailsRouter from './routes/callDetails';
import cpPortalRouter from './routes/cpPortal';
import cpPortalAccountsRouter from './routes/cpPortalAccounts';
import projectLayoutsRouter from './routes/projectLayouts';
import projectLayoutQuotationRouter from './routes/projectLayoutQuotation';
import impersonationRouter, { companyImpersonationRouter } from './routes/impersonation';
import { installImpersonationAuditStamp } from './services/impersonationContext';
import { normalizeOverdueScheduledItems } from './services/leadWorkflowExtras';
import { startSiteVisitMissedScheduler } from './services/siteVisitMissedJob';
import { assertApiKeyEncryptionConfigured } from './services/apiKeys';
import superAdminReportingRouter from './routes/superAdminReporting';

export const createApp = () => {
  installImpersonationAuditStamp();
  const app = express();
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', trustProxy === '1' || trustProxy === 'true' ? 1 : trustProxy);
  }

  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  app.use('/api/data-administration/import', express.json({ limit: '100mb' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  morgan.token('safe-url', (req) => {
    const request = req as express.Request;
    const url = request.originalUrl || request.url || '';
    return url
      .replace(/(\/api\/integrations\/telephony\/)[^/?]+/g, '$1[redacted]')
      .replace(/([?&](?:apiKey|api_key|key|token|access_token|x-api-key)=)[^&]*/gi, '$1[redacted]');
  });
  app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'));

  const health = (_req: express.Request, res: express.Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  };
  app.get('/api/health', health);

  app.use('/api/auth', authRouter);
  app.use('/api/admin/companies/:tenantId', companyImpersonationRouter);
  app.use('/api/impersonation', impersonationRouter);
  app.use('/api/cp-portal', cpPortalRouter);
  app.use('/api/cp-portal-accounts', cpPortalAccountsRouter);
  app.use('/api/list-views', listViewRouter);
  mountExternalApi(app, '/api/leads', leadRouter);
  mountExternalApi(app, '/api/enquiries', enquiryRouter);
  mountExternalApi(app, '/api/site-visits', siteVisitRouter);
  mountExternalApi(app, '/api/quotations', quotationRouter);
  mountExternalApi(app, '/api/bookings', bookingRouter);
  mountExternalApi(app, '/api/receipts', receiptRouter);
  mountExternalApi(app, '/api/projects', projectRouter);
  mountExternalApi(app, '/api/units', unitRouter);
  mountExternalApi(app, '/api/follow-ups', followUpRouter);
  mountExternalApi(app, '/api/activities', activityRouter);
  app.use('/api/users', userRouter);
  app.use('/api/setup/users', setupUsersRouter);
  app.use('/api/setup/company-settings', setupCompanySettingsRouter);
  app.use('/api/setup/lead-statuses', setupLeadStatusesRouter);
  app.use('/api/setup/personal-settings', setupPersonalSettingsRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/profiles', profileRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/report-folders', reportFolderRouter);
  app.use('/api/report-metadata', reportMetadataRouter);
  app.use('/api/dashboards', dashboardRouter);
  app.use('/api/homepages', homepageRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', activeUsersRouter);
  app.use('/api/integrations/telephony', telephonyWebhookRouter);
  app.use('/api/telephony', telephonyClickToCallRouter);
  app.use('/api/setup/telephony', setupTelephonyRouter);
  app.use('/api/admin/companies/:tenantId/api-key', companyApiKeyRouter);
  app.use('/api/setup', setupCompanyApiKeyRouter);
  app.use('/api/super-admin/companies/:tenantId/telephony', companyTelephonyRouter);
  app.use('/api/super-admin/api-catalog', companyApiCatalogRouter);
  app.use('/api/admin/api-reference', companyApiCatalogRouter);
  app.use('/api/super-admin/presence-counts', presenceCountsRouter);
  app.use('/api/super-admin/reporting', superAdminReportingRouter);
  app.use('/api/platform', superAdminReportingRouter);
  app.use('/api/super-admin', companyRouter);
  app.use('/api/super-admin/project-layouts', projectLayoutsRouter);
  app.use('/api/project-layouts', projectLayoutQuotationRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/objects', objectDefinitionRouter);
  app.use('/api/setup/modules', objectDefinitionRouter);
  app.use('/api/fields', fieldDefinitionRouter);
  app.use('/api/setup/fields', fieldDefinitionRouter);
  app.use('/api/picklist-values', picklistValueRouter);
  app.use('/api/layouts', pageLayoutRouter);
  app.use('/api/setup/layouts', pageLayoutRouter);
  app.use('/api/page-layouts', pageLayoutRestRoutes);
  app.use('/api/layout-assignments', layoutAssignmentRoutes);
  app.use('/api/object-permissions', objectPermissionRouter);
  app.use('/api/field-permissions', fieldPermissionRouter);
  mountExternalApi(app, '/api/records', dynamicCrudRouter);
  app.use('/api/permissions', permissionCatalogRouter);
  app.use('/api/new-permission-sets', newPermissionSetRouter);
  app.use('/api/user-permissions', userPermissionRouter);
  app.use('/api/permission-set-groups', permissionSetGroupRoutes);
  app.use('/api/user-permission-set-groups', userPermissionSetGroupRoutes);
  app.use('/api/effective-permissions', effectivePermissionRouter);
  app.use('/api/profile-permissions', profilePermissionRouter);
  app.use('/api/data-administration', dataAdministrationRouter);
  app.use('/api/profile-security', profileSecurityRouter);
  app.use('/api/rrqueues', rrQueueRouter);
  mountExternalApi(app, '/api/notes', notesRouter);
  mountExternalApi(app, '/api/call-details', callDetailsRouter);
  app.use('/api/gre', greRouter);

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void req;
    void next;
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message });
    }
  });

  return app;
};

const app = createApp();

if (require.main === module) {
  try {
    assertApiKeyEncryptionConfigured();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'API_KEY_ENCRYPTION_SECRET is invalid.');
    process.exitCode = 1;
    throw error;
  }
  const PORT = process.env.PORT || 3001;
  const normalizeOverdueItems = () => {
    void normalizeOverdueScheduledItems().catch((error) => {
      console.error('Normalize overdue scheduled items error:', error);
    });
  };
  normalizeOverdueItems();
  const overdueItemsTimer = setInterval(normalizeOverdueItems, 60_000);
  overdueItemsTimer.unref();
  const sweepPresence = () => {
    void sweepIdleSessions().catch((error) => {
      console.error('Presence sweep error', error instanceof Error ? error.name : 'error');
    });
  };
  sweepPresence();
  const presenceTimer = setInterval(sweepPresence, 30_000);
  presenceTimer.unref();
  startSiteVisitMissedScheduler();
  app.listen(PORT, () => {
    console.log(`DCT CRM API server running on port ${PORT}`);
  });
}

export default app;