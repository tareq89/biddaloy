<!-- guide:meta
feature: start.language
title: Changing the language
summary: See the app in Bangla or English. It starts in Bangla; when you change it, this phone or computer remembers.
roles: [ADMIN, EXECUTIVE, TEACHER, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER, COMMITTEE, PARENT, STUDENT]
sources:
  - ui/src/components/locale-switcher.tsx
  - ui/src/components/user-menu.tsx
  - ui/src/components/auth-layout.tsx
  - ui/src/i18n/locale-storage.ts
  - ui/src/i18n/i18n.ts
  - client-admin/src/routes/_staff.tsx
  - client-admin/src/routes/portal.tsx
labels: [nav:language.*, nav:userMenu.label, nav:theme.groupLabel]
helpIds: [start.language, start.language.action.switch]
devices: [desktop, phone]
entry: [public]
keywords: [language, Bangla, Bengali, English, ভাষা, বাংলা, ইংরেজি]
appVersion: 0.1.0 (c08a9eb19)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# Changing the language

See the app in Bangla or English. It starts in Bangla; when you change it, this phone or computer remembers.

**Where to go:** On a computer, the **Change language** button at the top right (the translate icon). On a phone, the **Account menu** at the top right → **Language**. On the sign-in page, the language button at the top right.
**Before you start:** Nothing is needed. You can change it without signing in.

The app has two languages: **বাংলা** and **English**. When you change the language, buttons, menus, messages and page names change. What the school wrote itself (for example a section name or a student's name) stays exactly as written.

[Change the language](#task-main) · [On a phone](#task-phone) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [Change the language](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
  - [On a phone](#task-phone)
  - [On the sign-in page](#task-signin)
  - [On another phone or computer](#task-other-device)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**Before signing in:** the language button at the top right of the [Signing in](sign-in.md) page. See [On the sign-in page](#task-signin).

**On a computer, after signing in:** the **Change language** button in the top bar, or **Account menu** → **Language**. Start at step 1 below.

**On a phone, after signing in:** **Account menu** → **Language**. See [On a phone](#task-phone).

---

## Change the language <a href="#task-main" id="task-main"></a>

1. On a computer, at the top right next to the notification bell, press the **Change language** button (the translate icon).

   → A small list opens: **বাংলা** and **English**. The current language has a tick beside it.

<!-- image pending: img/language-01-topbar.png — Top bar: 1 the Change language button, 2 the open list with বাংলা and English -->

2. Press the language you want.

   → The whole page changes to that language at once. You do not need to reload, and the work you had open stays as it was.

You can do the same from **Account menu** → **Language**.

> **Remember:** The language choice is kept only in this browser on this phone or computer. It does not go to the school's system, and nothing changes on anyone else's screen.

---

## How to know it worked <a href="#confirm" id="confirm"></a>

| State                    | How you know                                                                                         | What next |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------- |
| **Saved on this device** | Menus and buttons are in the new language. It stays even if you close the browser and open it again. | Done      |

The language is not sent to the school's system, so the other two states do not happen here.

**To check:** reload the page. If the new language is still there, this device remembers your choice.

**If the language did not change:** see [Problems and fixes](#trouble).

---

## Other situations <a href="#other" id="other"></a>

### On a phone <a href="#task-phone" id="task-phone"></a>

The top row on a phone has no separate language button.

1. Press the **Account menu** at the top right (the round person icon).
2. Press **Language**. The current language name is shown beside it.
3. Press **বাংলা** or **English**.

   → The text changes to that language at once.

<!-- image pending: img/language-phone-01-menu.png (width 300) — Account menu on a phone: 1 Language, 2 বাংলা and English -->

### On the sign-in page <a href="#task-signin" id="task-signin"></a>

On the [Signing in](sign-in.md) page, the language button at the top right shows the current language name. Press it, then choose **বাংলা** or **English**. The language you choose here stays after you sign in.

### On another phone or computer <a href="#task-other-device" id="task-other-device"></a>

Every phone, computer and browser remembers its own choice. A new device starts in **বাংলা**; change it there once more.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                        | What to do                                                                                                                     | Who can help       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| It goes back to Bangla every time I open it         | A private or incognito window, or clearing the browser's data, means the choice is not remembered. Open it in a normal window. | —                  |
| There is no language button at the top of the phone | On a phone, language is in the **Account menu**. See [On a phone](#task-phone).                                                | —                  |
| A section or student name did not change to English | Names show the way the school wrote them. To change one, ask the admin.                                                        | The school's admin |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role      | Can change language | Where                                                                          |
| --------- | ------------------- | ------------------------------------------------------------------------------ |
| All roles | Yes                 | On a computer the top bar or **Account menu**; on a phone the **Account menu** |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>How the language works</strong></summary>

<figure>
  <img src="diagrams/start-language.svg" alt="Bangla first; when you choose a language it is saved in this browser" width="720" />
</figure>

- The first time, it is always **বাংলা**.
- When you change it, the choice is kept in this browser; it does not go to the school's system.
- The same **Account menu** also lets you change the **Theme** (Light, Dark, System).

</details>

**Related pages**

- [**Signing in**](sign-in.md) — the language button on the sign-in page.
- [**Open on your phone and install as an app**](phone.md) — where the menus are on a phone.
- [**Your account**](account.md) — everything else in the account menu.
- [**Account (parent and student)**](../portal/account.md) — changing the language in the guardian and student portal.

---

_Version 0.1.0 · Last verified 2026-10-24_
