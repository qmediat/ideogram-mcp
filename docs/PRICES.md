# Prices

`ideogram_quote` sends exactly the request the tool would send, with Ideogram's `dry_run`: the answer is the price in USD and credits (at your account's credit rate), `exact` or an `estimate` with its upper bound; nothing is generated, stored or billed. Describe has no dry run, so it cannot be quoted. A completed generation shows the cost Ideogram reports for it. This server keeps no price table: prices are the API's, per request.

## Measured quotes

Each file is one run of the live dry-run suite (`test/live-dry-run.test.mjs`, with `IDEOGRAM_API_KEY` set): every curated model quoted at no cost. The newest date is the current list.

| date | file |
|---|---|
| 2026-10-11 (newest) | [PRICES-2026-10-11.md](./PRICES-2026-10-11.md) |
| 2026-10-10 | [PRICES-2026-10-10.md](./PRICES-2026-10-10.md) |
| 2026-10-07 | [PRICES-2026-10-07.md](./PRICES-2026-10-07.md) |
