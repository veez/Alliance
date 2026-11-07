import { ActionIcon, Anchor, Button, FileButton, Group, Stack, Table, Text } from '@mantine/core';
import { IconFileText, IconTrash, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, downloadFile } from '../../api/client';
import type { FileMeta, UserBrief, WorkingGroupDetail } from '../../api/types';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { fmtDateTime } from '../../labels';

type WgFile = FileMeta & { uploadedBy: UserBrief | null; canDelete: boolean };
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

export function WgFiles({ g }: { g: WorkingGroupDetail }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['wg-files', g.id], queryFn: () => api<WgFile[]>(`/working-groups/${g.id}/files`) });
  const canUpload = (!!g.myRole || g.canManage) && g.status === 'ACTIVE';
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/working-groups/${g.id}/files`, { method: 'POST', body: fd });
      await qc.invalidateQueries({ queryKey: ['wg-files', g.id] });
      notifyOk('Файл загружен');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/working-groups/${g.id}/files/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['wg-files', g.id] });
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Черновики документов, материалы заседаний, презентации. PDF, Office, изображения, до 30 МБ.
        </Text>
        {canUpload && (
          <FileButton onChange={upload}>
            {(props) => (
              <Button {...props} variant="light" leftSection={<IconUpload size={16} />} loading={busy}>
                Загрузить файл
              </Button>
            )}
          </FileButton>
        )}
      </Group>
      <QueryState isLoading={q.isLoading} error={q.error}>
        {q.data?.length ? (
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Файл</Table.Th>
                  <Table.Th w={90}>Размер</Table.Th>
                  <Table.Th w={220}>Загрузил</Table.Th>
                  <Table.Th w={40} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.map((f) => (
                  <Table.Tr key={f.id}>
                    <Table.Td>
                      <Anchor size="sm" onClick={() => downloadFile(`/working-groups/${g.id}/files/${f.id}`, f.originalName).catch(notifyError)}>
                        <Group gap={6} wrap="nowrap">
                          <IconFileText size={16} /> {f.originalName}
                        </Group>
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{size(f.size)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{f.uploadedBy?.fullName ?? '—'}</Text>
                      <Text size="xs" c="dimmed">
                        {fmtDateTime(f.createdAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {f.canDelete && (
                        <ActionIcon variant="subtle" color="red" onClick={() => remove(f.id)} title="Удалить файл">
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed">Документов пока нет.</Text>
        )}
      </QueryState>
    </Stack>
  );
}
