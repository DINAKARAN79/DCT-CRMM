import { z } from 'zod';

type ZodTypeAny = z.ZodTypeAny;

export type FieldRequirement = 'required' | 'optional' | 'conditional';

export interface CatalogField {
  name: string;
  path: string;
  type: string;
  requirement: FieldRequirement;
  condition?: string;
  enumValues?: string[];
  maxLength?: number;
  format?: string;
  description: string;
  sample: unknown;
  children?: CatalogField[];
}

export interface FieldHint {
  sample?: unknown;
  requirement?: FieldRequirement;
  condition?: string;
  enumValues?: string[];
  description?: string;
  format?: string;
}

export type FieldHints = Record<string, FieldHint>;

const READ_ONLY_FIELDS = new Set([
  'id',
  'tenantId',
  'unitCode',
  'createdAt',
  'updatedAt',
  'createdById',
  'updatedById',
]);

function typeName(schema: ZodTypeAny): string {
  return schema?._def?.typeName || '';
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (let index = 0; index < 8; index += 1) {
    const name = typeName(current);
    if (name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodNullable') {
      current = current._def.innerType;
      continue;
    }
    if (name === 'ZodEffects' || name === 'ZodBranded' || name === 'ZodCatch') {
      current = current._def.schema;
      continue;
    }
    if (name === 'ZodPipeline') {
      current = current._def.out || current._def.in;
      continue;
    }
    break;
  }
  return current;
}

export function isOptionalInput(schema: ZodTypeAny): boolean {
  const name = typeName(schema);
  if (name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodUndefined') return true;
  if (name === 'ZodNullable' || name === 'ZodEffects' || name === 'ZodBranded' || name === 'ZodCatch') {
    return isOptionalInput(schema._def.innerType || schema._def.schema);
  }
  if (name === 'ZodUnion' || name === 'ZodDiscriminatedUnion') {
    return schema._def.options.some((option: ZodTypeAny) => isOptionalInput(option));
  }
  return false;
}

function humanize(name: string): string {
  return name
    .replace(/Id$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function futureIso(hoursAhead = 48): string {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

function futureDate(daysAhead = 14): string {
  return futureIso(daysAhead * 24).slice(0, 10);
}

function stringChecks(schema: ZodTypeAny): { max?: number; format?: string } {
  const checks = Array.isArray(schema._def?.checks) ? schema._def.checks : [];
  const max = checks.find((check: { kind: string }) => check.kind === 'max')?.value as number | undefined;
  const format = checks.some((check: { kind: string }) => check.kind === 'email')
    ? 'email'
    : checks.some((check: { kind: string }) => check.kind === 'url')
      ? 'uri'
      : checks.some((check: { kind: string; offset?: boolean }) => check.kind === 'datetime')
        ? 'date-time'
        : checks.some((check: { kind: string; regex?: RegExp }) => check.kind === 'regex' && String(check.regex) === String(/^\d{4}-\d{2}-\d{2}$/))
          ? 'date'
          : checks.some((check: { kind: string; regex?: RegExp }) => check.kind === 'regex' && /\[A-Z\]\{5\}/.test(String(check.regex)))
            ? 'pan'
            : undefined;
  return { max, format };
}

function enumValuesOf(schema: ZodTypeAny): string[] | undefined {
  const inner = unwrap(schema);
  if (typeName(inner) === 'ZodEnum') return [...inner._def.values];
  if (typeName(inner) === 'ZodNativeEnum') return Object.values(inner._def.values).filter((value) => typeof value === 'string') as string[];
  return undefined;
}

function sampleString(fieldName: string, format?: string): string {
  if (format === 'email') return 'test@example.com';
  if (format === 'uri') return 'https://example.com/file';
  if (format === 'date-time') return futureIso(fieldName === 'endAt' ? 49 : 48);
  if (format === 'date') return fieldName.toLowerCase().includes('birth') ? '1990-01-15' : futureDate();
  if (format === 'pan') return 'ABCDE1234F';
  const key = fieldName.toLowerCase();
  if (key.includes('phone') || key.includes('mobile') || key === 'callto' || key === 'callfrom' || key.includes('alternatenumber')) return '+919000000000';
  if (key.includes('email')) return 'test@example.com';
  if (key.includes('aadhaar')) return '1234';
  if (key === 'pan' || key === 'pannumber') return 'ABCDE1234F';
  if (key === 'company') return 'Example Company';
  if (key === 'lastname') return 'Example';
  if (key === 'firstname' || key === 'name' || key === 'receivedfrom') return 'Example';
  if (key === 'number') return 'A-101';
  if (key === 'nationality') return 'Indian';
  if (key === 'salutation') return 'Mr';
  if (key === 'maritalstatus') return 'Single';
  if (key === 'state') return 'Karnataka';
  if (key.includes('address')) return '1 Example Street';
  if (key === 'industry') return 'Example Industry';
  if (key === 'title' || key === 'subject' || key === 'milestone') return 'Example follow-up';
  if (key === 'description' || key === 'notes') return 'Example note';
  if (key === 'block') return 'Block 1';
  if (key === 'source') return 'WEBSITE';
  if (key.endsWith('id')) return `cmexample${fieldName.replace(/Id$/, '').toLowerCase()}000000000001`;
  return 'Example';
}

function sampleNumber(fieldName: string, schema: ZodTypeAny): number {
  const key = fieldName.toLowerCase();
  if (key === 'price') return 3200000;
  if (key.includes('amount') || key === 'discount') return 100000;
  if (key === 'percentage') return 100;
  if (key === 'floor') return 2;
  if (key === 'area' || key === 'builduparea') return 1200;
  if (key === 'duedays') return 30;
  if (key === 'latitude') return 12.9716;
  if (key === 'longitude') return 77.5946;
  const checks = Array.isArray(schema._def?.checks) ? schema._def.checks : [];
  const min = checks.find((check: { kind: string }) => check.kind === 'min')?.value as number | undefined;
  if (typeof min === 'number' && min > 0) return min;
  return 1;
}

export function exampleValue(schema: ZodTypeAny, fieldName = '', hints?: FieldHints): unknown {
  const hint = hints?.[fieldName];
  if (hint?.sample !== undefined) return hint.sample;
  const name = typeName(schema);
  if (name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodNullable' || name === 'ZodEffects' || name === 'ZodBranded') {
    return exampleValue(schema._def.innerType || schema._def.schema, fieldName, hints);
  }
  if (name === 'ZodUnion' || name === 'ZodDiscriminatedUnion') {
    const options = schema._def.options as ZodTypeAny[];
    const samples = options
      .filter((option) => typeName(option) !== 'ZodUndefined')
      .map((option) => exampleValue(option, fieldName, hints));
    return samples.find((sample) => sample !== '' && sample !== null && sample !== undefined) ?? samples[0] ?? null;
  }
  if (name === 'ZodLiteral') return schema._def.value;
  if (name === 'ZodEnum' || name === 'ZodNativeEnum') return enumValuesOf(schema)?.[0] ?? 'Example';
  if (name === 'ZodBoolean') return false;
  if (name === 'ZodNumber') return sampleNumber(fieldName, schema);
  if (name === 'ZodString') return sampleString(fieldName, stringChecks(schema).format);
  if (name === 'ZodArray') {
    const min = schema._def.minLength?.value ?? 0;
    if (min < 1) return [];
    return Array.from({ length: min }, () => exampleValue(schema._def.type, fieldName, hints));
  }
  if (name === 'ZodRecord') return {};
  if (name === 'ZodObject') return minimalObject(schema, hints);
  if (name === 'ZodNull') return null;
  return 'Example';
}

function objectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  const inner = unwrap(schema);
  const shape = inner._def.shape;
  return typeof shape === 'function' ? shape() : shape;
}

export function minimalObject(schema: ZodTypeAny, hints?: FieldHints): Record<string, unknown> {
  const shape = objectShape(schema);
  const value: Record<string, unknown> = {};
  const optionalKeys: string[] = [];
  for (const [key, child] of Object.entries(shape)) {
    if (READ_ONLY_FIELDS.has(key)) continue;
    if (isOptionalInput(child)) optionalKeys.push(key);
    else value[key] = exampleValue(child, key, hints);
  }
  if (schema.safeParse(value).success) return value;
  let pending = [...optionalKeys];
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    const stillPending: string[] = [];
    for (const key of pending) {
      const candidate = { ...value, [key]: exampleValue(shape[key], key, hints) };
      if (schema.safeParse(candidate).success) value[key] = candidate[key];
      else stillPending.push(key);
    }
    if (stillPending.length === pending.length) break;
    pending = stillPending;
  }
  return value;
}

export function fullestObject(schema: ZodTypeAny, hints?: FieldHints): Record<string, unknown> {
  const shape = objectShape(schema);
  const value = minimalObject(schema, hints);
  let pending = Object.keys(shape).filter((key) => !(key in value) && !READ_ONLY_FIELDS.has(key));
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    const stillPending: string[] = [];
    for (const key of pending) {
      const child = shape[key];
      const sample = typeName(unwrap(child)) === 'ZodObject'
        ? fullestObject(child, hints)
        : typeName(unwrap(child)) === 'ZodArray' && (unwrap(child)._def.minLength?.value ?? 0) < 1
          ? [exampleValue(unwrap(child)._def.type, key, hints)]
          : exampleValue(child, key, hints);
      const candidate = { ...value, [key]: sample };
      if (schema.safeParse(candidate).success) value[key] = sample;
      else stillPending.push(key);
    }
    if (stillPending.length === pending.length) break;
    pending = stillPending;
  }
  return value;
}

function typeLabel(schema: ZodTypeAny): string {
  const inner = unwrap(schema);
  const name = typeName(inner);
  if (name === 'ZodUnion' || name === 'ZodDiscriminatedUnion') {
    const labels = (inner._def.options as ZodTypeAny[]).map((option) => typeLabel(option));
    if (labels.includes('integer')) return 'integer';
    if (labels.includes('number')) return 'number';
    if (labels.includes('boolean')) return 'boolean';
    return 'string';
  }
  if (name === 'ZodString') return 'string';
  if (name === 'ZodNumber') return inner._def.checks?.some((check: { kind: string }) => check.kind === 'int') ? 'integer' : 'number';
  if (name === 'ZodBoolean') return 'boolean';
  if (name === 'ZodEnum' || name === 'ZodNativeEnum') return 'enum';
  if (name === 'ZodArray') return 'array';
  if (name === 'ZodObject') return 'object';
  if (name === 'ZodRecord') return 'object';
  if (name === 'ZodLiteral') return 'string';
  if (name === 'ZodUnion') return 'string';
  return 'string';
}

export function describeFields(schema: ZodTypeAny, hints?: FieldHints, prefix = ''): CatalogField[] {
  const shape = objectShape(schema);
  return Object.entries(shape)
    .filter(([key]) => !READ_ONLY_FIELDS.has(key))
    .map(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const inner = unwrap(child);
      const enums = enumValuesOf(child);
      const stringInfo = typeName(inner) === 'ZodString' ? stringChecks(inner) : {};
      const hint = hints?.[path] || hints?.[key];
      const children = typeName(inner) === 'ZodObject' ? describeFields(inner, hints, path) : undefined;
      const requirement: FieldRequirement = hint?.requirement || (isOptionalInput(child) ? 'optional' : 'required');
      return {
        name: key,
        path,
        type: typeLabel(child),
        requirement,
        condition: hint?.condition,
        enumValues: hint?.enumValues || enums,
        maxLength: stringInfo.max,
        format: hint?.format || stringInfo.format,
        description: hint?.description || humanize(key),
        sample: hint?.sample !== undefined ? hint.sample : exampleValue(child, key, hints),
        children,
      };
    });
}

export function flattenFields(fields: CatalogField[]): CatalogField[] {
  return fields.flatMap((field) => field.children?.length ? [field, ...flattenFields(field.children)] : [field]);
}

export function requiredPaths(fields: CatalogField[]): string[] {
  return fields.flatMap((field) => {
    if (field.requirement !== 'required') return [];
    if (field.children?.length && field.type === 'object') return requiredPaths(field.children);
    return [field.path];
  });
}

export function omitPath(value: Record<string, unknown>, path: string): Record<string, unknown> {
  const clone = structuredClone(value);
  const parts = path.split('.');
  let cursor: Record<string, unknown> | undefined = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = cursor?.[parts[index]];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return clone;
    cursor = next as Record<string, unknown>;
  }
  if (cursor) delete cursor[parts[parts.length - 1]];
  return clone;
}

export function applyOverrides(value: Record<string, unknown>, overrides?: Record<string, unknown>) {
  return overrides ? { ...value, ...overrides } : value;
}
