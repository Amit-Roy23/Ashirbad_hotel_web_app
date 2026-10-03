**PRODUCT REQUIREMENT DOCUMENT (PRD)**

*Hotel Booking & Operations Management System*

  -----------------------------------------------------------------------
  PROJECT TYPE\           CAPACITY FOCUS\         PRIMARY OBJECTIVE\
  Hotel Operations        30 Guest Rooms          Simplified Billing &
  Management                                      Management
  ----------------------- ----------------------- -----------------------

  -----------------------------------------------------------------------

# 1. Executive Summary

The objective is to develop a lightweight, intuitive and efficient Hotel
Booking & Operations Management Software designed primarily for a
30-room hotel environment. The system shall focus on core operational
efficiency, simple guest/booking management, flexible billing, accurate
internal accounting and a clean interface requiring minimal technical
training for hotel staff.

# 2. Core Functional Requirements

## 2.1 Room Management & Dashboard

-   Room Capacity: Configure the system initially for 30 rooms, while
    keeping the room structure modular so additional rooms can be added
    later.

-   Color-Coded Room Status: Provide automatic visual status indicators,
    e.g. Green for Vacant/Available and Red/Orange for Occupied/Booked.

-   Real-Time View: Dashboard must show current room availability and
    guest status at a glance.

-   Room-wise quick access: Clicking a room should show its current
    guest/booking status and relevant billing information.

-   Room status must update immediately after booking, check-in,
    check-out and room reassignment.

## 2.2 Guest & Booking Module

-   Stay Tracking: Maintain complete records of stay duration, room
    assignment and guest identification.

-   Customer Auto-Fill: Searching a returning guest by phone number
    shall automatically populate saved profile information.

-   Guest Profile: Store Name, Phone, Company and GST details where
    applicable.

-   Booking record should maintain check-in date, check-out date, room,
    guest, booking status and applicable charges.

-   The booking interface should remain simple enough for reception
    staff to operate without complex training.

## 2.3 Special Corporate Billing & Accounts Architecture

-   Custom Corporate Billing: Support customizable invoice line items
    when requested by a client. Example: a customer-facing invoice may
    need to show ₹1,500 + GST even when the hotel\'s actual room tariff
    is ₹1,000 + GST.

-   Internal Ledger Balancing: The customer-facing/custom invoice must
    not overwrite the actual room tariff in the internal financial
    ledger.

-   The internal ledger must retain the actual tariff (e.g. ₹1,000) and
    the applicable GST/tax amount for accurate internal accounting and
    reporting.

-   Customer-facing billing and internal accounting must therefore be
    separate but linked records.

-   Any custom billing adjustment must be permission-controlled and
    auditable.

## 2.4 Additional Operational Modules

-   Payment Breakdown: Track and categorize incoming payments across
    Cash, UPI and Card channels.

-   Food & Dining Billing: Provide an integrated restaurant/food menu
    with an option to post food charges directly to a guest\'s room
    bill.

-   Combined Billing: At checkout, room charges and posted food/dining
    charges must be consolidated into the final guest bill.

-   Staff & Expense Management: Maintain staff details, salary payments,
    salary advances and other operational expense records.

# 3. Detailed Feature Breakdown & System Specifications

  -----------------------------------------------------------------------
  Module                  Core Feature /          Business Requirement /
                          Functionality           Outcome
  ----------------------- ----------------------- -----------------------
  Room Inventory          30-room visual grid     Prevents room-status
                          with real-time color    confusion and improves
                          state updates upon      front-desk response
                          booking, check-in and   speed.
                          check-out.              

  Guest Database          Phone-number based      Reduces repeat data
                          profile fetching for    entry and keeps guest
                          returning guests; store information consistent.
                          name, company and GST   
                          details.                

  Flexible Billing        Custom invoice          Supports
                          generation linked to a  corporate/client
                          separate actual-tariff  billing requirements
                          internal ledger.        without altering
                                                  internal revenue
                                                  records.

  Restaurant / POS        Menu selection with an  Ensures dining charges
                          \'Add to Room\'         are captured and
                          capability; food        consolidated at
                          charges flow into the   checkout.
                          room folio.             

  Payments & Cashflow     Channel-wise collection Provides clear daily
                          ledger for Cash, UPI    cashflow visibility and
                          and Card, plus daily    easier reconciliation.
                          operational expense     
                          logging.                

  Staff Records           Basic staff registry,   Centralizes
                          salary payments, salary staff-related records
                          advances and            and routine operational
                          operational             expenses.
                          disbursement tracking.  
  -----------------------------------------------------------------------

# 4. Billing & Accounting Rules

-   Customer-facing invoice amount and internal actual room tariff must
    be stored separately.

-   Example: Actual room tariff = ₹1,000 + applicable GST; customer
    invoice may be configured as ₹1,500 + applicable GST when
    authorized.

-   The internal ledger continues to record ₹1,000 as the actual room
    tariff and calculates/records the applicable tax according to the
    configured tax rules.

-   Every custom billing action must store who created/approved it,
    date/time, booking/invoice reference and adjustment details.

-   The system should support room charges, food/dining charges,
    discounts/adjustments, tax, advance payment, final payment and
    outstanding balance.

-   Payment collection must be categorized by Cash, UPI and Card.

# 5. Food & Dining / Room Billing

-   Admin can configure food/dining menu items and prices.

-   Restaurant staff can create an order against a table or directly
    against a room.

-   For an in-house guest, staff can select \'Add to Room\' so the
    amount is posted to that guest\'s room folio.

-   At checkout, the system shall show room charges and food/dining
    charges and provide a combined final bill.

-   Food charge entries must retain item, quantity, price, date/time and
    user information.

# 6. Staff & Expense Management

-   Staff records: Name, Phone, Role/Department, Joining Date, Salary
    and Status.

-   Salary payment history with payment date, amount and payment mode.

-   Salary advance records with amount, date, employee and
    adjustment/recovery notes.

-   Operational expenses: petty cash and other hotel expenditure
    entries.

-   Expense categories should be configurable.

-   Daily/monthly expense summaries should be available to management.

# 7. Search, Filters & Data Views

The system shall include practical filtering without making the
interface complex.

-   Global search by guest name, phone number, booking ID, room number
    and invoice/reference number.

-   Booking filters: Date range, room, guest, booking status and payment
    status.

-   Room filters: Floor, room number, room type and current status.

-   Payment filters: Date, payment channel (Cash/UPI/Card),
    booking/guest and payment status.

-   Expense filters: Date range, category, staff/vendor and payment
    mode.

-   Staff filters: Name, department/role and status.

-   All tables should support Search, Filter, Reset, Sort, Pagination
    and Export where applicable.

# 8. Light Mode & Dark Mode

The application must support both Light Mode and Dark Mode. The mode
selector should be available from the main application header or
Settings and should apply consistently across the entire system.

-   Light Mode: Clean, high-contrast professional interface suitable for
    normal daytime hotel operations.

-   Dark Mode: Dark background with readable text and clearly
    distinguishable status indicators for low-light environments.

-   Theme preference should persist for each user/browser after
    selection.

-   All pages, tables, cards, forms, modals, dropdowns, charts,
    room-status indicators and notifications must support both themes.

-   Do not use color alone to communicate critical room/payment status;
    include text labels/icons as well.

-   Theme switching must not change data, permissions, booking status or
    billing calculations.

# 9. Non-Functional Requirements

## 9.1 Simplicity & Usability

The UI must be clean, uncluttered and intuitive. Operators with basic
computer skills should be able to perform regular booking,
check-in/check-out, guest search, food-charge posting and billing
without complex navigation.

## 9.2 Performance & Stability

The application should provide fast response times, low-latency
dashboard refreshes and reliable database operations to support
uninterrupted front-desk activity.

## 9.3 Responsive Design

-   Desktop-first for hotel front-desk use, with responsive support for
    tablet and mobile.

-   Critical workflows such as room status, guest search, booking and
    billing must remain usable on smaller screens.

## 9.4 Data Integrity & Security

-   Prevent double-booking of the same room for overlapping confirmed
    stays.

-   Use role-based permissions for billing adjustments and sensitive
    records.

-   Maintain audit history for booking changes, custom billing
    adjustments, payments and refunds/adjustments.

-   Protect guest and financial data using standard secure
    authentication and input validation.

# 10. Core User Workflows

## 10.1 New Booking

Check Availability → Select Room → Enter/Search Guest → Guest Details
Auto-Fill if Existing → Enter Stay Details → Save Booking → Room Status
Updates.

## 10.2 Returning Guest

Enter Phone Number → Search Existing Guest → Fetch Saved
Name/Company/GST Details → Confirm/Edit Details → Create New Stay.

## 10.3 Check-in

Open Booking → Verify Guest → Confirm Room → Record Check-in → Room
Status becomes Occupied → Open Guest Folio.

## 10.4 Food Charge to Room

Select Menu Item → Enter Quantity → Select Guest/Room → Add to Room →
Food Charge appears in the room folio.

## 10.5 Checkout & Combined Billing

Open Guest Folio → Review Room Charges + Food Charges + Adjustments/Tax
→ Apply Authorized Custom Customer-Facing Billing if required → Record
Payment → Generate Final Invoice → Checkout → Room becomes Vacant/Dirty
according to configured housekeeping workflow.

## 10.6 Payment Recording

Select Booking/Invoice → Enter Amount → Select Cash/UPI/Card → Save
Payment → Update Paid/Outstanding Balance → Add Transaction to Payment
Ledger.

# 11. Dashboard Requirements

-   Live room availability and occupancy overview.

-   Visual room grid with status colors and text labels.

-   Today\'s arrivals and departures.

-   Current in-house guests.

-   Today\'s collection summary by Cash, UPI and Card.

-   Pending/outstanding amount.

-   Daily operational expense summary.

-   Quick access to New Booking, Guest Search, Check-in, Checkout and
    Add Payment.

# 12. Reports

-   Room occupancy and room-status report.

-   Booking/stay report.

-   Guest report and returning-guest history.

-   Daily/monthly collection report by Cash, UPI and Card.

-   Room revenue report based on internal actual tariff.

-   Customer-facing invoice/billing report.

-   Food/dining sales and room-posted food charges.

-   Staff salary and advance report.

-   Daily/monthly expense report.

-   Outstanding payment report.

# 13. Suggested Application Navigation

Dashboard \| Rooms \| Bookings \| Guests \| Front Desk \| Billing \|
Restaurant/Food \| Payments \| Staff \| Expenses \| Reports \| Settings

# 14. Settings

-   Hotel information and contact details.

-   Room and room-type configuration.

-   Tax/GST configuration.

-   Invoice settings and numbering.

-   Payment modes.

-   Food/menu configuration.

-   Staff roles and permissions.

-   Custom billing permissions.

-   Light/Dark theme preference.

# 15. Initial Scope vs Future Scope

## 15.1 Initial Client Scope

-   30-room room management and dashboard.

-   Guest database with phone-based auto-fill.

-   Booking and stay tracking.

-   Flexible/custom corporate billing with separate internal ledger.

-   Cash/UPI/Card payment tracking.

-   Food/menu and Add-to-Room billing.

-   Combined final billing.

-   Staff records, salary, advances and operational expenses.

-   Simple, fast and user-friendly interface.

-   Light Mode + Dark Mode.

## 15.2 Future-Ready / Optional Scope

-   Online booking engine.

-   Payment gateway integration.

-   WhatsApp/SMS/email automation.

-   OTA/channel manager integrations.

-   Advanced restaurant POS/KOT.

-   Housekeeping task management.

-   Maintenance ticketing.

-   Multi-property management.

-   Advanced analytics and night audit.

# 16. Acceptance Criteria

-   Room status changes immediately after booking, check-in and
    checkout.

-   The system supports the initial 30-room configuration and permits
    future room additions.

-   Entering a registered phone number retrieves the saved guest
    profile, including company and GST details where stored.

-   A returning guest can be reused for a new stay without re-entering
    all profile data.

-   A custom customer-facing invoice can be generated without
    overwriting the actual room tariff in the internal ledger.

-   Internal ledger retains the actual tariff and applicable tax
    information for reporting.

-   Food/dining charges can be posted directly to a guest\'s room bill.

-   Final checkout can consolidate room and food/dining charges into one
    bill.

-   Payments are separately categorized as Cash, UPI or Card.

-   Staff salary, salary advance and operational expense records can be
    stored and reported.

-   Major lists support search/filter/reset; filters do not break
    existing records.

-   Light Mode and Dark Mode work across all application screens and the
    selected preference persists.

-   The UI remains simple and fast enough for routine front-desk
    operations.

# 17. Definition of Done

-   All initial client-scope modules are functional and connected to a
    persistent database.

-   Core booking, guest, room, billing, payment and food-charge data
    remain synchronized.

-   Custom billing does not corrupt internal actual-tariff accounting.

-   Role/permission controls work for sensitive operations.

-   Search and filters work on all major operational lists.

-   Light and Dark themes are complete across the application.

-   Responsive layout is tested on desktop, tablet and mobile.

-   End-to-end UAT passes for booking → guest auto-fill → check-in →
    food charge → payment → combined billing → checkout.
