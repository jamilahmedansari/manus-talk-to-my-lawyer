# Talk-to-My-Lawyer — Comprehensive Gap Analysis

**Audited: 2026-02-25** | Based on: Google Doc Feature Map + Pasted Feature Prompt + Codebase Audit

---

## DONE — Working Features (DO NOT BREAK)

### Subscriber Journey
- [x] Multi-step intake form (6 steps: type, jurisdiction, parties, story, outcome, evidence)
- [x] Attachment upload in submit flow (S3 via storagePut)
- [x] AI pipeline: Perplexity research → Anthropic draft → Anthropic assembly
- [x] Status transitions: submitted → researching → drafting → generated_locked → pending_review → under_review → approved
- [x] Letter Detail page with status timeline and intake summary
- [x] LetterPaywall: blur + overlay for locked letters, first-letter-free check
- [x] My Letters list with status badges and filters
- [x] PDF download (server-generated via PDFKit + S3)
- [x] Onboarding welcome modal for new subscribers
- [x] FAQ page + inline FAQ on homepage
- [x] Role-based routing via ProtectedRoute component
- [x] Toast notifications on all key actions

### Attorney/Employee Review Center
- [x] Review queue (pending_review / under_review / needs_changes)
- [x] Review detail with intake panel, attachments, AI draft, research panel
- [x] All 5 review actions: claim, save edit, request changes, approve, reject
- [x] Claim → subscriber notification (email + in-app)
- [x] Approve → PDF generation → S3 upload → pdfUrl stored → email with link

### Admin Portal
- [x] Admin dashboard with system overview
- [x] All Letters view with search
- [x] Failed jobs monitor + retry
- [x] Force status transition
- [x] User role management

### Backend
- [x] Stripe webhook handler (checkout.session.completed → letter unlock)
- [x] Email notifications via Resend (letter ready, under review, approved, needs changes, rejected)
- [x] tRPC procedure guards (subscriberProcedure, employeeProcedure, adminProcedure)
- [x] All 7 database indexes
- [x] Pipeline retry logic with error handling

---

## GAPS — Features Still Needed (Priority Order)

### GAP 1: Role Split — Attorney vs Employee ✅ IMPLEMENTED
**Current:** 4 roles: `subscriber`, `employee`, `attorney`, `admin`. The `attorney` role has its own `attorneyProcedure` guard and uses `/attorney/*` route paths (with backward-compat `/review/*` aliases).
**Implemented:**
- [x] `attorney` added to `userRoleEnum` in `drizzle/schema.ts`
- [x] `attorneyProcedure` guard in `server/routers.ts`
- [x] Review center routes at `/attorney/queue` and `/attorney/:id` (+ `/review/*` backward-compat aliases)
- [x] `AttorneyDashboard` at `/attorney`
- [x] `ProtectedRoute` handles `attorney` role in `App.tsx`
- [x] `auth.completeOnboarding` supports `attorney` role

### GAP 2: Onboarding Role Selection ✅ IMPLEMENTED
**Current:** Post-signup `/onboarding` page exists with role selection (Subscriber / Employee / Attorney). `auth.completeOnboarding` tRPC mutation handles role assignment and auto-generates affiliate discount codes for employees.
**Implemented:**
- [x] `/onboarding` route in `App.tsx` with `Onboarding` page component
- [x] `auth.completeOnboarding` mutation (role: subscriber | employee | attorney)
- [x] Auto-generates discount code for employee role on onboarding
- [x] Role-specific confirmation messages

### GAP 3: Employee Affiliate System (MEDIUM PRIORITY)
**Current:** No affiliate/discount/commission system exists at all.
**Required:** Full affiliate portal with discount codes, referral stats, commission tracking, payout requests.

- [ ] Add discount_codes table (code, employeeId, usageCount, etc.)
- [ ] Add commission_ledger table (employeeId, transactionId, amount, status)
- [ ] Add payout_requests table (employeeId, amount, status)
- [ ] Backend: auto-generate discount code on employee signup
- [ ] Backend: commission calculation on Stripe payment with discount code
- [ ] Employee dashboard: earnings widgets, referral stats, copy code button
- [ ] Employee payout request workflow

### GAP 4: Subscriber Feature Completion (MEDIUM PRIORITY)
- [ ] Copy to clipboard button (when letter is unlocked/approved)
- [ ] Soft delete draft (add deletedAt column, filter in queries)
- [ ] Resume unfinished draft / "Finish Draft" button on dashboard
- [ ] Better processing progress modal with real step messages (researching → drafting → finalizing)
- [x] In-app payment receipts page (`/subscriber/receipts` with `billing.receipts` tRPC query) — ✅ Done

### GAP 5: Intake Form Missing Fields (MEDIUM PRIORITY)
- [ ] Language field (dropdown: English, Spanish, French, etc.)
- [ ] Deadlines field (structured date + description)
- [ ] Communications history field (textarea for prior correspondence)
- [ ] toneAndDelivery as proper object (not just tonePreference string)

### GAP 6: Homepage Enhancements (LOW PRIORITY)
- [ ] Hero section animated typing effect
- [ ] Trust signals: SSL badge, Stripe verified logo, testimonials
- [ ] "How it Works" timeline with icons (currently exists but could be enhanced)

### GAP 7: Admin Dashboard Enhancements (LOW PRIORITY)
- [ ] Financial charts (revenue, MRR, affiliate payouts)
- [ ] SLA countdown timers on review queue (letters pending > 24h)
- [ ] User management: ban/revoke access, adjust employee balance

### GAP 8: Email Completeness (LOW PRIORITY)
- [ ] Welcome email on signup
- [ ] Payment receipt email
- [ ] "Action Required" alert to attorney when $50 review is paid

### GAP 9: Pricing Consistency (LOW PRIORITY)
- [ ] Ensure $10 unlock fee + $50 attorney review fee are separate and consistent
- [ ] Pricing page feature comparison table
- [ ] "Contact Enterprise Sales" button

---

## Implementation Priority Order

1. **GAP 1 + GAP 2**: Role split + onboarding (foundation for everything else)
2. **GAP 4**: Subscriber feature completion (copy, soft delete, resume draft, progress modal)
3. **GAP 5**: Intake form missing fields
4. **GAP 3**: Employee affiliate system (largest new feature)
5. **GAP 6-9**: Polish items
