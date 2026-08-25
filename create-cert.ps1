# create-cert.ps1 - Fixed version
$ip = "192.168.100.217"

Write-Host "Creating self-signed certificate for $ip..." -ForegroundColor Cyan

# Create certificate
$cert = New-SelfSignedCertificate -DnsName $ip -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddDays(365)

# Export to PFX (contains both cert and private key)
$password = ConvertTo-SecureString -String "password" -Force -AsPlainText
$pfxPath = "$PWD\certificate.pfx"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password

# Export certificate as PEM
$certPath = "$PWD\cert.pem"
$keyPath = "$PWD\key.pem"

# Export certificate (public key) to PEM
$certBytes = [System.Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks')
@"
-----BEGIN CERTIFICATE-----
$certBytes
-----END CERTIFICATE-----
"@ | Out-File -FilePath $certPath -Encoding ASCII

# Export private key using PFX export
# Load the PFX to get both cert and private key
$pfxCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
$pfxCert.Import($pfxPath, $password, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)

# Get private key
$rsa = $pfxCert.PrivateKey
$keyBytes = $rsa.ExportPkcs8PrivateKey()
$keyBase64 = [System.Convert]::ToBase64String($keyBytes, 'InsertLineBreaks')

@"
-----BEGIN PRIVATE KEY-----
$keyBase64
-----END PRIVATE KEY-----
"@ | Out-File -FilePath $keyPath -Encoding ASCII

Write-Host ""
Write-Host "✅ Certificate created successfully!" -ForegroundColor Green
Write-Host "Certificate: $certPath" -ForegroundColor Yellow
Write-Host "Private Key: $keyPath" -ForegroundColor Yellow
Write-Host "PFX file: $pfxPath" -ForegroundColor Yellow
Write-Host ""

# Ask if user wants to trust the certificate
$trust = Read-Host "Do you want to trust this certificate? (y/n)"
if ($trust -eq "y") {
    Write-Host "Installing certificate to Trusted Root store..." -ForegroundColor Cyan
    certutil -addstore Root "$certPath"
    Write-Host "✅ Certificate trusted!" -ForegroundColor Green
}

Write-Host ""
Write-Host "To use this certificate in Vite, update vite.config.ts:" -ForegroundColor Cyan
Write-Host "  https: {" -ForegroundColor Gray
Write-Host "    key: fs.readFileSync('./key.pem')," -ForegroundColor Gray
Write-Host "    cert: fs.readFileSync('./cert.pem')," -ForegroundColor Gray
Write-Host "  }" -ForegroundColor Gray