import { PRINT_BATCH_CEILING } from '@biddaloy/shared';
import { Button, toast } from '@biddaloy/ui/components';
import {
  fetchStageApplicants,
  useAdmissionRound,
  useSchoolProfile,
  type ApplicantRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';
import { useRouter } from '@tanstack/react-router';
import * as React from 'react';

import { previewIdsNav } from '../../../components/print/preview-ids';

import { PrintSheet, type PrintSheetData } from './PrintSheet';

export interface PrintStage {
  id: string;
  title: string | null;
  kind: string;
  date: string | null;
  start_time: string | null;
  venue: string | null;
}

/**
 * [71.5.01] The stage's prints. Admit cards go through the Epic 32 print flow (template, preview,
 * printer); the attendance sheet is a browser-printed table of everyone with a roll, in roll order.
 */
export function AdmissionPrintMenu({ roundId, stage }: { roundId: string; stage: PrintStage }) {
  const { t } = useTranslation('admission-desk');
  const region = useRegionConfig();
  const router = useRouter();
  const school = useSchoolProfile();
  const round = useAdmissionRound(roundId);
  const [busy, setBusy] = React.useState(false);
  const [sheet, setSheet] = React.useState<PrintSheetData | null>(null);

  async function load(): Promise<ApplicantRow[] | null> {
    setBusy(true);
    try {
      const rows = await fetchStageApplicants(roundId, stage.id);
      if (rows.length === 0) {
        toast.error(t('print.none'));
        return null;
      }
      return rows;
    } catch {
      toast.error(t('print.loadError'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function admitCards() {
    const rows = await load();
    if (!rows) return;
    // The preview batches by PRINT_BATCH_CEILING itself; never drop applicants here.
    if (rows.length > PRINT_BATCH_CEILING)
      toast.info(t('print.capped', { max: PRINT_BATCH_CEILING, total: rows.length }));
    const nav = previewIdsNav(rows.map((r) => r.id));
    const search = new URLSearchParams({
      kind: 'ADMISSION_ADMIT_CARD',
      subject_type: 'APPLICANT',
      context_type: 'ADMISSION_STAGE',
      context_id: stage.id,
      ...(nav.search.ids ? { ids: nav.search.ids } : {}),
      from: `/admissions/rounds/${roundId}?step=${stage.id}`,
    });
    router.history.push(`/print/preview?${search.toString()}`, nav.state);
  }

  async function attendance() {
    const rows = await load();
    if (!rows) return;
    const when = [stage.date, stage.start_time, stage.venue].filter(Boolean).join(' · ');
    setSheet({
      school: school.data?.name ?? '',
      title: t('print.attendanceTitle'),
      subtitle: [
        `${round.data?.title ?? ''} — ${stage.title || t(`desk.steps.kind.${stage.kind}`)}`,
        when,
      ]
        .filter(Boolean)
        .join(' · '),
      columns: [
        { key: 'roll', label: t('print.col.roll') },
        { key: 'name', label: t('print.col.name'), wide: true },
        { key: 'ref', label: t('print.col.reference') },
        { key: 'sign', label: t('print.col.signature') },
      ],
      rows: rows.map((r) => ({
        roll: renderDigits(r.roll_number ?? '', region.numerals),
        name: r.applicant_name,
        ref: r.reference_number,
        sign: '',
      })),
    });
  }

  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => void admitCards()}>
        {t('print.admitCards')}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => void attendance()}>
        {t('print.attendance')}
      </Button>
      {sheet ? <PrintSheet data={sheet} onDone={() => setSheet(null)} /> : null}
    </>
  );
}

/** [71.5.01] Prints a merit or waiting list (the members the desk loaded; warns when the list is longer). */
export function PrintListButton({
  roundId,
  title,
  members,
  total,
}: {
  roundId: string;
  title: string;
  members: { position: number; applicant_name: string }[];
  /** The list's full size; when above `members.length` the sheet is cut and the user is told. */
  total?: number;
}) {
  const { t } = useTranslation('admission-desk');
  const region = useRegionConfig();
  const school = useSchoolProfile();
  const round = useAdmissionRound(roundId);
  const [sheet, setSheet] = React.useState<PrintSheetData | null>(null);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          if (members.length === 0) return void toast.error(t('print.listEmpty'));
          if (total !== undefined && total > members.length)
            toast.info(t('print.listCut', { shown: members.length, total }));
          setSheet({
            school: school.data?.name ?? '',
            title,
            subtitle: round.data?.title ?? '',
            columns: [
              { key: 'serial', label: t('print.col.serial') },
              { key: 'name', label: t('print.col.name'), wide: true },
            ],
            rows: members.map((m) => ({
              serial: renderDigits(String(m.position), region.numerals),
              name: m.applicant_name,
            })),
          });
        }}
      >
        {t('print.list')}
      </Button>
      {sheet ? <PrintSheet data={sheet} onDone={() => setSheet(null)} /> : null}
    </>
  );
}
