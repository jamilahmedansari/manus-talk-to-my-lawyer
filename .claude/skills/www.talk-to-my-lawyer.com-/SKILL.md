# www.talk-to-my-lawyer.com- Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill covers development patterns for a TypeScript-based web application built with Vite, featuring a full-stack architecture with authentication, database management, and email notifications. The codebase follows a structured approach with comprehensive testing and clear separation between client and server concerns.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names
- Test files follow pattern: `*.test.ts`
- Router files: `server/routers/*.ts`
- Components: `client/src/components/*.tsx`

### Import/Export Style
```typescript
// Alias imports preferred
import { AuthProvider } from '@/auth/provider'
import type { User } from '@/types/user'

// Mixed export styles
export default function Component() {}
export const helper = () => {}
```

### Commit Messages
- Average length: ~228 characters
- Common prefixes: `checkpoint`, `feat`, `chore`, `docs`
- Freeform style with descriptive context

## Workflows

### Feature Development with Tests
**Trigger:** When implementing new features like OAuth, discount codes, or email notifications  
**Command:** `/new-feature-with-tests`

1. Implement core feature logic in `server/routers/*.ts`
2. Create corresponding test file (`server/phase*.test.ts` or `server/*.test.ts`)
3. Update `todo.md` with implementation progress
4. Run full test suite validation with `vitest`
5. Commit with descriptive message including feature scope

### Database Schema Migration
**Trigger:** When adding new tables, columns, or changing database structure  
**Command:** `/add-migration`

1. Create migration SQL file in `drizzle/*.sql`
2. Update `drizzle/schema.ts` with new TypeScript types
3. Update Drizzle metadata snapshot in `drizzle/meta/*.json`
4. Add or modify helper functions in `server/db.ts`
5. Test migration locally before committing

### Authentication System Enhancement
**Trigger:** When adding new auth providers, improving session management, or updating user flows  
**Command:** `/enhance-auth`

1. Update client-side auth pages (`Login.tsx`, `Signup.tsx`)
2. Modify server authentication logic in `server/supabaseAuth.ts`
3. Update auth hooks in `client/src/_core/hooks/useAuth.ts`
4. Add auth callback handling if needed
5. Test complete authentication flow end-to-end

### Email Notification System
**Trigger:** When adding new user notification flows like commission emails or review assignments  
**Command:** `/add-email-notification`

1. Add email template function in `server/email.ts`
2. Wire email trigger into relevant router procedure in `server/routers.ts`
3. Implement proper error handling and logging
4. Add comprehensive tests in `server/phase*.test.ts`
5. Test email delivery in development environment

### Frontend UI Component Update
**Trigger:** When adding new UI components or updating existing ones for features  
**Command:** `/update-ui-component`

1. Create or update component in `client/src/components/`
2. Update relevant pages that consume the component
3. Add responsive design considerations in CSS
4. Test component across different screen sizes
5. Ensure component follows existing design patterns

### Merge Pull Request
**Trigger:** When completing feature development and merging branches  
**Command:** `/merge-pr`

1. Complete code review process
2. Merge pull request via GitHub interface
3. Update `.claude/` metadata files if needed
4. Update skill documentation for new patterns
5. Clean up merged branch references

### Documentation and Architecture Update
**Trigger:** When major features are added or system architecture changes  
**Command:** `/update-docs`

1. Update `README.md` with new feature descriptions
2. Modify `ARCHITECTURE.md` or `CONTRIBUTING.md` for structural changes
3. Add or update skill documentation in `docs/skills/`
4. Update project roadmap and `todo.md` items
5. Ensure documentation reflects current system state

## Testing Patterns

### Test Framework: Vitest
```typescript
// Test file naming: *.test.ts
// Example test structure
import { describe, it, expect } from 'vitest'
import { feature } from '../server/routers/feature'

describe('Feature Tests', () => {
  it('should handle user input correctly', async () => {
    const result = await feature.process(mockData)
    expect(result).toBeDefined()
  })
})
```

### Test Categories
- **Phase tests:** `server/phase*.test.ts` - Integration testing
- **Unit tests:** `server/*.test.ts` - Component-specific testing
- **Full test suite validation** required before feature completion

## Commands

| Command | Purpose |
|---------|---------|
| `/new-feature-with-tests` | Implement new feature with comprehensive test coverage |
| `/add-migration` | Create and apply database schema changes |
| `/enhance-auth` | Improve authentication flows and user management |
| `/add-email-notification` | Add new email notification templates and triggers |
| `/update-ui-component` | Create or modify frontend components |
| `/merge-pr` | Complete pull request merge with metadata updates |
| `/update-docs` | Update project documentation and architecture guides |