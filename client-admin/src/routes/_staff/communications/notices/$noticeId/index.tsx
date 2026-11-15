/**
 * [53.4.01] `/communications/notices/$noticeId` — notice detail + read report for posters
 * (`NOTICE_POST`). Gated by `NOTICE_READ`: a staff reader without `NOTICE_POST` (accountant, exam
 * controller, committee) gets the reader view, so the attention bar's link opens (#3448).
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { NoticeDetail } from '../../../../../features/notices/manage/notice-detail';
import { MyNoticePage } from '../../../../../features/notices/read/my-notice-detail';
import { loadRouteNamespaces } from '../../../../../route-loaders';

export const Route = createFileRoute('/_staff/communications/notices/$noticeId/')({
  loader: () => loadRouteNamespaces('notices', 'nav', 'portalNotices'),
  pendingComponent: NoticeDetailPending,
  component: NoticeDetailPage,
});

function NoticeDetailPage() {
  const { noticeId } = Route.useParams();
  const canPost = useHasPermission(Permission.NOTICE_POST);
  return canPost ? (
    <NoticeDetail noticeId={noticeId} />
  ) : (
    <MyNoticePage id={noticeId} showBackLink={false} />
  );
}

function NoticeDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}
