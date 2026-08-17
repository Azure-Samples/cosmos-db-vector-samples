#!/usr/bin/env bash
# run-all-create-index.sh
#
# Build, run, and capture output for all create-index samples.
#
# Assumes 'azd up' has already been run and the user is signed in via
# 'az login' / 'azd auth login' (DefaultAzureCredential).
#
# For each selected sample this script:
#   1. Loads all environment variables from 'azd env get-values'.
#   2. Verifies the required data file exists in the sample's ./data/ directory.
#   3. Builds the sample.
#   4. Runs the sample program, tee-ing combined stdout+stderr to both the
#      console and <sample>/output/create-index-run-<yyyyMMdd-HHmmss>/run-<language>.txt.
#   5. Prints a per-language summary table (built, ran, exit code, output path).
#
# Exits non-zero if any selected sample fails to build or run.
#
# Usage:
#   ./run-all-create-index.sh [All|Python|TypeScript|DotNet|Go|Java]
#
# Examples:
#   ./run-all-create-index.sh
#   ./run-all-create-index.sh Python
#   ./run-all-create-index.sh DotNet

LANGUAGE="${1:-All}"
case "$LANGUAGE" in
    All|Python|TypeScript|DotNet|Go|Java) ;;
    *)
        echo "ERROR: unsupported language '$LANGUAGE'." >&2
        echo "Usage: $0 [All|Python|TypeScript|DotNet|Go|Java]" >&2
        exit 1
        ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# ── Helpers ──────────────────────────────────────────────────────────────────

print_header() {
    echo ""
    echo "────────────────────────────────────────────────────────────"
    echo "  $1"
    echo "────────────────────────────────────────────────────────────"
}

# Runs 'azd env get-values' from the repo root and exports all KEY=VALUE pairs
# into the current shell so child processes inherit them.
load_azd_env() {
    print_header "Loading azd env vars"
    cd "$REPO_ROOT"
    local azd_out
    if ! azd_out=$(azd env get-values 2>&1); then
        echo "ERROR: azd env get-values failed. Run 'azd up' first." >&2
        exit 1
    fi
    local count=0
    while IFS= read -r line; do
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local val="${BASH_REMATCH[2]}"
            # Strip surrounding double or single quotes
            val="${val%\"}"
            val="${val#\"}"
            val="${val%\'}"
            val="${val#\'}"
            printf -v "$key" '%s' "$val"
            export "$key"
            (( count++ )) || true
        fi
    done <<< "$azd_out"
    echo "  Loaded $count env vars from azd."
    cd "$REPO_ROOT"
}

# Returns 0 if the data file exists in the sample dir, 1 otherwise.
check_data_file() {
    local sample_dir="$1"
    local rel="${DATA_FILE_WITH_VECTORS_AND_REGIONS:-}"
    if [[ -z "$rel" ]]; then
        rel="${DATA_FILE_WITH_VECTORS:-}"
    fi
    if [[ -z "$rel" ]]; then
        echo "WARNING: Neither DATA_FILE_WITH_VECTORS_AND_REGIONS nor DATA_FILE_WITH_VECTORS is set." >&2
        return 1
    fi
    local abs_path
    abs_path="$(cd "$sample_dir" && realpath -m "$rel" 2>/dev/null || echo "")"
    if [[ -z "$abs_path" || ! -f "$abs_path" ]]; then
        echo "WARNING: Data file not found: $rel (resolved relative to $sample_dir). Skipping." >&2
        return 1
    fi
    return 0
}

# Runs a command with combined stdout+stderr tee'd to a file.
# Returns the exit code of the command (not tee).
run_and_capture() {
    local out_file="$1"
    shift
    mkdir -p "$(dirname "$out_file")"
    "$@" 2>&1 | tee "$out_file"
    return "${PIPESTATUS[0]}"
}

# ── Result tracking ───────────────────────────────────────────────────────────

declare -a RES_LANG=()
declare -a RES_BUILT=()
declare -a RES_RAN=()
declare -a RES_EXIT=()
declare -a RES_OUTFILE=()
declare -a RES_SKIP=()
declare -a RES_SKIP_REASON=()

add_result() {
    local lang="$1" skipped="$2" skip_reason="$3" built="$4" ran="$5" rc="$6" outfile="$7"
    RES_LANG+=("$lang")
    RES_SKIP+=("$skipped")
    RES_SKIP_REASON+=("$skip_reason")
    RES_BUILT+=("$built")
    RES_RAN+=("$ran")
    RES_EXIT+=("$rc")
    RES_OUTFILE+=("$outfile")
}

# ── Startup ───────────────────────────────────────────────────────────────────

print_header "run-all-create-index  $TIMESTAMP"
echo "  Repo root : $REPO_ROOT"
echo "  Language  : $LANGUAGE"

load_azd_env

# ── Python ────────────────────────────────────────────────────────────────────

if [[ "$LANGUAGE" == "All" || "$LANGUAGE" == "Python" ]]; then
    print_header "Python"
    dir="$REPO_ROOT/nosql-create-index-python"
    out_file="$dir/output/create-index-run-$TIMESTAMP/run-python.txt"

    if [[ ! -d "$dir" ]]; then
        echo "WARNING: Sample directory not found: $dir" >&2
        add_result "Python" "true" "Directory not found" "false" "false" "-1" ""
    elif ! check_data_file "$dir"; then
        add_result "Python" "true" "Data file missing" "false" "false" "-1" ""
    else
        built=false; ran=false; rc=-1
        cd "$dir"

        # Build: create venv (if absent) and install dependencies
        if [[ ! -d ".venv" ]]; then
            echo "  Creating Python virtual environment..." 
            if python3 -m venv .venv; then
                echo "  venv created."
            else
                echo "  ❌ python3 -m venv failed." >&2
            fi
        fi

        if [[ -d ".venv" ]]; then
            echo "  pip install -r requirements.txt..."
            if .venv/bin/pip install -q -r requirements.txt; then
                built=true
                echo "  ✅ Build succeeded."
            else
                echo "  ❌ pip install failed." >&2
            fi
        fi

        if [[ "$built" == "true" ]]; then
            # PYTHONUTF8=1 forces UTF-8 stdout/stderr (no-op on Linux/macOS where UTF-8 is default)
            export PYTHONUTF8=1
            echo "  Running: python3 -m src.index  →  $out_file"
            if run_and_capture "$out_file" .venv/bin/python3 -m src.index; then
                rc=0; ran=true
                echo "  ✅ Run succeeded."
            else
                rc=$?; ran=true
                echo "  ❌ Run failed (exit $rc). Check $out_file for details." >&2
                echo "     Auth errors: ensure az login / azd auth login is current." >&2
            fi
        fi

        add_result "Python" "false" "" "$built" "$ran" "$rc" "$out_file"
    fi
fi

# ── TypeScript ────────────────────────────────────────────────────────────────

if [[ "$LANGUAGE" == "All" || "$LANGUAGE" == "TypeScript" ]]; then
    print_header "TypeScript"
    dir="$REPO_ROOT/nosql-create-index-typescript"
    out_file="$dir/output/create-index-run-$TIMESTAMP/run-typescript.txt"

    if [[ ! -d "$dir" ]]; then
        echo "WARNING: Sample directory not found: $dir" >&2
        add_result "TypeScript" "true" "Directory not found" "false" "false" "-1" ""
    elif ! check_data_file "$dir"; then
        add_result "TypeScript" "true" "Data file missing" "false" "false" "-1" ""
    else
        built=false; ran=false; rc=-1
        cd "$dir"

        # Build: install npm deps and compile TypeScript
        echo "  npm install..."
        if npm install --silent; then
            echo "  npx tsc..."
            if npx tsc; then
                built=true
                echo "  ✅ Build succeeded."
            else
                echo "  ❌ tsc failed." >&2
            fi
        else
            echo "  ❌ npm install failed." >&2
        fi

        if [[ "$built" == "true" ]]; then
            # Run — env vars are already exported; no .env file needed
            echo "  Running: node dist/index.js  →  $out_file"
            if run_and_capture "$out_file" node dist/index.js; then
                rc=0; ran=true
                echo "  ✅ Run succeeded."
            else
                rc=$?; ran=true
                echo "  ❌ Run failed (exit $rc). Check $out_file for details." >&2
                echo "     Auth errors: ensure az login / azd auth login is current." >&2
            fi
        fi

        add_result "TypeScript" "false" "" "$built" "$ran" "$rc" "$out_file"
    fi
fi

# ── .NET ──────────────────────────────────────────────────────────────────────

if [[ "$LANGUAGE" == "All" || "$LANGUAGE" == "DotNet" ]]; then
    print_header ".NET"
    dir="$REPO_ROOT/nosql-create-index-dotnet"
    out_file="$dir/output/create-index-run-$TIMESTAMP/run-dotnet.txt"
    csproj="nosql-create-index-dotnet.csproj"

    if [[ ! -d "$dir" ]]; then
        echo "WARNING: Sample directory not found: $dir" >&2
        add_result "DotNet" "true" "Directory not found" "false" "false" "-1" ""
    elif ! check_data_file "$dir"; then
        add_result "DotNet" "true" "Data file missing" "false" "false" "-1" ""
    else
        built=false; ran=false; rc=-1
        cd "$dir"

        # Build
        echo "  dotnet restore..."
        if dotnet restore --nologo -v quiet; then
            echo "  dotnet build (Release)..."
            if dotnet build --configuration Release --no-restore --nologo; then
                built=true
                echo "  ✅ Build succeeded."
            else
                echo "  ❌ dotnet build failed." >&2
            fi
        else
            echo "  ❌ dotnet restore failed." >&2
        fi

        if [[ "$built" == "true" ]]; then
            # Run — env vars override appsettings.json via environment
            echo "  Running: dotnet run --project $csproj  →  $out_file"
            if run_and_capture "$out_file" dotnet run --project "$csproj" --configuration Release --no-build; then
                rc=0; ran=true
                echo "  ✅ Run succeeded."
            else
                rc=$?; ran=true
                echo "  ❌ Run failed (exit $rc). Check $out_file for details." >&2
                echo "     Auth errors: ensure az login / azd auth login is current." >&2
            fi
        fi

        add_result "DotNet" "false" "" "$built" "$ran" "$rc" "$out_file"
    fi
fi

# ── Go ────────────────────────────────────────────────────────────────────────

if [[ "$LANGUAGE" == "All" || "$LANGUAGE" == "Go" ]]; then
    print_header "Go"
    dir="$REPO_ROOT/nosql-create-index-go"
    out_file="$dir/output/create-index-run-$TIMESTAMP/run-go.txt"
    binary="create-index-go"

    if [[ ! -d "$dir" ]]; then
        echo "WARNING: Sample directory not found: $dir" >&2
        add_result "Go" "true" "Directory not found" "false" "false" "-1" ""
    elif ! check_data_file "$dir"; then
        add_result "Go" "true" "Data file missing" "false" "false" "-1" ""
    else
        built=false; ran=false; rc=-1
        cd "$dir"

        # Build
        echo "  go mod download..."
        if go mod download; then
            echo "  go build -o $binary ..."
            if go build -o "$binary" .; then
                built=true
                echo "  ✅ Build succeeded."
            else
                echo "  ❌ go build failed." >&2
            fi
        else
            echo "  ❌ go mod download failed." >&2
        fi

        if [[ "$built" == "true" ]]; then
            echo "  Running: ./$binary  →  $out_file"
            if run_and_capture "$out_file" "./$binary"; then
                rc=0; ran=true
                echo "  ✅ Run succeeded."
            else
                rc=$?; ran=true
                echo "  ❌ Run failed (exit $rc). Check $out_file for details." >&2
                echo "     Auth errors: ensure az login / azd auth login is current." >&2
            fi
        fi

        add_result "Go" "false" "" "$built" "$ran" "$rc" "$out_file"
    fi
fi

# ── Java ──────────────────────────────────────────────────────────────────────

if [[ "$LANGUAGE" == "All" || "$LANGUAGE" == "Java" ]]; then
    print_header "Java"
    dir="$REPO_ROOT/nosql-create-index-java"
    out_file="$dir/output/create-index-run-$TIMESTAMP/run-java.txt"

    if [[ ! -d "$dir" ]]; then
        echo "WARNING: Sample directory not found: $dir" >&2
        add_result "Java" "true" "Directory not found" "false" "false" "-1" ""
    elif ! check_data_file "$dir"; then
        add_result "Java" "true" "Data file missing" "false" "false" "-1" ""
    else
        built=false; ran=false; rc=-1
        cd "$dir"

        # Build
        echo "  mvn compile..."
        if mvn compile -q; then
            built=true
            echo "  ✅ Build succeeded."
        else
            echo "  ❌ mvn compile failed." >&2
        fi

        if [[ "$built" == "true" ]]; then
            # Run (main class: com.azure.cosmos.createindex.App)
            echo "  Running: mvn exec:java  →  $out_file"
            if run_and_capture "$out_file" mvn exec:java; then
                rc=0; ran=true
                echo "  ✅ Run succeeded."
            else
                rc=$?; ran=true
                echo "  ❌ Run failed (exit $rc). Check $out_file for details." >&2
                echo "     Auth errors: ensure az login / azd auth login is current." >&2
            fi
        fi

        add_result "Java" "false" "" "$built" "$ran" "$rc" "$out_file"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

print_header "Summary"
printf '%-12s %-7s %-7s %-8s %s\n' 'Language' 'Built' 'Ran' 'Exit' 'OutputFile'
printf '%-12s %-7s %-7s %-8s %s\n' '--------' '-----' '---' '----' '----------'

any_failed=false
for i in "${!RES_LANG[@]}"; do
    lang="${RES_LANG[$i]}"
    skipped="${RES_SKIP[$i]}"
    skip_reason="${RES_SKIP_REASON[$i]}"
    built="${RES_BUILT[$i]}"
    ran="${RES_RAN[$i]}"
    rc="${RES_EXIT[$i]}"
    outfile="${RES_OUTFILE[$i]}"

    if [[ "$skipped" == "true" ]]; then
        printf '%-12s %-7s %-7s %-8s %s\n' "$lang" "SKIP" "SKIP" "SKIP" "(skipped: $skip_reason)"
    else
        built_s="$( [[ "$built" == "true" ]] && echo "yes" || echo "FAIL" )"
        if [[ "$ran" == "false" ]]; then
            ran_s="—"; exit_s="—"; file_s="(not run)"
        elif [[ "$rc" == "0" ]]; then
            ran_s="yes"; exit_s="0"; file_s="$outfile"
        else
            ran_s="FAIL"; exit_s="$rc"; file_s="$outfile"
        fi
        printf '%-12s %-7s %-7s %-8s %s\n' "$lang" "$built_s" "$ran_s" "$exit_s" "$file_s"
        if [[ "$built" != "true" || "$ran" != "true" || "$rc" != "0" ]]; then
            any_failed=true
        fi
    fi
done

echo ""
if [[ "$any_failed" == "true" ]]; then
    echo "⚠  One or more samples failed. Review the output files listed above."
    echo "   Auth failures: ensure az login / azd auth login is current."
    exit 1
else
    echo "✅ All selected samples completed successfully."
    exit 0
fi
