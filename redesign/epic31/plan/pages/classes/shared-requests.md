# Shared requests — lane classes

- classes-list | server `server/src/modules/classes/classes.service.ts:309-321` (class delete 409) | the 409 carries `details: { code: 'CLASS_HAS_STUDENTS' | 'CLASS_HAS_SECTIONS', count }` instead of only an English message that embeds the class UUID | the delete dialog shows one translated "still has students or sections" sentence (no count) and never the server text
- class-detail | server `server/src/modules/classes/classes.service.ts:611` (section delete 409) | same `details: { code: 'SECTION_HAS_STUDENTS', count }` | the delete-section dialog shows one translated sentence (no count)
