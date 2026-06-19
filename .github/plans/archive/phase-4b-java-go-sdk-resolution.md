# Phase 4b: Java & Go SDK Resolution Status

**Date:** 2026-06-18  
**Goal:** Resolve SDK API and dependency issues for Java and Go, enabling all 5 languages to use official Azure SDKs for container deletion

---

## Summary

We've identified and partially resolved critical issues with Java and Go control-plane SDK integrations:

### ✅ Completed
- **Java dependency**: Fixed groupId from `com.azure` → `com.azure.resourcemanager` (v2.54.3 now resolves)
- **Java DataPlane API**: Fixed `PartitionKeyBuilder.appendValue()` → `PartitionKeyBuilder.add()`
- **Java ControlPlane code**: Implemented ARM authentication pattern with `CosmosManager.authenticate()` and `sqlResources().deleteSqlContainer()`
- **Go code structure**: Updated imports to use `armcosmos` SDK instead of REST API
- **Go/Java configs**: Both support environment variables for subscription ID, resource group, account name

### ⚠️ Blocked
1. **Java**: `CosmosManager.authenticate()` API signature mismatch — examples show different parameter orders
2. **Go**: Azure SDK monorepo module path versioning — Go modules can't resolve `armcosmos` submodule version tags

---

## Java Status

### Current State
```
Dependency: com.azure.resourcemanager:azure-resourcemanager-cosmos:2.54.3 ✅ (resolved)
API Pattern: CosmosManager → authenticate() → sqlResources() → deleteSqlContainer()
Code: ControlPlane.java implemented and ready for testing
```

### The Problem
When attempting to compile:
```
mvn clean compile
→ CompilationException: no suitable method found for authenticate(...)
  method authenticate(TokenCredential, AzureProfile) is not applicable
  (actual and formal argument lists differ in length)
```

The `CosmosManager.authenticate()` API signature appears to take exactly 2 parameters:
- Parameter 1: `TokenCredential` (from `DefaultAzureCredential`)
- Parameter 2: `AzureProfile`

But the Cosmos DB subscription context is not being set.

### Resolution Path
**Option 1 (Recommended):** Use `AzureResourceManager` wrapper instead of raw `CosmosManager`
```java
AzureResourceManager arm = AzureResourceManager
    .authenticate(credential, profile)
    .withSubscriptionId(config.subscriptionId());
CosmosDBAccount account = arm.cosmosDBAccounts()
    .getByResourceGroup(resourceGroup, accountName);
// then call delete on account
```

**Option 2:** Use `CosmosManager.configure()` with subscription
```java
CosmosManager manager = CosmosManager.configure()
    .withPipeline(...) // or .withCredential(...)
    .withSubscriptionId(subscriptionId)
    .authenticate(credential, profile);
```

**Option 3:** Check if `azure-resourcemanager` parent package provides a better entry point

### Next Actions
1. Try Option 1 (AzureResourceManager wrapper) — most idiomatic for ARM SDK
2. If that fails, consult official Azure SDK for Java docs on CosmosManager subscription scoping
3. Once subscription ID is correctly passed, recompile and verify

---

## Go Status

### Current State
```
Dependency: github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2
Code: dataplane.go rewritten to use armcosmos.NewClientFactory() and BeginDeleteSQLContainer()
go.mod: Updated with armcosmos dependency require statement
```

### The Problem
```
go mod tidy
→ go: github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos@v1.4.2:
   reading github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos/go.mod
   at revision sdk/resourcemanager/cosmos/armcosmos/v1.4.2:
   unknown revision sdk/resourcemanager/cosmos/armcosmos/v1.4.2
```

The **monorepo structure** of `azure-sdk-for-go` causes Go modules system confusion:
- Actual tags in the repo: `sdk/resourcemanager/cosmos/armcosmos/v1.4.2`
- Go modules expects: `armcosmos/v1.4.2`
- Module path in SDK: `github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos`

### Root Cause
Azure SDK for Go is organized as a **monorepo** where each SDK module (`armcosmos`, `azcosmos`, etc.) is a subdirectory with its own `go.mod`. The Go modules proxy (pkg.go.dev) may not properly expose these submodule versions.

### Resolution Path
**Option 1 (Simplest):** Use `@main` branch reference
```go
require github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2-pre.0+incompatible
// OR
require github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v0.0.0-00010101000000-000000000000
replace github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos => github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2
```

**Option 2:** Use main module tags from the parent repo
```go
require github.com/Azure/azure-sdk-for-go v68.0.0
// Then import from subpackage:
import "github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos"
```

**Option 3 (Least preferable):** Pin to a commit SHA instead of version
```go
require github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2 // indirect
// Use replace:
replace github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos => github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos v1.4.2
```

### Next Actions
1. Try Option 1 with `replace` directive — most reliable for monorepo
2. Run `go get -u` to refresh module cache
3. Run `go mod tidy` to verify
4. Run `go build` to confirm compilation
5. If still fails, consult azure-sdk-for-go GitHub issues for known monorepo workarounds

---

## Python & .NET Status

Both are ready for implementation:

### Python
- **File:** `nosql-create-index-python/src/control_plane.py`
- **SDK:** `azure-mgmt-cosmosdb` (in requirements.txt)
- **Status:** ✅ Code structure ready, environment variables configured
- **Action:** Implement `delete_containers()` method using `CosmosDBManagementClient`

### .NET
- **File:** `nosql-create-index-dotnet/src/ControlPlane.cs`
- **SDK:** `Azure.ResourceManager.CosmosDB` (in project file)
- **Status:** ✅ Code structure ready, environment variables configured
- **Action:** Implement async `DeleteContainersAsync()` using `ArmClient`

---

## Testing Matrix (After Resolutions)

| Language | Dependency | Compile | Run Phase 1 | Run Phase 2 | Run Phase 3 | Run Phase 4 | Clean Docs |
|----------|-----------|---------|-----------|-----------|-----------|-----------|----------|
| TypeScript | ✅ | ✅ | 🔄 | 🔄 | 🔄 | ✅ | 📝 |
| Python | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Java | ⚠️ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Go | ⚠️ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| .NET | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

**Legend:** ✅ Done, ⏳ Pending, ⚠️ Blocked, 🔄 In Progress, 📝 Documented

---

## References

### Java
- [CosmosManager API Docs](https://learn.microsoft.com/en-us/java/api/com.azure.resourcemanager.cosmos.cosmosmanager?view=azure-java-stable)
- [AzureResourceManager (parent SDK)](https://learn.microsoft.com/en-us/java/api/com.azure.resourcemanager.azureresourcemanager?view=azure-java-stable)
- [Maven: azure-resourcemanager-cosmos](https://mvnrepository.com/artifact/com.azure.resourcemanager/azure-resourcemanager-cosmos)

### Go
- [Azure SDK for Go - Cosmos RM Package](https://pkg.go.dev/github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cosmos/armcosmos)
- [Azure SDK for Go GitHub](https://github.com/Azure/azure-sdk-for-go/blob/main/sdk/resourcemanager/cosmos/README.md)
- [Go Modules - Replace Directive](https://go.dev/ref/mod#go-mod-file-replace)

### Architecture Decision
- `.github/plans/create-index-architecture.md` — Authoritative specification requiring all phases use official SDKs only
