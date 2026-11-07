import { computeActivity, icsDate, icsText, registrationOpen } from './events-logic';

describe('events-logic', () => {
  it('регистрация открыта до дедлайна (или до начала) и только для запланированных', () => {
    const e = { status: 'PLANNED' as const, startsAt: new Date('2026-12-12T07:00:00Z'), registrationDeadline: new Date('2026-12-08T21:00:00Z') };
    expect(registrationOpen(e, new Date('2026-12-01T00:00:00Z'))).toBe(true);
    expect(registrationOpen(e, new Date('2026-12-09T00:00:00Z'))).toBe(false);
    expect(registrationOpen({ ...e, registrationDeadline: null }, new Date('2026-12-10T00:00:00Z'))).toBe(true);
    expect(registrationOpen({ ...e, status: 'CANCELLED' }, new Date('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('рейтинг активности: среднее посещаемости и участия в голосованиях', () => {
    const rows = computeActivity({
      orgs: [
        { id: 'a', name: 'А' },
        { id: 'b', name: 'Б' },
        { id: 'c', name: 'В' },
      ],
      events: [
        { id: 'e1', audience: ['a', 'b', 'c'] },
        { id: 'e2', audience: ['a', 'b'] }, // заседание РГ: «В» не приглашена
      ],
      presence: [
        { eventId: 'e1', organizationId: 'a' },
        { eventId: 'e2', organizationId: 'a' },
        { eventId: 'e1', organizationId: 'b' },
      ],
      votes: [
        { eligible: ['a', 'b', 'c'], voted: ['a', 'c'] },
        { eligible: ['a', 'b', 'c'], voted: ['a', 'b', 'c'] },
      ],
    });
    expect(rows.map((r) => [r.name, r.score])).toEqual([
      ['А', 100],
      ['Б', 50], // мероприятия 1/2 = 50, голосования 1/2 = 50
      ['В', 50], // мероприятия 0/1 = 0, голосования 2/2 = 100
    ]);
    expect(rows[2].events).toEqual({ invited: 1, attended: 0, rate: 0 });
  });

  it('если мероприятий не было — рейтинг по голосованиям; если ничего — null и в конце списка', () => {
    const rows = computeActivity({
      orgs: [
        { id: 'a', name: 'А' },
        { id: 'z', name: 'Новая' },
      ],
      events: [],
      presence: [],
      votes: [{ eligible: ['a'], voted: ['a'] }],
    });
    expect(rows[0]).toMatchObject({ name: 'А', score: 100 });
    expect(rows[1]).toMatchObject({ name: 'Новая', score: null });
  });

  it('iCalendar: формат даты и экранирование', () => {
    expect(icsDate(new Date('2026-12-12T07:00:00.000Z'))).toBe('20261212T070000Z');
    expect(icsText('Москва, ул. Мира; зал 1\nвход со двора')).toBe('Москва\\, ул. Мира\\; зал 1\\nвход со двора');
  });
});
