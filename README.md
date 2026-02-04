# Azure Cosmos DB Vector Search Samples

This repository demonstrates how to integrate vector search capabilities into Azure Cosmos DB databases using various programming languages and SDKs.

## Important: Authentication and Resource Management

### Microsoft Entra ID Authentication

All samples in this repository use **Microsoft Entra ID (formerly Azure AD)** authentication with data plane RBAC. This provides:
- ✅ Secure, passwordless authentication
- ✅ Identity-based access control
- ✅ Compliance with Azure security best practices

### Resource Creation Requirements

**Critical:** The samples use **data plane SDKs only** and cannot create databases or containers. You must create these resources before running the sample code.

#### How to Create Resources

1. **Azure Developer CLI (Recommended)**: 
   - Provisions all necessary Azure resources using your local developer's identity
   - Run `azd up` in the appropriate sample directory

2. **Azure Portal**:
   - Navigate to [Azure Portal](https://portal.azure.com)
   - Create the Cosmos DB account, database, and container manually

3. **Azure CLI**:
   ```bash
   az cosmosdb sql database create --account-name <account> --name <database> --resource-group <rg>
   az cosmosdb sql container create --account-name <account> --database-name <database> --name <container> --partition-key-path <path> --resource-group <rg>
   ```

### Why Resources Must Be Pre-Created

The RBAC roles assigned in these samples are configured for **data plane operations only**:
- ✅ Reading and writing documents
- ✅ Querying data
- ✅ Managing items within containers

The roles do **NOT** support management plane operations:
- ❌ Creating or deleting databases
- ❌ Creating or deleting containers
- ❌ Modifying container configurations

**For more information:**
- [Azure Cosmos DB role-based access control](https://learn.microsoft.com/azure/cosmos-db/role-based-access-control)
- [Configure RBAC with Microsoft Entra ID](https://learn.microsoft.com/azure/cosmos-db/how-to-setup-rbac)
- [Management plane vs. data plane access](https://learn.microsoft.com/azure/cosmos-db/security)



## Features

This project framework provides the following features:

* Feature 1
* Feature 2
* ...

## Getting Started

### Prerequisites

- Use the Azure Agent Service [deployment](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/environment-setup) to get your resources created.
    - Azure AI Foundry
    - Azure AI Foundry project
    - Azure Cosmos DB
    - Azure Search
    - Azure Storage

### Installation

(ideally very short)

- npm install [package name]
- mvn install
- ...

### Quickstart
(Add steps to get up and running quickly)

1. git clone [repository clone url]
2. cd [repository name]
3. ...


## Demo

A demo app is included to show how to use the project.

To run the demo, follow these steps:

(Add steps to start up the demo)

1.
2.
3.

## Resources

(Any additional resources or related projects)

- Link to supporting information
- Link to similar sample
- ...
