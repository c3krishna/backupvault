#!/bin/bash
# BackupVault Complete Deployment Script
# Run as root from /var/www/backupvault/

set -e
echo "================================================"
echo " BackupVault Deployment"
echo "================================================"

BACKEND=/var/www/backupvault/backend
FRONTEND=/var/www/backupvault/frontend

# 1. System dependencies
echo "[1] Installing system dependencies..."
pip3 install awscli --break-system-packages 2>/dev/null || true

# 2. Backend files
echo "[2] Deploying backend..."
mkdir -p $BACKEND/src/{routes,services,db}
cp backend/src/server.js            $BACKEND/src/
cp backend/src/db/connection.js     $BACKEND/src/db/
cp backend/src/routes/api.js        $BACKEND/src/routes/
cp backend/src/routes/auth.js       $BACKEND/src/routes/
cp backend/src/routes/fs.js         $BACKEND/src/routes/
cp backend/src/routes/sftp.js       $BACKEND/src/routes/
cp backend/src/routes/secondaryfs.js $BACKEND/src/routes/
cp backend/src/routes/infrastructure.js $BACKEND/src/routes/
cp backend/src/services/wsManager.js     $BACKEND/src/services/
cp backend/src/services/backupEngine.js  $BACKEND/src/services/
cp backend/src/services/scheduler.js     $BACKEND/src/services/
cp backend/src/services/storageMonitor.js $BACKEND/src/services/
cp backend/src/services/s3Service.js      $BACKEND/src/services/
cp backend/src/services/remoteSync.js     $BACKEND/src/services/
# Only copy .env if it doesn't exist (preserve existing credentials)
[ -f "$BACKEND/.env" ] || cp backend/.env $BACKEND/.env

# 3. npm install
echo "[3] Installing backend npm packages..."
cd $BACKEND && npm install

# 4. Ensure directories exist
mkdir -p /var/backups/backupvault /primary-db-backup /secondary-db-backup

# 5. Frontend
echo "[4] Building frontend..."
cp -r frontend/src     $FRONTEND/
cp frontend/public/index.html $FRONTEND/public/
cp frontend/package.json $FRONTEND/
cd $FRONTEND && npm install && npm run build

# 6. Restart backend
echo "[5] Restarting backend..."
cd $BACKEND
pm2 restart backupvault 2>/dev/null || pm2 start src/server.js --name backupvault
sleep 3
pm2 logs backupvault --lines 15 --nostream

echo ""
echo "================================================"
echo " Deployment complete!"
echo " Frontend: https://backupvault.worktual.tech"
echo " Health:   https://backupvault.worktual.tech/health"
echo "================================================"
