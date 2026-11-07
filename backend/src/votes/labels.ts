import { QuestionFormat, VoteEligibility, VoteScenario, VoteStatus } from '@prisma/client';

export const SCENARIO_LABEL: Record<VoteScenario, string> = {
  DOCUMENT_APPROVAL: 'Согласование документа',
  EVENT_PARTICIPATION: 'Участие Альянса в мероприятии / инициативе',
  ADMISSION: 'Приём в члены Альянса',
  ELECTION: 'Выборы',
  OTHER: 'Иное',
};

export const STATUS_LABEL: Record<VoteStatus, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Идёт голосование',
  CLOSED: 'Завершено',
  CANCELLED: 'Отменено',
};

export const ELIGIBILITY_LABEL: Record<VoteEligibility, string> = {
  ALL_MEMBERS: 'Все члены Альянса',
  LIST: 'Указанные члены Альянса',
  PAID_DUES: 'Члены Альянса с оплаченным взносом за текущий год',
};

export const FORMAT_LABEL: Record<QuestionFormat, string> = {
  YES_NO_ABSTAIN: 'За / против / воздержался',
  SINGLE: 'Один вариант',
  MULTIPLE: 'Несколько вариантов',
  RANKING: 'Рейтинг',
};
