import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessService } from './access/access.service';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { env } from './config/env';
import { EmployeesController, EmployeesService, ReferenceController } from './employees/employees';
import { FilesModule } from './files/files.service';
import { HealthController } from './health.controller';
import { MailModule } from './mail/mail.service';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { PrismaModule } from './prisma/prisma.service';
import { AdminUsersController, ProfileController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { NotificationsModule } from './notifications/notifications.service';
import { SettingsModule } from './settings/settings.service';
import { AgreementsController, DuesController } from './dues/dues.controller';
import { DuesScheduler } from './dues/dues.scheduler';
import { DuesService } from './dues/dues.service';
import { EventsController, EventsScheduler } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ProtocolsController } from './protocols/protocols.controller';
import { ProtocolsService } from './protocols/protocols.service';
import { VotesController } from './votes/votes.controller';
import { VotesScheduler } from './votes/votes.scheduler';
import { VotesService } from './votes/votes.service';
import { WorkingGroupsController } from './working-groups/wg.controller';
import { WorkingGroupsService } from './working-groups/wg.service';
import { CommunityController, CommunityService } from './community/community';
import { NotificationsController } from './notifications/notifications.controller';
import { AdminSettingsController } from './settings/admin-settings.controller';
import { MailingsController, MailingsService } from './mailings/mailings';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    FilesModule,
    SettingsModule,
    NotificationsModule,
    JwtModule.register({
      global: true,
      secret: env.jwtAccessSecret,
      signOptions: { expiresIn: env.jwtAccessTtl as never },
    }),
    // Общий лимит запросов; для входа и сброса пароля — строже (см. AuthController)
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: env.isTest ? 10_000 : 300 }], skipIf: () => env.isTest }),
  ],
  controllers: [
    HealthController,
    AuthController,
    AdminUsersController,
    ProfileController,
    OrganizationsController,
    EmployeesController,
    ReferenceController,
    AuditController,
    VotesController,
    DuesController,
    AgreementsController,
    EventsController,
    ProtocolsController,
    CommunityController,
    NotificationsController,
    AdminSettingsController,
    MailingsController,
    WorkingGroupsController, // после ReferenceController: /working-groups/brief
  ],
  providers: [
    AccessService,
    AuditService,
    AuthService,
    UsersService,
    OrganizationsService,
    EmployeesService,
    VotesService,
    VotesScheduler,
    DuesService,
    DuesScheduler,
    EventsService,
    EventsScheduler,
    ProtocolsService,
    WorkingGroupsService,
    CommunityService,
    MailingsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
