import { QuestionFormat } from '@prisma/client';
import { BallotError, computeResults, plural, QuestionDef, validateBallot } from './vote-logic';

const opts = (...texts: string[]) => texts.map((text, position) => ({ id: `o${position}`, text, position }));
const q = (format: QuestionFormat, options = opts('За', 'Против', 'Воздержался'), extra: Partial<QuestionDef> = {}): QuestionDef => ({
  id: 'q1',
  text: 'Вопрос',
  position: 0,
  format,
  minChoices: 1,
  maxChoices: 1,
  options,
  ...extra,
});

describe('validateBallot', () => {
  it('YES_NO_ABSTAIN: ровно один вариант', () => {
    expect(validateBallot([q('YES_NO_ABSTAIN')], [{ questionId: 'q1', optionIds: ['o0'] }])).toEqual([{ questionId: 'q1', optionId: 'o0', rank: null }]);
    expect(() => validateBallot([q('YES_NO_ABSTAIN')], [{ questionId: 'q1', optionIds: ['o0', 'o1'] }])).toThrow(BallotError);
    expect(() => validateBallot([q('YES_NO_ABSTAIN')], [{ questionId: 'q1', optionIds: [] }])).toThrow(BallotError);
  });

  it('на каждый вопрос нужен ответ, лишние вопросы и варианты отклоняются', () => {
    const two = [q('SINGLE'), { ...q('SINGLE'), id: 'q2', position: 1 }];
    expect(() => validateBallot(two, [{ questionId: 'q1', optionIds: ['o0'] }])).toThrow('Вопрос 2: нет ответа');
    expect(() => validateBallot([q('SINGLE')], [{ questionId: 'qX', optionIds: ['o0'] }])).toThrow('неизвестный вопрос');
    expect(() => validateBallot([q('SINGLE')], [{ questionId: 'q1', optionIds: ['oX'] }])).toThrow('неизвестный вариант');
    expect(() => validateBallot([q('SINGLE')], [{ questionId: 'q1', optionIds: ['o0'] }, { questionId: 'q1', optionIds: ['o1'] }])).toThrow('дважды');
  });

  it('MULTIPLE: от min до max разных вариантов', () => {
    const m = q('MULTIPLE', opts('А', 'Б', 'В', 'Г'), { minChoices: 1, maxChoices: 2 });
    expect(validateBallot([m], [{ questionId: 'q1', optionIds: ['o0', 'o2'] }])).toHaveLength(2);
    expect(() => validateBallot([m], [{ questionId: 'q1', optionIds: ['o0', 'o1', 'o2'] }])).toThrow('от 1 до 2');
    expect(() => validateBallot([m], [{ questionId: 'q1', optionIds: ['o0', 'o0'] }])).toThrow('дважды');
  });

  it('RANKING: нужно расставить все варианты, ранги 1..n', () => {
    const r = q('RANKING', opts('А', 'Б', 'В'));
    expect(validateBallot([r], [{ questionId: 'q1', ranking: ['o2', 'o0', 'o1'] }])).toEqual([
      { questionId: 'q1', optionId: 'o2', rank: 1 },
      { questionId: 'q1', optionId: 'o0', rank: 2 },
      { questionId: 'q1', optionId: 'o1', rank: 3 },
    ]);
    expect(() => validateBallot([r], [{ questionId: 'q1', ranking: ['o2', 'o0'] }])).toThrow('все варианты');
  });
});

describe('plural', () => {
  it('склоняет числительные', () => {
    const w: [string, string, string] = ['голос', 'голоса', 'голосов'];
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, w))).toEqual([
      '1 голос', '2 голоса', '4 голоса', '5 голосов', '11 голосов', '12 голосов', '21 голос', '22 голоса', '25 голосов', '111 голосов',
    ]);
  });
});

describe('computeResults', () => {
  const answer = (org: string, optionId: string, rank: number | null = null) => ({ organizationId: org, questionId: 'q1', optionId, rank });

  it('кворум: доля проголосовавших ≥ порога', () => {
    const base = { questions: [q('YES_NO_ABSTAIN')], quorumPercent: 50, answers: [] };
    expect(computeResults({ ...base, eligibleCount: 10, participantIds: ['a', 'b', 'c', 'd', 'e'] }).quorumReached).toBe(true);
    expect(computeResults({ ...base, eligibleCount: 10, participantIds: ['a', 'b', 'c', 'd'] }).quorumReached).toBe(false);
    expect(computeResults({ ...base, eligibleCount: 0, participantIds: [] }).quorumReached).toBe(false);
  });

  it('без кворума решение не принимается независимо от голосов', () => {
    const r = computeResults({ questions: [q('YES_NO_ABSTAIN')], eligibleCount: 10, quorumPercent: 50, participantIds: ['a'], answers: [answer('a', 'o0')] });
    expect(r.questions[0].outcome.kind).toBe('NO_QUORUM');
  });

  it('YES_NO_ABSTAIN: принято, если «за» больше половины проголосовавших (воздержавшиеся в знаменателе)', () => {
    const accepted = computeResults({
      questions: [q('YES_NO_ABSTAIN')],
      eligibleCount: 4,
      quorumPercent: 50,
      participantIds: ['a', 'b', 'c'],
      answers: [answer('a', 'o0'), answer('b', 'o0'), answer('c', 'o2')],
    });
    expect(accepted.questions[0].outcome.kind).toBe('ACCEPTED');
    expect(accepted.questions[0].options[0]).toMatchObject({ count: 2, percent: 66.7 });

    const rejected = computeResults({
      questions: [q('YES_NO_ABSTAIN')],
      eligibleCount: 4,
      quorumPercent: 50,
      participantIds: ['a', 'b', 'c', 'd'],
      answers: [answer('a', 'o0'), answer('b', 'o0'), answer('c', 'o2'), answer('d', 'o1')],
    });
    expect(rejected.questions[0].outcome.kind).toBe('REJECTED'); // 2 из 4 — не больше половины
  });

  it('SINGLE: победитель и ничья', () => {
    const single = q('SINGLE', opts('А', 'Б'));
    const win = computeResults({ questions: [single], eligibleCount: 3, quorumPercent: 0, participantIds: ['a', 'b', 'c'], answers: [answer('a', 'o0'), answer('b', 'o0'), answer('c', 'o1')] });
    expect(win.questions[0].outcome).toMatchObject({ kind: 'WINNER', winnerOptionIds: ['o0'] });
    const tie = computeResults({ questions: [single], eligibleCount: 2, quorumPercent: 0, participantIds: ['a', 'b'], answers: [answer('a', 'o0'), answer('b', 'o1')] });
    expect(tie.questions[0].outcome.kind).toBe('TIE');
  });

  it('RANKING: метод Борда', () => {
    const r = q('RANKING', opts('А', 'Б', 'В'));
    // a: А>Б>В, b: Б>А>В, c: Б>В>А  →  А: 3+2+1=6, Б: 2+3+3=8, В: 1+1+2=4
    const res = computeResults({
      questions: [r],
      eligibleCount: 3,
      quorumPercent: 50,
      participantIds: ['a', 'b', 'c'],
      answers: [answer('a', 'o0', 1), answer('a', 'o1', 2), answer('a', 'o2', 3), answer('b', 'o1', 1), answer('b', 'o0', 2), answer('b', 'o2', 3), answer('c', 'o1', 1), answer('c', 'o2', 2), answer('c', 'o0', 3)],
    });
    expect(res.questions[0].options.map((o) => o.score)).toEqual([6, 8, 4]);
    expect(res.questions[0].outcome).toMatchObject({ kind: 'WINNER', winnerOptionIds: ['o1'] });
  });

  it('голоса не из списка проголосовавших не учитываются', () => {
    const res = computeResults({ questions: [q('YES_NO_ABSTAIN')], eligibleCount: 2, quorumPercent: 0, participantIds: ['a'], answers: [answer('a', 'o0'), answer('ghost', 'o1')] });
    expect(res.questions[0].options[1].count).toBe(0);
  });
});
