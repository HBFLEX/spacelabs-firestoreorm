import { Firestore } from 'firebase-admin/firestore';
import { makeValidator, Validator } from './Validation';
import { z } from 'zod';
import { NotFoundError, ValidationError } from './Errors';
import { FirestoreQueryBuilder } from './QueryBuilder';
import { parseFirestoreError } from './ErrorParser';


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
    
type HookFn<T> = (data: Partial<T> &  { id?: ID }) => Promise<void> | void;
type SingleHookFn<T> = (data: Partial<T> & { id?: ID }) => Promise<void> | void;
type BulkCreateHookFn<T> = (data: (T & { id: ID })[]) => Promise<void> | void;
type BulkUpdateHookFn<T> = (data: { id: ID, data: Partial<T> }[]) => Promise<void> | void;
type BulkDeleteHookFn<T> = (data: { ids: ID[], documents: (T & { id: ID })[] }) => Promise<void> | void;
type BulkSoftDeleteHookFn<T> = (data: { ids: ID[], documents: (T & { id: ID })[], deletedAt: string }) => Promise<void> | void;
type BulkRestoreHookFn<T> = (data: { documents: (T & { id: ID })[] }) => Promise<void> | void;

type AnyHookFn<T> = 
    | SingleHookFn<T>
    | BulkCreateHookFn<T>
    | BulkUpdateHookFn<T>
    | BulkDeleteHookFn<T>
    | BulkSoftDeleteHookFn<T>
    | BulkRestoreHookFn<T>;

interface SubcollectionPath {
    parentId: ID;
    subcollectionName: string;
}


/**
 * Type-safe Firestore repository with validation, soft deletes, and lifecycle hooks.
 * Provides a clean API for common database operations with built-in error handling.
 *
 * @template T - The document type for this collection
 *
 * @example
 * // Basic usage without validation
 * const userRepo = new FirestoreRepository<User>(db, 'users');
 *
 * @example
 * // With Zod schema validation
 * const userRepo = FirestoreRepository.withSchema<User>(
 *   db,
 *   'users',
 *   userSchema
 * );
 *
 * @example
 * // With lifecycle hooks
 * const orderRepo = new FirestoreRepository<Order>(db, 'orders');
 * orderRepo.on('afterCreate', async (order) => {
 *   await sendOrderConfirmation(order);
 * });
 */
export class FirestoreRepository<T extends { id?: ID }> {
    private hooks: { [K in HookEvent]?: AnyHookFn<T>[] } = {};
    private parentPath?: string;

    constructor(
        private db: Firestore, 
        private collectionPath: string,
        private validator?: Validator<T>,
        parentPath?: string
    ) {
        this.parentPath = parentPath;
    }

    /**
     * Create a repository instance with Zod schema validation.
     * Automatically validates all create and update operations.
     *
     * @template U - The document type
     * @param db - Firestore database instance
     * @param collection - Collection path
     * @param schema - Zod schema for validation
     * @returns Repository instance with validation enabled
     *
     * @example
     * const userSchema = z.object({
     *   name: z.string().min(1),
     *   email: z.string().email(),
     *   age: z.number().int().positive().optional()
     * });
     *
     * const userRepo = FirestoreRepository.withSchema<User>(
     *   db,
     *   'users',
     *   userSchema
     * );
     *
     * @example
     * // Validation errors are thrown automatically
     * try {
     *   await userRepo.create({ name: '', email: 'invalid' });
     * } catch (error) {
     *   if (error instanceof ValidationError) {
     *     console.log(error.issues); // Zod validation errors
     *   }
     * }
     */
    static withSchema<U extends { id?: ID }>(
        db: Firestore,
        collection: string,
        schema: z.ZodObject<any>,
    ): FirestoreRepository<U> {
        const validator = makeValidator(schema) as Validator<U>;
        return new FirestoreRepository<U>(db, collection, validator);
    }

    /**
     * Access a subcollection under a specific parent document
     *
     * @example
     * // Access orders for a specific user
     * const userOrders = userRepo.subcollection<Order>('user-123', 'orders');
     * await userOrders.create({ product: 'Widget', price: 99 });
     *
     * @example
     * // With schema validation
     * const userOrders = userRepo.subcollection<Order>(
     *   'user-123',
     *   'orders',
     *   orderSchema
     * );
     *
     * @example
     * // Nested subcollections
     * const comments = postRepo
     *   .subcollection<Comment>('post-123', 'comments')
     *   .subcollection<Reply>('comment-456', 'replies');
     */
    subcollection<S extends { id?: ID }>(
        parentId: ID,
        subcollectionName: string,
        schema?: z.ZodObject<any>
    ): FirestoreRepository<S>{
        const newPath = `${this.collectionPath}/${parentId}/${subcollectionName}`;
        const validator = schema ? makeValidator(schema) as Validator<S> : undefined;

        return new FirestoreRepository<S>(
            this.db,
            newPath,
            validator,
            newPath, // for tracking parent path for reference
        );
    }

    /**
     * Get the parent document ID if this is a subcollection.
     * Returns null for top-level collections.
     *
     * @returns Parent document ID or null
     *
     * @example
     * const userOrders = userRepo.subcollection('user-123', 'orders');
     * console.log(userOrders.getParentId()); // 'user-123'
     *
     * @example
     * const topLevel = new FirestoreRepository(db, 'users');
     * console.log(topLevel.getParentId()); // null
     */
    getParentId(): ID | null {
        if(!this.parentPath) return null;
        // extract parent ID
        const parts = this.collectionPath.split('/');
        if(parts.length < 2) return null;
        return parts[parts.length - 2];
    }

    /**
     * Get the full Firestore path for this collection.
     *
     * @returns The collection path string
     *
     * @example
     * const repo = new FirestoreRepository(db, 'users');
     * console.log(repo.getCollectionPath()); // 'users'
     *
     * @example
     * const orders = userRepo.subcollection('user-123', 'orders');
     * console.log(orders.getCollectionPath()); // 'users/user-123/orders'
     */
    getCollectionPath(): string {
        return this.collectionPath;
    }

    /**
     * Check if this repository represents a subcollection.
     *
     * @returns True if this is a subcollection, false if top-level
     *
     * @example
     * const users = new FirestoreRepository(db, 'users');
     * console.log(users.isSubcollection()); // false
     *
     * @example
     * const orders = users.subcollection('user-123', 'orders');
     * console.log(orders.isSubcollection()); // true
     */
    isSubcollection(): boolean {
        return this.collectionPath.includes('/');
    }

    /**
     * Register a lifecycle hook to run before or after operations.
     * Hooks allow you to add custom logic like logging, validation, or side effects.
     *
     * @param event - The lifecycle event to hook into
     * @param fn - Async or sync function to execute
     *
     * @example
     * // Log all creates
     * userRepo.on('afterCreate', (user) => {
     *   console.log(`User created: ${user.id}`);
     * });
     *
     * @example
     * // Send email on user creation
     * userRepo.on('afterCreate', async (user) => {
     *   await sendWelcomeEmail(user.email);
     * });
     *
     * @example
     * // Validate business logic before update
     * orderRepo.on('beforeUpdate', (data) => {
     *   if (data.status === 'shipped' && !data.trackingNumber) {
     *     throw new Error('Tracking number required for shipped orders');
     *   }
     * });
     *
     * @example
     * // Bulk operation hooks
     * userRepo.on('afterBulkDelete', async ({ ids, documents }) => {
     *   await auditLog.record('users_deleted', { count: ids.length });
     * });
     */
    on(event: SingleHookEvent, fn: SingleHookFn<T>): void;
    on(event: 'beforeBulkCreate' | 'afterBulkCreate', fn: BulkCreateHookFn<T>): void;
    on(event: 'beforeBulkUpdate' | 'afterBulkUpdate', fn: BulkUpdateHookFn<T>): void;
    on(event: 'beforeBulkDelete' | 'afterBulkDelete', fn: BulkDeleteHookFn<T>): void;
    on(event: 'beforeBulkSoftDelete' | 'afterBulkSoftDelete', fn: BulkSoftDeleteHookFn<T>): void;
    on(event: 'beforeBulkRestore' | 'afterBulkRestore', fn: BulkRestoreHookFn<T>): void;
    on(event: HookEvent, fn: AnyHookFn<T>): void {
        if(!this.hooks[event]) this.hooks[event] = [];
        this.hooks[event]!.push(fn);
    }

    private async runHooks(event: HookEvent, data: any) {
        const fns = this.hooks[event] || [];
        for(const fn of fns) await fn(data);
    }

    private col(){
        return this.db.collection(this.collectionPath);
    }

    /**
     * Create a new document in the collection.
     * Automatically adds soft delete support and runs validation if schema is configured.
     *
     * @param data - Document data (without ID)
     * @returns Created document with generated ID
     * @throws {ValidationError} If schema validation fails
     *
     * @example
     * // Simple create
     * const user = await userRepo.create({
     *   name: 'John Doe',
     *   email: 'john@example.com'
     * });
     * console.log(user.id); // Auto-generated ID
     *
     * @example
     * // With validation error handling
     * try {
     *   await userRepo.create({ name: '', email: 'invalid' });
     * } catch (error) {
     *   if (error instanceof ValidationError) {
     *     console.log(error.issues); // Field-specific errors
     *   }
     * }
     */
    async create(data: T): Promise<T & { id: ID }> {
        try{
            const validData = this.validator ? this.validator.parseCreate(data) : data;
            const docToCreate = { ...validData, deletedAt: null };

            await this.runHooks('beforeCreate', docToCreate);

            const docRef = await this.col().add(docToCreate as any);
            const created = { ...docToCreate, id: docRef.id };

            await this.runHooks('afterCreate', created);
            return created;
        }catch(err: any){
            if(err instanceof z.ZodError){
                throw new ValidationError(err.issues);
            }
            throw parseFirestoreError(err);
        }
    }

    /**
     * Create multiple documents in a single batched operation.
     * More efficient than calling create() in a loop. Uses Firestore batches (500 ops per batch).
     *
     * @param dataArray - Array of documents to create
     * @returns Array of created documents with generated IDs
     * @throws {ValidationError} If any document fails validation
     *
     * @example
     * // Bulk insert users
     * const users = await userRepo.bulkCreate([
     *   { name: 'Alice', email: 'alice@example.com' },
     *   { name: 'Bob', email: 'bob@example.com' },
     *   { name: 'Charlie', email: 'charlie@example.com' }
     * ]);
     *
     * @example
     * // Import from CSV
     * const products = csvData.map(row => ({
     *   name: row.name,
     *   price: parseFloat(row.price),
     *   sku: row.sku
     * }));
     * await productRepo.bulkCreate(products);
     */
    async bulkCreate(dataArray: T[]): Promise<(T & { id: ID })[]> {
        try{
            const colRef = this.col();
            const createdDocs: (T & {id: ID})[] = [];
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];

            for(const data of dataArray){
                const validData = this.validator ? this.validator.parseCreate(data) : data;
                const docRef = colRef.doc();
                const docData = { ...validData, deletedAt: null } as any;

                actions.push(batch => batch.set(docRef, docData))
                createdDocs.push({ ...docData, id: docRef.id });
            }

            await this.runHooks('beforeBulkCreate', createdDocs);
            await this.commitInChunks(actions);
            await this.runHooks('afterBulkCreate', createdDocs);
            return createdDocs;
        }catch(error: any){
            if(error instanceof z.ZodError) throw new ValidationError(error.issues);
            throw parseFirestoreError(error);
        }
    }

    /**
     * Retrieve a document by its ID.
     * Returns null if the document doesn't exist or is soft-deleted (unless includeDeleted is true).
     *
     * @param id - Document ID
     * @param includeDeleted - If true, return soft-deleted documents
     * @returns Document with ID or null if not found
     *
     * @example
     * // Get active user
     * const user = await userRepo.getById('user-123');
     * if (user) {
     *   console.log(user.name);
     * }
     *
     * @example
     * // Include soft-deleted documents
     * const deletedUser = await userRepo.getById('user-123', true);
     * if (deletedUser?.deletedAt) {
     *   console.log('User was deleted on:', deletedUser.deletedAt);
     * }
     */
    async getById(id: ID, includeDeleted = false): Promise<(T & {id: ID}) | null> {
        try{
            const snapshot = await this.col().doc(id).get();
            if(!snapshot.exists) return null;

            const data = snapshot.data() as any;
            if(!includeDeleted && data?.deletedAt) return null;
            return { ...(data as T), id };
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Update an existing document with partial data.
     * Only provided fields are updated; other fields remain unchanged.
     *
     * @param id - Document ID to update
     * @param data - Partial document data to merge
     * @returns Updated document
     * @throws {NotFoundError} If document doesn't exist
     * @throws {ValidationError} If validation fails
     *
     * @example
     * // Update specific fields
     * await userRepo.update('user-123', {
     *   email: 'newemail@example.com',
     *   updatedAt: new Date()
     * });
     *
     * @example
     * // Conditional update
     * const user = await userRepo.getById('user-123');
     * if (user && user.status === 'pending') {
     *   await userRepo.update(user.id, { status: 'active' });
     * }
     */
    async update(id: ID, data: Partial<T>): Promise<T & {id: ID}> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);
            const validData = this.validator ? this.validator.parseUpdate(data) : data;

            const toUpdate = { ...validData, id };

            await this.runHooks('beforeUpdate', toUpdate);

            const updated = { ...snapshot.data(), ...toUpdate};
            await docRef.set(updated, { merge: true });

            await this.runHooks('afterUpdate', updated);
            return updated as T & {id: ID};
        }catch(error: any){
            if(error instanceof z.ZodError){
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
        
    }

    /**
     * Update multiple documents in a single batched operation.
     * More efficient than calling update() in a loop.
     *
     * @param updates - Array of update operations with ID and data
     * @returns Array of updated documents
     * @throws {NotFoundError} If any document doesn't exist
     * @throws {ValidationError} If any validation fails
     *
     * @example
     * // Batch update user statuses
     * await userRepo.bulkUpdate([
     *   { id: 'user-1', data: { status: 'active' } },
     *   { id: 'user-2', data: { status: 'active' } },
     *   { id: 'user-3', data: { status: 'inactive' } }
     * ]);
     *
     * @example
     * // Update prices for multiple products
     * const priceUpdates = products.map(p => ({
     *   id: p.id,
     *   data: { price: p.price * 1.1 } // 10% increase
     * }));
     * await productRepo.bulkUpdate(priceUpdates);
     *
     * @example
     * // update order status for multiple orders (efficient & recommended way for simple bulk updates)
     * await orderRepo.query().where('status', '==', 'pending').update({ status: 'shipped' })
     */
    async bulkUpdate(updates: { id: ID, data: Partial<T> }[]): Promise<(T & { id: ID })[]> {
        try{
            await this.runHooks('beforeBulkUpdate', updates);

            const snapshots = await Promise.all(
                updates.map(({ id }) => this.col().doc(id).get())
            );

            const updatedDocs: (T & { id: ID })[] = [];
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];

            for(let i = 0; i < updates.length; i++){
                const { id, data } = updates[i];
                const snapshot = snapshots[i];
                const docRef = this.col().doc(id);

                if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
                const validData = this.validator ? this.validator.parseUpdate(data) : data;
                const merged = { ...snapshot.data(), ...validData, id };

                actions.push(batch => batch.set(docRef, merged, { merge: true }));
                updatedDocs.push(merged as (T & { id: ID }));
            }

            await this.commitInChunks(actions);
            await this.runHooks('afterBulkUpdate', updates);
            return updatedDocs;
        }catch(error: any){
            if(error instanceof z.ZodError) throw new ValidationError(error.issues);
            throw parseFirestoreError(error);
        }
    }

    /**
     * Create a new document if it doesn't exist, or update it if it does.
     * Uses the provided ID instead of auto-generating one.
     *
     * @param id - Document ID to upsert
     * @param data - Full document data
     * @returns Created or updated document
     * @throws {ValidationError} If validation fails
     *
     * @example
     * // Sync external data
     * await userRepo.upsert('external-id-123', {
     *   name: 'John Doe',
     *   email: 'john@example.com',
     *   source: 'external-api'
     * });
     *
     * @example
     * // Idempotent operations
     * await settingsRepo.upsert('app-config', {
     *   theme: 'dark',
     *   notifications: true
     * });
     */
    async upsert(id: ID, data: T): Promise<T & { id: ID }> {
        try{
            const existing = await this.getById(id);
            if(existing) return await this.update(id, data);

            const validData = this.validator ? this.validator.parseCreate(data) : data;
            const docToCreate = { ...validData, deletedAt: null };

            await this.runHooks('beforeCreate', { ...docToCreate, id });

            const docRef = this.col().doc(id);
            await docRef.set(docToCreate as any);
            const created = { ...docToCreate, id };

            await this.runHooks('afterCreate', created);
            return created;
        }catch(error: any){
            if(error instanceof z.ZodError){
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
    }

    /**
     * Permanently delete a document from Firestore.
     * This is a hard delete - the document cannot be recovered.
     *
     * @param id - Document ID to delete
     * @throws {NotFoundError} If document doesn't exist
     *
     * @example
     * // Delete a user permanently
     * await userRepo.delete('user-123');
     *
     * @example
     * // Delete with error handling
     * try {
     *   await userRepo.delete('user-123');
     *   console.log('User deleted successfully');
     * } catch (error) {
     *   if (error instanceof NotFoundError) {
     *     console.log('User not found');
     *   }
     * }
     */
    async delete(id: ID): Promise<void> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);
            
            const docData = { ...snapshot.data() as T, id };
            await this.runHooks('beforeDelete', docData);
            await docRef.delete();
            await this.runHooks('afterDelete', docData);
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Permanently delete multiple documents in a batched operation.
     * This is a hard delete - documents cannot be recovered.
     *
     * @param ids - Array of document IDs to delete
     * @returns Number of documents actually deleted
     *
     * @example
     * // Delete multiple users
     * const deletedCount = await userRepo.bulkDelete([
     *   'user-1',
     *   'user-2',
     *   'user-3'
     * ]);
     * console.log(`Deleted ${deletedCount} users`);
     *
     * @example
     * // Clean up test data
     * const testUserIds = await userRepo.query()
     *   .where('email', 'array-contains', '@test.com')
     *   .get()
     *   .then(users => users.map(u => u.id));
     * await userRepo.bulkDelete(testUserIds);
     */
    async bulkDelete(ids: ID[]): Promise<number> {
        try{

            const snapshots = await Promise.all(
                ids.map(id => this.col().doc(id).get())
            );

            const docsData: (T & { id: ID })[] = snapshots
                .filter(snapshot => snapshot.exists)
                .map(snapshot => ({
                    ...snapshot.data() as T,
                    id: snapshot.id
                })
            );

            if(docsData.length == 0) return 0;

            await this.runHooks('beforeBulkDelete', {
                ids: docsData.map(d => d.id),
                documents: docsData
            });

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const doc of docsData){
                const docRef = this.col().doc(doc.id);
                actions.push(batch => batch.delete(docRef));
            }

            await this.commitInChunks(actions);
            await this.runHooks('afterBulkDelete', {
                ids: docsData.map(d => d.id),
                documents: docsData
            });
            return docsData.length;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Soft delete a document by setting its deletedAt timestamp.
     * Document remains in Firestore but is excluded from queries by default.
     *
     * @param id - Document ID to soft delete
     * @throws {NotFoundError} If document doesn't exist
     *
     * @example
     * // Soft delete a user (can be restored later)
     * await userRepo.softDelete('user-123');
     *
     * @example
     * // Check if user was deleted
     * const user = await userRepo.getById('user-123', true);
     * if (user?.deletedAt) {
     *   console.log('User deleted at:', user.deletedAt);
     * }
     */
    async softDelete(id: ID): Promise<void> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
            const docData = { ...snapshot.data() as T, id };
            const deletedAt = new Date().toISOString();

            await this.runHooks('beforeSoftDelete', { ...docData, deletedAt });
            await docRef.update({ deletedAt });
            await this.runHooks('afterSoftDelete', { ...docData, deletedAt });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Soft delete multiple documents in a batched operation.
     * Documents remain in Firestore but are excluded from queries by default.
     *
     * @param ids - Array of document IDs to soft delete
     * @returns Number of documents actually soft deleted
     *
     * @example
     * // Soft delete inactive users
     * const inactiveIds = await userRepo.query()
     *   .where('lastLogin', '<', oneYearAgo)
     *   .get()
     *   .then(users => users.map(u => u.id));
     * await userRepo.bulkSoftDelete(inactiveIds);
     *
     * @example
     * // Archive old orders
     * const oldOrderIds = ['order-1', 'order-2', 'order-3'];
     * const archivedCount = await orderRepo.bulkSoftDelete(oldOrderIds);
     * console.log(`Archived ${archivedCount} orders`);
     */
    async bulkSoftDelete(ids: ID[]): Promise<number> {
        try{
            const snapshots = await Promise.all(
                ids.map(id => this.col().doc(id).get())
            );

            const docsData: (T & { id: ID })[] = snapshots
                .filter(snapshot => snapshot.exists)
                .map(snapshot => ({
                    ...snapshot.data() as T,
                    id: snapshot.id
                })
            );
            
            if(docsData.length === 0) return 0;

            const deletedAt = new Date().toISOString();
            await this.runHooks('beforeBulkSoftDelete', {
                ids: docsData.map(d => d.id),
                documents: docsData,
                deletedAt
            });

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const id of ids){
                const docRef = this.col().doc(id);
                actions.push(batch => batch.update(docRef, { deletedAt }));
            }
            await this.commitInChunks(actions);
            await this.runHooks('afterBulkSoftDelete', {
                ids: docsData.map(d => d.id),
                documents: docsData,
                deletedAt
            });
            return docsData.length;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Permanently delete all soft-deleted documents.
     * Use this to clean up documents that were previously soft deleted.
     *
     * @returns Number of documents permanently deleted
     *
     * @example
     * // Clean up all soft-deleted users
     * const purgedCount = await userRepo.purgeDelete();
     * console.log(`Permanently deleted ${purgedCount} users`);
     *
     * @example
     * // Scheduled cleanup job
     * cron.schedule('0 0 * * 0', async () => {
     *   const deleted = await userRepo.purgeDelete();
     *   console.log(`Weekly cleanup: ${deleted} users purged`);
     * });
     */
    async purgeDelete(): Promise<number> {
        try{
            const snapshot = await this.col().where('deletedAt', '!=', null).get();
            if(snapshot.empty) return 0;

            // max (500) per batch
            let batch = this.db.batch();
            let counter = 0;
            let totalDeleted = 0;

            for(const doc of snapshot.docs){
                batch.delete(doc.ref);
                counter++;
                totalDeleted++;

                // commit every 500 operations
                if(counter === 500){
                    await batch.commit();
                    batch = this.db.batch();
                    counter = 0;
                }
            }
            // commit remaining deletes
            if(counter > 0) await batch.commit();
            return totalDeleted;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Restore a soft-deleted document by removing its deletedAt timestamp.
     * Document becomes accessible in normal queries again.
     *
     * @param id - Document ID to restore
     * @throws {NotFoundError} If document doesn't exist
     *
     * @example
     * // Restore a deleted user
     * await userRepo.restore('user-123');
     *
     * @example
     * // Restore with verification
     * const user = await userRepo.getById('user-123', true);
     * if (user?.deletedAt) {
     *   await userRepo.restore(user.id);
     *   console.log('User restored successfully');
     * }
     */
    async restore(id: ID): Promise<void>{
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
            const docData = { ...snapshot.data() as T, id };

            await this.runHooks('beforeRestore', docData);
            await docRef.update({ deletedAt: null });
            await this.runHooks('afterRestore', { ...docData, deletedAt: null });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Restore all soft-deleted documents in the collection.
     * Useful for bulk recovery operations.
     *
     * @returns Number of documents restored
     *
     * @example
     * // Restore all deleted users
     * const restoredCount = await userRepo.restoreAll();
     * console.log(`Restored ${restoredCount} users`);
     *
     * @example
     * // Undo accidental bulk delete
     * await orderRepo.restoreAll();
     */
    async restoreAll(): Promise<number>{
        try{
            const snapshot = await this.col().where('deletedAt', '!=', null).get();
            if(snapshot.empty) return 0;

            const docsData = snapshot.docs.map(doc => ({
                ...doc.data() as T,
                id: doc.id,
            }));

            await this.runHooks('beforeBulkRestore', { documents: docsData });

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];

            for(const doc of snapshot.docs){
                actions.push(batch => batch.update(doc.ref, { deletedAt: null }));
            }
            await this.commitInChunks(actions);
            await this.runHooks('afterBulkRestore', { documents: docsData });
            return snapshot.size;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Find documents by a specific field value.
     * Simple equality search on a single field.
     *
     * @param field - The field name to search on
     * @param value - The value to match
     * @returns Array of matching documents
     *
     * @example
     * // Find users by email
     * const users = await userRepo.findByField('email', 'john@example.com');
     *
     * @example
     * // Find orders by status
     * const pendingOrders = await orderRepo.findByField('status', 'pending');
     */
    async findByField<K extends keyof T>(field: K, value: T[K] ): Promise<(T & { id: ID})[]> {
        try{
            const snapshot = await this.col().where(field as string, '==', value).get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * List documents with simple pagination.
     * Uses cursor-based pagination for efficient large dataset traversal.
     *
     * @param limit - Maximum number of documents to return
     * @param startAfterId - Document ID to start after (for next page)
     * @param includeDeleted - If true, include soft-deleted documents
     * @returns Array of documents
     *
     * @example
     * // First page
     * const firstPage = await userRepo.list(20);
     *
     * @example
     * // Next page (use paginate from query for efficient pagination)
     * const lastId = firstPage[firstPage.length - 1]?.id;
     * const nextPage = await userRepo.list(20, lastId);
     *
     * @example
     * // Include deleted documents
     * const allUsers = await userRepo.list(50, undefined, true);
     */
    async list(limit = 10, startAfterId?: string, includeDeleted = false): Promise<(T & { id: ID})[]> {
        try{
            let query = this.col().limit(limit);

            if(!includeDeleted){
                query = query.where('deletedAt', '==', null);
            }

            if(startAfterId){
                const startDoc = await this.col().doc(startAfterId).get();
                if(startDoc.exists) query = query.startAfter(startDoc);
            }
            const snapshot = await query.get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Create a query builder for complex queries.
     * Provides a fluent API for filtering, sorting, pagination, and more.
     *
     * @returns Query builder instance
     *
     * @example
     * // Simple query
     * const activeUsers = await userRepo.query()
     *   .where('status', '==', 'active')
     *   .get();
     *
     * @example
     * // Complex query with multiple conditions
     * const results = await orderRepo.query()
     *   .where('status', '==', 'pending')
     *   .where('total', '>', 100)
     *   .orderBy('createdAt', 'desc')
     *   .limit(50)
     *   .get();
     *
     * @example
     * // Pagination
     * const page = await productRepo.query()
     *   .where('category', '==', 'electronics')
     *   .orderBy('price', 'desc')
     *   .paginate(20, lastCursorId);
     */
    query(): FirestoreQueryBuilder<T>{
        return new FirestoreQueryBuilder<T>(
            this.col(), 
            this.col(),
            this.db,
            this.commitInChunks.bind(this),
            this.runHooks.bind(this)
        );
    }

    private async commitInChunks(
        actions: ((batch: FirebaseFirestore.WriteBatch) => void)[]
    ): Promise<void> {
        let batch = this.db.batch();
        let counter = 0;

        for(const action of actions){
            action(batch);
            counter++;

            if(counter === 500){
                await batch.commit();
                batch = this.db.batch();
                counter = 0;
            }
        }

        if(counter > 0) await batch.commit();
    }

    /**
     * Execute a function within a Firestore transaction.
     * Ensures atomic operations with automatic rollback on failure.
     *
     * @template R - Return type of the transaction function
     * @param fn - Transaction function that receives transaction and repository
     * @returns Result of the transaction function
     *
     * @example
     * // Transfer balance between accounts
     * await accountRepo.runInTransaction(async (tx, repo) => {
     *   const from = await repo.getForUpdate(tx, 'account-1');
     *   const to = await repo.getForUpdate(tx, 'account-2');
     *
     *   if (!from || from.balance < 100) {
     *     throw new Error('Insufficient funds');
     *   }
     *
     *   await repo.updateInTransaction(tx, from.id, {
     *     balance: from.balance - 100
     *   });
     *   await repo.updateInTransaction(tx, to.id, {
     *     balance: to.balance + 100
     *   });
     * });
     *
     * @example
     * // Atomic counter increment
     * const newCount = await counterRepo.runInTransaction(async (tx, repo) => {
     *   const counter = await repo.getForUpdate(tx, 'global-counter');
     *   const newValue = (counter?.value || 0) + 1;
     *   await repo.updateInTransaction(tx, 'global-counter', {
     *     value: newValue
     *   });
     *   return newValue;
     * });
     */
    async runInTransaction<R>(
        fn: (
            tx: FirebaseFirestore.Transaction,
            repo: FirestoreRepository<T>
        ) => Promise<R>
    ): Promise<R> {
        try{
            return await this.db.runTransaction(async (tx) => {
                const txRepo = new FirestoreRepository<T>(
                    this.db,
                    this.collectionPath,
                    this.validator,
                    this.parentPath
                );
                // override col() to use transaction reads/writes
                (txRepo as any).col = () => this.db.collection(this.collectionPath);
                // pass transaction + repo to user callback
                return await fn(tx, txRepo);
            });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Get a document within a transaction for update.
     * Ensures you read the latest version before updating.
     *
     * @param tx - Firestore transaction object
     * @param id - Document ID
     * @param includeDeleted - If true, include soft-deleted documents
     * @returns Document or null if not found
     *
     * @example
     * await repo.runInTransaction(async (tx, repo) => {
     *   const user = await repo.getForUpdate(tx, 'user-123');
     *   if (user) {
     *     await repo.updateInTransaction(tx, user.id, {
     *       loginCount: (user.loginCount || 0) + 1
     *     });
     *   }
     * });
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
     * Update a document within a transaction.
     * Must be used inside runInTransaction callback.
     *
     * @param tx - Firestore transaction object
     * @param id - Document ID
     * @param data - Partial data to update
     * @throws {ValidationError} If validation fails
     *
     * @example
     * await repo.runInTransaction(async (tx, repo) => {
     *   await repo.updateInTransaction(tx, 'product-123', {
     *     stock: product.stock - quantity
     *   });
     * });
     */
    async updateInTransaction(
        tx: FirebaseFirestore.Transaction,
        id: ID,
        data: Partial<T>
    ): Promise<void> {
        try{
            const docRef = this.col().doc(id);
            const validData = this.validator ? this.validator.parseUpdate(data) : data;

            const toUpdate = { ...validData, id };
            await this.runHooks('beforeUpdate', toUpdate);
            tx.set(docRef, validData, { merge: true });
        }catch(error: any){
            if(error instanceof z.ZodError){
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
    }

    /**
     * Create a document within a transaction.
     * Must be used inside runInTransaction callback.
     *
     * @param tx - Firestore transaction object
     * @param data - Document data
     * @returns Created document with ID
     * @throws {ValidationError} If validation fails
     *
     * @example
     * await repo.runInTransaction(async (tx, repo) => {
     *   const newOrder = await repo.createInTransaction(tx, {
     *     userId: 'user-123',
     *     total: 99.99,
     *     status: 'pending'
     *   });
     *   console.log('Order created:', newOrder.id);
     * });
     */
    async createInTransaction(
        tx: FirebaseFirestore.Transaction,
        data: T
    ): Promise<T & { id: ID }> {
        try{
            const validData = this.validator ? this.validator.parseCreate(data) : data;
            const docRef = this.col().doc();
            const docData = { ...validData, deletedAt: null } as any;

            await this.runHooks('beforeCreate', { ...docData, id: docRef.id });
            tx.set(docRef, docData);

            return { ...docData, id: docRef.id };
        }catch(error: any){
            if(error instanceof z.ZodError){
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
    }

    /**
     * Delete a document within a transaction.
     * Must be used inside runInTransaction callback.
     *
     * @param tx - Firestore transaction object
     * @param id - Document ID
     * @throws {NotFoundError} If document doesn't exist
     *
     * @example
     * await repo.runInTransaction(async (tx, repo) => {
     *   const item = await repo.getForUpdate(tx, 'item-123');
     *   if (item && item.quantity === 0) {
     *     await repo.deleteInTransaction(tx, item.id);
     *   }
     * });
     */
    async deleteInTransaction(
        tx: FirebaseFirestore.Transaction,
        id: ID,
    ): Promise<void> {
        try{
            const docRef = this.col().doc(id);
            const snapshot = await tx.get(docRef);

            if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);

            const docData = { ...snapshot.data() as T, id };
            await this.runHooks('beforeDelete', docData);
            tx.delete(docRef);
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

}