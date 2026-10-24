# Accountant

This role keeps the school's fees, bills and collections in order.

As an Accountant your day is about money. At the start of the month you generate fee bills. When someone pays, you record the payment and give a receipt. You look at what is overdue and send reminders to guardians. At the end of the day you check the collection report. You can also add students and guardians and change their details.

**At a glance:** [Your first day](#first-day) · [Who does what diagram](#diagram) · [Your 5 common tasks](#tasks) · [All features](#features) · [What you cannot do](#cannot) · [Desk card](#card)

---

## Your first day <a href="#first-day" id="first-day"></a>

1. [Sign in](../start/sign-in.md#task-main). The dashboard shows today's collection as soon as you are in.
2. [Set up the fee structure](../finance/fee-structures.md#task-main). It says how much each fee is for each class.
3. [Generate fee bills](../finance/generate-fees.md#task-main). Guardians see the bills in their app.
4. When someone pays, [record the payment](../finance/record-payment.md#task-main).
5. At the end of the day, [look at the fee collection report](../reports/collections-report.md#task-main).

---

## Who does what <a href="#diagram" id="diagram"></a>

![Accountant in the middle; the Accountant generates bills that reach the guardian's portal, takes payments, sends reminders, and goes to the Admin for approvals or cancelling a payment](diagrams/roles-accountant.svg)
<!-- diagram brief: Accountant -> portal (guardian, student) : fee bills and invoices (FEE_GENERATE, INVOICE_CREATE -> FEE_READ, INVOICE_READ); guardian -> Accountant : money, recorded as a payment (PAYMENT_RECORD); Accountant -> guardian : fee reminders and messages (COMMUNICATION_SEND); Accountant -> Admin : requests for approval and for cancelling a payment (FEE_APPROVE, PAYMENT_REVERSE Admin only); Accountant -> Academic coordinator : collection report (REPORT_COLLECTIONS_READ) -->

How money and bills travel, in one picture.

---

## Your 5 common tasks <a href="#tasks" id="tasks"></a>

1. **[Record a payment](../finance/record-payment.md#task-main)** — find the student, enter the amount, give a receipt.
2. **[Generate fee bills](../finance/generate-fees.md#task-main)** — pick the month and class, generate the bills.
3. **[See what is overdue](../finance/dues.md#task-main)** — see in the list who owes how much.
4. **[Send fee reminders](../communications/fee-reminders.md#task-main)** — pick the overdue ones and send reminders.
5. **[See the collection report](../reports/collections-report.md#task-main)** — pick a date and check the collection.

---

## All features <a href="#features" id="features"></a>

All your features, in the order of the left menu. The list is built automatically.

<!-- guide:generated:roles:accountant -->
<!-- /guide:generated -->

---

## What you cannot do <a href="#cannot" id="cannot"></a>

- Approve money-risk actions, cancel a payment or refund money. Who can: the [Admin](./admin.md).
- Delete students, fee structures or invoices. Who can: the [Admin](./admin.md).
- Take student attendance. You only view it. Who can: the [Teacher](./teacher.md).
- Anything about exams, marks or results. Who can: the [Exam controller](./exam-controller.md).
- Change school settings. Who can: the [Admin](./admin.md).

---

## Desk card <a href="#card" id="card"></a>

The five common tasks on one page, to print and keep on your desk.

[Open the card (PDF)](cards/accountant.en.pdf) · [বাংলা কার্ড (PDF)](cards/accountant.bn.pdf)

---

## Learn more <a href="#more" id="more"></a>

**Related pages**

- [Roles and access](../administration/roles.md) — what each role can do, side by side.
- [Signing in](../start/sign-in.md) — the first time in, and passwords.
- [Invoices](../finance/invoices.md) — viewing and printing bills.
- [Recurring fee schedules](../finance/recurring-schedules.md) — bills that go out by themselves each month.
- [All roles](./README.md)
