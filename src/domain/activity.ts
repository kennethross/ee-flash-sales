export type ActivityType =
  | 'product-created'
  | 'stock-adjusted'
  | 'product-deleted'
  | 'hold-time-changed'
  | 'reserved'
  | 'rejected'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'reset';

/** The actor recorded for configuration actions, as opposed to a user id. */
export const INVENTORY_ACTOR = 'inventory';

/** One line of the audit trail: who did what, and when. */
export interface ActivityEvent {
  readonly seq: number;
  readonly at: Date;
  readonly type: ActivityType;
  readonly actor: string;
  readonly message: string;
}

/** What the service records; the store assigns `seq`. */
export type NewActivityEvent = Omit<ActivityEvent, 'seq'>;
