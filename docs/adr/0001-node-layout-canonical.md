# ADR 0001: Canonical Node Layout Fields

- Status: Accepted
- Date: 2026-04-02
- Owners: Backend + Frontend maintainers

## Context

Historically, node layout and collapse state were stored in `Node.properties`:

- `properties.x`
- `properties.y`
- `properties.collapsed`

This made core fields indistinguishable from extensible attributes and created coupling between API mapping, repository persistence, and frontend runtime behavior.

`Node` now has first-class columns:

- `Node.x`
- `Node.y`
- `Node.collapsed`

We need one stable source of truth and a controlled migration window.

## Decision

1. Canonical fields:
- `Node.x`, `Node.y`, and `Node.collapsed` are the only canonical layout/collapse fields.

2. `properties` responsibility:
- `Node.properties` is reserved for extensible attributes only (for example: `shape`, `color`, `style`).
- New writes must not store `x/y/collapsed` under `properties`.

3. Compatibility window:
- Compatibility window is one release cycle.
- During compatibility window:
  - Read fallback from legacy `properties.x/y/collapsed` is allowed.
  - Write fallback to legacy `properties.x/y/collapsed` is forbidden.

4. Enforcement path:
- API contract, DTO mapping, repository update logic, and frontend adapters must align with canonical fields.
- After the compatibility window, fallback read logic will be removed.

## Consequences

Positive:

- Lower cross-layer coupling.
- Clear field ownership between core schema and extensible metadata.
- Easier evolution for future layout fields.

Trade-offs:

- Requires a one-time backfill for existing data.
- Temporary dual-read logic during compatibility window.

## Reserved Legacy Keys

The following keys are reserved and must not be written into `properties`:

- `x`
- `y`
- `collapsed`

## Rollout Checklist

1. Repository writes canonical fields only.
2. HTTP request/response DTOs expose canonical fields.
3. Create-node and seed paths write canonical fields.
4. One-time idempotent backfill migrates legacy values.
5. OpenAPI and generated frontend contracts are synchronized.
6. Frontend runtime reads canonical fields first and fallback reads only within compatibility window.
7. CI blocks contract drift and catches new writes to reserved legacy keys.
