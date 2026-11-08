import { Center, Loader } from '@mantine/core';
import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import { AuditPage } from './pages/admin/AuditPage';
import { UsersPage } from './pages/admin/UsersPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordPages';
import { InvitePage } from './pages/auth/InvitePage';
import { LoginPage } from './pages/auth/LoginPage';
import { Setup2faPage } from './pages/auth/Setup2faPage';
import { DashboardPage } from './pages/DashboardPage';
import { DuesPage } from './pages/dues/DuesPage';
import { MyOrganizationPage } from './pages/MyOrganizationPage';
import { OrganizationPage } from './pages/OrganizationPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { VoteEditorPage } from './pages/votes/VoteEditorPage';
import { VotePage } from './pages/votes/VotePage';
import { VotesPage } from './pages/votes/VotesPage';
import { EventPage } from './pages/events/EventPage';
import { EventsPage } from './pages/events/EventsPage';
import { ProtocolEditorPage } from './pages/events/ProtocolEditorPage';
import { ProtocolPage } from './pages/events/ProtocolPage';
import { WorkingGroupPage } from './pages/wg/WorkingGroupPage';
import { WorkingGroupsPage } from './pages/wg/WorkingGroupsPage';
import { ContactsPage } from './pages/map/ContactsPage';
import { MapPage } from './pages/map/MapPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { MailingsPage } from './pages/admin/MailingsPage';

function FullScreenLoader() {
  return (
    <Center h="100vh">
      <Loader />
    </Center>
  );
}

/** Только для вошедших; админ/секретарь без 2FA перенаправляется на её настройку. */
function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me.mfaSetupPending && location.pathname !== '/setup-2fa') return <Navigate to="/setup-2fa" replace />;
  return <>{children}</>;
}

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <Navigate to="/" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return me ? <Navigate to="/" replace /> : <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/invite" element={<InvitePage />} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/setup-2fa" element={<Protected><Setup2faPage /></Protected>} />

      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="my-organization" element={<MyOrganizationPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:id" element={<OrganizationPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin/users" element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>} />
        <Route path="admin/settings" element={<RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission>} />
        <Route path="admin/mailings" element={<RequirePermission permission="mailings.send"><MailingsPage /></RequirePermission>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin/audit" element={<RequirePermission permission="audit.read"><AuditPage /></RequirePermission>} />
        <Route path="votes" element={<VotesPage />} />
        <Route path="votes/new" element={<RequirePermission permission="votes.create"><VoteEditorPage /></RequirePermission>} />
        <Route path="votes/:id" element={<VotePage />} />
        <Route path="votes/:id/edit" element={<RequirePermission permission="votes.create"><VoteEditorPage /></RequirePermission>} />
        <Route path="dues" element={<DuesPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventPage />} />
        <Route path="protocols/new" element={<ProtocolEditorPage />} />
        <Route path="protocols/:id" element={<ProtocolPage />} />
        <Route path="protocols/:id/edit" element={<ProtocolEditorPage />} />
        <Route path="working-groups" element={<WorkingGroupsPage />} />
        <Route path="working-groups/:id" element={<WorkingGroupPage />} />
        <Route path="map" element={<RequirePermission permission="map.read"><MapPage /></RequirePermission>} />
        <Route path="contacts" element={<RequirePermission permission="contacts.read"><ContactsPage /></RequirePermission>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
