import { deleteCosmosMongoDatabase } from './utils/mongo.js';

// Run the cleanup
deleteCosmosMongoDatabase().catch((error) => {
  console.error('Failed to delete database:', error);
  process.exit(1);
});
