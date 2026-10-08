import {
  familyAdmitCardAssetBase,
  printFamilyAdmitCard,
  type PrinterRow,
} from '@biddaloy/ui/hooks';

import {
  defaultRunPrintDeps,
  runPrint,
  type RunPrintDeps,
} from '../../components/print/preview/run-print';

/** Families have no printer profiles: a fixed A4 office sheet; 2 cards per sheet come from `layoutPages` (D28). */
export const FAMILY_PRINTER: PrinterRow = {
  id: 'family-a4',
  name: 'A4',
  printer_type: 'OFFICE',
  margin_top_mm: 5,
  margin_right_mm: 5,
  margin_bottom_mm: 5,
  margin_left_mm: 5,
  offset_x_mm: 0,
  offset_y_mm: 0,
  scale: 1,
  duplex_order: 'INTERLEAVED',
  sheet_gap_mm: 2,
  archived_at: null,
};

/**
 * The family's admit card through the shared print engine (`runPrint`), with the
 * server-picked template and the family asset route. Call synchronously from the
 * click handler: `openPrintWindow` must open the tab before any await (popup blockers).
 */
export function printAdmitCard(
  args: {
    studentId: string;
    examId: string;
    tenantId: string;
    lang: string;
    title: string;
    onError: (error: Error) => void;
  },
  deps: RunPrintDeps = defaultRunPrintDeps,
) {
  const { studentId, examId, ...rest } = args;
  return runPrint(
    {
      ...rest,
      // The body is ignored: the swapped `createPrintJob` takes no input.
      request: { kind: 'create', body: {} as never },
      printer: FAMILY_PRINTER,
      assets: [],
      subjectType: 'STUDENT',
      assetPath: familyAdmitCardAssetBase(studentId, examId),
    },
    { ...deps, createPrintJob: () => printFamilyAdmitCard(studentId, examId) },
  );
}
