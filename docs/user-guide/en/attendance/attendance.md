<!-- guide:meta
feature: attendance.attendance
title: Taking attendance
summary: Take your section's attendance every day — press All present, tap each absent student, then submit.
roles: [TEACHER, ADMIN, EXECUTIVE, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER]
sources:
  - client-admin/src/routes/_staff/attendance/index.tsx
  - client-admin/src/routes/_staff/attendance/$sectionId.tsx
  - client-admin/src/routes/_staff/attendance/-*.tsx
labels:
  [
    attendance:list.*,
    attendance:mark.*,
    attendance:period.*,
    attendance:statusControl.*,
    attendance:history.*,
    nav:items.attendance,
  ]
helpIds:
  [
    attendance.attendance,
    attendance.attendance.action.allPresent,
    attendance.attendance.action.submit,
    attendance.attendance.field.date,
  ]
devices: [desktop, phone]
keywords: [হাজিরা, উপস্থিতি, রোল কল, অনুপস্থিত, attendance, roll call, absent]
appVersion: 0.1.0 (7b776974b)
-->

# Taking attendance

Calling the roll from a paper register every morning takes time. Registers get lost, and adding up the month takes even longer.

In SchoolManager you take attendance from a phone or a computer in **about two minutes**. For example, Class 10 – B has 20 students. You press **All present**, tap the two students who did not come, and press **Submit attendance**. That's it. The monthly register and the reports are built for you.

**On this page**

- [At a glance](#at-a-glance)
- [Where to find it](#where)
- [Parts of the page](#parts)
- [Tasks](#tasks)
  - [Taking the daily attendance](#task-daily)
  - [When a student is late or on leave](#task-late-leave)
  - [Submitting before everyone is marked](#task-unmarked)
  - [Fixing a mistake](#task-fix)
- [Faster on a computer (keyboard)](#keyboard)
- [Works together with](#related)
- [What each field means](#fields)
- [Who can do what](#roles)
- [Video](#video)

---

## At a glance <a href="#at-a-glance" id="at-a-glance"></a>

<figure>
  <img src="diagrams/attendance-overview.svg" alt="A teacher marks the section register; attendance reports and the monthly attendance register are built from it; an admin fixes old registers; an alert comes if it is not taken on time" width="720">
  <figcaption><em>How attendance fits together</em></figcaption>
</figure>

- Every section has **one register per day**.
- A **teacher** marks the register of their own sections.
- The **Attendance reports** and the monthly **Attendance register** are built from it.
- An **admin** can see and change any section's register.
- If attendance is not taken on time, the teacher gets a **reminder**. If it is very late, it can go to the headmaster and the admin too.

The daily job is just five steps:

<figure>
  <img src="diagrams/attendance-daily.svg" alt="Daily attendance: Attendance in the menu, choose the section, All present, tap each absent student, Submit attendance" width="720">
  <figcaption><em>Daily attendance, step by step</em></figcaption>
</figure>

---

## Where to find it <a href="#where" id="where"></a>

On a computer there are two ways to reach the attendance page:

<figure>
  <img src="img/attendance-01-menu.png" alt="Dashboard: 1 Attendance in the left menu, 2 the Attendance left to take card">
  <figcaption><em>1 · Attendance in the left menu &nbsp; 2 · the "Attendance left to take" card on the dashboard</em></figcaption>
</figure>

1. **Attendance in the left menu.** Press it and a few more items open under it. Press the inner **Attendance**.
2. **The "Attendance left to take" card on the dashboard.** It lists the sections whose attendance is not taken yet. Press a name to go straight to its register.

<figure>
  <img src="img/attendance-01b-menu-open.png" alt="The menu opened, with the inner Attendance item marked">
  <figcaption><em>The inner Attendance item, after the menu opens</em></figcaption>
</figure>

**On a phone** it is even simpler: press **Attendance** in the bar at the very bottom of the screen. Your sections are listed one under another.

<figure>
  <img src="img/attendance-phone-01-sections.png" alt="The section list on a phone, with one section card marked" width="300">
  <figcaption><em>The section list on a phone</em></figcaption>
</figure>

---

## Parts of the page <a href="#parts" id="parts"></a>

### The section list

<figure>
  <img src="img/attendance-03-sections.png" alt="The section list: 1 title and how many are pending, 2 Status filter, 3 Date, 4 a section card">
  <figcaption><em>1 · Title &nbsp; 2 · Status &nbsp; 3 · Date &nbsp; 4 · Section card</em></figcaption>
</figure>

1. **Attendance** — the page name. Under it you see how many sections are still pending, for example "3 of 9 sections pending".
2. **Status** — choose **Pending** or **Done** to see only those sections.
3. **Date** — today's date is filled in for you. Change it to see an earlier day.
4. **Section card** — the section name, number of students, class teacher and the register's state:
   - **Not started** — nobody has taken attendance today yet.
   - **Draft** — attendance is taken (see the warning below).
   - **Submitted** — the register is final.

### The register

<figure>
  <img src="img/attendance-04-register.png" alt="The register: 1 section and state, 2 date, 3 whole day and periods, 4 counts, 5 All present, 6 student name, 7 status button, 8 submit button">
  <figcaption><em>1 · Section and state &nbsp; 2 · Date &nbsp; 3 · Whole day and periods &nbsp; 4 · Counts &nbsp; 5 · All present &nbsp; 6 · Student name &nbsp; 7 · Status button &nbsp; 8 · Submit attendance</em></figcaption>
</figure>

1. **Section name and register state** — for example "Class 10 – B" and **Not marked**. Under it, the number of students.
2. **Date** — the day you are marking.
3. **Whole day and periods** — keep **Whole day** for daily attendance. If your school takes attendance per period, each period has its own tab; press yours.
4. **Counts** — how many are present, absent, late, on leave, and how many are still **Unmarked**.
5. **All present** — one press marks everyone who is still unmarked as present.
6. **Student name** — pressing a name switches present ↔ absent.
7. **Status button** — press it to mark late or leave.
8. **Submit attendance** — press it at the end. On the left you see how many are still unmarked.

---

## Tasks <a href="#tasks" id="tasks"></a>

### Taking the daily attendance <a href="#task-daily" id="task-daily"></a>

<!-- slot:before -->

> **Before you start**
>
> - You are a **teacher**, and an admin has assigned the section to you.
> - School is open today.
> - A phone or computer with internet. No internet? No problem — see below for what to do.

1. First, in the left menu press **Attendance**, then the inner **Attendance**. On a phone, the **Attendance** button at the bottom is all you need.
   <!-- slot:see -->

   → Your sections appear. A section still to do says **Not started**.

2. Press the card of the section you are marking.

   → You see every student by roll number. Nobody is marked yet, so each says **Unmarked**.

3. Now press the **All present** button at the top right.

   → One press, and everyone shows a green **Present**. Pressed it by mistake? Press **Undo** in the message at the bottom and it goes back.

4. Next, press the **name** of each student who did not come today, once each.

   → That student shows a red **Absent**, and the **Absent** count at the top goes up one at a time.

5. Finally, press **Submit attendance** at the bottom.

   → You see **Attendance saved**, and the app takes you back to the section list. That's today's job done.

<figure>
  <img src="img/attendance-05-marked.png" alt="After All present, two students marked absent: Absent 2 at the top, and their rows marked">
  <figcaption><em>After step 4: two students absent, Absent 2 in the counts</em></figcaption>
</figure>

<figure>
  <img src="img/attendance-take.gif" alt="The whole job on a computer: open the section, All present, two absent, submit">
  <figcaption><em>All five steps in one go, on a computer</em></figcaption>
</figure>

**The same job on a phone**, the same five steps:

<figure>
  <img src="img/attendance-phone-02-register.png" alt="The register on a phone: 1 All present, 2 a student name, 3 Submit attendance" width="300">
  <img src="img/attendance-take-phone.gif" alt="The whole job on a phone" width="300">
  <figcaption><em>Left: 1 · All present &nbsp; 2 · Student name &nbsp; 3 · Submit attendance &nbsp;&nbsp; Right: the whole job on a phone</em></figcaption>
</figure>

<!-- slot:check -->

> **Check it worked**
> On the section list, your section no longer says **Not started**.

{% hint style="warning" %}
**Known issue:** after you submit, the section may show **Draft** instead of **Submitted**, and it may still be counted as pending. Your attendance is saved. We are fixing this.
{% endhint %}

<figure>
  <img src="img/attendance-08-after-submit.png" alt="The section list after submitting: Class 6 – B shows Draft">
  <figcaption><em>The section list after submitting</em></figcaption>
</figure>

<!-- slot:trouble -->

> **If something goes wrong**
>
> - **"No sections assigned yet"** — no section is in your name yet. Ask an admin; they assign you one on the **Teacher assignments** page.
> - **"School is closed on this day"** — the day is a weekly off day or a holiday in the calendar. No attendance today.
> - **A section is missing from the list** — a section with no students, or whose class is off today, does not appear in the list.
> - **"Could not save attendance"** — check the internet, then press **Submit attendance** again. Your marks are still there; you don't need to redo them.
> - **No internet** — the button then says **Save on device**. Go ahead and press it. The attendance is sent by itself as soon as the internet is back; just keep the page open until then.
> - **"This register changed since you loaded it"** — someone else saved this register at the same time. Compare the two lists, then press whichever is right: **Keep mine** or **Take theirs**.

<figure>
  <img src="img/attendance-02-holiday.png" alt="A closed day: School is closed on this day">
  <figcaption><em>What the page shows on a closed day</em></figcaption>
</figure>

### When a student is late or on leave <a href="#task-late-leave" id="task-late-leave"></a>

<!-- slot:before -->

> **Before you start:** the register is open.

1. On that student's row, press the **status button** on the right — the one that says **Present** or **Unmarked**.
   <!-- slot:see -->

   → A small list opens: **Present**, **Absent**, **Late**, **Leave**.

2. Press whichever applies, **Late** or **Leave**.
3. If you chose **Late**, a **Minutes late** box appears underneath. Type how many minutes late, for example `15`. Not sure? You can leave it empty.
4. When you're done, press anywhere outside the list.

<figure>
  <img src="img/attendance-06-late.png" alt="The status list open, Late chosen, and 15 in Minutes late">
  <figcaption><em>The Minutes late box, after choosing Late</em></figcaption>
</figure>

<!-- slot:check -->

> **Check it worked:** the right of the row now shows a yellow **Late** or a blue **Leave**.

<!-- slot:trouble -->

> **If something goes wrong:** on a future date only **Leave** can be marked, and only if your school allows it. The page then says "Future date — only Leave can be marked ahead of time."

### Submitting before everyone is marked <a href="#task-unmarked" id="task-unmarked"></a>

<!-- slot:before -->

> **Before you start:** some students still say **Unmarked**.

If you press **Submit attendance** now, the app checks with you first:

<!-- slot:see -->

<figure>
  <img src="img/attendance-07-unmarked-dialog.png" alt="The question 18 students unmarked: 1 Mark rest present, 2 Submit anyway, 3 Close">
  <figcaption><em>1 · Mark rest present &nbsp; 2 · Submit anyway &nbsp; 3 · Close</em></figcaption>
</figure>

1. **Mark rest present** — counts everyone left as present. Then press **Submit attendance** again.
2. **Submit anyway** — submits without the students you didn't mark.
3. **✕ (Close)** — takes you back to the register without changing anything.

<!-- slot:check -->

> **Check it worked:** you see **Attendance saved**.

<!-- slot:trouble -->

> **If something goes wrong:** in Bangla, the **বাতিল** (Cancel) button under this question is cut off and cannot be pressed. Press **✕** at the top to go back. We are fixing this.

### Fixing a mistake <a href="#task-fix" id="task-fix"></a>

<!-- slot:before -->

> **Before you start:** you are a **teacher**, and the register is not more than **2 days** old (your school can change this limit).

Mistakes happen. Within 2 days you can fix them yourself:

1. On the section list, choose that day in **Date**.
2. Press the section card.
3. Press the name or the **status button** of the student whose mark is wrong, and set it right.
4. Press **Submit attendance** again.

<!-- slot:check -->

> **Check it worked:** you see **Attendance saved**.

<!-- slot:trouble -->

> **If something goes wrong:** if the register is more than 2 days old, the top says "This register is older than 2 days. Ask an administrator to correct it." You can only look at it then; ask an admin to change it.

<figure>
  <img src="img/attendance-09-old-register.png" alt="A register older than 2 days: 1 the message for teachers, 2 the ⋮ button on a row">
  <figcaption><em>1 · The message for teachers &nbsp; 2 · The ⋮ button on a row</em></figcaption>
</figure>

On an old register each row has a **⋮** button on the right. Press it to see the **History**: who changed what, and when.

---

## Faster on a computer (keyboard) <a href="#keyboard" id="keyboard"></a>

After you press one name, you can mark with the keyboard:

| Key            | Does                    |
| -------------- | ----------------------- |
| `P`            | Present                 |
| `A`            | Absent                  |
| `L`            | Late                    |
| `V`            | Leave                   |
| `Space`        | Present ↔ Absent        |
| `↑` `↓`        | Previous / next student |
| `Shift + P`    | All present             |
| `Ctrl + Enter` | Submit                  |

---

## Works together with <a href="#related" id="related"></a>

- **Teacher assignments** — an admin assigns your sections here. Without it your list is empty.
- **Class routine** — once the routine is published and per-period attendance is on, the register shows period tabs.
- **Attendance reports** and **Attendance register** — built from the attendance taken here.
- **Dashboard** — the "Attendance left to take" card shows today's pending sections.
- **Settings › Attendance policy** (admin only) — weekly off days, how many days a teacher can still fix a register (2 at first), and per-period attendance.

---

## What each field means <a href="#fields" id="fields"></a>

<!-- guide:generated:fields:attendance -->

| Field                 | What to enter                                                                  | Required?                         |
| --------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| Date                  | Which day you are marking. Today is filled in; a future date cannot be chosen. | Yes                               |
| Status (each student) | Present, Absent, Late or Leave.                                                | No — the app asks if any are left |
| Minutes late          | How many minutes late, only with **Late**. 0 to 1440.                          | No                                |

<!-- /guide:generated -->

---

## Who can do what <a href="#roles" id="roles"></a>

### For teachers

- See only **your own assigned sections**.
- Take and fix attendance for today and the last 2 days.
- Older registers you can only look at.

### For admins

- See **every section**, and take attendance for today or any earlier day.
- If a teacher cannot take a section's attendance, you can take it yourself.
- If a section's attendance is very late, you can get an alert.

{% hint style="warning" %}
**Known issue:** if you change a register older than 2 days and press **Submit attendance**, the app now shows "Could not save attendance". The box for the reason does not appear on the page yet. We are fixing this.
{% endhint %}

### For headmasters, principals, accountants, office staff and exam controllers

- You can see **every section's** register, but not change it. **All present** and **Submit** are not shown.
- **Headmasters and principals:** if a section's attendance is very late, you can get an alert too.

---

## Video <a href="#video" id="video"></a>

<!-- guide:generated:video:attendance.attendance -->

_Video coming soon._
<!-- /guide:generated -->

---

_Version 0.1.0_
