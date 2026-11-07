/**
 * Чистая логика голосований (без БД): проверка бюллетеня и подсчёт итогов.
 * Покрыта unit-тестами в vote-logic.spec.ts.
 *
 * Правила подсчёта (зафиксированы в docs/ARCHITECTURE.md):
 *  - Кворум: доля проголосовавших организаций от списка участников ≥ quorumPercent.
 *  - «За / против / воздержался»: решение принято, если есть кворум и «за» больше половины
 *    проголосовавших по этому вопросу (воздержавшиеся учитываются в знаменателе).
 *  - Один вариант: побеждает вариант с наибольшим числом голосов; при равенстве — ничья.
 *  - Несколько вариантов: варианты упорядочиваются по числу голосов.
 *  - Рейтинг: метод Борда — за 1-е место n баллов, за 2-е n−1 и т. д.
 */
import { QuestionFormat } from '@prisma/client';

export interface OptionDef {
  id: string;
  text: string;
  position: number;
}

export interface QuestionDef {
  id: string;
  text: string;
  position: number;
  format: QuestionFormat;
  minChoices: number;
  maxChoices: number;
  options: OptionDef[];
}

export interface BallotAnswerInput {
  questionId: string;
  /** Выбранные варианты (YES_NO_ABSTAIN, SINGLE, MULTIPLE). */
  optionIds?: string[];
  /** Варианты в порядке предпочтения, от лучшего к худшему (RANKING). */
  ranking?: string[];
}

export interface BallotRow {
  questionId: string;
  optionId: string;
  rank: number | null;
}

export class BallotError extends Error {}

export const YES_NO_ABSTAIN_OPTIONS = ['За', 'Против', 'Воздержался'];

export function validateBallot(questions: QuestionDef[], answers: BallotAnswerInput[]): BallotRow[] {
  const byQuestion = new Map<string, BallotAnswerInput>();
  for (const a of answers) {
    if (byQuestion.has(a.questionId)) throw new BallotError('Ответ на вопрос указан дважды');
    byQuestion.set(a.questionId, a);
  }
  const known = new Set(questions.map((q) => q.id));
  for (const id of byQuestion.keys()) if (!known.has(id)) throw new BallotError('Ответ на неизвестный вопрос');

  const rows: BallotRow[] = [];
  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    const a = byQuestion.get(q.id);
    const label = `Вопрос ${q.position + 1}`;
    if (!a) throw new BallotError(`${label}: нет ответа`);
    const optionIds = new Set(q.options.map((o) => o.id));

    if (q.format === QuestionFormat.RANKING) {
      const ranking = a.ranking ?? [];
      if (new Set(ranking).size !== ranking.length) throw new BallotError(`${label}: вариант указан дважды`);
      if (ranking.length !== q.options.length || ranking.some((id) => !optionIds.has(id))) {
        throw new BallotError(`${label}: расставьте все варианты по местам`);
      }
      ranking.forEach((optionId, i) => rows.push({ questionId: q.id, optionId, rank: i + 1 }));
      continue;
    }

    const chosen = a.optionIds ?? [];
    if (new Set(chosen).size !== chosen.length) throw new BallotError(`${label}: вариант указан дважды`);
    if (chosen.some((id) => !optionIds.has(id))) throw new BallotError(`${label}: неизвестный вариант`);
    if (q.format === QuestionFormat.MULTIPLE) {
      if (chosen.length < q.minChoices || chosen.length > q.maxChoices) {
        throw new BallotError(
          q.minChoices === q.maxChoices
            ? `${label}: выберите вариантов — ${q.minChoices}`
            : `${label}: выберите от ${q.minChoices} до ${q.maxChoices} вариантов`,
        );
      }
    } else if (chosen.length !== 1) {
      throw new BallotError(`${label}: выберите один вариант`);
    }
    chosen.forEach((optionId) => rows.push({ questionId: q.id, optionId, rank: null }));
  }
  return rows;
}

export type OutcomeKind = 'ACCEPTED' | 'REJECTED' | 'WINNER' | 'TIE' | 'NO_VOTES' | 'NO_QUORUM' | 'RANKED';

export interface OptionResult {
  optionId: string;
  text: string;
  count: number;
  percent: number;
  /** Баллы Борда (только RANKING). */
  score?: number;
}

export interface QuestionResult {
  questionId: string;
  text: string;
  format: QuestionFormat;
  answeredCount: number;
  options: OptionResult[];
  outcome: { kind: OutcomeKind; label: string; winnerOptionIds: string[] };
}

export interface VoteResult {
  eligibleCount: number;
  participatedCount: number;
  turnoutPercent: number;
  quorumPercent: number;
  quorumReached: boolean;
  questions: QuestionResult[];
  computedAt: string;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Русское склонение: plural(4, ['голос', 'голоса', 'голосов']) → «4 голоса». */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}
const VOTES_WORDS: [string, string, string] = ['голос', 'голоса', 'голосов'];
const POINTS_WORDS: [string, string, string] = ['балл', 'балла', 'баллов'];

export function computeResults(input: {
  questions: QuestionDef[];
  eligibleCount: number;
  quorumPercent: number;
  participantIds: string[];
  answers: Array<{ organizationId: string; questionId: string; optionId: string; rank: number | null }>;
  now?: Date;
}): VoteResult {
  const participated = new Set(input.participantIds);
  const participatedCount = participated.size;
  const turnoutPercent = pct(participatedCount, input.eligibleCount);
  const quorumReached = input.eligibleCount > 0 && participatedCount * 100 >= input.quorumPercent * input.eligibleCount;

  const questions = [...input.questions]
    .sort((a, b) => a.position - b.position)
    .map((q): QuestionResult => {
      const answers = input.answers.filter((a) => a.questionId === q.id && participated.has(a.organizationId));
      const answeredCount = new Set(answers.map((a) => a.organizationId)).size;
      const n = q.options.length;
      const options: OptionResult[] = [...q.options]
        .sort((a, b) => a.position - b.position)
        .map((o) => {
          const forOption = answers.filter((a) => a.optionId === o.id);
          const result: OptionResult = { optionId: o.id, text: o.text, count: forOption.length, percent: pct(forOption.length, answeredCount) };
          if (q.format === QuestionFormat.RANKING) {
            result.score = forOption.reduce((s, a) => s + (n - (a.rank ?? n) + 1), 0);
            result.count = forOption.filter((a) => a.rank === 1).length; // число первых мест
            result.percent = pct(result.count, answeredCount);
          }
          return result;
        });

      return { questionId: q.id, text: q.text, format: q.format, answeredCount, options, outcome: outcomeFor(q, options, answeredCount, quorumReached) };
    });

  return {
    eligibleCount: input.eligibleCount,
    participatedCount,
    turnoutPercent,
    quorumPercent: input.quorumPercent,
    quorumReached,
    questions,
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}

function outcomeFor(q: QuestionDef, options: OptionResult[], answered: number, quorumReached: boolean): QuestionResult['outcome'] {
  if (!quorumReached) return { kind: 'NO_QUORUM', label: 'Кворум не набран — решение не принято', winnerOptionIds: [] };
  if (answered === 0) return { kind: 'NO_VOTES', label: 'Голосов нет', winnerOptionIds: [] };

  if (q.format === QuestionFormat.YES_NO_ABSTAIN) {
    const yes = options[0];
    return yes.count * 2 > answered
      ? { kind: 'ACCEPTED', label: `Решение принято: «за» — ${yes.count} из ${answered}`, winnerOptionIds: [yes.optionId] }
      : { kind: 'REJECTED', label: `Решение не принято: «за» — ${yes.count} из ${answered}`, winnerOptionIds: [] };
  }

  const metric = (o: OptionResult) => (q.format === QuestionFormat.RANKING ? (o.score ?? 0) : o.count);
  const best = Math.max(...options.map(metric));
  const leaders = options.filter((o) => metric(o) === best);

  if (q.format === QuestionFormat.MULTIPLE) {
    const ordered = [...options].sort((a, b) => b.count - a.count).filter((o) => o.count > 0);
    return { kind: 'RANKED', label: `Поддержаны: ${ordered.map((o) => `${o.text} (${o.count})`).join(', ') || '—'}`, winnerOptionIds: ordered.map((o) => o.optionId) };
  }
  const ranking = q.format === QuestionFormat.RANKING;
  if (leaders.length > 1) {
    return { kind: 'TIE', label: `Равенство ${ranking ? 'баллов' : 'голосов'}: ${leaders.map((o) => o.text).join(', ')}`, winnerOptionIds: leaders.map((o) => o.optionId) };
  }
  return {
    kind: 'WINNER',
    label: `${ranking ? 'Первое место' : 'Победил вариант'}: «${leaders[0].text}» (${plural(best, ranking ? POINTS_WORDS : VOTES_WORDS)})`,
    winnerOptionIds: [leaders[0].optionId],
  };
}
