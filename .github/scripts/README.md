# Build & Lint Scripts for Create-Index Samples

This directory contains scripts to build and lint the 5 create-index samples (Go, Python, Java, .NET, TypeScript).

## Quick Start

### Bash/Linux/macOS

Build all samples:
```bash
./test-all-create-index.sh build
```

Lint all samples:
```bash
./test-all-create-index.sh lint
```

Build and lint all samples:
```bash
./test-all-create-index.sh all
```

### PowerShell (Windows)

Build all samples:
```powershell
.\build-all-create-index.ps1
```

Build specific language:
```powershell
.\build-all-create-index.ps1 -Language Go
.\build-all-create-index.ps1 -Language Python
.\build-all-create-index.ps1 -Language Java
.\build-all-create-index.ps1 -Language DotNet
.\build-all-create-index.ps1 -Language TypeScript
```

## Individual Scripts

### Build Scripts

Each language has a dedicated build script:

| Script | Purpose | Requirements |
|--------|---------|--------------|
| `build-go.sh` | Build Go binary | Go 1.19+ |
| `build-python.sh` | Install Python deps & verify syntax | Python 3.8+ |
| `build-java.sh` | Compile Java with Maven | Maven 3.6+, Java 11+ |
| `build-dotnet.sh` | Build .NET project | .NET 6.0+ SDK |
| `build-typescript.sh` | Transpile TypeScript to JavaScript | Node.js 16+ |

### Lint Scripts

Linting support for Go, Python, and TypeScript:

| Script | Tools | Requirements |
|--------|-------|--------------|
| `lint-go.sh` | `gofmt`, `go vet` | Go 1.19+ |
| `lint-python.sh` | `flake8`, `pylint` | Python 3.8+, pip |
| `lint-typescript.sh` | `eslint` (optional), `tsc` | Node.js 16+ |

**Note:** Java and .NET linting integrated into Maven/dotnet build toolchain.

### Master Orchestrators

- **`test-all-create-index.sh`** (Bash): Runs build/lint for all samples with colored summary output
  - Supports: `build`, `lint`, `all` (default: all)
  - Usage: `./test-all-create-index.sh [build|lint|all]`

- **`build-all-create-index.ps1`** (PowerShell): Builds all samples with per-language reporting
  - Supports: `-Language {Go|Python|Java|DotNet|TypeScript|All}` (default: All)
  - Usage: `.\build-all-create-index.ps1 [-Language <lang>]`

## What Each Build Does

### Go
```bash
go mod download    # Download dependencies
go build           # Compile to dist/app
```

### Python
```bash
python -m venv .venv           # Create virtual environment
pip install -r requirements.txt # Install dependencies
python -m py_compile           # Verify syntax (no execution)
```

### Java
```bash
mvn clean compile  # Download deps & compile
```

### .NET
```bash
dotnet restore                      # Restore NuGet packages
dotnet build --configuration Release # Build in Release mode
```

### TypeScript
```bash
npm install        # Install node_modules
npm run build      # Run TypeScript transpiler
```

## Expected Output

Successful build run:
```
✅ Go Build passed
✅ Python Build passed
✅ Java Build passed
✅ .NET Build passed
✅ TypeScript Build passed
```

## Troubleshooting

### "Maven is not installed"
Install Maven from https://maven.apache.org/download.cgi

### ".NET SDK is not installed"
Install from https://dotnet.microsoft.com/download

### "Node.js is not installed"
Install from https://nodejs.org/

### Python: "ModuleNotFoundError"
Virtual environment not activated. Scripts handle this automatically, but ensure `requirements.txt` is up to date.

### Go: "gofmt: command not found"
Install Go from https://golang.org/doc/install

## CI/CD Integration

These scripts are designed for GitHub Actions workflows. Example:

```yaml
name: Build Create-Index Samples
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
      - uses: actions/setup-python@v4
      - uses: actions/setup-java@v3
      - uses: actions/setup-dotnet@v3
      - uses: actions/setup-node@v3
      - run: bash .github/scripts/test-all-create-index.sh build
```

## Notes

- Scripts run from repository root (one level above `.github/scripts/`)
- Each script has error handling and clear error messages
- Lint scripts are advisory (non-blocking); formatting issues are reported but don't fail the build
- All scripts use quiet/silent mode to reduce log verbosity
