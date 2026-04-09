# scripts/

Pre-flight utilities for the `cosmos-db-vector-samples` AZD deployment.

## check-quota.sh

Checks that your Azure subscription has enough Azure OpenAI quota to deploy the models in `infra/main.bicep` **before** you run `azd up`.

### What it checks

The Bicep template deploys two Azure OpenAI models:

| Model | Version | SKU (deployment type) | Capacity |
|---|---|---|---|
| `gpt-4o-mini` | 2024-07-18 | GlobalStandard | 50K TPM |
| `text-embedding-3-small` | 1 | Standard | 10K TPM |

Allowed regions: `eastus2`, `swedencentral`

The script:

1. Verifies you're logged in to Azure CLI
2. Checks model availability in each region (model + SKU combination)
3. Queries your subscription's quota usage and limits
4. Compares what the template needs vs. what's available
5. Shows a clear pass/fail table
6. Suggests alternative regions if quota is insufficient

### Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed
- Logged in: `az login`
- A subscription with Azure OpenAI access

### Usage

```bash
# Basic check — all template-allowed regions
./scripts/check-quota.sh

# Check + show fix suggestions
./scripts/check-quota.sh --fix

# Check a specific region only
./scripts/check-quota.sh --region swedencentral

# Use a specific subscription
./scripts/check-quota.sh --subscription 00000000-0000-0000-0000-000000000000

# Combine flags
./scripts/check-quota.sh --fix --region eastus2 --subscription <id>
```

### Example output

```
Azure OpenAI Quota Pre-flight Check
====================================

ℹ  Subscription: My Subscription (abc-123-def)

✅ Bicep references match hardcoded model specs.

Checking quota in target region(s)...

Region           Model                      SKU               Requested       Used      Limit  Status
────────────────  ──────────────────────────  ────────────────  ──────────  ──────────  ──────────  ──────────────
eastus2          gpt-4o-mini                GlobalStandard          50K         30K        80K  ✅ OK (50K free)
eastus2          text-embedding-3-small     Standard                10K          0K       120K  ✅ OK (120K free)

✅ All models have sufficient quota. Ready to deploy!
```

### The `--fix` flag

When quota is insufficient, `--fix` suggests actionable commands:

- **`azd env set AZURE_LOCATION <region>`** — switch to a region with quota
- Portal link to request a quota increase
- How to reduce capacity in the Bicep template

### Keeping the script up to date

The model specs are hardcoded in the script (not parsed from Bicep) for reliability. If you change the models, SKUs, or capacities in `infra/main.bicep`, update the `MODEL_SPECS` array near the top of `check-quota.sh` to match.

### Platform compatibility

Works on Linux, macOS, WSL, and Git Bash on Windows. No dependency on `jq` — uses `az --query` (JMESPath) and standard shell tools only.
