/**
 * Shows a fresh set of recovery codes once, with copy, download (`.txt`) and a
 * "I saved these" checkbox. Presentational: every string is a prop, the codes
 * are never logged or stored here; the only copies leave through the user's
 * own copy/download action. `onAcknowledged(checked)` lets the consumer gate
 * its "Continue" button.
 */
import { CheckIcon, CopyIcon, DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';

export const RECOVERY_CODES_FILENAME = 'biddaloy-recovery-codes.txt';

export interface RecoveryCodesCardLabels {
  title: string;
  /** One line: keep these somewhere safe, each works once. */
  description: string;
  copy: string;
  copied: string;
  download: string;
  /** Label of the acknowledge checkbox. */
  acknowledge: string;
}

export interface RecoveryCodesCardProps {
  codes: string[];
  labels: RecoveryCodesCardLabels;
  onAcknowledged: (checked: boolean) => void;
  /** Heading element; defaults to `h2`. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

export function RecoveryCodesCard({
  codes,
  labels,
  onAcknowledged,
  headingLevel: Heading = 'h2',
  className,
}: RecoveryCodesCardProps) {
  const [copied, setCopied] = React.useState(false);
  const ackId = React.useId();
  const text = codes.join('\n');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked: the visible list and the download still work.
    }
  }

  function handleDownload() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_CODES_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card padded className={className}>
      <div className="flex flex-col gap-4">
        <div>
          <Heading className="text-h2 text-balance">{labels.title}</Heading>
          <p className="mt-0.5 text-text-secondary">{labels.description}</p>
        </div>

        <ul className="grid grid-cols-1 gap-2 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-2">
          {codes.map((code) => (
            <li key={code} dir="ltr">
              {code}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void handleCopy()}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? labels.copied : labels.copy}
          </Button>
          <Button type="button" variant="outline" onClick={handleDownload}>
            <DownloadIcon aria-hidden="true" />
            {labels.download}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id={ackId} onCheckedChange={(state) => onAcknowledged(state === true)} />
          <label htmlFor={ackId} className="text-sm">
            {labels.acknowledge}
          </label>
        </div>
      </div>
    </Card>
  );
}
