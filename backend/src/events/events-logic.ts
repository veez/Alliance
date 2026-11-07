/**
 * Чистая логика мероприятий: окно регистрации и рейтинг активности. Покрыта events-logic.spec.ts.
 *
 * Рейтинг активности организации (0–100):
 *   посещаемость = доля состоявшихся мероприятий, где был кто-то из организации (из тех, куда она приглашалась);
 *   голосования  = доля завершённых голосований, где организация проголосовала (из тех, где имела право голоса);
 *   рейтинг      = среднее двух долей; если одной из них нет (не было мероприятий/голосований) — берётся другая.
 */
import { EventStatus } from '@prisma/client';

export function registrationOpen(e: { status: EventStatus; startsAt: Date; registrationDeadline: Date | null }, now = new Date()): boolean {
  if (e.status !== EventStatus.PLANNED) return false;
  return now < (e.registrationDeadline ?? e.startsAt);
}

export interface ActivityInput {
  orgs: Array<{ id: string; name: string }>;
  /** Состоявшиеся мероприятия и организации, приглашённые на них */
  events: Array<{ id: string; audience: string[] }>;
  /** Пары «мероприятие — организация», где отмечено присутствие */
  presence: Array<{ eventId: string; organizationId: string }>;
  /** Завершённые голосования: кто имел право голоса и кто проголосовал */
  votes: Array<{ eligible: string[]; voted: string[] }>;
}

export interface ActivityRow {
  organizationId: string;
  name: string;
  events: { invited: number; attended: number; rate: number | null };
  votes: { eligible: number; voted: number; rate: number | null };
  score: number | null;
}

const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export function computeActivity(input: ActivityInput): ActivityRow[] {
  const present = new Set(input.presence.map((p) => `${p.eventId}:${p.organizationId}`));
  const rows = input.orgs.map((o): ActivityRow => {
    const invited = input.events.filter((e) => e.audience.includes(o.id));
    const attended = invited.filter((e) => present.has(`${e.id}:${o.id}`)).length;
    const eligible = input.votes.filter((v) => v.eligible.includes(o.id));
    const voted = eligible.filter((v) => v.voted.includes(o.id)).length;
    const er = rate(attended, invited.length);
    const vr = rate(voted, eligible.length);
    const parts = [er, vr].filter((x): x is number => x !== null);
    return {
      organizationId: o.id,
      name: o.name,
      events: { invited: invited.length, attended, rate: er },
      votes: { eligible: eligible.length, voted, rate: vr },
      score: parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 : null,
    };
  });
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, 'ru'));
}

/** Формат даты для iCalendar (UTC): 20261212T070000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Экранирование текста iCalendar (RFC 5545) */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
