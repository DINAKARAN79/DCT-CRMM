import { z } from 'zod';
import {
  APARTMENT_BLOCKS,
  UNIT_PROPERTY_TYPES,
  activitySchema,
  followUpSchema,
  leadCreateSchema,
  leadUpdateSchema,
  resolveUnitLocation,
} from '@dct-crm/shared';
import { bookingSchema } from '../routes/bookings';
import { callDetailSchema, callDetailUpdateSchema } from '../routes/callDetails';
import { enquiryUpdateSchema } from '../routes/enquiries';
import { projectSchema, updateProjectSchema } from '../routes/projects';
import { siteVisitSchema, updateSiteVisitSchema } from '../routes/siteVisits';
import { unitSchema, updateUnitSchema } from '../routes/units';
import { futureFollowUpError } from './followUpService';
import {
  CatalogField,
  FieldHints,
  applyOverrides,
  describeFields,
  flattenFields,
  fullestObject,
  minimalObject,
  requiredPaths,
} from './zodCatalog';

type ZodTypeAny = z.ZodTypeAny;
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ErrorStyle = 'lead' | 'details' | 'message';

export interface ApiParamDoc {
  name: string;
  in: 'path' | 'query' | 'header';
  type: string;
  required: boolean;
  description: string;
}

export interface ApiErrorDoc {
  status: number;
  body: Record<string, unknown>;
}

export interface ApiOperationDoc {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  scope: string | null;
  authNote: string;
  params: ApiParamDoc[];
  headers: ApiParamDoc[];
  updateMode?: 'partial' | 'replace';
  updateNote?: string;
  immutableAfterCreate?: string[];
  valueDifferences?: Array<{ field: string; create: string[]; update: string[] }>;
  body?: {
    fields: CatalogField[];
    requiredExample: Record<string, unknown>;
    fullExample: Record<string, unknown>;
  };
  successStatus: number;
  successExample: Record<string, unknown>;
  errors: ApiErrorDoc[];
  readOnlyResponseFields: string[];
  queryExample: string | null;
}

export interface ApiTopicDoc {
  objectName: string;
  label: string;
  description: string;
  operations: ApiOperationDoc[];
}

export interface ApiCatalog {
  baseUrl: string;
  topics: ApiTopicDoc[];
  schemaObjectNames: string[];
  openapi: Record<string, unknown>;
}

export interface CatalogCheck {
  objectName: string;
  schema: ZodTypeAny;
  requiredExample: Record<string, unknown>;
  requiredFieldPaths: string[];
  afterParse?: (body: Record<string, unknown>) => string | null;
}

const FAKE_ID = 'cmexample000000000000000001';
const READ_ONLY_RESPONSE = ['id', 'tenantId', 'createdAt', 'updatedAt', 'createdById', 'updatedById'];

const unitHints: FieldHints = {
  type: {
    sample: 'Plot',
    enumValues: [...UNIT_PROPERTY_TYPES],
    description: 'Apartment, Plot, or Villa. Apartment requires block and floor.',
  },
  block: {
    sample: 'Block 1',
    requirement: 'conditional',
    condition: 'Required when type is Apartment, or when type is Villa and the project type includes block or floor. Allowed: Block 1, Block 2, Block 3.',
    enumValues: [...APARTMENT_BLOCKS],
    description: 'Apartment block.',
  },
  floor: {
    sample: 2,
    requirement: 'conditional',
    condition: 'Required when type is Apartment. Floors 1-3 are allowed for Block 1, Block 2, and Block 3.',
    description: 'Apartment floor.',
  },
  number: { sample: 'A-101', description: 'Unit number shown to users.' },
  projectId: { sample: 'cmexampleproject000000000001', description: 'Project this unit belongs to.' },
  price: { sample: 3200000, description: 'Unit price.' },
  registrationDate: { sample: '2026-11-15', format: 'date', description: 'Registration date, YYYY-MM-DD.' },
  status: {
    enumValues: ['AVAILABLE', 'HOLD', 'SOLD', 'BLOCKED'],
    sample: 'AVAILABLE',
    description: 'Inventory status. Create accepts AVAILABLE, HOLD, SOLD, and BLOCKED.',
  },
};

const unitUpdateHints: FieldHints = {
  ...unitHints,
  status: {
    enumValues: ['AVAILABLE', 'RESERVED', 'BOOKED', 'HOLD', 'SOLD', 'BLOCKED'],
    sample: 'AVAILABLE',
    description: 'Update also accepts RESERVED and BOOKED.',
  },
};

const unitFullOverrides = {
  type: 'Apartment',
  block: 'Block 1',
  floor: 2,
  price: 7500000,
  area: 1200,
  status: 'AVAILABLE',
  buildupArea: 980,
  allowedDiscount: '50000',
  minimumBookingAmount: 100000,
};

function headers(scope: string | null, withBody: boolean): ApiParamDoc[] {
  const rows: ApiParamDoc[] = [
    {
      name: 'Authorization',
      in: 'header',
      type: 'string',
      required: true,
      description: scope
        ? 'Bearer <API key>, or X-API-Key. tenantId in the URL must match this key’s company.'
        : 'Bearer session token. A company API key cannot call this path.',
    },
  ];
  if (withBody) {
    rows.push({
      name: 'Content-Type',
      in: 'header',
      type: 'string',
      required: true,
      description: 'application/json',
    });
  }
  return rows;
}

function idParam(name = 'id', description = 'Record id'): ApiParamDoc {
  return { name, in: 'path', type: 'string', required: true, description };
}

function query(name: string, type: string, description: string, required = false): ApiParamDoc {
  return { name, in: 'query', type, required, description };
}

function queryExampleFrom(params: ApiParamDoc[]) {
  const names = new Set(params.filter((param) => param.in === 'query').map((param) => param.name));
  const parts: string[] = [];
  if (names.has('page')) parts.push('page=1');
  if (names.has('limit')) parts.push('limit=20');
  if (names.has('status') && params.some((param) => param.name === 'status' && param.description.includes('INCOMING'))) {
    parts.push('status=INCOMING');
  }
  if (params.some((param) => param.in === 'query' && param.name === 'leadId' && param.required)) {
    parts.push('leadId=cmexamplelead000000000001');
  }
  return parts.length ? `?${parts.join('&')}` : null;
}

const listQueries = [
  query('page', 'number', 'Page number. Defaults to 1.'),
  query('limit', 'number', 'Page size.'),
  query('search', 'string', 'Case-insensitive text search.'),
  query('sortBy', 'string', 'Field used for sorting.'),
  query('sortOrder', 'string', 'asc or desc.'),
];

function validationBody(style: ErrorStyle, schema: ZodTypeAny) {
  const parsed = schema.safeParse({});
  const issues = parsed.success ? [] : parsed.error.issues;
  const issue = issues[0];
  if (!issue) return { success: false, error: 'Validation failed' };
  if (style === 'lead') {
    return {
      success: false,
      error: issue.message,
      fieldErrors: issues.map((item) => ({ field: item.path.join('.'), message: item.message })),
    };
  }
  if (style === 'details') {
    return { success: false, error: 'Validation failed', details: parsed.success ? [] : parsed.error.errors };
  }
  return { success: false, error: issue.message };
}

function standardErrors(options: {
  style: ErrorStyle;
  schema?: ZodTypeAny;
  scope: string | null;
  writeScope?: string | null;
  notFound?: string;
  conflict?: string;
  includeNotFound?: boolean;
  includeConflict?: boolean;
}): ApiErrorDoc[] {
  const errors: ApiErrorDoc[] = [];
  if (options.schema) errors.push({ status: 400, body: validationBody(options.style, options.schema) });
  errors.push({ status: 401, body: { success: false, error: 'Invalid or revoked API key' } });
  const deniedScope = options.writeScope || options.scope;
  errors.push({
    status: 403,
    body: {
      success: false,
      error: deniedScope ? `API key is missing the ${deniedScope} scope` : 'This API key cannot access this endpoint',
    },
  });
  if (options.includeNotFound && options.notFound) {
    errors.push({ status: 404, body: { success: false, error: options.notFound } });
  }
  if (options.includeConflict && options.conflict) {
    errors.push({ status: 409, body: { success: false, error: options.conflict } });
  }
  errors.push({ status: 429, body: { success: false, error: 'API key rate limit exceeded' } });
  return errors;
}

function successRecord(body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      id: FAKE_ID,
      ...extra,
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function listSuccess(paginated: boolean) {
  return paginated
    ? { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }
    : { success: true, data: [] };
}

function partialExample(schema: ZodTypeAny, hints?: FieldHints) {
  const full = fullestObject(schema, hints);
  const preferred = ['lastName', 'name', 'title', 'subject', 'number', 'notes', 'source', 'status'].find((key) => key in full);
  const key = preferred || Object.keys(full)[0];
  return key ? { [key]: full[key] } : {};
}

function valueDifferences(createFields: CatalogField[], updateFields: CatalogField[]) {
  const updateByName = new Map(updateFields.map((field) => [field.name, field]));
  return createFields.flatMap((field) => {
    const update = updateByName.get(field.name);
    if (!field.enumValues || !update?.enumValues) return [];
    const same = field.enumValues.join('|') === update.enumValues.join('|');
    if (same) return [];
    return [{ field: field.name, create: field.enumValues, update: update.enumValues }];
  });
}

interface WriteSpec {
  objectName: string;
  label: string;
  description: string;
  collectionPath: string;
  itemPath?: string;
  createPath?: string;
  updatePath?: string;
  deletePath?: string;
  scopeRead: string | null;
  scopeWrite: string | null;
  createSchema?: ZodTypeAny;
  updateSchema?: ZodTypeAny;
  hints?: FieldHints;
  updateHints?: FieldHints;
  fullOverrides?: Record<string, unknown>;
  errorStyle: ErrorStyle;
  notFound: string;
  conflict?: string;
  listParams?: ApiParamDoc[];
  itemParam?: ApiParamDoc;
  paginated?: boolean;
  readOnlyExtra?: string[];
  who: string;
  afterParse?: (body: Record<string, unknown>) => string | null;
  immutableAfterCreate?: string[];
  requiredOmit?: string[];
  updateExample?: Record<string, unknown>;
}

function buildTopic(spec: WriteSpec): { topic: ApiTopicDoc; check?: CatalogCheck } {
  const createFields = spec.createSchema ? describeFields(spec.createSchema, spec.hints) : [];
  const updateSchema = spec.updateSchema;
  const updateFields = updateSchema ? describeFields(updateSchema, spec.updateHints || spec.hints) : [];
  const schemaRequiredExample = spec.createSchema ? applyOverrides(minimalObject(spec.createSchema, spec.hints), undefined) : {};
  const requiredExample = { ...schemaRequiredExample };
  for (const key of spec.requiredOmit || []) delete requiredExample[key];
  const fullExample = spec.createSchema
    ? applyOverrides(fullestObject(spec.createSchema, spec.hints), spec.fullOverrides)
    : {};
  if (spec.createSchema && spec.fullOverrides && !spec.createSchema.safeParse(fullExample).success) {
    Object.assign(fullExample, minimalObject(spec.createSchema, spec.hints));
  }
  const updateIsPartial = Boolean(updateSchema && updateFields.every((field) => field.requirement !== 'required'));
  const updateRequired = spec.updateExample
    ? spec.updateExample
    : updateSchema
      ? (updateIsPartial ? partialExample(updateSchema, spec.updateHints || spec.hints) : minimalObject(updateSchema, spec.updateHints || spec.hints))
      : {};
  const updateFull = updateSchema ? fullestObject(updateSchema, spec.updateHints || spec.hints) : {};
  const differences = valueDifferences(createFields, updateFields);
  const readOnly = [...READ_ONLY_RESPONSE, ...(spec.readOnlyExtra || [])];
  const itemParam = spec.itemParam || idParam();
  const operations: Array<Omit<ApiOperationDoc, 'queryExample'>> = [];

  operations.push({
    id: 'get-list',
    method: 'GET',
    path: spec.collectionPath,
    summary: `List ${spec.label.toLowerCase()} records`,
    description: `Returns ${spec.label.toLowerCase()} records for the company identified by the API key. ${spec.who}`,
    scope: spec.scopeRead,
    authNote: spec.scopeRead ? `Requires ${spec.scopeRead}.` : 'Requires a signed-in session. Company API keys are rejected.',
    params: spec.listParams || listQueries,
    headers: headers(spec.scopeRead, false),
    successStatus: 200,
    successExample: listSuccess(spec.paginated !== false && spec.collectionPath.split('/').length <= 3),
    errors: standardErrors({ style: spec.errorStyle, scope: spec.scopeRead }),
    readOnlyResponseFields: readOnly,
  });

  if (spec.itemPath) {
    operations.push({
      id: 'get-one',
      method: 'GET',
      path: spec.itemPath,
      summary: `Get one ${spec.label.toLowerCase()}`,
      description: `Returns a single ${spec.label.toLowerCase()} in this company. ${spec.who}`,
      scope: spec.scopeRead,
      authNote: spec.scopeRead ? `Requires ${spec.scopeRead}.` : 'Requires a signed-in session. Company API keys are rejected.',
      params: [itemParam],
      headers: headers(spec.scopeRead, false),
      successStatus: 200,
      successExample: successRecord({}, { [spec.readOnlyExtra?.[0] || 'recordNumber']: 'EXAMPLE-0001' }),
      errors: standardErrors({
        style: spec.errorStyle,
        scope: spec.scopeRead,
        notFound: spec.notFound,
        includeNotFound: true,
      }),
      readOnlyResponseFields: readOnly,
    });
  }

  if (spec.createSchema && spec.createPath) {
    operations.push({
      id: 'post-create',
      method: 'POST',
      path: spec.createPath,
      summary: `Create ${spec.label.toLowerCase()}`,
      description: `Creates a ${spec.label.toLowerCase()}. ${spec.who} Server-generated fields are returned and are not accepted in the body.`,
      scope: spec.scopeWrite,
      authNote: spec.scopeWrite ? `Requires ${spec.scopeWrite}.` : 'Requires a signed-in session. Company API keys are rejected.',
      params: spec.createPath.includes(':') ? pathParams(spec.createPath) : [],
      headers: headers(spec.scopeWrite, true),
      body: {
        fields: flattenFields(createFields),
        requiredExample,
        fullExample,
      },
      successStatus: 201,
      successExample: successRecord(schemaRequiredExample, Object.fromEntries((spec.readOnlyExtra || []).map((field) => [field, 'EXAMPLE-0001']))),
      errors: standardErrors({
        style: spec.errorStyle,
        schema: spec.createSchema,
        scope: spec.scopeRead,
        writeScope: spec.scopeWrite,
        conflict: spec.conflict,
        includeConflict: Boolean(spec.conflict),
      }),
      readOnlyResponseFields: readOnly,
    });
  }

  if (updateSchema && spec.updatePath) {
    operations.push({
      id: 'put-update',
      method: 'PUT',
      path: spec.updatePath,
      summary: `Update ${spec.label.toLowerCase()}`,
      description: updateIsPartial
        ? `Partial update. Send only the fields you want to change. ${spec.who}`
        : `Replaces the writable fields. ${spec.who}`,
      scope: spec.scopeWrite,
      authNote: spec.scopeWrite ? `Requires ${spec.scopeWrite}.` : 'Requires a signed-in session. Company API keys are rejected.',
      params: [itemParam],
      headers: headers(spec.scopeWrite, true),
      updateMode: updateIsPartial ? 'partial' : 'replace',
      updateNote: updateIsPartial ? 'Send only the fields you want to change.' : 'Send every required field. This replaces the writable record.',
      immutableAfterCreate: spec.immutableAfterCreate,
      valueDifferences: differences,
      body: {
        fields: flattenFields(updateFields),
        requiredExample: updateRequired,
        fullExample: updateFull,
      },
      successStatus: 200,
      successExample: successRecord(updateRequired),
      errors: standardErrors({
        style: spec.errorStyle,
        schema: updateSchema,
        scope: spec.scopeRead,
        writeScope: spec.scopeWrite,
        notFound: spec.notFound,
        includeNotFound: true,
      }),
      readOnlyResponseFields: readOnly,
    });
  }

  if (spec.deletePath) {
    operations.push({
      id: 'delete',
      method: 'DELETE',
      path: spec.deletePath,
      summary: `Delete ${spec.label.toLowerCase()}`,
      description: `Deletes one ${spec.label.toLowerCase()} in this company. ${spec.who}`,
      scope: spec.scopeWrite,
      authNote: spec.scopeWrite ? `Requires ${spec.scopeWrite}.` : 'Requires a signed-in session. Company API keys are rejected.',
      params: [itemParam],
      headers: headers(spec.scopeWrite, false),
      successStatus: 200,
      successExample: { success: true },
      errors: standardErrors({
        style: spec.errorStyle,
        scope: spec.scopeRead,
        writeScope: spec.scopeWrite,
        notFound: spec.notFound,
        includeNotFound: true,
      }),
      readOnlyResponseFields: [],
    });
  }

  const tenantParam = query(
    'tenantId',
    'string',
    'Selected company id. It must match the API key or the signed-in company. It does not authenticate the caller.',
    true,
  );
  const documented = operations.map((operation) => {
    const params = operation.params.some((param) => param.name === 'tenantId')
      ? operation.params
      : [...operation.params, tenantParam];
    return {
      ...operation,
      params,
      queryExample: operation.method === 'GET' ? queryExampleFrom(params) : null,
    };
  });

  const check = spec.createSchema
    ? {
      objectName: spec.objectName,
      schema: spec.createSchema,
      requiredExample: schemaRequiredExample,
      requiredFieldPaths: requiredPaths(createFields),
      afterParse: spec.afterParse,
    }
    : updateSchema
      ? {
        objectName: spec.objectName,
        schema: updateSchema,
        requiredExample: updateRequired,
        requiredFieldPaths: requiredPaths(updateFields),
      }
      : undefined;

  return {
    topic: {
      objectName: spec.objectName,
      label: spec.label,
      description: spec.description,
      operations: documented,
    },
    check,
  };
}

function pathParams(path: string): ApiParamDoc[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => idParam(match[1], humanParam(match[1])));
}

function humanParam(name: string) {
  return name.replace(/Id$/, ' id').replace(/([a-z])([A-Z])/g, '$1 $2');
}

const built = [
  buildTopic({
    objectName: 'Lead',
    label: 'Lead',
    description: 'Create and manage leads for this company.',
    collectionPath: '/api/leads',
    itemPath: '/api/leads/:id',
    createPath: '/api/leads',
    updatePath: '/api/leads/:id',
    deletePath: '/api/leads/:id',
    scopeRead: 'leads:read',
    scopeWrite: 'leads:write',
    createSchema: leadCreateSchema,
    updateSchema: leadUpdateSchema,
    errorStyle: 'lead',
    notFound: 'Lead not found',
    conflict: 'Phone number already exists for another lead.',
    who: 'A key with the lead scope can call it. If source is omitted, the server stores OTHER.',
    hints: {
      lastName: { sample: 'Kumar', description: 'Last name.' },
      company: { sample: 'Test Co', description: 'Company name.' },
      phone: { sample: '+919000000000', description: 'Phone number.' },
    },
    requiredOmit: ['source'],
    updateExample: { status: 'PROSPECT' },
    listParams: [
      ...listQueries,
      query('status', 'string', 'Lead status value, such as NEW or INCOMING.'),
      query('source', 'string', 'Lead source.'),
      query('ownerId', 'string', 'Filter by owner id.'),
      query('from', 'string', 'Created on or after this date (YYYY-MM-DD).'),
      query('to', 'string', 'Created on or before this date (YYYY-MM-DD).'),
    ],
    readOnlyExtra: ['leadNumber'],
    paginated: true,
  }),
  buildTopic({
    objectName: 'CallDetail',
    label: 'Call Details',
    description: 'Log inbound and outbound calls against a lead.',
    collectionPath: '/api/call-details',
    itemPath: '/api/call-details/:id',
    createPath: '/api/call-details',
    updatePath: '/api/call-details/:id',
    deletePath: '/api/call-details/:id',
    scopeRead: 'call-details:write',
    scopeWrite: 'call-details:write',
    createSchema: callDetailSchema,
    updateSchema: callDetailUpdateSchema,
    errorStyle: 'message',
    notFound: 'Call detail not found',
    who: 'Every call-detail method, including GET, requires call-details:write.',
    listParams: [query('leadId', 'string', 'Lead whose calls are returned.', true)],
    paginated: false,
    immutableAfterCreate: ['leadId'],
    hints: {
      startAt: { sample: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), description: 'Call start, ISO date-time with a timezone offset.' },
      endAt: { sample: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(), description: 'Call end. Must be after startAt.' },
    },
  }),
  buildTopic({
    objectName: 'FollowUp',
    label: 'Task / Follow-up',
    description: 'Schedule and update follow-ups. Task records use this Follow-up route.',
    collectionPath: '/api/follow-ups',
    itemPath: '/api/follow-ups/:id',
    createPath: '/api/follow-ups',
    updatePath: '/api/follow-ups/:id',
    deletePath: '/api/follow-ups/:id',
    scopeRead: 'follow-ups:read',
    scopeWrite: 'follow-ups:write',
    createSchema: followUpSchema,
    updateSchema: followUpSchema.partial(),
    errorStyle: 'message',
    notFound: 'Follow-up not found',
    who: 'A key with the follow-up scope can call it. The due date must be in the future unless the follow-up is cancelled.',
    listParams: [
      ...listQueries,
      query('status', 'string', 'SCHEDULED, COMPLETED, MISSED, CANCELLED, or OPEN.'),
      query('leadId', 'string', 'Filter by lead id.'),
      query('ownerId', 'string', 'Filter by owner id.'),
      query('startDate', 'string', 'Due on or after this date.'),
      query('endDate', 'string', 'Due on or before this date.'),
    ],
    readOnlyExtra: ['followUpNumber'],
    afterParse: (body) => (typeof body.dueDate === 'string' ? futureFollowUpError(body.dueDate) : 'Follow-up date and time are invalid.'),
    hints: {
      dueDate: { sample: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), description: 'When the follow-up is due. Must be a future date and time.' },
      title: { sample: 'Example follow-up', description: 'Short title.' },
      description: { sample: 'Example note', description: 'What the follow-up is about.' },
    },
  }),
  buildTopic({
    objectName: 'SiteVisit',
    label: 'Site Visit',
    description: 'Schedule and update site visits.',
    collectionPath: '/api/site-visits',
    itemPath: '/api/site-visits/:id',
    createPath: '/api/site-visits',
    updatePath: '/api/site-visits/:id',
    deletePath: '/api/site-visits/:id',
    scopeRead: 'site-visits:read',
    scopeWrite: 'site-visits:write',
    createSchema: siteVisitSchema,
    updateSchema: updateSiteVisitSchema,
    errorStyle: 'message',
    notFound: 'Site visit not found',
    who: 'A key with the site-visit scope can call it.',
    listParams: [
      ...listQueries,
      query('status', 'string', 'SCHEDULED, COMPLETED, or CANCELLED.'),
      query('leadId', 'string', 'Filter by lead id.'),
      query('projectId', 'string', 'Filter by project id.'),
      query('assigneeId', 'string', 'Filter by assignee id.'),
      query('startDate', 'string', 'Scheduled on or after this date.'),
      query('endDate', 'string', 'Scheduled on or before this date.'),
    ],
    readOnlyExtra: ['siteVisitNumber'],
    hints: {
      scheduledAt: { sample: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), description: 'Visit date and time, ISO date-time.' },
      notes: { sample: 'Example note', description: 'Reason or note for the visit.' },
    },
  }),
  buildTopic({
    objectName: 'Unit',
    label: 'Unit',
    description: 'Inventory units inside a project.',
    collectionPath: '/api/units',
    itemPath: '/api/units/:id',
    createPath: '/api/units',
    updatePath: '/api/units/:id',
    deletePath: '/api/units/:id',
    scopeRead: null,
    scopeWrite: null,
    createSchema: unitSchema,
    updateSchema: updateUnitSchema,
    hints: unitHints,
    updateHints: unitUpdateHints,
    fullOverrides: unitFullOverrides,
    errorStyle: 'details',
    notFound: 'Unit not found',
    conflict: 'Unit number already exists in this location',
    who: 'Requires a signed-in user who can create or edit units. A company API key cannot call this path.',
    listParams: [
      ...listQueries,
      query('projectId', 'string', 'Filter by project id.'),
      query('type', 'string', 'Apartment, Plot, or Villa.'),
      query('status', 'string', 'Inventory status.'),
      query('minPrice', 'number', 'Minimum price.'),
      query('maxPrice', 'number', 'Maximum price.'),
    ],
    readOnlyExtra: ['unitCode'],
    afterParse: (body) => {
      const location = resolveUnitLocation({
        type: String(body.type || ''),
        block: typeof body.block === 'string' ? body.block : null,
        floor: typeof body.floor === 'number' ? body.floor : null,
      });
      return location.ok ? null : location.error;
    },
  }),
  buildTopic({
    objectName: 'Project',
    label: 'Project',
    description: 'Projects that own units and site visits.',
    collectionPath: '/api/projects',
    itemPath: '/api/projects/:id',
    createPath: '/api/projects',
    updatePath: '/api/projects/:id',
    deletePath: '/api/projects/:id',
    scopeRead: null,
    scopeWrite: null,
    createSchema: projectSchema,
    updateSchema: updateProjectSchema,
    errorStyle: 'details',
    notFound: 'Project not found',
    who: 'Requires a signed-in user who can manage projects. A company API key cannot call this path.',
    listParams: [
      ...listQueries,
      query('isActive', 'boolean', 'true or false.'),
    ],
    hints: {
      name: { sample: 'Example Project', description: 'Project name.' },
    },
    fullOverrides: { latitude: 12.9716, longitude: 77.5946 },
  }),
  buildTopic({
    objectName: 'Booking',
    label: 'Booking',
    description: 'Bookings created from a confirmed quotation.',
    collectionPath: '/api/bookings',
    itemPath: '/api/bookings/:bookingId',
    createPath: '/api/bookings/lead/:leadId/quotation/:quotationId',
    scopeRead: null,
    scopeWrite: null,
    createSchema: bookingSchema,
    errorStyle: 'message',
    notFound: 'Booking not found',
    conflict: 'This quotation or unit has already been booked',
    who: 'Requires an admin or CRM session. There is no PUT or DELETE for the booking record. A company API key cannot call this path.',
    listParams: [],
    itemParam: idParam('bookingId', 'Booking id'),
    paginated: false,
    readOnlyExtra: ['bookingNumber'],
  }),
  buildTopic({
    objectName: 'Activity',
    label: 'Activity',
    description: 'Calls, meetings, notes, and other activities.',
    collectionPath: '/api/activities',
    itemPath: '/api/activities/:id',
    createPath: '/api/activities',
    updatePath: '/api/activities/:id',
    deletePath: '/api/activities/:id',
    scopeRead: null,
    scopeWrite: null,
    createSchema: activitySchema,
    updateSchema: activitySchema.partial(),
    errorStyle: 'message',
    notFound: 'Activity not found',
    who: 'Requires a signed-in user who can manage activities. A company API key cannot call this path.',
    listParams: [
      ...listQueries,
      query('type', 'string', 'Activity type.'),
      query('status', 'string', 'PLANNED, IN_PROGRESS, COMPLETED, or CANCELLED.'),
      query('leadId', 'string', 'Filter by lead id.'),
      query('startDate', 'string', 'Range start.'),
      query('endDate', 'string', 'Range end.'),
    ],
  }),
  buildTopic({
    objectName: 'Enquiry',
    label: 'Enquiry',
    description: 'Enquiry records attached to a lead. Creation is not a standalone collection POST.',
    collectionPath: '/api/leads/:id/enquiries',
    itemPath: '/api/enquiries/:id',
    updatePath: '/api/enquiries/:id',
    deletePath: '/api/enquiries/:id',
    scopeRead: null,
    scopeWrite: null,
    updateSchema: enquiryUpdateSchema,
    errorStyle: 'message',
    notFound: 'Enquiry not found',
    who: 'Requires a signed-in user. PUT replaces only the fields you send. A company API key cannot call this path.',
    listParams: [idParam()],
    paginated: false,
  }),
];

const topics = built.map((entry) => entry.topic);
const checks = built.flatMap((entry) => entry.check ? [entry.check] : []);

function openApiDocument(catalogTopics: ApiTopicDoc[], url: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const topic of catalogTopics) {
    for (const operation of topic.operations) {
      const path = operation.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      paths[path] = paths[path] || {};
      paths[path][operation.method.toLowerCase()] = {
        operationId: `${topic.objectName}.${operation.id}`,
        summary: operation.summary,
        tags: [topic.label],
        parameters: operation.params.map((param) => ({
          name: param.name,
          in: param.in,
          required: param.required,
          description: param.description,
          schema: { type: param.type === 'number' ? 'integer' : 'string' },
        })),
        ...(operation.body ? {
          requestBody: {
            required: operation.method === 'POST' && operation.updateMode !== 'partial',
            content: {
              'application/json': {
                schema: { type: 'object' },
                examples: {
                  required: { value: operation.body.requiredExample },
                  full: { value: operation.body.fullExample },
                },
              },
            },
          },
        } : {}),
        responses: {
          [operation.successStatus]: {
            description: 'Success',
            content: { 'application/json': { example: operation.successExample } },
          },
        },
      };
    }
  }
  return {
    openapi: '3.0.3',
    info: { title: 'DCT CRM company API', version: '1.0.0' },
    servers: [{ url }],
    paths,
  };
}

export function buildCompanyApiCatalog(url = ''): ApiCatalog {
  return {
    baseUrl: url,
    topics,
    schemaObjectNames: topics.map((topic) => topic.objectName),
    openapi: openApiDocument(topics, url),
  };
}

export function catalogChecks(): CatalogCheck[] {
  return checks;
}

export function validateCatalogBody(objectName: string, operationId: string, body: unknown) {
  const schema = schemaFor(objectName, operationId === 'put-update' ? 'update' : 'create');
  if (!schema) return { valid: false, fieldErrors: [{ field: '', message: 'This object has no validation schema.' }] };
  let candidate = body;
  if (
    objectName.toLowerCase() === 'lead'
    && operationId === 'post-create'
    && body
    && typeof body === 'object'
    && !Array.isArray(body)
  ) {
    const record = body as Record<string, unknown>;
    if (record.source === undefined || record.source === '') candidate = { ...record, source: 'OTHER' };
  }
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const check = checks.find((item) => item.objectName.toLowerCase() === objectName.toLowerCase());
  if (operationId !== 'put-update' && check?.afterParse && body && typeof body === 'object') {
    const message = check.afterParse(body as Record<string, unknown>);
    if (message) {
      const field = message.toLowerCase().includes('floor') ? 'floor' : message.toLowerCase().includes('block') ? 'block' : message.toLowerCase().includes('plot') || message.toLowerCase().includes('apartment') ? 'type' : 'dueDate';
      return { valid: false, fieldErrors: [{ field, message }] };
    }
  }
  return { valid: true, fieldErrors: [] };
}

function schemaFor(objectName: string, kind: 'create' | 'update'): ZodTypeAny | null {
  const match = built.find((item) => item.topic.objectName.toLowerCase() === objectName.toLowerCase());
  if (!match) return null;
  if (kind === 'update') {
    const update = match.topic.operations.find((operation) => operation.id === 'put-update');
    if (!update) return null;
    return updateSchemaOf(match.topic.objectName);
  }
  return match.check?.schema || null;
}

function updateSchemaOf(objectName: string): ZodTypeAny | null {
  const schemas: Record<string, ZodTypeAny> = {
    Lead: leadUpdateSchema,
    CallDetail: callDetailUpdateSchema,
    FollowUp: followUpSchema.partial(),
    SiteVisit: updateSiteVisitSchema,
    Unit: updateUnitSchema,
    Project: updateProjectSchema,
    Activity: activitySchema.partial(),
    Enquiry: enquiryUpdateSchema,
  };
  return schemas[objectName] || null;
}

export function catalogOperation(objectName: string, operationId: string) {
  const topic = topics.find((item) => item.objectName.toLowerCase() === objectName.toLowerCase());
  return topic?.operations.find((operation) => operation.id === operationId) || null;
}

export function assertCatalogPath(path: string) {
  const normalized = path.split('?')[0];
  return topics.some((topic) => topic.operations.some((operation) => {
    const pattern = `^${operation.path.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`;
    return new RegExp(pattern).test(normalized);
  }));
}
