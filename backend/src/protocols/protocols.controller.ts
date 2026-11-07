import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta } from '../common/decorators';
import type { UploadedFileLike } from '../files/files.service';
import { ProtocolDto, ProtocolListQuery } from './protocols.dto';
import { ProtocolsService } from './protocols.service';

const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

@ApiTags('Протоколы')
@ApiBearerAuth()
@Controller('protocols')
export class ProtocolsController {
  constructor(private readonly protocols: ProtocolsService) {}

  @Get()
  list(@Query() q: ProtocolListQuery, @CurrentUser() u: AuthUser) {
    return this.protocols.list(q, u);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.protocols.get(id, u);
  }

  @Post()
  @ApiOperation({ summary: 'Создать черновик протокола (секретарь, админ; протокол РГ — её руководитель)' })
  create(@Body() dto: ProtocolDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.protocols.create(dto, u, meta);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProtocolDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.protocols.update(id, dto, u, meta);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.protocols.publish(id, u, meta);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.protocols.unpublish(id, u, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.protocols.remove(id, u, meta);
  }

  @Get(':id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const { name, content } = await this.protocols.pdf(id, u);
    return new StreamableFile(content, { type: 'application/pdf', disposition: attachment(name) });
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.protocols.addFile(id, file, u, meta);
  }

  @Get(':id/files/:fileId')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser) {
    const f = await this.protocols.openFile(id, fileId, u);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachment(f.name) });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(204)
  async removeFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.protocols.removeFile(id, fileId, u, meta);
  }
}
