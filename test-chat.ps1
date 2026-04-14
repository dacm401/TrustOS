$body = '{"messages":[{"role":"user","content":"今天好累啊"}]}'
$uri = 'http://localhost:3001/api/chat'
$headers = @{
    'Content-Type' = 'application/json'
    'X-User-Id' = 'test-user'
}

try {
    Write-Host "=== Test 1: 今天好累啊 ===" -ForegroundColor Green
    $response = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body
    Write-Host "Decision: $($response.decision | ConvertTo-Json -Depth 3)"
    Write-Host "Response: $($response.response.Substring(0, [Math]::Min(200, $response.response.Length)))"
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

$body2 = '{"messages":[{"role":"user","content":"Python和JavaScript有什么区别"}]}'
try {
    Write-Host "`n=== Test 2: Python和JavaScript有什么区别 ===" -ForegroundColor Green
    $response = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body2
    Write-Host "Decision: $($response.decision | ConvertTo-Json -Depth 3)"
    Write-Host "Response: $($response.response.Substring(0, [Math]::Min(200, $response.response.Length)))"
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

$body3 = '{"messages":[{"role":"user","content":"帮我把这句话翻译成英文：我今天很开心"}]}'
try {
    Write-Host "`n=== Test 3: 翻译 ===" -ForegroundColor Green
    $response = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body3
    Write-Host "Decision: $($response.decision | ConvertTo-Json -Depth 3)"
    Write-Host "Response: $($response.response.Substring(0, [Math]::Min(200, $response.response.Length)))"
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
