import { http, HttpResponse } from 'msw';

import { invoiceFactory, type Invoice } from '../../factories';
import { paginate } from '../support';

const fixtures: Invoice[] = [invoiceFactory(), invoiceFactory(), invoiceFactory()];

const list = http.get('/api/v1/invoices', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/invoices', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getOne = http.get('/api/v1/invoices/:id', ({ params }) =>
  HttpResponse.json(invoiceFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/invoices', () =>
  HttpResponse.json(invoiceFactory(), { status: 201 }),
);

const print = http.get('/api/v1/invoices/:id/print', () =>
  HttpResponse.json('<html><body>Mock invoice printout</body></html>'),
);

export const invoiceHandlers = { list, listEmpty, getOne, create, print };

export const invoiceDefaultHandlers = [list, getOne, create, print];
