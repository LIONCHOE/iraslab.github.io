# IRAS content manager

The site at `/admin/` edits the existing HTML pages directly through the GitHub Contents API. It supports:

- People: add, edit, move between sections, reorder within a section, and remove cards; edit modal details and photos.
- Publications: add, edit, change category, reorder within a category, and remove entries. Category counts and reverse item numbers are recalculated.
- News: add, edit, remove, reorder and upload one or more photos.
- Lab Life: add, edit, remove, reorder and upload one or more photos; the existing gallery data and card indices are updated together.

## Administrator setup

1. On the GitHub account with write access to `howaboutj/howaboutj.github.io`, create a **fine-grained personal access token** for only this repository, with **Contents: Read and write** permission. Set a short expiration and regenerate it when needed. Do not put the token into any repository file.
2. Open `https://howaboutj.github.io/admin/` and enter the token. It is held in the open page only; no local storage, cookie or application server stores it. Close the page or press “연결 해제” to clear it.
3. Save edits. Each save commits the HTML (and any uploaded images) to `main`. GitHub Pages publishes the changes using the repository's existing deployment setup. If another editor changes the same file, GitHub refuses the stale save. Reload the section and retry.

This workflow does not require a paid server. It uses a GitHub token in place of an OAuth sign-in. Never share the token or use an account-wide classic token. The `/admin/` route is public, but content changes require the repository token. Removing a displayed image does not delete its original asset from the repository, so another page using that image remains intact. Uploaded images are limited to 8 MB each. The original static page remains available as before.
