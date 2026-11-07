import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { UploadedFileLike } from '../files/files.service';
import { CastBallotDto, ExtendVoteDto, VoteDraftDto, VoteListQuery } from './votes.dto';
import { VotesService } from './votes.service';

const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Голосования')
@ApiBearerAuth()
@Controller('votes')
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  @Get()
  @ApiOperation({ summary: 'Список и история голосований (видимость — по правам)' })
  list(@Query() q: VoteListQuery, @CurrentUser() user: AuthUser) {
    return this.votes.list(q, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка: вопросы, итоги в реальном времени, поимённая таблица, мой голос' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.votes.get(id, user);
  }

  @Post()
  @RequirePermissions(P.VOTES_CREATE)
  @ApiOperation({ summary: 'Создать черновик' })
  create(@Body() dto: VoteDraftDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.create(dto, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(P.VOTES_CREATE)
  @ApiOperation({ summary: 'Изменить черновик (вопросы заменяются целиком)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteDraftDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.update(id, dto, user, meta);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions(P.VOTES_CREATE)
  @ApiOperation({ summary: 'Опубликовать: фиксирует состав участников и рассылает уведомления' })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.publish(id, user, meta);
  }

  @Post(':id/ballot')
  @HttpCode(200)
  @RequirePermissions(P.VOTE_CAST)
  @ApiOperation({ summary: 'Проголосовать от имени своей организации (до окончания голос можно изменить)' })
  cast(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CastBallotDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.cast(id, dto, user, meta);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @RequirePermissions(P.VOTES_CREATE)
  extend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendVoteDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.extend(id, dto.endsAt, user, meta);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions(P.VOTES_CREATE)
  @ApiOperation({ summary: 'Завершить досрочно и подвести итоги' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.close(id, user, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.VOTES_CREATE)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.cancel(id, user, meta);
  }

  @Get(':id/protocol.pdf')
  @ApiOperation({ summary: 'Итоговый протокол (PDF)' })
  async protocol(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const f = await this.votes.protocol(id, user);
    return new StreamableFile(f.stream, { type: 'application/pdf', length: f.size, disposition: attachment(f.name) });
  }

  @Get(':id/export.csv')
  @ApiOperation({ summary: 'Выгрузка поимённых результатов (CSV для Excel)' })
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const { name, content } = await this.votes.exportCsv(id, user);
    return new StreamableFile(content, { type: 'text/csv; charset=utf-8', disposition: attachment(name) });
  }

  @Post(':id/files')
  @RequirePermissions(P.VOTES_CREATE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.votes.addAttachment(id, file, user, meta);
  }

  @Get(':id/files/:fileId')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: AuthUser) {
    const f = await this.votes.openAttachment(id, fileId, user);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachment(f.name) });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(204)
  @RequirePermissions(P.VOTES_CREATE)
  async removeFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.votes.removeAttachment(id, fileId, user, meta);
  }
}
