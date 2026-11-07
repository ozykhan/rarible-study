# Postgres and OpenSearch

Written by `pnpm bench:engines` (apps/server/src/scripts/compare-engines.ts). Each benchmark search runs on both engines through the same SearchService; "same answer" means the same page of listings in the same order, the same counts per set, chips and "did you mean". Times are one search end to end from Node, warm, in ms.

Ran at 2026-11-07 12:19 UTC on commit 3619e89. 1,000,199 active listings, 20,040 cards; 20 runs of each search after one warm-up. OpenSearch 3.9.0, one node, one shard.

| search | matches | same answer | Postgres p50 / p95 | OpenSearch p50 / p95 |
| --- | ---: | --- | ---: | ---: |
| home page (newest) | 1,000,199 | yes | 1.2 / 2.1 | 6.8 / 11 |
| cheapest first | 1,000,199 | yes | 1.2 / 1.8 | 5.4 / 8.2 |
| highest grade first | 1,000,199 | yes | 1.2 / 1.6 | 8.0 / 12 |
| one set | 4,949 | yes | 1.0 / 1.4 | 11 / 15 |
| card name | 38 | yes | 10 / 17 | 7.7 / 12 |
| half a word | 10,000+ | yes | 21 / 25 | 9.9 / 12 |
| kind | 10,000+ | yes | 33 / 44 | 9.1 / 13 |
| finish (a third of the market) | 10,000+ | yes | 6.5 / 8.5 | 16 / 23 |
| grader and grade | 10,000+ | yes | 68 / 102 | 8.6 / 15 |
| kind, finish, price | 10,000+ | yes | 53 / 91 | 9.4 / 16 |
| set name and min grade | 235 | yes | 3.6 / 7.9 | 8.2 / 13 |
| word, cheapest first | 10,000+ | yes | 29 / 45 | 11 / 18 |
| seller | 483 | yes | 4.0 / 5.1 | 5.9 / 8.7 |
| typo (did you mean) | 0 (did you mean "ashen wyrm") | yes | 11 / 14 | 15 / 21 |
| described: tag | 10,000+ | yes | 22 / 29 | 10 / 15 |
| described: two tags and a finish | 1,492 | yes | 29 / 41 | 6.1 / 8.6 |
| described: tags, grade, price | 10,000+ | yes | 56 / 148 | 7.5 / 16 |
| described: tag and a name word | 10,000+ | yes | 22 / 36 | 10 / 13 |
| deep page | 10,000+ | yes | 16 / 37 | 34 / 48 |
| best match: tag | 10,000+ | yes | 30 / 39 | 24 / 29 |
| best match: tag, ranked by typed words | 10,000+ | yes | 42 / 52 | 27 / 33 |
| best match: two tags and a finish | 1,492 | yes | 31 / 42 | 16 / 24 |
| best match: tags, grade, price | 10,000+ | yes | 58 / 86 | 26 / 37 |
| best match: deep page | 10,000+ | yes | 80 / 193 | 174 / 205 |

24 of 24 searches give the same answer on both.

Whole-market numbers (listing count and floor per set): the same.

50 searches at once: Postgres 500 ms, OpenSearch 396 ms.

Word lookups for described search, for 968 catalog words and misspellings of each (3740 words): 3740 give the same known words and the same closest catalog words on both.

Size: listing_search with its indexes takes 737 MB in Postgres; the listings index takes 215 MB in OpenSearch.
