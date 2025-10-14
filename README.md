# @spacelabs/firestoreorm

> A type-safe, feature-rich Firestore ORM built for the Firebase Admin SDK. Designed to make backend Firestore development actually enjoyable.

[![npm version](https://img.shields.io/npm/v/@spacelabs/firestoreorm.svg)](https://www.npmjs.com/package/@spacelabs/firestoreorm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## Table of Contents

- [The Story Behind This ORM](#the-story-behind-this-orm)
- [Why FirestoreORM?](#why-firestoreorm)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Complete Feature Guide](#complete-feature-guide)
- [Framework Integration](#framework-integration)
- [Best Practices](#best-practices)
- [Understanding Performance Costs](#understanding-performance-costs)
- [Real-World Examples](#real-world-examples)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

## The Story Behind This ORM

Hi, I'm Happy Banda (HBFL3Xx), and I've been working with Firestore on the backend for years. If you've ever built a production Node.js application with Firestore, you know the pain points:

- Writing the same boilerplate CRUD operations over and over
- Managing soft deletes manually across every collection
- Implementing pagination consistently
- Dealing with Firestore's composite index errors at runtime
- Validating data before writes without a clean pattern
- No lifecycle hooks for logging, auditing, or side effects
- Query builders that don't feel natural or type-safe

I tried other Firestore ORMs. Some were abandoned, others lacked essential features like soft deletes or transactions, and many used patterns that didn't fit real-world backend development. Some required too much ceremony, while others were too minimal to be practical.

So I built this. FirestoreORM is the tool I wish I had from day one. It's designed for developers who want to move fast without sacrificing code quality, type safety, or maintainability. Whether you're building a startup MVP or scaling an enterprise application, this ORM grows with you.

## Why FirestoreORM?

### Built for Real Production Use

- **Type-Safe Everything** - Full TypeScript support with intelligent inference
- **Zod Validation** - Schema validation that integrates seamlessly with your data layer
- **Soft Deletes Built-In** - Never lose data accidentally; recover when you need to
- **Lifecycle Hooks** - Add logging, analytics, or side effects without cluttering your business logic
- **Powerful Query Builder** - Intuitive, chainable queries with pagination, aggregation, and streaming
- **Transaction Support** - ACID guarantees for critical operations
- **Subcollection Support** - Navigate document hierarchies naturally
- **Zero Vendor Lock-In** - Built on Firebase Admin SDK; works with any Node.js framework

### Framework Agnostic

Works seamlessly with:
- Express.js
- NestJS (with DTOs and dependency injection)
- Fastify
- Koa
- Next.js API routes
- Any Node.js environment

## Installation

```bash
npm install @spacelabs/firestoreorm firebase-admin zod
```

```bash
yarn add @spacelabs/firestoreorm firebase-admin zod
```

```bash
pnpm add @spacelabs/firestoreorm firebase-admin zod
```

### Peer Dependencies

- `firebase-admin`: ^12.0.0 || ^13.0.0
- `zod`: ^3.0.0 || ^4.0.0

## Quick Start

### 1. Initialize Firebase Admin

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({
  credential: cert('./serviceAccountKey.json')
});

export const db = getFirestore(app);
```

### 2. Define Your Schema

```typescript
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().optional(), // include id in every schema you create but it can be optional
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type User = z.infer<typeof userSchema>;
```

### 3. Create Your Repository

```typescript
import { FirestoreRepository } from '@spacelabs/firestoreorm';
import { db } from './firebase';
import { userSchema, User } from './schemas';

export const userRepo = FirestoreRepository.withSchema<User>(
  db,
  'users',
  userSchema
);
```

### 4. Start Building

```typescript
// Create a user
const user = await userRepo.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

// Query users
const activeUsers = await userRepo.query()
  .where('status', '==', 'active')
  .where('age', '>', 18)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

// Update a user
await userRepo.update(user.id, {
  status: 'inactive',
  updatedAt: new Date().toISOString()
});

// Soft delete (recoverable)
await userRepo.softDelete(user.id);

// Restore if needed
await userRepo.restore(user.id);
```

## Core Concepts

### Repository Pattern

The repository abstracts Firestore operations behind a clean, consistent API. Each collection gets its own repository instance.

```typescript
// Initialize once, use everywhere
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
const orderRepo = FirestoreRepository.withSchema<Order>(db, 'orders', orderSchema);
const productRepo = new FirestoreRepository<Product>(db, 'products'); // Without validation
```

### Soft Deletes

Soft deletes are enabled by default. When you delete a document, it's marked with a `deletedAt` timestamp instead of being permanently removed. This allows you to:

- Recover accidentally deleted data
- Maintain referential integrity
- Audit deletion history
- Comply with data retention policies

```typescript
// Soft delete - document stays in Firestore
await userRepo.softDelete('user-123');

// Document is excluded from queries by default
const user = await userRepo.getById('user-123'); // null

// But can be retrieved with includeDeleted flag
const deletedUser = await userRepo.getById('user-123', true);

// Restore when needed
await userRepo.restore('user-123');

// Or permanently delete later
await userRepo.purgeDelete(); // Removes all soft-deleted docs
```

**Under the Hood**: Every repository operation adds a `deletedAt: null` field on creation. Queries automatically add `.where('deletedAt', '==', null)` unless you explicitly include deleted documents.

### Schema Validation

Validation happens automatically before any write operation using Zod schemas.

```typescript
const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional()
});

const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

try {
  await userRepo.create({
    name: '',
    email: 'not-an-email',
    age: -5
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues);
    // [
    //   { path: ['name'], message: 'String must not be empty' },
    //   { path: ['email'], message: 'Invalid email' },
    //   { path: ['age'], message: 'Must be positive' }
    // ]
  }
}
```

**Validation Behavior**:
- `create()` validates against the full schema
- `update()` validates against `schema.partial()` (all fields optional)
- Validation errors are thrown before any Firestore write occurs

### Lifecycle Hooks

Hooks allow you to inject custom logic at specific points in the data lifecycle without cluttering your business logic.

```typescript
// Log all user creations
userRepo.on('afterCreate', async (user) => {
  console.log(`User created: ${user.id}`);
  await auditLog.record('user_created', user);
});

// Send welcome email
userRepo.on('afterCreate', async (user) => {
  await sendWelcomeEmail(user.email);
});

// Validate business rules before update
orderRepo.on('beforeUpdate', (data) => {
  if (data.status === 'shipped' && !data.trackingNumber) {
    throw new Error('Tracking number required for shipped orders');
  }
});

// Clean up related data after deletion
userRepo.on('afterDelete', async (user) => {
  await orderRepo.query().where('userId', '==', user.id).delete();
});
```

**Available Hooks**:
- Single operations: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`, `beforeSoftDelete`, `afterSoftDelete`, `beforeRestore`, `afterRestore`
- Bulk operations: `beforeBulkCreate`, `afterBulkCreate`, `beforeBulkUpdate`, `afterBulkUpdate`, `beforeBulkDelete`, `afterBulkDelete`, `beforeBulkSoftDelete`, `afterBulkSoftDelete`, `beforeBulkRestore`, `afterBulkRestore`

### Query Builder

The query builder provides a fluent, type-safe interface for complex queries.

```typescript
const results = await orderRepo.query()
  .where('status', '==', 'pending')
  .where('total', '>', 100)
  .where('createdAt', '>=', startOfMonth)
  .orderBy('total', 'desc')
  .limit(50)
  .get();
```

**Performance Note**: Firestore charges you per document read. Use `limit()` and pagination to control costs on large collections.

## Complete Feature Guide

### CRUD Operations

```typescript
// CREATE
const user = await userRepo.create({
  name: 'Alice',
  email: 'alice@example.com'
});

// READ
const user = await userRepo.getById('user-123');
const users = await userRepo.list(20); // First 20 docs
const usersByEmail = await userRepo.findByField('email', 'alice@example.com');

// UPDATE
await userRepo.update('user-123', {
  name: 'Alice Updated'
});

// UPSERT (create if doesn't exist, update if exists)
await userRepo.upsert('user-123', {
  name: 'Alice',
  email: 'alice@example.com'
});

// DELETE
await userRepo.delete('user-123'); // Hard delete
await userRepo.softDelete('user-123'); // Soft delete
await userRepo.restore('user-123'); // Restore soft-deleted
```

### Bulk Operations

Bulk operations use Firestore batch writes (max 500 operations per batch). The ORM automatically chunks operations if you exceed this limit.

```typescript
// Bulk create
const users = await userRepo.bulkCreate([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' }
]);

// Bulk update
await userRepo.bulkUpdate([
  { id: 'user-1', data: { status: 'active' } },
  { id: 'user-2', data: { status: 'inactive' } }
]);

// Bulk delete
await userRepo.bulkDelete(['user-1', 'user-2', 'user-3']);

// Bulk soft delete
await userRepo.bulkSoftDelete(['user-4', 'user-5']);
```

**Performance Tip**: For simple bulk updates on query results, use `query().update()` instead:

```typescript
// More efficient - single query + batched writes
await orderRepo.query()
  .where('status', '==', 'pending')
  .update({ status: 'shipped' });

// Less efficient - fetches all IDs first, then updates
const orders = await orderRepo.query().where('status', '==', 'pending').get();
await orderRepo.bulkUpdate(orders.map(o => ({ id: o.id, data: { status: 'shipped' } })));
```

### Advanced Queries

```typescript
// Filtering
const results = await userRepo.query()
  .where('age', '>', 18)
  .where('status', 'in', ['active', 'verified'])
  .where('tags', 'array-contains', 'premium')
  .get();

// Sorting
const sorted = await productRepo.query()
  .orderBy('price', 'desc')
  .orderBy('name', 'asc')
  .get();

// Pagination (cursor-based, recommended)
const { items, nextCursorId } = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .paginate(20);

// Next page
const nextPage = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .paginate(20, nextCursorId);

// Offset pagination (less efficient for large datasets)
const page2 = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .offsetPaginate(2, 20);

// Aggregations
const totalRevenue = await orderRepo.query()
  .where('status', '==', 'completed')
  .aggregate('total', 'sum');

const avgRating = await reviewRepo.query()
  .where('productId', '==', 'prod-123')
  .aggregate('rating', 'avg');

// Count
const activeCount = await userRepo.query()
  .where('status', '==', 'active')
  .count();

// Exists check
const hasOrders = await orderRepo.query()
  .where('userId', '==', 'user-123')
  .exists();

// Distinct values
const categories = await productRepo.query().distinctValues('category');

// Select specific fields
const userEmails = await userRepo.query()
  .where('subscribed', '==', true)
  .select('email', 'name')
  .get();
```

### Query Operations

```typescript
// Update all matching documents
const updatedCount = await orderRepo.query()
  .where('status', '==', 'pending')
  .update({ status: 'processing' });

// Delete all matching documents
const deletedCount = await userRepo.query()
  .where('lastLogin', '<', oneYearAgo)
  .delete();

// Soft delete matching documents
await orderRepo.query()
  .where('status', '==', 'cancelled')
  .where('createdAt', '<', sixMonthsAgo)
  .softDelete();
```

### Streaming for Large Datasets

When processing large datasets, streaming prevents memory issues by processing documents one at a time.

```typescript
// Stream all users without loading into memory
for await (const user of userRepo.query().stream()) {
  await sendEmail(user.email);
  console.log(`Processed user ${user.id}`);
}

// Stream with filters
for await (const order of orderRepo.query()
  .where('status', '==', 'pending')
  .stream()) {
  await processOrder(order);
}
```

**Performance Cost**: Streaming still reads all matching documents, so you're charged for every document read. Use with appropriate filters and limits.

### Real-Time Subscriptions

```typescript
// Subscribe to query results
const unsubscribe = await orderRepo.query()
  .where('status', '==', 'active')
  .onSnapshot(
    (orders) => {
      console.log(`Active orders: ${orders.length}`);
      updateDashboard(orders);
    },
    (error) => {
      console.error('Snapshot error:', error);
    }
  );

// Stop listening when done
unsubscribe();
```

**Cost Warning**: Real-time listeners charge you for every document that matches your query, plus additional reads when documents change. Use narrow filters and consider polling for less critical data.

### Transactions

Transactions ensure atomic operations across multiple documents. Use them when consistency is critical (e.g., transferring balances, inventory management).

```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdate(tx, 'account-1');
  const to = await repo.getForUpdate(tx, 'account-2');

  if (!from || from.balance < 100) {
    throw new Error('Insufficient funds');
  }

  await repo.updateInTransaction(tx, from.id, {
    balance: from.balance - 100
  });
  
  await repo.updateInTransaction(tx, to.id, {
    balance: to.balance + 100
  });
});
```

**Important Transaction Limitations**:

1. **No `after` Hooks**: Lifecycle hooks like `afterCreate`, `afterUpdate`, `afterDelete` do NOT run inside transactions. Only `before` hooks execute. This is a Firestore limitation since transactions need to be atomic and cannot have side effects that might fail.

2. **Use Cases for Transaction Hooks**:
   ```typescript
   // WORKS - beforeUpdate runs before transaction commits
   orderRepo.on('beforeUpdate', (data) => {
     if (data.quantity < 0) {
       throw new Error('Negative quantity not allowed');
     }
   });

   // DOES NOT WORK - afterUpdate won't run in transaction
   orderRepo.on('afterUpdate', async (order) => {
     await sendEmail(order.email); // This will NOT execute
   });
   ```

3. **Solution for Post-Transaction Side Effects**:
   ```typescript
   const result = await accountRepo.runInTransaction(async (tx, repo) => {
     // ... transaction logic
     return { from, to };
   });

   // Run side effects AFTER transaction succeeds
   await auditLog.record('transfer_completed', result);
   await sendEmail(result.from.email);
   ```

### Subcollections

Navigate document hierarchies naturally:

```typescript
// Access user's orders
const userOrders = userRepo.subcollection<Order>('user-123', 'orders', orderSchema);

// Create order in subcollection
const order = await userOrders.create({
  product: 'Widget',
  price: 99.99
});

// Query subcollection
const recentOrders = await userOrders.query()
  .where('status', '==', 'completed')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

// Nested subcollections
const comments = postRepo
  .subcollection<Comment>('post-123', 'comments')
  .subcollection<Reply>('comment-456', 'replies');

// Get parent ID
const parentId = userOrders.getParentId(); // 'user-123'
```

### Error Handling

```typescript
import { 
  ValidationError, 
  NotFoundError, 
  ConflictError,
  FirestoreIndexError 
} from '@spacelabs/firestoreorm';

try {
  await userRepo.create(invalidData);
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors
    error.issues.forEach(issue => {
      console.log(`${issue.path}: ${issue.message}`);
    });
  } else if (error instanceof NotFoundError) {
    // Handle not found
    console.log('Document not found');
  } else if (error instanceof FirestoreIndexError) {
    // Handle missing composite index
    console.log(error.toString()); // Includes link to create index
  }
}
```

### Express Error Handler

The ORM includes a pre-built Express middleware for consistent error responses:

```typescript
import { errorHandler } from '@spacelabs/firestoreorm/core/ErrorHandler';
import express from 'express';

const app = express();

// ... your routes

// Register as last middleware
app.use(errorHandler);
```

This automatically maps errors to HTTP status codes:
- `ValidationError` → 400 Bad Request
- `NotFoundError` → 404 Not Found
- `ConflictError` → 409 Conflict
- `FirestoreIndexError` → 400 Bad Request (with index URL)
- Others → 500 Internal Server Error

## Framework Integration

### Express.js

**Basic Setup**

```typescript
// repositories/user.repository.ts
import { FirestoreRepository } from '@spacelabs/firestoreorm';
import { db } from '../config/firebase';
import { userSchema, User } from '../schemas/user.schema';

export const userRepo = FirestoreRepository.withSchema<User>(
  db,
  'users',
  userSchema
);
```

```typescript
// routes/user.routes.ts
import express from 'express';
import { userRepo } from '../repositories/user.repository';
import { ValidationError, NotFoundError } from '@spacelabs/firestoreorm';

const router = express.Router();

router.post('/users', async (req, res, next) => {
  try {
    const user = await userRepo.create({
      ...req.body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.status(201).json(user);
  } catch (error) {
    next(error); // errorHandler middleware will process this
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    let query = userRepo.query();
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    const result = await query
      .orderBy('createdAt', 'desc')
      .offsetPaginate(Number(page), Number(limit));
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.getById(req.params.id);
    
    if (!user) {
      throw new NotFoundError(`User with id ${req.params.id} not found`);
    }
    
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const user = await userRepo.update(req.params.id, {
      ...req.body,
      updatedAt: new Date().toISOString()
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    await userRepo.softDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
```

```typescript
// app.ts
import express from 'express';
import { errorHandler } from '@spacelabs/firestoreorm/core/ErrorHandler';
import userRoutes from './routes/user.routes';

const app = express();

app.use(express.json());
app.use('/api', userRoutes);
app.use(errorHandler); // Must be last

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### NestJS Integration

NestJS users often work with DTOs for request validation. Here's how to integrate with the ORM's Zod schemas:

**Shared Schema Strategy**

```typescript
// schemas/user.schema.ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().optional(), // include id in every schema you create but it can be optional
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type User = z.infer<typeof userSchema>;

// DTOs for NestJS (derived from same schema)
export const createUserSchema = userSchema.omit({ createdAt: true, updatedAt: true });
export const updateUserSchema = createUserSchema.partial();

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
```

**Repository Module**

```typescript
// modules/database/database.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

@Global()
@Module({
  providers: [
    {
      provide: 'FIRESTORE',
      useFactory: (config: ConfigService) => {
        const app = initializeApp({
          credential: cert(config.get('firebase.serviceAccount'))
        });
        return getFirestore(app);
      },
      inject: [ConfigService]
    }
  ],
  exports: ['FIRESTORE']
})
export class DatabaseModule {}
```

```typescript
// modules/user/user.repository.ts
import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '@spacelabs/firestoreorm';
import { User, userSchema } from '../../schemas/user.schema';

@Injectable()
export class UserRepository {
  private repo: FirestoreRepository<User>;

  constructor(@Inject('FIRESTORE') private firestore: Firestore) {
    this.repo = FirestoreRepository.withSchema<User>(
      firestore,
      'users',
      userSchema
    );

    // Setup hooks
    this.setupHooks();
  }

  private setupHooks() {
    this.repo.on('afterCreate', async (user) => {
      console.log(`User created: ${user.id}`);
    });
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.repo.create({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  async findById(id: string) {
    return this.repo.getById(id);
  }

  async update(id: string, data: Partial<User>) {
    return this.repo.update(id, {
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  async softDelete(id: string) {
    return this.repo.softDelete(id);
  }

  query() {
    return this.repo.query();
  }
}
```

**Service Layer**

```typescript
// modules/user/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { NotFoundError } from '@spacelabs/firestoreorm';

@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async create(dto: CreateUserDto) {
    return this.userRepository.create(dto);
  }

  async findOne(id: string) {
    const user = await this.userRepository.findById(id);
    
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    
    return user;
  }

  async findActive(page: number = 1, limit: number = 20) {
    return this.userRepository.query()
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return await this.userRepository.update(id, dto);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.userRepository.softDelete(id);
  }
}
```

**Controller with Validation Pipe**

```typescript
// modules/user/user.controller.ts
import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Patch, 
  Delete,
  Query,
  UsePipes
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { createUserSchema, updateUserSchema } from '../../schemas/user.schema';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createUserSchema))
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20'
  ) {
    return this.userService.findActive(Number(page), Number(limit));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateUserSchema))
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
```

**Zod Validation Pipe (Optional - since ORM validates)**

```typescript
// pipes/zod-validation.pipe.ts
import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      throw new BadRequestException('Validation failed');
    }
  }
}
```

**Exception Filter for ORM Errors**

```typescript
// filters/firestore-exception.filter.ts
import { 
  ExceptionFilter, 
  Catch, 
  ArgumentsHost, 
  HttpStatus 
} from '@nestjs/common';
import { Response } from 'express';
import { 
  ValidationError, 
  NotFoundError, 
  ConflictError 
} from '@spacelabs/firestoreorm';

@Catch(ValidationError, NotFoundError, ConflictError)
export class FirestoreExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ValidationError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Error',
        details: exception.issues
      });
    } else if (exception instanceof NotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: exception.message
      });
    } else if (exception instanceof ConflictError) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: exception.message
      });
    }
  }
}
```

**Register Filter Globally**

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FirestoreExceptionFilter } from './filters/firestore-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalFilters(new FirestoreExceptionFilter());
  
  await app.listen(3000);
}
bootstrap();
```

## Best Practices

### 1. Initialize Repositories Once

Create repository instances once and reuse them throughout your application. Don't create new instances in every function.

```typescript
// ❌ Bad - Creates new instance every time
export function getUserRepository() {
  return FirestoreRepository.withSchema<User>(db, 'users', userSchema);
}

// ✅ Good - Single instance, reused everywhere
export const userRepo = FirestoreRepository.withSchema<User>(
  db,
  'users',
  userSchema
);
```

**Why**: Repository initialization is lightweight, but creating instances repeatedly is unnecessary and makes hook management inconsistent.

### 2. Organize Repositories in a Centralized Module

```typescript
// repositories/index.ts
import { db } from '../config/firebase';
import { FirestoreRepository } from '@spacelabs/firestoreorm';
import * as schemas from '../schemas';

export const userRepo = FirestoreRepository.withSchema<schemas.User>(
  db,
  'users',
  schemas.userSchema
);

export const orderRepo = FirestoreRepository.withSchema<schemas.Order>(
  db,
  'orders',
  schemas.orderSchema
);

export const productRepo = FirestoreRepository.withSchema<schemas.Product>(
  db,
  'products',
  schemas.productSchema
);

// Setup common hooks
userRepo.on('afterCreate', async (user) => {
  await auditLog.record('user_created', user);
});

orderRepo.on('afterCreate', async (order) => {
  await notificationService.sendOrderConfirmation(order);
});
```

### 3. Use Cursor-Based Pagination Over Offset

For large datasets, cursor-based pagination is significantly more efficient than offset pagination.

```typescript
// ✅ Good - Cursor-based (scales well)
const { items, nextCursorId } = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .paginate(20, lastCursorId);

// ❌ Avoid - Offset-based (expensive for large page numbers)
const result = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .offsetPaginate(100, 20); // Skip 1980 docs to get page 100
```

**Why**: Offset pagination requires Firestore to scan and skip all documents before your offset, while cursor pagination jumps directly to the starting position.

### 4. Use Query Updates for Bulk Operations

When updating multiple documents based on a condition, use `query().update()` instead of fetching then updating.

```typescript
// ✅ Good - Single query, batched writes
await orderRepo.query()
  .where('status', '==', 'pending')
  .where('createdAt', '<', cutoffDate)
  .update({ status: 'expired' });

// ❌ Less efficient - Two operations
const orders = await orderRepo.query()
  .where('status', '==', 'pending')
  .where('createdAt', '<', cutoffDate)
  .get();

await orderRepo.bulkUpdate(
  orders.map(o => ({ id: o.id, data: { status: 'expired' } }))
);
```

### 5. Leverage Soft Deletes

Use soft deletes by default unless you have a specific reason to permanently delete data.

```typescript
// ✅ Default behavior - recoverable
await userRepo.softDelete(userId);

// Later, if needed
await userRepo.restore(userId);

// Only hard delete when absolutely necessary
await userRepo.delete(userId); // Permanent, cannot be undone
```

### 6. Add Timestamps Consistently

Always add `createdAt` and `updatedAt` timestamps to track data lifecycle.

```typescript
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

// On create
await userRepo.create({
  ...data,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

// On update
await userRepo.update(id, {
  ...data,
  updatedAt: new Date().toISOString()
});
```

### 7. Handle Composite Index Errors Gracefully

Firestore requires composite indexes for certain query combinations. The ORM provides clear error messages with links to create them.

```typescript
try {
  const results = await orderRepo.query()
    .where('status', '==', 'pending')
    .where('total', '>', 100)
    .orderBy('createdAt', 'desc')
    .get();
} catch (error) {
  if (error instanceof FirestoreIndexError) {
    console.log(error.toString());
    // Logs formatted message with link to create index
    // Click link, wait 1-2 minutes, retry query
  }
}
```

### 8. Use Transactions for Critical Operations

Any operation requiring consistency across multiple documents should use transactions.

```typescript
// ✅ Atomic transfer
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdate(tx, fromId);
  const to = await repo.getForUpdate(tx, toId);
  
  if (from.balance < amount) {
    throw new Error('Insufficient funds');
  }
  
  await repo.updateInTransaction(tx, fromId, {
    balance: from.balance - amount
  });
  
  await repo.updateInTransaction(tx, toId, {
    balance: to.balance + amount
  });
});
```

### 9. Use Streaming for Large Data Exports

When processing large datasets (exports, migrations, batch jobs), use streaming to avoid memory issues.

```typescript
// ✅ Memory efficient
const csvStream = createWriteStream('users.csv');
csvStream.write('name,email,status\n');

for await (const user of userRepo.query().stream()) {
  csvStream.write(`${user.name},${user.email},${user.status}\n`);
}

csvStream.end();
```

### 10. Structure Hooks for Reusability

Keep hooks focused and modular. Avoid putting complex business logic directly in hooks.

```typescript
// ✅ Good - Focused, testable
class UserNotificationService {
  async sendWelcomeEmail(user: User) {
    // Email logic here
  }
}

const notificationService = new UserNotificationService();

userRepo.on('afterCreate', async (user) => {
  await notificationService.sendWelcomeEmail(user);
});

// ❌ Bad - Business logic coupled to hook
userRepo.on('afterCreate', async (user) => {
  const template = await db.collection('templates').doc('welcome').get();
  const emailService = new EmailService(config);
  await emailService.send({
    to: user.email,
    subject: template.data().subject,
    body: template.data().body.replace('{{name}}', user.name)
  });
  await db.collection('email_logs').add({ userId: user.id, type: 'welcome' });
});
```

## Understanding Performance Costs

### Firestore Pricing Model

Firestore charges for:
1. **Document reads** - Every document returned from a query
2. **Document writes** - Every create, update, or delete
3. **Document deletes** - Separate charge from writes
4. **Storage** - Data stored in your database
5. **Network egress** - Data transferred out of Google Cloud

### Operation Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| `getById()` | 1 read | Single document lookup |
| `list(100)` | 100 reads | Reads up to 100 documents |
| `query().get()` | 1 read per result | Charges for every matched document |
| `query().count()` | 1 read per 1000 docs | Aggregation query (cheaper than fetching) |
| `create()` | 1 write | Single write operation |
| `bulkCreate(100)` | 100 writes | Batched but still counts as 100 writes |
| `update()` | 1 write | Even if updating one field |
| `delete()` | 1 delete | Permanently removes document |
| `softDelete()` | 1 write | Updates `deletedAt` field |
| `query().update()` | 1 write per match | Efficient batch update |
| `onSnapshot()` | 1 read per doc initially + 1 read per change | Real-time listener costs |

### What Happens Under the Hood

**Simple Query**
```typescript
const users = await userRepo.query()
  .where('status', '==', 'active')
  .limit(10)
  .get();
```

1. ORM adds `.where('deletedAt', '==', null)` automatically
2. Firestore executes query with both conditions
3. Returns up to 10 documents
4. **Cost**: 10 reads (or fewer if less than 10 matches)

**Pagination**
```typescript
const { items, nextCursorId } = await userRepo.query()
  .orderBy('createdAt', 'desc')
  .paginate(20, cursorId);
```

1. If `cursorId` provided, fetches that document first (1 read)
2. Executes query starting after cursor document
3. Returns up to 20 documents
4. **Cost**: 21 reads (20 results + 1 cursor lookup)

**Bulk Create**
```typescript
await userRepo.bulkCreate(users); // 500 users
```

1. Validates all 500 documents against schema
2. Splits into batches of 500 operations (Firestore limit)
3. Commits each batch sequentially
4. **Cost**: 500 writes

**Query Update**
```typescript
await orderRepo.query()
  .where('status', '==', 'pending')
  .update({ status: 'shipped' }); // 150 matches
```

1. Executes query to find matching documents (150 reads)
2. Batches updates in groups of 500
3. Commits all updates
4. **Cost**: 150 reads + 150 writes

**Soft Delete**
```typescript
await userRepo.softDelete(userId);
```

1. Fetches document to verify existence (1 read)
2. Updates `deletedAt` field (1 write)
3. **Cost**: 1 read + 1 write

**Transaction**
```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdate(tx, 'acc-1');
  const to = await repo.getForUpdate(tx, 'acc-2');
  
  await repo.updateInTransaction(tx, 'acc-1', { balance: from.balance - 100 });
  await repo.updateInTransaction(tx, 'acc-2', { balance: to.balance + 100 });
});
```

1. Reads both documents within transaction (2 reads)
2. Locks both documents until transaction completes
3. Commits both updates atomically (2 writes)
4. **Cost**: 2 reads + 2 writes

### Cost Optimization Tips

1. **Use `count()` instead of fetching when you only need quantity**
   ```typescript
   // ✅ Efficient
   const total = await userRepo.query().where('status', '==', 'active').count();
   
   // ❌ Expensive
   const users = await userRepo.query().where('status', '==', 'active').get();
   const total = users.length;
   ```

2. **Limit query results**
   ```typescript
   // Always add reasonable limits
   await userRepo.query().limit(100).get();
   ```

3. **Use `exists()` for presence checks**
   ```typescript
   // ✅ Reads at most 1 document
   const hasOrders = await orderRepo.query()
     .where('userId', '==', userId)
     .exists();
   
   // ❌ Reads all matching documents
   const orders = await orderRepo.query()
     .where('userId', '==', userId)
     .get();
   const hasOrders = orders.length > 0;
   ```

4. **Select specific fields to reduce bandwidth**
   ```typescript
   // Reduces network transfer (still charges for full document read)
   const emails = await userRepo.query()
     .select('email')
     .get();
   ```

5. **Be cautious with real-time listeners**
   ```typescript
   // Charges for every document on initial load + every change
   // Use narrow filters
   await orderRepo.query()
     .where('userId', '==', userId)
     .where('status', '==', 'active')
     .onSnapshot(callback);
   ```

## Real-World Examples

### Example 1: E-commerce Order System

```typescript
// schemas/order.schema.ts
import { z } from 'zod';

export const orderItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  subtotal: z.number().positive()
});

export const orderSchema = z.object({
  userId: z.string(),
  items: z.array(orderItemSchema),
  total: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string()
  }),
  trackingNumber: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Order = z.infer<typeof orderSchema>;
```

```typescript
// repositories/order.repository.ts
import { FirestoreRepository } from '@spacelabs/firestoreorm';
import { db } from '../config/firebase';
import { orderSchema, Order } from '../schemas/order.schema';
import { inventoryService } from '../services/inventory.service';
import { emailService } from '../services/email.service';

export const orderRepo = FirestoreRepository.withSchema<Order>(
  db,
  'orders',
  orderSchema
);

// Validate inventory before creating order
orderRepo.on('beforeCreate', async (order) => {
  for (const item of order.items) {
    const available = await inventoryService.checkStock(
      item.productId,
      item.quantity
    );
    
    if (!available) {
      throw new Error(`Insufficient stock for product ${item.productName}`);
    }
  }
});

// Update inventory and send confirmation after order creation
orderRepo.on('afterCreate', async (order) => {
  // Reduce inventory
  for (const item of order.items) {
    await inventoryService.reduceStock(item.productId, item.quantity);
  }
  
  // Send confirmation email
  await emailService.sendOrderConfirmation(order);
  
  // Log for analytics
  await analytics.track('order_placed', {
    orderId: order.id,
    total: order.total,
    itemCount: order.items.length
  });
});

// Validate tracking number for shipped orders
orderRepo.on('beforeUpdate', (data) => {
  if (data.status === 'shipped' && !data.trackingNumber) {
    throw new Error('Tracking number required for shipped orders');
  }
});

// Send shipping notification
orderRepo.on('afterUpdate', async (order) => {
  if (order.status === 'shipped') {
    await emailService.sendShippingNotification(order);
  }
});
```

```typescript
// services/order.service.ts
import { orderRepo } from '../repositories/order.repository';
import { userRepo } from '../repositories/user.repository';
import { ConflictError } from '@spacelabs/firestoreorm';

export class OrderService {
  async createOrder(userId: string, items: OrderItem[]) {
    // Verify user exists
    const user = await userRepo.getById(userId);
    if (!user) {
      throw new ConflictError('User not found');
    }
    
    // Calculate total
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Create order (hooks will handle inventory and emails)
    return orderRepo.create({
      userId,
      items,
      total,
      status: 'pending',
      shippingAddress: user.defaultAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  async getUserOrders(userId: string, page: number = 1, limit: number = 20) {
    return orderRepo.query()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }
  
  async updateOrderStatus(orderId: string, status: Order['status'], trackingNumber?: string) {
    return orderRepo.update(orderId, {
      status,
      trackingNumber,
      updatedAt: new Date().toISOString()
    });
  }
  
  async cancelOrder(orderId: string) {
    // Use transaction to ensure inventory is restored
    await orderRepo.runInTransaction(async (tx, repo) => {
      const order = await repo.getForUpdate(tx, orderId);
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      if (order.status !== 'pending') {
        throw new Error('Only pending orders can be cancelled');
      }
      
      await repo.updateInTransaction(tx, orderId, {
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      });
    });
    
    // Restore inventory after transaction (outside to avoid transaction limits)
    const order = await orderRepo.getById(orderId);
    for (const item of order!.items) {
      await inventoryService.restoreStock(item.productId, item.quantity);
    }
  }
  
  async getOrderStats(startDate: string, endDate: string) {
    const orders = await orderRepo.query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .get();
    
    const totalRevenue = await orderRepo.query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .aggregate('total', 'sum');
    
    const avgOrderValue = await orderRepo.query()
      .where('status', '==', 'delivered')
      .where('createdAt', '>=', startDate)
      .where('createdAt', '<=', endDate)
      .aggregate('total', 'avg');
    
    return {
      totalOrders: orders.length,
      totalRevenue,
      avgOrderValue
    };
  }
}
```

### Example 2: Multi-Tenant SaaS Application

```typescript
// schemas/tenant.schema.ts
export const tenantSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: z.enum(['free', 'pro', 'enterprise']),
  seats: z.number().int().positive(),
  usedSeats: z.number().int().nonnegative().default(0),
  features: z.array(z.string()),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Tenant = z.infer<typeof tenantSchema>;
```

```typescript
// repositories/tenant.repository.ts
export const tenantRepo = FirestoreRepository.withSchema<Tenant>(
  db,
  'tenants',
  tenantSchema
);

// Ensure slug uniqueness
tenantRepo.on('beforeCreate', async (tenant) => {
  const existing = await tenantRepo.findByField('slug', tenant.slug);
  
  if (existing.length > 0) {
    throw new ConflictError('Tenant slug already exists');
  }
});

// Create default resources for new tenant
tenantRepo.on('afterCreate', async (tenant) => {
  // Create default workspace
  await workspaceRepo.create({
    tenantId: tenant.id,
    name: 'Default Workspace',
    ownerId: tenant.ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  // Add owner as first member
  await memberRepo.create({
    tenantId: tenant.id,
    userId: tenant.ownerId,
    role: 'owner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
});
```

```typescript
// services/tenant.service.ts
export class TenantService {
  async createTenant(ownerId: string, name: string, slug: string) {
    return tenantRepo.create({
      name,
      slug,
      plan: 'free',
      seats: 5,
      usedSeats: 1,
      features: ['basic_analytics', 'api_access'],
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  async addMember(tenantId: string, userId: string, role: string) {
    // Use transaction to ensure seat limit
    await tenantRepo.runInTransaction(async (tx, repo) => {
      const tenant = await repo.getForUpdate(tx, tenantId);
      
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      
      if (tenant.usedSeats >= tenant.seats) {
        throw new Error('Seat limit reached. Please upgrade your plan.');
      }
      
      await repo.updateInTransaction(tx, tenantId, {
        usedSeats: tenant.usedSeats + 1
      });
    });
    
    // Add member after transaction succeeds
    await memberRepo.create({
      tenantId,
      userId,
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  async upgradePlan(tenantId: string, newPlan: Tenant['plan']) {
    const planSeats = {
      free: 5,
      pro: 25,
      enterprise: 100
    };
    
    return tenantRepo.update(tenantId, {
      plan: newPlan,
      seats: planSeats[newPlan],
      features: this.getFeaturesForPlan(newPlan),
      updatedAt: new Date().toISOString()
    });
  }
  
  private getFeaturesForPlan(plan: Tenant['plan']): string[] {
    const features = {
      free: ['basic_analytics', 'api_access'],
      pro: ['basic_analytics', 'api_access', 'advanced_analytics', 'priority_support'],
      enterprise: ['basic_analytics', 'api_access', 'advanced_analytics', 'priority_support', 'custom_domain', 'sso']
    };
    
    return features[plan];
  }
}
```

### Example 3: Social Media Feed with Real-Time Updates

```typescript
// repositories/post.repository.ts
export const postRepo = FirestoreRepository.withSchema<Post>(db, 'posts', postSchema);

// Monitor new posts in real-time
export function subscribeToUserFeed(userId: string, callback: (posts: Post[]) => void) {
  // Get list of users this user follows
  const following = await followRepo.query()
    .where('followerId', '==', userId)
    .get();
  
  const followingIds = following.map(f => f.followingId);
  
  // Subscribe to posts from followed users
  return postRepo.query()
    .where('authorId', 'in', followingIds)
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(callback);
}
```

```typescript
// services/feed.service.ts
export class FeedService {
  private unsubscribe: (() => void) | null = null;
  
  async startFeedUpdates(userId: string, onUpdate: (posts: Post[]) => void) {
    this.unsubscribe = await subscribeToUserFeed(userId, onUpdate);
  }
  
  stopFeedUpdates() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
  
  async getInitialFeed(userId: string, limit: number = 20) {
    const following = await followRepo.query()
      .where('followerId', '==', userId)
      .get();
    
    const followingIds = following.map(f => f.followingId);
    
    return postRepo.query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit);
  }
  
  async getMorePosts(userId: string, cursorId: string, limit: number = 20) {
    const following = await followRepo.query()
      .where('followerId', '==', userId)
      .get();
    
    const followingIds = following.map(f => f.followingId);
    
    return postRepo.query()
      .where('authorId', 'in', followingIds)
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .paginate(limit, cursorId);
  }
}
```

## API Reference

### FirestoreRepository

#### Static Methods

**`withSchema<T>(db: Firestore, collection: string, schema: ZodSchema): FirestoreRepository<T>`**

Create a repository with Zod schema validation.

#### Instance Methods

**`create(data: T): Promise<T & { id: ID }>`**
Create a new document.

**`bulkCreate(dataArray: T[]): Promise<(T & { id: ID })[]>`**
Create multiple documents in batch.

**`getById(id: ID, includeDeleted?: boolean): Promise<(T & { id: ID }) | null>`**
Get document by ID.

**`update(id: ID, data: Partial<T>): Promise<T & { id: ID }>`**
Update document with partial data.

**`bulkUpdate(updates: { id: ID, data: Partial<T> }[]): Promise<(T & { id: ID })[]>`**
Update multiple documents in batch.

**`upsert(id: ID, data: T): Promise<T & { id: ID }>`**
Create or update document with specific ID.

**`delete(id: ID): Promise<void>`**
Permanently delete document.

**`bulkDelete(ids: ID[]): Promise<number>`**
Permanently delete multiple documents.

**`softDelete(id: ID): Promise<void>`**
Soft delete document (sets `deletedAt` timestamp).

**`bulkSoftDelete(ids: ID[]): Promise<number>`**
Soft delete multiple documents.

**`restore(id: ID): Promise<void>`**
Restore soft-deleted document.

**`restoreAll(): Promise<number>`**
Restore all soft-deleted documents.

**`purgeDelete(): Promise<number>`**
Permanently delete all soft-deleted documents.

**`findByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID })[]>`**
Find documents by field value.

**`list(limit?: number, startAfterId?: string, includeDeleted?: boolean): Promise<(T & { id: ID })[]>`**
List documents with pagination.

**`query(): FirestoreQueryBuilder<T>`**
Create query builder for complex queries.

**`on(event: HookEvent, fn: HookFn): void`**
Register lifecycle hook.

**`subcollection<S>(parentId: ID, subcollectionName: string, schema?: ZodSchema): FirestoreRepository<S>`**
Access subcollection.

**`runInTransaction<R>(fn: (tx: Transaction, repo: Repository) => Promise<R>): Promise<R>`**
Execute function within transaction.

**`getForUpdate(tx: Transaction, id: ID, includeDeleted?: boolean): Promise<(T & { id: ID }) | null>`**
Get document for update within transaction.

**`updateInTransaction(tx: Transaction, id: ID, data: Partial<T>): Promise<void>`**
Update document within transaction.

**`createInTransaction(tx: Transaction, data: T): Promise<T & { id: ID }>`**
Create document within transaction.

**`deleteInTransaction(tx: Transaction, id: ID): Promise<void>`**
Delete document within transaction.

### FirestoreQueryBuilder

**`where(field: string, op: Operator, value: any): this`**
Add where clause.

**`select(...fields: string[]): this`**
Select specific fields.

**`orderBy(field: string, direction?: 'asc' | 'desc'): this`**
Order results.

**`limit(n: number): this`**
Limit number of results.

**`includeDeleted(): this`**
Include soft-deleted documents.

**`onlyDeleted(): this`**
Query only soft-deleted documents.

**`get(): Promise<(T & { id: ID })[]>`**
Execute query and return results.

**`getOne(): Promise<(T & { id: ID }) | null>`**
Get single result.

**`count(): Promise<number>`**
Count matching documents.

**`exists(): Promise<boolean>`**
Check if any documents match.

**`paginate(limit: number, cursorId?: ID): Promise<{ items: T[], nextCursorId?: ID }>`**
Cursor-based pagination.

**`offsetPaginate(page: number, pageSize: number): Promise<PaginationResult>`**
Offset-based pagination.

**`paginateWithCount(limit: number, cursorId?: ID): Promise<{ items: T[], nextCursorId?: ID, total: number }>`**
Paginate with total count.

**`update(data: Partial<T>): Promise<number>`**
Update all matching documents.

**`delete(): Promise<number>`**
Delete all matching documents.

**`softDelete(): Promise<number>`**
Soft delete all matching documents.

**`aggregate(field: string, operation: 'sum' | 'avg'): Promise<number>`**
Perform aggregation.

**`distinctValues<K extends keyof T>(field: K): Promise<T[K][]>`**
Get distinct values for field.

**`stream(): AsyncGenerator<T & { id: ID }>`**
Stream results.

**`onSnapshot(callback: (items: T[]) => void, onError?: (error: Error) => void): Promise<() => void>`**
Subscribe to real-time updates.

### Error Classes

**`ValidationError`**

Thrown when Zod schema validation fails.

Properties:
- `issues: ZodIssue[]` - Array of validation errors
- `message: string` - Formatted error message

**`NotFoundError`**

Thrown when a requested document is not found.

Properties:
- `message: string` - Error description

**`ConflictError`**

Thrown when operation conflicts with existing data.

Properties:
- `message: string` - Error description

**`FirestoreIndexError`**

Thrown when query requires a composite index.

Properties:
- `indexUrl: string` - URL to create the required index
- `fields: string[]` - Fields requiring indexing
- `toString(): string` - Returns formatted error message with instructions

### Error Handler Middleware

**`errorHandler(err: any, req: Request, res: Response, next: NextFunction): void`**

Express middleware for handling repository errors.

Maps errors to HTTP status codes:
- `ValidationError` → 400 Bad Request
- `NotFoundError` → 404 Not Found
- `ConflictError` → 409 Conflict
- `FirestoreIndexError` → 400 Bad Request
- Others → 500 Internal Server Error

## Advanced Patterns

### Pattern 1: Audit Logging

Track all data changes for compliance and debugging.

```typescript
// services/audit-log.service.ts
class AuditLogService {
  private auditRepo = new FirestoreRepository<AuditLog>(db, 'audit_logs');
  
  async record(action: string, data: any, userId?: string) {
    await this.auditRepo.create({
      action,
      data,
      userId: userId || 'system',
      timestamp: new Date().toISOString(),
      ipAddress: getCurrentIpAddress(),
      userAgent: getCurrentUserAgent()
    });
  }
}

export const auditLog = new AuditLogService();

// Apply to all repositories
userRepo.on('afterCreate', async (user) => {
  await auditLog.record('user_created', user, user.id);
});

userRepo.on('afterUpdate', async (user) => {
  await auditLog.record('user_updated', user, user.id);
});

userRepo.on('afterDelete', async (user) => {
  await auditLog.record('user_deleted', { id: user.id }, user.id);
});
```

### Pattern 2: Caching Layer

Add Redis caching to reduce Firestore reads.

```typescript
// repositories/cached-user.repository.ts
import { Redis } from 'ioredis';

class CachedUserRepository {
  private repo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
  private cache = new Redis(process.env.REDIS_URL);
  private cacheTTL = 300; // 5 minutes
  
  async getById(id: string): Promise<User | null> {
    // Check cache first
    const cached = await this.cache.get(`user:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Fallback to Firestore
    const user = await this.repo.getById(id);
    
    if (user) {
      await this.cache.setex(`user:${id}`, this.cacheTTL, JSON.stringify(user));
    }
    
    return user;
  }
  
  async update(id: string, data: Partial<User>): Promise<User> {
    const user = await this.repo.update(id, data);
    
    // Invalidate cache
    await this.cache.del(`user:${id}`);
    
    return user;
  }
  
  async create(data: User): Promise<User & { id: string }> {
    return this.repo.create(data);
  }
  
  // Delegate other methods to repo...
  query() {
    return this.repo.query();
  }
}

export const cachedUserRepo = new CachedUserRepository();
```

### Pattern 3: Search Integration

Integrate with Algolia or Elasticsearch for full-text search.

```typescript
// services/search.service.ts
import algoliasearch from 'algoliasearch';

class SearchService {
  private client = algoliasearch(
    process.env.ALGOLIA_APP_ID!,
    process.env.ALGOLIA_ADMIN_KEY!
  );
  
  private usersIndex = this.client.initIndex('users');
  private productsIndex = this.client.initIndex('products');
  
  async indexUser(user: User & { id: string }) {
    await this.usersIndex.saveObject({
      objectID: user.id,
      name: user.name,
      email: user.email,
      status: user.status
    });
  }
  
  async deleteUser(userId: string) {
    await this.usersIndex.deleteObject(userId);
  }
  
  async searchUsers(query: string) {
    const { hits } = await this.usersIndex.search(query);
    return hits;
  }
}

export const searchService = new SearchService();

// Sync with Algolia on user changes
userRepo.on('afterCreate', async (user) => {
  await searchService.indexUser(user);
});

userRepo.on('afterUpdate', async (user) => {
  await searchService.indexUser(user);
});

userRepo.on('afterDelete', async (user) => {
  await searchService.deleteUser(user.id);
});
```

### Pattern 4: Event-Driven Architecture

Publish domain events to message queue.

```typescript
// services/event-publisher.service.ts
import { EventEmitter } from 'events';

class EventPublisher extends EventEmitter {
  async publish(event: string, data: any) {
    this.emit(event, data);
    
    // Also publish to external queue (RabbitMQ, SQS, etc.)
    await messageQueue.publish(event, data);
  }
}

export const eventPublisher = new EventPublisher();

// Publish events on repository actions
userRepo.on('afterCreate', async (user) => {
  await eventPublisher.publish('user.created', user);
});

orderRepo.on('afterCreate', async (order) => {
  await eventPublisher.publish('order.placed', order);
});

// Consumers can subscribe to events
eventPublisher.on('user.created', async (user) => {
  await emailService.sendWelcomeEmail(user.email);
  await analyticsService.trackSignup(user);
});

eventPublisher.on('order.placed', async (order) => {
  await inventoryService.reserveStock(order);
  await notificationService.notifyWarehouse(order);
});
```

### Pattern 5: Multi-Database Strategy

Use different databases for different data types.

```typescript
// config/database.ts
import { getFirestore } from 'firebase-admin/firestore';

// Primary database for transactional data
export const primaryDb = getFirestore(primaryApp);

// Analytics database for reporting
export const analyticsDb = getFirestore(analyticsApp);

// repositories/user.repository.ts
export const userRepo = FirestoreRepository.withSchema<User>(
  primaryDb,
  'users',
  userSchema
);

// repositories/analytics.repository.ts
export const userAnalyticsRepo = new FirestoreRepository<UserAnalytics>(
  analyticsDb,
  'user_analytics'
);

// Sync analytics data
userRepo.on('afterCreate', async (user) => {
  await userAnalyticsRepo.create({
    userId: user.id,
    signupDate: user.createdAt,
    source: user.source,
    plan: user.plan
  });
});
```

### Pattern 6: Soft Delete with Archive

Archive soft-deleted documents to a separate collection.

```typescript
class ArchivingService {
  private archiveRepo = new FirestoreRepository<ArchivedDocument>(
    db,
    'archived_documents'
  );
  
  async archiveAndDelete<T>(
    repo: FirestoreRepository<T>,
    id: string
  ): Promise<void> {
    // Get document
    const doc = await repo.getById(id, true);
    
    if (!doc) {
      throw new NotFoundError('Document not found');
    }
    
    // Archive to separate collection
    await this.archiveRepo.create({
      originalCollection: repo.getCollectionPath(),
      originalId: id,
      data: doc,
      archivedAt: new Date().toISOString()
    });
    
    // Permanently delete from original collection
    await repo.delete(id);
  }
}

export const archivingService = new ArchivingService();

// Usage
await archivingService.archiveAndDelete(userRepo, 'user-123');
```

### Pattern 7: Rate Limiting with Repository

Implement rate limiting at the repository level.

```typescript
// decorators/rate-limited-repository.ts
import { RateLimiterMemory } from 'rate-limiter-flexible';

class RateLimitedRepository<T> {
  private rateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per 60 seconds
  });
  
  constructor(private repo: FirestoreRepository<T>) {}
  
  async create(data: T, userId: string): Promise<T & { id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.create(data);
  }
  
  async update(id: string, data: Partial<T>, userId: string): Promise<T & { id: string }> {
    await this.rateLimiter.consume(userId);
    return this.repo.update(id, data);
  }
  
  // Delegate other methods...
}

export const rateLimitedUserRepo = new RateLimitedRepository(userRepo);
```

## Migration Guide

### From Raw Firestore

**Before:**
```typescript
const usersRef = db.collection('users');

// Create
const docRef = await usersRef.add({
  name: 'John',
  email: 'john@example.com'
});

// Read
const snapshot = await usersRef.doc('user-123').get();
const user = snapshot.data();

// Update
await usersRef.doc('user-123').update({ name: 'Jane' });

// Delete
await usersRef.doc('user-123').delete();

// Query
const snapshot = await usersRef
  .where('status', '==', 'active')
  .get();
const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
```

**After:**
```typescript
const userRepo = FirestoreRepository.withSchema<User>(
  db,
  'users',
  userSchema
);

// Create (with validation)
const user = await userRepo.create({
  name: 'John',
  email: 'john@example.com'
});

// Read
const user = await userRepo.getById('user-123');

// Update (with validation)
await userRepo.update('user-123', { name: 'Jane' });

// Soft delete (recoverable)
await userRepo.softDelete('user-123');

// Query (type-safe)
const users = await userRepo.query()
  .where('status', '==', 'active')
  .get();
```

### From Typeorm/Prisma

If you're coming from SQL ORMs, here's how concepts map:

| TypeORM/Prisma | FirestoreORM |
|----------------|--------------|
| `@Entity()` | `z.object()` Zod schema |
| `findOne()` | `getById()` |
| `find()` | `query().get()` |
| `save()` | `create()` or `update()` |
| `remove()` | `delete()` or `softDelete()` |
| `@BeforeInsert()` | `on('beforeCreate')` |
| `@AfterUpdate()` | `on('afterUpdate')` |
| Transactions | `runInTransaction()` |
| Relations | Subcollections or manual joins |

**Key Differences:**
- Firestore is NoSQL, so no joins (use subcollections or denormalization)
- Firestore queries have limitations (inequality on one field, composite indexes required)
- No foreign key constraints (handle referential integrity in application)

## Troubleshooting

### Common Issues

**1. Composite Index Required**

```
Error: Query requires a Firestore index
```

**Solution:** Click the URL in the error message to create the index. Wait 1-2 minutes for it to build.

---

**2. Hooks Not Running in Transactions**

```typescript
// After hooks don't run
await repo.runInTransaction(async (tx, repo) => {
  await repo.createInTransaction(tx, data);
  // afterCreate hook will NOT run here
});
```

**Solution:** Run side effects after transaction completes:

```typescript
const result = await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.createInTransaction(tx, data);
  return doc;
});

// Now run side effects
await sendEmail(result.email);
```

---

**3. "in" Query Limit (10 items)**

```typescript
// Firestore limits "in" queries to 10 items
await userRepo.query()
  .where('id', 'in', arrayOf20Ids) // ERROR
  .get();
```

**Solution:** Chunk your queries:

```typescript
const chunks = chunkArray(ids, 10);
const results = [];

for (const chunk of chunks) {
  const users = await userRepo.query()
    .where('id', 'in', chunk)
    .get();
  results.push(...users);
}
```

---

**4. Query Ordering Requires Index**

```typescript
// This requires composite index
await repo.query()
  .where('status', '==', 'active')
  .orderBy('createdAt', 'desc') // Different field from where
  .get();
```

**Solution:** Create the composite index via the error message link, or order by the same field you filter on.

---

**5. Subcollection Parent ID Lost**

When querying subcollections, the parent ID isn't automatically included in results.

**Solution:** Use `getParentId()` method:

```typescript
const ordersRepo = userRepo.subcollection('user-123', 'orders');
const parentId = ordersRepo.getParentId(); // 'user-123'
```

---

## Performance Benchmarks

Based on testing with Firebase Admin SDK:

| Operation | Documents | Time | Notes |
|-----------|-----------|------|-------|
| `create()` | 1 | ~50ms | Single document write |
| `bulkCreate()` | 100 | ~300ms | Batched writes |
| `bulkCreate()` | 500 | ~800ms | Single batch |
| `bulkCreate()` | 1000 | ~1.6s | Split into 2 batches |
| `getById()` | 1 | ~30ms | Cached locally after first read |
| `query().get()` | 100 | ~100ms | Includes network + deserialization |
| `query().count()` | 10,000 | ~200ms | Aggregation query |
| `update()` | 1 | ~50ms | Partial update |
| `bulkUpdate()` | 100 | ~350ms | Batched updates |
| `transaction` | 2 reads + 2 writes | ~100ms | Atomic operation |

**Notes:**
- Times are averages from us-central1 region
- Network latency varies by region
- Firestore has built-in caching for frequently accessed docs

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests if applicable
5. Commit with clear messages (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

**Development Setup:**

```bash
git clone https://github.com/HBFLEX/spacelabs-firestoreorm.git
cd spacelabs-firestoreorm
npm install
npm run build
npm test
```

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Support

- **Issues:** [GitHub Issues](https://github.com/HBFLEX/spacelabs-firestoreorm/issues)
- **Documentation:** [GitHub Repository](https://github.com/HBFLEX/spacelabs-firestoreorm)
- **Email:** hbfl3x@gmail.com

---

## Acknowledgments

Built with frustration and determination by Happy Banda (HBFL3Xx) after years of wrestling with Firestore on the backend. This ORM is the tool I needed but couldn't find.

Special thanks to:
- The Firebase team for the Admin SDK
- The Zod team for incredible schema validation
- Everyone who's ever struggled with Firestore and thought "there has to be a better way"

If this ORM saves you time and headaches, consider giving it a star on GitHub. Every star motivates continued development and improvements.

---

## Roadmap

Planned features for future releases:

- looking forward for your suggestions here

---

**Made with code and coffee by HBFL3Xx**
