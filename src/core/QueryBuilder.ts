import { parseFirestoreError } from './ErrorParser';
import { HookEvent, ID } from './FirestoreRepository';
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

    includeDeleted(): this {
        this.includeDeletedFlag = true;
        return this;
    }

    onlyDeleted(): this {
        this.onlyDeletedFlag = true;
        this.includeDeletedFlag = false;
        return this;
    }

    where<K extends keyof T, Op extends WhereOpsForValue<T[K]>>(
        field: K,
        op: Op,
        value: WhereValueForOp<T[K], Op>
    ): this {
        this.query = this.query.where(field as string, op as any, value as any);
        return this;
    }

    select<K extends keyof T>(...fields: K[]): this {
        this.query = this.query.select(...(fields as string[]));
        return this;
    }

    orderBy(field: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
        this.query = this.query.orderBy(field as string, direction);
        return this;
    }

    limit(n: number): this {
        this.query = this.query.limit(n);
        return this;
    }

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

    async softDelete(): Promise<number> {
        try{
            const finalQuery = await this.applySoftDeleteFilter(this.query);
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

    async count(): Promise<number> {
        const finalQuery = await this.applySoftDeleteFilter(this.query);
        const snapshot = await finalQuery.count().get();
        return snapshot.data().count;
    }

    async totalCount(): Promise<number> {
        try{
            const snapshot = await this.collectionRef.count().get();
            return snapshot.data().count;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async startAfterId(id: ID): Promise<this> {
        const doc = await this.collectionRef.doc(id).get();
        if(doc.exists) this.query = this.query.startAfter(doc);
        return this;
    }

    async paginate(limit: number, cursorId?: ID): Promise<{
        items: (T & { id: ID })[];
        nextCursorId: ID | undefined;
    }> {
        try{
            let finalQuery = await this.applySoftDeleteFilter(this.query);

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

    async paginateWithCount(
        limit: number,
        cursorId?: ID
    ): Promise<{ items: (T & { id: ID })[]; nextCursorId: ID | undefined; total: number }> {
        const total = await this.count();
        const { items, nextCursorId } = await this.paginate(limit, cursorId);
        return { items, nextCursorId, total };
    }

    async applySoftDeleteFilter(q: Query): Promise<Query> {
        if(this.onlyDeletedFlag) return q.where('deletedAt', '!=', null);
        if(!this.includeDeletedFlag) return q.where('deletedAt', '==', null);
        return q;
    }

    async get(): Promise<(T & { id: ID })[]>{
        try{
            const finalQuery = await this.applySoftDeleteFilter(this.query);
            const snapshot: QuerySnapshot = await finalQuery.get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }
}
