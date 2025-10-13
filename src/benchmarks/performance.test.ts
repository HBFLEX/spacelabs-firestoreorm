import { FirestoreRepository, ID } from '../core/FirestoreRepository';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { string, z } from 'zod';

// Initialize Firebase (use your credentials)
const serviceAccount = require('../../firebase-service-account.json');
const app = initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore(app);

const testDocSchema = z.object({
    name: z.string(),
    value: z.number(),
    createdAt: z.string()
});

type TestDoc = z.infer<typeof testDocSchema> & { id?: ID };

const repo = new FirestoreRepository<TestDoc>(db, 'benchmark_test');

async function benchmark(name: string, fn: () => Promise<any>) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    console.log(`${name}: ${(end - start).toFixed(2)}ms`);
}

async function runBenchmarks() {
    console.log('🚀 Starting Performance Benchmarks\n');

    // Cleanup
    await repo.query().delete();

    // Test 1: Bulk Create Performance
    console.log('📊 Bulk Create Tests:');
    const data10 = Array.from({ length: 10 }, (_, i) => ({
        name: `test-${i}`,
        value: i,
        createdAt: new Date().toISOString()
    }));
    
    const data100 = Array.from({ length: 100 }, (_, i) => ({
        name: `test-${i}`,
        value: i,
        createdAt: new Date().toISOString()
    }));

    await benchmark('  10 documents', () => repo.bulkCreate(data10));
    await benchmark(' 100 documents', () => repo.bulkCreate(data100));
    
    // Test 2: Bulk Read Performance
    console.log('\n📖 Bulk Read Tests:');
    const allDocs = await repo.query().get();
    const ids10 = allDocs.slice(0, 10).map(d => d.id);
    const ids100 = allDocs.slice(0, 100).map(d => d.id);

    await benchmark('  10 documents (getById)', async () => {
        await Promise.all(ids10.map(id => repo.getById(id)));
    });
    
    await benchmark(' 100 documents (getById)', async () => {
        await Promise.all(ids100.map(id => repo.getById(id)));
    });

    // Test 3: Bulk Update Performance
    console.log('\n✏️  Bulk Update Tests:');
    const updates10 = ids10.map(id => ({ id, data: { value: 999 } }));
    const updates100 = ids100.map(id => ({ id, data: { value: 999 } }));

    await benchmark('  10 documents', () => repo.bulkUpdate(updates10));
    await benchmark(' 100 documents', () => repo.bulkUpdate(updates100));

    // Test 4: Bulk Soft Delete Performance
    console.log('\n🗑️  Bulk Soft Delete Tests:');
    await benchmark('  10 documents', () => repo.bulkSoftDelete(ids10));
    await benchmark(' 100 documents', () => repo.bulkSoftDelete(ids100));

    // Test 5: Query Performance
    console.log('\n🔍 Query Tests:');
    await benchmark(' Simple where query', () => 
        repo.query().where('value', '==', 999).get()
    );
    
    await benchmark(' Complex query with orderBy + limit', () => 
        repo.query()
            .where('value', '>', 500)
            .orderBy('value', 'desc')
            .limit(20)
            .get()
    );

    await benchmark(' Paginated query', () => 
        repo.query().paginate(50)
    );

    // Test 6: Count Performance
    console.log('\n🔢 Count Tests:');
    await benchmark(' Count all documents', () => repo.query().count());
    await benchmark(' Total count', () => repo.query().totalCount());

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await repo.query().includeDeleted().delete();
    
    console.log('\n✅ Benchmarks Complete!');
    process.exit(0);
}

runBenchmarks().catch(console.error);