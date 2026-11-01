#!/bin/sh
# Dump the whole Trade Gang database (trades, journal, AI history, screenshots) to ./backups.
set -e
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
docker exec trade-gang-mongo mongodump --db tradegang --archive --gzip > "backups/tradegang-$stamp.archive.gz"
echo "Saved backups/tradegang-$stamp.archive.gz"
echo "Restore with: docker exec -i trade-gang-mongo mongorestore --archive --gzip --drop < backups/tradegang-$stamp.archive.gz"
