# manus-talk-to-my-lawyer Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches development patterns for manus-talk-to-my-lawyer, a TypeScript/Vite application that appears to be a legal services platform with role-based access control, payment integration via Stripe, and email notifications. The codebase follows a structured approach with tRPC for API communication, Drizzle for database management, and a phase-driven development methodology with comprehensive testing.

## Coding Conventions

### File Naming
- Use **camelCase** for file names
- Page components: `client/src/pages/{role}/ComponentName.tsx`
- Router files: `server/routers/routerName.ts`
- Test files: `*.test.*` pattern

### Import/Export Style
```typescript
// Mixed export style - use named exports for utilities, default for components
export const utilityFunction = () => {};
export default function ComponentName() {}

// Alias imports preferred
import { procedure as p } from './guards';
import type { User } from '../types';
```

### Project Structure
```
client/src/
├── pages/{role}/          # Role-based page organization
├── components/
│   ├── shared/           # Shared components like AppLayout
│   └── ProtectedRoute.tsx
└── App.tsx

server/
├── routers/              # tRPC procedure definitions
│   ├── _guards.ts       # Role-based access control
│   └── index.ts         # Router exports
├── email.ts             # Email template functions
├── stripe.ts            # Payment logic
└── phase*.test.ts       # Phase-driven test files

drizzle/
├── schema.ts            # Database schema definitions
├── *.sql               # Migration files
└── meta/               # Migration metadata
```

## Workflows

### tRPC Procedure Addition
**Trigger:** When adding new backend functionality accessible via frontend  
**Command:** `/add-trpc-procedure`

1. Add procedure to appropriate router file in `server/routers/`
   ```typescript
   // server/routers/routerName.ts
   export const newProcedure = guardedProcedure
     .input(z.object({ /* validation schema */ }))
     .query(async ({ input, ctx }) => {
       // Implementation
     });
   ```

2. Add role-based guard using `_guards.ts` procedures
   ```typescript
   import { requireRole } from './_guards';
   
   export const protectedProcedure = requireRole(['admin', 'user'])
     .input(/* ... */)
     .mutation(/* ... */);
   ```

3. Update `server/routers/index.ts` to export new procedure
   ```typescript
   export const appRouter = router({
     // existing routers...
     routerName: routerNameRouter,
   });
   ```

4. Wire frontend component to call new procedure
   ```typescript
   const { data, isLoading } = trpc.routerName.newProcedure.useQuery(input);
   ```

### Database Schema Migration
**Trigger:** When database structure needs to change  
**Command:** `/add-database-migration`

1. Update `drizzle/schema.ts` with new columns/tables
   ```typescript
   export const newTable = pgTable('new_table', {
     id: serial('id').primaryKey(),
     // other columns...
   });
   ```

2. Generate migration file in `drizzle/*.sql`
   ```sql
   CREATE TABLE IF NOT EXISTS "new_table" (
     "id" serial PRIMARY KEY NOT NULL,
     -- other columns...
   );
   ```

3. Update `drizzle/meta/*.json` metadata files
4. Update `drizzle/meta/_journal.json` with new migration entry
5. Apply migration to Supabase database

### Email Template Integration
**Trigger:** When new email notifications need to be sent to users  
**Command:** `/add-email-template`

1. Add email template function to `server/email.ts`
   ```typescript
   export const sendNewNotificationEmail = async (to: string, data: any) => {
     // Email template and sending logic
   };
   ```

2. Wire email sending into appropriate router procedure
   ```typescript
   // In router file
   .mutation(async ({ input, ctx }) => {
     // Business logic...
     await sendNewNotificationEmail(user.email, data);
   });
   ```

3. Add email trigger logic in business flow
4. Create tests for email functionality in `server/phase*-*.test.ts`

### Role-Based Page Creation
**Trigger:** When adding new user interface pages for specific roles  
**Command:** `/add-role-page`

1. Create page component in `client/src/pages/{role}/`
   ```typescript
   // client/src/pages/admin/NewAdminPage.tsx
   export default function NewAdminPage() {
     return <div>Admin content</div>;
   }
   ```

2. Add route to `client/src/App.tsx` with ProtectedRoute wrapper
   ```typescript
   <Route path="/admin/new-page" element={
     <ProtectedRoute requiredRole="admin">
       <NewAdminPage />
     </ProtectedRoute>
   } />
   ```

3. Update AppLayout sidebar navigation
   ```typescript
   // Add to navigation items in AppLayout
   { path: '/admin/new-page', label: 'New Page', role: 'admin' }
   ```

4. Add role permission checks in component logic

### Stripe Payment Integration
**Trigger:** When new payment functionality needs to be implemented  
**Command:** `/add-payment-flow`

1. Add checkout creation logic to `server/stripe.ts`
   ```typescript
   export const createCheckoutSession = async (params: CheckoutParams) => {
     // Stripe checkout session creation
   };
   ```

2. Update webhook handler in `server/stripeWebhook.ts`
   ```typescript
   // Add new event handlers for payment events
   case 'checkout.session.completed':
     // Handle successful payment
     break;
   ```

3. Add payment-related tRPC procedures in `server/routers/billing.ts`
4. Update frontend payment components (`LetterPaywall.tsx`, `Pricing.tsx`)

### Phase Development Cycle
**Trigger:** When developing major new features or refactoring existing ones  
**Command:** `/start-development-phase`

1. Create `phase*.test.ts` file with comprehensive tests
   ```typescript
   // server/phase15-newFeature.test.ts
   describe('Phase 15: New Feature', () => {
     test('should implement feature correctly', async () => {
       // Comprehensive test cases
     });
   });
   ```

2. Implement feature across multiple files following test requirements
3. Update `todo.md` with phase completion status
4. Create checkpoint commit with detailed phase summary
   ```
   checkpoint: phase 15 complete - new feature implementation
   
   - Added comprehensive tests
   - Implemented core functionality
   - Updated documentation
   ```

### Documentation Update Cycle
**Trigger:** When major features are added or architecture changes  
**Command:** `/update-documentation`

1. Update `README.md` with new features and setup instructions
2. Update `ARCHITECTURE.md` if system structure changes
3. Update `CONTRIBUTING.md` if development process changes
4. Create or update `docs/*.md` files for specific features

## Testing Patterns

Tests follow a phase-driven approach with comprehensive coverage:

```typescript
// server/phase*.test.ts
describe('Phase X: Feature Name', () => {
  beforeEach(async () => {
    // Setup test environment
  });

  test('should handle specific scenario', async () => {
    // Arrange
    // Act  
    // Assert
  });
});
```

## Commands

| Command | Purpose |
|---------|---------|
| `/add-trpc-procedure` | Add new tRPC API endpoint with role-based access |
| `/add-database-migration` | Create and apply database schema changes |
| `/add-email-template` | Implement new email notification functionality |
| `/add-role-page` | Create new frontend page with role-based routing |
| `/add-payment-flow` | Integrate new Stripe payment functionality |
| `/start-development-phase` | Begin phase-driven feature development cycle |
| `/update-documentation` | Update project documentation after changes |