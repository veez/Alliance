import { Anchor, Badge, Card, CloseButton, Grid, Group, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconMail, IconPhone, IconWorld } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { OrganizationKind, OrganizationStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader, QueryState, StatusBadge } from '../../components/common';
import { GRID } from './grid';

type Layer = 'members' | 'candidates' | 'partners' | 'all';
interface MapRegion {
  code: string;
  name: string;
  district: string;
  members: number;
  candidates: number;
  partners: number;
}
interface MapData {
  regions: MapRegion[];
  totals: { members: number; candidates: number; partners: number; regionsWithMembers: number; regionsTotal: number };
}
interface RegionData {
  region: { code: string; name: string; district: string };
  organizations: {
    id: string;
    name: string;
    shortName: string | null;
    kind: OrganizationKind;
    status: OrganizationStatus;
    city: string | null;
    website: string | null;
    activityAreas: string[];
    contacts: { headName: string | null; headPosition: string | null; email: string | null; phone: string | null } | null;
  }[];
}

const LAYER_COLOR: Record<Layer, string> = { members: 'teal', candidates: 'yellow', partners: 'grape', all: 'indigo' };
const CELL = 44;
const GAP = 4;

const value = (r: MapRegion | undefined, layer: Layer) => (!r ? 0 : layer === 'all' ? r.members + r.candidates + r.partners : r[layer]);
const shade = (n: number) => (n === 0 ? 0 : n === 1 ? 3 : n === 2 ? 5 : n <= 4 ? 6 : 8);

function RegionPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['map-region', code], queryFn: () => api<RegionData>(`/map/regions/${code}`) });
  const d = q.data;
  return (
    <Card withBorder padding="lg">
      <QueryState isLoading={q.isLoading} error={q.error}>
        {d && (
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Title order={4}>{d.region.name}</Title>
                <Text size="xs" c="dimmed">
                  {d.region.district} федеральный округ
                </Text>
              </div>
              <CloseButton onClick={onClose} aria-label="Закрыть" />
            </Group>
            {d.organizations.length ? (
              d.organizations.map((o) => (
                <Card key={o.id} withBorder padding="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                    <div style={{ minWidth: 0 }}>
                      {can('orgs.read_all') || can('contacts.read') ? (
                        <Anchor component={Link} to={`/organizations/${o.id}`} fw={500} size="sm">
                          {o.shortName || o.name}
                        </Anchor>
                      ) : (
                        <Text fw={500} size="sm">
                          {o.shortName || o.name}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {[o.kind === 'INDIVIDUAL' ? 'специалист' : null, o.city].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                    <StatusBadge status={o.status} />
                  </Group>
                  {o.activityAreas.length > 0 && (
                    <Group gap={4} mt={6}>
                      {o.activityAreas.map((a) => (
                        <Badge key={a} size="xs" variant="outline" color="gray">
                          {a}
                        </Badge>
                      ))}
                    </Group>
                  )}
                  {o.contacts && (
                    <Stack gap={2} mt={6}>
                      {o.contacts.headName && (
                        <Text size="xs">
                          {o.contacts.headPosition ? `${o.contacts.headPosition}: ` : 'Руководитель: '}
                          {o.contacts.headName}
                        </Text>
                      )}
                      {o.contacts.phone && (
                        <Group gap={4}>
                          <IconPhone size={13} />
                          <Anchor href={`tel:${o.contacts.phone}`} size="xs">
                            {o.contacts.phone}
                          </Anchor>
                        </Group>
                      )}
                      {o.contacts.email && (
                        <Group gap={4}>
                          <IconMail size={13} />
                          <Anchor href={`mailto:${o.contacts.email}`} size="xs">
                            {o.contacts.email}
                          </Anchor>
                        </Group>
                      )}
                    </Stack>
                  )}
                  {o.website && (
                    <Group gap={4} mt={2}>
                      <IconWorld size={13} />
                      <Anchor href={o.website} target="_blank" rel="noopener noreferrer" size="xs">
                        {o.website.replace(/^https?:\/\//, '')}
                      </Anchor>
                    </Group>
                  )}
                </Card>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                В регионе пока нет участников Альянса.
              </Text>
            )}
            {!can('contacts.read') && !can('orgs.read_all') && d.organizations.length > 0 && (
              <Text size="xs" c="dimmed">
                Контакты организаций доступны членам Альянса.
              </Text>
            )}
          </Stack>
        )}
      </QueryState>
    </Card>
  );
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const [layer, setLayer] = useState<Layer>('members');
  const [hover, setHover] = useState<string | null>(null);
  const selected = params.get('region');
  const q = useQuery({ queryKey: ['map'], queryFn: () => api<MapData>('/map') });
  const byCode = new Map((q.data?.regions ?? []).map((r) => [r.code, r]));
  const color = LAYER_COLOR[layer];
  const cols = Math.max(...GRID.map((g) => g[1])) + 1;
  const rows = Math.max(...GRID.map((g) => g[2])) + 1;
  const select = (code: string | null) => setParams(code ? { region: code } : {}, { replace: true });
  const hovered = hover ? byCode.get(hover) : undefined;
  const t = q.data?.totals;

  return (
    <>
      <PageHeader title="Карта Альянса" description="Участники Альянса по регионам России. Нажмите на регион, чтобы увидеть организации." />
      <QueryState isLoading={q.isLoading} error={q.error}>
        {t && (
          <Stack>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">Членов Альянса</Text>
                <Text fw={700} size="xl" c="teal">{t.members}</Text>
              </Card>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">Регионов присутствия</Text>
                <Text fw={700} size="xl">
                  {t.regionsWithMembers} <Text span size="sm" c="dimmed">из {t.regionsTotal}</Text>
                </Text>
              </Card>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">Кандидатов</Text>
                <Text fw={700} size="xl" c="yellow.7">{t.candidates}</Text>
              </Card>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">Партнёров</Text>
                <Text fw={700} size="xl" c="grape">{t.partners}</Text>
              </Card>
            </SimpleGrid>
            <Grid>
              <Grid.Col span={{ base: 12, lg: selected ? 8 : 12 }}>
                <Card withBorder padding="md">
                  <Group justify="space-between" mb="sm">
                    <SegmentedControl
                      value={layer}
                      onChange={(v) => setLayer(v as Layer)}
                      data={[
                        { value: 'members', label: 'Члены' },
                        { value: 'candidates', label: 'Кандидаты' },
                        { value: 'partners', label: 'Партнёры' },
                        { value: 'all', label: 'Все' },
                      ]}
                    />
                    <Text size="sm" c="dimmed" mih={20}>
                      {hovered ? `${hovered.name}: ${value(hovered, layer)}` : ' '}
                    </Text>
                  </Group>
                  <div style={{ overflowX: 'auto' }}>
                    <svg
                      viewBox={`0 0 ${cols * (CELL + GAP)} ${rows * (CELL + GAP)}`}
                      style={{ width: '100%', minWidth: 640, display: 'block' }}
                      role="img"
                      aria-label="Плиточная карта регионов России"
                    >
                      {GRID.map(([code, x, y, label]) => {
                        const r = byCode.get(code);
                        const n = value(r, layer);
                        const s = shade(n);
                        const fill = s ? `var(--mantine-color-${color}-${s})` : 'var(--mantine-color-gray-1)';
                        const isSel = selected === code;
                        return (
                          <g
                            key={code}
                            transform={`translate(${x * (CELL + GAP)},${y * (CELL + GAP)})`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => select(isSel ? null : code)}
                            onMouseEnter={() => setHover(code)}
                            onMouseLeave={() => setHover(null)}
                            tabIndex={0}
                            role="button"
                            aria-label={`${r?.name ?? code}: ${n}`}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select(isSel ? null : code)}
                          >
                            <title>{`${r?.name ?? code}\nЧленов: ${r?.members ?? 0}, кандидатов: ${r?.candidates ?? 0}, партнёров: ${r?.partners ?? 0}`}</title>
                            <rect
                              width={CELL}
                              height={CELL}
                              rx={6}
                              fill={fill}
                              stroke={isSel ? 'var(--mantine-color-dark-6)' : hover === code ? `var(--mantine-color-${color}-7)` : 'var(--mantine-color-gray-3)'}
                              strokeWidth={isSel ? 2.5 : 1}
                            />
                            <text x={CELL / 2} y={n ? 19 : 26} textAnchor="middle" fontSize={11} fill={s >= 5 ? 'white' : 'var(--mantine-color-gray-8)'} style={{ pointerEvents: 'none' }}>
                              {label}
                            </text>
                            {n > 0 && (
                              <text x={CELL / 2} y={35} textAnchor="middle" fontSize={12} fontWeight={700} fill={s >= 5 ? 'white' : 'var(--mantine-color-gray-9)'} style={{ pointerEvents: 'none' }}>
                                {n}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <Group gap="md" mt="sm">
                    {[
                      [0, 'нет'],
                      [1, '1'],
                      [2, '2'],
                      [3, '3–4'],
                      [5, '5+'],
                    ].map(([n, l]) => (
                      <Group key={l} gap={4}>
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: '1px solid var(--mantine-color-gray-3)',
                            background: shade(n as number) ? `var(--mantine-color-${color}-${shade(n as number)})` : 'var(--mantine-color-gray-1)',
                          }}
                        />
                        <Text size="xs" c="dimmed">
                          {l}
                        </Text>
                      </Group>
                    ))}
                    <Text size="xs" c="dimmed">
                      Плитки расположены примерно по географии: запад слева, север сверху.
                    </Text>
                  </Group>
                </Card>
              </Grid.Col>
              {selected && (
                <Grid.Col span={{ base: 12, lg: 4 }}>
                  <RegionPanel code={selected} onClose={() => select(null)} />
                </Grid.Col>
              )}
            </Grid>
          </Stack>
        )}
      </QueryState>
    </>
  );
}
