import { computeDuesStatus, isOverdue, mskToday, reminderKind } from './dues-logic';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 2026-03-31 21:30 UTC = 2026-04-01 00:30 МСК
const atMsk = (iso: string) => new Date(iso);

describe('dues-logic', () => {
  it('сегодняшняя дата считается по Москве', () => {
    expect(mskToday(atMsk('2026-03-31T20:59:00Z'))).toBe('2026-03-31');
    expect(mskToday(atMsk('2026-03-31T21:01:00Z'))).toBe('2026-04-01');
  });

  it('просрочка — со следующего дня после срока плюс льготные дни', () => {
    expect(isOverdue(d('2026-03-31'), 0, atMsk('2026-03-31T12:00:00Z'))).toBe(false);
    expect(isOverdue(d('2026-03-31'), 0, atMsk('2026-03-31T21:30:00Z'))).toBe(true); // уже 1 апреля по МСК
    expect(isOverdue(d('2026-03-31'), 10, atMsk('2026-04-10T12:00:00Z'))).toBe(false);
    expect(isOverdue(d('2026-03-31'), 10, atMsk('2026-04-11T12:00:00Z'))).toBe(true);
  });

  describe('computeDuesStatus', () => {
    const base = { amountDue: '36000.00', dueDate: d('2026-12-01'), graceDays: 0, current: 'UNPAID' as const, now: atMsk('2026-11-07T10:00:00Z') };
    it('не оплачен / частично / оплачен', () => {
      expect(computeDuesStatus({ ...base, paidTotal: 0 })).toBe('UNPAID');
      expect(computeDuesStatus({ ...base, paidTotal: '10000' })).toBe('PARTIAL');
      expect(computeDuesStatus({ ...base, paidTotal: '36000' })).toBe('PAID');
      expect(computeDuesStatus({ ...base, paidTotal: '40000' })).toBe('PAID');
    });
    it('без ошибок округления копеек', () => {
      expect(computeDuesStatus({ ...base, amountDue: '0.3', paidTotal: 0.1 + 0.2 })).toBe('PAID');
    });
    it('после срока неоплаченный и частично оплаченный — просрочены', () => {
      const late = { ...base, now: atMsk('2026-12-05T10:00:00Z') };
      expect(computeDuesStatus({ ...late, paidTotal: 0 })).toBe('OVERDUE');
      expect(computeDuesStatus({ ...late, paidTotal: '1000' })).toBe('OVERDUE');
      expect(computeDuesStatus({ ...late, paidTotal: '36000' })).toBe('PAID');
    });
    it('освобождение не пересчитывается', () => {
      expect(computeDuesStatus({ ...base, paidTotal: 0, current: 'WAIVED', now: atMsk('2027-01-10T10:00:00Z') })).toBe('WAIVED');
    });
  });

  describe('reminderKind', () => {
    const r = (today: string, grace = 0) => reminderKind({ dueDate: d('2026-12-01'), graceDays: grace, daysBefore: [30, 7], now: atMsk(`${today}T09:00:00Z`) });
    it('до срока: пороги 30 и 7 дней', () => {
      expect(r('2026-10-15')).toBeNull();
      expect(r('2026-11-01')).toBe('before_30d');
      expect(r('2026-11-20')).toBe('before_30d');
      expect(r('2026-11-24')).toBe('before_7d');
      expect(r('2026-12-01')).toBe('before_7d');
    });
    it('после срока: в первый день просрочки и далее раз в 14 дней', () => {
      expect(r('2026-12-02')).toBe('overdue_0');
      expect(r('2026-12-15')).toBe('overdue_0');
      expect(r('2026-12-16')).toBe('overdue_1');
      expect(r('2026-12-05', 5)).toBeNull(); // льготный период
    });
  });
});
