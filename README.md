# Hotel Management System — Ashirbad Lodge

A full-stack, enterprise-grade Hotel Operations & Property Management System (PMS) built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS 4**, **Shadcn UI**, **Prisma ORM**, and **Supabase PostgreSQL**.

---

## 🌟 Key Capabilities
- **Front-Desk Dashboard & Room Management**: Real-time room status grid (Vacant, Occupied, Maintenance, Reserved) with instant check-in/checkout modals.
- **GST Billing & Invoicing**: Automated calculation of room charges, food orders, GST tax, advance deductions, and corporate billing.
- **Guest Profiles & Ledger**: Complete stay history, GSTIN details, and contact management.
- **Restaurant POS**: In-house food ordering & room bill auto-merging.
- **Staff & Expense Tracker**: Staff attendance, payout history, and categorized operational expense tracking.
- **Financial Reports & Audit Trail**: Comprehensive revenue reporting, cash/UPI/Card breakdowns, and full audit logs.

---

## 🚀 Setup & Local Development

### 1. Prerequisites
- **Node.js**: v18+ or **Bun** / **npm**
- **PostgreSQL Database** (e.g., Supabase instance)

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in your connection details:

```bash
cp .env.example .env
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup & Migrations
```bash
npm run db:push
npm run db:seed
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠 Tech Stack
- **Framework**: Next.js 16 (App Router)
- **UI Components**: Shadcn UI & Lucide Icons
- **Styling**: Tailwind CSS 4
- **ORM & DB**: Prisma ORM with PostgreSQL (Supabase)
- **State & Validation**: Zustand & Zod
