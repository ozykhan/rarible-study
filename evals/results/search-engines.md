# Postgres and OpenSearch

Written by `pnpm bench:engines` (apps/server/src/scripts/compare-engines.ts). Each benchmark search runs on both engines through the same SearchService; "same answer" means the same page of listings in the same order, the same counts per set, chips and "did you mean". Times are one search end to end from Node, warm, in ms.

Ran at 2026-11-07 11:57 UTC on commit e64e81c. 1,000,199 active listings, 20,040 cards; 20 runs of each search after one warm-up. OpenSearch 3.9.0, one node, one shard.

| search | matches | same answer | Postgres p50 / p95 | OpenSearch p50 / p95 |
| --- | ---: | --- | ---: | ---: |
| home page (newest) | 1,000,199 | yes | 1.5 / 2.7 | 8.9 / 13 |
| cheapest first | 1,000,199 | yes | 0.9 / 1.3 | 5.9 / 8.0 |
| highest grade first | 1,000,199 | yes | 1.1 / 2.7 | 10.0 / 14 |
| one set | 4,949 | yes | 0.9 / 2.8 | 13 / 15 |
| card name | 38 | yes | 11 / 13 | 9.4 / 13 |
| half a word | 10,000+ | yes | 21 / 33 | 12 / 24 |
| kind | 10,000+ | yes | 33 / 48 | 11 / 12 |
| finish (a third of the market) | 10,000+ | yes | 8.1 / 11 | 16 / 31 |
| grader and grade | 10,000+ | yes | 76 / 102 | 9.2 / 14 |
| kind, finish, price | 10,000+ | yes | 47 / 83 | 8.5 / 14 |
| set name and min grade | 235 | yes | 2.8 / 5.0 | 11 / 30 |
| word, cheapest first | 10,000+ | yes | 30 / 37 | 11 / 20 |
| seller | 483 | yes | 3.2 / 6.4 | 6.8 / 13 |
| typo (did you mean) | 0 (did you mean "ashen wyrm") | yes | 11 / 16 | 15 / 24 |
| described: tag | 10,000+ | yes | 28 / 32 | 9.3 / 14 |
| described: two tags and a finish | 1,492 | yes | 31 / 129 | 6.6 / 8.4 |
| described: tags, grade, price | 10,000+ | yes | 52 / 67 | 7.6 / 15 |
| described: tag and a name word | 10,000+ | yes | 20 / 27 | 10 / 12 |
| deep page | 10,000+ | yes | 14 / 18 | 32 / 45 |
| best match: tag | 10,000+ | yes | 31 / 97 | 25 / 31 |
| best match: tag, ranked by typed words | 10,000+ | yes | 43 / 68 | 25 / 37 |
| best match: two tags and a finish | 1,492 | yes | 30 / 38 | 15 / 19 |
| best match: tags, grade, price | 10,000+ | yes | 52 / 74 | 23 / 28 |
| best match: deep page | 10,000+ | yes | 77 / 168 | 152 / 173 |

24 of 24 searches give the same answer on both.

Whole-market numbers (listing count and floor per set): the same.

50 searches at once: Postgres 467 ms, OpenSearch 346 ms.

Word lookups for described search, for 968 catalog words and misspellings of each (3740 words): 3740 give the same known words and the same closest catalog words on both.

Size: listing_search with its indexes takes 737 MB in Postgres; the listings index takes 215 MB in OpenSearch.
