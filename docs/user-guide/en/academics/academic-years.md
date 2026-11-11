<!-- guide:meta
feature: academics.academicYears
title: Creating and managing academic years
summary: Add academic years, set which one is current, arrange the terms of a year, and delete a year nobody uses.
roles: [ADMIN]
sources:
  - client-admin/src/routes/_staff/academic-years/index.tsx
  - client-admin/src/routes/_staff/academic-years/$academicYearId.tsx
  - client-admin/src/routes/_staff/academic-years/-year-form-dialog.tsx
  - client-admin/src/routes/_staff/academic-years/-set-current-dialog.tsx
  - client-admin/src/routes/_staff/academic-years/-delete-year-dialog.tsx
  - client-admin/src/routes/_staff/academic-years/-close-year-dialog.tsx
  - client-admin/src/routes/_staff/academic-years/$academicYearId_.next.tsx
  - client-admin/src/routes/_staff/academic-years/-next-year/name-step.tsx
  - client-admin/src/routes/_staff/academic-years/-next-year/preview-step.tsx
  - client-admin/src/routes/_staff/academic-years/-next-year/done-step.tsx
  - client-admin/src/routes/_staff/academic-years/-detail/terms-tab.tsx
  - client-admin/src/routes/_staff/academic-years/-detail/classes-tab.tsx
  - client-admin/src/routes/_staff/academic-years/-detail/fee-structures-tab.tsx
  - client-admin/src/routes/_staff/academic-years/-detail/tab-query-state.tsx
  - server/src/modules/academics/academic-year.controller.ts
  - server/src/modules/academics/academic-year.service.ts
labels:
  [
    academicYears:list.*,
    academicYears:form.*,
    academicYears:deleteDialog.*,
    academicYears:setCurrentDialog.*,
    academicYears:detail.*,
    academicYears:nextYear.*,
    academicYears:closeYear.*,
    academicYears:readiness.*,
    academicYears:closedNotice.*,
    nav:items.academicYears,
    nav:groups.academics,
    common:accessDenied.*,
  ]
helpIds:
  [
    academics.academicYears,
    academics.academicYears.action.add,
    academics.academicYears.action.setCurrent,
    academics.academicYears.action.delete,
    academics.academicYears.action.addTerm,
    academics.academicYears.field.isCurrent,
    academics.academicYears.field.dates,
    academics.academicYears.action.edit,
  ]
devices: [desktop]
entry: [sidebar, palette]
keywords:
  [শিক্ষাবর্ষ, সেশন, চলমান বর্ষ, চলতি বছর, টার্ম, সেমিস্টার, নতুন বছর, academic year, session, current year, term, semester]
appVersion: 0.1.0 (1798f8b1f)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# Creating and managing academic years

Add academic years, set which one is running now, arrange the terms of a year, and delete a year you created by mistake.

**Where to go:** in the left menu, **Academics → Academic years**. Do the work on this page on a computer.
**Before you start:** you must be the school Admin ([who can do what](#roles)). Keep the start date and end date of the year ready.

Almost everything in the school lives inside an academic year: [classes](classes.md), fee structures, admissions, exams. Only one year is **current** at a time. When you create a new class or view a list, the app usually picks the current year first. So when a new year begins, remember to make it the current one.

[Add an academic year](#task-main) · [Set the current year](#task-current) · [Arrange terms](#task-terms) · [Create next year](#task-next) · [Close a year](#task-close) · \1 · [Problems and fixes](#trouble)

**On this page**

- [How to reach this page](#arrive)
- [Add an academic year](#task-main)
- [How to tell the year was added](#confirm)
- [Other situations](#other)
  - [Change the current academic year](#task-current)
  - [Create next year from this one](#task-next)
  - [Before you make a year current](#task-before-current)
  - [Close a year](#task-close)
  - [Reopen a year](#task-reopen)
  - [Change the name or dates](#task-edit)
  - [Add and arrange terms](#task-terms)
  - [Delete an academic year](#task-delete)
  - [The year page: the tabs](#task-detail)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How to reach this page <a href="#arrive" id="arrive"></a>

**From the left menu:** press **Academics → Academic years**. Start from step 1 below.

**From the search box:** in the search box at the top (Ctrl+K), type **Add academic year** and pick it. → The list of academic years opens, and the **Add academic year** dialog is already open. Start from step 3 below. Search rules: [Finding any page](../start/find-anything.md).

---

## Add an academic year <a href="#task-main" id="task-main"></a>

1. In the left menu, press **Academics → Academic years**.

   → At the top is the title **Academic Years**, and below it "One year is current at a time." The list columns are: **Academic year**, **Period**, **Status**, **Classes**, **Students**. If there is no year yet, it says **No academic years yet**, with an **Add the first academic year** button.

![the academic years list, with the Add academic year button and the Status column](img/academic-years-01.png)

2. At the top of the page, press **Add academic year**.

   → The **Add academic year** dialog opens: "Classes, fee structures and enrolments attach to whichever year they're created in."

3. In the **Name** field, type the name of the year, for example `2026-2027` or `2027`.

   → If you leave it empty, it shows **Name is required**.

4. Pick the **Start date** and the **End date**.

   → Both are needed; without them it shows **Start and end dates are required**. If the end date is not after the start date, it shows **End date must be after the start date**.

5. If this year is the one running now, tick **Set as the current academic year**.

   → A warning appears under the box: whichever year is current now will no longer be current. Press **Yes, set as current** and the tick is set; press **Cancel** and the tick is not set.

![the Add academic year dialog, with the name, the two dates and the current tick box](img/academic-years-02.png)

6. Press **Save**.

   → The dialog closes and the new year appears in the list. If you ticked the box, its **Status** cell shows the current mark, and the mark disappears from the year that was current before.

> **Remember:** creating a year does not create classes. Next, add this year's classes on the [Classes](classes.md) page. The full setup order: [Steps to set up the school](../admin/setup-order.md#step-2).

---

## How to tell the year was added <a href="#confirm" id="confirm"></a>

An academic year is saved only when you are online; it cannot be kept on the device and sent later. So there is no **Saved on this device** state here.

| State                           | How to tell                                           | What next                           |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| **Changed on screen only**      | The dialog is open and filled in, but has not closed  | Press **Save**                      |
| **Reached the school's system** | The dialog has closed and the new year is in the list | Done. Now add [classes](classes.md) |

**To check:** reload the page. If the year is in the list, it is in the system. Press its name and compare the dates against **Period** on the year page.

**If no message comes:** see [Problems and fixes](#trouble). The details you typed are still in the dialog.

---

## Other situations <a href="#other" id="other"></a>

### Change the current academic year <a href="#task-current" id="task-current"></a>

Do this when a new year begins. Only one year is current at a time.

1. In the list, press the name of the new year.

   → The year page opens.

2. At the top of the page, press **Set as current**. (If the year is already current, the button is not there.)

   → The **Set as current academic year** dialog opens.

| You pressed        | What happens                                                                                            | Saved? |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------ |
| **Set as current** | This year becomes current; the previous current year is no longer current. Old-year data is not deleted | Yes    |
| **Cancel**         | Nothing changes                                                                                         | No     |

> **Remember:** changing the current year does not move students into the new year by themselves. Moving students up to the next class is a separate job.

The dialog also shows three numbers about the year. See [Before you make a year current](#task-before-current).

If it fails, the dialog shows **Failed to set the current academic year**.

### Create next year from this one <a href="#task-next" id="task-next"></a>

Do this when a year is ending. The app copies the setup of this year into the new year, so you do not build classes, subjects and fees again. Nothing is made until the last step.

```mermaid
flowchart LR
  A["1. Name and dates"] --> B["2. What will be copied<br/>(tick, nothing is made yet)"]
  B -->|Create year| C["3. Done<br/>new year is ready"]
  B -->|Back| A
```

1. On the year list, press **Create next year** at the end of the row. Or open the year and press **Create next year from this one**. A year that is already closed does not have this button. (You can also press Ctrl+K and type **Create next year**; it starts from the current year.)

   → The **Create next year** page opens. The steps are **Name and dates**, **What will be copied**, **Done**.

2. Check the **Name of the new year**, **First day** and **Last day**, then press **Next**.

   → The app fills them in for you: `2026-2027` becomes `2027-2028`, the first day is the day after this year ends, and the last day is one year later, less one day. Change them if your school differs. Empty name shows **Enter a name**; a missing date shows **Enter the first and last day**; a last day that is not after the first shows **The last day must be after the first day**.

3. On **What will be copied**, look at the seven boxes: **Classes**, **Sections**, **Class subjects**, **Teacher assignments**, **Fee structures**, **Grading scales**, **Terms**. Each one says, for example, **New 12 · Already there 0 · Skipped 0**. Remove the tick from anything you do not want.

   → **New** is what will be added. **Already there** is what the new year already has, so it is left as it is. **Skipped** is what could not be copied. If every box is unticked, it shows **Tick at least one thing to copy.** and **Create year** stays off.

4. If a card **Teachers left out** appears, read it. It lists each teacher with the section and subject.

   → A teacher is left out when the new year has no section to match. Add that section, then run **Create next year** again; it only adds what is missing.

5. Press **Create year**.

   → The **Done** step opens: **2027-2028 is ready**, with the same three numbers added up. If something goes wrong, it shows **Nothing was created. Try again.** and no half-made year is left behind.

6. Under **Also copy from 2026-2027:** press what you need. **Class routine** opens the routine review page, **Calendar** opens the calendar copy, **Fine rules** opens a small window, and **Recurring fee schedules** opens the fee schedules page. Then press **Next: check fee amounts on Fee structures** to look at the new fees, or **Go to the new year**.

| You pressed                    | What happens                                                         | Saved?              |
| ------------------------------ | -------------------------------------------------------------------- | ------------------- |
| **Create year**                | The new year and the ticked things are made, all together            | Yes                 |
| **Back** (on the second step)  | Returns to the name and dates; nothing is made                       | No                  |
| **Back** (on the first step), or the close mark | Leaves the page; nothing is made                    | No                  |

You can run it again for the same new year. **Already there** things are never changed or duplicated. After this, [make the new year current](#task-current) when its first day comes.

### Before you make a year current <a href="#task-before-current" id="task-before-current"></a>

When you press **Set as current** (see [Change the current academic year](#task-current)), the dialog first shows three numbers for the year you are about to make current:

> **Classes: 12 · Teacher assignments: 40 · Promotions committed: 1**

| Number                      | What to check                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| **Classes**                 | The classes of the new year are there                                                           |
| **Teacher assignments**     | Teachers are given their subjects and sections                                                  |
| **Promotions committed**    | How many [promotion lists](../exams-results/promotion.md) were finalised into this year         |

If **Teacher assignments** is 0, a yellow note says **Teachers will see no students until assignments exist in this year.** It is only a warning. You can still press **Set as current**; teachers will then see no students until assignments are added.

### Close a year <a href="#task-close" id="task-close"></a>

Close a year when its work is finished, so nobody changes its exams, marks or bills by mistake. You can open it again.

1. Make sure the year is not the current one. Then open it and press **Close year**. (Ctrl+K → **Close year** opens the latest open year that is not current.) A current year has no **Close year** button: [make another year current](#task-current) first.

   → The **Close 2026-2027** dialog opens: "After a year is closed, its exams, marks, bills, attendance and enrolments can no longer change. Payments can still be taken. You can reopen the year later."

2. Read **What will no longer change**. It lists only the things that have records in this year, with the number of each, for example **Exams: 6**, **Bills: 1,240**, **Enrolments: 380**. If nothing was recorded it says **Nothing has been recorded in this year yet.**

3. Read **Check before you close**, if it appears. The lines are **Classes not promoted**, **Students still active**, **Groups pending**, **Dues outstanding** and **Results not published**, each with a number or an amount.

   → These are only reminders. You may close with them. To clear **Groups pending**, see [Set groups for many students](../exams-results/promotion.md#task-groups).

4. If a red bar says **A promotion draft is still open for this year. Commit it or delete it first.**, press **Open promotions**, and finish or delete that draft. **Close year** stays off until you do.

5. Press **Close year**. An extra approval window opens; finish it as it asks, and the year closes.

   → The year page shows a grey mark **Closed on** and the date. Pages that work inside this year show **2026-2027 is closed. Reopen it on Academic years to change this.**

A closed year still takes payments, but no new bills are made in it. If someone tries to change a closed year, the app says **This year is closed. Reopen it on Academic years to change this.**

### Reopen a year <a href="#task-reopen" id="task-reopen"></a>

1. Open the closed year and press **Reopen year**.

   → The **Reopen 2026-2027** dialog asks: Reopen "2026-2027"? Its exams, marks, bills, attendance and enrolments can change again.

2. Press **Reopen year**. Finish the extra approval window.

   → The **Closed on** mark goes away and the year can be changed again. If it fails: **Could not reopen the year**.

### Change the name or dates <a href="#task-edit" id="task-edit"></a>

1. At the end of the year's row in the list, press **Edit**. (There is also an **Edit** at the top of the year page.)

   → The **Edit academic year** dialog opens with the old details filled in.

2. Change the **Name**, **Start date** or **End date**, then press **Save**.

   → The dialog closes and the list shows the new details.

If you change something and press **Cancel** or click outside the dialog, the app asks whether to discard the changes.

### Add and arrange terms <a href="#task-terms" id="task-terms"></a>

A term is a part of the year, for example **First term** and **Second term**. Exams and results are grouped by these parts. The tab name can show **Terms**, **Semesters** or **Trimesters**, depending on your school's settings.

1. On the year page, open the **Terms** tab.

   → The list of terms: **No.**, **Name**, **Period**, **Length** (in weeks). If there are none, it says **No terms defined for this academic year**.

2. Press **Add term**.

   → The **Add term** dialog opens.

3. Give a **Name**, **Start date** and **End date**, then press **Save**.

   → The term appears in the list. If the dates fall outside the year, it shows **Term dates must fall within the academic year (…)**. If the dates overlap another term, it shows **"{name}" overlaps an existing term in this academic year**.

4. To change the order, press the **Move up** or **Move down** arrow on the row.

   → The order changes at once. If it does not, it shows **Could not change the order**.

To change or delete a term, press **Edit** or **Delete** at the end of the row. Before deleting, you must confirm in the **Delete term** dialog; a deleted term cannot be brought back.

### Delete an academic year <a href="#task-delete" id="task-delete"></a>

Only a year made by mistake and still empty can be deleted. Do not delete old years; they only need to be not current.

1. At the end of the year's row in the list, press **Delete**. (It is also in the **More actions** menu at the top of the year page.)

   → The **Delete academic year** dialog opens: Delete "{name}"? This cannot be undone.

2. Press **Delete**.

| You pressed | What happens                                                                                                  | Saved? |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| **Delete**  | The year leaves the list and cannot be brought back. If you delete from the year page, you return to the list | Yes    |
| **Cancel**  | Nothing changes                                                                                               | No     |

**A year that cannot be deleted:** the current year, and a year that still has classes, fee structures, student enrolments, exams, student bills, staff evaluations (ACR) or any other record linked to it. Its terms do not block a delete; they go with the year. Then the dialog says why. For the current year: **This is the current year. Make another year current first.** For a year with data it names what is inside, for example **This year still has classes and exams. Remove them first.** For other records: **This year is still used by other records. Remove or move them first.** If it is current, first [set another year as current](#task-current). If it has data inside, keep the year.

### The year page: the tabs <a href="#task-detail" id="task-detail"></a>

Press the year's name in the list, or **View**, to open its page. At the top are the name, whether it is current, and the **Period**, **Classes**, **Students** and **Fee structures** counts.

| Tab                | What is in it                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Classes**        | This year's classes (**Name**, **Grade**). Press **View** to open the [class page](classes.md#task-detail) |
| **Fee Structures** | This year's fee structures: **Name**, **Type**, **Class** (**Whole school** if for everyone), **Amount**   |
| **Terms**          | The parts of the year; [Add and arrange terms](#task-terms)                                                |

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                                                     | What to do                                                                                               | Who can help |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| **You don't have access to this page.**                                                                                          | Only the Admin sees this page. Press **Back to dashboard**.                                              | Admin        |
| **Failed to load academic years**                                                                                                | Check the internet and reload the page.                                                                  | Admin        |
| **Failed to save academic year**                                                                                                 | Check the internet and press **Save** again. What you typed stays.                                       | Admin        |
| **End date must be after the start date**                                                                                        | Give an end date that is some day after the start.                                                       | Admin        |
| **This is the current year. …**, **This year still has … Remove them first.** or **This year is still used by other records. …** | See [Delete an academic year](#task-delete). Usually it is right to keep the year.                       | Admin        |
| **Failed to delete academic year**                                                                                               | Check the internet and press **Delete** again.                                                           | Admin        |
| **Term dates must fall within the academic year (…)**                                                                            | Give term dates inside the year's dates in the brackets, or first [change the year's dates](#task-edit). | Admin        |
| **"{name}" overlaps an existing term in this academic year**                                                                     | Give dates that do not clash with the term named in the message.                                         | Admin        |
| **Failed to save term**                                                                                                          | Check the internet and try again.                                                                        | Admin        |
| **Could not change the order**                                                                                                   | Reload the page and press the arrow again.                                                               | Admin        |
| A new class or a list shows the old year                                                                                         | [Set the new year as current](#task-current).                                                            | Admin        |
| **Nothing was created. Try again.** | Check the internet and press **Create year** again. Nothing half-made is left behind. | Admin |
| **Tick at least one thing to copy.** | Tick at least one box on the **What will be copied** step. | Admin |
| A teacher is under **Teachers left out** | The new year has no matching section. Add the section, then [create next year](#task-next) again. | Admin |
| **Create next year** is not on a year | That year is closed. [Reopen it](#task-reopen) first. | Admin |
| **Close year** is not on a year | A current year cannot be closed. [Make another year current](#task-current) first. | Admin |
| **A promotion draft is still open for this year. …** | Press **Open promotions**, then [finalise or delete the draft](../exams-results/promotion.md). | Admin |
| **Could not close the year** or **Could not reopen the year** | Check the internet and the approval window, then try again. | Admin |
| **This year is closed. Reopen it on Academic years to change this.** | [Reopen the year](#task-reopen) if the change is needed. | Admin |

If a page or button is missing, see [Why can't I see this?](../help/cant-see-this.md).

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                                                                                 | See the list and year page | Add, edit, set current, delete, create next, close, reopen a year | Add and change terms |
| ---------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- | -------------------- |
| Admin                                                                                                | Yes                        | Yes                                   | Yes                  |
| Academic coordinator, teacher, accountant, office assistant, exam controller, governing board member | No                         | No                                    | No                   |

For other roles, **Academic years** is not in the left menu. If they open the page, they see **You don't have access to this page.**

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>The parts of the page</strong> — top to bottom</summary>

1. **Academic Years** — the title and "One year is current at a time."
2. **Add academic year** — the button at the top of the page.
3. **List** — **Academic year**, **Period**, **Status**, **Classes**, **Students**; at the end of each row, **View**, **Edit**, **Delete**.

![the three parts of the academic years list](img/academic-years-03.png)

</details>

<details>
<summary><strong>What the fields mean</strong></summary>

<!-- guide:generated:fields:academicYears -->

| Field                            | What to enter                                                                                                  | Required? |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| Name                             | The name of the year, for example 2026-2027.                                                                   | Yes       |
| Start date                       | The first day of the year.                                                                                     | Yes       |
| End date                         | The last day of the year; it must be after the start date.                                                     | Yes       |
| Set as the current academic year | Tick it and this year becomes current, and the mark leaves the other current year. You must confirm if ticked. | No        |
| Term name                        | For example First term.                                                                                        | Yes       |
| Term start and end dates         | Inside the year's dates, not clashing with another term.                                                       | Yes       |
| Start and end dates              | The first and last day of the year. The last day must be after the first.                                      | Yes       |

<!-- /guide:generated -->

</details>

<details>
<summary><strong>How academic years work</strong> — terms, classes and fees inside a year</summary>

<figure>
  <img src="diagrams/academics-academic-years-overview.svg" alt="A school with several academic years, one of them current; inside each year are terms, classes and fee structures; inside a class are sections" width="720">
  <figcaption><em>What is inside an academic year</em></figcaption>
</figure>

- One year is current at a time. When you make a new year current, the old one stops being current, but its data stays.
- A class is tied to one year; it cannot be moved to another year later. More: [How everything in the school fits together](../admin/how-it-works.md#task-structure).
- A term is a part of the year; exams and results are grouped by term.

</details>

**Related pages**

- [**Classes**](classes.md) — arrange classes, sections and subjects inside a year.
- [**Steps to set up the school**](../admin/setup-order.md) — which job comes after which.
- [**How everything in the school fits together**](../admin/how-it-works.md) — a picture of year, class and section.
- [**Syllabus and study plans**](syllabus.md) — study plans run inside an academic year.
- [**Ready-made curriculum**](../administration/curriculum-preset.md) — In a brand-new school, choose a ready-made curriculum and create the academic year, classes, subjects.
- [**Setting up grading scales**](../exams-results/grading-scales.md) — Set which percentage of marks gives which grade and GPA for each academic year.
- [**Setting up fee structures**](../finance/fee-structures.md) — Write down which fee costs how much for each academic year.

---

_Version 0.1.0 · Last checked 2026-10-24_
