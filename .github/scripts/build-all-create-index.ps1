#!/usr/bin/env pwsh

# PowerShell build script for all create-index samples
# Usage: .\build-all-create-index.ps1 [-Language <language>]

param(
    [ValidateSet("Go", "Python", "Java", "DotNet", "TypeScript", "All")]
    [string]$Language = "All"
)

function Write-Header {
    param([string]$Message)
    Write-Host "`n$('='*50)" -ForegroundColor Yellow
    Write-Host $Message -ForegroundColor Yellow
    Write-Host $('='*50) -ForegroundColor Yellow
}

function Build-Go {
    Write-Header "Building Go Sample"
    $goDir = "nosql-create-index-go"
    
    if (-not (Test-Path $goDir)) {
        Write-Host "❌ Error: $goDir directory not found" -ForegroundColor Red
        return $false
    }
    
    Push-Location $goDir
    try {
        Write-Host "📦 Downloading Go dependencies..." -ForegroundColor Cyan
        go mod download
        
        Write-Host "🏗️  Building application..." -ForegroundColor Cyan
        go build -o dist/app ./main.go
        
        Write-Host "✅ Go sample built successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Go build failed: $_" -ForegroundColor Red
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-Python {
    Write-Header "Building Python Sample"
    $pythonDir = "nosql-create-index-python"
    
    if (-not (Test-Path $pythonDir)) {
        Write-Host "❌ Error: $pythonDir directory not found" -ForegroundColor Red
        return $false
    }
    
    Push-Location $pythonDir
    try {
        if (-not (Test-Path "requirements.txt")) {
            Write-Host "❌ Error: requirements.txt not found" -ForegroundColor Red
            return $false
        }
        
        Write-Host "📦 Creating Python virtual environment..." -ForegroundColor Cyan
        if (-not (Test-Path ".venv")) {
            python -m venv .venv
        }
        
        Write-Host "📦 Installing Python dependencies..." -ForegroundColor Cyan
        & ".\venv\Scripts\pip.exe" install -q -r requirements.txt
        
        Write-Host "🏗️  Checking Python syntax..." -ForegroundColor Cyan
        python -m py_compile src/index.py src/data_plane.py
        
        Write-Host "✅ Python sample dependencies installed" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Python build failed: $_" -ForegroundColor Red
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-Java {
    Write-Header "Building Java Sample"
    $javaDir = "nosql-create-index-java"
    
    if (-not (Test-Path $javaDir)) {
        Write-Host "❌ Error: $javaDir directory not found" -ForegroundColor Red
        return $false
    }
    
    if (-not (Get-Command mvn -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Error: Maven is not installed" -ForegroundColor Red
        return $false
    }
    
    Push-Location $javaDir
    try {
        Write-Host "📦 Building with Maven..." -ForegroundColor Cyan
        mvn clean compile -q
        
        Write-Host "✅ Java sample compiled successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ Java build failed: $_" -ForegroundColor Red
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-DotNet {
    Write-Header "Building .NET Sample"
    $dotnetDir = "nosql-create-index-dotnet"
    
    if (-not (Test-Path $dotnetDir)) {
        Write-Host "❌ Error: $dotnetDir directory not found" -ForegroundColor Red
        return $false
    }
    
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Error: .NET SDK is not installed" -ForegroundColor Red
        return $false
    }
    
    Push-Location $dotnetDir
    try {
        Write-Host "📦 Restoring .NET dependencies..." -ForegroundColor Cyan
        dotnet restore --nologo -v quiet
        
        Write-Host "🏗️  Building .NET project..." -ForegroundColor Cyan
        dotnet build --configuration Release --no-restore --nologo
        
        Write-Host "✅ .NET sample built successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ .NET build failed: $_" -ForegroundColor Red
        return $false
    }
    finally {
        Pop-Location
    }
}

function Build-TypeScript {
    Write-Header "Building TypeScript Sample"
    $tsDir = "nosql-create-index-typescript"
    
    if (-not (Test-Path $tsDir)) {
        Write-Host "❌ Error: $tsDir directory not found" -ForegroundColor Red
        return $false
    }
    
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Error: Node.js is not installed" -ForegroundColor Red
        return $false
    }
    
    Push-Location $tsDir
    try {
        Write-Host "📦 Installing Node.js dependencies..." -ForegroundColor Cyan
        npm install --silent
        
        Write-Host "🏗️  Building TypeScript..." -ForegroundColor Cyan
        npm run build
        
        Write-Host "✅ TypeScript sample built successfully" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ TypeScript build failed: $_" -ForegroundColor Red
        return $false
    }
    finally {
        Pop-Location
    }
}

# Main execution
$results = @{}

if ($Language -eq "All" -or $Language -eq "Go") {
    $results["Go"] = Build-Go
}

if ($Language -eq "All" -or $Language -eq "Python") {
    $results["Python"] = Build-Python
}

if ($Language -eq "All" -or $Language -eq "Java") {
    $results["Java"] = Build-Java
}

if ($Language -eq "All" -or $Language -eq "DotNet") {
    $results["DotNet"] = Build-DotNet
}

if ($Language -eq "All" -or $Language -eq "TypeScript") {
    $results["TypeScript"] = Build-TypeScript
}

# Summary
Write-Header "Build Summary"
foreach ($lang in $results.Keys) {
    if ($results[$lang]) {
        Write-Host "✅ $lang" -ForegroundColor Green
    }
    else {
        Write-Host "❌ $lang" -ForegroundColor Red
    }
}
