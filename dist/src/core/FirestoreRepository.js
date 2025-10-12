import { Firestore } from 'firebase-admin/firestore';
export class FirestoreRepository {
    constructor(db, collection) {
        this.db = db;
        this.collection = collection;
    }
    col() {
        return this.db.collection(this.collection);
    }
    async create(data) {
        const docRef = await this.col().add(data);
        return { ...data, id: docRef.id };
    }
    async getById(id) {
        const snapshot = await this.col().doc(id).get();
        if (!snapshot)
            return null;
        return { ...snapshot.data(), id };
    }
}
//# sourceMappingURL=FirestoreRepository.js.map