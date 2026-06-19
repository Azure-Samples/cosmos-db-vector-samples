# Phase 4b Implementation Plan: Container Deletion

**Date:** 2026-06-18  
**Status:** Implementation Guide  
**Target:** All 5 create-index samples (Go, Python, Java, .NET, TypeScript)

This plan documents the Phase 4b (container deletion / control-plane cleanup) implementation pattern, established by the TypeScript reference implementation, and outlines what each language must do to conform to the architecture plan.

---

## Context

Per `.github/plans/create-index-architecture.md`:

**Phase 4: Cleanup — Clear Data + Delete Containers (Data-Plane + Control-Plane)**
- **Phase 4a** (Data-plane): Delete all sample documents using Cosmos Client SDK ✅ COMPLETE (all 5 languages)
- **Phase 4b** (Control-plane): Delete both containers and their vector index definitions using ARM SDK ❌ TODO (Go, Python, Java, .NET)

**Key Architectural Principle:**
- Data cleanup (4a) is a data-plane responsibility — uses Cosmos Client SDK
- Container deletion (4b) is a control-plane responsibility — uses ARM SDK
- Full deletion ensures no leftover infrastructure costs and samples are self-contained

---

## TypeScript Reference Implementation ✅ COMPLETE

### Files Modified

1. **`nosql-create-index-typescript/src/control-plane.ts`**
   - ✅ Added `deleteContainers()` function (exported)
   - Uses `armClient.sqlResources.beginDeleteSqlContainerAndWait()`
   - Handles 404 gracefully (container may not exist)
   - Deletes both `hotels_diskann` and `hotels_quantizedflat`

2. **`nosql-create-index-typescript/src/index.ts`**
   - ✅ Imported `deleteContainers` from control-plane module
   - ✅ Added call to `await deleteContainers(armClient, config)` after Phase 4a (data cleanup)
   - ✅ Prints output: `=== Cleanup: Delete Containers ===` before deletion

### Output Pattern

```
=== Cleanup: Clear Sample Data ===
  ✓ Cleared data from hotels_diskann
  ✓ Cleared data from hotels_quantizedflat

=== Cleanup: Delete Containers ===
  ✓ Deleted hotels_diskann
  ✓ Deleted hotels_quantizedflat

Complete
```

### Key Implementation Details

**ARM SDK Method:**
```typescript
await armClient.sqlResources.beginDeleteSqlContainerAndWait(
  resourceGroupName,
  accountName,
  databaseName,
  containerName
);
```

**Error Handling:**
- 404 errors (NotFound) are expected and suppressed
- Other errors are re-thrown
- Function completes successfully even if containers don't exist

**Execution Context:**
- Runs after Phase 4a (data cleanup)
- Uses same `SampleConfig` and `armClient` created in Phase 1
- No new credentials or clients needed

---

## Go Implementation ❌ TODO

### Required Changes

1. **`nosql-create-index-go/controlplane.go`** (or equivalent control-plane module)
   - Create new function: `DeleteContainers(ctx context.Context, armClient ..., config SampleConfig) error`
   - Use ARM SDK for Go: `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmosdb`
   - Call: `sqlContainersClient.BeginDelete(ctx, resourceGroup, accountName, databaseName, containerName, nil)`
   - Iterate over `[]string{"hotels_diskann", "hotels_quantizedflat"}`
   - Handle `errors.Is(err, azcore.ErrNotFound)` gracefully (no error if not found)
   - Print: `  ✓ Deleted {containerName}` for each successful deletion

2. **`nosql-create-index-go/main.go`** (or equivalent orchestration)
   - After Phase 4a (data cleanup section), add:
     ```
     fmt.Println("\n=== Cleanup: Delete Containers ===")
     if err := DeleteContainers(ctx, armClient, config); err != nil {
       return fmt.Errorf("delete containers failed: %w", err)
     }
     ```

### Go ARM SDK Pattern

```go
import "github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmosdb/armcosmosdb"

sqlContainersClient, _ := armcosmosdb.NewSQLContainersClient(subscriptionID, credential, nil)
poller, _ := sqlContainersClient.BeginDelete(ctx, resourceGroup, accountName, databaseName, containerName, nil)
_, _ = poller.PollUntilDone(ctx, nil)
```

---

## Python Implementation ❌ TODO

### Required Changes

1. **`nosql-create-index-python/src/control_plane.py`** (or equivalent module)
   - Create function: `def delete_containers(credentials, config: SampleConfig) -> None`
   - Use ARM SDK: `from azure.mgmt.cosmosdb import CosmosDBManagementClient`
   - Call: `client.sql_resources.begin_delete_sql_container(...).result()`
   - Iterate over `["hotels_diskann", "hotels_quantizedflat"]`
   - Catch `azure.core.exceptions.ResourceNotFoundError` (404 is expected, suppress it)
   - Print: `  ✓ Deleted {container_name}` for each deletion

2. **`nosql-create-index-python/src/index.py`** (or equivalent orchestration)
   - After Phase 4a (data cleanup), add:
     ```python
     print("\n=== Cleanup: Delete Containers ===")
     delete_containers(credentials, config)
     ```

### Python ARM SDK Pattern

```python
from azure.mgmt.cosmosdb import CosmosDBManagementClient
from azure.core.exceptions import ResourceNotFoundError

cosmos_client = CosmosDBManagementClient(credentials, subscription_id)
try:
    cosmos_client.sql_resources.begin_delete_sql_container(
        resource_group_name,
        account_name,
        database_name,
        container_name
    ).result()
except ResourceNotFoundError:
    pass  # Container already deleted or doesn't exist
```

---

## Java Implementation ❌ TODO

### Required Changes

1. **`nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/ControlPlane.java`**
   - Add method: `public static void deleteContainers(CosmosDBManagementClient client, SampleConfig config) throws Exception`
   - Use ARM SDK: `com.azure.resourcemanager.cosmosdb.models.SqlContainerResource`
   - Import: `com.azure.resourcemanager.CosmosDBManager` or equivalent
   - Call ARM delete API for each container
   - Catch `com.azure.core.exception.ResourceNotFoundException` (suppress)
   - Print: `  ✓ Deleted {containerName}` for each deletion

2. **`nosql-create-index-java/src/main/java/com/azure/cosmos/createindex/App.java`**
   - After Phase 4a (data cleanup), add:
     ```java
     System.out.println("\n=== Cleanup: Delete Containers ===");
     ControlPlane.deleteContainers(armClient, config);
     ```

### Java ARM SDK Pattern

```java
import com.azure.resourcemanager.cosmosdb.CosmosDBManager;
import com.azure.core.exception.ResourceNotFoundException;

CosmosDBManager manager = CosmosDBManager.authenticate(credentials, subscriptionId, new AzureProfile());
try {
    manager.sqlContainers().deleteAsync(resourceGroupName, accountName, databaseName, containerName)
        .blockingGet();
} catch (ResourceNotFoundException e) {
    // Container doesn't exist, that's OK
}
```

---

## .NET Implementation ❌ TODO

### Required Changes

1. **`nosql-create-index-dotnet/src/ControlPlane.cs`**
   - Add method: `public static async Task DeleteContainersAsync(CosmosDBManagementClient client, SampleConfig config)`
   - Use ARM SDK: `Azure.ResourceManager.CosmosDB`
   - Call: `cosmosDbResourceGroup.GetSqlDatabase(...).GetSqlContainer(...).DeleteAsync(...)`
   - Iterate over `new[] { "hotels_diskann", "hotels_quantizedflat" }`
   - Catch `Azure.RequestFailedException` with status 404 (suppress)
   - Print: `  ✓ Deleted {containerName}` for each deletion

2. **`nosql-create-index-dotnet/src/Program.cs`**
   - After Phase 4a (data cleanup), add:
     ```csharp
     Console.WriteLine("\n=== Cleanup: Delete Containers ===");
     await ControlPlane.DeleteContainersAsync(armClient, config);
     ```

### .NET ARM SDK Pattern

```csharp
using Azure.ResourceManager;
using Azure.ResourceManager.CosmosDB;

ArmClient armClient = new ArmClient(credential);
var resourceGroup = armClient.GetResourceGroupResource(ResourceIdentifier.Parse(...));
var account = resourceGroup.GetCosmosDBAccount(accountName);
var database = account.GetSqlDatabase(databaseName);
var container = database.GetSqlContainers();

try {
    await container.Delete(containerName).ConfigureAwait(false);
} catch (RequestFailedException ex) when (ex.Status == 404) {
    // OK - container doesn't exist
}
```

---

## Completion Checklist

### TypeScript ✅
- [x] Control-plane module has `deleteContainers()` function
- [x] Main orchestration imports and calls `deleteContainers()`
- [x] Output section for "=== Cleanup: Delete Containers ===" 
- [x] Both containers deleted: `hotels_diskann`, `hotels_quantizedflat`
- [x] Error handling: 404 is suppressed
- [x] Compiles and type-checks
- [x] Follows architecture plan

### Go ❌
- [ ] Control-plane module has `DeleteContainers()` function
- [ ] Main orchestration calls `DeleteContainers()`
- [ ] Output section for "=== Cleanup: Delete Containers ===" 
- [ ] Both containers deleted
- [ ] Error handling: NotFound is suppressed
- [ ] Builds successfully
- [ ] Follows architecture plan

### Python ❌
- [ ] Control-plane module has `delete_containers()` function
- [ ] Main orchestration calls `delete_containers()`
- [ ] Output section for "=== Cleanup: Delete Containers ===" 
- [ ] Both containers deleted
- [ ] Error handling: ResourceNotFoundError is suppressed
- [ ] Lints successfully
- [ ] Follows architecture plan

### Java ❌
- [ ] ControlPlane.java has `deleteContainers()` method
- [ ] App.java calls `deleteContainers()`
- [ ] Output section for "=== Cleanup: Delete Containers ===" 
- [ ] Both containers deleted
- [ ] Error handling: ResourceNotFoundException is suppressed
- [ ] Compiles successfully (Maven build)
- [ ] Follows architecture plan

### .NET ❌
- [ ] ControlPlane.cs has `DeleteContainersAsync()` method
- [ ] Program.cs calls `DeleteContainersAsync()`
- [ ] Output section for "=== Cleanup: Delete Containers ===" 
- [ ] Both containers deleted
- [ ] Error handling: 404 RequestFailedException is suppressed
- [ ] Builds successfully
- [ ] Follows architecture plan

---

## Testing Strategy

Once all 5 languages are updated:

1. **Build test:** `pwsh .github/scripts/test-all-create-index.ps1`
   - Verify all 5 samples compile/build successfully

2. **Runtime test:** For each language (with `.env` populated):
   ```
   # Sample directory has full lifecycle: create → populate → query → delete
   npm start                    # TypeScript
   go run .                    # Go
   python src/index.py         # Python
   mvn exec:java              # Java
   dotnet run                 # .NET
   ```

3. **Verification in Azure Portal:**
   - After each sample runs, verify containers are deleted
   - Check Data Explorer: `HotelsCreateIndex` database should be empty of containers
   - (Infra will re-create them on next `azd provision`)

---

## Summary

**TypeScript** is the reference implementation and demonstrates the complete Phase 4b pattern. **Go, Python, Java, and .NET** need to replicate this pattern using their respective ARM SDKs, following the exact output format and error handling semantics.

Once complete, all 5 samples will demonstrate the full self-contained lifecycle:
- Phase 1: Create containers with vector indexes (control-plane)
- Phase 2-3: Ingest and query data (data-plane)
- Phase 4a: Clear documents (data-plane)
- Phase 4b: Delete containers and indexes (control-plane) ← **THIS PLAN**
