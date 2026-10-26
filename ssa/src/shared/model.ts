// Adapted from Capsule (Apache-2.0): src/components/common/ssaDiff.ts. See NOTICE.
export interface SSAFieldLine {
  text: string;
  managed: boolean;
}

export interface ManagedFieldSelection {
  manager?: string;
  operation?: string;
  time?: string;
  subresource?: string;
  apiVersion?: string;
  fieldsV1?: any;
}

export function managerKey(field: ManagedFieldSelection): string {
  return JSON.stringify([field.manager, field.operation, field.subresource || '']);
}

/** Only valid FieldsV1 records participate; empty roots do not claim the whole object. */
export function ownershipFields(object: any, includeSubresources = false): ManagedFieldSelection[] {
  return (
    Array.isArray(object?.metadata?.managedFields) ? object.metadata.managedFields : []
  ).filter(
    (field: ManagedFieldSelection) =>
      field &&
      typeof field.manager === 'string' &&
      ['Apply', 'Update'].includes(field.operation || '') &&
      (!field.subresource || includeSubresources) &&
      isObject(field.fieldsV1) &&
      !Array.isArray(field.fieldsV1) &&
      Object.keys(field.fieldsV1).length > 0
  );
}

/** Creates the ownership union of multiple Kubernetes fieldsV1 trees. */
export function mergeSSAFields(...fieldSets: any[]): any | undefined {
  const activeSets = fieldSets.filter(isObject);
  if (activeSets.length === 0) return undefined;
  if (activeSets.some(fields => Object.keys(fields).length === 0)) return {};

  const result: Record<string, any> = Object.create(null);
  activeSets.forEach(fields => {
    Object.entries(fields).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = value;
        return;
      }

      const merged = mergeSSAFields(result[key], value);
      result[key] = merged === undefined ? value : merged;
    });
  });
  return result;
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object';
}

function isFullyManaged(fieldsV1: any): boolean {
  if (!isObject(fieldsV1)) return false;
  // A '.' entry owns membership, not every child of a map/list item.
  return Object.keys(fieldsV1).length === 0;
}

function childFields(fieldsV1: any, key: string): any | undefined {
  if (!isObject(fieldsV1)) return undefined;
  const fieldKey = `f:${key}`;
  if (Object.prototype.hasOwnProperty.call(fieldsV1, fieldKey)) return fieldsV1[fieldKey];
  if (Object.prototype.hasOwnProperty.call(fieldsV1, key)) return fieldsV1[key];
  return undefined;
}

function arrayItemFields(fieldsV1: any, item: any, index: number): any | undefined {
  if (!isObject(fieldsV1)) return undefined;
  if (isFullyManaged(fieldsV1)) return {};

  for (const [key, value] of Object.entries(fieldsV1)) {
    if (key.startsWith('k:') && isObject(item)) {
      try {
        const selector = JSON.parse(key.slice(2));
        if (
          isObject(selector) &&
          Object.entries(selector).every(([selectorKey, selectorValue]) =>
            Object.is(item[selectorKey], selectorValue)
          )
        ) {
          return value;
        }
      } catch {
        // Ignore malformed managed-fields selectors and keep looking.
      }
    }

    if (key === `i:${index}`) return value;

    if (key.startsWith('v:')) {
      try {
        if (JSON.stringify(JSON.parse(key.slice(2))) === JSON.stringify(item)) return value;
      } catch {
        // Ignore malformed managed-fields values and keep looking.
      }
    }
  }

  return undefined;
}

function scalar(value: unknown): string {
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function appendValue(
  value: any,
  fieldsV1: any,
  level: number,
  inheritedManaged: boolean,
  lines: SSAFieldLine[]
) {
  const indent = '  '.repeat(level);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push({ text: `${indent}[]`, managed: inheritedManaged || isFullyManaged(fieldsV1) });
      return;
    }

    value.forEach((item, index) => {
      const itemFields = arrayItemFields(fieldsV1, item, index);
      const managed = inheritedManaged || itemFields !== undefined;
      if (isObject(item)) {
        lines.push({ text: `${indent}-`, managed });
        appendValue(item, itemFields, level + 1, managed && isFullyManaged(itemFields), lines);
      } else {
        lines.push({ text: `${indent}- ${scalar(item)}`, managed });
      }
    });
    return;
  }

  if (!isObject(value)) {
    lines.push({ text: `${indent}${scalar(value)}`, managed: inheritedManaged });
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    const ownedFields = childFields(fieldsV1, key);
    const managed = inheritedManaged || ownedFields !== undefined;
    if (isObject(child)) {
      const emptyValue = Array.isArray(child)
        ? child.length === 0
        : Object.keys(child as Record<string, any>).length === 0;
      lines.push({
        text: `${indent}${/^[a-zA-Z_][a-zA-Z0-9_./-]*$/.test(key) ? key : JSON.stringify(key)}:${
          emptyValue ? ` ${Array.isArray(child) ? '[]' : '{}'}` : ''
        }`,
        managed,
      });
      if (!emptyValue) {
        appendValue(
          child,
          ownedFields,
          level + 1,
          inheritedManaged || isFullyManaged(ownedFields),
          lines
        );
      }
    } else {
      lines.push({
        text: `${indent}${
          /^[a-zA-Z_][a-zA-Z0-9_./-]*$/.test(key) ? key : JSON.stringify(key)
        }: ${scalar(child)}`,
        managed,
      });
    }
  });
}

/**
 * Converts a live Kubernetes object into YAML-like display lines and annotates
 * every field owned by the selected server-side-apply manager.
 */
export function buildSSAFieldLines(object: any, fieldsV1: any): SSAFieldLine[] {
  const lines: SSAFieldLine[] = [];
  const context = { ...object, ...(object?.metadata ? { metadata: { ...object.metadata } } : {}) };
  if (context.metadata) delete context.metadata.managedFields;
  appendValue(context, fieldsV1, 0, false, lines);
  return lines;
}
