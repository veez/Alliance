import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, fetchObjectUrl } from './client';
import type { Region, ResponsibilityArea } from './types';

export const useRegions = () => useQuery({ queryKey: ['regions'], queryFn: () => api<Region[]>('/regions'), staleTime: Infinity });

export const useResponsibilityAreas = () =>
  useQuery({ queryKey: ['responsibility-areas'], queryFn: () => api<ResponsibilityArea[]>('/responsibility-areas'), staleTime: Infinity });

export const useWorkingGroupsBrief = () =>
  useQuery({ queryKey: ['working-groups-brief'], queryFn: () => api<Array<{ id: string; name: string }>>('/working-groups/brief'), staleTime: 300_000 });

/** Логотип организации через авторизованный запрос → object URL. */
export function useOrgLogo(orgId: string, logoFileId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let current: string | null = null;
    if (!logoFileId) {
      setUrl(null);
      return;
    }
    fetchObjectUrl(`/organizations/${orgId}/logo`).then((u) => {
      if (revoked) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      current = u;
      setUrl(u);
    });
    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [orgId, logoFileId]);
  return url;
}
