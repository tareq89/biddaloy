/**
 * [8.10.7.7.03] `setup-checklist` widget (ADMIN, D8). D53: no
 * `/dashboard/widgets/setup-checklist` route. The card already reads the
 * light `GET /onboarding/status` and renders nothing once finished or hidden,
 * so the widget is the card in its slot. Every variant shows the card.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import type { ComponentType } from 'react';

import { SetupChecklistCard } from '../../../features/onboarding/setup-checklist-card';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.SETUP_CHECKLIST;

const SetupChecklistWidget: ComponentType<WidgetProps> = SetupChecklistCard;
export default SetupChecklistWidget;
