import { initializeApp } from "firebase-admin";
import { applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreRepository } from "./src/index.js";
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
async function main() {
    console.log('RUNNING MAIN SCRIPT...');
    const userRepo = new FirestoreRepository(db, 'users');
    // create a new user
    const newUser = await userRepo.create({ name: 'Happy', email: 'hbfl3x@gmail.com' });
    console.log(`New user created: ${newUser.name}`);
    const fetched = await userRepo.getById(newUser.id);
    console.log('Fetched user:', fetched);
}
main().catch(error => console.error('ERROR', error));
//# sourceMappingURL=test.js.map