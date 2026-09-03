import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldGrid } from './field-grid';

describe('FieldGrid', () => {
  it('renders a <dl> of <dt>/<dd> label/value pairs', () => {
    render(
      <FieldGrid>
        <Field label="Date of birth">12 Jan 2015</Field>
        <Field label="Gender">Male</Field>
      </FieldGrid>,
    );
    const dl = screen.getByText('Date of birth').closest('dl');
    expect(dl).toBeTruthy();
    expect(screen.getByText('Date of birth').tagName).toBe('DT');
    expect(screen.getByText('12 Jan 2015').tagName).toBe('DD');
  });

  it('applies the max-w-4xl measure cap', () => {
    render(
      <FieldGrid>
        <Field label="Gender">Male</Field>
      </FieldGrid>,
    );
    const dl = screen.getByText('Gender').closest('dl');
    expect(dl?.className).toMatch(/max-w-4xl/);
  });

  it('merges a caller className without dropping the measure cap', () => {
    render(
      <FieldGrid className="mt-4">
        <Field label="Gender">Male</Field>
      </FieldGrid>,
    );
    const dl = screen.getByText('Gender').closest('dl');
    expect(dl?.className).toMatch(/max-w-4xl/);
    expect(dl?.className).toMatch(/mt-4/);
  });

  it('is axe clean', async () => {
    const { container } = render(
      <FieldGrid>
        <Field label="Date of birth">12 Jan 2015</Field>
        <Field label="Gender">Male</Field>
      </FieldGrid>,
    );
    await expect(container).toHaveNoViolations();
  });
});
