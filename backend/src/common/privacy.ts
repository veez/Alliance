import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Настройки приватности контактов (организации и сотрудника).
 * Скрытые поля не показываются другим членам Альянса; своя организация и «видящие всё» видят всё.
 */
export interface ContactPrivacy {
  hideEmail?: boolean;
  hidePhone?: boolean;
  /** Сотрудник не попадает в справочник контактов сообщества */
  hideFromDirectory?: boolean;
}

export class ContactPrivacyDto implements ContactPrivacy {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hideEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hidePhone?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hideFromDirectory?: boolean;
}

export function readPrivacy(v: unknown): ContactPrivacy {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ContactPrivacy) : {};
}

/** Убирает скрытые email/телефон из объекта контакта. */
export function maskContacts<T extends { email?: string | null; phone?: string | null }>(obj: T, privacy: unknown): T {
  const p = readPrivacy(privacy);
  return { ...obj, email: p.hideEmail ? null : (obj.email ?? null), phone: p.hidePhone ? null : (obj.phone ?? null) };
}

/** Plain-объект для записи в JSON-колонку. */
export function privacyData(dto: ContactPrivacyDto | undefined): { hideEmail: boolean; hidePhone: boolean; hideFromDirectory: boolean } | undefined {
  if (!dto) return undefined;
  return { hideEmail: !!dto.hideEmail, hidePhone: !!dto.hidePhone, hideFromDirectory: !!dto.hideFromDirectory };
}
