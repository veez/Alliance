/**
 * Чистая логика взносов: статус, просрочка, сроки напоминаний. Покрыта dues-logic.spec.ts.
 *
 * Статус:
 *  - WAIVED  — освобождение, выставляется вручную и не пересчитывается;
 *  - PAID    — оплачено не меньше начисленного;
 *  - OVERDUE — срок (дата + льготные дни) прошёл, оплачено меньше начисленного;
 *  - PARTIAL — срок не прошёл, оплачена часть;
 *  - UNPAID  — срок не прошёл, оплат нет.
 * Даты сравниваются по московскому календарю.
 */
import { DuesStatus } from '@prisma/client';
import { MSK } from '../common/time';

/** Сегодняшняя дата по Москве как 'YYYY-MM-DD'. */
export function mskToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: MSK });
}

/** Дата из колонки @db.Date (полночь UTC) → 'YYYY-MM-DD'. */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateOnly(d);
}

/** Число дней от a до b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function isOverdue(dueDate: Date, graceDays: number, now = new Date()): boolean {
  return mskToday(now) > addDays(dateOnly(dueDate), graceDays);
}

/** Сумма в копейках — без ошибок округления. */
export const toKop = (v: { toString(): string } | number | string): number => Math.round(Number(v.toString()) * 100);

export function computeDuesStatus(input: {
  amountDue: { toString(): string } | number;
  paidTotal: { toString(): string } | number;
  dueDate: Date;
  graceDays: number;
  current: DuesStatus;
  now?: Date;
}): DuesStatus {
  if (input.current === DuesStatus.WAIVED) return DuesStatus.WAIVED;
  const due = toKop(input.amountDue);
  const paid = toKop(input.paidTotal);
  if (paid >= due) return DuesStatus.PAID;
  if (isOverdue(input.dueDate, input.graceDays, input.now)) return DuesStatus.OVERDUE;
  return paid > 0 ? DuesStatus.PARTIAL : DuesStatus.UNPAID;
}

/**
 * Какое напоминание положено сегодня (или null).
 * До срока — за N дней (из настроек), после срока — в день просрочки и далее раз в 14 дней.
 * Ключ (kind) уникален: повторно одно и то же напоминание не отправляется.
 */
export function reminderKind(input: { dueDate: Date; graceDays: number; daysBefore: number[]; now?: Date }): string | null {
  const today = mskToday(input.now);
  const due = dateOnly(input.dueDate);
  const left = daysBetween(today, due);
  if (left >= 0) {
    // Ближайший порог, который уже наступил (например, 30 → 7)
    const hit = [...input.daysBefore].sort((a, b) => a - b).find((d) => left <= d);
    return hit !== undefined ? `before_${hit}d` : null;
  }
  const overdueStart = addDays(due, input.graceDays + 1);
  const since = daysBetween(overdueStart, today);
  if (since < 0) return null;
  return `overdue_${Math.floor(since / 14)}`;
}
