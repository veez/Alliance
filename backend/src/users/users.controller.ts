import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import { InviteUserDto, UpdateProfileDto, UpdateUserDto, UserListQuery } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('Пользователи (админка)')
@ApiBearerAuth()
@Controller('admin/users')
@RequirePermissions(P.USERS_MANAGE)
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() q: UserListQuery) {
    return this.users.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post('invite')
  @ApiOperation({ summary: 'Пригласить пользователя (письмо со ссылкой; ссылка также возвращается в ответе)' })
  invite(@Body() dto: InviteUserDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.invite(dto, actor, meta);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.resendInvitation(id, actor, meta);
  }

  @Patch(':id')
  @RequirePermissions(P.USERS_MANAGE, P.ROLES_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.update(id, dto, actor, meta);
  }

  @Post(':id/reset-2fa')
  @HttpCode(204)
  async reset2fa(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.users.reset2fa(id, actor, meta);
  }

  @Post(':id/unlock')
  @HttpCode(204)
  async unlock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.users.unlock(id, actor, meta);
  }
}

@ApiTags('Профиль')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  @ApiOperation({ summary: 'Изменить собственные ФИО, должность, телефон' })
  update(@Body() dto: UpdateProfileDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.updateProfile(actor, dto, meta);
  }
}
