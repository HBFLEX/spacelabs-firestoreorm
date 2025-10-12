import { parseFirestoreError } from './ErrorParser';
import { ID } from './FirestoreRepository';
import { CollectionReference, Query, QuerySnapshot } from 'firebase-admin/firestore';



export class FirestoreQueryBuilder<T extends { id?: string }> {
    private query: Query;
    private includeDeletedFlag = false;
    private onlyDeletedFlag = false;

    constructor(
        private baseQuery: Query, 
        private collectionRef: CollectionReference,
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

    where<K extends keyof T>(
        field: K,
        op: FirebaseFirestore.WhereFilterOp,
        value: T[K]
    ): this {
        this.query = this.query.where(field as string, op, value);
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

    async count(): Promise<number> {
        const snapshot = await this.query.count().get();
        return snapshot.data().count;
    }

    async startAfterId(id: ID): Promise<this> {
        const doc = await this.collectionRef.doc(id).get();
        if(doc.exists) this.query = this.query.startAfter(doc);
        return this;
    }

    async get(): Promise<(T & { id: ID })[]>{
        try{
            let finalQuery = this.query;
            if(this.onlyDeletedFlag) finalQuery = finalQuery.where('deletedAt', '!=', null);
            else if (!this.includeDeletedFlag) finalQuery = finalQuery.where('deletedAt', '==', null)

            const snapshot: QuerySnapshot = await finalQuery.get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }
}
