import { ActionIcon, Alert, Anchor, Badge, Button, Card, FileButton, Group, Progress, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconFileText, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, downloadFile } from '../../api/client';
import type { Agreement, DocMeta, DuesDetail, DuesStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { AGREEMENT_STATUS, DOC_TYPE, DUES_STATUS, fmtDay, fmtRub } from '../../labels';

export function DuesStatusBadge({ status }: { status: DuesStatus }) {
  return (
    <Badge color={DUES_STATUS[status].color} variant="light">
      {DUES_STATUS[status].label}
    </Badge>
  );
}

export const ACCEPT_DOCS = 'application/pdf,image/png,image/jpeg,image/webp,.doc,.docx,.odt,.xls,.xlsx,.zip,.txt';

/** Список документов с загрузкой/удалением. */
export function DocList({
  docs,
  basePath,
  canUpload,
  canRemove,
  docTypes,
  onChanged,
}: {
  docs: DocMeta[];
  basePath: string; // /dues/:id или /agreements/:id
  canUpload: boolean;
  canRemove: boolean;
  docTypes?: string[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [docType, setDocType] = useState<string>(docTypes?.[0] ?? 'OTHER');
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (docTypes) fd.append('docType', docType);
      await api(`${basePath}/files`, { method: 'POST', body: fd });
      notifyOk('Документ приложен');
      onChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`${basePath}/files/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Stack gap={6}>
      {docs.map((d) => (
        <Group key={d.id} justify="space-between" wrap="nowrap" gap="xs">
          <Anchor size="sm" onClick={() => downloadFile(`${basePath}/files/${d.id}`, d.originalName).catch(notifyError)} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <IconFileText size={16} style={{ flexShrink: 0 }} />
              <Text size="sm" truncate>
                {d.originalName}
              </Text>
            </Group>
          </Anchor>
          <Group gap={6} wrap="nowrap">
            {d.docType && (
              <Text size="xs" c="dimmed" visibleFrom="xs">
                {DOC_TYPE[d.docType] ?? d.docType}
              </Text>
            )}
            {canRemove && (
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove(d.id)} aria-label="Удалить документ">
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
        </Group>
      ))}
      {!docs.length && (
        <Text size="sm" c="dimmed">
          Документов нет
        </Text>
      )}
      {canUpload && (
        <Group gap="xs" mt={4}>
          {docTypes && (
            <Select size="xs" w={200} value={docType} onChange={(v) => v && setDocType(v)} allowDeselect={false} data={docTypes.map((t) => ({ value: t, label: DOC_TYPE[t] }))} />
          )}
          <FileButton onChange={upload} accept={ACCEPT_DOCS}>
            {(props) => (
              <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />} loading={busy}>
                Приложить файл
              </Button>
            )}
          </FileButton>
        </Group>
      )}
    </Stack>
  );
}

function DuesYearCard({ d, onChanged }: { d: DuesDetail; onChanged: () => void }) {
  const { can, me } = useAuth();
  const own = me?.organization?.id === d.organizationId;
  const pct = d.amountDue ? Math.min(100, Math.round((d.paid / d.amountDue) * 100)) : 100;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={4}>Взнос за {d.year} год</Title>
        <DuesStatusBadge status={d.status} />
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="sm">
        <div>
          <Text size="xs" c="dimmed">Начислено</Text>
          <Text fw={600}>{fmtRub(d.amountDue)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">Оплачено</Text>
          <Text fw={600}>{fmtRub(d.paid)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">К оплате</Text>
          <Text fw={600} c={d.debt > 0 && d.status !== 'WAIVED' ? (d.status === 'OVERDUE' ? 'red' : undefined) : 'teal'}>
            {d.status === 'WAIVED' ? '—' : fmtRub(d.debt)}
          </Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">Срок оплаты</Text>
          <Text fw={600}>{fmtDay(d.dueDate)}</Text>
        </div>
      </SimpleGrid>
      {d.status !== 'WAIVED' && <Progress value={pct} color={pct >= 100 ? 'teal' : d.status === 'OVERDUE' ? 'red' : 'yellow'} size="sm" mb="sm" />}
      {d.note && (
        <Text size="sm" c="dimmed" mb="sm">
          {d.note}
        </Text>
      )}
      {d.payments.length > 0 && (
        <Table verticalSpacing={4} mb="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Дата платежа</Table.Th>
              <Table.Th>Сумма</Table.Th>
              <Table.Th>Документ</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.payments.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{fmtDay(p.paidAt)}</Table.Td>
                <Table.Td>{fmtRub(p.amount)}</Table.Td>
                <Table.Td>{p.documentNumber ? `п/п № ${p.documentNumber}` : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="sm" fw={500} mb={4}>
        Документы
      </Text>
      <DocList
        docs={d.documents}
        basePath={`/dues/${d.id}`}
        canUpload={can('dues.manage') || (own && can('dues.read_own'))}
        canRemove={can('dues.manage')}
        docTypes={['PAYMENT_ORDER', 'ACT', 'OTHER']}
        onChanged={onChanged}
      />
      {own && d.debt > 0 && d.status !== 'WAIVED' && (
        <Text size="xs" c="dimmed" mt="sm">
          Оплатили? Приложите платёжное поручение — секретарь Альянса отметит оплату.
        </Text>
      )}
    </Card>
  );
}

export function AgreementsList({ agreements, onChanged }: { agreements: Agreement[]; onChanged: () => void }) {
  const { can, me } = useAuth();
  if (!agreements.length)
    return (
      <Text size="sm" c="dimmed">
        Договоров пожертвования нет.
      </Text>
    );
  return (
    <Stack>
      {agreements.map((a) => (
        <Card key={a.id} withBorder padding="md">
          <Group justify="space-between" mb={6}>
            <div>
              <Text fw={600}>Договор № {a.number}</Text>
              <Text size="xs" c="dimmed">
                {a.year} год · {a.signedAt ? `подписан ${fmtDay(a.signedAt)}` : 'не подписан'} · {fmtRub(a.amount)}
              </Text>
            </div>
            <Badge color={AGREEMENT_STATUS[a.status].color} variant="light">
              {AGREEMENT_STATUS[a.status].label}
            </Badge>
          </Group>
          <DocList
            docs={a.documents}
            basePath={`/agreements/${a.id}`}
            canUpload={can('dues.manage') || (me?.organization?.id === a.organizationId && can('dues.read_own'))}
            canRemove={can('dues.manage')}
            onChanged={onChanged}
          />
        </Card>
      ))}
    </Stack>
  );
}

/** История взносов и договоры организации за все годы. */
export function OrgDuesHistory({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ['dues-history', orgId],
    queryFn: () => api<{ dues: DuesDetail[]; agreements: Agreement[] }>(`/dues/organization/${orgId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['dues-history', orgId] });
  return (
    <QueryState isLoading={history.isLoading} error={history.error}>
      {history.data && (
        <Stack>
          {history.data.dues.length ? (
            history.data.dues.map((d) => <DuesYearCard key={d.id} d={d} onChanged={refresh} />)
          ) : (
            <Alert color="gray">Взносы ещё не начислялись.</Alert>
          )}
          <Title order={4} mt="md">
            Договоры пожертвования
          </Title>
          <AgreementsList agreements={history.data.agreements} onChanged={refresh} />
        </Stack>
      )}
    </QueryState>
  );
}
