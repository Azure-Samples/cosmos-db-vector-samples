# Quickstart Base Constitution

**Effective:** August 2026

**Scope:** All Azure Cosmos DB for NoSQL quickstart samples in `cosmos-db-vector-samples` across all 5 supported languages (Python, TypeScript, Java, Go, .NET).

**Authority:** This file establishes the **shared base contract** for ALL NoSQL quickstart samples in this repository. It defines core requirements for authentication, upfront environment validation, NoSQL injection safety, SQL query syntax, terminology standards, version pinning, and cross-language authority.

---

## I. Scenario Selection & Handoff Architecture

### 1.1 Two Quickstart Scenarios
This repository supports two distinct NoSQL quickstart scenario families:

1. **Vector Search Quickstarts (`nosql-vector-search-*`):**
   - **Sample Families:** `nosql-vector-search-python`, `nosql-vector-search-typescript`, `nosql-vector-search-java`, `nosql-vector-search-go`, `nosql-vector-search-dotnet`
   - **Governing Specs:** `QUICKSTART-CONSTITUTION.md` (Base) + [`docs/VECTOR-SEARCH-CONSTITUTION.md`](docs/VECTOR-SEARCH-CONSTITUTION.md) (Scenario)
   - **Model:** Data-plane-only execution. Assumes infrastructure (database and containers with vector policies) is pre-provisioned via Bicep/`azd up`/Portal. Samples load data and execute vector search.

2. **Create Index Quickstarts (`nosql-create-index-*`):**
   - **Sample Families:** `nosql-create-index-python`, `nosql-create-index-typescript`, `nosql-create-index-java`, `nosql-create-index-go`, `nosql-create-index-dotnet`
   - **Governing Specs:** `QUICKSTART-CONSTITUTION.md` (Base) + [`docs/CREATE-INDEX-CONSTITUTION.md`](docs/CREATE-INDEX-CONSTITUTION.md) (Scenario)
   - **Model:** Control-plane + data-plane execution. Uses Azure Resource Manager (ARM) SDKs to create and manage containers with vector policies and indexes dynamically at runtime, followed by data-plane load, query, and container cleanup.

### 1.2 Scenario Handoff & Augmentation Rule
- The scenario constitutions **extend and augment** this Base Constitution; they do NOT replace it.
- All quickstart implementations MUST comply with all MUST/REQUIRED rules in this Base Constitution, in addition to the rules in their respective Scenario Constitution.
- No quickstart family may be validated against the wrong scenario constitution.

---

## II. Shared Authentication & Client Initialization

### 2.1 Passwordless Authentication (Primary)
All quickstart samples MUST use passwordless authentication (`DefaultAzureCredential`) for both Azure Cosmos DB and Azure OpenAI.
- Local execution uses current Azure CLI or Azure Developer CLI credentials (`az login` / `azd auth login`).
- Hosted execution uses Managed Identity.
- Samples MUST NOT use Cosmos DB account keys, connection strings, public OpenAI API keys, or hardcoded credentials.

### 2.2 Graceful Degradation & Failure Reporting
If client initialization fails (Cosmos DB or Azure OpenAI), the sample MUST fail IMMEDIATELY upfront with a clear, informative error message identifying which client failed and listing the required environment variables and login steps.

Example:
```text
ERROR: Azure OpenAI client is not configured.
Please check your environment variables:
  - AZURE_OPENAI_EMBEDDING_ENDPOINT
  - AZURE_OPENAI_EMBEDDING_API_VERSION
  - AZURE_OPENAI_EMBEDDING_MODEL

Run 'az login' or 'azd auth login' for local passwordless authentication.
```

---

## III. Upfront Environment Variable Validation & Configuration

### 3.1 Upfront Validation Timing
All environment variables MUST be validated upfront before any client operations or business logic execute.
- Trim whitespace and surrounding quotes before validation.
- Treat null, missing, empty, or whitespace-only required values as missing.
- Collect and report ALL missing required variables together in a single error message.
- Exit with a non-zero exit code if validation fails. Do not attempt to proceed with invalid or missing configuration.

### 3.2 Language-Native Configuration Patterns
- **Python:** Process environment through `os.environ`; no automatic `.env` loading.
- **TypeScript:** Node.js native `--env-file .env` and process environment.
- **Java:** Process environment through `System.getenv`.
- **Go:** Process environment through `os.Getenv`.
- **.NET:** `appsettings.json` through `ConfigurationBuilder`, overridden by environment variables.

Each sample directory MUST maintain exactly one committed `.env.example` (or `appsettings.json` template) with placeholder values. Runtime configuration files (`.env`, `appsettings.json`) MUST remain ignored by Git.

---

## IV. Security & Query Injection Safety

### 4.1 SQL Parameter Safety for Vector Distance
In Azure Cosmos DB for NoSQL SQL queries, field names CANNOT be parameterized using SQL parameter placeholders (`@field`).

### 4.2 Field Name Validation Whitelist
Any configurable embedding field name (e.g., from `EMBEDDED_FIELD` environment variable) interpolated into SQL query strings MUST be strictly validated against the whitelist regex:
```regex
^[A-Za-z_][A-Za-z0-9_]*$
```
If the field name fails regex validation, the application MUST throw an error and exit immediately before query construction to prevent NoSQL/SQL injection.

---

## V. Query Syntax & Terminology Standards

### 5.1 Approved Query Syntax
Vector search queries MUST use the `VectorDistance()` SQL function with `TOP` and `ORDER BY` clauses.
- **Forbidden:** Samples MUST NOT use `$search`, `cosmosSearch`, `createIndexes`, or any MongoDB wire protocol commands.

### 5.2 Required Terminology
- Refer to the AI service explicitly as "Azure OpenAI" (not "OpenAI").
- Use generic embedding field names (e.g., `DescriptionVector`, `vector`, `embedding`) instead of model-specific names (e.g., `text_embedding_ada_002`).
- Describe `QuantizedFlat` as using "vector quantization techniques" and `DiskANN` as a "graph-based index".
- Describe `Flat` as intended only for test or very small scenarios with small dimensional vectors.
- Describe performance as "efficient RU consumption at scale" (RU cost) rather than memory usage, and "high recall" rather than specific percentages.

---

## VI. Version Pinning, Dependencies & Governance

### 6.1 Dependency Governance
Samples MUST use one supported SDK generation per service surface and the latest stable version compatible with the runtime. Dependency manifests and lock files MUST be updated together.

### 6.2 Cross-Language Authority
No single language sample is the reference implementation. This Base Constitution and the respective scenario constitutions define observable behavior. Language-specific code may differ only where SDK APIs require it. All 5 language implementations (Python, TypeScript, Java, Go, .NET) MUST maintain parity.

### 6.3 Change Control
Any changes to shared configuration, authentication, query rules, or validation contracts MUST update this Base Constitution, the respective scenario constitutions, and all affected language samples in the same PR.

---

## VII. Appendix: Shared Base Checklist

Use this checklist when creating or reviewing any NoSQL quickstart sample:

- [ ] Passwordless authentication uses `DefaultAzureCredential` (no account keys or connection strings).
- [ ] All configuration validated upfront before client operations begin.
- [ ] Required environment variables checked and reported together if missing.
- [ ] Field names validated against `^[A-Za-z_][A-Za-z0-9_]*$` before SQL interpolation.
- [ ] Vector search uses `VectorDistance()` SQL function with `TOP` and `ORDER BY`.
- [ ] Uses exact terminology ("Azure OpenAI", generic embedding field names, RU cost, high recall).
- [ ] Follows scenario-specific constitution (`docs/VECTOR-SEARCH-CONSTITUTION.md` or `docs/CREATE-INDEX-CONSTITUTION.md`).
