/**
 * [28.4.2] The one "Report an incident" form (U7). Rendered from a staff
 * member's Incidents tab (`staffUserId` set) and from the evaluations page
 * when the palette opens it via `?reportIncident=1` (staff picker shown).
 * Validation is on submit; errors are announced via `role="alert"`.
 * Ctrl/Cmd+Enter submits from anywhere in the form.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useReportIncident, type IncidentSeverity, type IncidentType } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { StaffSelect } from './staff-select';

const TYPES: IncidentType[] = ['BEHAVIOUR', 'ABSENCE', 'COMPLAINT', 'COMMENDATION', 'OTHER'];
const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

export interface ReportIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled staff member; when absent a picker is shown. */
  staffUserId?: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Field = 'staff' | 'type' | 'severity' | 'date' | 'description';
type Errors = Partial<Record<Field, string>>;

export function ReportIncidentDialog({
  open,
  onOpenChange,
  staffUserId,
}: ReportIncidentDialogProps) {
  const { t } = useTranslation('evaluations');
  const report = useReportIncident();
  const [staff, setStaff] = React.useState(staffUserId ?? '');
  const [type, setType] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [date, setDate] = React.useState(today);
  const [description, setDescription] = React.useState('');
  const [errors, setErrors] = React.useState<Errors>({});

  React.useEffect(() => {
    if (!open) return;
    setStaff(staffUserId ?? '');
    setType('');
    setSeverity('');
    setDate(today());
    setDescription('');
    setErrors({});
    report.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!staff) next.staff = t('incident.errorStaff');
    if (!type) next.type = t('incident.errorType');
    if (!severity) next.severity = t('incident.errorSeverity');
    if (!date) next.date = t('incident.errorDate');
    else if (date > today()) next.date = t('incident.errorFuture');
    if (!description.trim()) next.description = t('incident.errorDescription');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    report.mutate(
      {
        staffId: staff,
        type: type as IncidentType,
        severity: severity as IncidentSeverity,
        occurredOn: date,
        description: description.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t('incident.reported'));
          onOpenChange(false);
        },
      },
    );
  }

  const errId = (f: Field) => `incident-${f}-error`;
  const aria = (f: Field) =>
    errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': errId(f) } : {};
  const err = (f: Field) =>
    errors[f] ? (
      <p id={errId(f)} role="alert" className="text-sm text-destructive">
        {errors[f]}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('incident.reportTitle')}</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Ctrl+Enter bubbles from the focused field; the form itself is not the target */}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          {staffUserId === undefined && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="incident-staff" className="text-sm font-medium">
                {t('incident.staffLabel')}
              </label>
              <StaffSelect
                id="incident-staff"
                value={staff}
                onValueChange={setStaff}
                {...(errors.staff ? { describedBy: errId('staff') } : {})}
              />
              {err('staff')}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-type" className="text-sm font-medium">
              {t('incident.typeLabel')}
            </label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="incident-type" {...aria('type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`incident.types.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err('type')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-severity" className="text-sm font-medium">
              {t('incident.severityLabel')}
            </label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger id="incident-severity" {...aria('severity')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`incident.severities.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err('severity')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-date" className="text-sm font-medium">
              {t('incident.occurredOnLabel')}
            </label>
            <Input
              id="incident-date"
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              {...aria('date')}
            />
            {err('date')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-description" className="text-sm font-medium">
              {t('incident.descriptionLabel')}
            </label>
            <Textarea
              id="incident-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              {...aria('description')}
            />
            {err('description')}
          </div>
          {report.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('incident.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" loading={report.isPending}>
              {report.isPending ? t('incident.submitting') : t('incident.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
