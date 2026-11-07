import { Button, Checkbox, Group, Select, SimpleGrid, Stack, TagsInput, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMemo } from 'react';
import { useRegions } from '../api/hooks';
import type { Organization } from '../api/types';

export interface OrganizationFormValues {
  name: string;
  shortName: string;
  regionCode: string;
  city: string;
  inn: string;
  ogrn: string;
  kpp: string;
  legalAddress: string;
  postalAddress: string;
  activityAreas: string[];
  description: string;
  website: string;
  email: string;
  phone: string;
  headName: string;
  headPosition: string;
  showOnMap: boolean;
  contactPrivacy: { hideEmail: boolean; hidePhone: boolean };
}

const s = (v: string | null | undefined) => v ?? '';

export function toFormValues(o?: Partial<Organization>): OrganizationFormValues {
  return {
    name: s(o?.name),
    shortName: s(o?.shortName),
    regionCode: s(o?.regionCode),
    city: s(o?.city),
    inn: s(o?.inn),
    ogrn: s(o?.ogrn),
    kpp: s(o?.kpp),
    legalAddress: s(o?.legalAddress),
    postalAddress: s(o?.postalAddress),
    activityAreas: o?.activityAreas ?? [],
    description: s(o?.description),
    website: s(o?.website),
    email: s(o?.email),
    phone: s(o?.phone),
    headName: s(o?.headName),
    headPosition: s(o?.headPosition),
    showOnMap: o?.showOnMap ?? true,
    contactPrivacy: { hideEmail: !!o?.contactPrivacy?.hideEmail, hidePhone: !!o?.contactPrivacy?.hidePhone },
  };
}

export function useRegionOptions() {
  const regions = useRegions();
  return useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const r of regions.data ?? []) {
      const list = groups.get(r.federalDistrict) ?? [];
      list.push({ value: r.code, label: r.name });
      groups.set(r.federalDistrict, list);
    }
    return [...groups.entries()].map(([group, items]) => ({ group: `${group} ФО`, items }));
  }, [regions.data]);
}

export function OrganizationForm({
  initial,
  individual,
  submitLabel = 'Сохранить',
  onSubmit,
  extra,
}: {
  initial?: Partial<Organization>;
  individual?: boolean;
  submitLabel?: string;
  onSubmit: (values: OrganizationFormValues) => Promise<unknown>;
  extra?: React.ReactNode;
}) {
  const regionOptions = useRegionOptions();
  const form = useForm<OrganizationFormValues>({
    initialValues: toFormValues(initial),
    validate: {
      name: (v) => (v.trim().length >= 2 ? null : 'Укажите название'),
      regionCode: (v) => (v ? null : 'Выберите регион'),
      inn: (v) => (!v || /^(\d{10}|\d{12})$/.test(v) ? null : 'ИНН — 10 или 12 цифр'),
      ogrn: (v) => (!v || /^(\d{13}|\d{15})$/.test(v) ? null : 'ОГРН — 13 или 15 цифр'),
      kpp: (v) => (!v || /^\d{9}$/.test(v) ? null : 'КПП — 9 цифр'),
      website: (v) => (!v || /^https?:\/\/\S+$/.test(v) ? null : 'Полный адрес, начиная с https://'),
      email: (v) => (!v || /^\S+@\S+\.\S+$/.test(v) ? null : 'Некорректный email'),
    },
  });

  return (
    <form onSubmit={form.onSubmit((v) => onSubmit(v).then(() => form.resetDirty(v)))}>
      <Stack>
        {extra}
        <Title order={5}>Основное</Title>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <TextInput label={individual ? 'ФИО специалиста' : 'Полное название'} withAsterisk {...form.getInputProps('name')} />
          {!individual && <TextInput label="Краткое название" {...form.getInputProps('shortName')} />}
          <Select label="Регион" withAsterisk searchable data={regionOptions} nothingFoundMessage="Не найдено" {...form.getInputProps('regionCode')} />
          <TextInput label="Населённый пункт" {...form.getInputProps('city')} />
        </SimpleGrid>
        <TagsInput label="Сферы деятельности" description="Введите и нажмите Enter" {...form.getInputProps('activityAreas')} />
        <Textarea label="Описание" autosize minRows={3} maxRows={10} {...form.getInputProps('description')} />

        <Title order={5} mt="sm">
          Контакты
        </Title>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {!individual && <TextInput label="Руководитель (ФИО)" {...form.getInputProps('headName')} />}
          {!individual && <TextInput label="Должность руководителя" {...form.getInputProps('headPosition')} />}
          <TextInput label="Email" {...form.getInputProps('email')} />
          <TextInput label="Телефон" {...form.getInputProps('phone')} />
          <TextInput label="Сайт" placeholder="https://" {...form.getInputProps('website')} />
        </SimpleGrid>

        {!individual && (
          <>
            <Title order={5} mt="sm">
              Реквизиты
            </Title>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput label="ИНН" {...form.getInputProps('inn')} />
              <TextInput label="ОГРН" {...form.getInputProps('ogrn')} />
              <TextInput label="КПП" {...form.getInputProps('kpp')} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput label="Юридический адрес" {...form.getInputProps('legalAddress')} />
              <TextInput label="Почтовый адрес" {...form.getInputProps('postalAddress')} />
            </SimpleGrid>
          </>
        )}
        <Checkbox label="Показывать на карте Альянса" {...form.getInputProps('showOnMap', { type: 'checkbox' })} />
        <Group gap="xl">
          <Checkbox label="Скрыть email от других членов Альянса" {...form.getInputProps('contactPrivacy.hideEmail', { type: 'checkbox' })} />
          <Checkbox label="Скрыть телефон от других членов Альянса" {...form.getInputProps('contactPrivacy.hidePhone', { type: 'checkbox' })} />
        </Group>
        <Group justify="flex-end">
          <Button type="submit" disabled={!form.isDirty()} loading={form.submitting}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
