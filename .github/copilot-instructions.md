# GitHub Copilot Instructions for Azure Cosmos DB Vector Samples

## Authentication and Authorization

This repository uses **Microsoft Entra ID (formerly Azure AD)** authentication with data plane RBAC only.

### Key Principles

1. **Infrastructure Setup**: The Azure Developer CLI (`azd`) creates the database and container resources using the local developer's identity during provisioning. Sample code should never create these resources.

2. **Data Plane Only**: The RBAC roles assigned in the infrastructure are configured for **data plane operations only** (reading and writing documents). Management plane operations (creating databases, containers, or checking if they exist) are NOT supported.

3. **No Resource Creation in Code**: Sample code must NOT:
   - Create databases or containers using `createIfNotExists`
   - Check if databases or containers exist
   - Attempt any management plane operations
   - Use management plane SDKs or APIs

4. **Assume Resources Exist**: All sample code should assume that:
   - The database already exists
   - The container already exists
   - The connection has been properly configured via environment variables
   - The user's identity has been granted appropriate data plane permissions

### Code Guidelines

#### ✅ DO:
- Use data plane SDKs for document operations (CRUD)
- Access existing databases and containers directly
- Use `database.container(containerName)` to get a container reference
- Implement proper error handling for permission issues
- Guide users to create resources manually if they don't exist

#### ❌ DON'T:
- Use `createIfNotExists()` for databases or containers
- Call management plane APIs
- Attempt to validate resource existence
- Create, delete, or modify container/database definitions
- Use management plane SDKs

### Example Pattern

```typescript
// ❌ WRONG - Don't create or check existence
const { database } = await client.databases.createIfNotExists({ id: dbName });
const { container } = await database.containers.createIfNotExists({ id: containerName });

// ✅ CORRECT - Assume resources exist
const database = client.database(dbName);
const container = database.container(containerName);

// Proceed with data plane operations
const result = await container.items.create(document);
```

### Error Handling

When a resource doesn't exist, provide clear error messages directing users to:
1. Verify the database and container names in their environment configuration
2. Ensure resources were created via Azure Developer CLI or Azure Portal
3. Check their Entra ID identity has proper data plane RBAC roles assigned

### Reference Documentation

For more information on management plane vs. data plane access in Azure Cosmos DB:
- [Azure Cosmos DB security overview](https://learn.microsoft.com/azure/cosmos-db/security)
- [Azure Cosmos DB role-based access control](https://learn.microsoft.com/azure/cosmos-db/role-based-access-control)
- [Configure role-based access control with Microsoft Entra ID for your Azure Cosmos DB account](https://learn.microsoft.com/azure/cosmos-db/how-to-setup-rbac)
