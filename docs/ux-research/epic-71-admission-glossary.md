# Epic 71 glossary: admission pipeline

Use the **Say** column on every screen, button, SMS and error. Never use the
**Never say** column. Every screen ticket of Epic 71 cites this file.

```mermaid
flowchart LR
  A[আবেদন] --> F[ফি যাচাই] --> S[ধাপ: পরীক্ষা / লটারি] --> M[মেরিট তালিকা] --> W[অপেক্ষা-তালিকা ১/২/৩] --> D[ভর্তি]
```

| Say (Bangla) | English | Never say | Where |
|---|---|---|---|
| ভর্তি রাউন্ড | admission round | intake, batch | list, wizard, desk title |
| ধাপ | stage | pipeline, phase, workflow | stepper |
| এখন করণীয় | what to do now | next action, task queue | desk card |
| মেরিট তালিকা | merit list | ranking, rank list | lists |
| অপেক্ষা-তালিকা ১/২/৩ | waiting list 1/2/3 | waitlist tier, standby | lists |
| ভর্তির শেষ তারিখ | last date to take admission | act-by deadline, expiry | lists |
| ফি যাচাই | fee check | reconciliation, verification | applicants |
| ফি ঠিক আছে / ফেরত পাঠান | fee ok / send back | approve, reject payment | fee card |
| রোল নম্বর | roll number | serial, seat id | lists, lookup |
| ক্লার্ক দিয়ে তোলা | entered by clerk | source: CLERK, offline | applicants |
| অনলাইন | online | web, public form | applicants |
| নম্বর তুলুন | enter marks | score entry, grading | desk, grid |
| লটারি করুন | draw lottery | randomise, run draw | desk |
| কল-তালিকা | call list | outreach list | lists |
| ফল দেখুন | see result | status query, lookup | site |
| কোটা | quota (a tag) | reserved seat | form |
| আসন | seats | capacity, slots | round |
| ভর্তি করুন | admit | enrol, confirm seat | lists |
| ফি ঠিক / ফি যাচাই বাকি | fee ok / fee check pending | paid / unpaid (it is not a payment record) | badge |

## Messages

| Case | Text on screen |
|---|---|
| No rounds | এখনও কোনো ভর্তি রাউন্ড নেই |
| Wrong roll or phone | মিলছে না। আবার দেখুন। (same text for both) |
| Same transaction number seen before | এই নম্বর আগে আরেকজন দিয়েছে। দেখে নিন। (warns, does not block) |
| Score grid on phone | নম্বর তোলার জন্য কম্পিউটারে খুলুন। |
| Lottery | লটারি একবারই হয়। |
| Site not published | অনলাইনে আবেদন নিতে আগে স্কুলের ওয়েবসাইট প্রকাশ করুন। |

Public lists show **roll number only**. A name appears only after roll + phone.
