import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders the student welcome copy', () => {
    render(<App />);
    expect(screen.getByText('beton-boi Student')).toBeTruthy();
  });
});
