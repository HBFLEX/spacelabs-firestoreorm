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
            const snapshot = await this.col().where('deletedAt', '!=', null).get();
            if(snapshot.empty) return 0;

            const batch = this.db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, { deletedAt: null });
            });

            await batch.commit();
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
}