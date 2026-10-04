# [31.4.settings-3] Settings — Communication category: plain words, visible state

## Goal
The five Communication cards (SMS, SMS credit, WhatsApp, Messenger, Email) use `SettingsSection`. Each card says in its header whether it is set up. Labels are plain words instead of "Provider", "SMTP host" or "Own provider / unmetered". Rare technical fields sit under "উন্নত সেটিং". No backend string, raw id or record id is on screen (D9).

## What and why
This category is where an admin connects the school's SMS company, WhatsApp, Messenger and email server. Today each card is a bare form. Nothing says whether a channel already works. The labels are vendor jargon: "প্রোভাইডার", "গ্রিনওয়েব এপিআই কী", "এসএমটিপি হোস্ট", "নিজস্ব প্রোভাইডার / মিটারবিহীন". "Test connection" prints the server's English message. The credit history prints raw reference UUIDs. This ticket adds a set-up badge to every card header and turns the labels into plain words with a help line. It moves the optional API address, API version and port under "উন্নত সেটিং", and shows test results as a translated badge.

## Before and after

| | Desktop | Mobile |
|---|---|---|
| Before | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_communication/before-desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_communication/before-mobile.webp?raw=true" width="260"> |
| After | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_communication/desktop.webp?raw=true" width="560"> | <img src="https://github.com/tareq89/biddaloy/blob/design-assets/redesign/epic31/settings/settings_communication/mobile.webp?raw=true" width="260"> |

"Before" is the same single-column page as `admin__settings` (these cards sit in its lower half).

## Changes

| # | Where | Change | Why |
|---|---|---|---|
| 1 | All 5 cards | `SettingsSection` card with `h2`, a one-line description (**New**), and its own Save in the footer. "সংযোগ পরীক্ষা করুন" (outline, `PlugZapIcon`) goes on the left of the footer. | patterns §9; one filled button per card |
| 2 | Card headers | **New** `StatusBadge` next to the title: success "যুক্ত আছে" when the saved settings are complete, neutral "যুক্ত করা হয়নি" otherwise (rules in step 3). | D27; you cannot see today whether a channel works |
| 3 | Test result | The server's `message` is replaced by a translated badge: success "সংযোগ ঠিক আছে" / danger "সংযোগ হয়নি — তথ্যগুলো দেখে আবার চেষ্টা করুন।" (**New** `connection-test-status.tsx`). | D9: no backend strings |
| 4 | SMS | "প্রোভাইডার" → "এসএমএস কোম্পানি" (kit `Select`). "গ্রিনওয়েব এপিআই কী" → "এপিআই কী" + help. "মিমএসএমএস প্রেরক আইডি" → "প্রেরকের নাম (Sender ID)" + help. The optional API address moves under "উন্নত সেটিং". | D9, D25, D30, D32 |
| 5 | SMS credit | The mode is a `StatusBadge` (info "প্ল্যাটফর্মের ক্রেডিট" / neutral "স্কুলের নিজের এসএমএস কোম্পানি — ক্রেডিট লাগে না"). Available / reserved become two tiles ("হাতে আছে", "পাঠানোর জন্য আটকে আছে"). The ledger gets a sub-heading "ক্রেডিটের হিসাব", columns in plain words, no `reference_id`, and page size 25. | D9 (raw UUID), D19, D27, D32 |
| 6 | WhatsApp | Help under "ফোন নম্বর আইডি" (**New**). The access token gets a help line. API version moves under "উন্নত সেটিং" with help. | D30 |
| 7 | Messenger | "পেজ আইডি" → "ফেসবুক পেজ আইডি" + help. | D32 |
| 8 | Email | Order: from address, server, username, password. The labels are plain words. Port moves under "উন্নত সেটিং" with help "সাধারণত ৫৮৭…". | D30, D32 |
| 9 | Secret rows | Wording "কনফিগার করা আছে — শেষ 4821" → "যুক্ত আছে — শেষে 4821"; buttons "পরিবর্তন করুন / মুছে ফেলুন / সেট করুন" → "বদলান / মুছুন / যোগ করুন". | D32 |
| 10 | Evaluations card (Academics, settings-2) | Its SMS strings say "এসএমএস কোম্পানি" too (string change only). | one word per thing (D32) |

## Mobile behaviour
- Every field is full width. The secret row stacks: the status line, then "বদলান" + "মুছুন" side by side (each `flex-1`).
- The footer stacks: "সংযোগ পরীক্ষা করুন" (full width), the test badge, then Save (full width, from `SettingsSection`).
- The credit tiles stay 2 across. The ledger shows as DataTable cards (kind = title, credits = right side, date = subtitle, "কিসের জন্য" / reason = fields). The mockup draws them as compact rows; DataTable's card layout with these roles is correct.

## Decisions taken

| Decision | Options considered | Chosen | Why |
|---|---|---|---|
| "Access token" / "API key" | rename · keep + help | keep the word, add a help line saying where to copy it from | glossary 31.3.4a keeps "Access token" on purpose: an admin pastes it from Meta's console |
| Word for "provider" | প্রোভাইডার · সেবাদাতা · কোম্পানি | "এসএমএস কোম্পানি" / "SMS company" | Greenweb and MiM SMS are companies; easiest word for a clerk |
| Set-up badge source | form state · saved props | the saved props (`sms`, `whatsapp`…), so it changes only after Save | a badge that flips while typing would lie |
| Test result text | show server message · translated badge only | translated badge; the server message is dropped | D9; the message is English, technical, and sometimes names env vars |
| Test result component | change `ConnectionTestResultMessage` · local file | new `pages/settings/connection-test-status.tsx` | the shared component is also used by `calendar-feed-card.tsx` (calendar lane) |
| Optional fields | keep in the main grid · Advanced | API address, API version and port under "উন্নত সেটিং", forced open when one of them has an error | D30 |
| Ledger reference | UUID · type label · link | type label only ("রিমাইন্ডারের দফা", "বার্তা", "হাতে করা") | D9; there is no page to link a credit row to |

## Files
- `client-admin/src/pages/settings/SmsSection.tsx`
- `client-admin/src/pages/settings/SmsSection.test.tsx`
- `client-admin/src/pages/settings/SmsCreditSection.tsx` — `PAGE_SIZE` 25
- `client-admin/src/pages/settings/SmsCreditSectionView.tsx`
- `client-admin/src/pages/settings/SmsCreditSection.test.tsx`
- `client-admin/src/pages/settings/WhatsAppSection.tsx`
- `client-admin/src/pages/settings/WhatsAppSection.test.tsx`
- `client-admin/src/pages/settings/MessengerSection.tsx`
- `client-admin/src/pages/settings/EmailSection.tsx`
- `client-admin/src/pages/settings/EmailSection.test.tsx`
- `client-admin/src/pages/settings/connection-test-status.tsx` — **New**
- `ui/src/i18n/locales/en/settings.json`, `ui/src/i18n/locales/bn/settings.json` (also changed by settings-1a / 1b / 2, which run earlier)

## Steps
1. **Read first:** `client-admin/src/pages/settings/settings-layout.tsx` (`SettingsSection`, `SettingsSaved`, built by settings-1a) and `RegionalSection.tsx` as converted by settings-1b. Follow the same shape. The mockup is `PLAN/pages/settings/settings_communication/mockup.html`. Patterns: §4 StatusBadge, DataTable, TableCount; §6 Form, Select; §9.

2. **`connection-test-status.tsx` (new).**
   ```tsx
   export function ConnectionTestStatus({ data, isError, error }: {
     data: { success: boolean } | undefined; isError: boolean; error: unknown;
   }) {
     const { t } = useTranslation('settings');
     return (
       <>
         {data && (
           <p role="status">
             <StatusBadge tone={data.success ? 'success' : 'danger'}
               label={t(data.success ? 'testConnection.success' : 'testConnection.failure')} />
           </p>
         )}
         {isError && <MutationErrorMessage error={error} />}
       </>
     );
   }
   ```
   `data.message` is never rendered. `MutationErrorMessage` comes from `../../components/MutationErrorMessage`.

3. **Shared shape for SMS, WhatsApp, Messenger, Email.** Replace `FormShell` / `FormSection` / the button row / the status lines with:
   ```tsx
   <Form {...form}>
     <SettingsSection id="<x>-section" title={t('<x>.legend')} description={t('<x>.description')}
       badge={<StatusBadge tone={ready ? 'success' : 'neutral'} label={t(ready ? 'channelStatus.ready' : 'channelStatus.notReady')} />}
       onSubmit={(e) => void form.handleSubmit(handleSave)(e)} saving={updateSettings.isPending}
       advanced={…} advancedOpen={hasAdvancedError}
       footerStart={<>
         <Button type="button" variant="outline" className="w-full md:w-auto" loading={testConnection.isPending} onClick={handleTestConnection}><PlugZapIcon />{t('testConnection.action')}</Button>
         <ConnectionTestStatus data={testConnection.data} isError={testConnection.isError} error={testConnection.error} />
         {updateSettings.isSuccess && <SettingsSaved />}
         {updateSettings.isError && <MutationErrorMessage error={updateSettings.error} />}
       </>}>
   ```
   - Section ids: `sms-section`, `whatsapp-section`, `messenger-section`, `email-section`.
   - Field grid: `<div className="mt-4 grid gap-4 md:grid-cols-2">`. A short field that sits alone keeps half width; put `SecretField` in a `md:col-span-2` wrapper.
   - Help under a field: `<p id="<fieldId>-help" className="text-caption text-text-secondary">` + `aria-describedby` on the input. For a `SecretField`, render the help `<p>` right after it inside the same wrapper (no `aria-describedby`, see Out of scope).
   - Remove `buildFormShellErrors`, the `SMS_FIELD_IDS` map and its comment. Keep `useFormShellMode()`, `useWarnUnsavedChanges`, `buildConfig`, `handleSave`, `handleTestConnection` and every field `id` unchanged.
   - `ready` uses the saved props, never form state:
     - SMS: `sms?.provider === 'mimsms' ? Boolean(sms.mimsms?.apiKey?.configured && sms.mimsms.senderId) : Boolean(sms?.greenweb?.apiKey?.configured)`
     - WhatsApp: `Boolean(whatsapp?.phoneNumberId && whatsapp.accessToken?.configured)`
     - Messenger: `Boolean(messenger?.pageId && messenger.accessToken?.configured)`
     - Email: `Boolean(email?.host && email.password?.configured)`
   - `hasAdvancedError`: SMS `!!(errors.greenwebApiUrl || errors.mimsmsApiUrl)`; WhatsApp `!!errors.apiVersion`; Email `!!errors.port`. Messenger has no `advanced`.

4. **`SmsSection.tsx`.**
   - `provider` → `<Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="sms-provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="greenweb">{t('sms.providerGreenweb')}</SelectItem><SelectItem value="mimsms">{t('sms.providerMimsms')}</SelectItem></SelectContent></Select>`. Keep the `FormItem` / `FormLabel htmlFor="sms-provider"`.
   - Greenweb main grid: provider, then the API key `SecretField` (`label={t('sms.greenwebApiKey')}`), then help `t('sms.apiKeyHelp', { company: t('sms.providerGreenweb') })`. `advanced` = `greenwebApiUrl` input (`font-mono`, help `sms.apiUrlHelp`).
   - MiM SMS main grid: provider, `mimsmsSenderId` (required mark, help `sms.senderIdHelp`), the API key `SecretField` + help with `company: t('sms.providerMimsms')`. `advanced` = `mimsmsApiUrl` (`font-mono`, help `sms.apiUrlHelp`).
   - The keep-both-gateways behaviour (`shouldUnregister: false`, two secret states) stays as it is.

5. **`WhatsAppSection.tsx`.** Main grid: `phoneNumberId` (required mark, `inputMode="numeric"`, help `whatsapp.phoneNumberIdHelp`), then the access-token `SecretField` + help `secret.metaTokenHelp`. `advanced` = `apiVersion` (`font-mono`, help `whatsapp.apiVersionHelp`).

6. **`MessengerSection.tsx`.** Main grid: `pageId` (required mark, `inputMode="numeric"`, help `messenger.pageIdHelp`), then the access-token `SecretField` + help `secret.metaTokenHelp`. No `advanced`.

7. **`EmailSection.tsx`.** Main grid in this order: `from` (required), `host` (required, `font-mono`), `user` (required), then the password `SecretField`. `advanced` = `port` (`inputMode="numeric"`; drop `type="number"`, keep the string schema; help `email.portHelp`). Keep the "test runs validation first" behaviour (`handleSubmit` inside `handleTestConnection`).

8. **`SmsCreditSectionView.tsx`.**
   - Outer: `<SettingsSection id="sms-credit-section" title={t('smsCredit.legend')} description={…} badge={…}>` with no `onSubmit` (renders `<section>`, no Save).
     - When `credits` is loaded: `badge` = `<StatusBadge tone={credits.metering === 'PLATFORM' ? 'info' : 'neutral'} label={t(credits.metering === 'PLATFORM' ? 'smsCredit.modePlatform' : 'smsCredit.modeOff')} />`; `description` = `t(credits.metering === 'PLATFORM' ? 'smsCredit.description' : 'smsCredit.descriptionOff')`.
     - While loading or on error: no badge, `description={t('smsCredit.description')}`.
   - Loading: a skeleton (`aria-busy="true"`, two `h-16 rounded-md bg-muted` tiles). Error: `ErrorState` as today, inside the card.
   - PLATFORM tiles: `<dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">`. Each tile is `<div className="rounded-md bg-muted p-3"><dt className="text-caption text-text-secondary">…</dt><dd className="text-h2 tabular-nums">{formatNumber(…)}</dd></div>`. Labels: `smsCredit.available`, `smsCredit.reserved`. The old inner `Card` and its mode sentence go.
   - `<h3 className="mt-6 text-h3">{t('smsCredit.ledgerTitle')}</h3>`, then the `DataTable` in a `mt-2` wrapper.
   - Columns, in order:

     | id | header | value | card |
     |---|---|---|---|
     | `createdAt` | `ledger.dateHeader` | `formatDate(new Date(row.created_at), config)` | `subtitle` |
     | `kind` | `ledger.kindHeader` | `t(`smsCredit.ledger.kind.${row.kind}`)` | `title` |
     | `units` | `ledger.unitsHeader` | today's signed `formatNumber` | `badge`, `align: 'end'` |
     | `reference` | `ledger.referenceHeader` | `row.reference_type ? t(`smsCredit.ledger.referenceType.${row.reference_type}`) : '—'` (no `reference_id`) | `field` |
     | `reason` | `ledger.reasonHeader` | `row.reason ?? '—'` | `field` |

   - Replace `emptyMessage` with `emptyState={{ title: t('smsCredit.ledger.empty'), explanation: t('smsCredit.ledger.emptyExplanation') }}`.

9. **`SmsCreditSection.tsx`.** `const PAGE_SIZE = 25;` (D19). Nothing else changes.

10. **i18n `settings.json`, en + bn.**
    - Change:
      - `sms.provider` → "SMS company" / "এসএমএস কোম্পানি"
      - `sms.greenwebApiKey`, `sms.mimsmsApiKey` → "API key" / "এপিআই কী"
      - `sms.greenwebApiUrl`, `sms.mimsmsApiUrl` → "API address (optional)" / "এপিআই ঠিকানা (ঐচ্ছিক)"
      - `sms.mimsmsSenderId` → "Sender name (Sender ID)" / "প্রেরকের নাম (Sender ID)"
      - `smsCredit.modeOff` → "School's own SMS company — no credit needed" / "স্কুলের নিজের এসএমএস কোম্পানি — ক্রেডিট লাগে না"
      - `smsCredit.modePlatform` → "Platform credit" / "প্ল্যাটফর্মের ক্রেডিট"
      - `smsCredit.available` → "Available" / "হাতে আছে"
      - `smsCredit.reserved` → "Held for sending" / "পাঠানোর জন্য আটকে আছে"
      - `smsCredit.ledger.caption` → "SMS credit history, newest first." / "এসএমএস ক্রেডিটের হিসাব, নতুনগুলো আগে।"
      - `smsCredit.ledger.unitsHeader` → "Credit" / "ক্রেডিট"
      - `smsCredit.ledger.referenceHeader` → "What for" / "কিসের জন্য"
      - `smsCredit.ledger.kind.*`: GRANT "Added" / "যোগ হয়েছে", RESERVE "Held" / "আটকে রাখা", DEBIT "Used" / "খরচ", RELEASE "Returned" / "ফেরত", ADJUST "Adjusted" / "সমন্বয়"
      - `smsCredit.ledger.referenceType.manual` → "By hand" / "হাতে করা"
      - `whatsapp.apiVersion` → "API version (optional)" / "এপিআই ভার্সন (ঐচ্ছিক)"
      - `messenger.pageId` → "Facebook Page ID" / "ফেসবুক পেজ আইডি"
      - `email.host` → "Email server (SMTP)" / "ইমেইল সার্ভার (SMTP)"
      - `email.port` → "Port" / "পোর্ট"
      - `email.user` → "Server username" / "সার্ভারের ব্যবহারকারীর নাম"
      - `email.from` → "Send emails from" / "যে ঠিকানা থেকে ইমেইল যাবে"
      - `email.password` → "Server password" / "সার্ভারের পাসওয়ার্ড"
      - `secret.configured` → "Added — ends {{hint}}" / "যুক্ত আছে — শেষে {{hint}}"
      - `secret.configuredNoHint` → "Added" / "যুক্ত আছে"
      - `secret.notConfigured` → "Not added" / "যুক্ত করা হয়নি"
      - `secret.replace` → "Change" / "বদলান"
      - `secret.clear` → "Remove" / "মুছুন"
      - `secret.set` → "Add" / "যোগ করুন"
      - `evaluations.providerReady` (added by settings-2) → "SMS company added" / "এসএমএস কোম্পানি যুক্ত আছে"
      - `evaluations.providerNotConfigured` → "No SMS company added." / "এসএমএস কোম্পানি যুক্ত করা হয়নি।"
      - `evaluations.providerMissingWarning` → "Incident SMS will not be sent until an SMS company is added in Communication." / "যোগাযোগ বিভাগে এসএমএস কোম্পানি যুক্ত না করা পর্যন্ত ঘটনার এসএমএস যাবে না।"
      - `evaluations.openSmsSettings` → "Communication › add SMS company" / "যোগাযোগ › এসএমএস কোম্পানি যুক্ত করুন"
    - Add:
      - `channelStatus.ready` "Set up" / "যুক্ত আছে"
      - `channelStatus.notReady` "Not set up" / "যুক্ত করা হয়নি"
      - `testConnection.success` "Connection works" / "সংযোগ ঠিক আছে"
      - `testConnection.failure` "Couldn't connect — check the details and try again." / "সংযোগ হয়নি — তথ্যগুলো দেখে আবার চেষ্টা করুন।"
      - `sms.description` "All SMS from this school go through this company." / "এই স্কুলের সব এসএমএস এই কোম্পানির মাধ্যমে যায়।"
      - `sms.apiKeyHelp` "Copy it from your {{company}} account page. After saving, the full key is never shown again." / "{{company}}-এর অ্যাকাউন্ট পাতা থেকে কপি করে বসান। সংরক্ষণের পর পুরো কী আর দেখানো হয় না।"
      - `sms.apiUrlHelp` "Leave empty to use the company's own address." / "ফাঁকা রাখলে কোম্পানির নিজের ঠিকানা ব্যবহার হয়।"
      - `sms.senderIdHelp` "The name people see as the sender. Use the one the company approved." / "প্রাপক প্রেরক হিসেবে যে নাম দেখেন। কোম্পানি যেটি অনুমোদন করেছে সেটিই দিন।"
      - `smsCredit.description` "Each SMS uses credit. Credit is added by the platform." / "প্রতিটি এসএমএস পাঠাতে ক্রেডিট লাগে। ক্রেডিট প্ল্যাটফর্ম থেকে যোগ করা হয়।"
      - `smsCredit.descriptionOff` "This school sends SMS through its own company, so no credit is counted." / "এই স্কুল নিজের এসএমএস কোম্পানি দিয়ে পাঠায়, তাই ক্রেডিট গোনা হয় না।"
      - `smsCredit.ledgerTitle` "Credit history" / "ক্রেডিটের হিসাব"
      - `smsCredit.ledger.emptyExplanation` "Credit added or used will show here." / "ক্রেডিট যোগ বা খরচ হলে এখানে দেখা যাবে।"
      - `whatsapp.description` "Enter your Meta Business account details to message guardians on WhatsApp." / "অভিভাবকদের হোয়াটসঅ্যাপে বার্তা পাঠাতে Meta Business অ্যাকাউন্টের তথ্য দিন।"
      - `whatsapp.phoneNumberIdHelp` "Find it in Meta's WhatsApp Manager. It is a long number, not a phone number." / "Meta-র WhatsApp Manager-এ পাবেন। এটি একটি লম্বা সংখ্যা, ফোন নম্বর নয়।"
      - `whatsapp.apiVersionHelp` "Leave empty to use the version the app is set to." / "ফাঁকা রাখলে ঠিক করা ভার্সন ব্যবহার হয়।"
      - `messenger.description` "Enter your Facebook Page details to message guardians on Messenger." / "স্কুলের ফেসবুক পেজ থেকে মেসেঞ্জারে বার্তা পাঠাতে পেজের তথ্য দিন।"
      - `messenger.pageIdHelp` "Find it under the page's About section." / "পেজের ‘About’ অংশের নিচে পাবেন।"
      - `secret.metaTokenHelp` "Copy it from Meta Business." / "Meta Business থেকে কপি করে বসান।"
      - `email.description` "Emails from this school are sent through this server." / "এই স্কুলের ইমেইল এই সার্ভার দিয়ে পাঠানো হয়।"
      - `email.portHelp` "Usually 587. Change it only if your email server says so." / "সাধারণত ৫৮৭। সার্ভার অন্য নম্বর না বললে বদলাবেন না।"
    - Run `yarn workspace @biddaloy/ui check:i18n`.

## Tests
- `SmsSection.test.tsx:63`: find the select by its new label "SMS company" (a combobox now: open it and pick the option). Add: with a saved Greenweb key (`apiKey: { configured: true, hint: '4821' }`) the header shows "Set up"; without one it shows "Not set up". The API address input is inside the closed "Advanced settings" disclosure.
- `WhatsAppSection.test.tsx:75`: the test result shows "Connection works" (not the server's "Connected."). Add: a `{ success: false, message: 'bad token' }` response shows "Couldn't connect — check the details and try again." and the text "bad token" is not in the document.
- `EmailSection.test.tsx:77`: the error summary ("There is 1 problem") is gone. Assert the field error under "Send emails from" instead, and that an invalid port opens the "Advanced settings" disclosure.
- `SmsCreditSection.test.tsx`: the PLATFORM fixture shows the "Platform credit" badge and the tiles "Available ২৫০" / "Held for sending ৫". A ledger row with `reference_id: '…uuid…'` shows "Reminder round" and not the UUID. The OFF fixture shows the neutral "School's own SMS company — no credit needed" badge and no tiles.
- `SchoolSettingsPage.test.tsx` (communication case from settings-1a) must still pass unchanged; re-run it.

## Acceptance
- [ ] Desktop at 1440 px matches the "after" screenshot.
- [ ] Mobile at 390 px matches the "after" screenshot (the ledger as DataTable cards); no sideways scroll at 360 px.
- [ ] Exactly one filled primary button per card; the credit card has none.
- [ ] Every control is ≥ 44 px tall on phone, keyboard reachable, with a visible focus ring (secret-row buttons: see Out of scope).
- [ ] Works in Bangla and English, light and dark; no clipped or overlapping text.
- [ ] No raw id, key, enum or ISO date on screen (D9); dates follow D5, numbers D6.
- [ ] Only existing tokens; no `max-w-*` wrapper in the route file (D15).
- [ ] Every card header shows "যুক্ত আছে" or "যুক্ত করা হয়নি", and it matches the saved settings.
- [ ] "Test connection" never shows the server's text; only the two translated badges.
- [ ] No "প্রোভাইডার", "কনফিগার", "এসএমটিপি", "মিটারবিহীন" or reference UUID anywhere in the category.
- [ ] API address, API version and port are inside "উন্নত সেটিং", and it opens by itself when one of them has an error.

## Out of scope
- `client-admin/src/components/SecretField.tsx` keeps `h-8` / `size="sm"` controls and has no help slot. It is shared with `calendar-feed-card.tsx`. Filed as a shared request (kit sizes + `description?` prop). Until then the help line sits under it without `aria-describedby`.
- The `secret.*` wording change also shows in the calendar feed card, which uses the same `SecretField` and `settings` keys. That is intended (one word per thing).
- `ConnectionTestResultMessage.tsx` still prints the server message for the calendar feed card. The calendar lane owns that page.
- The platform's own credit card (`_platform/schools/-detail/sms-credits-card.tsx`, `platform` namespace) is not touched.

## Shared requests — outcome

Requests this page filed for shared code, and what was decided. "Accepted" means the named foundation ticket ships it before this ticket runs — use it. "Refused" / "Deferred" means: use the fallback already written in the steps.

| Request | Outcome | Ticket | Use |
|---|---|---|---|
| SecretField kit sizes + description prop with aria-describedby | Accepted | 31.2.14c | <SecretField description={t('…help')} …> — drop the page's own help <p> |

Reference files: every `PLAN/…` path, `patterns.md`, `nav-icons.md`, `conflicts.md` (C-numbers), `BUGS.md` (B-numbers) and `DECISIONS.md` (D-numbers) live on branch `design-assets` under `redesign/epic31/plan/` (`PLAN/` = that folder). Read one with `git fetch origin design-assets && git show origin/design-assets:redesign/epic31/plan/kit/patterns.md`. Mockup HTML: `redesign/epic31/plan/pages/<lane>/<page>/mockup.html`.

Wave: 9   Lane: settings   Decisions: D9, D19, D25, D27, D29, D30, D32   Depends on: 31.3.8b, 31.4.settings-2
