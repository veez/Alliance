import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { UploadedFileLike } from '../files/files.service';
import { CommentDto, CommentQuery, MemberDto, MemberRoleDto, PlanItemDto, TaskDto, TaskListQuery, UpdatePlanItemDto, UpdateTaskDto, UpdateWorkingGroupDto, WorkingGroupDto } from './wg.dto';
import { WorkingGroupsService } from './wg.service';

const attachment = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Рабочие группы')
@ApiBearerAuth()
@Controller('working-groups')
export class WorkingGroupsController {
  constructor(private readonly wg: WorkingGroupsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.wg.list(u);
  }

  @Get('my-activity')
  @ApiOperation({ summary: 'Мои группы и задачи (для главной)' })
  myActivity(@CurrentUser() u: AuthUser) {
    return this.wg.myActivity(u);
  }

  @Get(':id')
  get(@Id() id: string, @CurrentUser() u: AuthUser) {
    return this.wg.get(id, u);
  }

  @Post()
  @RequirePermissions(P.WG_MANAGE)
  create(@Body() dto: WorkingGroupDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.create(dto, u, meta);
  }

  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateWorkingGroupDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.update(id, dto, u, meta);
  }

  // Участники
  @Get(':id/candidates')
  @ApiOperation({ summary: 'Кого можно добавить в группу' })
  candidates(@Id() id: string, @CurrentUser() u: AuthUser) {
    return this.wg.candidates(id, u);
  }

  @Post(':id/members')
  addMember(@Id() id: string, @Body() dto: MemberDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.addMember(id, dto, u, meta);
  }

  @Patch(':id/members/:userId')
  setRole(@Id() id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: MemberRoleDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.setRole(id, userId, dto.role, u, meta);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(@Id() id: string, @Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.wg.removeMember(id, userId, u, meta);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@Id() id: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.join(id, u, meta);
  }

  // План
  @Post(':id/plan')
  addPlanItem(@Id() id: string, @Body() dto: PlanItemDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.addPlanItem(id, dto, u, meta);
  }

  @Patch(':id/plan/:itemId')
  updatePlanItem(@Id() id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdatePlanItemDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.updatePlanItem(id, itemId, dto, u, meta);
  }

  @Delete(':id/plan/:itemId')
  @HttpCode(204)
  async removePlanItem(@Id() id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.wg.removePlanItem(id, itemId, u, meta);
  }

  // Задачи
  @Get(':id/tasks')
  tasks(@Id() id: string, @Query() q: TaskListQuery, @CurrentUser() u: AuthUser) {
    return this.wg.tasks(id, q, u);
  }

  @Post(':id/tasks')
  createTask(@Id() id: string, @Body() dto: TaskDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.createTask(id, dto, u, meta);
  }

  @Patch(':id/tasks/:taskId')
  updateTask(@Id() id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: UpdateTaskDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.updateTask(id, taskId, dto, u, meta);
  }

  @Delete(':id/tasks/:taskId')
  @HttpCode(204)
  async removeTask(@Id() id: string, @Param('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.wg.removeTask(id, taskId, u, meta);
  }

  // Обсуждения
  @Get(':id/comments')
  comments(@Id() id: string, @Query() q: CommentQuery, @CurrentUser() u: AuthUser) {
    return this.wg.comments(id, q, u);
  }

  @Post(':id/comments')
  addComment(@Id() id: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser) {
    return this.wg.addComment(id, dto, u);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(204)
  async removeComment(@Id() id: string, @Param('commentId', ParseUUIDPipe) commentId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.wg.removeComment(id, commentId, u, meta);
  }

  // Файлы
  @Get(':id/files')
  files(@Id() id: string, @CurrentUser() u: AuthUser) {
    return this.wg.filesList(id, u);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  addFile(@Id() id: string, @UploadedFile() file: UploadedFileLike, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.wg.addFile(id, file, u, meta);
  }

  @Get(':id/files/:fileId')
  async file(@Id() id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser) {
    const f = await this.wg.openFile(id, fileId, u);
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachment(f.name) });
  }

  @Delete(':id/files/:fileId')
  @HttpCode(204)
  async removeFile(@Id() id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.wg.removeFile(id, fileId, u, meta);
  }
}
