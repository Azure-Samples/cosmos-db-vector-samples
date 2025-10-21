import { MongoClient } from 'mongodb';

const connectionString = process.env.MONGO_CONNECTION_STRING || "";

async function testConnection() {
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
        
        // Check if Hotels database exists
        const hotelsDb = client.db('Hotels');
        const collections = await hotelsDb.listCollections().toArray();
        console.log('\nCollections in Hotels database:');
        
        for (const col of collections) {
            const collection = hotelsDb.collection(col.name);
            const count = await collection.countDocuments();
            console.log(`  - ${col.name}: ${count} documents`);
            
            // List indexes for this collection
            const indexes = await collection.listIndexes().toArray();
            console.log(`    Indexes:`);
            indexes.forEach(index => {
                console.log(`      - ${index.name}: ${JSON.stringify(index.key)}`);
                if (index.cosmosSearchOptions) {
                    console.log(`        Vector index: ${index.cosmosSearchOptions.kind} (dimensions: ${index.cosmosSearchOptions.dimensions})`);
                }
            });
            console.log(''); // Empty line for readability
        }
        
    } catch (error) {
        console.error('✗ Connection failed:', error.message);
    } finally {
        await client.close();
        console.log('\nConnection closed.');
    }
}

testConnection();
