# ADR 0004 — The waiting list is promoted inside the product's lock, driven by one sweeper

**Status:** accepted, 2026-09-23

## Context

A coming-soon product takes a first-come-first-served waiting list; at its release time the first
in line must receive holds automatically, and a hold that expires or is cancelled must pass to
the next person. Something has to happen at a moment when nobody is sending a request, and the
hand-over must be as safe against races as a direct reservation.

## Decision

`InventoryService.#promote(sku, now)` is the whole rule: settle offered entries by what became of
their hold (Confirmed → Bought; Cancelled or Expired → Passed), then, if the product is released,
offer holds to `Waiting` entries in order while stock is free. It runs **inside the product's
lock**, after every write to that product, and from `processWaitlists()`, which the server calls
once a second and which takes each product's lock in turn. It is idempotent.

Fairness is enforced in `reserve`: while anyone is `Waiting`, a direct reservation fails with
`WAITLIST_ACTIVE`; before release it fails with `NOT_RELEASED`. One unit per place, one place per
person.

Rejected: a timer per release time or per offer (lost on restart, untestable without waiting,
unbounded); promotion in `snapshot()` (a read would become a write); letting direct buyers race
the queue (makes the queue meaningless at the moment it matters).

## Consequences

- Offers are made by the same code path and under the same lock as any other reservation, so the
  500-join test and the 500-reserve test share one story.
- Release and pass-on happen within a second of the moment, not at it. Tests drive `promote`
  directly with a fake clock; the sweeper has one real-time smoke test.
- The sweeper also makes expiry recording timely for every product, which softens the lazy-expiry
  caveat in ADR 0003.
- Scope is still one process: the sweeper and the locks live together. Across instances the same
  "one writer per SKU" design applies.
