// The largest public university per state, by enrollment, for the university-
// landmark NPC (Marcus, npcs.ts). Sourced and cited in
// research/13-state-flagship-universities.md; regenerate this file by hand
// from that table if it's ever revised, the same relationship states.ts has
// to research/02-states-cost-of-living.md.
//
// Where a state has more than one flagship-caliber public university (Texas,
// Indiana, New York, North Carolina, Utah), the larger by current enrollment
// wins the tie-break. Ohio has no ambiguity: Ohio State University is both
// the sole entry in Wikipedia's flagship category and the largest Ohio
// public university by enrollment.
export const STATE_UNIVERSITY: Record<string, string> = {
  AL: "University of Alabama",
  AK: "University of Alaska Fairbanks",
  AZ: "University of Arizona",
  AR: "University of Arkansas",
  CA: "University of California, Berkeley",
  CO: "University of Colorado Boulder",
  CT: "University of Connecticut",
  DE: "University of Delaware",
  DC: "University of the District of Columbia",
  FL: "University of Florida",
  GA: "University of Georgia",
  HI: "University of Hawaiʻi at Mānoa",
  ID: "University of Idaho",
  IL: "University of Illinois Urbana-Champaign",
  IN: "Purdue University",
  IA: "University of Iowa",
  KS: "University of Kansas",
  KY: "University of Kentucky",
  LA: "Louisiana State University",
  ME: "University of Maine",
  MD: "University of Maryland, College Park",
  MA: "University of Massachusetts Amherst",
  MI: "University of Michigan",
  MN: "University of Minnesota",
  MS: "University of Mississippi",
  MO: "University of Missouri",
  MT: "University of Montana",
  NE: "University of Nebraska-Lincoln",
  NV: "University of Nevada, Reno",
  NH: "University of New Hampshire",
  NJ: "Rutgers University",
  NM: "University of New Mexico",
  NY: "University at Buffalo",
  NC: "North Carolina State University",
  ND: "University of North Dakota",
  OH: "Ohio State University",
  OK: "University of Oklahoma",
  OR: "University of Oregon",
  PA: "Pennsylvania State University",
  RI: "University of Rhode Island",
  SC: "University of South Carolina",
  SD: "University of South Dakota",
  TN: "University of Tennessee",
  TX: "Texas A&M University",
  UT: "University of Utah",
  VT: "University of Vermont",
  VA: "University of Virginia",
  WA: "University of Washington",
  WV: "West Virginia University",
  WI: "University of Wisconsin-Madison",
  WY: "University of Wyoming",
};

export function stateUniversity(abbr: string): string {
  return STATE_UNIVERSITY[abbr] ?? "the state university";
}
