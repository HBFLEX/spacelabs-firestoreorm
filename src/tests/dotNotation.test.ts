import { FirestoreRepository } from '../core/FirestoreRepository.js';
import { Firestore } from 'firebase-admin/firestore';
import { initializeApp } from "firebase-admin/app";
import { cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from "fs";
import { join } from "node:path";

const serviceAccount = JSON.parse(
    readFileSync(join(__dirname, '../firebase-service-account.json'), 'utf8')
);

const app = initializeApp({
    credential: cert(serviceAccount)
});

describe('Dot Notation Integration Tests', () => {
    let db: Firestore;
    let userRepo: FirestoreRepository<User>;
    const testUserIds: string[] = [];

    interface User {
        id?: string;
        name: string;
        email?: string;
        address?: {
            street?: string;
            city?: string;
            zipCode?: string;
            country?: string;
        };
        profile?: {
            bio?: string;
            verified?: boolean;
            settings?: {
                theme?: string;
                notifications?: boolean;
            };
        };
    }

    beforeAll(() => {
        db = getFirestore(app);
        userRepo = new FirestoreRepository<User>(db, 'test_users_dotnotation');
    });

    afterEach(async () => {
        // Cleanup test documents after each test
        if (testUserIds.length > 0) {
            await userRepo.bulkDelete(testUserIds);
            testUserIds.length = 0;
        }
    });

    afterAll(async () => {
        const allTestUsers = await userRepo.query().get();
        if (allTestUsers.length > 0) {
            await userRepo.bulkDelete(allTestUsers.map(u => u.id));
        }
    });

    const trackUser = (userId: string) => {
        testUserIds.push(userId);
        return userId;
    };

    describe('update() with dot notation', () => {
        it('should update nested fields using dot notation', async () => {
            const user = await userRepo.create({
                name: 'John Doe',
                address: {
                    street: '123 Main St',
                    city: 'San Francisco',
                    zipCode: '94102',
                    country: 'USA'
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'address.city': 'Los Angeles',
                'address.zipCode': '90001'
            } as any);

            expect(updated.address?.city).toBe('Los Angeles');
            expect(updated.address?.zipCode).toBe('90001');
            expect(updated.address?.street).toBe('123 Main St');
            expect(updated.address?.country).toBe('USA');
        });

        it('should update deeply nested fields', async () => {
            const user = await userRepo.create({
                name: 'Jane Doe',
                profile: {
                    bio: 'Developer',
                    verified: false,
                    settings: {
                        theme: 'light',
                        notifications: false
                    }
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'profile.settings.theme': 'dark',
                'profile.verified': true
            } as any);

            expect(updated.profile?.settings?.theme).toBe('dark');
            expect(updated.profile?.verified).toBe(true);
            expect(updated.profile?.settings?.notifications).toBe(false);
            expect(updated.profile?.bio).toBe('Developer');
        });

        it('should handle mixed regular and dot notation updates', async () => {
            const user = await userRepo.create({
                name: 'Alice',
                email: 'alice@example.com',
                address: {
                    city: 'Boston'
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                name: 'Alice Smith',
                'address.city': 'New York'
            } as any);

            expect(updated.name).toBe('Alice Smith');
            expect(updated.address?.city).toBe('New York');
        });

        it('should create nested structure if it does not exist', async () => {
            const user = await userRepo.create({
                name: 'Bob'
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'address.city': 'Seattle',
                'address.zipCode': '98101'
            } as any);

            expect(updated.address?.city).toBe('Seattle');
            expect(updated.address?.zipCode).toBe('98101');
        });

        it('should throw error for invalid dot notation paths', async () => {
            const user = await userRepo.create({
                name: 'Charlie'
            });
            trackUser(user.id);

            await expect(
                userRepo.update(user.id, {
                    'address..city': 'Invalid'
                } as any)
            ).rejects.toThrow('Parts cannot be empty');

            await expect(
                userRepo.update(user.id, {
                    '.address': 'Invalid'
                } as any)
            ).rejects.toThrow('cannot start or end with a dot');

            await expect(
                userRepo.update(user.id, {
                    'address.': 'Invalid'
                } as any)
            ).rejects.toThrow('cannot start or end with a dot');
        });

        it('should handle empty string path validation', async () => {
            const user = await userRepo.create({
                name: 'Dave'
            });
            trackUser(user.id);

            await expect(
                userRepo.update(user.id, {
                    '': 'Invalid'
                } as any)
            ).rejects.toThrow(); // Firestore throws its own error for empty strings
        });
    });

    describe('bulkUpdate() with dot notation', () => {
        it('should bulk update with dot notation', async () => {
            const user1 = await userRepo.create({
                name: 'User 1',
                profile: { verified: false }
            });
            trackUser(user1.id);

            const user2 = await userRepo.create({
                name: 'User 2',
                profile: { verified: false }
            });
            trackUser(user2.id);

            await userRepo.bulkUpdate([
                { id: user1.id, data: { 'profile.verified': true } as any },
                { id: user2.id, data: { 'profile.verified': true } as any }
            ]);

            const updated1 = await userRepo.getById(user1.id);
            const updated2 = await userRepo.getById(user2.id);

            expect(updated1?.profile?.verified).toBe(true);
            expect(updated2?.profile?.verified).toBe(true);
        }, 15000);

        it('should handle mixed updates in bulk operation', async () => {
            const user1 = await userRepo.create({
                name: 'User 1',
                address: { city: 'Boston' }
            });
            trackUser(user1.id);

            const user2 = await userRepo.create({
                name: 'User 2',
                email: 'user2@example.com'
            });
            trackUser(user2.id);

            await userRepo.bulkUpdate([
                { id: user1.id, data: { 'address.city': 'NYC' } as any },
                { id: user2.id, data: { name: 'User Two' } }
            ]);

            const updated1 = await userRepo.getById(user1.id);
            const updated2 = await userRepo.getById(user2.id);

            expect(updated1?.address?.city).toBe('NYC');
            expect(updated2?.name).toBe('User Two');
        }, 15000);

        it('should validate all paths before bulk update', async () => {
            const user1 = await userRepo.create({
                name: 'User 1'
            });
            trackUser(user1.id);

            const user2 = await userRepo.create({
                name: 'User 2'
            });
            trackUser(user2.id);

            await expect(
                userRepo.bulkUpdate([
                    { id: user1.id, data: { 'address.city': 'NYC' } as any },
                    { id: user2.id, data: { 'address..city': 'Invalid' } as any }
                ])
            ).rejects.toThrow('Parts cannot be empty');
        });
    });

    describe('query().update() with dot notation', () => {
        it('should update all matching documents with dot notation', async () => {
            const user1 = await userRepo.create({
                name: 'Admin 1',
                profile: { verified: false }
            });
            trackUser(user1.id);

            const user2 = await userRepo.create({
                name: 'Admin 2',
                profile: { verified: false }
            });
            trackUser(user2.id);

            const count = await userRepo.query()
                .where('name', 'in', ['Admin 1', 'Admin 2'])
                .update({ 'profile.verified': true } as any);

            expect(count).toBe(2);

            const users = await userRepo.query()
                .where('name', 'in', ['Admin 1', 'Admin 2'])
                .get();

            users.forEach(user => {
                expect(user.profile?.verified).toBe(true);
            });
        });

        it('should handle complex nested updates via query', async () => {
            const user = await userRepo.create({
                name: 'User 1',
                profile: {
                    settings: {
                        theme: 'light',
                        notifications: false
                    }
                }
            });
            trackUser(user.id);

            await userRepo.query()
                .where('name', '==', 'User 1')
                .update({
                    'profile.settings.theme': 'dark',
                    'profile.settings.notifications': true
                } as any);

            const updatedUser = await userRepo.query()
                .where('name', '==', 'User 1')
                .getOne();

            expect(updatedUser?.profile?.settings?.theme).toBe('dark');
            expect(updatedUser?.profile?.settings?.notifications).toBe(true);
        });

        it('should return 0 when no documents match', async () => {
            const count = await userRepo.query()
                .where('name', '==', 'NonExistent')
                .update({ 'profile.verified': true } as any);

            expect(count).toBe(0);
        });
    });

    describe('updateInTransaction() with dot notation', () => {
        it('should update with dot notation in transaction', async () => {
            const user = await userRepo.create({
                name: 'Transaction User',
                address: { city: 'Portland' }
            });
            trackUser(user.id);

            await userRepo.runInTransaction(async (tx, repo) => {
                const existing = await repo.getForUpdate(tx, user.id);
                expect(existing).toBeTruthy();

                await repo.updateInTransaction(tx, user.id, {
                    'address.city': 'Seattle',
                    'address.zipCode': '98101'
                } as any, existing!);
            });

            const updated = await userRepo.getById(user.id);
            expect(updated?.address?.city).toBe('Seattle');
            expect(updated?.address?.zipCode).toBe('98101');
        });

        it('should handle complex transaction updates', async () => {
            const user1 = await userRepo.create({
                name: 'User A',
                profile: { verified: false }
            });
            trackUser(user1.id);

            const user2 = await userRepo.create({
                name: 'User B',
                profile: { verified: false }
            });
            trackUser(user2.id);

            await userRepo.runInTransaction(async (tx, repo) => {
                const existing1 = await repo.getForUpdate(tx, user1.id);
                const existing2 = await repo.getForUpdate(tx, user2.id);

                expect(existing1).toBeTruthy();
                expect(existing2).toBeTruthy();

                await repo.updateInTransaction(tx, user1.id, {
                    'profile.verified': true
                } as any, existing1!);

                await repo.updateInTransaction(tx, user2.id, {
                    'profile.verified': true
                } as any, existing2!);
            });

            const updated1 = await userRepo.getById(user1.id);
            const updated2 = await userRepo.getById(user2.id);

            expect(updated1?.profile?.verified).toBe(true);
            expect(updated2?.profile?.verified).toBe(true);
        }, 10000);

        it('should rollback on error', async () => {
            const user = await userRepo.create({
                name: 'Rollback Test',
                profile: { verified: false }
            });
            trackUser(user.id);

            await expect(
                userRepo.runInTransaction(async (tx, repo) => {
                    const existing = await repo.getForUpdate(tx, user.id);

                    await repo.updateInTransaction(tx, user.id, {
                        'profile.verified': true
                    } as any, existing!);

                    // Simulate error
                    throw new Error('Transaction failed');
                })
            ).rejects.toThrow('Transaction failed');

            const unchanged = await userRepo.getById(user.id);
            expect(unchanged?.profile?.verified).toBe(false);
        });
    });

    describe('Backward compatibility', () => {
        it('should work with regular updates (no dot notation)', async () => {
            const user = await userRepo.create({
                name: 'Regular User',
                email: 'regular@example.com'
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                name: 'Updated User',
                email: 'updated@example.com'
            });

            expect(updated.name).toBe('Updated User');
            expect(updated.email).toBe('updated@example.com');
        });

        it('should handle nested object updates without dot notation', async () => {
            const user = await userRepo.create({
                name: 'Nested User',
                address: {
                    city: 'Denver',
                    zipCode: '80201'
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                address: {
                    city: 'Boulder',
                    zipCode: '80301',
                    country: 'USA'
                }
            });

            expect(updated.address?.city).toBe('Boulder');
            expect(updated.address?.zipCode).toBe('80301');
            expect(updated.address?.country).toBe('USA');
        });

        it('should replace nested object when using regular syntax', async () => {
            const user = await userRepo.create({
                name: 'Replace Test',
                address: {
                    street: '123 Main St',
                    city: 'Denver',
                    zipCode: '80201'
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                address: {
                    city: 'Boulder'
                }
            });

            expect(updated.address?.city).toBe('Boulder');
            expect(updated.address?.street).toBeUndefined(); // Lost
            expect(updated.address?.zipCode).toBeUndefined(); // Lost
        });

        it('should preserve fields with dot notation', async () => {
            const user = await userRepo.create({
                name: 'Preserve Test',
                address: {
                    street: '123 Main St',
                    city: 'Denver',
                    zipCode: '80201'
                }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'address.city': 'Boulder'
            } as any);

            expect(updated.address?.city).toBe('Boulder');
            expect(updated.address?.street).toBe('123 Main St'); // Preserved
            expect(updated.address?.zipCode).toBe('80201'); // Preserved
        }, 10000);
    });

    describe('Edge cases', () => {
        it('should handle null values with dot notation', async () => {
            const user = await userRepo.create({
                name: 'Null Test',
                address: { city: 'Portland' }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'address.city': null
            } as any);

            expect(updated.address?.city).toBeNull();
        }, 10000);

        it('should handle undefined values with dot notation', async () => {
            const user = await userRepo.create({
                name: 'Undefined Test',
                address: { city: 'Portland', zipCode: '97201' }
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'address.city': undefined
            } as any);

            expect(updated.address?.city).toBe('Portland');
            expect(updated.address?.zipCode).toBe('97201');
        }, 10000);

        it('should handle multiple levels of new nesting', async () => {
            const user = await userRepo.create({
                name: 'Deep Nesting'
            });
            trackUser(user.id);

            const updated = await userRepo.update(user.id, {
                'profile.settings.advanced.debugMode': true
            } as any);

            expect((updated as any).profile?.settings?.advanced?.debugMode).toBe(true);
        }, 10000);
    });
});