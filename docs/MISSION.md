# Mission: Everest Engineering (EE) Coding Challenge

**Goal:** land the interview. Submit one coding challenge that reads as production-quality code
written and reviewed by an experienced engineer.

- **Captured:** 2026-09-18
- **Deadline:** 5 calendar days from receipt → target submission by **2026-09-23** (extension negotiable via WhatsApp/email with the recruiter)
- **Choose ONE** of the two attached challenges.

## Recruitment journey

`Phone Screen → Coding Challenge → Technical Round 1 → Technical Round 2 → Client Engineering Round → Offer Stage & Reference Checks`

Each stage evaluates different aspects: technical capability, engineering mindset, collaboration, problem-solving.

## Submission

Any one of: GitHub/GitLab repo · ZIP file · Google Drive link · reply to the recruiter email with the solution attached.

### AI disclosure (required if AI is used — and it is explicitly encouraged)

Must disclose:
1. Which AI tool(s) were used?
2. How were they used?
3. What portions of the solution were AI-assisted?
4. Any prompts or workflow worth sharing (optional)?

> "Ultimately, you're responsible for everything you submit, as the technical team will assess the
> final solution as though it were production-quality code written and reviewed by an experienced
> software engineer."

### What they explicitly value

- SOLID principles
- Test-Driven Development (TDD)
- Clean, readable, maintainable code
- Appropriate use of Object-Oriented Programming
- Meaningful design patterns where applicable

> **TIP (highlighted in the brief):** "Think of your submission as code that another engineer will
> need to understand, maintain, and build upon."

### Evaluation criteria

- Problem-solving approach and overall solution design
- Code structure and maintainability
- Correctness and completeness of requirements
- Edge case handling
- Test coverage and quality
- Error handling
- **Git commit history** (if using Git)
- Overall production readiness

### Optional README (recommended)

Outline: approach · design decisions · assumptions made · trade-offs considered · areas you'd improve with more time.

---

# Challenge A — Robot Work Allocation System (EverBot Solutions)

Terminal-based application.

## Domain

EverBot Solutions is a robotics services company. Robots perform automated client work.
Each robot works **once per day** for its max hours, then recharges.
Clients submit work requests measured in **total hours**.

| Robot type | Working hours/day | Charging cost/day |
|---|---|---|
| Bravo   | 3 | $2 |
| Charlie | 5 | $3 |
| Delta   | 8 | $4 |

## General rules

- A robot cannot be used more than once per day (each robot used once per allocation).
- Combined robot hours need **not** match client hours exactly, but must be **≥** requested.
  (e.g. client needs 16 → 17 or 18 is fine, 15 is not.)
- If work cannot be fulfilled: `Error: Insufficient robot capacity to complete the requested work.`

## Level 1 — Robot Category Distribution

Evaluate performance across robot categories for future purchases.

Goals (in order):
1. **Primary:** include multiple categories when feasible.
2. Respect robot availability constraints.
3. Robot hours provided ≥ hours requested.
4. Minimise excess hours — pick the robot that minimises excess.

Examples: 17 hrs → pick Bravo (extra); 24 hrs → pick Delta (extra); 21 hrs → pick Charlie (extra).

Sample I/O (16 hours requested):
```
Enter number of robots available:
Bravo: 2
Charlie: 3
Delta: 2
Enter client work hours:
16

Robot Assignment
Bravo: 1
Charlie: 1
Delta: 1
Total Work Hours Provided: 16
Client Work Hours Requested: 16
```

## Level 2 — Cost Optimised Allocation

Allocate purely on cost efficiency. **Ignore** the Level 1 multi-category requirement.
Minimise total charging cost while fulfilling requested hours.

Example 1: available Bravo 2 / Charlie 3 / Delta 2, request 20 →
```
Cost Optimized Allocation
Charlie: 1
Delta: 2
Total Hours Provided: 21
Total Charging Cost: $11
```

Example 2: available Bravo 2 / Charlie 2 / Delta 3, request 6 →
```
Cost Optimized Allocation
Bravo: 2
Total Hours Provided: 6
Total Charging Cost: $4
```

### Additional requirement — Level 1 vs Level 2 comparison

The system must compare both solutions:
```
Level 1 Cost: $12
Level 2 Cost: $11
Cost Difference: $1
Insight:
Level 1 strategy resulted in $1 additional cost due to mandatory usage of multiple robot categories.
```
Helps the company understand the financial impact of the performance-analysis strategy.

## Level 3 — Standby Robot Activation

The company maintains a warehouse of standby robots not currently active.
Activate when client hours exceed active capacity. Same hours/cost rules apply.
Determine which standby robots and how many of each type; choose the **cost-optimised** standby option.

Example expected output:
```
Active Robot Capacity: 16 hours
Client Work Requested: 21 hours
Active robots:
Bravo: 1
Charlie: 1
Delta: 1
Additional Standby Robots Required:
Bravo: 2 - cost $4
or
Delta: 1 - cost $4
or
Charlie: 1 - cost $3
```
Output should show **Charlie: 1** as it is the cost-optimised one.

## Level 4 — Serving Multiple Clients

- Prioritise allocation by **highest hours requested** first.
- If active robots are insufficient, list standby robots needed to satisfy clients' hours.
- Input parsing must accept single value, comma-separated, or space-separated:
  - `Client working hours:20`
  - `Client working hours:12,16,17,10,21`
  - `Client working hours:12 16 17 10 21`

## Error handling

| Case | Message |
|---|---|
| Impossible allocation | `Error: Unable to allocate at least one robot from each category with the available inventory.` |
| Zero robots | `Error: No robots available for assignment.` |
| Invalid input | `Error: Work hours must be a positive integer.` |
| Insufficient capacity | `Error: Insufficient robot capacity to complete the requested work.` |

## Additional constraints

1. Robot counts must be non-negative integers.
2. Client work hours must be positive integers.
3. Each robot can only be used once per allocation.

## Bonus (optional)

Multiple clients — process multiple work requests, e.g. `Clients: [16, 10, 22, 7]`.

---

# Challenge B — Inventory Reservation System

Backend challenge: preventing overselling in high-concurrency flash-sale systems.
**Estimated completion time stated in the brief: 2–3 hours.**

## Scenario

Flash sales generate extreme traffic: limited-stock products, hundreds of users clicking "Buy"
simultaneously. Without concurrency control, multiple users may reserve the same item → overselling.

## Objectives

1. Prevent overselling
2. Handle concurrent requests
3. Manage temporary reservations
4. Maintain consistent state

## Reservation concept

`User Reserves Item → Inventory Locked → Confirm or Cancel → Auto-Release on Expiry`

Hold time: **2 minutes**. Expired reservations automatically release inventory.

## Business rules

```
Available Stock = Total Stock − Confirmed Sales − Active Reservations
```
- Reservations exceeding available stock must fail.
- Confirmed purchases cannot be reversed.
- Only one user can reserve the last item.
- Expired reservations release inventory automatically.

## Levels

**Level 1 — Basic Inventory Reservation**
- Maintain inventory in memory
- Implement reserve-item operation
- Reject requests when stock unavailable

**Level 2 — Reservation Lifecycle & Expiry**
- States: `Active`, `Confirmed`, `Cancelled`, `Expired`
- Hold stock for 2 minutes
- Confirm → purchase completed; Cancel/expiry → inventory released
- Example: stock = 1 → User A succeeds, User B fails

**Level 3 — Concurrency Handling**
- Goal: prevent race conditions
- Techniques: mutex/locks, atomic operations, thread-safe structures
- Test scenario: stock = 1, 500 simultaneous requests
- Expected result: 1 successful reservation, 499 failures

## Testing & evaluation

- Unit tests for reservation logic
- Concurrency tests with parallel requests
- Criteria: correctness · concurrency handling · expiry logic · code quality ·
  **clear locking-strategy explanation**

---

# Decision notes

- [x] Challenge chosen: **A — Robot Work Allocation System** (2026-09-18)
- [x] Language/stack: **TypeScript strict + Vitest** (2026-09-18)
- [ ] Submission method: open — private GitHub repo with the reviewer invited is recommended (see `docs/working/SUBMISSION-CHECKLIST.md`)
- [x] Code complete, reviewed and written up: 2026-09-21 (150 tests; fresh-clone check passed)

Design spec: `docs/superpowers/specs/2026-09-21-ee-robot-allocation-design.md`
Decision record: `docs/working/JOURNAL.md`

Source PDFs:
- `~/Downloads/Robot work allocation system_EE.pdf`
- `~/Downloads/Inventory Reservation System Everest Coding challenge.pdf`
