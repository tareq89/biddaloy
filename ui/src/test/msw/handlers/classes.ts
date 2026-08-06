import { http, HttpResponse } from 'msw';

import { classFactory, classSectionFactory, type Class, type ClassSection } from '../../factories';
import { paginate } from '../support';

const fixtures: Class[] = [classFactory(), classFactory(), classFactory()];

const list = http.get('/api/v1/classes', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/classes', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getOne = http.get('/api/v1/classes/:id', ({ params }) =>
  HttpResponse.json(classFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/classes', () =>
  HttpResponse.json(classFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/classes/:id', ({ params }) =>
  HttpResponse.json(classFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/classes/:id', () => new HttpResponse(null, { status: 204 }));

const sectionFixtures: ClassSection[] = [classSectionFactory(), classSectionFactory()];

const listSections = http.get('/api/v1/classes/:classId/sections', ({ params }) =>
  HttpResponse.json(
    sectionFixtures.map((section) => ({
      ...section,
      class: { ...section.class, id: params.classId as string },
      class_id: params.classId as string,
    })),
  ),
);

const createSection = http.post('/api/v1/classes/:classId/sections', ({ params }) =>
  HttpResponse.json(classSectionFactory({ class_id: params.classId as string }), { status: 201 }),
);

const updateSection = http.patch('/api/v1/classes/:classId/sections/:sectionId', ({ params }) =>
  HttpResponse.json(
    classSectionFactory({ id: params.sectionId as string, class_id: params.classId as string }),
  ),
);

const removeSection = http.delete(
  '/api/v1/classes/:classId/sections/:sectionId',
  () => new HttpResponse(null, { status: 204 }),
);

export const classHandlers = {
  list,
  listEmpty,
  getOne,
  create,
  update,
  remove,
  listSections,
  createSection,
  updateSection,
  removeSection,
};

export const classDefaultHandlers = [
  list,
  getOne,
  create,
  update,
  remove,
  listSections,
  createSection,
  updateSection,
  removeSection,
];
