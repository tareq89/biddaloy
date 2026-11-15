/**
 * [71.4.09] Make the merit list or a waiting list: seats, last date, and (waiting only) how people
 * are chosen. Seats above the free seats are refused here; the server checks again.
 */
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import {
  useAdmissionApplicants,
  useCreateMeritList,
  useCreateWaitingList,
  type CreateWaitingListInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, parseServerDate, toIsoDate, toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

type Order = CreateWaitingListInput['order'];
const ORDERS: Order[] = ['MERIT', 'FIRST_COME', 'MANUAL', 'FILTER'];
const QUOTAS = [
  'quota_freedom_fighter',
  'quota_teacher_child',
  'quota_disabled',
  'quota_ethnic_minority',
];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const ANY = '__any__';

export function ListBuildDialog({
  roundId,
  kind,
  seatsLeft,
  open,
  onOpenChange,
}: {
  roundId: string;
  kind: 'MERIT' | 'WAITING';
  seatsLeft: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('admission-lists');
  const region = useRegionConfig();
  const merit = useCreateMeritList(roundId);
  const waiting = useCreateWaitingList(roundId);
  const waitingKind = kind === 'WAITING';
  const [capacity, setCapacity] = React.useState(String(seatsLeft));
  const [deadline, setDeadline] = React.useState('');
  const [order, setOrder] = React.useState<Order>('MERIT');
  const [picked, setPicked] = React.useState<{ id: string; name: string }[]>([]);
  const [quotas, setQuotas] = React.useState<string[]>([]);
  const [minScore, setMinScore] = React.useState('');
  const [gender, setGender] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const busy = merit.isPending || waiting.isPending;
  // Hand-picked: anyone without a place or a closed answer yet (ponytail: first 100, search later).
  const pool = useAdmissionApplicants({ intakeId: roundId, limit: 100 });
  const candidates = (pool.data?.data ?? []).filter((a) =>
    ['PENDING', 'SHORTLISTED', 'WAITING'].includes(a.status),
  );

  const cap = Number(toLatinDigits(capacity));
  const capOk = Number.isInteger(cap) && cap >= 1 && cap <= seatsLeft;
  const scoreText = toLatinDigits(minScore).trim();
  const scoreOk = scoreText === '' || /^\d{1,6}(\.\d{1,2})?$/.test(scoreText);
  const pickedOk = order !== 'MANUAL' || picked.length > 0;
  const problem = !capOk
    ? 'capacity'
    : !deadline
      ? 'deadline'
      : !scoreOk
        ? 'score'
        : !pickedOk
          ? 'picked'
          : null;

  function move(i: number, d: -1 | 1) {
    setPicked((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  function toggle(id: string, name: string, on: boolean) {
    setPicked((p) => (on ? [...p, { id, name }] : p.filter((x) => x.id !== id)));
  }

  async function save() {
    setTried(true);
    setFailed(false);
    if (problem) return;
    try {
      const res = waitingKind
        ? await waiting.mutateAsync({
            capacity: cap,
            act_by_date: deadline,
            order,
            ...(order === 'MANUAL' ? { applicant_ids: picked.map((p) => p.id) } : {}),
            ...(order === 'FILTER'
              ? {
                  filter: {
                    ...(quotas.length ? { quota_tags: quotas } : {}),
                    ...(scoreText ? { min_score: Number(scoreText) } : {}),
                    ...(gender ? { gender } : {}),
                  },
                }
              : {}),
          })
        : await merit.mutateAsync({ capacity: cap, act_by_date: deadline });
      toast.success(t('toast.created', { count: formatNumber(res.affected, region) }));
      onOpenChange(false);
    } catch {
      setFailed(true);
    }
  }

  const errorKey = tried ? problem : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t(waitingKind ? 'build.titleWaiting' : 'build.titleMerit')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="lst-cap">{t('build.capacity')}</Label>
              <Input
                id="lst-cap"
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
              <p className="text-caption text-text-secondary">
                {t('build.capacityHelp', { max: formatNumber(seatsLeft, region) })}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lst-deadline">{t('build.deadline')}</Label>
              <DatePicker
                id="lst-deadline"
                aria-label={t('build.deadline')}
                config={region}
                value={deadline ? parseServerDate(deadline) : undefined}
                onValueChange={(d) => setDeadline(d ? toIsoDate(d) : '')}
                clearable={false}
              />
            </div>
          </div>

          {waitingKind ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-label font-medium">{t('build.order')}</legend>
              <RadioGroup value={order} onValueChange={(v) => setOrder(v as Order)}>
                {ORDERS.map((o) => (
                  <div key={o} className="flex items-center gap-2">
                    <RadioGroupItem id={`lst-order-${o}`} value={o} />
                    <Label htmlFor={`lst-order-${o}`}>{t(`build.orders.${o}`)}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          ) : null}

          {waitingKind && order === 'MANUAL' ? (
            <section className="flex flex-col gap-2" aria-label={t('build.pickTitle')}>
              <h3 className="font-medium">{t('build.pickTitle')}</h3>
              <p className="text-sm text-text-secondary">{t('build.pickHelp')}</p>
              {pool.isPending ? (
                <p role="status">{t('build.pickLoading')}</p>
              ) : candidates.length === 0 && picked.length === 0 ? (
                <p>{t('build.pickEmpty')}</p>
              ) : (
                <ul className="max-h-48 divide-y overflow-auto rounded-md border">
                  {candidates.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-2 py-1">
                      <Checkbox
                        aria-label={t('build.pick', { name: a.applicant_name })}
                        checked={picked.some((p) => p.id === a.id)}
                        onCheckedChange={(v) => toggle(a.id, a.applicant_name, v === true)}
                      />
                      <span>{a.applicant_name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {picked.length > 0 ? (
                <>
                  <p className="text-sm font-medium">
                    {t('build.picked', { count: formatNumber(picked.length, region) })}
                  </p>
                  <ol className="flex flex-col gap-1">
                    {picked.map((p, i) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="tabular-nums">{formatNumber(i + 1, region)}.</span>
                        <span className="flex-1">{p.name}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t('build.up', { name: p.name })}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t('build.down', { name: p.name })}
                          disabled={i === picked.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </Button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </section>
          ) : null}

          {waitingKind && order === 'FILTER' ? (
            <section className="flex flex-col gap-3" aria-label={t('build.filterTitle')}>
              <h3 className="font-medium">{t('build.filterTitle')}</h3>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="mb-1 text-label">{t('build.quota')}</legend>
                {QUOTAS.map((q) => (
                  <div key={q} className="flex items-center gap-2">
                    <Checkbox
                      id={`lst-${q}`}
                      checked={quotas.includes(q)}
                      onCheckedChange={(v) =>
                        setQuotas((c) => (v === true ? [...c, q] : c.filter((x) => x !== q)))
                      }
                    />
                    <Label htmlFor={`lst-${q}`}>{t(`build.quotas.${q}`)}</Label>
                  </div>
                ))}
              </fieldset>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="lst-score">{t('build.minScore')}</Label>
                  <Input
                    id="lst-score"
                    inputMode="decimal"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="lst-gender">{t('build.gender')}</Label>
                  <Select
                    value={gender || ANY}
                    onValueChange={(v) => setGender(v === ANY ? '' : v)}
                  >
                    <SelectTrigger id="lst-gender">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>{t('build.genderAny')}</SelectItem>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {t(`build.genders.${g}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
          ) : null}

          {errorKey || failed ? (
            <p role="alert" className="text-sm text-destructive">
              {errorKey
                ? t(`build.errors.${errorKey}`, { max: formatNumber(seatsLeft, region) })
                : t('build.errors.save')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('build.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {busy ? t('build.saving') : t('build.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
