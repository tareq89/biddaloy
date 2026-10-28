<!-- sub-page of admin.scenarios; no guide:meta because features.json lists one page for the feature; no video (D48) -->

# Set up a high school with two shifts and two versions

Set up Class 6 to Class 10 in one go, with Morning and Day shifts and Bangla and English versions, using one Excel file.

Take **Nadirtir High School** (an example school, not a real one). It runs two shifts, morning and day, and each shift has two versions, Bangla and English. It teaches Class 6 to Class 10. If your school looks like this, this page is for you.

<figure>
  <img src="../diagrams/admin-scenario-high-school.svg" alt="Each level from Class 6 to Class 10 in Morning and Day shifts, each shift with Bangla and English versions, each with section A" width="720" />
</figure>

---

## What the Excel file sets up

The file has 9 sheets. The `_meta` sheet identifies the file; do not change it. Sheet names are in English in the file; the app shows its own names for them.

| Sheet            | Name in the app | Rows |
| ---------------- | --------------- | ---- |
| `academic_years` | Academic years  | 1    |
| `classes`        | Classes         | 20   |
| `sections`       | Sections        | 20   |
| `subjects`       | Subjects        | 5    |
| `users`          | Users           | 2    |
| `guardians`      | Guardians       | 40   |
| `students`       | Students        | 40   |
| `fee_structures` | Fee structures  | 20   |

Class 6 to Class 10, each level in the Morning and Day shifts and in the Bangla and English versions. That is 4 classes per level, 5 × 2 × 2 = 20 in all. Each has section "A", with 2 students per section.

**Subjects:** 5: BAN Bangla, ENG English, MATH Mathematics, SCI Science, SOC Bangladesh and Global Studies.

**Users** sheet: two example staff, one teacher and one accountant (emails `@guide.example`). Every name is an example: students are "Demo Student ...", guardians are "Demo Guardian ...", phone numbers start at 01700000001. The "Monthly tuition" fee for each class is 500.00, also an example. The academic year is the current year; its dates are in the `academic_years` sheet.

---

## Step by step

1. Download [high-school-two-shifts.xlsx](../../admin-setup/scenarios/files/high-school-two-shifts.xlsx).

2. Open the file in Excel and replace the example data with your own:
   - Student and guardian names and phone numbers.
   - The two example staff: add your own staff, or delete those two rows.
   - Fee amounts (500.00 is only an example).
   - The subject list, if yours is different.
   - Check the dates in the `academic_years` sheet.

   > **Remember:** the cells point at each other. In the `sections` and `students` sheets, the `class`, `academic_year` and `section` columns hold the class name, year, shift and version written together (for example, in the high-school file: `Class 6|...|Morning|Bangla`). If you rename a class, shift, version or year, use Excel's **Find and Replace** and press **Replace All** across the whole file so every sheet still matches. Do not touch the `id` columns.

3. In the setup wizard of the new school, choose **From an Excel file**. The **Set up from Excel** page opens. Press **Upload file** and give it the file ([The setup wizard, step by step](../create-school.md#task-wizard)). The **Download sample file** button on that page is the app's own blank sample; you need the file from this page. Look at the **This is what will be created** list, then press **Create these**. Nothing is created before you press this button.

   → The message **Your school has been set up.** appears.

4. After that, do these by hand (the app does not do them for you):
   - Set the real fee amounts: [Step 7: Fee structure](../setup-order.md#step-7).
   - Staff and their roles, and which teacher teaches which class: [Step 6: Staff and roles](../setup-order.md#step-6).
   - The class routine: [Step 8: Routine](../setup-order.md#step-8).
   - Open **Administration → Settings**, then the **School** section, then the **Shift, version & group** part. If a shift, version or group name from the file is not there, add it. We could not verify whether the names appear there by themselves after the file is uploaded.

> **If the wizard does not come back:** the wizard comes only once. If you closed it earlier with **Do this later**, it does not return. We could not verify whether there is another way to upload this file later. Ask the SchoolManager team (the link at the bottom of the wizard: **Want us to set it up for you? Talk to us**). Do not use the restore option in Settings → Backup: it replaces the school's current data with the data in the file.

---

## Download the file <a href="#download" id="download"></a>

- [high-school-two-shifts.xlsx](../../admin-setup/scenarios/files/high-school-two-shifts.xlsx)

---

## Related pages

- [Sample schools: which one is yours?](../scenarios.md)
- [Creating your school and the setup wizard](../create-school.md)
- [The order to set up your school](../setup-order.md)
- [How everything in your school fits together](../how-it-works.md)

---

_Version 0.1.0 · Last verified 2026-10-24_
