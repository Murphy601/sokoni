# Point WAHA at the Sokoni bot on your PC (no ngrok needed for local testing)
$apiKey = "sokoni-local-dev-key"
$headers = @{ "X-Api-Key" = $apiKey; "Content-Type" = "application/json" }
$base = "http://localhost:3000"
$webhookUrl = "http://host.docker.internal:3001/webhook"

# NOTE: we subscribe to "message.any" (not just "message") so the bot also
# receives the store owner's OWN outgoing messages (admin commands, broadcasts,
# quote-replies). The admin shares the same WhatsApp account as the bot, so
# those actions are "fromMe" and only arrive via message.any.
$body = @{
  config = @{
    webhooks = @(
      @{
        url = $webhookUrl
        events = @("message.any")
      }
    )
  }
} | ConvertTo-Json -Depth 5

Write-Host "Setting WAHA webhook -> $webhookUrl"
Invoke-RestMethod -Uri "$base/api/sessions/default" -Method PUT -Headers $headers -Body $body | Out-Null

$s = Invoke-RestMethod -Uri "$base/api/sessions/default" -Headers @{ "X-Api-Key" = $apiKey }
Write-Host "Session status: $($s.status)"
Write-Host ""
Write-Host "Now start the bot in another terminal:"
Write-Host "  cd whatsapp-bot"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Then message +254117422428 from another phone: menu"
