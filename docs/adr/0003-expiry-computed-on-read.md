# ADR 0003 — Expiry is computed from `expiresAt`, not scheduled

**Status:** accepted, 2026-09-22

## Context

Reservations expire after the hold time. The obvious implementation is `setTimeout` per
reservation, which does not survive a restart, cannot be tested without waiting or faking timers,
and grows with the number of reservations.

## Decision

A reservation stores `expiresAt`. `available()` counts it only while `expiresAt > now`. Inside a
lock, `expireIfDue` records overdue reservations as `Expired` when the product is next loaded;
`snapshot()` reports the effective state without writing. A reservation is expired at `expiresAt`
exactly.

## Consequences

- Stock returns at the exact moment, with no timer and no background work.
- Tests use a fake clock and check the boundary to the millisecond.
- Stored state can lag reality until the next write to that product; a sweeper is listed as an
  improvement, not built.
