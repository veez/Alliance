import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { PlanStatus, TaskStatus, WgRole, EventFormat, EventStatus, EventType, PresenceStatus, ProtocolStatus, RegistrationStatus, AgreementStatus, DuesStatus, OrganizationStatus, QuestionFormat, SystemRole, UserStatus, VoteEligibility, VoteScenario, VoteStatus } from './api/types';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ru');

export const TZ = 'Europe/Moscow';

export const fmtDateTime = (v?: string | null) => (v ? dayjs(v).tz(TZ).format('DD.MM.YYYY HH:mm') : '—');
export const fmtDate = (v?: string | null) => (v ? dayjs(v).tz(TZ).format('DD.MM.YYYY') : '—');

export const ORG_STATUS: Record<OrganizationStatus, { label: string; color: string }> = {
  MEMBER: { label: 'Член Альянса', color: 'teal' },
  CANDIDATE: { label: 'Кандидат', color: 'yellow' },
  PARTNER: { label: 'Партнёр', color: 'grape' },
  SUSPENDED: { label: 'Членство приостановлено', color: 'orange' },
  EXITED: { label: 'Вышла из Альянса', color: 'gray' },
};

export const SYSTEM_ROLE: Record<SystemRole, string> = {
  ADMIN: 'Администратор',
  SECRETARY: 'Секретарь Альянса',
  USER: 'Пользователь',
};

export const USER_STATUS: Record<UserStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Активен', color: 'teal' },
  INVITED: { label: 'Приглашён', color: 'blue' },
  BLOCKED: { label: 'Заблокирован', color: 'red' },
};

export const AUDIT_ACTION: Record<string, string> = {
  'auth.login_failed': 'Неудачная попытка входа',
  'auth.locked': 'Блокировка после неудачных попыток',
  'auth.2fa_failed': 'Неверный код 2FA',
  'auth.2fa_enabled': 'Включена 2FA',
  'auth.2fa_disabled': 'Отключена 2FA',
  'auth.refresh_reuse': 'Повторное использование токена (сессии отозваны)',
  'auth.invitation_accepted': 'Принято приглашение',
  'auth.password_changed': 'Изменён пароль',
  'auth.password_reset_requested': 'Запрошен сброс пароля',
  'auth.password_reset': 'Пароль сброшен',
  'user.invited': 'Приглашён пользователь',
  'user.invitation_resent': 'Приглашение отправлено повторно',
  'user.updated': 'Изменён пользователь',
  'user.2fa_reset': 'Сброшена 2FA пользователя',
  'user.unlocked': 'Пользователь разблокирован',
  'user.profile_updated': 'Изменён профиль',
  'organization.created': 'Создана организация',
  'organization.updated': 'Изменена организация',
  'organization.status_changed': 'Изменён статус организации',
  'organization.logo_updated': 'Обновлён логотип',
  'employee.created': 'Добавлен сотрудник',
  'employee.updated': 'Изменён сотрудник',
  'employee.deleted': 'Удалён сотрудник',
};

export const ENTITY_TYPE: Record<string, string> = {
  User: 'Пользователь',
  Organization: 'Организация',
  Employee: 'Сотрудник',
  Vote: 'Голосование',
};

Object.assign(AUDIT_ACTION, {
  'vote.created': 'Создано голосование',
  'vote.updated': 'Изменён черновик голосования',
  'vote.published': 'Опубликовано голосование',
  'vote.cast': 'Подан голос',
  'vote.recast': 'Изменён голос',
  'vote.extended': 'Продлено голосование',
  'vote.closed': 'Голосование завершено досрочно',
  'vote.closed_by_deadline': 'Голосование завершено по сроку',
  'vote.cancelled': 'Голосование отменено',
  'vote.attachment_added': 'Приложен документ к голосованию',
  'vote.attachment_removed': 'Удалён документ из голосования',
});

export const VOTE_SCENARIO: Record<VoteScenario, string> = {
  DOCUMENT_APPROVAL: 'Согласование документа',
  EVENT_PARTICIPATION: 'Участие в мероприятии',
  ADMISSION: 'Приём в члены',
  ELECTION: 'Выборы',
  OTHER: 'Иное',
};

export const VOTE_STATUS: Record<VoteStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Черновик', color: 'gray' },
  ACTIVE: { label: 'Идёт голосование', color: 'blue' },
  CLOSED: { label: 'Завершено', color: 'teal' },
  CANCELLED: { label: 'Отменено', color: 'red' },
};

export const VOTE_ELIGIBILITY: Record<VoteEligibility, string> = {
  ALL_MEMBERS: 'Все члены Альянса',
  LIST: 'Выбранные члены Альянса',
  PAID_DUES: 'Члены с оплаченным взносом за год',
};

export const QUESTION_FORMAT: Record<QuestionFormat, string> = {
  YES_NO_ABSTAIN: 'За / против / воздержался',
  SINGLE: 'Один вариант',
  MULTIPLE: 'Несколько вариантов',
  RANKING: 'Рейтинг (расставить по местам)',
};

Object.assign(AUDIT_ACTION, {
  'dues.settings_saved': 'Изменены настройки взноса за год',
  'dues.accrued': 'Начислены взносы',
  'dues.updated': 'Изменён взнос',
  'dues.payment_added': 'Отмечен платёж',
  'dues.payment_removed': 'Удалён платёж',
  'dues.document_added': 'Приложен документ к взносу',
  'dues.document_removed': 'Удалён документ взноса',
  'dues.reminders_sent': 'Разосланы напоминания должникам',
  'agreement.created': 'Создан договор пожертвования',
  'agreement.updated': 'Изменён договор пожертвования',
  'agreement.document_added': 'Приложен файл договора',
  'agreement.document_removed': 'Удалён файл договора',
});
Object.assign(ENTITY_TYPE, { Dues: 'Взнос', DuesSettings: 'Настройки взноса', Agreement: 'Договор пожертвования' });

export const DUES_STATUS: Record<DuesStatus, { label: string; color: string }> = {
  PAID: { label: 'Оплачен', color: 'teal' },
  PARTIAL: { label: 'Оплачен частично', color: 'yellow' },
  UNPAID: { label: 'Не оплачен', color: 'gray' },
  OVERDUE: { label: 'Просрочен', color: 'red' },
  WAIVED: { label: 'Освобождён', color: 'grape' },
};

export const AGREEMENT_STATUS: Record<AgreementStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Проект', color: 'gray' },
  SIGNED: { label: 'Подписан', color: 'teal' },
  TERMINATED: { label: 'Расторгнут', color: 'red' },
};

export const DOC_TYPE: Record<string, string> = {
  PAYMENT_ORDER: 'Платёжное поручение',
  ACT: 'Акт',
  AGREEMENT: 'Договор',
  OTHER: 'Документ',
  ATTACHMENT: 'Документ',
};

export const fmtRub = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

/** Дата без времени (колонки date) — без сдвига часового пояса. */
export const fmtDay = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('.') : '—');

/** «осталось 2 дн. 5 ч» */
export function timeLeft(until: string): string {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 'срок истёк';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `осталось ${d} дн. ${h % 24} ч`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `осталось ${h} ч ${m} мин` : `осталось ${m} мин`;
}

Object.assign(AUDIT_ACTION, {
  'event.created': 'Создано мероприятие',
  'event.updated': 'Изменено мероприятие',
  'event.cancelled': 'Мероприятие отменено',
  'event.registration': 'Регистрация на мероприятие',
  'event.attendance_marked': 'Отмечено присутствие',
  'protocol.created': 'Создан протокол',
  'protocol.updated': 'Изменён протокол',
  'protocol.published': 'Опубликован протокол',
  'protocol.unpublished': 'Протокол снят с публикации',
  'protocol.deleted': 'Удалён черновик протокола',
  'protocol.file_added': 'Приложен файл к протоколу',
  'protocol.file_removed': 'Удалён файл протокола',
});
Object.assign(ENTITY_TYPE, { Event: 'Мероприятие', Protocol: 'Протокол' });

export const EVENT_TYPE: Record<EventType, { label: string; color: string }> = {
  GENERAL_MEETING: { label: 'Общее собрание', color: 'indigo' },
  CONFERENCE: { label: 'Конференция', color: 'cyan' },
  WORKING_GROUP_MEETING: { label: 'Заседание РГ', color: 'grape' },
  OTHER: { label: 'Мероприятие', color: 'gray' },
};
export const EVENT_FORMAT: Record<EventFormat, string> = { OFFLINE: 'Очно', ONLINE: 'Онлайн', HYBRID: 'Очно и онлайн' };
export const EVENT_STATUS: Record<EventStatus, { label: string; color: string }> = {
  PLANNED: { label: 'Запланировано', color: 'blue' },
  HELD: { label: 'Состоялось', color: 'teal' },
  CANCELLED: { label: 'Отменено', color: 'red' },
};
export const REGISTRATION: Record<RegistrationStatus, { label: string; color: string }> = {
  INVITED: { label: 'Нет ответа', color: 'gray' },
  CONFIRMED_OFFLINE: { label: 'Будет очно', color: 'teal' },
  CONFIRMED_ONLINE: { label: 'Будет онлайн', color: 'blue' },
  DECLINED: { label: 'Не сможет', color: 'red' },
};
export const PRESENCE: Record<PresenceStatus, string> = {
  UNKNOWN: 'Не отмечено',
  PRESENT_OFFLINE: 'Был очно',
  PRESENT_ONLINE: 'Был онлайн',
  ABSENT: 'Отсутствовал',
};
export const PROTOCOL_STATUS: Record<ProtocolStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Черновик', color: 'gray' },
  PUBLISHED: { label: 'Опубликован', color: 'teal' },
};
export const fmtTime = (v?: string | null) => (v ? dayjs(v).tz(TZ).format('HH:mm') : '');
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)}%`);

Object.assign(AUDIT_ACTION, {
  'wg.created': 'Создана рабочая группа',
  'wg.updated': 'Изменена рабочая группа',
  'wg.member_added': 'Добавлен участник РГ',
  'wg.member_removed': 'Исключён участник РГ',
  'wg.role_changed': 'Изменена роль в РГ',
  'wg.joined': 'Вступление в РГ',
  'wg.left': 'Выход из РГ',
  'wg.plan_added': 'Добавлен пункт плана РГ',
  'wg.plan_updated': 'Изменён пункт плана РГ',
  'wg.plan_removed': 'Удалён пункт плана РГ',
  'wg.task_created': 'Создана задача РГ',
  'wg.task_updated': 'Изменена задача РГ',
  'wg.task_removed': 'Удалена задача РГ',
  'wg.comment_removed': 'Удалён комментарий',
  'wg.file_added': 'Загружен файл в архив РГ',
  'wg.file_removed': 'Удалён файл из архива РГ',
});
Object.assign(ENTITY_TYPE, { WorkingGroup: 'Рабочая группа' });

export const WG_ROLE: Record<WgRole, string> = { LEAD: 'Руководитель', MEMBER: 'Участник' };
export const PLAN_STATUS: Record<PlanStatus, { label: string; color: string }> = {
  PLANNED: { label: 'Запланировано', color: 'gray' },
  IN_PROGRESS: { label: 'В работе', color: 'blue' },
  DONE: { label: 'Выполнено', color: 'teal' },
  CANCELLED: { label: 'Отменено', color: 'red' },
};
export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> = {
  TODO: { label: 'К выполнению', color: 'gray' },
  IN_PROGRESS: { label: 'В работе', color: 'blue' },
  DONE: { label: 'Готово', color: 'teal' },
};

Object.assign(AUDIT_ACTION, { 'settings.updated': 'Изменены настройки портала', 'email_template.updated': 'Изменён шаблон письма' });
Object.assign(ENTITY_TYPE, { Settings: 'Настройки', EmailTemplate: 'Шаблон письма' });
