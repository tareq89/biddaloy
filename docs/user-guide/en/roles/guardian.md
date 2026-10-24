# Guardian

This role lets you see your child's fees, attendance, routine and results on your phone.

As a guardian you sign in at the school's address. Instead of the staff dashboard, a separate page for you opens, the **portal**. There you can see whether your child came to school today, how much money is due, and what homework there is. You see only your own child's details, nobody else's. If you have more than one child, each one has a separate card.

**At a glance:** [Your first day](#first-day) · [Who does what diagram](#diagram) · [Your 5 common tasks](#tasks) · [All features](#features) · [What you cannot do](#cannot) · [Desk card](#card)

---

## Your first day <a href="#first-day" id="first-day"></a>

1. Use the link or code you got from the school to [sign in for the first time](../start/sign-in.md#task-code). If you like, [install it on your phone as an app](../start/phone.md#task-main).
2. [Look at the overview](../portal/overview.md#task-main). The total due and today's attendance are at the top.
3. [See fees and invoices](../portal/fees.md#task-main). You can see how much is due for which month.
4. [See your child's attendance](../portal/attendance.md#task-main).
5. When results are published, [see the results](../portal/results.md#task-main).

---

## Who does what <a href="#diagram" id="diagram"></a>

![Guardian in the middle; the Teacher gives attendance and homework, the Accountant sends bills, the Exam controller publishes results, and all of it reaches the guardian in the portal; the guardian sends applications to the school](diagrams/roles-guardian.svg)
<!-- diagram brief: teacher -> guardian (portal) : attendance and homework (ATTENDANCE_MARK, HOMEWORK_ASSIGN -> ATTENDANCE_READ, HOMEWORK_READ); Accountant -> guardian (portal) : fee bills and invoices (FEE_GENERATE, INVOICE_CREATE -> FEE_READ, INVOICE_READ); Exam controller -> guardian (portal) : published results (RESULT_PUBLISH -> RESULT_READ); Admin -> guardian (portal) : published routine (ROUTINE_MANAGE -> ROUTINE_READ); guardian -> teacher / Academic coordinator / office : applications (APPLICATION_SUBMIT); Office staff -> guardian : invitation (GUARDIAN_CREATE) -->

Which school news reaches you, and from whom.

---

## Your 5 common tasks <a href="#tasks" id="tasks"></a>

1. **[See the overview](../portal/overview.md#task-main)** — see your child's dues and today's attendance at a glance.
2. **[See fees](../portal/fees.md#task-main)** — see how much is due on which bill, and see invoices.
3. **[See attendance](../portal/attendance.md#task-main)** — pick a month and see which days were absent.
4. **[See results](../portal/results.md#task-main)** — pick an exam and see your child's marks and grade.
5. **[Send an application](../portal/applications.md#task-main)** — pick a type, write the reason and send it to the school.

---

## All features <a href="#features" id="features"></a>

All your features, in the order of the left menu. The list is built automatically.

<!-- guide:generated:roles:parent -->
<!-- /guide:generated -->

---

## What you cannot do <a href="#cannot" id="cannot"></a>

- See another student's details. You see only your own child's details.
- Pay fees from the app. The portal only shows them; the school's [Accountant](./accountant.md) takes the money.
- Change attendance, marks or results. If something looks wrong, tell the school. Who can: the [Teacher](./teacher.md), the [Exam controller](./exam-controller.md).
- Link your child to yourself. The school office links you to your child. Who can: [Office staff](./office-staff.md).

---

## Desk card <a href="#card" id="card"></a>

The five common tasks on one page, to print and keep on the fridge or a table.

[Open the card (PDF)](cards/guardian.en.pdf) · [বাংলা কার্ড (PDF)](cards/guardian.bn.pdf)

---

## Learn more <a href="#more" id="more"></a>

**Related pages**

- [Signing in](../start/sign-in.md) — the first time in, and passwords.
- [Account (guardian and student)](../portal/account.md) — phone number, password and language.
- [Alerts and notifications (guardian and student)](../portal/notifications.md) — the school's messages and alerts.
- [Routine](../portal/routine.md) — your child's weekly routine.
- [All roles](./README.md)
