# Epic 71 admission usability findings

**Status: Heuristic walkthrough done; human test still recommended before launch.**

> **This is NOT a human usability test.** No office staff or guardians were
> available, so the person "tested" is **simulated (Claude), not a human**. The
> walkthrough read the real mockup HTML (link graph, words, measured tap
> targets in Chromium at 390 px). It finds structural problems only. It cannot
> find confusion a real person would have, so it proves nothing about
> "unaided" or "inside the limit". Ticket #4169 acceptance boxes about real
> staff and guardians stay **UNTICKED**. Script:
> [`epic-71-admission-test-plan.md`](epic-71-admission-test-plan.md).

## Results (simulated, heuristic)

Clicks = links followed from the start page, counted from the HTML link graph.
"Estimate" = steps x about 10 s for a first-time user (reading plus tapping).
**It is a guess from step count, not a measured time.**

| Task | Limit | Persona | Clicks | Estimate (not measured) | Verdict |
|---|---|---|---|---|---|
| T1 open round, show on site | 05:00 | simulated (Claude), not a human: first-time office clerk | 6 (new round, 3x next, create, website tab) + fill 4 wizard pages | about 3-4 min | Path exists; needs human check (see issues 1, 2) |
| T2 enter walk-in application | 02:00 | same | 2 (Applicants tab, clerk entry) + fill form | about 1.5 min | Path exists; limit tight on a long form |
| T3 marks, merit list | 05:00 | same | 2 (enter marks, save) | about 2-3 min | Path exists |
| T4 check fee, confirm | 01:00 | same | 1 (Applicants is the start page; fee panel is on the same page) | about 30 s | Path exists; confirm button gives no feedback in the mockup |
| T5 guardian applies, looks up result | 04:00 | simulated (Claude), not a human: guardian on 390 px phone | 3 (apply, next step, see result) | about 2-3 min | Path exists; tap targets were too small (issue 5) |

## Issues found and what changed

| # | Issue | Kind | Fix in mockups |
|---|---|---|---|
| 1 | T1 says "show on the school website", but no screen says "website" until the Publication page; its tab was just "প্রকাশ" | missing affordance | Desk tab now "ওয়েবসাইটে প্রকাশ" |
| 2 | T1 ends on Publication whose Save went nowhere (dead end); the wizard itself has no website step | dead end | Save now opens the site home (13) so the clerk sees the result. Wizard still has no website step: **a human should say if they look for it there** |
| 3 | "পরের ধাপ" on wizard buttons clashes with the glossary word "ধাপ" (a pipeline stage) | glossary clash | Wizard buttons now "এগিয়ে যান" |
| 4 | Words not in the glossary: স্ক্রিনশট, ট্রানজেকশন নম্বর, মাধ্যম, রেফারেন্স, সারসংক্ষেপ, সংরক্ষণ, ফেরত পাঠানো, পাবলিক লিংক | glossary gap | Not changed: needs product call. Add to glossary or reword (open) |
| 5 | Phone tap targets under 44 px: breadcrumb links (15 px), rounds-list links (15 px), site header links (22-24 px), inline links (17 px), checkboxes (13 px) | tap target | All raised to 44 px on phone (`min-h-11`, `size-11`); the shoot report now lists 0 small targets on all 22 pages |
| 6 | Nested `max-w-3xl` inside `max-w-screen-xl` on 05, 10, 11, 12 (double wrapper) | layout | One container (`max-w-3xl`) per page |
| 7 | Fee "ফি ঠিক আছে / ফেরত পাঠান", Save and Submit buttons do not move anywhere | dead end by design | Not changed (test plan says so). A human cannot judge "did it work" here |
| 8 | Result lookup (11) always shows a sample result; wrong-answer text is shown too, not interactive | mockup limit | Not changed |

## Fixes made after the walkthrough

| Round | Mockup changed | Why | Re-checked |
|---|---|---|---|
| H1 | 01, 03*, 02-wizard-1..4, 05, 09, 10, 11, 12, 13 (HTML) and all 44 PNGs re-shot | issues 1-3, 5, 6 | shoot.mjs: 0 small targets, 0 overflow, 1 h1 on every page |

## Still needed before launch

- Run the real test: 2-3 office staff on T1-T4, 1-2 guardians on T5, per the plan.
- Decide issue 4 (glossary words) and issue 2 (website step in the wizard).
