<!-- guide:meta
feature: people.staffImport
title: Adding staff from Excel
summary: Write all the school's teachers and staff in one file and add them at once, and send everyone an invitation if you want.
roles: [ADMIN]
sources:
  - client-admin/src/routes/_staff/staff/import.tsx
  - client-admin/src/features/staff-import/staff-import-view.tsx
  - client-admin/src/features/staff-import/template.ts
  - ui/src/components/bulk-upload-preview.tsx
  - server/src/modules/users/staff-bulk-upload.controller.ts
  - server/src/modules/users/staff-bulk-upload.service.ts
  - server/src/modules/users/staff-bulk-upload.parser.ts
labels:
  [
    staffImport:*,
    bulkImport:*,
    staff:roles.*,
    nav:items.importFromExcel,
    nav:groups.people,
    onboardingPeople:uploadExcel,
    onboardingPeople:downloadSample,
  ]
helpIds:
  [
    people.staffImport,
    people.staffImport.action.confirm,
    people.staffImport.field.role,
    people.staffImport.field.sendInvitations,
  ]
devices: [desktop]
entry: [sidebar, palette, page:admin.createSchool]
keywords: [এক্সেল, আমদানি, কর্মী, শিক্ষক, ফাইল, নমুনা ফাইল, csv, xlsx, import, staff, bulk, excel, upload]
appVersion: 0.1.0 (e81ef857f)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# Adding staff from Excel

Write the names, phone or email, and role of your teachers and staff in one file and add them all at once. Before anything is added, the app shows you what will happen, so mistakes are caught first.

**Go to:** **People → Import from Excel** in the left menu. Do the work on this page on a computer.
**Before you start:** be the school's Admin. Collect each person's phone number or email. To add people one at a time, see [Adding and managing staff](staff.md).

The work on this page centres on a **sample file**. You download the sample file, write one person's details per row, then upload it. There is one file for teachers and other staff; the **Role** column tells them apart.

[Make the file](#task-main) · [Fix problem rows](#task-errors) · [People who already have another role](#task-existing) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [Make a file and add staff](#task-main)
- [How to know the staff were added](#confirm)
- [Other situations](#other)
  - [Fix problem rows](#task-errors)
  - [People who are already here or used to be](#task-existing)
  - [Add without sending invitations](#task-no-invite)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**From the left menu:** press **People → Import from Excel**. Start at step 1 below.

**From search:** in the search box at the top (Ctrl+K) type **Import staff from Excel** and choose it. How search works: [Find any page](../start/find-anything.md).

**From the setup wizard of a new school:**

1. In the wizard's **Add your people** step, on the **Teachers and staff** card, press **Upload Excel file**. (If you need the file first, press **Download sample file** on the same card.) The rest of the wizard: [Creating a school and the setup wizard](../admin/create-school.md).
2. → This page opens, with an extra **Back to setup** button at the top. Press it at the end to return to the wizard. Start at step 1 below.

---

## Make a file and add staff <a href="#task-main" id="task-main"></a>

1. Press **People → Import from Excel** in the left menu.

   → The title **Import from Excel** at the top. Below it are two cards: **Sample file** and **Upload your file**.

2. On the **Sample file** card, press **Download sample file**.

   → A file named `staff-import-template.csv` downloads. It has five columns: **Name**, **Mobile**, **Email**, **Role**, **Designation**, and two example rows. (If you open the page in Bangla, the column names come in Bangla; the app understands both Bangla and English names.)

<!-- image pending: top of the import page, with the Download sample file button and the column guide marked, admin, desktop -->

3. Press **What goes in each column** to open the rules for each column; at the end it lists which roles you can give. Read them.

   → Next to each column is a one-line instruction, for example **Mobile** — "Mobile number, for example 01712345678." Below that it says: **Each person needs a mobile number or an email.**

4. Open the file in Excel (or another spreadsheet app) and write one person per row, deleting the two example rows.

   - **Name** and **Role** are needed for everyone. **Mobile** and **Email**: at least one.
   - Write **Role** by the school's role name, for example **Teacher**, **Accountant**. You can give Admin. If you write **Teacher**, the teacher profile is also created automatically, and the app sets the employee ID itself.
   - **Designation** can be left empty. It is only for teachers, for example **Assistant teacher**.
   - Format the Mobile column as **Text**. Otherwise Excel drops the leading 0.
   - The file must be **.csv** or **.xlsx**, no bigger than 5 MB, and no more than 2000 rows.

   → Do not change the column names (the first row). All five columns must be there, even if one is empty.

5. On the **Upload your file** card, press **Choose file**, then pick your file.

   → First **Uploading… 100%**, then **File received. Checking it now.** Nothing is saved to the system at this point. Nothing is saved until you check the list and confirm.

6. Read the **Check before saving** section.

   → At the top are three numbers: **5 will be added**, **0 will be brought back**, **0 will be skipped** (the numbers follow your file). Below that is the **Send invitations now** tick box (already ticked), and the **People in this file** list: **Name**, **Mobile / email**, **Role**, **What happens** (**Added**, **Brought back**, **Skipped**). It shows the first 20 people; if there are more, it says "Showing 20 of {total}". At the bottom is the time count: **Save within {time} or upload again**.

<!-- image pending: the import preview, four parts marked, admin, desktop -->

7. If everything is right, press **Confirm** at the bottom.

   → **Confirming…** appears. At the end, under the **Import finished** title, you see the result: **{count} added**, (if some were brought back) **{count} brought back**, and **{count} invited**. Then press **See staff** to go to the staff list, or **Import another file** to give a new file.

> **Remember:** nobody is added until you press **Confirm**. Once confirmed, the same upload cannot be run a second time. If something is wrong, fix it separately on the [Adding and managing staff](staff.md) page.

---

## How to know the staff were added <a href="#confirm" id="confirm"></a>

This work does not run without internet; the file goes straight to the school's system. So there is no **Saved on this device** state here.

| State                           | How you can tell                                                                                      | What next                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Changed on screen only**      | The file is uploaded and the **Check before saving** list shows, but **Confirm** has not been pressed | Press **Confirm** within the time                                                 |
| **Reached the school's system** | The **Import finished** title and the numbers                                                         | Done. The people who got an invitation will activate their accounts from the link |

**To check:** press **See staff**. In the staff list, see whether the new names show the **Invitation pending** badge. Press a teacher's name to see the **Teacher profile** card and the **Employee ID**.

**If no message appears:** see [Problems and fixes](#trouble). If you pressed **Confirm** and no message came, look at the staff list first; if anyone was added, do not upload the file again.

---

## Other situations <a href="#other" id="other"></a>

### Fix problem rows <a href="#task-errors" id="task-errors"></a>

A row with a problem comes into the **Rows with problems** list. If even one row has a problem, the **Confirm** button stays off; you must fix the whole file and give it again.

1. Look at the **Rows with problems** list: **Row**, **Sheet**, **Column**, **Value in your file**, **Problem**, **Type**.

   → Each row's problem is written in plain words. The "Problems and fixes" list below explains each one.

2. To keep the list, press **Download problem rows (CSV)**.

   → A CSV file of the problem rows downloads.

3. Fix those rows in your own file, then press **Upload another** and upload the fixed file.

   → It is checked again. If there are no problems, **Confirm** turns on.

> **Remember:** pressing **Upload another** drops the earlier upload. Nothing has been added.

### People who are already here or used to be <a href="#task-existing" id="task-existing"></a>

The app matches each row's phone or email against the school's staff. So the **What happens** column shows:

| Situation                                                                           | In the **What happens** column                                                           | What happens when you confirm                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A new person                                                                        | **Added**                                                                                | An account and school membership are created; for a teacher, a teacher profile too             |
| Already staff of this school in this role                                           | **Skipped**                                                                              | Nothing changes. This is not counted as an error, so it does not stop **Confirm** for this row |
| Used to be in this role and was removed from the school (and has no staff role now) | **Brought back**                                                                         | They get their access again. The invitation does not go again                                  |
| Already has, or had, another role at this school                                    | Problem: **This person already has another role here. An import does not change roles.** | An import cannot change a role                                                                 |

**Confirm** does not turn on unless at least one person is **Added** or **Brought back**; so if everyone in the file is **Skipped**, there is nothing to do.

### Add without sending invitations <a href="#task-no-invite" id="task-no-invite"></a>

Before you confirm, decide whether everyone should get an invitation now.

1. In the **Check before saving** section, clear the **Send invitations now** tick box.
2. Press **Confirm**.

| What you chose                  | What happens                                                                                                                 | Saved?                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Send invitations now** ticked | Every new person is added, and each gets an invitation by phone or email                                                     | Yes                       |
| Tick cleared                    | Every new person is added, but no invitation goes. Later, from each person's page: [Resend invitation](staff.md#task-invite) | Yes (without invitations) |

If a row cannot be added (or someone's invitation cannot go), the red message under **Import finished** carries the row numbers: **{count} failed. Could not add, rows: …** or **Invitation not sent, rows: …**. A problem in one row does not stop the others from being added.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                               | What to do                                                                                                                               | Who can help |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **This file type isn't supported — choose a .csv or .xlsx file**                                           | Open the file in Excel, save it as **.xlsx** or **.csv**, and choose it again.                                                           | Admin        |
| **This file is too large — choose a smaller file**                                                         | Give a file no bigger than 5 MB; if needed, split it and import twice.                                                                   | Admin        |
| A red message in English, such as **Missing required columns: …** or **File has too many rows (max 2000)** | Check that the five column names are right in the first row (do not leave any out). If there are more than 2000 rows, split the file.    | Admin        |
| **Name is required.**                                                                                      | Fill in **Name** on that row.                                                                                                            | Admin        |
| **Add a mobile number or an email.**                                                                       | Give at least one.                                                                                                                       | Admin        |
| **This mobile number is not valid.**                                                                       | Check the digits and length of the number, for example 01712345678.                                                                      | Admin        |
| **This email is not valid.**                                                                               | Check the spelling of the email, for example name@example.com.                                                                           | Admin        |
| **The mobile number lost its leading 0. Format the column as Text and type it again.**                     | In Excel, set the cells of the **Mobile** column to **Text**, then type the numbers again.                                               | Admin        |
| **This role does not exist.**                                                                              | Write the role name as it is in the app. The roles you can give are in the list in step 3.                                               | Admin        |
| **This person appears twice in the file.**                                                                 | The same phone or email is on two rows; delete one row.                                                                                  | Admin        |
| **This mobile number or email is used by another account.**                                                | You cannot use that number or email at this school. Get the right number, or send a join request from the [Adding staff](staff.md) page. | Admin        |
| **This person already has another role here. An import does not change roles.**                            | Take the row out of the file.                                                                                                            | Admin        |
| **This value is not valid.**                                                                               | Look at the row's details again; the **Column** field says which column has the problem.                                                 | Admin        |
| **This check expired — upload the file again**                                                             | The count has run out; upload the same file again. Nothing was added.                                                                    | Admin        |
| The **Confirm** button is off                                                                              | There are rows with problems, or everyone is **Skipped**, or the time is up. See the lists above.                                        | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                                                                       | Open this page and add staff |
| ------------------------------------------------------------------------------------------ | ---------------------------- |
| Admin                                                                                      | Yes                          |
| Academic coordinator, Teacher, Accountant, Office staff, Exam controller, Committee member | No                           |

Someone without permission who opens the page sees **You don't have access to this page.**, and **Import from Excel** is not in their left menu.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>The parts of the page</strong> — top to bottom</summary>

1. **Import from Excel** — the title (if you came from the setup wizard, **Back to setup** is below it).
2. **Sample file** — the **Download sample file** button and the **What goes in each column** list.
3. **Upload your file** — choose the file, then the preview, the list of problems and **Confirm**.

<!-- image pending: the three parts of the import page marked with numbers, admin, desktop -->

</details>

<details>
<summary><strong>What the fields mean</strong></summary>

<!-- guide:generated:fields:staffImport -->

| Field                | What to enter                                                                                                                                         | Required?                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Name                 | The person's full name.                                                                                                                               | Yes                                    |
| Mobile               | Mobile number, for example 01712345678. Bangla digits also work. In Excel, keep the cell type as Text.                                                | No, but a mobile or an email is needed |
| Email                | Email address, for example name@example.com.                                                                                                          | No, but a mobile or an email is needed |
| Role                 | Teacher, Accountant or another role of your school. Write the role name as it is in the app (Bangla or English).                                      | Yes                                    |
| Designation          | Optional. For example Assistant Teacher. It is used only for teachers; for another role, or if it is not recognised, it is dropped.                   | No                                     |
| Send invitations now | If ticked, a link to activate the account goes to new staff by phone or email. Ticked to begin with. People who are brought back do not get it again. | No                                     |

<!-- /guide:generated -->

</details>

<details>
<summary><strong>How importing from Excel works</strong> — from the file to the invitation</summary>

<figure>
  <img src="diagrams/people-staff-import-flow.svg" alt="The Admin writes details in the sample file and uploads it; the app checks and shows the result; the Admin confirms; the staff get an invitation and sign in" width="720">
  <figcaption><em>From the file to the staff</em></figcaption>
</figure>

- After the upload the app only checks; nobody is added before you press **Confirm**.
- If one row has a mistake, the whole file is held back, because everyone is added together when you confirm.
- After they are added, staff activate their accounts with the invitation. The role decides what each person sees: [Adding and managing staff](staff.md#more).

</details>

<details>
<summary><strong>The whole task in one go</strong></summary>

<!-- image pending: GIF from uploading the file to Import finished, admin, desktop -->

</details>

**Related pages**

- [**Adding and managing staff**](staff.md) — add one at a time, resend invitations, remove people from the school.
- [**Teacher assignments**](teaching-assignments.md) — give the added teachers a class, section and subject.

---

_Version 0.1.0 · Last checked 2026-10-24_
