$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 4173)

try {
    $listener.Start()
    Write-Host 'MetralhaHub está rodando em http://localhost:4173/' -ForegroundColor Green
    Write-Host 'Deixe esta janela aberta enquanto usa o app. Pressione Ctrl+C para encerrar.'

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while ($null -ne ($header = $reader.ReadLine()) -and $header.Length -gt 0) { }

            $status = '200 OK'
            $relativePath = 'index.html'
            if ($requestLine -match '^GET\s+(\S+)\s+HTTP/') {
                $urlPath = ([Uri]::new([Uri]'http://localhost', $Matches[1])).AbsolutePath
                $relativePath = [Uri]::UnescapeDataString($urlPath.TrimStart('/'))
                if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
            } else { $status = '405 Method Not Allowed' }

            $filePath = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
            if (-not $filePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                $status = '403 Forbidden'; $bytes = [Text.Encoding]::UTF8.GetBytes('Forbidden'); $mime = 'text/plain; charset=utf-8'
            } elseif (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                $status = '404 Not Found'; $bytes = [Text.Encoding]::UTF8.GetBytes('Not found'); $mime = 'text/plain; charset=utf-8'
            } else {
                $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
                $mime = switch ($extension) {
                    '.html' { 'text/html; charset=utf-8' }
                    '.css' { 'text/css; charset=utf-8' }
                    '.js' { 'text/javascript; charset=utf-8' }
                    '.json' { 'application/json; charset=utf-8' }
                    '.webmanifest' { 'application/manifest+json; charset=utf-8' }
                    '.svg' { 'image/svg+xml' }
                    default { 'application/octet-stream' }
                }
                $bytes = [IO.File]::ReadAllBytes($filePath)
            }

            $headerBytes = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n")
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($bytes, 0, $bytes.Length)
        } catch {
            Write-Host "Falha ao atender uma requisição: $_" -ForegroundColor Yellow
        } finally {
            if ($client) { $client.Close() }
        }
    }
} finally {
    $listener.Stop()
}
