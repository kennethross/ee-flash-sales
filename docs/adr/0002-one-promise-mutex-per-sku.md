# ADR 0002 — One promise-chain mutex per SKU

**Status:** accepted, 2026-09-22

## Context

Every write is load → decide → save across an `await`. Two callers for the same product must not
interleave; callers for different products should not wait for each other. Node has no built-in
mutex for ordinary code.

## Decision

`Mutex.runExclusive` chains each task after the previous one's settled promise. `KeyedMutex` holds
one `Mutex` per SKU. `InventoryService` wraps every write in `withLock(sku, …)`; reads take no lock.

Rejected: a single global mutex (needless serialisation across products); the `async-mutex`
package (ten lines are easier to explain than a dependency); the Web Locks API (present in Node 24
but not something I would build a submission on without checking its status); worker threads with
`Atomics` (true parallelism, but the state would be raw integers in shared memory).

## Consequences

- Fair and deadlock-free by construction; a throwing task does not block the queue.
- Throughput per product is bounded by the locked section's length; keep it to load → decide → save.
- Scope is one process. Beyond that the decision moves into the shared store (see README).
