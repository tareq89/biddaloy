# Student

This role lets you see your own routine, exam schedule and results yourself.

As a student you sign in at the school's address. A separate page for you, the **portal**, opens. There you can see today's classes, exam dates, the syllabus and results. You see only your own details, nobody else's. You cannot change your school records in the portal, only look; but you can send an application to the school and answer the school's surveys.

**At a glance:** [Your first day](#first-day) · [Who does what diagram](#diagram) · [Your 5 common tasks](#tasks) · [All features](#features) · [What you cannot do](#cannot) · [Desk card](#card)

---

## Your first day <a href="#first-day" id="first-day"></a>

1. Use the link or code you got from the school to [sign in for the first time](../start/sign-in.md#task-code). If you like, [install it on your phone as an app](../start/phone.md#task-main).
2. [Look at the overview](../portal/overview.md#task-main). Today's attendance, dues and the latest result are on one page.
3. [See your routine](../portal/routine.md#task-main). You see which subject is in which period on which day.
4. [See the exam schedule](../portal/exam-schedule.md#task-main).
5. [See the syllabus](../portal/syllabus.md#task-main). You can tell which chapter will be taught when.

---

## Who does what <a href="#diagram" id="diagram"></a>

![Student in the middle; the Teacher gives attendance, homework and syllabus, the Admin publishes the routine, the Exam controller publishes the schedule and results, and all of it reaches the student in the portal; the student sends applications to the school](diagrams/roles-student.svg)
<!-- diagram brief: teacher -> student (portal) : attendance, homework, syllabus (ATTENDANCE_MARK, HOMEWORK_ASSIGN, SYLLABUS_MANAGE -> *_READ); Admin -> student (portal) : published routine (ROUTINE_MANAGE -> ROUTINE_READ); Exam controller -> student (portal) : exam schedule and published results (EXAM_MANAGE, RESULT_PUBLISH -> RESULT_READ); Accountant -> student (portal) : fee bills (FEE_GENERATE -> FEE_READ); student -> teacher / Academic coordinator / office : applications (APPLICATION_SUBMIT) -->

Which school news reaches you, and from whom.

---

## Your 5 common tasks <a href="#tasks" id="tasks"></a>

1. **[See the routine](../portal/routine.md#task-main)** — pick a day and see today's periods.
2. **[See the exam schedule](../portal/exam-schedule.md#task-main)** — see which subject's exam is when.
3. **[See results](../portal/results.md#task-main)** — pick an exam and see your own marks and grade.
4. **[See the syllabus](../portal/syllabus.md#task-main)** — pick a subject and see which chapter is when.
5. **[See attendance](../portal/attendance.md#task-main)** — pick a month and see your own attendance.

---

## All features <a href="#features" id="features"></a>

All your features, in the order of the left menu. The list is built automatically.

<!-- guide:generated:roles:student -->
<!-- /guide:generated -->

---

## What you cannot do <a href="#cannot" id="cannot"></a>

- See another student's details. You see only your own details.
- Change attendance, marks or results. If something looks wrong, tell your teacher. Who can: the [Teacher](./teacher.md), the [Exam controller](./exam-controller.md).
- Pay fees from the app. The portal only shows them; the [Accountant](./accountant.md) takes the money.
- Change your own class, section or routine. Who can: the [Admin](./admin.md).

---

## Desk card <a href="#card" id="card"></a>

The five common tasks on one page, to print and keep on your study table.

[Open the card (PDF)](cards/student.en.pdf) · [বাংলা কার্ড (PDF)](cards/student.bn.pdf)

---

## Learn more <a href="#more" id="more"></a>

**Related pages**

- [Signing in](../start/sign-in.md) — the first time in, and passwords.
- [Account (guardian and student)](../portal/account.md) — phone number, password and language.
- [Applications (guardian and student)](../portal/applications.md) — sending an application to the school.
- [Fees and invoices](../portal/fees.md) — how much is due.
- [All roles](./README.md)
