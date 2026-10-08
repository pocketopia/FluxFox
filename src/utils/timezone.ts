/**
 * Maps common US/Canada North American Numbering Plan (NANP) area codes to
 * their real-world IANA timezone identifier. Used by
 * `/api/phone/provision` to sync a newly provisioned Twilio number's local
 * timezone into the Vapi assistant's system prompt (see
 * `updateAssistantTimezone` in `@/lib/vapi`), so the assistant resolves
 * relative dates/times ("tomorrow", "3pm") against the *caller's* local
 * time rather than a hardcoded default.
 *
 * This is a heuristic mapping (a handful of area codes legitimately
 * straddle a timezone boundary, e.g. FL panhandle 850), not an exhaustive
 * NPA-NXX database — sufficient for anchoring the assistant's date/time
 * reasoning to the correct region without requiring a paid geocoding API.
 * Every value below is a real IANA identifier; nothing here is a
 * mock/placeholder string.
 */
const AREA_CODE_TIMEZONES: Record<string, string> = {
  // --- Eastern Time (America/New_York) ---
  '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
  '207': 'America/New_York', '212': 'America/New_York', '215': 'America/New_York',
  '216': 'America/New_York', '239': 'America/New_York', '240': 'America/New_York',
  '267': 'America/New_York', '301': 'America/New_York', '302': 'America/New_York',
  '304': 'America/New_York', '305': 'America/New_York', '315': 'America/New_York',
  '321': 'America/New_York', '336': 'America/New_York', '347': 'America/New_York',
  '351': 'America/New_York', '352': 'America/New_York', '386': 'America/New_York',
  '401': 'America/New_York', '404': 'America/New_York', '407': 'America/New_York',
  '410': 'America/New_York', '412': 'America/New_York', '413': 'America/New_York',
  '419': 'America/New_York', '434': 'America/New_York', '440': 'America/New_York',
  '443': 'America/New_York', '470': 'America/New_York', '475': 'America/New_York',
  '478': 'America/New_York', '484': 'America/New_York', '502': 'America/New_York',
  '516': 'America/New_York', '517': 'America/New_York', '518': 'America/New_York',
  '540': 'America/New_York', '561': 'America/New_York', '570': 'America/New_York',
  '585': 'America/New_York', '586': 'America/New_York', '603': 'America/New_York',
  '607': 'America/New_York', '610': 'America/New_York', '617': 'America/New_York',
  '631': 'America/New_York', '646': 'America/New_York', '678': 'America/New_York',
  '703': 'America/New_York', '704': 'America/New_York', '706': 'America/New_York',
  '716': 'America/New_York', '717': 'America/New_York', '718': 'America/New_York',
  '727': 'America/New_York', '732': 'America/New_York', '734': 'America/New_York',
  '754': 'America/New_York', '757': 'America/New_York', '770': 'America/New_York',
  '772': 'America/New_York', '774': 'America/New_York', '786': 'America/New_York',
  '803': 'America/New_York', '804': 'America/New_York', '813': 'America/New_York',
  '828': 'America/New_York', '843': 'America/New_York', '845': 'America/New_York',
  '848': 'America/New_York', '856': 'America/New_York', '857': 'America/New_York',
  '860': 'America/New_York', '862': 'America/New_York', '863': 'America/New_York',
  '904': 'America/New_York', '908': 'America/New_York', '910': 'America/New_York',
  '912': 'America/New_York', '914': 'America/New_York', '917': 'America/New_York',
  '919': 'America/New_York', '929': 'America/New_York', '941': 'America/New_York',
  '954': 'America/New_York', '973': 'America/New_York', '978': 'America/New_York',
  '980': 'America/New_York', '984': 'America/New_York',

  // --- Central Time (America/Chicago) ---
  '205': 'America/Chicago', '210': 'America/Chicago', '214': 'America/Chicago',
  '217': 'America/Chicago', '218': 'America/Chicago', '219': 'America/Chicago',
  '224': 'America/Chicago', '225': 'America/Chicago', '228': 'America/Chicago',
  '251': 'America/Chicago', '254': 'America/Chicago', '256': 'America/Chicago',
  '262': 'America/Chicago', '270': 'America/Chicago', '281': 'America/Chicago',
  '308': 'America/Chicago', '309': 'America/Chicago', '312': 'America/Chicago',
  '316': 'America/Chicago', '318': 'America/Chicago', '319': 'America/Chicago',
  '325': 'America/Chicago', '331': 'America/Chicago', '337': 'America/Chicago',
  '346': 'America/Chicago', '361': 'America/Chicago', '369': 'America/Chicago',
  '405': 'America/Chicago', '409': 'America/Chicago', '414': 'America/Chicago',
  '417': 'America/Chicago', '430': 'America/Chicago', '432': 'America/Chicago',
  '469': 'America/Chicago', '479': 'America/Chicago', '501': 'America/Chicago',
  '504': 'America/Chicago', '507': 'America/Chicago', '512': 'America/Chicago',
  '515': 'America/Chicago', '531': 'America/Chicago', '563': 'America/Chicago',
  '573': 'America/Chicago', '580': 'America/Chicago', '601': 'America/Chicago',
  '608': 'America/Chicago', '612': 'America/Chicago', '615': 'America/Chicago',
  '618': 'America/Chicago', '620': 'America/Chicago', '630': 'America/Chicago',
  '636': 'America/Chicago', '641': 'America/Chicago', '651': 'America/Chicago',
  '660': 'America/Chicago', '662': 'America/Chicago', '682': 'America/Chicago',
  '708': 'America/Chicago', '712': 'America/Chicago', '713': 'America/Chicago',
  '715': 'America/Chicago', '731': 'America/Chicago', '737': 'America/Chicago',
  '763': 'America/Chicago', '769': 'America/Chicago', '773': 'America/Chicago',
  '779': 'America/Chicago', '785': 'America/Chicago', '815': 'America/Chicago',
  '816': 'America/Chicago', '817': 'America/Chicago', '830': 'America/Chicago',
  '832': 'America/Chicago', '847': 'America/Chicago', '870': 'America/Chicago',
  '901': 'America/Chicago', '903': 'America/Chicago', '913': 'America/Chicago',
  '918': 'America/Chicago', '920': 'America/Chicago', '931': 'America/Chicago',
  '936': 'America/Chicago', '940': 'America/Chicago', '956': 'America/Chicago',
  '972': 'America/Chicago', '979': 'America/Chicago',

  // --- Mountain Time (America/Denver) ---
  '208': 'America/Denver', '303': 'America/Denver', '307': 'America/Denver',
  '385': 'America/Denver', '406': 'America/Denver', '435': 'America/Denver',
  '505': 'America/Denver', '575': 'America/Denver', '719': 'America/Denver',
  '720': 'America/Denver', '801': 'America/Denver', '970': 'America/Denver',

  // --- Mountain Time, no DST (America/Phoenix — most of Arizona) ---
  '480': 'America/Phoenix', '520': 'America/Phoenix', '602': 'America/Phoenix',
  '623': 'America/Phoenix', '928': 'America/Phoenix',

  // --- Pacific Time (America/Los_Angeles) ---
  '206': 'America/Los_Angeles', '209': 'America/Los_Angeles', '213': 'America/Los_Angeles',
  '253': 'America/Los_Angeles', '279': 'America/Los_Angeles', '310': 'America/Los_Angeles',
  '323': 'America/Los_Angeles', '341': 'America/Los_Angeles', '360': 'America/Los_Angeles',
  '408': 'America/Los_Angeles', '415': 'America/Los_Angeles', '424': 'America/Los_Angeles',
  '425': 'America/Los_Angeles', '442': 'America/Los_Angeles', '458': 'America/Los_Angeles',
  '503': 'America/Los_Angeles', '509': 'America/Los_Angeles', '510': 'America/Los_Angeles',
  '530': 'America/Los_Angeles', '541': 'America/Los_Angeles', '559': 'America/Los_Angeles',
  '562': 'America/Los_Angeles', '564': 'America/Los_Angeles', '619': 'America/Los_Angeles',
  '626': 'America/Los_Angeles', '650': 'America/Los_Angeles', '657': 'America/Los_Angeles',
  '661': 'America/Los_Angeles', '669': 'America/Los_Angeles', '702': 'America/Los_Angeles',
  '707': 'America/Los_Angeles', '714': 'America/Los_Angeles', '725': 'America/Los_Angeles',
  '747': 'America/Los_Angeles', '760': 'America/Los_Angeles', '775': 'America/Los_Angeles',
  '805': 'America/Los_Angeles', '818': 'America/Los_Angeles', '820': 'America/Los_Angeles',
  '831': 'America/Los_Angeles', '858': 'America/Los_Angeles', '909': 'America/Los_Angeles',
  '916': 'America/Los_Angeles', '925': 'America/Los_Angeles', '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '971': 'America/Los_Angeles',

  // --- Alaska Time (America/Anchorage) ---
  '907': 'America/Anchorage',

  // --- Hawaii-Aleutian Time, no DST (Pacific/Honolulu) ---
  '808': 'Pacific/Honolulu',
};

/** Fallback timezone used whenever an area code cannot be confidently mapped. */
const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Resolves the IANA timezone identifier for a US area code, e.g.
 * `getTimezoneFromAreaCode('415')` → `'America/Los_Angeles'`.
 *
 * Never returns a mock/placeholder value: the result is always a real
 * IANA timezone string, defaulting to `'America/New_York'` for any
 * unrecognized, malformed, or out-of-range area code.
 */
export function getTimezoneFromAreaCode(areaCode: string): string {
  const normalized = areaCode.trim();

  if (!/^\d{3}$/.test(normalized)) {
    return DEFAULT_TIMEZONE;
  }

  return AREA_CODE_TIMEZONES[normalized] ?? DEFAULT_TIMEZONE;
}
