# ADR 0001 — The store is asynchronous even though it is a Map

**Status:** accepted, 2026-09-22

## Context

The brief keeps inventory in memory. In Node, a synchronous `Map` read-then-write cannot be
interrupted, so a mutex around it would be decorative and the 500-request test would pass without
any lock. The brief nonetheless grades concurrency handling and a locking-strategy explanation.

## Decision

`InventoryStore` returns promises. `InMemoryStore` implements it with two Maps and
`Promise.resolve`. Nothing else in the codebase knows the store is in memory.

## Consequences

- `await` between read and write is a real interleaving point: verified with a throwaway script
  (500 of 1 sold with no lock) and kept as the test `WITHOUT the lock the same load oversells`.
- The interface is where a database goes; the service does not change.
- Cost: the word `await` in front of store calls.
