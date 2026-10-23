# User-guide page template (locked 2026-10-24, Epic 42 D44)

Copy this file to `docs/user-guide/bn/<section>/<feature>.md`, write it in
Bangla, then mirror it to `docs/user-guide/en/<section>/<feature>.md`. Keep the
section order and the anchor ids: `guide:check` (#2518) looks for them, and the
reader learns one shape for every page.

The reference page is `docs/user-guide/bn/attendance/attendance.md` (PR #2831).
The rules behind each block are in the epic (#860, D44–D46) and in
`writing-guide.md` (#2517).

Rendering constraint: plain Markdown plus the HTML that both GitHub and GitBook
render — `<figure>`, `<figcaption>`, `<img width>`, `<details>`, `<summary>`,
`<a id>`. No CSS, no `<div align>`. `{% hint %}` is GitBook-only and shows as
plain text on GitHub; that is accepted.

---

```markdown
<!-- guide:meta
feature: <section>.<feature>            # id from features.json
title: <পাতার নাম>                       # the outcome, as a verb phrase
summary: <এক বাক্যে ফল>
roles: [TEACHER, ADMIN, …]
sources: [<client files the page describes>]
labels: [<i18n namespaces:keys the page quotes>]
helpIds: [<feature>.<…>]                 # Epic 44 reads these
devices: [desktop, phone]
entry: [sidebar, dashboard:<card>, notification:<type>, page:<feature>, public, palette]
keywords: [<bn words>, <en words>]
appVersion: <x.y.z> (<sha>)
owner: <github login>
lastVerified: <YYYY-MM-DD>
knownIssues:
  - { id: <slug>, checked: <YYYY-MM-DD>, issue: <#n or null> }
-->

# <পাতার নাম>

<এক বাক্যে: এই পাতায় আপনি কী করতে পারবেন।>

**যেতে হবে:** বাম মেনুতে **<গ্রুপ> → <আইটেম>**। ফোনে <কোথায়>।
**শুরুর আগে:** <শুধু যা না থাকলে কাজটি আটকে যায়, প্রতিটি লিংক সহ।>

<এক অনুচ্ছেদ: যে জিনিসটি নিয়ে কাজ, তার নাম একবার বুঝিয়ে দিন — যেমন "হাজিরার খাতা"। এরপর সব জায়গায় সেই নামই।>

[<প্রধান কাজ>](#task-main) · [<দ্বিতীয় কাজ>](#task-…) · [<তৃতীয়>](#task-…) · [সমস্যা ও সমাধান](#trouble)

**এই পাতায় যা আছে**

- [এই পাতায় যেভাবে আসবেন](#arrive) <!-- only when entry has more than sidebar/palette -->
- [<প্রধান কাজ>](#task-main)
- [<কাজ> হয়েছে কি না বুঝবেন কীভাবে](#confirm)
- [অন্য পরিস্থিতিতে](#other)
  - [<পরিস্থিতি ১>](#task-…)
  - [<পরিস্থিতি ২>](#task-…)
- [সমস্যা ও সমাধান](#trouble)
- [কে কী করতে পারেন](#roles)
- [জানা সমস্যা](#known-issues) <!-- only when there are any -->
- [আরও জানুন](#more)

---

## এই পাতায় যেভাবে আসবেন <a href="#arrive" id="arrive"></a>

<!-- Required when `entry` lists anything besides sidebar/palette (D45). One
     numbered path per entry point. Each path starts from a screen the reader
     already recognises and links the page that owns the earlier steps. -->

**<প্রবেশপথ ১, যেমন: বিজ্ঞপ্তি থেকে>**

1. <যে বার্তা বা কার্ড তিনি দেখেন, হুবহু লেখা সহ> — কোথা থেকে এল: [<মালিক পাতা>](../<section>/<page>.md)।
2. **<লিংক/বোতাম>** চাপুন। → এই পাতা খোলে, <কী আগে থেকে বসানো থাকে>।

**<প্রবেশপথ ২, যেমন: <অন্য পাতা>-র ধাপ ৪ থেকে>**

1. …

---

## <প্রধান কাজ: ক্রিয়াপদ দিয়ে> <a href="#task-main" id="task-main"></a>

1. <এক ধাপে একটি কাজ। স্ক্রিনের লেখা **হুবহু বোল্ডে**, আর কোথায় আছে।>

   → <এখন স্ক্রিনে কী দেখা যায়।>

<figure>
  <img src="img/<feature>-01-<what>.png" alt="<ছবিতে কী আছে, নম্বর সহ>">
  <figcaption><em>১ · <অংশ> &nbsp; ২ · <অংশ></em></figcaption>
</figure>

2. …
3. <শেষ ধাপ = যে চাপে কাজটি সিস্টেমে যায়।>

   → **<নিশ্চিতকরণ বার্তা, হুবহু>** আসবে, আর <এরপর অ্যাপ কী করে>।

**ফোনে** <যা আলাদা, শুধু সেটুকু>:

<figure>
  <img src="img/<feature>-phone-01-<what>.png" alt="…" width="300">
  <figcaption><em>১ · … &nbsp; ২ · …</em></figcaption>
</figure>

> **মনে রাখুন:** <কোন চাপ পর্যন্ত কিছুই সিস্টেমে যায় না।>

---

## <কাজ> হয়েছে কি না বুঝবেন কীভাবে <a href="#confirm" id="confirm"></a>

<!-- Required for every page that saves something. The three states keep the
     same names on every page. Drop a row only if that state cannot occur. -->

| অবস্থা                       | কীভাবে বুঝবেন                                          | এরপর কী            |
| ---------------------------- | ------------------------------------------------------ | ------------------ |
| **শুধু স্ক্রিনে বদলেছে**     | <…>                                                    | **<commit>** চাপুন |
| **এই ডিভাইসে সংরক্ষিত**      | **<offline toast, হুবহু>** বার্তা                      | <কখন পাঠানো হবে>   |
| **স্কুলের সিস্টেমে পৌঁছেছে** | **<saved toast, হুবহু>** বার্তা, <আর কোথায় দেখা যায়> | কাজ শেষ            |

**যাচাই করতে চাইলে:** <পাতা ছেড়ে কোথায় গেলে সংরক্ষিত ফলটি দেখা যায়।>

<figure>…ফলাফলের ছবি…</figure>

**বার্তা না এলে:** [সমস্যা ও সমাধান](#trouble) দেখুন। <তথ্য হারায় কি না, এক বাক্যে।>

---

## অন্য পরিস্থিতিতে <a href="#other" id="other"></a>

### <পরিস্থিতি ১> <a href="#task-<slug>" id="task-<slug>"></a>

1. …
2. <শেষ ধাপে আবার commit action + নিশ্চিতকরণ বার্তা।>

<!-- A dialog with two or more choices gets a decision table: -->

| আপনি চাপলেন | কী হবে                        | জমা হলো?             |
| ----------- | ----------------------------- | -------------------- |
| **<বোতাম>** | <ফল, প্রতিবেদনে কী দেখাবে সহ> | হ্যাঁ / না, এখনো নয় |

---

## সমস্যা ও সমাধান <a href="#trouble" id="trouble"></a>

| আপনি যা দেখছেন           | কী করবেন | কে সাহায্য করতে পারেন |
| ------------------------ | -------- | --------------------- |
| **<বার্তা, হুবহু i18n>** | <…>      | <ভূমিকা (পাতা)>       |

<!-- Longer explanations (e.g. a conflict dialog) go below the table. -->

---

## কে কী করতে পারেন <a href="#roles" id="roles"></a>

| ভূমিকা | <ক্ষমতা ১> | <ক্ষমতা ২> | <ক্ষমতা ৩> |
| ------ | ---------- | ---------- | ---------- |

<!-- A known issue that limits a role sits in that role's row, linked to #known-issues. -->

---

## জানা সমস্যা <a href="#known-issues" id="known-issues"></a>

সংস্করণ <x.y.z>-এ যাচাই করা, <YYYY-MM-DD>। ঠিক হলে এই অংশ থেকে সরিয়ে দেওয়া হবে।

| সমস্যা | কার, কখন | তথ্য সংরক্ষিত? | আপাতত কী করবেন |
| ------ | -------- | -------------- | -------------- |

---

## আরও জানুন <a href="#more" id="more"></a>

<details>
<summary><strong>পাতার অংশগুলো</strong> — <কী কোথায়></summary>
…annotated screenshot + numbered list…
</details>

<details>
<summary><strong>কি-বোর্ড শর্টকাট</strong></summary>
…
</details>

<details>
<summary><strong>ঘরগুলোর অর্থ</strong></summary>

<!-- guide:generated:fields:<feature> -->
<!-- /guide:generated -->

</details>

<details>
<summary><strong><ফিচার> কীভাবে কাজ করে</strong></summary>
…overview diagram (width 720) + 3 bullets…
</details>

<details>
<summary><strong>পুরো কাজটি একসাথে</strong></summary>
…GIFs (desktop, then phone at width 300). No video block: narrated video is deferred (D48).…
</details>

**সম্পর্কিত পাতা**

- [**<পাতা>**](../<section>/<page>.md) — <এই পাতার সাথে সম্পর্ক, এক বাক্যে।>

---

_সংস্করণ <x.y.z> · শেষ যাচাই <YYYY-MM-DD>_
```

## English mirror

Same ids, same order. Section names: _How you get here_, _<Verb> …_, _How to
know it worked_, _Other situations_, _Problems and fixes_, _Who can do what_,
_Known issues_, _Learn more_, _Related pages_. Save states: _Changed on screen
only_, _Saved on this device_, _Reached the school's system_.

## Before you open the PR

- [ ] Every "→" line names what the screen shows, in the UI's own words.
- [ ] Every task ends on the action that commits the change and the message that confirms it.
- [ ] A page that saves something has the three-state table.
- [ ] Every dialog with two or more buttons has a decision table.
- [ ] `entry` is filled in, and "এই পাতায় যেভাবে আসবেন" exists when it needs to.
- [ ] Every bold feature name that has a page is a link, and the linked page links back under its "সম্পর্কিত পাতা".
- [ ] Main path has at most 4 images; GIFs and the diagram are inside `<details>`.
- [ ] No "আমরা ঠিক করছি" without a row in "জানা সমস্যা".
