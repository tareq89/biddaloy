import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render-with-providers';

import { ImageViewer, type ImageViewerFile } from './image-viewer';

const labels = {
  openFile: 'Open file',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  previous: 'Previous',
  next: 'Next',
};
const files: ImageViewerFile[] = [
  { url: '/a.png', contentType: 'image/png', label: 'Receipt A' },
  { url: '/b.png', contentType: 'image/png', label: 'Receipt B' },
  { url: '/c.pdf', contentType: 'application/pdf', label: 'Slip PDF' },
];

async function setup() {
  const result = renderWithProviders(<ImageViewer files={files} labels={labels} />, {
    locale: 'en',
  });
  await result.localeReady;
  return result;
}

describe('ImageViewer', () => {
  it('renders image thumbnails and a PDF link, axe clean', async () => {
    const { container } = await setup();
    expect(screen.getByRole('button', { name: 'Receipt A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Receipt B' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /Slip PDF/ });
    expect(link.getAttribute('href')).toBe('/c.pdf');
    expect(screen.queryByRole('dialog')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('opens on Enter, arrows move, zoom toggles, Esc returns focus', async () => {
    const user = userEvent.setup();
    await setup();
    const thumb = screen.getByRole('button', { name: 'Receipt A' });
    thumb.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('img', { name: 'Receipt A' })).toBeTruthy();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('img', { name: 'Receipt B' })).toBeTruthy();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('img', { name: 'Receipt A' })).toBeTruthy();

    const zoom = screen.getByRole('button', { name: 'Zoom in' });
    await user.click(zoom);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(document.activeElement).toBe(thumb);
  });
});
