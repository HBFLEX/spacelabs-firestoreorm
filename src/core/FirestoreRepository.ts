import { Firestore } from 'firebase-admin/firestore';
import { makeValidator, Validator } from './Validation';
import { z } from 'zod';
import { NotFoundError, ValidationError } from './Errors';
import { FirestoreQueryBuilder } from './QueryBuilder';
import { parseFirestoreError } from './ErrorParser';

export type ID = string;


export class FirestoreRepository<T extends { id?: ID }> {
    constructor(
        private db: Firestore, 
        private collection: string,
        private validator?: Validator<T>,
    ) {}

    static withSchema<U extends { id?: ID }>(
        db: Firestore,
        collection: string,
        schema: z.ZodObject<any>,
    ): FirestoreRepository<U> {
        const validator = makeValidator(schema) as Validator<U>;
        return new FirestoreRepository<U>(db, collection, validator);
    }

    private col(){
        return this.db.collection(this.collection);
    }

    async create(data: T): Promise<T & { id: ID }> {
        try{
            const validData = this.validator ? this.validator.parseCreate(data) : data;
            const docRef = await this.col().add({ ...validData, deletedAt: null } as any);
            return { ...validData, deletedAt: null, id: docRef.id };
        }catch(err: any){
            if(err instanceof z.ZodError){
                throw new ValidationError(err.issues);
            }
            throw parseFirestoreError(err);
        }
    }

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

            await this.commitInChunks(actions);
            return createdDocs;
        }catch(error: any){
            if(error instanceof z.ZodError) throw new ValidationError(error.issues);
            throw parseFirestoreError(error);
        }
    }


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

    async update(id: ID, data: Partial<T>): Promise<T & {id: ID}> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);
            const validData = this.validator ? this.validator.parseUpdate(data) : data;
            const updated = { ...snapshot.data(), ...validData, id };
            await docRef.set(updated, { merge: true });
            return updated as T & {id: ID};
        }catch(error: any){
            if(error instanceof z.ZodError){
                throw new ValidationError(error.issues);
            }
            throw parseFirestoreError(error);
        }
        
    }

    async bulkUpdate(updates: { id: ID, data: Partial<T> }[]): Promise<(T & { id: ID })[]> {
        try{
            const updatedDocs: (T & { id: ID })[] = [];
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];

            for(const { id, data } of updates){
                const docRef = this.col().doc(id);
                const snapshot = await docRef.get();

                if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
                const validData = this.validator ? this.validator.parseUpdate(data) : data;
                const merged = { ...snapshot.data(), ...validData, id };

                actions.push(batch => batch.set(docRef, merged, { merge: true }));
                updatedDocs.push(merged as (T & { id: ID }));
            }

            await this.commitInChunks(actions);
            return updatedDocs;
        }catch(error: any){
            if(error instanceof z.ZodError) throw new ValidationError(error.issues);
            throw parseFirestoreError(error);
        }
    }

    async delete(id: ID): Promise<void> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);
            await docRef.delete();
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async bulkDelete(ids: ID[]): Promise<number> {
        try{
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const id of ids){
                const docRef = this.col().doc(id);
                actions.push(batch => batch.delete(docRef));
            }

            await this.commitInChunks(actions);
            return ids.length;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async softDelete(id: ID): Promise<void> {
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
            await docRef.update({ deletedAt: new Date().toISOString() });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async bulkSoftDelete(ids: ID[]): Promise<number> {
        try{
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for(const id of ids){
                const docRef = this.col().doc(id);
                actions.push(batch => batch.update(docRef, { deletedAt: new Date().toISOString() }));
            }
            await this.commitInChunks(actions);
            return ids.length;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

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

    async restore(id: ID): Promise<void>{
        try{
            const docRef = await this.col().doc(id);
            const snapshot = await docRef.get();

            if(!snapshot.exists) throw new NotFoundError(`Document with ID ${id} not found`);
            await docRef.update({ deletedAt: null });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async restoreAll(): Promise<number>{
        try{
            const actions: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            const snapshot = await this.col().where('deletedAt', '!=', null).get();
            if(snapshot.empty) return 0;

            for(const doc of snapshot.docs){
                actions.push(batch => batch.update(doc.ref, { deletedAt: null }));
            }
            await this.commitInChunks(actions);
            return snapshot.size;
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

    async findByField<K extends keyof T>(field: K, value: T[K] ): Promise<(T & { id: ID})[]> {
        try{
            const snapshot = await this.col().where(field as string, '==', value).get();
            return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

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

    query(): FirestoreQueryBuilder<T>{
        return new FirestoreQueryBuilder<T>(this.col(), this.col());
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
     * Run a set of operations inside a Firestore transaction.
     * 
     * @param fn - A callback that receives the Firestore Transaction object
     *             and the repository instance (bound to the same collection).
     * @returns The result of the callback.
    */

    async runInTransaction<R>(
        fn: (
            tx: FirebaseFirestore.Transaction,
            repo: FirestoreRepository<T>
        ) => Promise<R>
    ): Promise<R> {
        try{
            return await this.db.runTransaction(async (tx) => {
                const txRepo = new FirestoreRepository<T>(this.db, this.collection, this.validator);
                // override col() to use transaction reads/writes
                (txRepo as any).col = () => this.db.collection(this.collection);
                // pass transaction + repo to user callback
                return await fn(tx, txRepo);
            });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

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

    async updateInTransaction(
        tx: FirebaseFirestore.Transaction,
        id: ID,
        data: Partial<T>
    ): Promise<void> {
        const docRef = this.col().doc(id);
        const validData = this.validator ? this.validator.parseUpdate(data) : data;
        tx.set(docRef, validData, { merge: true });
    }

    async createInTransaction(
        tx: FirebaseFirestore.Transaction,
        data: T
    ): Promise<T & { id: ID }> {
        const validData = this.validator ? this.validator.parseCreate(data) : data;
        const docRef = this.col().doc();
        const docData = { ...validData, deletedAt: null } as any;
        tx.set(docRef, docData);

        return { ...docData, id: docRef.id };
    }

    async deleteInTransaction(
        tx: FirebaseFirestore.Transaction,
        id: ID,
    ): Promise<void> {
        const docRef = this.col().doc(id);
        tx.delete(docRef);
    }

}