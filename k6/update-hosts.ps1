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

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = New-Object System.Security.Principal.WindowsPrincipal($currentIdentity)
$isElevated = $currentPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isElevated) {
    throw "This script must run with administrator privileges to update '$HostsPath'."
}

$hostnamesToUpdate = @(
    "app-acuoregistry.hyland.com",
    "api-acuoregistry.hyland.com",
    "soap-acuoregistry.hyland.com"
)

Write-Host "Resolving IP for '$TargetMachine' using Test-Connection..."
$pingResult = Test-Connection -ComputerName $TargetMachine -Count 1 -ErrorAction Stop
$firstPingResult = @($pingResult)[0]
$resolvedIp = $null

if (($firstPingResult.PSObject.Properties.Name -contains "IPV4Address") -and $firstPingResult.IPV4Address) {
    $resolvedIp = $firstPingResult.IPV4Address.IPAddressToString
} elseif (($firstPingResult.PSObject.Properties.Name -contains "Address") -and $firstPingResult.Address) {
    $resolvedIp = [string]$firstPingResult.Address
}

if (-not $resolvedIp) {
    throw "Could not resolve an IPv4 address for '$TargetMachine'."
}

Write-Host "Resolved IP: $resolvedIp"
Write-Host "Updating hosts file: $HostsPath"

$fileStream = $null
$reader = $null
$writer = $null
$fileEncoding = [System.Text.Encoding]::UTF8

try {
    $fileStream = [System.IO.File]::Open(
        $HostsPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )

    # Constructor args: encoding = UTF8, detect BOM = $true, buffer size = 1024, leave stream open = $true.
    $reader = New-Object System.IO.StreamReader($fileStream, [System.Text.Encoding]::UTF8, $true, 1024, $true)
    $hostsContent = $reader.ReadToEnd()
    $fileEncoding = $reader.CurrentEncoding
    $reader.Dispose()
    $reader = $null

    $lines = $hostsContent -split "`r?`n"
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

    $lastIndex = $lines.Count - 1
    while ($lastIndex -ge 0 -and [string]::IsNullOrWhiteSpace($lines[$lastIndex])) {
        $lastIndex--
    }
    if ($lastIndex -ge 0) {
        $lines = $lines[0..$lastIndex]
    } else {
        $lines = @()
    }

    $fileStream.Position = 0
    $fileStream.SetLength(0)

    # Constructor args: encoding = current file encoding, buffer size = 1024, leave stream open = $true.
    $writer = New-Object System.IO.StreamWriter($fileStream, $fileEncoding, 1024, $true)
    $writer.NewLine = "`r`n"
    $writer.Write(($lines -join "`r`n"))
    $writer.Write("`r`n")
    $writer.Flush()

    Write-Host "Hosts file update completed."
}
finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $fileStream) { $fileStream.Dispose() }
}
