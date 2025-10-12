import * as admin from 'firebase-admin'
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { FirestoreRepository } from './src/index';
import { User, userSchema, } from './src/schemas/User';
import { NotFoundError, ValidationError, FirestoreIndexError } from './src/core/Errors';

const serviceAccount = require('./firebase-service-account.json')

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = getFirestore();


async function main(){
    console.log('RUNNING MAIN SCRIPT...');

    const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

    // const activeUsers = await userRepo
    //     .query()
    //     .where('email', '==', 'hbfl3x@gmail.com')
    //     .get();

    // // include deleted users
    // const allUsers = await userRepo.query(true).get();
    // const totalUsers = await userRepo.query().count();
    // const names = await userRepo.query(true).select('name').get();
    // console.log('names', names);

    // const onlyDeletedUser = await userRepo.query().onlyDeleted().get();
    // console.log('deleted users', onlyDeletedUser);

    // await userRepo.softDelete('tDOnOvTo4gJdrj6bHTaA');

    const purgedCount = await userRepo.purgeDelete();
    console.log(`Purged ${purgedCount} users`)

    // const recentUsers = await userRepo
    //     .query()
    //     .where('createdAt', '>', new Date('2025-01-1').toISOString())
    //     .orderBy('name', 'asc')
    //     .limit(10)
    //     .select('name')
    //     .get();
    // console.log('NEW users', recentUsers);

    // const restoredCount = await userRepo.restoreAll();
    // console.log(`Restored ${restoredCount} users`);

    // const users = await userRepo
    //     .query()
    //     .where('email', '==', 'hbfl3x@gmail.com')
    //     .orderBy('name', 'asc')
    //     .limit(10)
    //     .get();

    // console.log('LIST OF USERS', users);

    // const deletedUser = await userRepo.softDelete('U9HUO8hQJgTojoZnXXi1');
    // console.log('deleted user', deletedUser);

    // const user = await userRepo.getById('U9HUO8hQJgTojoZnXXi1', false);
    // console.log('USER', user);

    // await userRepo.restore('U9HUO8hQJgTojoZnXXi1');

    //  const user2 = await userRepo.getById('U9HUO8hQJgTojoZnXXi1', false);
    // console.log('USER', user2);

    // const users = await userRepo.list(2);
    // console.log('FIRST 2 USERS', users);

    // if(users.length > 0){
    //     const lastUserId = users[users.length - 1].id;
    //     const last2Users = await userRepo.list(2, lastUserId);
    //     console.log('LAST 2 USERS', last2Users);
    // }

    // const user = await userRepo.findByField('email', 'hbfl3x@gmail.com');
    // console.log('USER', user);

    // list users
    // const users = await userRepo.limit(5);
    // console.log('USERS', users);

    //create a new user
    // const newUser = await userRepo.create({ name: 'Happy', email: 'hbfl3x@gmail.com' });
    // console.log(`New user created: ${newUser.name}`);

    // const newUser2 = await userRepo.create({ name: 'jake', email: 'jake@gmail.com' });
    // console.log(`New user created: ${newUser2.name}`);

    // const newUser3 = await userRepo.create({ name: 'mira', email: 'mira@gmail.com' });
    // console.log(`New user created: ${newUser3.name}`);

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

main().catch(error => {
    if (error instanceof FirestoreIndexError) {
        console.error('\n' + error.toString() + '\n');
    } else if (error instanceof ValidationError) {
        console.error('\n❌ Validation Error:');
        error.issues.forEach(issue => {
            console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
        });
    } else if (error instanceof NotFoundError) {
        console.error('\n❌ Not Found:', error.message);
    } else {
        console.error('\n❌ Unexpected Error:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
    }
    process.exit(1);
});
