import { QuestionFormat } from '@prisma/client';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { fmtMsk } from '../common/time';
import { ELIGIBILITY_LABEL, FORMAT_LABEL, SCENARIO_LABEL } from './labels';
import type { VoteFullData } from './votes.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts');
const font = (name: string) => Buffer.from(vfs[name], 'base64');

// Roboto из комплекта pdfmake содержит кириллицу
const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

const ACCENT = '#007b73';

/** Итоговый протокол электронного голосования (PDF). */
export function buildVoteProtocolPdf({ vote, result, rows }: VoteFullData): Promise<Buffer> {
  const kv = (k: string, v: string): Content => ({
    columns: [
      { text: k, width: 170, color: '#555' },
      { text: v, width: '*' },
    ],
    margin: [0, 2, 0, 2],
  });

  const questionsContent: Content[] = result.questions.flatMap((q, i) => {
    const isRanking = q.format === QuestionFormat.RANKING;
    return [
      { text: `Вопрос ${i + 1}. ${q.text}`, style: 'h3', margin: [0, 12, 0, 4] },
      { text: `Формат: ${FORMAT_LABEL[q.format]}. Ответили: ${q.answeredCount}.`, fontSize: 9, color: '#555', margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 70, 60],
          body: [
            [
              { text: 'Вариант', bold: true },
              { text: isRanking ? 'Баллы' : 'Голосов', bold: true, alignment: 'right' },
              { text: isRanking ? '1-х мест' : '%', bold: true, alignment: 'right' },
            ],
            ...q.options.map((o) => [
              { text: o.text, bold: q.outcome.winnerOptionIds.includes(o.optionId) && q.outcome.kind !== 'RANKED' },
              { text: String(isRanking ? (o.score ?? 0) : o.count), alignment: 'right' },
              { text: isRanking ? String(o.count) : `${o.percent}`, alignment: 'right' },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: q.outcome.label, bold: true, color: q.outcome.kind === 'REJECTED' || q.outcome.kind === 'NO_QUORUM' ? '#b42318' : ACCENT, margin: [0, 6, 0, 0] },
    ] as Content[];
  });

  const answerText = (r: (typeof rows)[number], qId: string, format: QuestionFormat) => {
    const a = r.answers[qId] ?? [];
    if (!r.votedAt) return '—';
    return format === QuestionFormat.RANKING ? a.map((x) => `${x.rank}. ${x.text}`).join('\n') : a.map((x) => x.text).join(', ');
  };

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [48, 56, 48, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    info: { title: `Протокол голосования № ${vote.number}`, author: 'Альянс «Ценность каждого»' },
    footer: (page, pages) => ({
      columns: [
        { text: `Протокол голосования № ${vote.number}`, fontSize: 8, color: '#888' },
        { text: `стр. ${page} из ${pages}`, alignment: 'right', fontSize: 8, color: '#888' },
      ],
      margin: [48, 16, 48, 0],
    }),
    styles: {
      h1: { fontSize: 16, bold: true },
      h2: { fontSize: 12, bold: true, color: ACCENT },
      h3: { fontSize: 11, bold: true },
    },
    content: [
      { text: 'Альянс «Ценность каждого»', color: ACCENT, bold: true },
      { text: `Протокол электронного голосования № ${vote.number}`, style: 'h1', margin: [0, 4, 0, 2] },
      { text: vote.title, fontSize: 12, margin: [0, 0, 0, 12] },
      kv('Вид голосования', `${SCENARIO_LABEL[vote.scenario]}, открытое (поимённое)`),
      ...(vote.subjectOrganization ? [kv('Кандидат', vote.subjectOrganization.name)] : []),
      kv('Инициатор', vote.createdBy.fullName),
      kv('Период голосования', `${fmtMsk(vote.startsAt)} — ${fmtMsk(vote.closedAt ?? vote.endsAt)} (МСК)`),
      kv('Участники', ELIGIBILITY_LABEL[vote.eligibility]),
      kv('Порядок подсчёта', 'Одна организация — один голос'),
      ...(vote.description ? [{ text: vote.description, margin: [0, 8, 0, 0], color: '#333' } as Content] : []),

      { text: 'Кворум', style: 'h2', margin: [0, 14, 0, 4] },
      kv('Имели право голоса', String(result.eligibleCount)),
      kv('Проголосовали', `${result.participatedCount} (${result.turnoutPercent}%)`),
      kv('Требуемый кворум', `${result.quorumPercent}%`),
      { text: result.quorumReached ? 'Кворум набран.' : 'Кворум не набран.', bold: true, color: result.quorumReached ? ACCENT : '#b42318', margin: [0, 4, 0, 0] },

      { text: 'Итоги по вопросам', style: 'h2', margin: [0, 14, 0, 0] },
      ...questionsContent,

      { text: 'Поимённые результаты', style: 'h2', margin: [0, 16, 0, 6], pageBreak: 'before' },
      {
        table: {
          headerRows: 1,
          widths: [120, 90, ...vote.questions.map(() => '*')],
          body: [
            [{ text: 'Организация', bold: true }, { text: 'Голос подан', bold: true }, ...vote.questions.map((_, i) => ({ text: `Вопрос ${i + 1}`, bold: true }))],
            ...rows.map((r) => [
              { text: `${r.organizationName}\n`, fontSize: 9 },
              { text: r.votedAt ? `${fmtMsk(r.votedAt)}\n${r.votedBy?.fullName ?? ''}` : 'не голосовала', fontSize: 8, color: r.votedAt ? '#333' : '#999' },
              ...vote.questions.map((q) => ({ text: answerText(r, q.id, q.format), fontSize: 9 })),
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },

      {
        // Подписи не переносятся на отдельную страницу от текста
        unbreakable: true,
        stack: [
          { text: `Протокол сформирован автоматически ${fmtMsk(new Date())} (МСК).`, fontSize: 8, color: '#888', margin: [0, 20, 0, 24] },
          {
            columns: [
              { text: 'Секретарь Альянса\n\n_______________________ / ____________________', width: '*' },
              { text: 'Председатель\n\n_______________________ / ____________________', width: '*' },
            ],
          },
        ],
      },
    ],
  };

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(def);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
