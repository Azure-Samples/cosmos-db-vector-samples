# SDK Migration Status: Control-Plane Implementations

**Date:** 2026-06-18  
**Goal:** Switch all create-index samples from REST API to official Azure SDKs for Phase 4b (container deletion)

---

## Architecture Decision

✅ **APPROVED:** Only use official Azure SDKs for control-plane and data-plane operations. Never use REST API directly.

---

## Status by Language

### ✅ TypeScript
- **Control-Plane SDK:** `@azure/arm-cosmosdb`
- **Data-Plane SDK:** `@azure/cosmos`
- **Status:** ✅ Already implemented (Phase 4b complete)
- **Next:** Ready for testing

### ✅ Python
- **Control-Plane SDK:** `azure-mgmt-cosmosdb` (in requirements.txt, v4.0.0+)
- **Data-Plane SDK:** `azure-cosmos`
- **Status:** ✅ Code implemented, dependencies resolved
- **Configuration:** 
  - Added `SubscriptionID`, `ResourceGroup`, `AccountName` to `SampleConfig` dataclass
  - Environment variables: `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_COSMOSDB_ACCOUNT_NAME`
- **Next:** Run `pip install -r requirements.txt`, then test

### ⚠️ Java
- **Control-Plane SDK:** `com.azure.resourcemanager:azure-resourcemanager-cosmos` (version 2.54.3)
- **Data-Plane SDK:** `com.azure:azure-cosmos`
- **Status:** ⚠️ Code implemented, dependencies resolved, API method signature issue
- **Current Issue:** 
  - Dependencies now resolve correctly (groupId is `com.azure.resourcemanager`, not `com.azure`)
  - `CosmosManager.authenticate()` API signature needs verification — examples show different parameter combinations
  - `sqlResources().deleteSqlContainer()` method exists but parameter signatures vary by SDK version
- **Next Steps:**
  - Test with actual CosmosManager API from resolved 2.54.3 dependency
  - Verify correct authenticate() signature and parameter order
  - Ensure Context.NONE or equivalent is passed correctly
  - Once API is correct, compilation should succeed

### ⚠️ Go
- **Control-Plane SDK:** `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos` (v1.4.2)
- **Data-Plane SDK:** `github.com/Azure/azure-sdk-for-go/sdk/data/azcosmos`
- **Status:** ⚠️ Code implemented, but monorepo dependency resolution issue
- **Current Issue:**
  - Azure SDK for Go is structured as a **monorepo** with submodules
  - Go modules system cannot resolve `armcosmos` as a separate module with versioned tags
  - Error: `unknown revision sdk/resourcemanager/cosmos/armcosmos/v1.4.2`
  - The revision tags don't exist in the exact format Go is expecting
- **Workaround Investigation Needed:**
  - Use `replace` directive in `go.mod` to point to correct commit hash
  - OR use main repository tags (e.g., `github.com/Azure/azure-sdk-for-go@v68.0.0`) and import submodules from there
  - OR use development `go get github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos@main` (if working with development branch)
- **Code Ready:** `dataplane.go` updated with SDK imports (removed REST API code), `go.mod` updated with dependency
- **Next:**
  - Try `go mod get` with explicit commit SHA or main branch
  - Consult with Go team on preferred monorepo resolution strategy
  - Possible fix: Use `replace` directive pointing to azure-sdk-for-go at a known good tag

### .NET
- **Control-Plane SDK:** `Azure.ResourceManager` + `Azure.ResourceManager.CosmosDB` packages
- **Data-Plane SDK:** `Azure.Cosmos`
- **Status:** 🔄 Ready to implement
- **Configuration Requirements:**
  - Add `SubscriptionId`, `ResourceGroup`, `AccountName` to `SampleConfig` record
  - Environment variables: `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_COSMOSDB_ACCOUNT_NAME`
  - Implement `ControlPlane.cs` with `DeleteContainersAsync()` using `CosmosDBManagementClient` or `ResourceManager`
- **Code Pattern:** 
  ```csharp
  var credential = new DefaultAzureCredential();
  var subscriptionId = config.SubscriptionId;
  var armClient = new ArmClient(credential, subscriptionId);
  var cosmosDbAccountResourceId = /* build resource ID */;
  var cosmosDbAccount = armClient.GetCosmosDBAccountResource(cosmosDbAccountResourceId);
  var database = await cosmosDbAccount.GetCosmosDBSqlDatabase(config.DatabaseName).GetAsync();
  var containers = database.GetCosmosDBSqlContainers();
  await containers.Get(containerName).GetAsync().DeleteAsync(WaitUntil.Completed);
  ```
- **Next:** Implement similar to Python/Java pattern, test with environment variables

---

## Required Environment Variables (All Languages)

Each sample needs these variables populated before running:

```bash
# Control-plane (ARM/management plane)
AZURE_SUBSCRIPTION_ID=<subscription-id>
AZURE_RESOURCE_GROUP=<resource-group-name>
AZURE_COSMOSDB_ACCOUNT_NAME=<cosmos-account-name>

# Data-plane (Cosmos DB)
AZURE_COSMOSDB_ENDPOINT=<cosmos-endpoint-url>

# OpenAI (for embeddings)
AZURE_OPENAI_EMBEDDING_ENDPOINT=<openai-endpoint>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<embedding-model-deployment>

# Optional data plane
AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME=Hotels
VECTOR_ALGORITHM=diskann  # or quantizedflat
```

---

## Dependency Resolution Issues & Solutions

### Java: Maven Artifact Not Found

**Problem:** `azure-resourcemanager-cosmos` not in Maven Central

**Solutions to try:**
1. Check exact package name and version in Maven Central (https://mvnrepository.com/)
2. Add explicit Azure Maven repository to `pom.xml`:
   ```xml
   <repositories>
     <repository>
       <id>azure-sdk</id>
       <url>https://raw.githubusercontent.com/Azure/azure-sdk-for-java/main</url>
     </repository>
   </repositories>
   ```
3. Use parent `azure-sdk-bom` to manage transitive versions
4. Consult Microsoft docs on correct groupId/artifactId for Java Cosmos resource manager

### Go: Monorepo Module Resolution

**Problem:** Go modules can't resolve `armcosmos` submodule version tags

**Solutions to try:**
1. Use `go.mod` `replace` directive with explicit commit:
   ```go
   replace github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos => github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2
   ```
2. Use `@main` branch reference if bleeding-edge is acceptable:
   ```
   go get github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos@main
   go mod tidy
   ```
3. Use main repository tag instead of submodule-specific tags
4. Check Azure SDK for Go releases page for correct import paths and versions

---

## Testing Checklist (For Each Language)

After resolving dependency issues:

- [ ] Sample compiles/type-checks successfully
- [ ] Environment variables set correctly
- [ ] Run Phase 1 (create containers) — verify in Azure Portal
- [ ] Run Phase 2 (ingest data) — verify documents exist
- [ ] Run Phase 3 (query) — verify results match expected
- [ ] Run Phase 4a (clear data) — verify documents deleted, containers remain
- [ ] Run Phase 4b (delete containers) — verify containers deleted from Azure Portal
- [ ] Output matches expected format (consistent with TypeScript)
- [ ] Error handling: 404 on already-deleted container is graceful
- [ ] Cleanup guarantee: Phase 4 runs even if earlier phase fails

---

## Implementation Roadmap

1. **TypeScript**: Already done ✅
2. **Python**: Resolve dependencies → test
3. **Java**: Resolve Maven artifact → implement → test
4. **Go**: Resolve monorepo module path → test
5. **.NET**: Implement Phase 4b → test

---

## References

- [Azure SDK for Java - Cosmos Resource Manager](https://github.com/Azure/azure-sdk-for-java/tree/main/sdk/resourcemanager/azure-resourcemanager-cosmos)
- [Azure SDK for Go - Package Index](https://learn.microsoft.com/en-us/azure/developer/go/azure-sdk-library-package-index)
- [Azure SDK for Go - Cosmos RM](https://github.com/Azure/azure-sdk-for-go/tree/main/sdk/resourcemanager/cosmos)
- [Azure SDK for .NET - CosmosDB RM](https://github.com/Azure/azure-sdk-for-net/tree/main/sdk/cosmosdb/Azure.ResourceManager.CosmosDB)
- [Azure Cosmos DB Control-Plane API Docs](https://learn.microsoft.com/en-us/azure/cosmos-db/control-plane)
