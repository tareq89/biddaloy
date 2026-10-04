# Shared requests — lane programs

- programs_programId | `ui/src/components/programs/milestone-checklist.tsx` (foundation) | rows `min-h-11 md:min-h-8`, kit Checkbox look, the "undo" control as a ghost button (not an underlined `text-destructive` link), `text-sm/text-muted-foreground` → kit tokens | the page passes `formatDate` output as `achievedOn` (D5 fixed) and the rows keep today's size/look
- programs_programId | students lane `client-admin/src/routes/_staff/students/-detail/programs-panel.tsx` | after programs-2b `EnrolDialog` / `RecordDialog` render as `FullPageShell`; open them via a search param on the student route so the modal is in the URL (D22) | they keep opening from local state — works, just no URL
