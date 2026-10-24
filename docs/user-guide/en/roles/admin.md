# Admin

This role sets up the school in the app and keeps it running.

As an Admin you can see and change everything in the school. At the start you set the school up: academic year, classes, sections, staff and students. After that you check the dashboard every day and help others with their work. Only you can approve money-risk actions and cancel payments.

**At a glance:** [Your first day](#first-day) · [Who does what diagram](#diagram) · [Your 5 common tasks](#tasks) · [All features](#features) · [What you cannot do](#cannot) · [Desk card](#card)

---

## Your first day <a href="#first-day" id="first-day"></a>

1. [Sign in](../start/sign-in.md#task-main). For a new school, the dashboard shows the setup checklist first.
2. Read [How everything in the school fits together](../admin/how-it-works.md). In five minutes you see the whole picture.
3. Follow the [School setup order](../admin/setup-order.md). First [create the academic year](../academics/academic-years.md#task-main).
4. [Set up classes, sections and subjects](../academics/classes.md#task-main).
5. [Add staff](../people/staff.md#task-main) and [give teachers their sections](../people/teaching-assignments.md#task-main).
6. [Add students](../people/students.md#task-main).

---

## Who does what <a href="#diagram" id="diagram"></a>

![Admin in the middle; the Admin adds staff and gives them roles, gives teachers their sections, sets the school settings, and approves the Accountant's money-risk actions](diagrams/roles-admin.svg)
<!-- diagram brief: Admin -> all staff : adding staff and giving roles (USER_CREATE); Admin -> teacher : class-section duty (CLASS_MANAGE, teacher assignment); Admin -> everyone : arranging and publishing the routine (ROUTINE_MANAGE); Accountant -> Admin : fee actions that need approval, cancelling payments (FEE_APPROVE, PAYMENT_REVERSE, PAYMENT_REFUND Admin only); Admin -> guardian : invitation (GUARDIAN_CREATE); Admin -> school : settings and backup (SETTINGS_MANAGE, BACKUP_MANAGE); Admin -> Exam controller : grading scale (GRADING_SCALE_MANAGE) -->

What you give to whom, and who asks you for approval.

---

## Your 5 common tasks <a href="#tasks" id="tasks"></a>

1. **[See today's work](../dashboard/dashboard.md#task-main)** — see attendance, collection and approvals on the dashboard.
2. **[Add a staff member](../people/staff.md#task-main)** — add staff with a name, phone and role.
3. **[Add a student](../people/students.md#task-main)** — pick the class-section and save the student's details.
4. **[Give a teacher sections](../people/teaching-assignments.md#task-main)** — pick the teacher, give class-sections and subjects.
5. **[Change the settings](../administration/settings.md#task-main)** — change the school profile and rules, then save.

---

## All features <a href="#features" id="features"></a>

All your features, in the order of the left menu. The list is built automatically.

<!-- guide:generated:roles:admin -->
<!-- /guide:generated -->

---

## What you cannot do <a href="#cannot" id="cannot"></a>

- Create a new role or change a role's permissions. A school has seven fixed staff roles. See [Roles and access](../administration/roles.md).
- See another school's data. Every role sees only its own school.
- Platform work, such as closing a school or giving the Super admin role. SchoolManager's own team does this; no school can give this role.

---

## Desk card <a href="#card" id="card"></a>

The five common tasks on one page, to print and keep on your desk.

[Open the card (PDF)](cards/admin.en.pdf) · [বাংলা কার্ড (PDF)](cards/admin.bn.pdf)

---

## Learn more <a href="#more" id="more"></a>

**Related pages**

- [Roles and access](../administration/roles.md) — what each role can do, side by side.
- [Signing in](../start/sign-in.md) — the first time in, and passwords.
- [School setup order](../admin/setup-order.md) — which job comes first, which comes later.
- [Activity log](../administration/audit-logs.md) — who changed what, and when.
- [All roles](./README.md)
