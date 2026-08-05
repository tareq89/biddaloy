import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders the admin welcome copy', () => {
    render(<App />);
    expect(screen.getByText('beton-boi Admin')).toBeTruthy();
  });
});
