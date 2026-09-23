import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/routines', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('picking a class lists its sections, linking each into the builder', async () => {
    const klass = { ...classFactory({ id: 'class-1', name: 'Class 6' }), section_count: 1, student_count: 40 };
    const section = classSectionFactory({
      id: 'section-1',
      class: klass,
      class_id: 'class-1',
      section_name: 'A',
    });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/class-1/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 40 }]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Class 6' })).toBeTruthy(),
    );
    await user.selectOptions(screen.getByLabelText('Class'), 'class-1');

    const link = await screen.findByRole('link', { name: /A.*student/ });
    expect(link.getAttribute('href')).toBe('/routines/section-1?classId=class-1');
  });
});
