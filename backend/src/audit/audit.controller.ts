import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { P } from '../access/permissions';
import { RequirePermissions } from '../common/decorators';
import { Page, PageQuery, pageArgs } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

class AuditQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Аудит')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(P.AUDIT_READ)
  async list(@Query() q: AuditQuery): Promise<Page<unknown>> {
    const where: Prisma.AuditLogWhereInput = {
      entityType: q.entityType,
      entityId: q.entityId,
      actorUserId: q.actorUserId,
      action: q.action ? { contains: q.action } : undefined,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        include: { actor: { select: { id: true, fullName: true, email: true } } },
        ...pageArgs(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, id: r.id.toString() })), total, page: q.page, pageSize: q.pageSize };
  }
}
