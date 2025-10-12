import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore';

import { FirestoreRepository } from './src/index';
import { userSchema, userValidator } from './src/schemas/User';
import { email } from 'zod';
import { NotFoundError, ValidationError } from './src/core/Errors';

const serviceAccount = require('./firebase-service-account.json')

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = getFirestore();

type User = { id?: string, name: string, email: string }

async function main(){
    console.log('RUNNING MAIN SCRIPT...');

    const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

    const users = await userRepo.list(2);
    console.log('FIRST 2 USERS', users);

    if(users.length > 0){
        const lastUserId = users[users.length - 1].id;
        const last2Users = await userRepo.list(2, lastUserId);
        console.log('LAST 2 USERS', last2Users);
    }

    // const user = await userRepo.findByField('email', 'hbfl3x@gmail.com');
    // console.log('USER', user);

    // list users
    // const users = await userRepo.limit(5);
    // console.log('USERS', users);

    // create a new user
    // const newUser = await userRepo.create({ name: 'Happy', email: 'hbfl3x@gmail.com' });
    // console.log(`New user created: ${newUser.name}`);

    // // fetching user
    // const fetched = await userRepo.getById(newUser.id);
    // console.log('Fetched user:', fetched);

    // // updating user
    // const updatedUser = await userRepo.update(newUser.id, { email: 'happybanda@dyuni.ac.mw' });
    // console.log('Updated user', updatedUser);

    // // delete a user
    // await userRepo.delete('YgSPM5cwMy13Yt5MiS7h');
    // console.log('User deleted');
}

main().catch(error => console.error('ERROR', error));
