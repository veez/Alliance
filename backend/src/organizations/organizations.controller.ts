import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { UploadedFileLike } from '../files/files.service';
import { ChangeStatusDto, CreateOrganizationDto, OrganizationListQuery, UpdateOrganizationDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Организации')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Список организаций (набор полей зависит от прав)' })
  list(@Query() q: OrganizationListQuery, @CurrentUser() user: AuthUser) {
    return this.orgs.list(q, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orgs.get(id, user);
  }

  @Post()
  @RequirePermissions(P.ORGS_MANAGE)
  @ApiOperation({ summary: 'Создать организацию (администратор)' })
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.orgs.create(dto, user, meta);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить профиль: своя организация или администратор' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.orgs.update(id, dto, user, meta);
  }

  @Post(':id/status')
  @RequirePermissions(P.ORGS_MANAGE)
  @ApiOperation({ summary: 'Сменить статус (кандидат → член и т. п.), пишется в историю' })
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.orgs.changeStatus(id, dto, user, meta);
  }

  @Get(':id/status-history')
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orgs.statusHistory(id, user);
  }

  @Post(':id/logo')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.orgs.uploadLogo(id, file, user, meta);
  }

  @Get(':id/logo')
  async logo(@Param('id', ParseUUIDPipe) id: string) {
    const f = await this.orgs.openLogo(id);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: 'inline' });
  }
}
