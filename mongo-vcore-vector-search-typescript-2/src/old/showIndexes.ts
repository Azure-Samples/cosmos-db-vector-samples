import { MongoClient } from 'mongodb';

const config = {
    connectionString: process.env.MONGO_CONNECTION_STRING!
};

async function getAllDatabases(client: MongoClient): Promise<string[]> {
    try {
        // Get all database names except admin/config/local
        const dbList = await client.db().admin().listDatabases({ nameOnly: true });
        return dbList.databases
            .map((db: any) => db.name)
            .filter((name: string) => !['admin', 'config', 'local'].includes(name));
    } catch (error) {
        console.error('Error listing databases:', error);
        return [];
    }
}
async function getAllCollections(db: any): Promise<string[]> {
    try {
        const collections = await db.listCollections().toArray();
        return collections.map((coll: any) => coll.name);
    } catch (error) {
        console.error(`Error listing collections for database ${db.databaseName}:`, error);
        return [];
    }
}

async function getAllIndexes(db: any, collectionName: string): Promise<void> {
    try {
        const collection = db.collection(collectionName);
        const indexes = await collection.indexes();
        console.log(`\n  🗃️ COLLECTION: ${collectionName} (${indexes.length} indexes)`);
        console.log(JSON.stringify(indexes, null, 2));
    } catch (error) {
        console.error(`Error listing indexes for collection ${collectionName}:`, error);
    }
}

async function main() {

    const client = new MongoClient(config.connectionString, {
        maxPoolSize: 5,
        minPoolSize: 1,
        maxIdleTimeMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 60000,
    });

    try {

        await client.connect();
        const dbNames = await getAllDatabases(client);

        if (dbNames.length === 0) {
            console.log('No databases found or access denied');
            return;
        }

        // Process each database
        for (const dbName of dbNames) {
            const db = client.db(dbName);

            // Get collections to process
            let collections = await getAllCollections(db);

            if (collections.length === 0) {
                console.log(`Database '${dbName}': No collections found`);
                continue;
            }

            console.log(`\n📂 DATABASE: ${dbName} (${collections.length} collections)`);

            // Process each collection
            for (const collName of collections) {
                await getAllIndexes(db, collName);
            }
        }
    } catch (error) {
        console.error('Index retrieval failed:', error);
        process.exitCode = 1;
    } finally {
        console.log('\nClosing database connection...');
        await client.close();
        console.log('Database connection closed');
    }
}
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});