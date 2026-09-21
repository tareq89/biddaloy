# GitBook starter setup

This repository now contains a small customer-handbook starter. It is ready
for manual connection to GitBook; this file is for the person configuring that
connection and is not customer content.

## What is mapped

`gitbook-docs.yaml` maps two GitBook spaces to separate directories:

| Space | Repository directory | Default |
| --- | --- | --- |
| বাংলা | `docs/user-guide/bn` | Yes |
| English | `docs/user-guide/en` | No |

Each directory owns its own `README.md`, `SUMMARY.md`, and pages. Keep assets
inside the directory that uses them. Do not map `docs/architecture` or
`docs/design` into the customer site.

## Connect the site

1. Create or open the Biddaloy site in GitBook.
2. From the site content, choose **Git Sync** and set up GitHub sync.
3. Select `tareq89/biddaloy` and the branch that contains the reviewed docs.
4. Set the Git Sync **Project directory** to the repository root (leave it
   empty in GitBook if that means the root).
5. Choose the site-wide/monorepo mapping option if GitBook offers it. Import
   from **GitHub to GitBook** first to initialize the spaces from the reviewed
   repository content. Git Sync is bidirectional: later edits made in GitBook
   can sync back to GitHub, and repository changes can sync into GitBook.
6. Use GitHub pull requests as the team's normal editing path. Keep GitBook
   editing for previews or deliberate small changes, and review any GitBook
   change that is synchronized back before it reaches the publication branch.
7. Review the generated `gitbook-docs.yaml` mapping. Keep the stable keys
   `docs-bn` and `docs-en`; changing a key makes GitBook treat the space as a
   new space.
8. Preview the site, confirm both variants and their pages, then publish only
   after checking the public content.

The repository configuration intentionally omits `content.language` for both
spaces. GitBook's current configuration schema does not include `bn` in its
language enum, while the two named spaces still provide the native variant
picker. The picker should show **বাংলা** and **English**. If GitBook's UI asks
for a language metadata value that cannot represent Bangla, leave that field
unset and keep the visible space title as **বাংলা**.

## Verify after connection

- The default site opens the Bangla welcome page.
- The variant picker switches between Bangla and English.
- Each variant shows its welcome page and sample page.
- No architecture, design, credentials, or internal authoring files are
  visible in the customer site.
- Relative links work in both variants on desktop and mobile.

GitBook's current docs describe `gitbook-docs.yaml` as the site mapping file,
`README.md` as the default first page, and `SUMMARY.md` as the navigation file.
Recheck GitBook's UI and schema when connecting because those are external
service behavior.
