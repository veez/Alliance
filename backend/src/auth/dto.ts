import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from './crypto';

export class LoginDto {
  @ApiProperty({ example: 'admin@alliance.local' })
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: 'Код состоит из 6 цифр' })
  code: string;
}

export class Login2faDto extends TotpCodeDto {
  @ApiProperty({ description: 'challengeToken из ответа /auth/login' })
  @IsString()
  challengeToken: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов` })
  @MaxLength(200)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;
}

export class ResetPasswordDto extends AcceptInvitationDto {}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов` })
  @MaxLength(200)
  newPassword: string;
}
