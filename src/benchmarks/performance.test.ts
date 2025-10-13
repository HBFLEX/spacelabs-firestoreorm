import { FirestoreRepository, ID } from '../core/FirestoreRepository';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { string, z } from 'zod';

// add your service account path here
// NOTE: it will delete the benchmark collection in db after test completion
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
    console.log('Bulk Create Tests:');
    const data10 = Array.from({ length: 10 }, (_, i) => ({
        name: `test-${i}`,
        value: i,
        createdAt: new Date().toISOString()
    }));
    
    const data1000 = Array.from({ length: 1000 }, (_, i) => ({
        name: `test-${i}`,
        value: i,
        createdAt: new Date().toISOString()
    }));

    await benchmark('  10 documents', () => repo.bulkCreate(data10));
    await benchmark(' 1000 documents', () => repo.bulkCreate(data1000));
    
    // Test 2: Bulk Read Performance
    console.log('\nBulk Read Tests:');
    const allDocs = await repo.query().get();
    const ids10 = allDocs.slice(0, 10).map(d => d.id);
    const ids1000 = allDocs.slice(0, 1000).map(d => d.id);

    await benchmark('  10 documents (getById)', async () => {
        await Promise.all(ids10.map(id => repo.getById(id)));
    });
    
    await benchmark(' 1000 documents (getById)', async () => {
        await Promise.all(ids1000.map(id => repo.getById(id)));
    });

    // Test 3: Bulk Update Performance
    console.log('\nBulk Update Tests:');
    const updates10 = ids10.map(id => ({ id, data: { value: 999 } }));
    const updates1000 = ids1000.map(id => ({ id, data: { value: 999 } }));

    await benchmark('  10 documents', () => repo.bulkUpdate(updates10));
    await benchmark(' 1000 documents', () => repo.bulkUpdate(updates1000));

    // Test 4: Bulk Soft Delete Performance
    console.log('\nBulk Soft Delete Tests:');
    await benchmark('  10 documents', () => repo.bulkSoftDelete(ids10));
    await benchmark(' 1000 documents', () => repo.bulkSoftDelete(ids1000));

    // Test 5: Query Performance
    console.log('\nQuery Tests:');
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
    console.log('\nCount Tests:');
    await benchmark(' Count all documents', () => repo.query().count());
    await benchmark(' Total count', () => repo.query().totalCount());

    // Cleanup
    console.log('\nCleaning up...');
    await repo.query().includeDeleted().delete();
    
    console.log('\nBenchmarks Complete!');
    process.exit(0);
}

runBenchmarks().catch(console.error);
