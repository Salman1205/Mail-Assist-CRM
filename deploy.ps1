$ServerIp = "13.62.104.165"
$User = "ubuntu"
$Key = "mailassist.pem"
$Artifact = "deploy.tar.gz"

Write-Host "Starting deployment to $ServerIp..."

# 1. Clean previous artifacts
if (Test-Path $Artifact) { Remove-Item $Artifact }

# 2. Compressing files
Write-Host "Compressing files..."
# Use tar to compress, excluding unnecessary folders
tar --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude="$Artifact" -czf $Artifact .

# 3. Upload to EC2
Write-Host "Uploading to EC2..."
scp -i $Key -o StrictHostKeyChecking=no $Artifact "${User}@${ServerIp}:~/$Artifact"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload failed! Check your SSH key ($Key) and IP address."
    exit 1
}

# 4. Remote commands (Unpack, Install, Build, Restart)
Write-Host "Running remote setup (this takes a moment)..."

# Using Single-Quoted Here-String to avoid PowerShell parsing issues
$RemoteScriptTemplate = @'
    set -e
    
    APP_DIR="~/mailassist"
    ARTIFACT="~/ARTIFACT_NAME"

    # Create directory
    mkdir -p $APP_DIR
    
    # Extract
    tar -xzf $ARTIFACT -C $APP_DIR
    
    # Cleanup artifact
    rm $ARTIFACT
    
    # Setup
    cd $APP_DIR
    
    # Install dependencies
    echo "Installing dependencies..."
    npm install --legacy-peer-deps
    
    # Build
    echo "Building application..."
    npm run build
    
    # Start/Restart with PM2
    echo "Restarting application..."
    if pm2 list | grep -q "mailassist"; then
        pm2 reload mailassist
    else
        pm2 start npm --name "mailassist" -- start
    fi
    
    pm2 save
'@

# Replace placeholder and fix line endings (remove \r for Linux compatibility)
$RemoteScript = $RemoteScriptTemplate.Replace("ARTIFACT_NAME", $Artifact).Replace("`r", "")

# Executing SSH
ssh -i $Key -o StrictHostKeyChecking=no "${User}@${ServerIp}" $RemoteScript

if ($LASTEXITCODE -ne 0) {
    Write-Error "Remote deployment failed!"
    exit 1
}

Write-Host "Deployment complete!"
