const { MongoClient } = require('mongodb');
require('dotenv').config();

async function checkIndexes() {
  const client = new MongoClient(process.env.MONGO_CONNECTION_STRING);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('Hotels4');
    const collection = db.collection('hotels_ivf');
    
    // Check indexes
    const indexes = await collection.listIndexes().toArray();
    console.log('Indexes in hotels_ivf:');
    indexes.forEach(index => {
      console.log('  -', index.name + ':', JSON.stringify(index.key, null, 2));
      if (index.cosmosSearchOptions) {
        console.log('    Vector index details:', index.cosmosSearchOptions);
      }
    });
    
    // Try a simple find to see if we can access the data
    const sample = await collection.findOne();
    if (sample) {
      console.log('\nSample document found');
      console.log('Has embeddings:', !!(sample['text-embedding-ada-002']));
      if (sample['text-embedding-ada-002']) {
        console.log('Embedding vector length:', sample['text-embedding-ada-002'].length);
        console.log('First 3 embedding values:', sample['text-embedding-ada-002'].slice(0, 3));
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkIndexes();