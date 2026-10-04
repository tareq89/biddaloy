# Shared requests — lane classes

- classes-list | server `server/src/modules/classes/classes.service.ts:297-309` (class delete 409; was 309-321 before #1407) | the 409 carries `details: { code: 'CLASS_HAS_STUDENTS' | 'CLASS_HAS_SECTIONS', count }` instead of only an English message that embeds the class UUID | the delete dialog shows one translated "still has students or sections" sentence (no count) and never the server text
- class-detail | server `server/src/modules/classes/classes.service.ts:547` (section delete 409; was 611 before #1407) | same `details: { code: 'SECTION_HAS_STUDENTS', count }` — the `conflict(message, code)` helper the PR added for teacher assignment (`classes.service.ts:625`) is the shape to copy | the delete-section dialog shows one translated sentence (no count)
