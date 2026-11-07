#!/usr/bin/env bash
# Бэкап БД и файлов портала (для сервера с docker compose).
# Пример cron (каждую ночь в 03:00 МСК):
#   0 3 * * * cd /opt/alliance-portal && ./scripts/backup.sh >> /var/log/alliance-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Бэкап БД…"
docker compose exec -T db pg_dump -U alliance -d alliance --format=custom --no-owner \
  > "$BACKUP_DIR/db_$STAMP.dump"

echo "[$(date -Is)] Бэкап файлов…"
docker compose run --rm --no-deps -v "$(realpath "$BACKUP_DIR"):/backup" --entrypoint sh api \
  -c "tar -czf /backup/files_$STAMP.tar.gz -C /data files"

echo "[$(date -Is)] Удаление бэкапов старше $KEEP_DAYS дней…"
find "$BACKUP_DIR" -type f \( -name 'db_*.dump' -o -name 'files_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

echo "[$(date -Is)] Готово: $BACKUP_DIR/db_$STAMP.dump, $BACKUP_DIR/files_$STAMP.tar.gz"
