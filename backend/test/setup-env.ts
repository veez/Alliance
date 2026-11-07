// Выполняется до импорта модулей приложения: тесты работают с временной БД прогона (см. global-setup).
import { config } from 'dotenv';

config();
process.env.NODE_ENV = 'test';
const url = process.env.TEST_RUN_DATABASE_URL;
if (!url) throw new Error('Временная тестовая БД не создана (global-setup)');
process.env.DATABASE_URL = url;
