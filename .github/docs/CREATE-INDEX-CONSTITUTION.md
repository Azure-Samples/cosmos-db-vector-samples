# Create-index samples constitution

**Effective:** August 2026

**Scope:** `nosql-create-index-python`, `nosql-create-index-typescript`,
`nosql-create-index-java`, `nosql-create-index-go`, and
`nosql-create-index-dotnet`

**Authority:** This file is the source of truth for create-index sample
governance.

---

## Preamble

The create-index samples demonstrate how to create and delete Azure Cosmos DB
for NoSQL containers with vector policies and indexes through Azure Resource
Manager control-plane SDKs. They then use data-plane SDKs to insert documents
and run vector queries.

These samples are the explicit exception to the repository's general
data-plane-only rule. All other `nosql-*` samples must assume infrastructure
already exists and must not perform management-plane operations.

## I. Resource and configuration contract

### 1.1 Resource names

Each sample manages two containers:

| Environment variable | Default |
|---|---|
| `AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME` | `hotels_diskann` |
| `AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME` | `hotels_quantizedflat` |

Container names must not contain language suffixes such as `_py`, `_ts`,
`_java`, `_go`, or `_dotnet`. The same configured name must be used in the ARM
request URI, request body, data-plane access, diagnostics, and cleanup.

Azure Cosmos DB vector indexes are defined by path and type in the container
indexing policy. Do not invent or require a separate index-name environment
variable.

### 1.2 Required environment variables

All samples must validate these values before starting control-plane work:

```text
AZURE_COSMOSDB_ENDPOINT
AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME
AZURE_OPENAI_EMBEDDING_ENDPOINT
AZURE_OPENAI_EMBEDDING_DEPLOYMENT
AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_LOCATION
AZURE_COSMOSDB_ACCOUNT_NAME
DATA_FILE_WITH_VECTORS_AND_REGIONS
```

`DATA_FILE_WITH_VECTORS` may be accepted as a documented legacy fallback.

The container-name variables, embedding field, API version, dimensions,
partition key, query text, and algorithm selector may have documented defaults.
An exported empty or whitespace-only optional override must be treated as
unset, so the documented default is used.

Each sample must expose
`AZURE_COSMOSDB_CREATE_INDEX_ALLOW_DESTRUCTIVE_OPERATIONS` as a documented
deletion opt-in that defaults to `false`. Set the opt-in to `true` only when
using custom container names and after confirming that both configured
containers are safe to delete. The DiskANN and QuantizedFlat container names
must be distinct using a case-insensitive comparison.

### 1.3 Validation requirements

- Trim whitespace and surrounding quotes before validation.
- Treat null, missing, empty, and whitespace-only required values as missing.
- Report all missing variables together and exit nonzero.
- Do not begin an ARM or data-plane request after validation fails.
- Every required environment variable must map to a real configuration field.
  Tests must cover this mapping to prevent lookup errors such as a missing
  `AZURE_SUBSCRIPTION_ID` mapping.
- Use the configured `AZURE_SUBSCRIPTION_ID`. Do not invoke Azure CLI from
  sample code to discover a potentially different active subscription.
- Validate configurable embedded field names against
  `^[A-Za-z_][A-Za-z0-9_]*$` before SQL string interpolation.

### 1.4 Language-native configuration

| Language | Runtime configuration |
|---|---|
| Python | Process environment through `os.environ`; no automatic `.env` loading |
| TypeScript | Node.js `--env-file` support and process environment |
| Java | Process environment through `System.getenv` |
| Go | Process environment through `os.Getenv` |
| .NET | `appsettings.json` through `ConfigurationBuilder`, overridden by environment variables |

Each sample must contain exactly one committed example template. Runtime files
such as `.env` and `appsettings.json` must remain ignored by Git. Documentation
must state whether a template is loaded automatically or must first be exported
into the process environment.

## II. Authentication and authorization

### 2.1 Credential model

All Azure clients must use `DefaultAzureCredential`.

- Local execution normally uses current Azure CLI or Azure Developer CLI
  credentials.
- Hosted execution may use managed identity.
- Do not use Cosmos DB account keys, connection strings, public OpenAI keys, or
  hardcoded credentials.
- Refer to the embedding service as Azure OpenAI.

The Azure identity must have both the management-plane permissions needed to
manage the sample containers and the data-plane RBAC permissions needed to
insert and query documents.

### 2.2 Azure OpenAI configuration

Use these names:

```text
AZURE_OPENAI_EMBEDDING_ENDPOINT
AZURE_OPENAI_EMBEDDING_DEPLOYMENT
AZURE_OPENAI_EMBEDDING_API_VERSION
```

Do not document `OPENAI_KEY`, `sk-...`, or the public OpenAI endpoint for these
samples.

## III. Control-plane boundaries

### 3.1 Allowed operations

Create-index samples may:

1. Access the configured create-index database created by Bicep.
2. Delete only the two configured sample container names.
3. Create those containers with their vector embedding and indexing policies.
4. Verify the resulting control-plane definitions.
5. Delete those same containers during final cleanup.

Create-index samples must not create, update, or delete the database. Run
`azd up` or `azd provision` to create the configured database before running a
sample.

Control-plane functions must live in a clearly named control-plane module.
Data-plane modules must contain only document and query operations.

### 3.2 Deletion safeguards

Container deletion is expected for these samples because vector policies and
indexes are immutable after creation. The documented default container names
don't require a separate opt-in flag when all these safeguards are present:

- The database is the configured create-index database.
- The name is one of the two configured sample container names.
- Empty names are rejected or replaced by documented defaults.
- The exact target is logged before deletion.
- The operation waits for a terminal state before creation or the next sample
  proceeds.

Custom container names require the language sample's documented deletion
opt-in. Reject custom names unless that opt-in is present. Never delete arbitrary
user-supplied container names or resources outside the configured create-index
database.

### 3.3 Long-running ARM operations

Every ARM create or delete operation must:

- print a progress message before waiting;
- use an explicit polling interval instead of an SDK default;
- use a bounded context or cancellation timeout;
- report completion and elapsed time;
- surface timeout and service errors;
- wait for terminal completion when another sample will reuse the same names.

A five-second polling interval and a two-minute per-container timeout are the
recommended defaults for deletion.

### 3.4 Request consistency

The resource ID in the ARM request body must exactly match the resource name in
the request URI. Use the SDK's current typed request models whenever the SDK
provides them. In Python, create the request with
`SqlContainerResource` and `SqlContainerCreateUpdateParameters`; do not pass a
raw `{"resource": ...}` dictionary to the management client. If raw payloads
are required in another language, test their serialized shape against the
installed SDK version.

## IV. SDK and dependency governance

### 4.1 One SDK generation per surface

A sample must not import multiple major generations of the same management SDK
surface. For example, Go must not use both `armcosmos` and `armcosmos/v3`.
Creation, verification, and deletion must use the same major SDK generation.

Use the latest stable version compatible with the sample runtime. Preview or
beta dependencies are allowed only when required for a demonstrated feature
and the reason is documented.

Dependency manifests and lock files must be updated together. Run the
ecosystem's dependency cleanup command, such as `go mod tidy`, after removing a
dependency.

### 4.2 Required dependency coverage

Every imported SDK must be declared. Import smoke tests or builds must catch
missing packages. For example, Python control-plane code importing
`azure.mgmt.cosmosdb` requires `azure-mgmt-cosmosdb` in `requirements.txt`.

## V. Documentation requirements

Every sample README and quickstart must:

1. Explain that the sample performs Azure Resource Manager control-plane
   container creation and deletion.
2. List the required environment variables using their exact names.
3. Explain local `DefaultAzureCredential` authentication and hosted managed
   identity behavior.
4. State the required management-plane and data-plane permissions.
5. Describe how that language loads configuration and whether `.env` or
   `appsettings.json` is loaded automatically.
6. Identify the two containers that the sample may delete.
7. Explain the custom-name deletion opt-in.
8. Explain that cleanup waits for both container deletions to complete.
9. Link to the shared validation and generated-artifact cleanup commands.

Documentation examples must use Azure OpenAI terminology, generic embedding
field names, and the same resource defaults as infrastructure and code.

## VI. Runtime output

Each sample must clearly log:

1. The Azure Cosmos DB endpoint and create-index database name.
2. The selected container names, vector index types, embedding path,
   dimensions, and distance function.
3. Container creation and verification.
4. Document insertion totals.
5. Query completion for DiskANN and QuantizedFlat using Cosine, DotProduct, and
   Euclidean distance functions.
6. A final Markdown results table with six rows.
7. Cleanup progress and completion.
8. `Complete` only after cleanup succeeds.

Errors must identify the failed operation and resource. Do not label every
failure as an authentication problem.

## VII. Testing and validation

### 7.1 Unit and build validation

Changes must use each sample's existing tests and build tools. Configuration
tests must cover:

- every required control-plane variable;
- empty optional container-name overrides;
- custom container-name deletion opt-in;
- algorithm and container-name consistency;
- data-file resolution;
- field-name validation;
- case-insensitive rejection of duplicate container names;
- request URI and body resource-name consistency when practical.
- absence of database create, update, or delete operations in sample code.

### 7.2 End-to-end validation

Use the shared validator from the repository root:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1
```

For one language:

```powershell
pwsh -NoProfile -File .github\skills\sample-validate-nosql-create-index\scripts\validate-create-index-samples.ps1 -Language Go
```

Supported values are `All`, `Python`, `TypeScript`, `DotNet`, `Go`, and `Java`.
Do not substitute a manual run when validating a cross-language change.

The validator must:

- call `.github\scripts\run-all-create-index.ps1`;
- capture a timestamped master log and summary;
- preserve each language's timestamped output;
- require exit code `0`;
- treat a selected sample skipped because its directory or data file is missing
  as a failure and exit nonzero;
- structurally compare the final table with the committed
  `output\sample-output.txt`;
- require all six combinations of index type and distance function;
- ignore volatile paths, timings, RU charges, scores, and minor formatting.

Never update committed sample output merely to force validation to pass.

### 7.3 Generated cleanup

Use:

```powershell
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All -WhatIf
pwsh -NoProfile -File .github\scripts\clean-all-create-index.ps1 -Language All
```

The cleanup script must preserve committed source, manifests, templates,
documentation, and `output\sample-output.txt`.

Cleanup may remove region-based data files copied into sample `data` folders.
Before running end-to-end validation after cleanup, restore those generated
files through the repository's post-provision hook or by rerunning
`azd provision`; do not copy secrets or manually replace committed reference
output.

The cleanup and lifecycle tools must load the active `azd` environment before
invoking `azd hooks run postprovision` or `azd hooks run predown`. The
`AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` value determines the CREATE-INDEX
hook branch. If the deployment scenario cannot be determined, the hook must
report the problem and skip local data-file cleanup rather than silently
selecting the vector-search branch.

Generated output must use these paths:

```text
<sample>/output/create-index-run-<yyyyMMdd-HHmmss>/run-<language>.txt
.github/scripts/output/validation-<yyyyMMdd-HHmmss>/
  run-all-create-index.txt
  validation-summary.txt
```

New code must not create legacy bare timestamp directories or unprefixed
`output/run-*` directories. Cleanup may recognize legacy paths for migration
and removal. All generated output must be covered by `.gitignore` and must not
appear as untracked files.

## VIII. Infrastructure and Azure Developer CLI outputs

### 8.1 Output contract

`infra/main.bicep` must export nonempty create-index container-name values:

```bicep
output AZURE_COSMOSDB_CREATE_INDEX_DISKANN_CONTAINER_NAME string = 'hotels_diskann'
output AZURE_COSMOSDB_CREATE_INDEX_QUANTIZEDFLAT_CONTAINER_NAME string = 'hotels_quantizedflat'
```

Do not export known configuration keys as empty strings. Empty `azd` outputs
create inconsistent fallback behavior across languages.

The deployment scenarios are mutually exclusive. When
`AZURE_COSMOSDB_CREATE_INDEX_DATABASENAME` is set, Bicep provisions the
configured create-index database instead of the vector-search `Hotels`
database. Documentation must not state that one deployment creates both
databases. Outputs for vector-search-only resources must be empty in the
create-index scenario.

After changing Bicep, regenerate the committed ARM JSON and verify that the
output values match:

```powershell
az bicep build --file infra\main.bicep --outfile infra\main.json
```

### 8.2 Coordinated changes

Changes to shared variable names, defaults, resource names, output structure,
or validation behavior must:

1. be applied consistently across all affected language samples;
2. update infrastructure outputs and generated ARM JSON when applicable;
3. update README and quickstart documentation;
4. update tests;
5. run the shared end-to-end validator.

### 8.3 Cross-platform hooks and scripts

Define each Azure Developer CLI lifecycle hook with separate `windows` and
`posix` branches so only the matching platform implementation runs. Validate
changed shell scripts with `bash -n`. Commit `.sh` files with LF line endings
and enforce LF through `.gitattributes` where Windows development could
reintroduce CRLF.

## IX. Lifecycle and contributor workflow

The following skills are the canonical entry points for create-index work:

| Operation | Skill |
|---|---|
| Provision resources | `sample-provision-nosql-create-index` |
| Validate all samples | `sample-validate-nosql-create-index` |
| Clean local artifacts | `samples-cleanup-nosql-create-index` |
| Deprovision Azure resources | `sample-deprovision-nosql-create-index` |

The canonical lifecycle is:

```text
azd auth login
  -> select and verify the target azd environment and subscription
  -> azd up or azd provision
  -> validate samples
  -> clean local artifacts
  -> explicitly confirm testing is complete
  -> azd down
```

Use `azd up` for first-time setup, `azd provision` to reprovision or restore
the environment and run `postprovision`, and
`azd hooks run postprovision` only when hook-only restoration is intentional.
Use `azd down` for Azure resource teardown and the cleanup skill for local
generated artifacts. Do not substitute one operation for another.

Before deprovisioning, contributors must authenticate with `azd auth login`,
inspect `azd env get-values`, confirm the target subscription and resource
group, and explicitly confirm that testing is complete. A failed `predown`
hook is a failed deprovision operation even if `azure.yaml` allows teardown to
continue.

Do not create alternate create-index workflows in instruction files, READMEs,
scripts, or chat guidance. Changes to lifecycle commands, hooks, output paths,
resource names, or validation behavior must update this constitution and the
affected canonical skills in the same change.

## X. Review authority

This constitution, the shared runner, and the shared validator define expected
behavior. No single language sample is the reference implementation.
Language-specific code may differ where SDK APIs require it, but observable
configuration, resource names, table structure, safety boundaries, and
validation outcomes must remain consistent.

## Appendix: required execution checklist

- [ ] `azd up` or `azd provision` completed successfully
- [ ] The configured create-index database was created by Bicep
- [ ] `az login` and `azd auth login` are current for local execution
- [ ] Required environment values are present and nonempty
- [ ] Container names are `hotels_diskann` and `hotels_quantizedflat`, unless
      explicitly configured otherwise
- [ ] Custom container names have explicit deletion opt-in
- [ ] Only one management SDK major generation is imported per language
- [ ] ARM operations have progress output, explicit polling, and timeouts
- [ ] Both containers are created and verified
- [ ] Both containers return all three distance-function results
- [ ] The final six-row Markdown table is present
- [ ] Both containers are deleted successfully
- [ ] The shared validator reports `PASS`

---

## Change log

| Date | Change |
|---|---|
| August 2026 | Initial constitution |
| August 2026 | Corrected configuration, authentication, deletion, SDK, infrastructure output, and validation governance |
| August 2026 | Centralized lifecycle skills, hook handling, output conventions, and contributor workflow governance |
| August 2026 | Added location, deletion-target, skipped-run, scenario-isolation, database-ownership, and cross-platform script requirements |
