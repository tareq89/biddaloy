# Cockpit identity glossary

Plain words for every cockpit screen, button and error in Epic 98 (#3725). Use the **UI** column on screen. Never use the **Never say** column on a screen, a button, an error or a message.

Source: epic #3725, decision D14 (final). The last column ("Word test") records whether a real person understood the word. It stays **pending** until the owner sessions in `cockpit-identity-findings.md` are run.

| UI (bn) | English | Never say | Word test |
|---|---|---|---|
| প্ল্যাটফর্ম মালিক | platform owner | super admin, tenant | pending owner sessions |
| দুই ধাপে সাইন-ইন | two-step sign-in | MFA, 2FA, TOTP | pending owner sessions |
| অথেন্টিকেটর অ্যাপের ৬ সংখ্যার কোড | authenticator code | OTP | pending owner sessions |
| জরুরি কোড | recovery code | recovery key | pending owner sessions |
| নতুন ডিভাইস যাচাই | new-device check | device fingerprint | pending owner sessions |
| আটকে দিন / খুলে দিন | lock / unlock | suspend, revoke | pending owner sessions |
| নিশ্চিত করতে কোড দিন | confirm with a code | step-up, re-auth | pending owner sessions |
| অনুমতির অনুরোধ / অন্য মালিক | approval request / other owner | maker-checker | pending owner sessions |
| সাইন-ইন করা ডিভাইস | signed-in devices | session, token, JWT | pending owner sessions |

## Messages fixed by the epic

| Moment | English meaning | Rule |
|---|---|---|
| Wrong code | "Code did not match, use the new 30-second code." | Under the field. Never says which part was wrong before both proofs pass (Rule 18). |
| Used code | "Code already used, wait for the next code." | Codes are single-use. |
| No requests | "No request is waiting." | Empty state of the Approval requests tab. |
| Last active owner | Lock is disabled with a small note | Nobody can lock the last active owner. |

## Words changed by testing

None yet. After the sessions, add one row per word a tester misread: old word, new word, who, what they said.
