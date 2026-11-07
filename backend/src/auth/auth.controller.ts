import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { AllowMfaPending, CurrentUser, Public, ReqMeta } from '../common/decorators';
import { env } from '../config/env';
import { AuthService, LoginResult, SessionTokens } from './auth.service';
import { AcceptInvitationDto, ChangePasswordDto, ForgotPasswordDto, Login2faDto, LoginDto, ResetPasswordDto, TotpCodeDto } from './dto';

export const REFRESH_COOKIE = 'alliance_refresh';
const COOKIE_PATH = '/api/auth';
const STRICT = { default: { limit: 10, ttl: 60_000 } };

/**
 * Защита от CSRF для эндпоинтов, работающих по cookie: refresh-cookie имеет SameSite=Strict,
 * и дополнительно требуется заголовок X-CSRF, который браузер не отправит с чужого сайта без CORS-разрешения.
 */
function assertCsrfHeader(req: Request) {
  if (req.headers['x-csrf'] !== '1') throw new ForbiddenException('Отсутствует CSRF-заголовок');
}

@ApiTags('Аутентификация')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefreshCookie(res: Response, tokens: SessionTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }

  private respond(res: Response, result: LoginResult) {
    if (result.twoFactorRequired) return { twoFactorRequired: true, challengeToken: result.challengeToken };
    this.setRefreshCookie(res, result);
    return { twoFactorRequired: false, accessToken: result.accessToken };
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Вход по email и паролю. Если включена 2FA — вернёт challengeToken.' })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto.email, dto.password, meta));
  }

  @Public()
  @Throttle(STRICT)
  @Post('login/2fa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Второй шаг входа: код из приложения-аутентификатора' })
  async login2fa(@Body() dto: Login2faDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.loginWith2fa(dto.challengeToken, dto.code, meta);
    this.setRefreshCookie(res, tokens);
    return { twoFactorRequired: false, accessToken: tokens.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Новый access-токен по refresh-cookie (требует заголовок X-CSRF: 1)' })
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], meta);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @ApiBearerAuth()
  @AllowMfaPending()
  @Get('me')
  @ApiOperation({ summary: 'Текущий пользователь, его организация и права' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta);
  }

  @ApiBearerAuth()
  @AllowMfaPending()
  @Post('2fa/setup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Сгенерировать секрет TOTP и QR-код' })
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.auth.setupTotp(user);
  }

  @ApiBearerAuth()
  @AllowMfaPending()
  @Throttle(STRICT)
  @Post('2fa/enable')
  @HttpCode(204)
  async enable2fa(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.enableTotp(user, dto.code, meta);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('2fa/disable')
  @HttpCode(204)
  async disable2fa(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.disableTotp(user, dto.code, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Get('invitations/:token')
  @ApiOperation({ summary: 'Проверить приглашение' })
  invitation(@Param('token') token: string) {
    return this.auth.invitationInfo(token);
  }

  @Public()
  @Throttle(STRICT)
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Принять приглашение: задать пароль и войти' })
  async accept(@Body() dto: AcceptInvitationDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.acceptInvitation(dto.token, dto.password, meta));
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.forgotPassword(dto.email, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.resetPassword(dto.token, dto.password, meta);
  }
}
