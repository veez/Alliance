import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { UploadedFileLike } from '../files/files.service';
import { AgreementDto, AgreementListQuery, DocUploadDto, DuesRegistryQuery, DuesSettingsDto, PaymentDto, UpdateAgreementDto, UpdateDuesDto } from './dues.dto';
import { DuesService } from './dues.service';

const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
const uploadBody = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, docType: { type: 'string' } } } };
const upload = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }));

@ApiTags('Взносы')
@ApiBearerAuth()
@Controller('dues')
export class DuesController {
  constructor(private readonly dues: DuesService) {}

  @Get('settings')
  settings() {
    return this.dues.listSettings();
  }

  @Put('settings/:year')
  @RequirePermissions(P.DUES_MANAGE)
  @ApiOperation({ summary: 'Сумма, срок и правила взноса за год' })
  saveSettings(@Param('year', ParseIntPipe) year: number, @Body() dto: DuesSettingsDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.upsertSettings(year, dto, u, meta);
  }

  @Post('years/:year/accrue')
  @HttpCode(200)
  @RequirePermissions(P.DUES_MANAGE)
  @ApiOperation({ summary: 'Начислить взнос всем членам Альянса, у кого его ещё нет' })
  async accrue(@Param('year', ParseIntPipe) year: number, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return { created: await this.dues.accrue(year, u, meta) };
  }

  @Post('years/:year/remind')
  @HttpCode(200)
  @RequirePermissions(P.DUES_MANAGE)
  @ApiOperation({ summary: 'Напомнить должникам по email (не чаще раза в день)' })
  remind(@Param('year', ParseIntPipe) year: number, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.remindDebtors(year, u, meta);
  }

  @Get()
  @ApiOperation({ summary: 'Реестр взносов за год со сводкой (секретарь, администратор, «видят всё»)' })
  registry(@Query() q: DuesRegistryQuery, @CurrentUser() u: AuthUser) {
    return this.dues.registry(q, u);
  }

  @Get('my')
  @ApiOperation({ summary: 'Взнос своей организации за текущий год' })
  my(@CurrentUser() u: AuthUser) {
    return this.dues.my(u);
  }

  @Get('organization/:orgId')
  @ApiOperation({ summary: 'История взносов и договоры организации за все годы' })
  history(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: AuthUser) {
    return this.dues.orgHistory(orgId, u);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.dues.get(id, u);
  }

  @Patch(':id')
  @RequirePermissions(P.DUES_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDuesDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.update(id, dto, u, meta);
  }

  @Post(':id/payments')
  @RequirePermissions(P.DUES_MANAGE)
  @ApiOperation({ summary: 'Отметить платёж (статус пересчитывается)' })
  addPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.addPayment(id, dto, u, meta);
  }

  @Delete(':id/payments/:paymentId')
  @HttpCode(204)
  @RequirePermissions(P.DUES_MANAGE)
  async removePayment(@Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) pid: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.dues.removePayment(id, pid, u, meta);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadBody)
  @upload()
  @ApiOperation({ summary: 'Приложить документ (платёжное поручение, акт). Организация может прикладывать к своему взносу.' })
  addFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike, @Body() dto: DocUploadDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.addDuesDocument(id, file, dto.docType, u, meta);
  }

  @Get(':id/files/:fileId')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser) {
    const f = await this.dues.openDuesDocument(id, fileId, u);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachment(f.name) });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(204)
  @RequirePermissions(P.DUES_MANAGE)
  async removeFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.dues.removeDuesDocument(id, fileId, u, meta);
  }
}

@ApiTags('Договоры пожертвования')
@ApiBearerAuth()
@Controller('agreements')
export class AgreementsController {
  constructor(private readonly dues: DuesService) {}

  @Get()
  list(@Query() q: AgreementListQuery, @CurrentUser() u: AuthUser) {
    return this.dues.listAgreements(q, u);
  }

  @Post()
  @RequirePermissions(P.DUES_MANAGE)
  create(@Body() dto: AgreementDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.createAgreement(dto, u, meta);
  }

  @Patch(':id')
  @RequirePermissions(P.DUES_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgreementDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.updateAgreement(id, dto, u, meta);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadBody)
  @upload()
  addFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.dues.addAgreementDocument(id, file, u, meta);
  }

  @Get(':id/files/:fileId')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser) {
    const f = await this.dues.openAgreementDocument(id, fileId, u);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachment(f.name) });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(204)
  @RequirePermissions(P.DUES_MANAGE)
  async removeFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.dues.removeAgreementDocument(id, fileId, u, meta);
  }
}
