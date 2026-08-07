// One entry per shell `playwright.config.ts` boots via `webServer`. Page
// objects and fixtures ([8.5.2], [8.5.3]) key off this list instead of
// hardcoding ports, so a new shell only has to be added here.
export const shells = {
  student: { baseURL: 'http://localhost:5173/student/', heading: 'beton-boi Student' },
  admin: { baseURL: 'http://localhost:5174/admin/', heading: 'beton-boi Admin' },
} as const;
