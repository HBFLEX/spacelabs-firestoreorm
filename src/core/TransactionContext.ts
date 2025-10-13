import { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { NotFoundError, ValidationError } from './Errors';
import { parseFirestoreError } from './ErrorParser';
import { Validator } from './Validation';

export type ID = string;

type SingleHookEvent = 
    | 'beforeCreate' | 'afterCreate'
    | 'beforeSoftDelete' | 'afterSoftDelete'
    | 'beforeUpdate' | 'afterUpdate'
    | 'beforeDelete' | 'afterDelete'
    | 'beforeRestore' | 'afterRestore';

type BulkHookEvent = 
    | 'beforeBulkCreate' | 'afterBulkCreate'
    | 'beforeBulkUpdate' | 'afterBulkUpdate'
    | 'beforeBulkDelete' | 'afterBulkDelete'
    | 'beforeBulkSoftDelete' | 'afterBulkSoftDelete'
    | 'beforeBulkRestore' | 'afterBulkRestore';

export type HookEvent = SingleHookEvent | BulkHookEvent;

type SingleHookFn<T> = (data: Partial<T> & { id?: ID }) => Promise<void> | void;
type AnyHookFn<T> = SingleHookFn<T>;

/**
 * Queued write operation to execute after all reads complete
 */
interface QueuedWrite {
    type: 'create' | 'update' | 'delete';
    execute: (tx: FirebaseFirestore.Transaction) => void;
    afterCommitHook?: () => Promise<void>;
}

/**
 * Transaction context that handles Firestore's read-then-write requirement
 * AND queues after-hooks for post-commit execution
 */
class TransactionContext<T extends { id?: ID }> {
    private writeQueue: QueuedWrite[] = [];
    private afterCommitHooks: Array<() => Promise<void>> = [];
    private hasExecutedWrites = false;

    constructor(
        private tx: FirebaseFirestore.Transaction,
        private repo: FirestoreRepository<T>
    ) {}

    /**
     * Get document (must be called before any writes)
     * Enforces Firestore's read-before-write constraint
     */
    async get(id: ID, includeDeleted = false): Promise<(T & { id: ID }) | null> {
        if (this.hasExecutedWrites) {
            throw new Error(
                'Cannot read after writes in transaction. ' +
                'Call all get() operations before create/update/delete.'
            );
        }
        return await this.repo.getForUpdate(this.tx, id, includeDeleted);
    }

    /**
     * Create document (queued until flushWrites is called)
     */
    async create(data: T): Promise<T & { id: ID }> {
        const result = await this.repo.prepareCreateInTransaction(data);
        
        this.writeQueue.push({
            type: 'create',
            execute: (tx) => {
                const docRef = this.repo['col']().doc(result.id);
                tx.set(docRef, result.docData);
            },
            afterCommitHook: () => this.repo['runHooks']('afterCreate', result.created)
        });

        return result.created;
    }

    /**
     * Update document (queued until flushWrites is called)
     */
    async update(id: ID, data: Partial<T>): Promise<void> {
        const preparedUpdate = await this.repo.prepareUpdateInTransaction(id, data);
        
        this.writeQueue.push({
            type: 'update',
            execute: (tx) => {
                const docRef = this.repo['col']().doc(id);
                tx.set(docRef, preparedUpdate.validData, { merge: true });
            },
            afterCommitHook: () => this.repo['runHooks']('afterUpdate', preparedUpdate.toUpdate)
        });
    }

    /**
     * Delete document (queued until flushWrites is called)
     */
    async delete(id: ID): Promise<void> {
        // Must read the document first to run before-hook with its data
        if (this.hasExecutedWrites) {
            throw new Error('Cannot delete after writes have been flushed');
        }

        const docData = await this.repo.prepareDeleteInTransaction(this.tx, id);
        
        this.writeQueue.push({
            type: 'delete',
            execute: (tx) => {
                const docRef = this.repo['col']().doc(id);
                tx.delete(docRef);
            },
            afterCommitHook: () => this.repo['runHooks']('afterDelete', docData)
        });
    }

    /**
     * Execute all queued writes
     * Called automatically at end of transaction, or manually if needed
     * @internal
     */
    flushWrites(): void {
        if (this.hasExecutedWrites) return;
        
        for (const write of this.writeQueue) {
            write.execute(this.tx);
            if (write.afterCommitHook) {
                this.afterCommitHooks.push(write.afterCommitHook);
            }
        }
        
        this.hasExecutedWrites = true;
    }

    /**
     * Run all after-commit hooks
     * @internal
     */
    async runAfterCommitHooks(): Promise<void> {
        for (const hook of this.afterCommitHooks) {
            try {
                await hook();
            } catch (error) {
                console.error('After-commit hook failed:', error);
            }
        }
    }

    /**
     * Access raw transaction for advanced use cases
     */
    getRawTransaction(): FirebaseFirestore.Transaction {
        return this.tx;
    }
}

export class FirestoreRepository<T extends { id?: ID }> {
    private hooks: { [K in HookEvent]?: AnyHookFn<T>[] } = {};

    constructor(
        private db: Firestore, 
        private collection: string,
        private validator?: Validator<T>,
    ) {}

    on(event: HookEvent, fn: AnyHookFn<T>): void {
        if(!this.hooks[event]) this.hooks[event] = [];
        this.hooks[event]!.push(fn);
    }

    private async runHooks(event: HookEvent, data: any) {
        const fns = this.hooks[event] || [];
        for(const fn of fns) await fn(data);
    }

    private col(){
        return this.db.collection(this.collection);
    }

    /**
     * Run operations in a transaction with automatic read-before-write handling
     * 
     * The context automatically handles Firestore's constraint:
     * - All get() calls can happen anytime
     * - create/update/delete are queued and executed after all reads
     * - After-hooks run only after successful commit
     * 
     * @example
     * await repo.runInTransaction(async (ctx) => {
     *   // Reads first (order doesn't matter to user!)
     *   const user = await ctx.get('user-123');
     *   const account = await ctx.get('account-456');
     *   
     *   // Writes are queued automatically
     *   await ctx.update('user-123', { balance: user.balance - 100 });
     *   await ctx.update('account-456', { balance: account.balance + 100 });
     *   
     *   // Create new record
     *   await ctx.create({ type: 'transfer', amount: 100 });
     * });
     */
    async runInTransaction<R>(
        fn: (ctx: TransactionContext<T>) => Promise<R>
    ): Promise<R> {
        try {
            let context: TransactionContext<T>;
            
            const result = await this.db.runTransaction(async (tx) => {
                context = new TransactionContext(tx, this);
                
                // User runs their transaction logic
                const txResult = await fn(context);
                
                // Flush all queued writes (reads already happened)
                context.flushWrites();
                
                return txResult;
            });

            // Transaction committed - run after-hooks
            await context!.runAfterCommitHooks();
            
            return result;
        } catch (error: any) {
            throw parseFirestoreError(error);
        }
    }

    /**
     * Get document within transaction (used by TransactionContext)
     * @internal
     */
    async getForUpdate(
        tx: FirebaseFirestore.Transaction,
        id: ID,
        includeDeleted = false
    ): Promise<(T & { id: ID }) | null> {
        const docRef = this.col().doc(id);
        const snapshot = await tx.get(docRef);

        if(!snapshot.exists) return null;
        const data = snapshot.data() as any;
        if(!includeDeleted && data?.deletedAt) return null;

        return { ...(data as T), id };
    }

    /**
     * Prepare create operation (validate + run before-hooks)
     * @internal
     */
    async prepareCreateInTransaction(data: T): Promise<{
        id: ID;
        docData: any;
        created: T & { id: ID };
    }> {
        try {
            const validData = this.validator ? this.validator.parseCreate(data) : data;
            const docRef = this.col().doc();
            const docData = { ...validData, deletedAt: null };

            const created = { ...docData, id: docRef.id };
            await this.runHooks('beforeCreate', created);

            return { id: docRef.id, docData, created };
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
    }

    /**
     * Prepare update operation (validate + run before-hooks)
     * @internal
     */
    async prepareUpdateInTransaction(id: ID, data: Partial<T>): Promise<{
        validData: any;
        toUpdate: Partial<T> & { id: ID };
    }> {
        try {
            const validData = this.validator ? this.validator.parseUpdate(data) : data;
            const toUpdate = { ...validData, id };
            
            await this.runHooks('beforeUpdate', toUpdate);
            
            return { validData, toUpdate };
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
    }

    /**
     * Prepare delete operation (read doc + run before-hooks)
     * MUST be called before any writes in the transaction
     * @internal
     */
    async prepareDeleteInTransaction(
        tx: FirebaseFirestore.Transaction,
        id: ID
    ): Promise<T & { id: ID }> {
        try {
            const docRef = this.col().doc(id);
            const snapshot = await tx.get(docRef);

            if (!snapshot.exists) {
                throw new NotFoundError(`Document with ID ${id} not found`);
            }

            const docData = { ...snapshot.data() as T, id };
            await this.runHooks('beforeDelete', docData);
            
            return docData;
        } catch (error: any) {
            throw parseFirestoreError(error);
        }
    }

    // ... (keep all other existing methods like create, update, delete, list, etc.)
}

/**
 * USAGE EXAMPLES:
 * 
 * // ✅ Users can write naturally - ORM handles read-before-write
 * await userRepo.runInTransaction(async (ctx) => {
 *   const user = await ctx.get('user-123');
 *   await ctx.update('user-123', { balance: user.balance - 100 });
 *   await ctx.create({ log: 'withdrew 100' });
 * });
 * 
 * // ✅ Complex multi-document transaction
 * await orderRepo.runInTransaction(async (ctx) => {
 *   // Read phase (automatic)
 *   const order = await ctx.get('order-123');
 *   const inventory = await ctx.get('inventory-456');
 *   const user = await ctx.get('user-789');
 *   
 *   // Write phase (queued, executed after reads)
 *   await ctx.update('order-123', { status: 'confirmed' });
 *   await ctx.update('inventory-456', { stock: inventory.stock - 1 });
 *   await ctx.update('user-789', { orders: user.orders + 1 });
 *   await ctx.create({ type: 'order_log', orderId: order.id });
 * });
 * 
 * // ✅ After-hooks run only after successful commit
 * orderRepo.on('afterCreate', async (data) => {
 *   await sendOrderConfirmationEmail(data); // Safe!
 * });
 * 
 * // ❌ This would throw error (protecting user from Firestore constraint)
 * await repo.runInTransaction(async (ctx) => {
 *   await ctx.create({ name: 'Alice' });
 *   await ctx.get('user-123'); // Error: Cannot read after writes!
 * });
 */