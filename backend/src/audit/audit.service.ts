import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestMeta } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

const SECRET_FIELDS = new Set(['passwordHash', 'totpSecretEnc', 'tokenHash']);

/** Убирает секреты и приводит значения к JSON (Decimal, Date, BigInt). */
export function sanitizeForAudit(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (SECRET_FIELDS.has(key)) return v ? '[скрыто]' : v;
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  );
}

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: sanitizeForAudit(entry.before),
        after: sanitizeForAudit(entry.after),
        ip: entry.meta?.ip,
        userAgent: entry.meta?.userAgent?.slice(0, 500),
      },
    });
    this.logger.log(`${entry.action} ${entry.entityType}:${entry.entityId ?? '-'} by ${entry.actorUserId ?? 'system'}`);
  }
}
