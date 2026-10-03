# Architecture Documentation — Hotel Management System

## 1. System Overview
The Hotel Management System is a full-stack Next.js application built with TypeScript, Tailwind CSS, Shadcn UI, Prisma ORM, and PostgreSQL (hosted on Supabase).

## 2. Directory Structure & Domain Architecture

```text
src/
├── app/                        # Next.js App Router & API Controllers
│   ├── api/[...path]/route.ts  # Central API Dispatcher
│   ├── layout.tsx              # Root Layout & Global Providers
│   └── page.tsx                # Main Application Shell
├── components/
│   ├── ui/                     # Design System & Accessible UI Primitives
│   └── hotel/                  # Hotel Domain Views (Rooms, Bookings, Guests, etc.)
├── features/                   # Domain-Driven Modules
│   ├── rooms/                  # Room management logic & validations
│   ├── bookings/               # Booking & check-in lifecycle
│   ├── guests/                 # Guest profiles & history
│   ├── billing/                # GST invoice calculation & payment status
│   ├── restaurant/             # Menu management & POS food ordering
│   ├── staff/                  # Staff directory & payout tracking
│   ├── expenses/               # Operational expense entries & categories
│   ├── reports/                # Financial summary & analytics
│   └── settings/               # System configuration
├── services/                   # Infrastructure Services
│   ├── audit-logger.ts         # Centralized audit logging service
│   └── prisma.ts               # Shared Prisma DB Client
└── lib/                        # Common Utilities & Config
    ├── config.ts               # Safe Environment Config & Zod Validation
    ├── hotel-utils.ts          # Formatting, Math & CSV export helpers
    └── supabase.ts             # Supabase Client Credentials
```

## 3. Data & Business Logic Flow

```text
User Interface (React / Shadcn)
            │
            ▼
API Client / Fetch Hooks
            │
            ▼
API Dispatcher (App Router)
            │
            ▼
Zod Input Validation Schema
            │
            ▼
Domain Services (RoomService, BookingService, etc.)
            │
            ▼
Prisma ORM & Audit Logger
            │
            ▼
Supabase PostgreSQL Database
```
