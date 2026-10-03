# Security & Compliance Guidelines

## 1. Authentication & Identity
- User sessions are assigned role-based capabilities (`ADMIN`, `MANAGER`, `RECEPTION`).
- User actions are tagged via request headers (`X-User-Id`, `X-User-Name`, `X-User-Role`) and passed directly into `AuditLog` records for non-repudiation.

## 2. Secrets & Environment Configuration
- Database credentials and API secret keys MUST NOT be hardcoded in client scripts or committed to source control.
- Configuration variables are parsed and validated via Zod in `src/lib/config.ts`.
- Database connection strings utilize transaction pooling (`DATABASE_URL`) for serverless environments and direct connection (`DIRECT_URL`) for migrations.

## 3. Data Sanitization & Input Validation
- Phone numbers are validated against standard 10-digit mobile number patterns (`/^[6-9]\d{9}$/`).
- Numeric amounts (rates, payments, discounts) are parsed and bounded to prevent negative or infinite values.
- SQL injection risks are mitigated by using Prisma ORM parameterized queries exclusively.

## 4. Audit Trail
- High-risk operations (custom bill creation, deletion of rooms/guests/bills, staff payouts, rate modifications) automatically write immutable records to the `AuditLog` table.
