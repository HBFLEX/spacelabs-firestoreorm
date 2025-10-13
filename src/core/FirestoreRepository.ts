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


export class FirestoreRepository<T extends { id?: ID }> {
    private hooks: { [K in HookEvent]?: AnyHookFn<T>[] } = {};

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
        return this.db.collection(this.collection);
    }

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
            const docData = { ...snapshot.data() as T, id };

            await this.runHooks('beforeRestore', docData);
            await docRef.update({ deletedAt: null });
            await this.runHooks('afterRestore', { ...docData, deletedAt: null });
        }catch(error: any){
            throw parseFirestoreError(error);
        }
    }

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