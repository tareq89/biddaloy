<!-- guide:meta
feature: reports.applications
title: Application reports
summary: See on one page how many applications were submitted, how many were approved or rejected, the average time to decide, which ones have waited more than 3 days, who is on leave today and how many days each staff member took.
roles: [ADMIN, EXECUTIVE, OFFICE_STAFF]
sources:
  - client-admin/src/routes/_staff/applications/reports.tsx
  - client-admin/src/routes/_staff/applications/-reports/applications-reports.tsx
  - client-admin/src/routes/_staff/applications/-reports/report-tables.tsx
  - server/src/modules/applications/application-reports.controller.ts
  - server/src/modules/applications/application-reports.service.ts
labels:
  [
    applicationsReports:*,
    nav:items.applicationsReportsNav,
    nav:groups.reports,
  ]
helpIds:
  [
    reports.applications,
    reports.applications.field.academicYear,
    reports.applications.field.submitted,
  ]
devices: [desktop]
entry: [sidebar, palette]
keywords:
  [application, applications report, report, pending, approved, rejected, leave, on leave today, staff leave]
appVersion: 0.1.0 (3f7e424fc)
owner: tareq89
lastVerified: 2026-10-25
knownIssues:
  - { id: year-default-counts-all, checked: 2026-10-25, issue: null }
-->

# Application reports

See the count of all the school's applications, and who is on leave today, on one page.

**Where to go:** in the left menu, **Reports → Application reports**. View this page on a computer.
**Before you start:** be an Admin, Academic coordinator or Office staff ([who can do what](#roles)). This page is view-only; you cannot decide on an application from here.

The numbers come from the school's applications, such as leave applications. Staff leave counts come from the record of approved leave.
<!-- link pending: applications/applications.md — applications (other lane) -->

[See the count](#task-main) · [Open old applications](#task-stale) · [Change the time](#task-filter) · [Problems and fixes](#trouble)

**On this page**

- [See this year's application count](#task-main)
- [How to know the numbers are right](#confirm)
- [Other situations](#other)
  - [Open applications waiting more than 3 days](#task-stale)
  - [See another academic year or dates](#task-filter)
  - [Who is on leave today, and how many days each took](#task-leave)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Known issues](#known-issues)
- [Learn more](#more)

---

## See this year's application count <a href="#task-main" id="task-main"></a>

1. In the left menu press **Reports**, then press **Application reports**.

   → The page opens. Under the title it says **Academic year … · all applications**.

2. Look at the four boxes at the top: **Submitted**, **Approved**, **Rejected** and **Average time to decide**.

   → Under **Approved** and **Rejected** it says what share of the total, for example **60% of applications**. **Average time to decide** is in hours, for example **12.5 hours**.

3. Below, look at the **Waiting more than 3 days** list. These are still waiting for someone's decision.
4. Look at the **By type and status** and **By month** tables.

<!-- image pending: Application reports; 1 · Academic year and Submitted on 2 · four boxes 3 · Waiting more than 3 days 4 · By type and status, By month 5 · On leave today 6 · Staff leave days; admin, desktop -->

> **Remember:** if you do not choose an **Academic year**, applications of all years are counted for now, even though it says "Current year". To see only this year, choose the year yourself from **Academic year** ([Known issues](#known-issues)).

---

## How to know the numbers are right <a href="#confirm" id="confirm"></a>

| State                               | How you know                                              | What next |
| ----------------------------------- | --------------------------------------------------------- | --------- |
| **Only picked on screen**           | When you change a filter, the numbers change at once      | —         |
| **Loaded from the school's system** | The four boxes show numbers, with no grey placeholder     | Done      |

This page does not keep anything on your phone or computer, so there is no "saved on this device" state. The filters are kept in the page address; if you send the link, the other person sees the same count.

---

## Other situations <a href="#other" id="other"></a>

### Open applications waiting more than 3 days <a href="#task-stale" id="task-stale"></a>

In the **Waiting more than 3 days** list each application is one row: **Number**, **Submitted** (date · **waiting … days**), **Type**, **Applicant**, **Step**, **Status**. The oldest comes first, at most 50.

1. Press **View — …** on a row.

   → The application's own page opens. Decide on it from there.

If there is nothing, it says **No application has been waiting more than 3 days.**

### See another academic year or dates <a href="#task-filter" id="task-filter"></a>

1. From **Academic year** choose a year.
2. If needed, enter the **From** and **To** days under **Submitted on**.

   → The dates are added under the title too. If no application matches, it says **No applications in this period**; press **Clear all filters** to remove the filters.

### Who is on leave today, and how many days each took <a href="#task-leave" id="task-leave"></a>

- The **On leave today** part has two lists: **Staff** (name, leave type, **until …**) and **Students** (name, class · section, **until …**). If nobody is, it says **No one is on leave today.**
- The **Staff leave days** table has each staff member's days **By leave type** and **Total days**. Only approved leave, counted in working days.

**On leave today** ignores every filter and always shows today. The staff list and **Staff leave days** come from the record of approved staff leave, so they show even when there is no application. The students list comes from approved student leave applications.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                              | What to do                                                                                                           | Who can help |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Could not load the report.**                            | Press **Try again**, or reload the page.                                                                             | Admin        |
| **No applications in this period**                        | Press **Clear all filters**, or choose another year.                                                                 | —            |
| **Average time to decide** shows **—**                    | No application was decided in this time.                                                                             | —            |
| This year's count looks too high                          | Choose the **Academic year** yourself; if you do not, all years are counted ([Known issues](#known-issues)).        | —            |
| Staff leave days do not change when the year changes      | Leave days are filtered by **Submitted on** only, by the day the leave starts; not by academic year.                 | —            |
| **Application reports** is not in the left menu           | Your role cannot see this page. See [who can do what](#roles).                                                       | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                                          | View the report |
| ------------------------------------------------------------- | --------------- |
| Admin                                                         | Yes             |
| Academic coordinator                                          | Yes             |
| Office staff                                                  | Yes             |
| Accountant, Teacher, Exam controller, Committee member        | No              |

**Admin, Academic coordinator and Office staff:** all three see the same count for the whole school; there is no difference in the code. All applications are counted, not only your own share.

Other roles may be able to submit applications, but they do not get **Application reports** in the left menu.

---

## Known issues <a href="#known-issues" id="known-issues"></a>

Checked from the code in version 0.1.0, 2026-10-25. Not tried in the running app. When it is fixed, this part will be removed.

| Issue                                                                                                                       | Who, when                      | Is data saved? | What to do for now                        |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------- | ----------------------------------------- |
| If you do not choose an **Academic year**, it says "Current year" and **This academic year**, but applications of all years are counted | Anyone, when the page first opens | Yes            | Choose the year yourself from **Academic year** |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page</strong></summary>

1. The title and **Academic year … · all applications**.
2. Filters: **Academic year**, **Submitted on** (**From**, **To**).
3. Four boxes: **Submitted**, **Approved**, **Rejected**, **Average time to decide**.
4. **Waiting more than 3 days**.
5. **By type and status** (**Pending**, **Approved**, **Rejected**, **Other**) and **By month** (**Submitted**, **Approved**, **Rejected**).
6. **On leave today** and **Staff leave days**.

<!-- image pending: Application reports, six parts marked with numbers; office staff, desktop -->

</details>

<details>
<summary><strong>What each field means</strong></summary>

<!-- guide:generated:fields:applicationsReports -->

| Field         | What to enter                                                                                                                                         | Required? |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Academic year | Which academic year to count. When chosen, only that year’s applications are counted.                                                                 | No        |
| Submitted     | Filters by the day an application was submitted; both the start and end days count. Staff leave days use the same dates, by the day the leave starts. | No        |

<!-- /guide:generated -->

</details>

<details>
<summary><strong>How the numbers are counted</strong></summary>

<figure>
  <img src="diagrams/reports-applications-overview.svg" alt="This school's applications are filtered by academic year and submitted date; from them come the four boxes, by type and status, by month and waiting more than 3 days; staff on leave today and staff leave days come from the staff approved-leave record" width="720">
  <figcaption><em>The report's two sources</em></figcaption>
</figure>

- **Submitted:** all applications that match the filters, in any status.
- **By type and status:** pending and under review together make **Pending**; everything other than approved and rejected is **Other**.
- **Average time to decide:** for approved or rejected applications, the average hours from submitting to the decision, to one decimal place.
- **Waiting more than 3 days:** pending or under review, more than 3 days after submitting; at most 50.
- **Submitted on:** by the day of submitting, in Bangladesh time.
- **Staff leave days:** approved leave; a leave that falls in two months is counted in the month it starts.

</details>

**Related pages**

<!-- link pending: applications/applications.md — applications (other lane) -->
<!-- link pending: people/staff-leave — staff leave (other lane) -->

---

_Version 0.1.0 · last verified 2026-10-25_
