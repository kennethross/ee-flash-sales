import { fail, ok, type Result } from '../domain/failures';

export interface CreateProductBody {
  readonly sku: string;
  readonly name: string;
  readonly totalStock: number;
  readonly releaseAt?: Date;
}

/** At least one field is present. `releaseAt: null` clears the release time. */
export interface UpdateProductBody {
  readonly totalStock?: number;
  readonly releaseAt?: Date | null;
}

export interface ReserveBody {
  readonly userId: string;
  readonly quantity: number;
}

export interface JoinWaitlistBody {
  readonly userId: string;
}

export interface HoldTimeBody {
  readonly holdTimeMs: number;
}

/**
 * The edge where `unknown` becomes typed. These check JSON shape only (is it an object, is the
 * field a string or a number); the service applies the business rules.
 */
export function parseCreateProduct(value: unknown): Result<CreateProductBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const sku = readString(record.value, 'sku');
  if (!sku.ok) {
    return sku;
  }
  const name = readString(record.value, 'name');
  if (!name.ok) {
    return name;
  }
  const totalStock = readNumber(record.value, 'totalStock');
  if (!totalStock.ok) {
    return totalStock;
  }
  const base = { sku: sku.value, name: name.value, totalStock: totalStock.value };
  if (record.value.releaseAt === undefined) {
    return ok(base);
  }
  const releaseAt = readDate(record.value, 'releaseAt');
  if (!releaseAt.ok) {
    return releaseAt;
  }
  return ok({ ...base, releaseAt: releaseAt.value });
}

export function parseUpdateProduct(value: unknown): Result<UpdateProductBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const hasStock = record.value.totalStock !== undefined;
  const hasRelease = record.value.releaseAt !== undefined;
  if (!hasStock && !hasRelease) {
    return fail('VALIDATION', 'Provide "totalStock" and/or "releaseAt".');
  }
  let update: UpdateProductBody = {};
  if (hasStock) {
    const totalStock = readNumber(record.value, 'totalStock');
    if (!totalStock.ok) {
      return totalStock;
    }
    update = { ...update, totalStock: totalStock.value };
  }
  if (hasRelease) {
    if (record.value.releaseAt === null) {
      update = { ...update, releaseAt: null };
    } else {
      const releaseAt = readDate(record.value, 'releaseAt');
      if (!releaseAt.ok) {
        return releaseAt;
      }
      update = { ...update, releaseAt: releaseAt.value };
    }
  }
  return ok(update);
}

export function parseReserve(value: unknown): Result<ReserveBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const userId = readString(record.value, 'userId');
  if (!userId.ok) {
    return userId;
  }
  if (record.value.quantity === undefined) {
    return ok({ userId: userId.value, quantity: 1 });
  }
  const quantity = readNumber(record.value, 'quantity');
  if (!quantity.ok) {
    return quantity;
  }
  return ok({ userId: userId.value, quantity: quantity.value });
}

export function parseJoinWaitlist(value: unknown): Result<JoinWaitlistBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const userId = readString(record.value, 'userId');
  return userId.ok ? ok({ userId: userId.value }) : userId;
}

export function parseHoldTime(value: unknown): Result<HoldTimeBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const holdTimeMs = readNumber(record.value, 'holdTimeMs');
  if (!holdTimeMs.ok) {
    return holdTimeMs;
  }
  return ok({ holdTimeMs: holdTimeMs.value });
}

function asRecord(value: unknown): Result<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('VALIDATION', 'Request body must be a JSON object.');
  }
  return ok(value as Record<string, unknown>);
}

function readString(record: Record<string, unknown>, key: string): Result<string> {
  const value = record[key];
  return typeof value === 'string' ? ok(value) : fail('VALIDATION', `"${key}" must be a string.`);
}

function readNumber(record: Record<string, unknown>, key: string): Result<number> {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? ok(value)
    : fail('VALIDATION', `"${key}" must be a number.`);
}

function readDate(record: Record<string, unknown>, key: string): Result<Date> {
  const value = record[key];
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return ok(parsed);
    }
  }
  return fail('VALIDATION', `"${key}" must be an ISO 8601 date-time.`);
}
