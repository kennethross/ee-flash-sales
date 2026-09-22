import { fail, ok, type Result } from '../domain/failures';

export interface CreateProductBody {
  readonly sku: string;
  readonly name: string;
  readonly totalStock: number;
}

export interface AdjustStockBody {
  readonly totalStock: number;
}

export interface ReserveBody {
  readonly userId: string;
  readonly quantity: number;
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
  return ok({ sku: sku.value, name: name.value, totalStock: totalStock.value });
}

export function parseAdjustStock(value: unknown): Result<AdjustStockBody> {
  const record = asRecord(value);
  if (!record.ok) {
    return record;
  }
  const totalStock = readNumber(record.value, 'totalStock');
  if (!totalStock.ok) {
    return totalStock;
  }
  return ok({ totalStock: totalStock.value });
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
