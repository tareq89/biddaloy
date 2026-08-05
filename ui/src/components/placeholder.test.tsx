import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Placeholder } from './placeholder';

describe('Placeholder', () => {
  it('renders its children', () => {
    render(<Placeholder>Hello from jsdom</Placeholder>);
    expect(screen.getByText('Hello from jsdom')).toBeTruthy();
  });
});
