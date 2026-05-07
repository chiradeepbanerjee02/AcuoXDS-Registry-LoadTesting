#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$TargetMachine = "HYL-771184",

    [Parameter(Mandatory = $false)]
    [string]$HostsPath = "C:\Windows\System32\drivers\etc\hosts"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$hostnamesToUpdate = @(
    "app-acuoregistry.hyland.com",
    "api-acuoregistry.hyland.com",
    "soap-acuoregistry.hyland.com"
)

Write-Host "Resolving IP for '$TargetMachine' using ping..."
$pingResult = Test-Connection -ComputerName $TargetMachine -Count 1 -ErrorAction Stop
$resolvedIp = $pingResult[0].IPV4Address.IPAddressToString

if (-not $resolvedIp) {
    throw "Could not resolve an IPv4 address for '$TargetMachine'."
}

Write-Host "Resolved IP: $resolvedIp"
Write-Host "Updating hosts file: $HostsPath"

$fileStream = $null
$reader = $null
$writer = $null

try {
    $fileStream = [System.IO.File]::Open(
        $HostsPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::Read
    )

    $reader = New-Object System.IO.StreamReader($fileStream, [System.Text.Encoding]::ASCII, $true, 1024, $true)
    $hostsContent = $reader.ReadToEnd()
    $reader.Dispose()
    $reader = $null

    $lines = $hostsContent -split "(`r`n|`n|`r)"
    $updatedHostnames = @{}
    foreach ($hostname in $hostnamesToUpdate) {
        $updatedHostnames[$hostname] = $false
    }

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if (-not $line -or $line -match "^\s*#") {
            continue
        }

        foreach ($hostname in $hostnamesToUpdate) {
            $escapedHostname = [Regex]::Escape($hostname)
            if ($line -match "\b$escapedHostname\b") {
                if ($line -notmatch "^(?<leading>\s*)(?<ip>\S+)(?<separator>\s+)(?<rest>.*)$") {
                    throw "Could not parse hosts entry for '$hostname': $line"
                }

                $lines[$i] = "$($matches.leading)$resolvedIp$($matches.separator)$($matches.rest)"
                $updatedHostnames[$hostname] = $true
            }
        }
    }

    $missingHostnames = @(
        $updatedHostnames.Keys | Where-Object { -not $updatedHostnames[$_] }
    )
    if ($missingHostnames.Count -gt 0) {
        throw "Did not find required host entries in hosts file: $($missingHostnames -join ', ')"
    }

    $fileStream.Position = 0
    $fileStream.SetLength(0)

    $writer = New-Object System.IO.StreamWriter($fileStream, [System.Text.Encoding]::ASCII, 1024, $true)
    $writer.NewLine = "`r`n"
    $writer.Write(($lines -join "`r`n"))
    $writer.Flush()

    Write-Host "Hosts file update completed."
}
finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $fileStream) { $fileStream.Dispose() }
}
