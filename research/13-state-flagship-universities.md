# 13 - State-to-Biggest-Public-University Lookup

Research for Larp City's university-landmark NPC (Marcus, `game/src/data/npcs.ts`), whose story reads "...a lecturer at `{{stateUniversity}}`..." and needs a real school name for whichever state the player is currently in.
Researched 2026-09-12.

## Method

Cross-referenced two sources, as named in `GameEnginePlan.md`'s Part 3 research section:

1. **[Category:Flagship universities in the United States](https://en.wikipedia.org/wiki/Category:Flagship_universities_in_the_United_States)** (Wikipedia) - fetched live via the MediaWiki API (`action=query&list=categorymembers`) on 2026-09-12, which returned 63 university pages. This is the primary source for *which* school is the state's flagship-caliber public university.
2. **[List of United States public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment)** (Wikipedia; the brief's cited title, "...by undergraduate enrollment," has since been retitled/merged - this is the current page covering the same ground) - used for current total-enrollment figures where a school appears in its "2025-26 enrollment" top-10 table, since that table's numbers are sourced to each school's own Common Data Set / institutional research office.

For every state, every university in category (1) was pulled up in its own Wikipedia infobox (`action=raw` on the university's own page) to get a "students" enrollment figure with its own citation, cross-checked against the enrollment-ranking page (2) where the school appeared there. Where the category page listed only one flagship-caliber school for a state, that school is the answer regardless of whether some other, larger, non-flagship public school exists in that state (for example Arizona State University enrolls more students than the University of Arizona, but only Arizona is in the flagship category).

**Tie-break rule** (per the task brief): where a state has more than one flagship-caliber public university in category (1), the one with the larger current enrollment wins. This came up for **Texas** (4 candidates), **Indiana** (2), **New York** (2), **Utah** (2), and **North Carolina** (2) - North Carolina is an additional multi-flagship case beyond the brief's named Texas/Indiana examples, found during this research.

**Ohio note:** the task brief states Ohio has no official "flagship" designation in Wikipedia's category and should resolve to Ohio State University by the enrollment rule anyway. On the live fetch (2026-09-12), **Ohio State University is in fact present** in the Flagship Universities category (Wikipedia categories change over time; this may postdate whenever the brief was written). Either way the answer is the same: Ohio State University, both as the sole Ohio entry in the category today and as the largest Ohio public university by enrollment.

Every row below cites the specific page fetched. Where a school's own infobox lacked a recent figure but it appeared in the enrollment-ranking page's 2025-26 table, that number is used and cited instead (Illinois, Minnesota, Ohio, Texas A&M, UT Austin).

## Table

| State | University | Enrollment | Source |
| --- | --- | --- | --- |
| AL | University of Alabama | 42,360 (fall 2025) | [University of Alabama](https://en.wikipedia.org/wiki/University_of_Alabama) |
| AK | University of Alaska Fairbanks | 6,893 (fall 2024) | [University of Alaska Fairbanks](https://en.wikipedia.org/wiki/University_of_Alaska_Fairbanks) |
| AZ | University of Arizona | 54,384 (fall 2025) | [University of Arizona](https://en.wikipedia.org/wiki/University_of_Arizona) |
| AR | University of Arkansas | 34,174 (fall 2025) | [University of Arkansas](https://en.wikipedia.org/wiki/University_of_Arkansas) |
| CA | University of California, Berkeley | 45,882 (fall 2024) | [University of California, Berkeley](https://en.wikipedia.org/wiki/University_of_California,_Berkeley) |
| CO | University of Colorado Boulder | 38,808 (fall 2025) | [University of Colorado Boulder](https://en.wikipedia.org/wiki/University_of_Colorado_Boulder) |
| CT | University of Connecticut | 33,554 (2024) | [University of Connecticut](https://en.wikipedia.org/wiki/University_of_Connecticut) |
| DE | University of Delaware | 24,221 (fall 2023) | [University of Delaware](https://en.wikipedia.org/wiki/University_of_Delaware) |
| DC | University of the District of Columbia | 4,202 (fall 2024) | [University of the District of Columbia](https://en.wikipedia.org/wiki/University_of_the_District_of_Columbia) |
| FL | University of Florida | 63,148 (2025-26) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment) |
| GA | University of Georgia | 43,887 | [University of Georgia](https://en.wikipedia.org/wiki/University_of_Georgia) |
| HI | University of Hawaiʻi at Mānoa | 20,012 (fall 2024) | [University of Hawaiʻi at Mānoa](https://en.wikipedia.org/wiki/University_of_Hawai%CA%BBi_at_M%C4%81noa) |
| ID | University of Idaho | 12,383 (fall 2025) | [University of Idaho](https://en.wikipedia.org/wiki/University_of_Idaho) |
| IL | University of Illinois Urbana-Champaign | 60,848 (2025) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment) |
| IN | Purdue University (tie-break: Purdue 57,310 vs. Indiana University Bloomington 48,424) | 57,310 (fall 2025) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment); Bloomington figure from [Indiana University Bloomington](https://en.wikipedia.org/wiki/Indiana_University_Bloomington) |
| IA | University of Iowa | 31,563 (fall 2025) | [University of Iowa](https://en.wikipedia.org/wiki/University_of_Iowa) |
| KS | University of Kansas | 31,169 (fall 2025) | [University of Kansas](https://en.wikipedia.org/wiki/University_of_Kansas) |
| KY | University of Kentucky | 35,952 (fall 2024) | [University of Kentucky](https://en.wikipedia.org/wiki/University_of_Kentucky) |
| LA | Louisiana State University | 42,016 (fall 2024) | [Louisiana State University](https://en.wikipedia.org/wiki/Louisiana_State_University) |
| ME | University of Maine | 10,878 (fall 2024) | [University of Maine](https://en.wikipedia.org/wiki/University_of_Maine) |
| MD | University of Maryland, College Park | 40,792 (fall 2022) | [University of Maryland, College Park](https://en.wikipedia.org/wiki/University_of_Maryland,_College_Park) |
| MA | University of Massachusetts Amherst | 31,318 (fall 2025) | [University of Massachusetts Amherst](https://en.wikipedia.org/wiki/University_of_Massachusetts_Amherst) |
| MI | University of Michigan | 53,488 (2025) | [University of Michigan](https://en.wikipedia.org/wiki/University_of_Michigan) |
| MN | University of Minnesota | 57,879 (fall 2025) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment) |
| MS | University of Mississippi | 27,124 (2023-24) | [University of Mississippi](https://en.wikipedia.org/wiki/University_of_Mississippi) |
| MO | University of Missouri | 31,543 (fall 2024) | [University of Missouri](https://en.wikipedia.org/wiki/University_of_Missouri) |
| MT | University of Montana | 11,064 (fall 2025) | [University of Montana](https://en.wikipedia.org/wiki/University_of_Montana) |
| NE | University of Nebraska-Lincoln | 23,954 (fall 2025) | [University of Nebraska-Lincoln](https://en.wikipedia.org/wiki/University_of_Nebraska%E2%80%93Lincoln) |
| NV | University of Nevada, Reno | 20,945 (fall 2022) | [University of Nevada, Reno](https://en.wikipedia.org/wiki/University_of_Nevada,_Reno) |
| NH | University of New Hampshire | 14,784 (2019) | [University of New Hampshire](https://en.wikipedia.org/wiki/University_of_New_Hampshire) |
| NJ | Rutgers University | 52,269 (2024-25, New Brunswick) | [Rutgers, The State University of New Jersey - Facts & Figures](https://www.rutgers.edu/about/by-the-numbers) |
| NM | University of New Mexico | 25,441 (fall 2021) | [University of New Mexico](https://en.wikipedia.org/wiki/University_of_New_Mexico) |
| NY | University at Buffalo (tie-break: Buffalo 31,656 vs. Stony Brook University 27,252) | 31,656 (fall 2025) | [University at Buffalo](https://en.wikipedia.org/wiki/University_at_Buffalo); Stony Brook figure from [Stony Brook University](https://en.wikipedia.org/wiki/Stony_Brook_University) |
| NC | North Carolina State University (tie-break: NC State 39,259 vs. UNC Chapel Hill 32,234) | 39,259 (fall 2025) | [North Carolina State University](https://en.wikipedia.org/wiki/North_Carolina_State_University); UNC figure from [University of North Carolina at Chapel Hill](https://en.wikipedia.org/wiki/University_of_North_Carolina_at_Chapel_Hill) |
| ND | University of North Dakota | 15,844 (fall 2025) | [University of North Dakota](https://en.wikipedia.org/wiki/University_of_North_Dakota) |
| OH | Ohio State University (see Ohio note above; sole category entry and largest by enrollment either way) | 67,255 (2025-26) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment) |
| OK | University of Oklahoma | 34,523 (fall 2024, all campuses) | [University of Oklahoma](https://en.wikipedia.org/wiki/University_of_Oklahoma) |
| OR | University of Oregon | 24,448 (fall 2025) | [University of Oregon](https://en.wikipedia.org/wiki/University_of_Oregon) |
| PA | Pennsylvania State University | 86,557 (fall 2025, all campuses) | [Pennsylvania State University](https://en.wikipedia.org/wiki/Pennsylvania_State_University) |
| RI | University of Rhode Island | 17,210 (fall 2024) | [University of Rhode Island](https://en.wikipedia.org/wiki/University_of_Rhode_Island) |
| SC | University of South Carolina | over 40,000 (fall 2025, Columbia campus) | [USC welcomes students back to campus, fall 2025 enrollment announcement](https://sc.edu/uofsc/posts/2025/08/enrollment-announcement-fall-2025.php) |
| SD | University of South Dakota | 10,405 | [University of South Dakota](https://en.wikipedia.org/wiki/University_of_South_Dakota) |
| TN | University of Tennessee | 40,784 (fall 2025) | [University of Tennessee](https://en.wikipedia.org/wiki/University_of_Tennessee) |
| TX | Texas A&M University (tie-break: A&M 81,354 vs. UT Austin 55,000 vs. North Texas 46,940 vs. Texas Tech 42,455) | 81,354 (2025-26) | [List of US public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_enrollment); other three from [University of Texas at Austin](https://en.wikipedia.org/wiki/University_of_Texas_at_Austin), [University of North Texas](https://en.wikipedia.org/wiki/University_of_North_Texas), [Texas Tech University](https://en.wikipedia.org/wiki/Texas_Tech_University) |
| UT | University of Utah (tie-break: Utah 36,881 vs. Utah State 29,831) | 36,881 (fall 2024) | [University of Utah](https://en.wikipedia.org/wiki/University_of_Utah); Utah State figure from [Utah State University](https://en.wikipedia.org/wiki/Utah_State_University) |
| VT | University of Vermont | 14,320 (fall 2023) | [University of Vermont](https://en.wikipedia.org/wiki/University_of_Vermont) |
| VA | University of Virginia | 26,685 (fall 2025) | [University of Virginia](https://en.wikipedia.org/wiki/University_of_Virginia) |
| WA | University of Washington | 51,719 (fall 2024) | [University of Washington](https://en.wikipedia.org/wiki/University_of_Washington) |
| WV | West Virginia University | 26,046 (fall 2025) | [West Virginia University](https://en.wikipedia.org/wiki/West_Virginia_University) |
| WI | University of Wisconsin-Madison | 48,557 (2024) | [University of Wisconsin-Madison](https://en.wikipedia.org/wiki/University_of_Wisconsin%E2%80%93Madison) |
| WY | University of Wyoming | 10,813 (fall 2024) | [University of Wyoming](https://en.wikipedia.org/wiki/University_of_Wyoming) |

## Multi-flagship states found

Beyond the brief's named Texas and Indiana, this research also found **New York** (University at Buffalo vs. Stony Brook University, both SUNY flagship-tier campuses) and **North Carolina** (NC State vs. UNC Chapel Hill) and **Utah** (University of Utah vs. Utah State University) carrying more than one entry in the flagship category. All five multi-flagship states were resolved the same way: larger current enrollment wins.

## Regenerating the shipped file

`game/src/data/state-universities.ts` is generated by hand from the table above, the same relationship `game/src/data/states.ts` has to `research/02-states-cost-of-living.md`. If this table is ever revised (a school's enrollment changes the tie-break winner, or Wikipedia's flagship category changes), regenerate that file's `STATE_UNIVERSITY` map from the updated table.
