$ErrorActionPreference = 'Stop'

$serverPath = Join-Path $PSScriptRoot 'voice-probe\server.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { $null }
if (-not $nodePath) {
    throw 'Node.js was not found. Install Node.js or make node.exe available on PATH.'
}
if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "Voice server file is missing: $serverPath"
}

# Stop only an older instance of this clinic voice probe. Leave other services alone.
$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
foreach ($ownerId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId"
    if ($owner.Name -notmatch '^node(\.exe)?$' -or
        $owner.CommandLine -notmatch 'voice-probe[\\/]server\.mjs') {
        throw "Port 3000 is in use by another process (PID $ownerId). Close it before starting the clinic voice probe."
    }
    Write-Host "Stopping previous clinic voice server (PID $ownerId)..."
    Stop-Process -Id $ownerId -ErrorAction Stop
}
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3000 is still in use. Close the previous server tab and run this launcher again.'
}

function Read-WebhookUrl([string]$label) {
    $value = (Read-Host $label).Trim()
    $parsed = $null
    if (-not [uri]::TryCreate($value, [UriKind]::Absolute, [ref]$parsed) -or
        $parsed.Scheme -ne 'https' -or
        $parsed.AbsolutePath -notmatch '^/webhook/' -or
        $parsed.UserInfo) {
        throw "$label must be an HTTPS n8n Production URL containing /webhook/. Paste only the URL, then press Enter."
    }
    return $value
}

Write-Host 'Paste one value at each prompt, then press Enter. Nothing below is saved to a file.'
$availabilityUrl = Read-WebhookUrl 'Availability Production URL'
$bookingUrl = Read-WebhookUrl 'Booking Production URL'
if (([uri]$bookingUrl).AbsolutePath -notmatch '^/webhook/clinic/create-booking/?$') {
    throw 'Booking Production URL must end with /webhook/clinic/create-booking.'
}
if (([uri]$availabilityUrl).Host -ne ([uri]$bookingUrl).Host) {
    throw 'Availability and booking URLs must use the same n8n instance.'
}
$webhookToken = [System.Net.NetworkCredential]::new('', (Read-Host 'X-Clinic-Tool-Key value (hidden)' -AsSecureString)).Password
$openAiKey = [System.Net.NetworkCredential]::new('', (Read-Host 'OpenAI API key (hidden)' -AsSecureString)).Password
if ([string]::IsNullOrWhiteSpace($webhookToken) -or [string]::IsNullOrWhiteSpace($openAiKey)) {
    throw 'The webhook token and OpenAI API key must both be provided.'
}

try {
    $env:N8N_AVAILABILITY_URL = $availabilityUrl
    $env:N8N_BOOKING_URL = $bookingUrl
    $env:N8N_WEBHOOK_TOKEN = $webhookToken
    $env:OPENAI_API_KEY = $openAiKey
    Write-Host 'All four settings are loaded in this server process.'
    Write-Host 'After Voice probe ready appears, open http://127.0.0.1:3000/ and refresh the page.'
    & $nodePath $serverPath
    if ($LASTEXITCODE -ne 0) { throw "Voice server exited with code $LASTEXITCODE." }
} finally {
    Remove-Item Env:N8N_AVAILABILITY_URL, Env:N8N_BOOKING_URL, Env:N8N_WEBHOOK_TOKEN, Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    $webhookToken = $null
    $openAiKey = $null
}
