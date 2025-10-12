import { Firestore } from 'firebase-admin/firestore';
export type ID = string;
export declare class FirestoreRepository<T extends {
    id?: ID;
}> {
    private db;
    private collection;
    constructor(db: Firestore, collection: string);
    private col;
    create(data: T): Promise<T & {
        id: ID;
    }>;
    getById(id: ID): Promise<(T & {
        id: ID;
    }) | null>;
}
//# sourceMappingURL=FirestoreRepository.d.ts.map