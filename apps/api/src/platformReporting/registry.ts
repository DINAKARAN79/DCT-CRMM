import { Prisma } from '@prisma/client';

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];
type DmmfField = DmmfModel['fields'][number];

export interface SafeField {
  name: string;
  type: string;
  nullable: boolean;
  kind: 'scalar' | 'enum';
  enumValues?: string[];
}

export interface SafeRelation {
  name: string;
  target: string;
  fields: SafeField[];
}

export interface SafeModel {
  name: string;
  scope: 'tenant' | 'global';
  fields: SafeField[];
  relations: SafeRelation[];
}

const GLOBAL_MODELS = new Set(['Tenant', 'Permission']);
const EXCLUDED_MODELS = /^(CPPortalAccount|CPPortalNote|GREAuditEvent|GRELink|GRESession|GreSession|AIConversation|AIMessage|ApiKey.*|UserSession|ImpersonationSession|TenantImpersonationSetting|Telephony.*|Role|Profile.*|Permission.*|NewPermissionSet.*|ObjectPermission|FieldPermission|RecordShare|RecordTeamMember|ObjectSharingSetting|SharingRule|UserProfilePermission|UserPermissionAssignment|DashboardProfileShare)$/i;
const SENSITIVE_FIELD = /email|phone|mobile|password|secret|token|address|postal|zip|latitude|longitude|gps|coordinate|applicant|customer|first.?name|last.?name|full.?name|avatar|photo|image|logo|document|screenshot|notes?|description|comment|feedback|reason|content|settings|custom.?fields|payment.?plan|plot.?details|passport|national.?id|tax.?id|ssn|credit.?card|account.?number|lastLogin|lastSeen|lastLogout|isSuperAdmin|isLoggedIn|profileId|roleId|impersonatedById/i;
const SAFE_STRING_FIELD = /^(id|[a-zA-Z0-9]+Id|name|slug|action|module|label|currency|country|state|city|packageName|companyCode|[a-zA-Z0-9]*(status|stage|type|kind|category|source|code|number|mode))$/i;

const modelByName = new Map<string, DmmfModel>(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
);
let registryCache: SafeModel[] | undefined;

function isTenantOwned(model: DmmfModel): boolean {
  return model.fields.some((field) => field.name === 'tenantId' && field.kind === 'scalar' && field.type === 'String');
}

function isSafeField(field: DmmfField, modelName: string): field is DmmfField & { kind: 'scalar' | 'enum' } {
  const safeRelationKey = field.kind === 'scalar' && /^[A-Za-z][A-Za-z0-9]*Id$/.test(field.name);
  if (field.name === 'tenantId' || SENSITIVE_FIELD.test(field.name) || field.isList || (field.isReadOnly && !safeRelationKey)) return false;
  if (field.kind !== 'scalar' && field.kind !== 'enum') return false;
  if (field.type === 'Json' || field.type === 'Bytes') return false;
  if (field.kind === 'scalar') {
    if (['String', 'Int', 'Float', 'Decimal', 'Boolean', 'DateTime'].indexOf(field.type) === -1) return false;
    if (field.type === 'String' && !SAFE_STRING_FIELD.test(field.name)) return false;
  }
  if (/^Lead$|^Enquiry$|^Booking$|^Quotation$|^Receipt$|^SiteVisit$|^CPPortal/i.test(modelName)
    && /^(name|city|country|state|source|type|status|stage|kind)$/.test(field.name)) {
    return ['status', 'stage', 'kind', 'type', 'source'].includes(field.name);
  }
  return true;
}

function fieldsFor(model: DmmfModel): SafeField[] {
  return model.fields.filter((field) => isSafeField(field, model.name)).map((field) => ({
    name: field.name,
    type: field.type,
    nullable: !field.isRequired,
    kind: field.kind as 'scalar' | 'enum',
    ...(field.kind === 'enum'
      ? { enumValues: Prisma.dmmf.datamodel.enums.find((entry) => entry.name === field.type)?.values.map((entry) => entry.name) || [] }
      : {}),
  }));
}

function isExposedModel(model: DmmfModel): boolean {
  if (GLOBAL_MODELS.has(model.name)) return true;
  return isTenantOwned(model) && !EXCLUDED_MODELS.test(model.name);
}

export function getPlatformRegistry(): SafeModel[] {
  if (registryCache) return registryCache;
  const exposed = Prisma.dmmf.datamodel.models.filter(isExposedModel);
  const exposedNames = new Set(exposed.map((model) => model.name));

  registryCache = exposed.map((model) => {
    const tenantOwned = isTenantOwned(model);
    const safeRelations = tenantOwned
      ? model.fields
        .filter((field) => field.kind === 'object' && !field.isList && field.relationFromFields?.length)
        .filter((field) => {
          const target = modelByName.get(field.type);
          return Boolean(target && exposedNames.has(field.type) && (isTenantOwned(target) || field.type === 'Tenant'));
        })
        .map((field) => ({
          name: field.name,
          target: field.type,
          fields: fieldsFor(modelByName.get(field.type)!),
        }))
      : [];
    return {
      name: model.name,
      scope: tenantOwned ? 'tenant' : 'global',
      fields: fieldsFor(model),
      relations: safeRelations,
    };
  });
  return registryCache;
}

export function findSafeModel(name: unknown): SafeModel | undefined {
  if (typeof name !== 'string') return undefined;
  return getPlatformRegistry().find((model) => model.name === name);
}

export function findSafeField(model: SafeModel, fieldName: string): SafeField | undefined {
  return model.fields.find((field) => field.name === fieldName);
}

export function findSafeRelation(model: SafeModel, relationName: string): SafeRelation | undefined {
  return model.relations.find((relation) => relation.name === relationName);
}
