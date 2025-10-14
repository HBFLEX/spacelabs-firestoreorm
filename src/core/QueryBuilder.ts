import { parseFirestoreError } from './ErrorParser.js';
import { HookEvent, ID } from './FirestoreRepository.js';
import { CollectionReference, Firestore, Query, QuerySnapshot, Timestamp } from 'firebase-admin/firestore';


type Scalar = string | number | boolean | Date | Timestamp;
type EqOps = '==' | '!=';
type CmpOps = '<' | '<=' | '>' | '>=';
type InOps = 'in' | 'not-in';
type ArrOps = 'array-contains' | 'array-contains-any';

type WhereOpsForValue<V> =
  V extends readonly (infer E)[] | (infer E)[]
    ? EqOps | ArrOps
    : V extends string | number | Date | Timestamp
      ? EqOps | CmpOps | InOps
      : V extends boolean
        ? EqOps | InOps
        : EqOps;

type WhereValueForOp<V, Op> =
  Op extends 'in' | 'not-in'
    ? V extends readonly (infer E)[] | (infer E)[]
      ? E[]
      : V[]
    : Op extends 'array-contains'
      ? V extends readonly (infer E)[] | (infer E)[]
        ? E 
        : never
    : Op extends 'array-contains-any'
      ? V extends readonly (infer E)[] | (infer E)[]
        ? E[]
        : never
    : V;

type FirestoreWriteBatch = (actions: ((batch: FirebaseFirestore.WriteBatch) => void)[]) => Promise<void>;
type RunHook = (event: HookEvent, data: any) => Promise<void>;

export class FirestoreQueryBuilder<T extends { id?: string }> {
    private query: Query;
    private includeDeletedFlag = false;
    private onlyDeletedFlag = false;

    constructor(
        private baseQuery: Query, 
        private collectionRef: CollectionReference,
        private db: Firestore,
        private commitInChunks:FirestoreWriteBatch,
        private runHooks: RunHook,
    ){
        this.query = baseQuery;
    }


    /**
     * Include soft-deleted documents in query results.
     * By default, soft-deleted documents (with deletedAt field) are excluded.
     *
     * @example
     * // Get all users including soft-deleted ones
     * const allUsers = await userRepo.query()
     *   .includeDeleted()
     *   .get();
     *
     * @example
     * // Count all orders including deleted
     * const totalCount = await orderRepo.query()
     *   .includeDeleted()
     *   .count();
     *
     * @returns The query builder instance
     */
    includeDeleted(): this {
        this.includeDeletedFlag = true;
        return this;
    }

    /**
     * Query only soft-deleted documents.
     * Useful for managing or recovering deleted data.
     *
     * @example
     * // Find all deleted users
     * const deletedUsers = await userRepo.query()
     *   .onlyDeleted()
     *   .get();
     *
     * @example
     * // Count deleted orders from last month
     * const deletedCount = await orderRepo.query()
     *   .onlyDeleted()
     *   .where('deletedAt', '>', lastMonth)
     *   .count();
     *
     * @returns The query builder instance
     */
    onlyDeleted(): this {
        this.onlyDeletedFlag = true;
        this.includeDeletedFlag = false;
        return this;
    }

    /**
     * Add a where clause to filter documents.
     * Supports various operators based on field type.
     *
     * @param field - The field to filter on
     * @param op - The comparison operator
     * @param value - The value to compare against
     *
     * @example
     * // Basic equality
     * await userRepo.query()
     *   .where('status', '==', 'active')
     *   .get();
     *
     * @example
     * // Comparison operators
     * await productRepo.query()
     *   .where('price', '>', 100)
     *   .where('stock', '>=', 10)
     *   .get();
     *
     * @example
     * // Array operations
     * await postRepo.query()
     *   .where('tags', 'array-contains', 'javascript')
     *   .get();
     *
     * @example
     * // In/Not-in queries
     * await orderRepo.query()
     *   .where('status', 'in', ['pending', 'processing'])
     *   .get();
     *
     * @returns The query builder instance
     */
    where<K extends keyof T | string, Op extends WhereOpsForValue<any>>(
        field: K,
        op: Op,
        value: any
    ): this {
        this.query = this.query.where(field as string, op as any, value as any);
        return this;
    }

    /**
     * Select specific fields to reduce bandwidth and improve performance.
     * Returns partial documents with only the specified fields.
     *
     * @param fields - Fields to include in the result
     *
     * @example
     * // Get only name and email for users
     * const users = await userRepo.query()
     *   .select('name', 'email')
     *   .get();
     *
     * @example
     * // Combine with where clause
     * const activeUserEmails = await userRepo.query()
     *   .where('status', '==', 'active')
     *   .select('email')
     *   .get();
     *
     * @returns The query builder instance
     */
    select<K extends keyof T>(...fields: K[]): this {
        this.query = this.query.select(...(fields as string[]));
        return this;
    }

    /**
     * Update all documents matching the query
     *
     * @example
     * // Update all pending orders to shipped
     * await ordersRepo.query()
     *   .where('status', '==', 'pending')
     *   .update({ status: 'shipped' });
     *
     * @example
     * // Update with multiple fields
     * await ordersRepo.query()
     *   .where('category', '==', 'electronics')
     *   .update({
     *     discount: 0.1,
     *     updatedAt: new Date().toISOString()
     *   });
     */
    async update(data: Partial<T>): Promise<number> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();

            if(snapshot.empty) return 0;

            const docsData: (T & { id: ID })[] = [];

            for(const doc of snapshot.docs) docsData.push({ ...(doc.data() as T), id: doc.id });

            const updates = docsData.map(doc => ({
                id: doc.id,
                data
            }));

            await this.runHooks('beforeBulkUpdate', updates);

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const doc of snapshot.docs)
                actions.push(batch => batch.update(doc.ref, data as any));

            await this.commitInChunks(actions);
            await this.runHooks('afterBulkUpdate', updates);
            return snapshot.size;
        }catch(error){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Order query results by a specific field.
     * Can be chained for multi-field sorting.
     *
     * @param field - The field to sort by
     * @param direction - Sort direction: 'asc' (default) or 'desc'
     *
     * @example
     * // Sort users by creation date, newest first
     * const recentUsers = await userRepo.query()
     *   .orderBy('createdAt', 'desc')
     *   .limit(10)
     *   .get();
     *
     * @example
     * // Multi-field sorting
     * const products = await productRepo.query()
     *   .orderBy('category', 'asc')
     *   .orderBy('price', 'desc')
     *   .get();
     *
     * @returns The query builder instance
     */
    orderBy(field: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
        this.query = this.query.orderBy(field as string, direction);
        return this;
    }

    /**
     * Limit the number of documents returned.
     * Useful for pagination and performance optimization.
     *
     * @param n - Maximum number of documents to return
     *
     * @example
     * // Get top 5 products by price
     * const topProducts = await productRepo.query()
     *   .orderBy('price', 'desc')
     *   .limit(5)
     *   .get();
     *
     * @example
     * // First page of results
     * const firstPage = await userRepo.query()
     *   .orderBy('createdAt', 'desc')
     *   .limit(20)
     *   .get();
     *
     * @returns The query builder instance
     */
    limit(n: number): this {
        this.query = this.query.limit(n);
        return this;
    }

    /**
     * Permanently delete all documents matching the query.
     * This is a hard delete - documents cannot be recovered.
     *
     * @returns Number of documents deleted
     *
     * @example
     * // Delete all cancelled orders older than 30 days
     * const deletedCount = await orderRepo.query()
     *   .where('status', '==', 'cancelled')
     *   .where('createdAt', '<', thirtyDaysAgo)
     *   .delete();
     *
     * @example
     * // Delete all test users
     * await userRepo.query()
     *   .where('email', 'array-contains', '@test.com')
     *   .delete();
     */
    async delete(): Promise<number> {
        try{
            const docsData: (T & { id: ID })[] = [];
            const finalQuery = await this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();

            if(snapshot.empty) return 0;
            for(const doc of snapshot.docs) docsData.push({ ...doc.data() as T, id: doc.id });

            const ids = docsData.map(doc => doc.id);
            await this.runHooks('beforeBulkDelete', { ids, documents: docsData });

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const doc of snapshot.docs) actions.push(batch => batch.delete(doc.ref));

            await this.commitInChunks(actions);
            await this.runHooks('afterBulkDelete', { ids, documents: docsData });
            return snapshot.size;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Soft delete all documents matching the query.
     * Documents are marked with deletedAt timestamp but not removed.
     *
     * @returns Number of documents soft deleted
     *
     * @example
     * // Soft delete inactive users
     * const deletedCount = await userRepo.query()
     *   .where('lastLogin', '<', oneYearAgo)
     *   .softDelete();
     *
     * @example
     * // Soft delete products out of stock
     * await productRepo.query()
     *   .where('stock', '==', 0)
     *   .where('restockDate', '==', null)
     *   .softDelete();
     */
    async softDelete(): Promise<number> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();
            if(snapshot.empty) return 0;

            const docsData: (T & { id: ID })[] = [];

            for(const doc of snapshot.docs) docsData.push({ ...doc.data() as T, id: doc.id });
            const ids = docsData.map(doc => doc.id);
            await this.runHooks('beforeBulkSoftDelete', { ids, documents: docsData });

            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const doc of snapshot.docs){
                actions.push(batch => batch.update(doc.ref, { deletedAt: new Date().toISOString() }));
            }

            await this.commitInChunks(actions);
            await this.runHooks('afterBulkSoftDelete', { ids, documents: docsData });
            return snapshot.size;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Count documents matching the query.
     * More efficient than fetching all documents when you only need the count.
     *
     * @returns Number of documents matching the query
     *
     * @example
     * // Count active users
     * const activeCount = await userRepo.query()
     *   .where('status', '==', 'active')
     *   .count();
     *
     * @example
     * // Count orders in date range
     * const orderCount = await orderRepo.query()
     *   .where('createdAt', '>=', startDate)
     *   .where('createdAt', '<=', endDate)
     *   .count();
     */
    async count(): Promise<number> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.count().get();
            return snapshot.data().count;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Get total count of all documents in the collection.
     * Ignores any where clauses but respects soft delete filter.
     *
     * @returns Total number of documents in the collection
     *
     * @example
     * // Get total user count (excluding soft deleted)
     * const total = await userRepo.query().totalCount();
     *
     * @example
     * // Get total including deleted
     * const totalWithDeleted = await userRepo.query()
     *   .includeDeleted()
     *   .totalCount();
     */
    async totalCount(): Promise<number> {
        try{
            const snapshot = await this.collectionRef.count().get();
            return snapshot.data().count;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Start query results after a specific document ID.
     * Used for cursor-based pagination.
     *
     * @param id - The document ID to start after
     *
     * @example
     * // Get next page of results
     * const nextPage = await userRepo.query()
     *   .orderBy('createdAt')
     *   .startAfterId(lastUserId)
     *   .limit(20)
     *   .get();
     */
    async startAfterId(id: ID): Promise<this> {
        try{
            const doc = await this.collectionRef.doc(id).get();
            if(doc.exists) this.query = this.query.startAfter(doc);
            return this;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Paginate through query results using cursor-based pagination.
     * More efficient than offset pagination for large datasets.
     *
     * @param limit - Number of items per page
     * @param cursorId - ID of the last document from previous page
     * @returns Object with items array and nextCursorId for the next page
     *
     * @example
     * // First page
     * const firstPage = await productRepo.query()
     *   .where('category', '==', 'electronics')
     *   .orderBy('price', 'desc')
     *   .paginate(20);
     *
     * @example
     * // Next page
     * const nextPage = await productRepo.query()
     *   .where('category', '==', 'electronics')
     *   .orderBy('price', 'desc')
     *   .paginate(20, firstPage.nextCursorId);
     */
    async paginate(limit: number, cursorId?: ID): Promise<{
        items: (T & { id: ID })[];
        nextCursorId: ID | undefined;
    }> {
        try{
            let finalQuery = this.applySoftDeleteFilter(this.query);

            if(cursorId){
                const startDoc = await this.collectionRef.doc(cursorId).get()
                if(startDoc.exists) finalQuery = await finalQuery.startAfter(startDoc);
            }

            finalQuery = await finalQuery.limit(limit);
            const snapshot: QuerySnapshot = await finalQuery.get();
            const items = snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));

            const last = snapshot.docs[snapshot.docs.length - 1];
            const nextCursorId = last ? last.id as ID : undefined;

            return { items, nextCursorId };
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Paginate using offset/limit (traditional pagination).
     * Less efficient than cursor pagination for large datasets.
     *
     * @param page - Page number (1-based)
     * @param pageSize - Number of items per page
     * @returns Paginated results with metadata
     *
     * @example
     * // Get page 2 with 20 items per page
     * const results = await userRepo.query()
     *   .where('role', '==', 'customer')
     *   .orderBy('createdAt', 'desc')
     *   .offsetPaginate(2, 20);
     *
     * console.log(`Page ${results.page} of ${results.totalPages}`);
     * console.log(`Showing ${results.items.length} of ${results.total} total`);
     */
    async offsetPaginate(page: number, pageSize: number): Promise<{
        items: (T & { id: ID })[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    }> {
        try{
            const total = await this.count();
            const offset = (page - 1) * pageSize;

            let finalQuery = this.applySoftDeleteFilter(this.query);
            finalQuery = finalQuery.offset(offset).limit(pageSize);

            const snapshot = await finalQuery.get();
            const items = snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));

            return {
                items,
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            }
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Get a single document matching the query.
     * Returns null if no documents match.
     *
     * @returns The first matching document or null
     *
     * @example
     * // Find user by email
     * const user = await userRepo.query()
     *   .where('email', '==', 'john@example.com')
     *   .getOne();
     *
     * @example
     * // Get the cheapest product in category
     * const cheapest = await productRepo.query()
     *   .where('category', '==', 'books')
     *   .orderBy('price', 'asc')
     *   .getOne();
     */
    async getOne(): Promise<(T & { id: ID }) | null> {
        const results = await this.limit(1).get();
        return results[0] || null;
    }

    /**
     * Check if any documents match the query.
     * More efficient than count() when you only need to know if results exist.
     *
     * @returns True if at least one document matches
     *
     * @example
     * // Check if email is already taken
     * const emailExists = await userRepo.query()
     *   .where('email', '==', newEmail)
     *   .exists();
     *
     * @example
     * // Check if user has any orders
     * const hasOrders = await orderRepo.query()
     *   .where('userId', '==', userId)
     *   .exists();
     */
    async exists(): Promise<boolean> {
        const count = await this.limit(1).count();
        return count > 0;
    }

    /**
     * Perform aggregation operations on numeric fields.
     * Currently supports sum and average calculations.
     *
     * @param field - The numeric field to aggregate
     * @param operation - 'sum' or 'avg'
     * @returns The calculated aggregate value
     *
     * @example
     * // Calculate total revenue
     * const totalRevenue = await orderRepo.query()
     *   .where('status', '==', 'completed')
     *   .aggregate('total', 'sum');
     *
     * @example
     * // Calculate average product rating
     * const avgRating = await reviewRepo.query()
     *   .where('productId', '==', productId)
     *   .aggregate('rating', 'avg');
     */
    async aggregate(field: keyof T, operation: 'sum' | 'avg'): Promise<number> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();

            const values = snapshot.docs
                .map(doc => doc.data()[field as string])
                .filter(value => typeof value === 'number') as number[];

                if(operation === 'sum') return values.reduce((sum, val) => sum + val, 0);
                return values.length > 0
                    ? values.reduce((sum, val) => sum + val, 0) / values.length
                    : 0;
        }catch(error: any){
            throw parseFirestoreError(error);
        }

    }

    /**
     * Get all distinct values for a specific field.
     * Useful for generating filter options or analyzing data distribution.
     *
     * @param field - The field to get distinct values from
     * @returns Array of unique values
     *
     * @example
     * // Get all product categories
     * const categories = await productRepo.query()
     *   .distinctValues('category');
     *
     * @example
     * // Get all order statuses in use
     * const statuses = await orderRepo.query()
     *   .where('createdAt', '>', lastMonth)
     *   .distinctValues('status');
     */
    async distinctValues<K extends keyof T>(field: K): Promise<T[K][]> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();
            const values = snapshot.docs.map(doc => doc.data()[field as string]);
            return [ ...new Set(values) ].filter(val => val != undefined) as T[K][];
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Stream query results as an async generator.
     * Memory efficient for processing large datasets.
     *
     * @yields Documents one at a time
     *
     * @example
     * // Process all users without loading into memory
     * for await (const user of userRepo.query().stream()) {
     *   await sendEmail(user.email);
     *   console.log(`Processed user ${user.id}`);
     * }
     *
     * @example
     * // Export data to CSV
     * const csvStream = createWriteStream('users.csv');
     * for await (const user of userRepo.query()
     *   .where('subscribed', '==', true)
     *   .stream()) {
     *   csvStream.write(`${user.name},${user.email}\n`);
     * }
     */
    async *stream(): AsyncGenerator<T & { id: ID }> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot = await finalQuery.get();
            for(const doc of snapshot.docs)
                yield { ...(doc.data() as T), id: doc.id };
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Subscribe to real-time updates for documents matching the query.
     * Callback is triggered whenever matching documents are added, modified, or removed.
     *
     * @param callback - Function called with updated results
     * @param onError - Optional error handler
     * @returns Unsubscribe function to stop listening
     *
     * @example
     * // Monitor active orders in real-time
     * const unsubscribe = await orderRepo.query()
     *   .where('status', '==', 'active')
     *   .onSnapshot(
     *     (orders) => {
     *       console.log(`Active orders: ${orders.length}`);
     *       updateDashboard(orders);
     *     },
     *     (error) => console.error('Snapshot error:', error)
     *   );
     *
     * // Later: stop listening
     * unsubscribe();
     */
    async onSnapshot(
        callback: (items: (T & { id: ID })[]) => void,
        onError?: (error: Error) => void
    ): Promise<() => void> {
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
        
            return finalQuery.onSnapshot(
                snapshot => {
                    const items = snapshot.docs.map(doc => ({
                        ...(doc.data() as T),
                        id: doc.id
                    }));
                    callback(items);
                },
                error => {
                    if(onError) onError(error);
                }
            );
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    /**
     * Paginate with total count included.
     * Combines paginate() and count() in a single method.
     *
     * @param limit - Number of items per page
     * @param cursorId - ID of the last document from previous page
     * @returns Paginated results with total count
     *
     * @example
     * // Get paginated results with progress info
     * const { items, nextCursorId, total } = await productRepo.query()
     *   .where('inStock', '==', true)
     *   .paginateWithCount(20, lastId);
     *
     * console.log(`Showing ${items.length} of ${total} products`);
     */
    async paginateWithCount(
        limit: number,
        cursorId?: ID
    ): Promise<{ items: (T & { id: ID })[]; nextCursorId: ID | undefined; total: number }> {
        try{
            const total = await this.count();
            const { items, nextCursorId } = await this.paginate(limit, cursorId);
            return { items, nextCursorId, total };
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    private applySoftDeleteFilter(q: Query): Query {
        if(this.onlyDeletedFlag) return q.where('deletedAt', '!=', null);
        if(!this.includeDeletedFlag) return q.where('deletedAt', '==', null);
        return q;
    }

    /**
     * Execute the query and return all matching documents.
     * This is the main method to retrieve query results.
     *
     * @returns Array of documents matching the query
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
     *   .where('createdAt', '>=', startOfDay)
     *   .orderBy('createdAt', 'desc')
     *   .limit(50)
     *   .get();
     */
    async get(): Promise<(T & { id: ID })[]>{
        try{
            const finalQuery = this.applySoftDeleteFilter(this.query);
            const snapshot: QuerySnapshot = await finalQuery.get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }
}
