# generate-code-summary.ps1
# Generates a complete summary of all code files with their content

param(
    [string]$OutputFile = "code-summary.txt",
    [switch]$NoContent
)

$ExcludeDirs = @("node_modules", "dist", "bin", ".git", "uploads", "coverage", ".vite", "build", "tmp", "temp", "logs", ".venv")

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Generating Code Summary with Content" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Get-Location

$extensions = @(
    "*.go", "*.mod", "*.sum","*.py",
    "*.ts", "*.tsx", "*.js", "*.jsx",
    "*.json",
    "*.sql",
    "*.yaml", "*.yml",
    "*.md",
    "*.css", "*.scss",
    "*.html",
    "*.sh", "*.ps1",
    "Dockerfile*",
    "Makefile", ".env.example",
    "*.xml", "*.toml"
)

Write-Host "Scanning files..." -ForegroundColor Yellow
Write-Host ""

$allFiles = @()
foreach ($ext in $extensions) {
    $files = Get-ChildItem -Path $projectRoot -Recurse -Filter $ext -File -ErrorAction SilentlyContinue
    $allFiles += $files
}

$filteredFiles = @()
foreach ($file in $allFiles) {
    $exclude = $false
    foreach ($dir in $ExcludeDirs) {
        if ($file.FullName -match "\\$dir\\") {
            $exclude = $true
            break
        }
    }
    if (-not $exclude) {
        $filteredFiles += $file
    }
}

$groupedFiles = $filteredFiles | Group-Object { $_.DirectoryName } | Sort-Object Name

Write-Host "Found $($filteredFiles.Count) files in $($groupedFiles.Count) directories" -ForegroundColor Green
Write-Host ""

$summary = ""
$summary = $summary + "============================================" + "`n"
$summary = $summary + "  GUARANTEE MANAGEMENT SYSTEM - CODE SUMMARY" + "`n"
$summary = $summary + "============================================" + "`n"
$summary = $summary + "`n"
$summary = $summary + "Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")" + "`n"
$summary = $summary + "Project Root: $projectRoot" + "`n"
$summary = $summary + "Total Files: $($filteredFiles.Count)" + "`n"
$summary = $summary + "Total Directories: $($groupedFiles.Count)" + "`n"
$summary = $summary + "`n"

if ($NoContent) {
    $summary = $summary + "============================================" + "`n"
    $summary = $summary + "  FILE STRUCTURE (No Content)" + "`n"
    $summary = $summary + "============================================" + "`n"
    $summary = $summary + "`n"
    
    foreach ($group in $groupedFiles) {
        $relativePath = $group.Name -replace [regex]::Escape($projectRoot), ""
        if ($relativePath -eq "") { $relativePath = "/" }
        $summary = $summary + "[DIR] $relativePath" + "`n"
        $summary = $summary + "--------------------------------------------------" + "`n"
        
        foreach ($file in $group.Group | Sort-Object Name) {
            $fileName = $file.Name
            $fileSize = "{0:N0}" -f ($file.Length / 1KB)
            $summary = $summary + "  [FILE] $fileName ($fileSize KB)" + "`n"
        }
        $summary = $summary + "`n"
    }
} else {
    $summary = $summary + "============================================" + "`n"
    $summary = $summary + "  FILE CONTENTS" + "`n"
    $summary = $summary + "============================================" + "`n"
    $summary = $summary + "`n"
    
    $totalFiles = $filteredFiles.Count
    $currentFile = 0
    
    foreach ($group in $groupedFiles) {
        $relativePath = $group.Name -replace [regex]::Escape($projectRoot), ""
        if ($relativePath -eq "") { $relativePath = "/" }
        $summary = $summary + "============================================" + "`n"
        $summary = $summary + "DIRECTORY: $relativePath" + "`n"
        $summary = $summary + "============================================" + "`n"
        $summary = $summary + "`n"
        
        foreach ($file in $group.Group | Sort-Object Name) {
            $currentFile++
            $fileName = $file.Name
            $relativeFile = $file.FullName -replace [regex]::Escape($projectRoot), ""
            $fileSize = "{0:N0}" -f ($file.Length / 1KB)
            
            Write-Host "  Processing: $relativeFile ($currentFile of $totalFiles)" -ForegroundColor Gray
            
            $summary = $summary + "----------------------------------------" + "`n"
            $summary = $summary + "FILE: $fileName" + "`n"
            $summary = $summary + "Path: $relativeFile" + "`n"
            $summary = $summary + "Size: $fileSize KB" + "`n"
            $summary = $summary + "----------------------------------------" + "`n"
            
            try {
                $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
                if ($content) {
                    $lines = ($content -split "`n").Count
                    $summary = $summary + "Lines: $lines" + "`n"
                    $summary = $summary + "`n"
                    $summary = $summary + $content
                    $summary = $summary + "`n"
                } else {
                    $summary = $summary + "[Binary or empty file]" + "`n"
                }
            } catch {
                $summary = $summary + "[Error reading file: $_]" + "`n"
            }
            $summary = $summary + "`n"
        }
    }
}

$summary = $summary + "============================================" + "`n"
$summary = $summary + "  STATISTICS" + "`n"
$summary = $summary + "============================================" + "`n"
$summary = $summary + "`n"

$extensionCount = @{}
foreach ($file in $filteredFiles) {
    $ext = $file.Extension
    if ([string]::IsNullOrEmpty($ext)) { $ext = "(no extension)" }
    if ($extensionCount.ContainsKey($ext)) {
        $extensionCount[$ext]++
    } else {
        $extensionCount[$ext] = 1
    }
}

$summary = $summary + "File Types:" + "`n"
foreach ($ext in ($extensionCount.Keys | Sort-Object)) {
    $count = $extensionCount[$ext]
    $summary = $summary + "  $ext : $count files" + "`n"
}

$summary = $summary + "`n"

$languageCount = @{
    "Go" = 0
    "TypeScript" = 0
    "JavaScript" = 0
    "SQL" = 0
    "JSON" = 0
    "YAML" = 0
    "Markdown" = 0
    "CSS" = 0
    "HTML" = 0
    "Shell" = 0
    "PowerShell" = 0
    "Docker" = 0
    "Make" = 0
    "Other" = 0
}

foreach ($file in $filteredFiles) {
    $ext = $file.Extension.ToLower()
    switch ($ext) {
        ".go" { $languageCount["Go"]++ }
        ".ts" { $languageCount["TypeScript"]++ }
        ".tsx" { $languageCount["TypeScript"]++ }
        ".js" { $languageCount["JavaScript"]++ }
        ".jsx" { $languageCount["JavaScript"]++ }
        ".sql" { $languageCount["SQL"]++ }
        ".json" { $languageCount["JSON"]++ }
        ".yaml" { $languageCount["YAML"]++ }
        ".yml" { $languageCount["YAML"]++ }
        ".md" { $languageCount["Markdown"]++ }
        ".css" { $languageCount["CSS"]++ }
        ".scss" { $languageCount["CSS"]++ }
        ".html" { $languageCount["HTML"]++ }
        ".sh" { $languageCount["Shell"]++ }
        ".ps1" { $languageCount["PowerShell"]++ }
        default {
            if ($file.Name -match "Dockerfile") {
                $languageCount["Docker"]++
            } elseif ($file.Name -match "Makefile") {
                $languageCount["Make"]++
            } else {
                $languageCount["Other"]++
            }
        }
    }
}

$summary = $summary + "Languages:" + "`n"
foreach ($lang in ($languageCount.Keys | Where-Object { $languageCount[$_] -gt 0 } | Sort-Object)) {
    $count = $languageCount[$lang]
    $summary = $summary + "  $lang : $count files" + "`n"
}

$summary | Out-File -FilePath $OutputFile -Encoding UTF8

Write-Host ""
Write-Host "[OK] Code summary generated!" -ForegroundColor Green
Write-Host "Output file: $OutputFile" -ForegroundColor Green
Write-Host ""
Write-Host "File size: $([math]::Round((Get-Item $OutputFile).Length / 1MB, 2)) MB" -ForegroundColor Gray
Write-Host "Total files: $($filteredFiles.Count)" -ForegroundColor Gray
Write-Host "Total directories: $($groupedFiles.Count)" -ForegroundColor Gray

if ($NoContent) {
    Write-Host ""
    Write-Host "To include file content, run without -NoContent:" -ForegroundColor Yellow
    Write-Host "  .\generate-code-summary.ps1" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "To only show structure (without content), run:" -ForegroundColor Yellow
    Write-Host "  .\generate-code-summary.ps1 -NoContent" -ForegroundColor Gray
}

# Open the file
Write-Host ""
$open = Read-Host "Open the summary file? (y/n)"
if ($open -eq "y") {
    Start-Process $OutputFile
}