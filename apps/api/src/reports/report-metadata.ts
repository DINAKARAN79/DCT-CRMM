import { Prisma } from '@prisma/client';
import { prisma } from '@dct-crm/db';

export type ReportFieldType = 'string' | 'number' | 'date' | 'enum';

export interface ReportField {
  label: string;
  path: string;
  type: ReportFieldType;
  combine?: string[];
}

export interface ReportObject {
  label: string;
  category?: string;
  model: string;
  fields: Record<string, ReportField>;
}

export interface ReportMetadataField {
  key: string;
  label: string;
  type: ReportFieldType;
}

export interface ReportMetadataObject {
  name: string;
  label: string;
  category: string;
  fields: ReportMetadataField[];
}

export interface ReportMetadataRegistry {
  objects: ReportMetadataObject[];
  name?: string;
  label?: string;
  category?: string;
  fields?: ReportMetadataField[];
  object?: ReportMetadataObject;
}

const SKIPPED_PRISMA_TYPES = new Set(['Json', 'Bytes', 'Unsupported']);

type PrismaModelMetadata = {
  name: string;
  fields: readonly { name: string; kind: string; type: string }[];
};

export function prismaDelegateName(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

export function findPrismaModel(objectName: string): PrismaModelMetadata | undefined {
  return Prisma.dmmf.datamodel.models.find(
    (model) => model.name.toLowerCase() === objectName.toLowerCase(),
  );
}

function reportTypeForPrismaField(field: { kind: string; type: string }): ReportFieldType {
  if (field.kind === 'enum' || field.type === 'Boolean') return 'enum';
  if (['Int', 'Float', 'Decimal', 'BigInt'].includes(field.type)) return 'number';
  if (field.type === 'DateTime') return 'date';
  return 'string';
}

export function reportObjectFromPrismaModel(
  objectName: string,
  labels?: Map<string, string>,
): ReportObject | null {
  const model = findPrismaModel(objectName);
  if (!model || !model.fields.some((field) => field.name === 'tenantId')) return null;
  const delegate = prismaDelegateName(model.name);
  if (!(prisma as any)[delegate]) return null;

  const fields: Record<string, ReportField> = {};
  for (const field of model.fields) {
    if (field.kind === 'object' || SKIPPED_PRISMA_TYPES.has(field.type)) continue;
    fields[field.name] = {
      label: labels?.get(field.name) || field.name,
      path: field.name,
      type: reportTypeForPrismaField(field),
    };
  }
  if (Object.keys(fields).length === 0) return null;
  return {
    label: model.name,
    model: delegate,
    fields,
  };
}

function toMetadataObject(name: string, object: ReportObject): ReportMetadataObject {
  return {
    name,
    label: object.label,
    category: object.category || object.label,
    fields: Object.entries(object.fields).map(([key, field]) => ({
      key,
      label: field.label,
      type: field.type,
    })),
  };
}

export async function getReportMetadataRegistry(
  tenantId: string,
  objectName?: string,
): Promise<ReportMetadataRegistry> {
  const staticObjects = Object.entries(REPORT_OBJECTS)
    .filter(([, object]) => Boolean((prisma as any)[object.model]))
    .map(([name, object]) => toMetadataObject(name, object));

  const definedObjects = await prisma.objectDefinition.findMany({
    where: { tenantId, isActive: true },
    include: {
      fields: {
        where: { isActive: true, visible: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { label: 'asc' },
  });

  const staticNames = new Set(staticObjects.map((object) => object.name.toLowerCase()));
  const dynamicObjects = definedObjects
    .filter((object) => !staticNames.has(object.name.toLowerCase()))
    .map((object) => {
      const labels = new Map(object.fields.map((field) => [field.name, field.label]));
      const databaseObject = reportObjectFromPrismaModel(object.name, labels);
      if (databaseObject) {
        const model = findPrismaModel(object.name);
        return toMetadataObject(model?.name || object.name, {
          ...databaseObject,
          label: object.pluralLabel || object.label,
          category: object.pluralLabel || object.label,
        });
      }
      return {
        name: object.name,
        label: object.pluralLabel || object.label,
        category: object.pluralLabel || object.label,
        fields: object.fields.map((field) => ({
          key: field.name,
          label: field.label,
          type: (['number', 'currency', 'decimal'].includes(field.fieldType)
            ? 'number'
            : ['date', 'dateTime'].includes(field.fieldType)
              ? 'date'
              : field.fieldType === 'picklist'
                ? 'enum'
                : 'string') as ReportFieldType,
        })),
      };
    });

  const objects = [...staticObjects, ...dynamicObjects];

  if (!objectName) {
    return { objects };
  }

  const matched =
    objects.find((object) => object.name === objectName) ||
    objects.find((object) => object.name.toLowerCase() === objectName.toLowerCase());

  if (!matched) {
    throw new Error(`Unknown report object: ${objectName}`);
  }

  return {
    objects,
    name: matched.name,
    label: matched.label,
    category: matched.category,
    fields: matched.fields,
    object: matched,
  };
}

export const REPORT_OBJECTS: Record<string, ReportObject> = {
  Lead: {
    label: 'Leads',
    category: 'Leads',
    model: 'lead',
    fields: {
      id: { label: 'Lead ID', path: 'id', type: 'string' },
      leadNumber: { label: 'Lead Number', path: 'leadNumber', type: 'string' },
      firstName: { label: 'First Name', path: 'firstName', type: 'string' },
      lastName: { label: 'Last Name', path: 'lastName', type: 'string' },
      email: { label: 'Email', path: 'email', type: 'string' },
      phone: { label: 'Phone', path: 'phone', type: 'string' },
      status: { label: 'Status', path: 'status', type: 'enum' },
      source: { label: 'Lead Source', path: 'source', type: 'enum' },
      score: { label: 'Score', path: 'score', type: 'number' },
      budget: { label: 'Budget', path: 'budget', type: 'number' },
      requirements: { label: 'Requirements', path: 'requirements', type: 'string' },
      notes: { label: 'Notes', path: 'notes', type: 'string' },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
      updatedAt: { label: 'Updated Date', path: 'updatedAt', type: 'date' },
      ownerId: { label: 'Owner ID', path: 'ownerId', type: 'string' },
      ownerName: { label: 'Owner', path: 'owner.firstName', type: 'string', combine: ['owner.firstName', 'owner.lastName'] },
      ownerEmail: { label: 'Owner Email', path: 'owner.email', type: 'string' },
      projectName: { label: 'Project', path: 'project.name', type: 'string' },
      rrQueueId: { label: 'Round Robin Queue ID', path: 'rrQueueId', type: 'string' },
      rrQueueName: { label: 'Round Robin Queue', path: 'rrQueue.name', type: 'string' },
    },
  },
  SiteVisit: {
    label: 'Site Visits',
    category: 'Site Visits',
    model: 'siteVisit',
    fields: {
      id: { label: 'Site Visit ID', path: 'id', type: 'string' },
      scheduledAt: { label: 'Scheduled Date', path: 'scheduledAt', type: 'date' },
      completedAt: { label: 'Completed Date', path: 'completedAt', type: 'date' },
      status: { label: 'Status', path: 'status', type: 'enum' },
      feedback: { label: 'Feedback', path: 'feedback', type: 'string' },
      rating: { label: 'Rating', path: 'rating', type: 'number' },
      notes: { label: 'Notes', path: 'notes', type: 'string' },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  Project: {
    label: 'Projects',
    category: 'Projects',
    model: 'project',
    fields: {
      id: { label: 'Project ID', path: 'id', type: 'string' },
      name: { label: 'Project Name', path: 'name', type: 'string' },
      projectType: { label: 'Project Type', path: 'projectType', type: 'string' },
      description: { label: 'Description', path: 'description', type: 'string' },
      address: { label: 'Address', path: 'address', type: 'string' },
      city: { label: 'City', path: 'city', type: 'string' },
      state: { label: 'State', path: 'state', type: 'string' },
      totalUnits: { label: 'Total Units', path: 'totalUnits', type: 'number' },
      isActive: { label: 'Active', path: 'isActive', type: 'enum' },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  Unit: {
    label: 'Units',
    category: 'Units',
    model: 'unit',
    fields: {
      Name: { label: 'Unit Name', path: 'unitCode', type: 'string' },
      Unit_Number__c: { label: 'Unit Number', path: 'number', type: 'string' },
      Unit_Type__c: { label: 'Unit Type', path: 'type', type: 'enum' },
      Status__c: { label: 'Status', path: 'status', type: 'enum' },
      Floor__c: { label: 'Floor', path: 'floor', type: 'number' },
      Block__c: { label: 'Block', path: 'block', type: 'string' },
      Saleable_Area__c: { label: 'Saleable Area', path: 'area', type: 'number' },
      Area__c: { label: 'Area', path: 'Area__c', type: 'number' },
      Buildup_Area__c: { label: 'Buildup Area', path: 'buildupArea', type: 'number' },
      Base_Price__c: { label: 'Base Price', path: 'price', type: 'number' },
      Unit_Price__c: { label: 'Unit Price', path: 'price', type: 'number' },
      Villa_Price__c: { label: 'Villa Price', path: 'villaPrice', type: 'number' },
      Allowed_Discountt__c: { label: 'Allowed Discountt', path: 'allowedDiscount', type: 'string' },
      Minimum_Booking_Amount__c: { label: 'Minimum Booking Amount', path: 'minimumBookingAmount', type: 'number' },
      MSP__c: { label: 'MSP', path: 'msp', type: 'string' },
      PLC__c: { label: 'PLC', path: 'plc', type: 'string' },
      Non_PLC__c: { label: 'Non PLC', path: 'nonPlc', type: 'string' },
      Project__c: { label: 'Project', path: 'project.name', type: 'string' },
      Project_Name__c: { label: 'Project Name', path: 'project.name', type: 'string' },
      ownerId: { label: 'Owner ID', path: 'ownerId', type: 'string' },
      OwnerId: { label: 'Owner', path: 'owner.firstName', type: 'string', combine: ['owner.firstName', 'owner.lastName'] },
      Customer__c: { label: 'Customer', path: 'customerLead.lastName', type: 'string', combine: ['customerLead.firstName', 'customerLead.lastName'] },
      Bookingdate__c: { label: 'Opportunity', path: 'bookingLead.lastName', type: 'string', combine: ['bookingLead.firstName', 'bookingLead.lastName'] },
      Opportunity__c: { label: 'Opportunity', path: 'opportunityLead.lastName', type: 'string', combine: ['opportunityLead.firstName', 'opportunityLead.lastName'] },
      Booking_source__c: { label: 'Booking source', path: 'bookingSource', type: 'string' },
      Registration_Date__c: { label: 'Registration Date', path: 'registrationDate', type: 'date' },
      CreatedById: { label: 'Created By', path: 'createdBy.firstName', type: 'string', combine: ['createdBy.firstName', 'createdBy.lastName'] },
      LastModifiedById: { label: 'Last Modified By', path: 'updatedBy.firstName', type: 'string', combine: ['updatedBy.firstName', 'updatedBy.lastName'] },
    },
  },
  FollowUp: {
    label: 'Follow-ups',
    category: 'Follow-ups',
    model: 'followUp',
    fields: {
      followUpNumber: { label: 'Follow-Up ID', path: 'followUpNumber', type: 'string' },
      title: { label: 'Title', path: 'title', type: 'string' },
      status: { label: 'Status', path: 'status', type: 'enum' },
      dueDate: { label: 'Scheduled Date', path: 'dueDate', type: 'date' },
      subject: { label: 'Subject', path: 'subject', type: 'string' },
      description: { label: 'Description', path: 'description', type: 'string' },
      comments: { label: 'Comments', path: 'comments', type: 'string' },
      previousDisposition: { label: 'Previous Disposition', path: 'previousDisposition', type: 'string' },
      cancelledReason: { label: 'Cancelled Reason', path: 'cancelledReason', type: 'string' },
      completedAt: { label: 'Completed Date', path: 'completedAt', type: 'date' },
      isCompleted: { label: 'Follow Up Conducted', path: 'isCompleted', type: 'enum' },
      isMissed: { label: 'Is Missed Followup', path: 'isMissed', type: 'enum' },
      awaitedFollowUp: { label: 'Awaited FollowUp', path: 'awaitedFollowUp', type: 'enum' },
      isSystemCancelled: { label: 'Is System Cancelled', path: 'isSystemCancelled', type: 'enum' },
      ownerName: { label: 'Owner', path: 'owner.firstName', type: 'string', combine: ['owner.firstName', 'owner.lastName'] },
      assignedToName: { label: 'Assigned To', path: 'assignedTo.firstName', type: 'string', combine: ['assignedTo.firstName', 'assignedTo.lastName'] },
      leadName: { label: 'Lead', path: 'lead.lastName', type: 'string', combine: ['lead.firstName', 'lead.lastName'] },
      leadNumber: { label: 'Lead Number', path: 'lead.leadNumber', type: 'string' },
      enquiryNumber: { label: 'Enquiry', path: 'enquiry.enquiryNumber', type: 'string' },
      bookingNumber: { label: 'Booking', path: 'booking.bookingNumber', type: 'string' },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  Booking: {
    label: 'Bookings',
    category: 'Bookings',
    model: 'booking',
    fields: {
      id: { label: 'Booking ID', path: 'id', type: 'string' },
      bookingNumber: { label: 'Booking Number', path: 'bookingNumber', type: 'string' },
      status: { label: 'Status', path: 'status', type: 'enum' },
      bookingStage: { label: 'Stage', path: 'bookingStage', type: 'enum' },
      bookingAmount: { label: 'Booking Amount', path: 'bookingAmount', type: 'number' },
      projectName: { label: 'Project', path: 'project.name', type: 'string' },
      unitNumber: { label: 'Unit', path: 'unit.number', type: 'string' },
      leadName: { label: 'Lead', path: 'lead.lastName', type: 'string' },
      leadNumber: { label: 'Lead Number', path: 'lead.leadNumber', type: 'string' },
      ownerName: { label: 'Owner', path: 'owner.firstName', type: 'string', combine: ['owner.firstName', 'owner.lastName'] },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  CallDetail: {
    label: 'Call Details',
    category: 'Call Details',
    model: 'callDetail',
    fields: {
      id: { label: 'Call ID', path: 'id', type: 'string' },
      name: { label: 'Call Name', path: 'name', type: 'string' },
      callType: { label: 'Call Type', path: 'callType', type: 'string' },
      status: { label: 'Status', path: 'status', type: 'string' },
      callFrom: { label: 'Call From', path: 'callFrom', type: 'string' },
      callTo: { label: 'Call To', path: 'callTo', type: 'string' },
      duration: { label: 'Duration (seconds)', path: 'duration', type: 'number' },
      startAt: { label: 'Start', path: 'startAt', type: 'date' },
      endAt: { label: 'End', path: 'endAt', type: 'date' },
      notes: { label: 'Notes', path: 'notes', type: 'string' },
      leadName: { label: 'Lead', path: 'lead.lastName', type: 'string' },
      leadNumber: { label: 'Lead Number', path: 'lead.leadNumber', type: 'string' },
      ownerName: { label: 'Owner', path: 'owner.firstName', type: 'string', combine: ['owner.firstName', 'owner.lastName'] },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  RRQueue: {
    label: 'Round Robin Queues',
    category: 'Round Robin',
    model: 'rRQueue',
    fields: {
      id: { label: 'Queue ID', path: 'id', type: 'string' },
      name: { label: 'Queue', path: 'name', type: 'string' },
      projectName: { label: 'Project', path: 'project.name', type: 'string' },
      leadCount: { label: 'Assigned Lead Count', path: 'leadCount', type: 'number' },
      noOfUsers: { label: 'Users', path: 'noOfUsers', type: 'number' },
      active: { label: 'Active', path: 'active', type: 'enum' },
      createdAt: { label: 'Created Date', path: 'createdAt', type: 'date' },
    },
  },
  RRQueueMember: {
    label: 'Round Robin Members',
    category: 'Round Robin',
    model: 'rRQueueMember',
    fields: {
      id: { label: 'Member ID', path: 'id', type: 'string' },
      userName: { label: 'User', path: 'user.firstName', type: 'string', combine: ['user.firstName', 'user.lastName'] },
      userEmail: { label: 'User Email', path: 'user.email', type: 'string' },
      queueName: { label: 'Round Robin Queue', path: 'rrQueue.name', type: 'string' },
      projectName: { label: 'Project', path: 'rrQueue.project.name', type: 'string' },
      userType: { label: 'User Type', path: 'userType', type: 'string' },
      currentLeadCount: { label: 'Leads Assigned', path: 'currentLeadCount', type: 'number' },
      maxLeadCapacity: { label: 'Max Lead Capacity', path: 'maxLeadCapacity', type: 'number' },
      sequenceId: { label: 'Sequence', path: 'sequenceId', type: 'number' },
      activeMember: { label: 'Active Member', path: 'activeMember', type: 'enum' },
      lastAssignedAt: { label: 'Last Assigned', path: 'lastAssignedAt', type: 'date' },
    },
  },
};