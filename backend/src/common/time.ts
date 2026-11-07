export const MSK = 'Europe/Moscow';

/** «07.11.2026, 20:42» по Москве. */
export function fmtMsk(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', { timeZone: MSK, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Текущий год по Москве. */
export function mskYear(d = new Date()): number {
  return Number(d.toLocaleString('en-US', { timeZone: MSK, year: 'numeric' }));
}
