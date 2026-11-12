<!-- guide:meta
feature: platformOwner.recoveryCodes
title: Recovery codes and two-step sign-in
summary: Turn on two-step sign-in, keep your ten recovery codes safe, use one when your phone is lost, and make new codes; also see and sign out your devices.
roles: [SUPER_ADMIN]
sources:
  - client-admin/src/routes/_platform/owner-security/index.tsx
  - client-admin/src/routes/owner-security.two-step.tsx
  - client-admin/src/features/cockpit/two-step/security-cards.tsx
  - client-admin/src/features/cockpit/two-step/two-step-wizard.tsx
labels: [ownerSecurity:*]
helpIds: [platformOwner.recoveryCodes]
devices: [desktop, phone]
entry: [sidebar, palette]
keywords: [recovery code, two-step, authenticator, devices, security, জরুরি কোড, দুই ধাপে সাইন-ইন]
appVersion: 0.1.0 (acd66b46d)
owner: tareq89
lastVerified: 2026-11-12
knownIssues: []
-->

# Recovery codes and two-step sign-in

Keep a way into the console even when your phone is gone.

**Go to:** **Security** in the console's left menu.
**Before you start:** be signed in as a platform owner ([Platform owner sign-in](sign-in.md)).

Two-step sign-in means a code from your authenticator app after your password. **Recovery codes** are ten spare codes for the day the phone is lost or broken. Each works once.

[Turn on two-step sign-in](#task-main) · [Use a recovery code](#task-use) · [Make new codes](#task-new) · [Your devices](#task-devices) · [Problems and fixes](#trouble)

**On this page**

- [Turn on two-step sign-in](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
  - [Use a recovery code](#task-use)
  - [Make new recovery codes](#task-new)
  - [See and sign out your devices](#task-devices)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## Turn on two-step sign-in <a href="#task-main" id="task-main"></a>

Normally you do this while signing in the first time ([first time](sign-in.md#task-first)). If it is **Not set up** on the **Two-step sign-in** card:

1. Press **Set up**.
2. **Step 1 of 2, Add an authenticator app.** Scan the picture with your authenticator app (on a phone press **Open authenticator app**; if the picture does not show, type the key under **Or type this key into your app**). Type the 6-digit code and press **Next**.
3. **Step 2 of 2, Save your recovery codes.** Press **Copy** or **Download**. Keep the codes in **two places** away from your phone, for example a password manager and a paper in a safe. The codes are shown **only now**.
4. Tick **I saved them** and press **Finish**.

<figure>
  <img src="diagrams/platform-owner-recovery-codes-overview.svg" alt="Step 1 add an authenticator app, step 2 save ten recovery codes, then two-step sign-in is on; when the phone is lost one recovery code signs you in, and new codes can be made later" width="720">
  <figcaption><em>Set-up, use and renewal of recovery codes</em></figcaption>
</figure>

---

## How to know it worked <a href="#confirm" id="confirm"></a>

| What you see                         | What it means                               | What next                              |
| ------------------------------------ | ------------------------------------------- | -------------------------------------- |
| The card says **On**                 | Sign-in now asks for the app code           | Nothing more                           |
| **N recovery codes left**            | How many spare codes still work             | Make new ones when only a few are left |
| **You have no recovery codes left.** | A lost phone now cannot be recovered by you | [Make new codes](#task-new) now        |

---

## Other situations <a href="#other" id="other"></a>

### Use a recovery code <a href="#task-use" id="task-use"></a>

On the sign-in card press **Use a recovery code** and type it ([lost phone](sign-in.md#task-lost)). That code is now used up.

### Make new recovery codes <a href="#task-new" id="task-new"></a>

1. In **Recovery codes** press **Make new codes**.
2. Read "The old codes stop working. You confirm with a code next." and confirm. Type the code from your authenticator app. If **Ask the other owner first** is on and both owners are active, the other owner must approve first ([approvals](lock-and-approvals.md#task-approve)).
3. Save the new codes as in step 3 above, then press **Done**.

The old codes stop working at once, so replace your saved copies.

### See and sign out your devices <a href="#task-devices" id="task-devices"></a>

**Signed-in devices** lists the phones and computers where you are signed in now. Sign out any you do not know. You can also sign out everywhere; the console then returns you to the sign-in card.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                        | What to do                                                                                        | Who can help    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| **Code did not match, use the new 30-second code.** | Wait for the next code from the app                                                               | —               |
| **Tick "I saved them" before you finish.**          | Save the codes, then tick the box                                                                 | —               |
| **This set-up page has expired**                    | Press **Start again** and sign in; you return to set-up                                           | —               |
| **New codes could not be made. Try again.**         | Try again; check that the authenticator code is fresh                                             | —               |
| You see a device you do not know                    | Sign it out, then make new recovery codes and change your password with **Forgot your password?** | The other owner |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role           | This page                                |
| -------------- | ---------------------------------------- |
| Platform owner | Sees and changes their own security only |
| Other roles    | No access                                |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>What are recovery codes?</strong></summary>

Ten one-time codes for the day you lose your phone. Each works once. Making new codes cancels the old ones. They are not shown again after you press **Finish**, so keep them offline.

</details>

**Related pages**

- [**Platform owner sign-in**](sign-in.md) — password, app code and new devices.
- [**Locking an owner and approvals**](lock-and-approvals.md) — the other owner's part.

---

_Version 0.1.0 · Last checked 2026-11-12_
