<!-- guide:meta
feature: start.phone
title: Open on your phone and install as an app
summary: Open the school's address in Chrome or Safari on your phone, and keep SchoolManager on your home screen so it opens in one tap.
roles: [ADMIN, EXECUTIVE, TEACHER, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER, COMMITTEE, PARENT, STUDENT]
sources:
  - client-admin/src/components/staff-user-menu.tsx
  - client-admin/src/pwa/manifest.ts
  - client-admin/src/routes/_staff.tsx
  - ui/src/pwa/use-install-prompt.ts
  - ui/src/pwa/install-prompt-store.ts
  - ui/src/pwa/ios-install-sheet.tsx
  - e2e/pwa/installability.spec.ts
labels: [nav:installPrompt.*, nav:userMenu.label, nav:openMenuLabel, nav:items.more]
helpIds: [start.phone, start.phone.action.install]
devices: [phone]
entry: [public]
keywords: [phone, mobile, install app, home screen, Chrome, iPhone, Safari]
appVersion: 0.1.0 (c08a9eb19)
owner: tareq89
lastVerified: 2026-10-24
knownIssues:
  - { id: ios-sheet-old-name, checked: 2026-10-24, issue: null }
-->

# Open on your phone and install as an app

Open the school's address in Chrome or Safari on your phone, and keep SchoolManager on your home screen so it opens in one tap.

**Where to go:** **Google Chrome** on an Android phone, **Safari** on an iPhone. After you sign in, use **Account menu** at the top right, then **Install app**.
**Before you start:** The school's address (the admin gives it to you), and one [sign in](sign-in.md).

SchoolManager runs in the browser. You do not download it from the Play Store or App Store. **Install** means putting an icon on your home screen. Tap the icon and the app opens full screen, without the browser's address bar.

[Install on Android](#task-main) · [Install on iPhone](#task-iphone) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [Open and install on an Android phone](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
  - [On an iPhone](#task-iphone)
  - [If the app menu has no install button](#task-chrome-menu)
  - [Using the app on a phone](#task-use)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Known issues](#known-issues)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**First day:** The school sends the address or an invitation link by SMS or email. When you open the link on your phone, it opens in the phone's main browser. On an iPhone, if that is not Safari, copy the address and open it in Safari.

**If you already use it on a computer:** Open the same address on your phone and [sign in](sign-in.md) with the same phone number or email.

---

## Open and install on an Android phone <a href="#task-main" id="task-main"></a>

1. Open **Chrome** on your phone. Type the school's address in the address bar at the top and open it.

   → The **Sign in** page appears.

2. [Sign in](sign-in.md).

   → The first page of the app opens. There are a few buttons at the bottom, **☰** (Open menu) at the top left, and at the top right the search button, the notification bell and **Account menu**.

3. Tap **Account menu** (the round person-icon button) at the top right.

   → The menu opens. **Install app** is near the bottom.

<!-- image pending: img/phone-01-install-menu.png (width 300) — Account menu open on a phone: 1 Account menu, 2 Install app. Source: e2e/docs/tours/start-phone.tour.ts at 390 px -->

4. Tap **Install app**.

   → Chrome shows a small window of its own and asks whether you want to install.

5. In Chrome's window, tap **Install**.

   → In a few seconds the **SchoolManager** icon appears on your home screen.

<!-- image pending: img/phone-02-chrome-dialog.png (width 300) — Chrome's install window. Playwright cannot capture Chrome's own window; this needs a real phone or an Android emulator -->

> **Remember:** Installing only puts an icon on this phone. Your data stays in the school's system. If you delete the icon, nothing is lost, and you can open the address in Chrome and work again.

---

## How to know it worked <a href="#confirm" id="confirm"></a>

Installing does not send anything to the school's system, so there is no three-state table here. When it worked:

- The **SchoolManager** icon is on your home screen (or in the list of all apps).
- When you tap the icon, the app opens full screen, with no browser address bar at the top.
- In the installed app, **Account menu** no longer shows **Install app**.

**To check:** Open the app from the home screen icon and look for your name in **Account menu**. If it asks you to sign in, [sign in](sign-in.md) again.

**If the icon did not appear:** See [Problems and fixes](#trouble).

---

## Other situations <a href="#other" id="other"></a>

### On an iPhone <a href="#task-iphone" id="task-iphone"></a>

An iPhone has no install window. You put the app on the home screen with the Share button.

1. Open the school's address in **Safari** and [sign in](sign-in.md).
2. Tap **Account menu**, then tap **Install app**.

   → A card titled **Install this app** appears, with two steps.

3. Tap the **Share** button in Safari's toolbar (a box with an arrow pointing up).
4. In the list, tap **Add to Home Screen**, then tap **Add** at the top right.

   → The **SchoolManager** icon appears on your home screen.

<!-- image pending: img/phone-03-iphone-share.png (width 300) — Add to Home Screen in Safari's share list. This needs a real iPhone -->

**If you use Chrome on an iPhone:** The app menu does not show **Install app**. Tap the **Share** button next to Chrome's address bar and choose **Add to Home Screen**.

### If the app menu has no install button <a href="#task-chrome-menu" id="task-chrome-menu"></a>

**Install app** shows only when the browser offers to install. If it does not show, install from Chrome's own menu:

1. In Chrome, tap **⋮** at the top right.
2. Tap **Install app**. On some phones it is called **Add to Home screen**.
3. In the window that appears, tap **Install** or **Add**.

   → The **SchoolManager** icon appears on your home screen.

If it is not in Chrome's menu either, the app is probably already installed. Look for **SchoolManager** in the list of all apps.

**If you only want a bookmark:** Tap **⋮** in Chrome, then tap **☆** at the top. Next time you can open it from Chrome's bookmarks.

### Using the app on a phone <a href="#task-use" id="task-use"></a>

On a phone, the menu on the left is hidden. Where to find things:

| What you are looking for  | Where, on a phone                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Everyday pages            | The buttons at the bottom of the screen; the rest are under **More**                           |
| The full menu             | **☰** at the top left                                                                         |
| Finding a page            | The search button at the top right ([Find anything](find-anything.md))                         |
| Language, theme, sign out | **Account menu** at the top right ([Change language](language.md), [Your account](account.md)) |

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                     | What to do                                                                                                             | Who can help |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Install app** is not in the menu               | The app may already be installed, or the browser has not offered yet. [Install from Chrome's menu](#task-chrome-menu). | —            |
| On an iPhone, **Install app** is not in the menu | You are in Chrome or another browser. [Use the Share button](#task-iphone), or open it in Safari.                      | —            |
| Opening from the icon asks you to sign in again  | The installed app may open separately from the browser. [Sign in](sign-in.md) once more.                               | —            |
| The address does not open                        | Compare the address with the one the admin sent, and check your internet.                                              | School admin |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role      | Can open on a phone | Can install |
| --------- | ------------------- | ----------- |
| All roles | Yes                 | Yes         |

Teachers and staff get the staff app on a phone; guardians and students get the portal. The install steps are the same for both.

---

## Known issues <a href="#known-issues" id="known-issues"></a>

Checked on version 0.1.0, 2026-10-24. When fixed, this is removed from here.

| Issue                                                                                     | Who, when                 | Data saved?    | What to do for now                                               |
| ----------------------------------------------------------------------------------------- | ------------------------- | -------------- | ---------------------------------------------------------------- |
| The iPhone **Install this app** card shows the app name as "বিদ্যালয়", not SchoolManager | Safari users on an iPhone | Not applicable | Nothing. The icon on the home screen is named **SchoolManager**. |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>How installing works</strong> — which path on which phone</summary>

<figure>
  <img src="diagrams/start-phone.svg" alt="Android Chrome shows an install prompt that the app menu opens; an iPhone has no prompt, so you use Share, then Add to Home Screen" width="720">
</figure>

- On Android, Chrome gives an install window; the app menu opens that same window.
- On an iPhone there is no window; use **Share** in Safari or Chrome, then **Add to Home Screen**.
- The installed app and the browser address are the same app; your data is in the same place.

</details>

**Related pages**

- [**Signing in**](sign-in.md) — Signing in on a phone for the first time.
- [**Changing the language**](language.md) — On a phone, language is in the account menu.
- [**Your account**](account.md) — Sign out from a lost phone.
- [**Finding any page**](find-anything.md) — The search button on a phone.

---

_Version 0.1.0 · Last verified 2026-10-24_
