# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's
**Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/daksh-malhan/population-peaks/security/advisories/new)).
Don't open a public issue for anything that could put visitors at risk.

You'll get an acknowledgement within 7 days and a fix or a decision within 30 days.
Credit is given in the release notes unless you'd rather stay anonymous.

## Scope

- The website at <https://daksh-malhan.github.io/population-peaks/>
- The data pipeline in `pipeline/` and the GitHub Actions workflows in `.github/`

Out of scope: the accuracy of the source data (Kontur Population, Natural Earth, GeoNames);
please report those to their publishers.

## How the site is protected

- **No server, no accounts, no cookies, no third-party requests.** The site is static files
  on GitHub Pages; a gallery lives in the page's URL and in the visitor's own browser storage.
- **Content Security Policy** in every page: scripts, styles, fonts, data and workers only from
  the site itself; no inline scripts, no `eval`, no plugins, no forms, no `<base>` changes.
  GitHub Pages can't send response headers, so `frame-ancestors` is not available.
- **No HTML from strings.** The interface is built with DOM APIs only; a lint rule forbids
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `eval`. Share links are
  decoded with a length cap and a strict schema, and text is stripped of control and bidi
  characters.
- **Data integrity.** Kontur files are checked against their S3 ETags, Natural Earth against
  pinned git blob hashes; downloads are limited to allow-listed hosts. Each data release is
  published with a SHA-256 checksum that the deploy verifies before going live.
- **Supply chain.** Exact dependency versions with a lockfile and install scripts disabled;
  Python requirements pinned by hash; every GitHub Action pinned to a commit with
  least-privilege tokens; Dependabot, CodeQL (JavaScript/TypeScript, Python, Actions) and
  OpenSSF Scorecard run on every change.
