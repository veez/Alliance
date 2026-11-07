import { Avatar, FileButton, Stack, Button } from '@mantine/core';
import { IconBuilding, IconUpload, IconUser } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useOrgLogo } from '../api/hooks';
import type { Organization } from '../api/types';
import { notifyError, notifyOk } from './common';

export function OrgLogo({ org, size = 48, editable = false }: { org: Pick<Organization, 'id' | 'logoFileId' | 'kind'>; size?: number; editable?: boolean }) {
  const url = useOrgLogo(org.id, org.logoFileId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const avatar = (
    <Avatar src={url} size={size} radius="md" color="brand" variant="light">
      {org.kind === 'INDIVIDUAL' ? <IconUser size={size / 2} /> : <IconBuilding size={size / 2} />}
    </Avatar>
  );
  if (!editable) return avatar;

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/organizations/${org.id}/logo`, { method: 'POST', body: fd });
      await qc.invalidateQueries({ queryKey: ['organization', org.id] });
      notifyOk('Логотип обновлён');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={6} align="center">
      {avatar}
      <FileButton onChange={upload} accept="image/png,image/jpeg,image/webp">
        {(props) => (
          <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconUpload size={12} />} loading={busy}>
            Логотип
          </Button>
        )}
      </FileButton>
    </Stack>
  );
}
