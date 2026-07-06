# Connect WAHA to WhatsApp (QR) or confirm already linked
$apiKey = "sokoni-local-dev-key"
$headers = @{ "X-Api-Key" = $apiKey; "Content-Type" = "application/json" }
$base = "http://localhost:3000"

$s = Invoke-RestMethod -Uri "$base/api/sessions/default" -Headers @{ "X-Api-Key" = $apiKey }

if ($s.status -eq "WORKING") {
  Write-Host "Already connected!"
  Write-Host "  Number: $($s.me.id)"
  Write-Host "  Name:   $($s.me.pushName)"
  Write-Host ""
  Write-Host "No QR needed. Next: run setup-waha-bot.ps1 then npm run dev in whatsapp-bot"
  exit 0
}

Write-Host "Stopping old session (if any)..."
try {
  Invoke-RestMethod -Uri "$base/api/sessions/default/stop" -Method POST -Headers $headers | Out-Null
} catch {}
Start-Sleep -Seconds 2

Write-Host "Starting session..."
Invoke-RestMethod -Uri "$base/api/sessions/default/start" -Method POST -Headers $headers | Out-Null

Write-Host "Waiting for QR (scan within 60 seconds)..."
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  $s = Invoke-RestMethod -Uri "$base/api/sessions/default" -Headers @{ "X-Api-Key" = $apiKey }
  Write-Host "  status: $($s.status)"
  if ($s.status -eq "WORKING") {
    Write-Host "Linked! Number: $($s.me.id)"
    exit 0
  }
  if ($s.status -eq "SCAN_QR_CODE") {
    $ready = $true
    break
  }
  if ($s.status -eq "FAILED") {
    Write-Host "Session failed. Run: docker compose -f docker-compose.waha.yml restart"
    exit 1
  }
}

if (-not $ready) {
  Write-Host "Timed out. Check: docker logs sokoni-waha-1 --tail 20"
  exit 1
}

$qrUrl = "$base/api/default/auth/qr?x-api-key=$apiKey"
Write-Host ""
Write-Host "Opening QR - scan NOW with +254117422428 (WhatsApp -> Linked devices):"
Start-Process $qrUrl
