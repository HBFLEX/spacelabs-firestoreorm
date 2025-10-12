import { Firestore } from 'firebase-admin/firestore';
import { makeValidator, Validator } from './Validation';
import { z } from 'zod';
import { NotFoundError, ValidationError } from './Errors';

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
            const docRef = await this.col().add(validData as any);
            return { ...validData, id: docRef.id };
        }catch(err: any){
            if(err instanceof z.ZodError){
                throw new ValidationError(err.issues);
            }
            throw err;
        }
    }

    async getById(id: ID): Promise<(T & {id: ID}) | null> {
        const snapshot = await this.col().doc(id).get();
        if(!snapshot.exists) return null;
        return { ...(snapshot.data() as T), id };
    }

    async update(id: ID, data: Partial<T>): Promise<T & {id: ID}> {
        const docRef = await this.col().doc(id);
        const snapshot = await docRef.get();

        if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);

        try{
            const validData = this.validator ? this.validator.parseUpdate(data) : data;
            const updated = { ...snapshot.data(), ...validData, id };
            await docRef.set(updated, { merge: true });
            return updated as T & {id: ID};
        }catch(err){
            if(err instanceof z.ZodError){
                throw new ValidationError(err.issues);
            }
            throw err;
        }
    }

    async delete(id: ID): Promise<void> {
        const docRef = await this.col().doc(id);
        const snapshot = await docRef.get();

        if(!snapshot.exists) throw new NotFoundError(`Document with id ${id} not found`);
        await docRef.delete();
    }

    async findByField<K extends keyof T>(field: K, value: T[K] ): Promise<(T & { id: ID})[]> {
        const snapshot = await this.col().where(field as string, '==', value).get();
        return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
    }

    async list(limit = 10, startAfterId?: string): Promise<(T & { id: ID})[]> {
        let query = this.col().limit(limit);

        if(startAfterId){
            const startDoc = await this.col().doc(startAfterId).get();
            if(startDoc.exists) query = query.startAfter(startDoc);
        }
        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ ...(doc.data() as T), id: doc.id }));
    }
}