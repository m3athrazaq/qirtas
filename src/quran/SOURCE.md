# Quran text

`quran.json` holds the Uthmani text of the Quran (Hafs ʿan ʿAsim), 114 surahs and 6,236 verses, as
`[[verse1, verse2, …], …]`: one array of verses per surah, in order (`[surah - 1][verse - 1]`).
The names of the surahs are in `surahs.ts`.

Source: the [quran-json](https://github.com/risan/quran-json) package, version 3.1.2
(`dist/quran.json`), licensed CC BY 4.0, whose Uthmani text comes from
[The Noble Qur'an Encyclopedia](https://quranenc.com/en/home).

The words and marks are those of the source. Only how four marks are encoded was changed, because
the source uses the private code points of the King Fahd Complex fonts, which other fonts draw as
empty boxes; each now uses its standard Unicode character:

| Mark | Source | Here |
| --- | --- | --- |
| open fathatan (tanween) | U+0657 | U+08F0 |
| open dammatan | U+065E | U+08F1 |
| open kasratan | U+0656 | U+08F2 |
| the joining stroke before a hamza on the line (as in شَيۡـٔٗا) | U+2009 (thin space) | U+0640 (tatweel) |

The verses are shown with the Amiri Quran font (`@fontsource/amiri-quran`, SIL Open Font License 1.1).
