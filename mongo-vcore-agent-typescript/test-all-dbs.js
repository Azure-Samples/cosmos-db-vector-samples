import { MongoClient } from 'mongodb';

const connectionString = process.env.MONGO_CONNECTION_STRING || "";

async function testAllDatabases() {
    const client = new MongoClient(connectionString);
    
    try {
        console.log('Connecting to MongoDB...');
        await client.connect();
        console.log('✓ Connected successfully!');
        
        // List databases
        const adminDb = client.db().admin();
        const dbs = await adminDb.listDatabases();
        console.log('\nAvailable databases:');
        dbs.databases.forEach(db => console.log(`  - ${db.name}`));
        
        // Check each database that might have hotel data
        const databasesToCheck = ['Hotels', 'Hotels2', 'Hotels4'];
        
        for (const dbName of databasesToCheck) {
            console.log(`\n${'='.repeat(50)}`);
            console.log(`Checking database: ${dbName}`);
            console.log(`${'='.repeat(50)}`);
            
            const db = client.db(dbName);
            
            try {
                const collections = await db.listCollections().toArray();
                
                if (collections.length === 0) {
                    console.log(`No collections found in ${dbName}`);
                    continue;
                }
                
                for (const col of collections) {
                    const collection = db.collection(col.name);
                    const count = await collection.countDocuments();
                    console.log(`\nCollection: ${col.name} (${count} documents)`);
                    
                    // List indexes for this collection
                    const indexes = await collection.listIndexes().toArray();
                    console.log(`Indexes:`);
                    indexes.forEach(index => {
                        console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
                        if (index.cosmosSearchOptions) {
                            console.log(`    Vector index: ${index.cosmosSearchOptions.kind} (dimensions: ${index.cosmosSearchOptions.dimensions})`);
                        }
                    });
                    
                    // Check for vector field
                    if (count > 0) {
                        const sample = await collection.findOne();
                        if (sample && sample['text-embedding-ada-002']) {
                            console.log(`  ✓ Has vector embeddings (${sample['text-embedding-ada-002'].length} dimensions)`);
                        } else {
                            console.log(`  ✗ No vector embeddings found`);
                        }
                    }
                }
            } catch (error) {
                console.log(`Error accessing ${dbName}: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('✗ Connection failed:', error.message);
    } finally {
        await client.close();
        console.log('\n\nConnection closed.');
    }
}

testAllDatabases();