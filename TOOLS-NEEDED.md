# Tools needed later

Ideas that need a tool, service or account we don't have yet. Each entry says what it would unlock and what's in place for now.

## Shared progress tracking for a masjid team

- **What it unlocks:** everyone on a masjid's team sees the same "My programs" dashboard, on any device, with changes showing up for everyone. It also enables history (who ticked what, when) and dashboards that compare several mosques.
- **What's needed:** a small hosted database with sign-in. Options include Supabase or Firebase (both have free tiers), or a GitHub-based login if the team already uses GitHub. Someone has to create the account, and we'd need to decide who can see a masjid's data.
- **For now:** progress is saved in each visitor's browser (`localStorage`). The dashboard's **Download backup** and **Load a backup** buttons let a team pass progress between people and devices by file.
- **Logged:** 2026-10-22

## AI story picking and summaries for the news page

- **What it unlocks:** a smarter filter that scores each story for a positive tone and finds local mosque and community news, plus a short original summary and a "why it matters for your community" line for each story.
- **What's needed:** an Anthropic API key, saved as a GitHub Actions secret named `ANTHROPIC_API_KEY`. Estimated cost is about $1 to $25 a month depending on the model chosen for summaries.
- **For now:** a keyword filter in `scripts/fetch-news.mjs` picks stories, and the page shows each publisher's own short excerpt.
- **Logged:** 2026-11-18

## Custom domain for the news site (optional)

- **What it unlocks:** a memorable address instead of `<user>.github.io/<repo>`.
- **What's needed:** a domain name (roughly $10 to $15 a year) pointed at GitHub Pages or Netlify.
- **For now:** the default GitHub Pages or Netlify address.
- **Logged:** 2026-11-18
