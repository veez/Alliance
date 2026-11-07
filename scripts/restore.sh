#!/usr/bin/env bash
# Восстановление из бэкапа: ./scripts/restore.sh backups/db_2026-11-07_0300.dump [backups/files_2026-11-07_0300.tar.gz]
# ВНИМАНИЕ: перезаписывает текущие данные. Перед запуском остановите api: docker compose stop api
set -euo pipefail
DB_DUMP="${1:?Укажите файл db_*.dump}"
FILES_TAR="${2:-}"

read -r -p "Текущие данные портала будут заменены данными из $DB_DUMP. Продолжить? (да/нет) " answer
[ "$answer" = "да" ] || { echo "Отменено"; exit 1; }

docker compose exec -T db pg_restore -U alliance -d alliance --clean --if-exists --no-owner < "$DB_DUMP"
if [ -n "$FILES_TAR" ]; then
  docker compose run --rm --no-deps -v "$(realpath "$(dirname "$FILES_TAR")"):/backup" --entrypoint sh api \
    -c "rm -rf /data/files/* && tar -xzf /backup/$(basename "$FILES_TAR") -C /data"
fi
echo "Восстановлено. Запустите api: docker compose start api"
