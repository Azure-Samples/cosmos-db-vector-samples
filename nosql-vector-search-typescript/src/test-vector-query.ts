import { getClientsPasswordless, validateFieldName } from './utils.js';

const config = {
    dbName: "Hotels",
    containerName: "hotels_flat",
    embeddedField: process.env.EMBEDDED_FIELD!,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_MODEL!,
};

async function testVectorVsNonVectorQueries(container: any, embeddedField: string, queryVector: number[]) {
    console.log('\n=== Vector Query vs Non-Vector Query Comparison ===\n');
    
    try {
        console.log(`Test vector: ${queryVector.length} dimensions`);
        console.log(`First 3 values: [${queryVector.slice(0, 3).map(v => v.toFixed(4)).join(', ')}]`);
        console.log(`Vector magnitude: ${Math.sqrt(queryVector.reduce((sum, v) => sum + v * v, 0)).toFixed(4)}\n`);

        // Query 1: Without vector distance (regular query - should return hotels alphabetically or by ID)
        console.log('1. Regular query (NO vector distance):');
        const regularQuery = `SELECT TOP 5 c.HotelName, c.id FROM c ORDER BY c.HotelName`;
        
        const regularResult = await container.items.query(regularQuery).fetchAll();
        console.log(`   Results:`);
        regularResult.resources.forEach((doc: any, idx: number) => {
            console.log(`   ${idx + 1}. ${doc.HotelName}`);
        });

        // Query 2: With vector distance (should return hotels by similarity)
        console.log(`\n2. Vector distance query (WITH vector distance on "${embeddedField}"):"`);
        const vectorQuery = `
            SELECT TOP 5 
                c.HotelName, 
                c.id,
                VectorDistance(c.${embeddedField}, @queryVector) AS distance
            FROM c 
            WHERE IS_DEFINED(c.${embeddedField})
            ORDER BY VectorDistance(c.${embeddedField}, @queryVector)
        `;
        
        const vectorResult = await container.items
            .query({
                query: vectorQuery,
                parameters: [{ name: '@queryVector', value: queryVector }]
            })
            .fetchAll();

        console.log(`   Results:`);
        vectorResult.resources.forEach((doc: any, idx: number) => {
            console.log(`   ${idx + 1}. ${doc.HotelName} - distance: ${doc.distance.toFixed(6)}`);
        });

        // Analysis
        console.log('\n=== Analysis ===');
        
        const regularNames = regularResult.resources.map((d: any) => d.HotelName);
        const vectorNames = vectorResult.resources.map((d: any) => d.HotelName);
        
        const isSame = JSON.stringify(regularNames) === JSON.stringify(vectorNames);
        
        if (isSame) {
            console.log('❌ PROBLEM: Results are IDENTICAL!');
            console.log('   The vector distance is being IGNORED.');
            console.log('   Possible causes:');
            console.log(`   - Field "${embeddedField}" doesn't exist or is null/empty`);
            console.log('   - Vector index is not configured');
            console.log('   - Documents have null vectors\n');
        } else {
            console.log('✓ GOOD: Results are DIFFERENT!');
            console.log('   Vector distance IS being used in the query.');
            
            // Check if distances are all zero
            const allZero = vectorResult.resources.every((d: any) => d.distance === 0);
            if (allZero) {
                console.log('\n⚠️  WARNING: All distances are 0.000!');
                console.log('   This usually means:');
                console.log('   1. The query vector is all zeros (check vector generation)');
                console.log('   2. Vector dimensions don\'t match between query and stored vectors');
                console.log('   3. Vectors are not properly indexed\n');
            } else {
                console.log('\n✓ Distances vary - vectors are working correctly!\n');
            }
        }

        // Query 3: Check actual vector structure
        console.log('3. Inspecting actual vector structure:');
        const inspectQuery = `
            SELECT TOP 3 
                c.HotelName, 
                c.id,
                c.${embeddedField} as full_vector
            FROM c 
            WHERE IS_DEFINED(c.${embeddedField})
        `;
        
        const inspectResult = await container.items.query(inspectQuery).fetchAll();
        
        if (inspectResult.resources.length === 0) {
            console.log(`   ❌ No documents with "${embeddedField}" field found!`);
        } else {
            inspectResult.resources.forEach((doc: any, idx: number) => {
                const vector = (doc as any).full_vector;
                console.log(`\n   ${idx + 1}. ${doc.HotelName}`);
                console.log(`      Type: ${Array.isArray(vector) ? 'Array' : typeof vector}`);
                
                if (Array.isArray(vector)) {
                    console.log(`      Length: ${vector.length}`);
                    console.log(`      First 3 values: [${vector.slice(0, 3).map((v: number) => v.toFixed(4)).join(', ')}]`);
                    console.log(`      Magnitude: ${Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0)).toFixed(4)}`);
                } else if (vector && typeof vector === 'object') {
                    console.log(`      ⚠️  It's an object, not an array!`);
                    console.log(`      Keys: ${Object.keys(vector).slice(0, 5).join(', ')}`);
                } else {
                    console.log(`      Value: ${vector}`);
                }
            });
        }

        console.log('\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.log('\nDebugging info:');
        console.log(`  Field to query: "${embeddedField}"`);
        console.log(`  Error details:`, (error as any).message);
    }
}

async function main() {
    const { dbClient, aiClient } = getClientsPasswordless();

    try {
        if (!dbClient) {
            throw new Error('Database client is not configured. Please check your environment variables.');
        }

        if (!aiClient) {
            throw new Error('AI client is not configured. Please check your environment variables.');
        }

        const database = dbClient.database(config.dbName);
        console.log(`Connected to database: ${config.dbName}`);

        const container = database.container(config.containerName);
        console.log(`Connected to container: ${config.containerName}`);

        // Verify container exists
        await container.read();

        // Validate the embedded field name
        const safeEmbeddedField = validateFieldName(config.embeddedField);
        console.log(`Embedded field to test: "${safeEmbeddedField}"`);
        console.log(`Deployment: "${config.deployment}"\n`);

        // Generate a real query embedding
        console.log('Generating query vector using Azure OpenAI...');
        const embeddingResponse = await aiClient.embeddings.create({
            model: config.deployment,
            input: ["quintessential lodging near running trails"]
        });

        const queryVector = embeddingResponse.data[0].embedding as number[];
        console.log(`Generated vector with ${queryVector.length} dimensions\n`);

        // Run the comparison test with real vector
        await testVectorVsNonVectorQueries(container, safeEmbeddedField, queryVector);

    } catch (error) {
        if ((error as any).code === 404) {
            console.error(`❌ Container or database not found. Ensure database '${config.dbName}' and container '${config.containerName}' exist.`);
        } else {
            console.error('❌ Test failed:', error);
        }
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exitCode = 1;
});
