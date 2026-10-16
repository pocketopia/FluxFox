const VAPI_API_BASE_URL = 'https://api.vapi.ai';

/**
 * Resolves FluxFox's production base URL from the environment and returns
 * the assistant-level Vapi webhook config (`serverUrl` + `serverMessages`)
 * so Vapi delivers `tool-calls` and `end-of-call-report` events to
 * `/api/webhook/vapi`. Returns an empty object when no base URL is
 * configured, so nothing is ever sent with a fabricated/relative URL.
 */
function resolveBaseUrl(baseUrl?: string): string {
  // Every candidate (the caller-supplied origin AND each env fallback) must
  // pass `toPublicOrigin`, so a mobile WebView / local dev origin such as
  // `capacitor://localhost`, `ionic://localhost` or `http://localhost:3000`
  // can NEVER become Vapi's `serverUrl` — Vapi's servers can't reach it.
  const candidates = [
    baseUrl,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    const origin = toPublicOrigin(candidate);
    if (origin) return origin;
  }

  return '';
}

/**
 * Returns the bare origin (`https://host`) of a URL only if it is a
 * publicly reachable http(s) URL. Rejects non-http(s) schemes
 * (`capacitor://`, `ionic://`, `file://`, `fluxfox://`...), unparsable
 * values, and loopback/unspecified hosts (`localhost`, `*.localhost`,
 * `127.x.x.x`, `0.0.0.0`, `[::1]`). Returns '' for anything rejected.
 */
function toPublicOrigin(value: string | undefined | null): string {
  const trimmed = value?.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return '';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '[::]' ||
    /^127\./.test(host);

  return isLoopback ? '' : url.origin;
}

/** The full webhook URL Vapi should call, or '' when no base URL can be resolved. */
function resolveWebhookUrl(baseUrl?: string): string {
  const resolvedBase = resolveBaseUrl(baseUrl);
  return resolvedBase ? `${resolvedBase}/api/webhook/vapi` : '';
}

function getVapiServerConfig(baseUrl?: string): { serverUrl?: string; serverMessages?: string[] } {
  const webhookUrl = resolveWebhookUrl(baseUrl);

  if (!webhookUrl) return {};

  return {
    serverUrl: webhookUrl,
    serverMessages: ['tool-calls', 'end-of-call-report'],
  };
}

/**
 * Thrown for any failure while deploying a Vapi assistant: missing server
 * configuration, invalid input, a network failure reaching Vapi, or a
 * non-2xx response from the Vapi REST API. Callers should map this to a
 * strict HTTP 500 (or 400 for input validation failures raised before the
 * network call is made).
 */
export class VapiApiError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'VapiApiError';
    this.status = status;
  }
}

export interface DeployAssistantParams {
  /** Raw industry identifier supplied by the client, e.g. "plumber", "roofer". */
  industry: string;
  /** The business's display name, used to personalize the assistant's name, greeting, and system prompt. */
  companyName?: string;
  /**
   * A fully custom system prompt to use verbatim instead of the
   * auto-generated one (set when the caller accepted an auto-generated
   * prompt as-is, edited it, or wrote one entirely from scratch via the
   * "Write it myself" path).
   */
  systemPrompt?: string;
  /** Optional street address the assistant gives callers who choose an in-person appointment. */
  businessAddress?: string;
  /**
   * Public origin of this deployment (e.g. `new URL(request.url).origin`).
   * Takes priority over env vars when building Vapi's webhook `serverUrl`.
   */
  baseUrl?: string;
}

/** The subset of the Vapi `Assistant` response shape this module relies on. */
export interface VapiAssistant {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Friendly, spoken-word labels for known trade industries. Any industry not
 * present here falls back to a normalized (lowercased, de-slugged) version
 * of the raw input rather than a hardcoded/dummy value.
 */
const INDUSTRY_LABELS: Record<string, string> = {
  plumber: 'plumbing',
  roofer: 'roofing',
  electrician: 'electrical',
  hvac: 'HVAC',
  landscaper: 'landscaping',
  locksmith: 'locksmith',
  painter: 'painting',
  pest_control: 'pest control',
  general_contractor: 'general contracting',
  handyman: 'handyman',
};

function resolveIndustryLabel(industry: string): string {
  const normalized = industry.trim().toLowerCase();
  return INDUSTRY_LABELS[normalized] ?? normalized.replace(/[_-]+/g, ' ');
}

/**
 * Builds the production system prompt for the assistant. Anchors all
 * relative-date reasoning to Vapi's live `{{now}}` template variable
 * (resolved by Vapi at call time to the real current date/time) and
 * enforces strict ISO-8601 formatting for the `book_appointment` function
 * call so downstream calendar writes never receive ambiguous dates.
 *
 * `companyName`, when provided, personalizes the opening line and
 * identifies the business by name throughout the prompt instead of the
 * generic "a professional ${industryLabel} business" phrasing — this is
 * exactly what the onboarding wizard's "auto-generate" path (Path A) calls
 * via `generateSuggestedPrompt` below to produce its live preview.
 */
function buildSystemPrompt(industryLabel: string, companyName?: string, businessAddress?: string): string {
  const trimmedCompanyName = companyName?.trim();
  const trimmedAddress = businessAddress?.trim();
  const businessPhrase = trimmedCompanyName
    ? `${trimmedCompanyName}, a professional ${industryLabel} business`
    : `a professional ${industryLabel} business`;

  // Optional: only rendered when the owner supplied a street address.
  const addressBlock = trimmedAddress
    ? `\n\nBUSINESS ADDRESS\nThe business is located at: ${trimmedAddress}`
    : '';

  return `You are the AI phone receptionist for ${businessPhrase}. You handle inbound calls to schedule, reschedule, and confirm service appointments on the business owner's behalf.

CURRENT DATE AND TIME
The current date and time is {{now}}. Always resolve relative dates and times ("tomorrow", "next Tuesday", "in two weeks", "this afternoon") against this anchor. Never assume a fixed year, month, or day — always derive it from {{now}}.

DATE FORMATTING — STRICT
Whenever you call the book_appointment function, the date_time argument MUST be a single strict ISO-8601 timestamp with a timezone offset or a "Z" (UTC) suffix, formatted exactly as YYYY-MM-DDTHH:mm:ssZ (for example: 2026-03-14T15:30:00Z). Never output date_time in natural language, never omit the time component, never omit the timezone designator, and never guess a value the caller has not explicitly confirmed.

CONVERSATION FLOW
1. Greet the caller warmly${trimmedCompanyName ? ` as ${trimmedCompanyName}` : ''} and ask how you can help.
2. Determine the type of ${industryLabel} work they need (this becomes project_type).
3. Collect all five required booking details: customer_name, customer_phone, customer_email, project_type, and a confirmed appointment date_time.
4. Read every detail back to the caller and get explicit verbal confirmation before booking anything.
5. Only call the book_appointment function after the caller has confirmed every detail out loud.
6. If any required detail is missing, unclear, or unconfirmed, ask a direct clarifying question. Never invent, guess, or assume a value on the caller's behalf.${addressBlock}

RULES
- Never fabricate availability, pricing, technician names, or business details you were not explicitly given.
- If the caller asks about something outside scheduling (billing disputes, complaints, emergencies), acknowledge it and let them know a team member will follow up — do not attempt to resolve it yourself.
- Keep every response concise, professional, and courteous.
- Speak naturally; never read raw ISO-8601 timestamps aloud to the caller. Convert them to plain spoken language (e.g. "Tuesday, March 14th at 3:30 PM") when confirming, while still passing the strict ISO-8601 form to the function call.`;
}

/**
 * Public, client-callable preview of `buildSystemPrompt`. Powers Path A of
 * the assistant creation wizard ("Auto-generate for me"): given the
 * company name + trade the user just entered, returns the exact system
 * prompt `deployVapiAssistant` would ship to Vapi, so the "I like it!" /
 * "Edit" step shows the caller the real, final prompt rather than a
 * separate, divergent preview string.
 */
export function generateSuggestedPrompt(industry: string, companyName: string, businessAddress?: string): string {
  const trimmedIndustry = industry.trim();
  if (!trimmedIndustry) {
    throw new VapiApiError('An `industry` value (e.g. "plumber", "roofer") is required to generate a prompt.');
  }
  return buildSystemPrompt(resolveIndustryLabel(trimmedIndustry), companyName, businessAddress);
}

/** Marks the universal appointment-rules block so it can be replaced idempotently (always sits before the timezone block). */
const BOOKING_RULES_BLOCK_START = '\n\nAPPOINTMENT RULES (FLUXFOX — ALWAYS APPLY)\n';

/** Builds the universal booking rules every FluxFox assistant enforces, regardless of the prompt's author. */
function buildBookingRulesBlock(businessAddress?: string): string {
  const address = businessAddress?.trim();

  const inPersonRule = address
    ? `- IN-PERSON: this business's address is ${address}. Tell the caller this address and ask whether they will come to that location or need an on-site visit at their own address. Collect and confirm the final location, and pass it as appointment_address (the business address if they come to us, otherwise their own street address).`
    : `- IN-PERSON: no business address is on file. Ask the caller for the street address where the in-person appointment will take place, read it back to confirm it, and pass it as appointment_address before calling book_appointment.`;

  return (
    `${BOOKING_RULES_BLOCK_START}` +
    `1. APPOINTMENT TYPE: Before booking, ALWAYS ask every caller whether they want an In-Person Appointment or a Phone Callback Appointment. Pass their answer to book_appointment as appointment_type: "in_person" or "callback". Never assume it.\n` +
    `2. ADDRESS HANDLING:\n` +
    `${inPersonRule}\n` +
    `- CALLBACK: no address is needed; confirm the best phone number to call (customer_phone) and omit appointment_address.\n` +
    `3. SLOT CONFLICTS: If book_appointment says the requested time is already booked, politely tell the caller that time is unavailable, read out the alternative open times the tool returned, and ask which one works best. Then call book_appointment again with the time they pick. Never claim an appointment is booked unless the tool confirms it.`
  );
}

/**
 * Enforces the universal booking rules on ANY system prompt (auto-generated
 * or fully custom). Any previous rules block is replaced, and a trailing
 * timezone block (see `appendTimezoneInstructions`) is kept after it.
 */
function withBookingRules(prompt: string, businessAddress?: string): string {
  const timezoneIndex = prompt.indexOf(TIMEZONE_BLOCK_START);
  const tail = timezoneIndex === -1 ? '' : prompt.slice(timezoneIndex);
  let head = timezoneIndex === -1 ? prompt : prompt.slice(0, timezoneIndex);

  const rulesIndex = head.indexOf(BOOKING_RULES_BLOCK_START);
  if (rulesIndex !== -1) head = head.slice(0, rulesIndex);

  return `${head}${buildBookingRulesBlock(businessAddress)}${tail}`;
}

/** Reads the business address back out of an existing prompt (written by `buildSystemPrompt` / the rules block). */
function extractBusinessAddress(prompt: string): string | undefined {
  const match = prompt.match(/BUSINESS ADDRESS\nThe business is located at: (.+)/);
  return match?.[1]?.trim() || undefined;
}

/**
 * Phase 3 booking-tool fields shared by `buildBookAppointmentTool` (new
 * assistants) and `upgradeBookAppointmentTool` (assistants deployed before
 * these fields existed).
 */
const APPOINTMENT_TOOL_PROPERTIES = {
  appointment_type: {
    type: 'string',
    enum: ['in_person', 'callback'],
    description:
      'Whether the caller wants an in-person appointment ("in_person") or a phone callback appointment ("callback"). Always ask the caller; never assume.',
  },
  appointment_address: {
    type: 'string',
    description:
      'Street address where an in-person appointment takes place (the business address, or the customer address for an on-site visit), confirmed by the caller. Required when appointment_type is "in_person" and no default business address applies; omit for callbacks.',
  },
};

/** Adds `appointment_type` / `appointment_address` to an existing `book_appointment` tool; other tools are untouched. */
function upgradeBookAppointmentTool(tool: Record<string, unknown>): Record<string, unknown> {
  const fn = tool.function as
    | { name?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } }
    | undefined;
  if (fn?.name !== 'book_appointment') return tool;

  const parameters = fn.parameters ?? {};
  const required = Array.from(new Set([...(parameters.required ?? []), 'appointment_type']));

  return {
    ...tool,
    function: {
      ...fn,
      parameters: {
        ...parameters,
        type: 'object',
        properties: { ...(parameters.properties ?? {}), ...APPOINTMENT_TOOL_PROPERTIES },
        required,
      },
    },
  };
}

/**
 * Builds the exact function-calling JSON schema Vapi will use to trigger a
 * calendar booking. Field names and required set are fixed by design:
 * customer_name, customer_phone, customer_email, project_type, date_time.
 */
function buildBookAppointmentTool(industryLabel: string, baseUrl?: string) {
  const webhookUrl = resolveWebhookUrl(baseUrl);

  return {
    type: 'function' as const,
    // Vapi's tool-level `server.url` (newer API) — set alongside the
    // assistant-level `serverUrl` so tool calls always reach our webhook.
    ...(webhookUrl ? { server: { url: webhookUrl } } : {}),
    function: {
      name: 'book_appointment',
      description:
        `Books a confirmed ${industryLabel} service appointment on the business calendar. ` +
        'Call this only after the caller has verbally confirmed every field below. ' +
        'If the result says the requested time is already booked, offer the alternative times it lists and call this again with the caller\'s choice.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: "The caller's full name.",
          },
          customer_phone: {
            type: 'string',
            description: "The caller's phone number, including area code.",
          },
          customer_email: {
            type: 'string',
            description: "The caller's email address, used to send the appointment confirmation.",
          },
          project_type: {
            type: 'string',
            description: `The specific type of ${industryLabel} work requested (e.g. repair, installation, inspection, emergency service).`,
          },
          date_time: {
            type: 'string',
            description:
              'The confirmed appointment date and time as a strict ISO-8601 timestamp with a UTC offset or "Z" suffix, e.g. 2026-03-14T15:30:00Z.',
          },
          ...APPOINTMENT_TOOL_PROPERTIES,
        },
        required: [
          'customer_name',
          'customer_phone',
          'customer_email',
          'project_type',
          'date_time',
          'appointment_type',
        ],
      },
    },
  };
}

/**
 * Deploys (creates) a fully configured Vapi assistant for the given trade
 * industry and returns the live Vapi API response. Performs zero mocking:
 * any missing server configuration, invalid input, network failure, or
 * non-2xx Vapi response throws `VapiApiError` for the caller to translate
 * into a strict HTTP error response.
 */
export async function deployVapiAssistant({
  industry,
  companyName,
  systemPrompt,
  businessAddress,
  baseUrl,
}: DeployAssistantParams): Promise<VapiAssistant> {
  const apiKey = process.env.VAPI_PRIVATE_API_KEY;

  if (!apiKey) {
    throw new VapiApiError('Server misconfiguration: VAPI_PRIVATE_API_KEY is not set.');
  }

  const trimmedIndustry = industry.trim();
  if (!trimmedIndustry) {
    throw new VapiApiError('An `industry` value (e.g. "plumber", "roofer") is required.');
  }

  const industryLabel = resolveIndustryLabel(trimmedIndustry);
  const trimmedCompanyName = companyName?.trim();
  const trimmedSystemPrompt = systemPrompt?.trim();

  // A caller-supplied `systemPrompt` (Path A "I like it!"/"Edit", or Path B
  // "write it myself" in the creation wizard) is always used verbatim; only
  // when none is supplied do we fall back to the auto-generated prompt.
  // The universal appointment rules are ALWAYS enforced, even for a custom prompt.
  const resolvedSystemPrompt = withBookingRules(
    trimmedSystemPrompt || buildSystemPrompt(industryLabel, trimmedCompanyName, businessAddress),
    businessAddress
  );

  // Vapi rejects assistant names longer than 40 characters (HTTP 400). A long
  // `trimmedCompanyName` can easily push `${name} — FluxFox Receptionist` past
  // that limit, so the final name is always strictly clamped to 40 chars
  // right before it's placed on the payload — never sent un-clamped.
  const rawName = trimmedCompanyName
    ? `${trimmedCompanyName} — FluxFox Receptionist`
    : `FluxFox Receptionist — ${industryLabel}`;
  const resolvedName = rawName.slice(0, 40);

  const payload = {
    name: resolvedName,
    firstMessage: trimmedCompanyName
      ? `Thanks for calling ${trimmedCompanyName}! I can help you schedule ${industryLabel} service. What can I help you with today?`
      : `Thanks for calling! I can help you schedule ${industryLabel} service. What can I help you with today?`,
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: resolvedSystemPrompt,
        },
      ],
      tools: [buildBookAppointmentTool(industryLabel, baseUrl)],
    },
    ...getVapiServerConfig(baseUrl),
  };

  let response: Response;
  try {
    response = await fetch(`${VAPI_API_BASE_URL}/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    throw new VapiApiError(
      `Failed to reach the Vapi API: ${
        networkError instanceof Error ? networkError.message : 'unknown network error'
      }.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new VapiApiError(
      `Vapi API responded with ${response.status}${errorBody ? `: ${errorBody}` : ` ${response.statusText}`}`,
      response.status
    );
  }

  const data = (await response.json()) as VapiAssistant;

  if (!data || typeof data.id !== 'string' || !data.id) {
    throw new VapiApiError('Vapi API returned a response without a valid assistant id.');
  }

  return data;
}

/** Marks a block of assistant-managed timezone instructions so it can be replaced idempotently. */
const TIMEZONE_BLOCK_START = '\n\nCALLER TIMEZONE\n';

/**
 * Appends (or replaces, if already present) a strict timezone-anchoring
 * instruction block onto an assistant's existing system prompt, so the
 * model resolves `{{now}}` and every relative date/time reference
 * ("tomorrow", "3pm") against the caller's real local timezone rather than
 * an assumed default. Strips any previously appended block first so
 * repeated calls (e.g. re-provisioning a number) never duplicate the
 * instructions.
 */
function appendTimezoneInstructions(existingPrompt: string, timezone: string): string {
  const basePrompt = existingPrompt.includes(TIMEZONE_BLOCK_START)
    ? existingPrompt.slice(0, existingPrompt.indexOf(TIMEZONE_BLOCK_START))
    : existingPrompt;

  return (
    `${basePrompt}${TIMEZONE_BLOCK_START}` +
    `This business's local timezone is ${timezone}. The {{now}} value provided to you is already anchored to this timezone — treat it as the caller's current local date and time. When you resolve relative dates/times ("tomorrow", "next Tuesday", "3pm") and when you construct the final date_time argument for book_appointment, always express the ISO-8601 timestamp with the correct UTC offset for ${timezone} (accounting for daylight saving time on the date in question), never with a bare "Z"/UTC offset unless ${timezone} is itself UTC.`
  );
}

/**
 * Fetches an assistant's current configuration from Vapi so its existing
 * system prompt can be safely amended rather than overwritten. Throws
 * `VapiApiError` on any failure — no fallback/mock assistant is ever
 * returned.
 */
async function fetchVapiAssistant(assistantId: string, apiKey: string): Promise<VapiAssistant> {
  let response: Response;
  try {
    response = await fetch(`${VAPI_API_BASE_URL}/assistant/${assistantId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (networkError) {
    throw new VapiApiError(
      `Failed to reach the Vapi API while fetching assistant ${assistantId}: ${
        networkError instanceof Error ? networkError.message : 'unknown network error'
      }.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new VapiApiError(
      `Vapi API responded with ${response.status} while fetching assistant ${assistantId}${
        errorBody ? `: ${errorBody}` : ` ${response.statusText}`
      }`,
      response.status
    );
  }

  return (await response.json()) as VapiAssistant;
}

/**
 * Server-only: patches a deployed Vapi assistant's system prompt to anchor
 * its date/time reasoning to the given IANA timezone (see
 * `getTimezoneFromAreaCode`). Called by `/api/phone/provision` immediately
 * after a Twilio number purchase succeeds, so the assistant's "brain"
 * always reflects the timezone of the number it now answers on.
 *
 * Performs zero mocking: fetches the assistant's real current prompt,
 * appends a strict timezone instruction block, and PATCHes it back via the
 * live Vapi API. Any missing config, invalid input, network failure, or
 * non-2xx Vapi response throws `VapiApiError` for the caller to translate
 * into a strict HTTP error response — the caller must not silently
 * swallow this failure and report the phone number as fully provisioned.
 */
export async function updateAssistantTimezone(
  assistantId: string,
  timezone: string,
  baseUrl?: string
): Promise<VapiAssistant> {
  const apiKey = process.env.VAPI_PRIVATE_API_KEY;

  if (!apiKey) {
    throw new VapiApiError('Server misconfiguration: VAPI_PRIVATE_API_KEY is not set.');
  }

  const trimmedAssistantId = assistantId.trim();
  if (!trimmedAssistantId) {
    throw new VapiApiError('An `assistantId` is required to update the assistant timezone.');
  }

  const trimmedTimezone = timezone.trim();
  if (!trimmedTimezone) {
    throw new VapiApiError('A `timezone` (IANA identifier, e.g. "America/Los_Angeles") is required.');
  }

  const assistant = await fetchVapiAssistant(trimmedAssistantId, apiKey);

  const model = assistant.model as
    | { messages?: { role?: string; content?: string }[]; tools?: Record<string, unknown>[] }
    | undefined;
  const systemMessage = model?.messages?.find((m) => m.role === 'system');
  const currentPrompt = typeof systemMessage?.content === 'string' ? systemMessage.content : '';

  if (!model?.messages || !systemMessage) {
    throw new VapiApiError(
      `Assistant ${trimmedAssistantId} has no existing system prompt message to patch a timezone onto.`
    );
  }

  // Assistants deployed before Phase 3 get the universal booking rules too
  // (the address, if any, is recovered from the existing prompt).
  const promptWithRules = currentPrompt.includes(BOOKING_RULES_BLOCK_START)
    ? currentPrompt
    : withBookingRules(currentPrompt, extractBusinessAddress(currentPrompt));

  const updatedMessages = model.messages.map((m) =>
    m.role === 'system' ? { ...m, content: appendTimezoneInstructions(promptWithRules, trimmedTimezone) } : m
  );

  // Populate the tool-level `server.url` on every existing tool (the
  // assistant's own tool list is preserved) so both Vapi's newer tool-level
  // server and the assistant-level `serverUrl` point at our webhook.
  const webhookUrl = resolveWebhookUrl(baseUrl);
  const updatedTools =
    webhookUrl && Array.isArray(model.tools)
      ? model.tools.map((tool) => upgradeBookAppointmentTool({ ...tool, server: { url: webhookUrl } }))
      : Array.isArray(model.tools)
        ? model.tools.map(upgradeBookAppointmentTool)
        : model.tools;

  let response: Response;
  try {
    response = await fetch(`${VAPI_API_BASE_URL}/assistant/${trimmedAssistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: {
          ...model,
          messages: updatedMessages,
          ...(updatedTools ? { tools: updatedTools } : {}),
        },
        ...getVapiServerConfig(baseUrl),
      }),
    });
  } catch (networkError) {
    throw new VapiApiError(
      `Failed to reach the Vapi API while patching assistant ${trimmedAssistantId}'s timezone: ${
        networkError instanceof Error ? networkError.message : 'unknown network error'
      }.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new VapiApiError(
      `Vapi API responded with ${response.status} while patching assistant ${trimmedAssistantId}'s timezone${
        errorBody ? `: ${errorBody}` : ` ${response.statusText}`
      }`,
      response.status
    );
  }

  const data = (await response.json()) as VapiAssistant;

  if (!data || typeof data.id !== 'string' || !data.id) {
    throw new VapiApiError('Vapi API returned a response without a valid assistant id after the timezone patch.');
  }

  return data;
}

/** The subset of the Vapi `PhoneNumber` response shape this module relies on. */
export interface VapiPhoneNumber {
  id: string;
  number?: string;
  assistantId?: string | null;
}

/**
 * Imports a Twilio number into Vapi and attaches it to an assistant —
 * idempotently. Without this import, Twilio forwards the call to Vapi's
 * inbound webhook but Vapi has no record of the number, so the caller
 * hears Twilio's "An application error has occurred".
 *
 * 1. GET /phone-number and look for an existing record with this number.
 * 2. If found, PATCH /phone-number/{id} with the new `assistantId`.
 * 3. Otherwise POST /phone-number with Vapi's Twilio import schema:
 *    { provider: 'twilio', number, twilioAccountSid, twilioAuthToken, assistantId }.
 *
 * Every failure (missing config, network, non-2xx, malformed response)
 * throws `VapiApiError` — nothing is swallowed.
 */
export async function linkPhoneNumberToAssistant(
  e164Number: string,
  assistantId: string
): Promise<VapiPhoneNumber> {
  const apiKey = process.env.VAPI_PRIVATE_API_KEY;
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

  if (!apiKey) {
    throw new VapiApiError('Server misconfiguration: VAPI_PRIVATE_API_KEY is not set.');
  }
  if (!twilioAccountSid || !twilioAuthToken) {
    throw new VapiApiError('Server misconfiguration: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set.');
  }

  const number = e164Number.trim();
  const trimmedAssistantId = assistantId.trim();
  if (!number || !trimmedAssistantId) {
    throw new VapiApiError('Both a phone `number` and an `assistantId` are required to link a Vapi phone number.');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const call = async (url: string, init: RequestInit, action: string): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (networkError) {
      throw new VapiApiError(
        `Failed to reach the Vapi API while trying to ${action}: ${
          networkError instanceof Error ? networkError.message : 'unknown network error'
        }.`
      );
    }
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new VapiApiError(
        `Vapi API responded with ${response.status} while trying to ${action}${
          errorBody ? `: ${errorBody}` : ` ${response.statusText}`
        }`,
        response.status
      );
    }
    return response;
  };

  const listResponse = await call(`${VAPI_API_BASE_URL}/phone-number`, { method: 'GET', headers }, 'list phone numbers');
  const existingList = (await listResponse.json()) as VapiPhoneNumber[];
  const existing = Array.isArray(existingList) ? existingList.find((p) => p.number === number) : undefined;

  const saveResponse = existing
    ? await call(
        `${VAPI_API_BASE_URL}/phone-number/${existing.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ assistantId: trimmedAssistantId }) },
        `attach assistant ${trimmedAssistantId} to existing phone number ${number}`
      )
    : await call(
        `${VAPI_API_BASE_URL}/phone-number`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provider: 'twilio',
            number,
            twilioAccountSid,
            twilioAuthToken,
            assistantId: trimmedAssistantId,
          }),
        },
        `import phone number ${number}`
      );

  const data = (await saveResponse.json()) as VapiPhoneNumber;

  if (!data || typeof data.id !== 'string' || !data.id) {
    throw new VapiApiError(`Vapi API returned a response without a valid phone number id for ${number}.`);
  }

  return data;
}


export interface UpdateAssistantSettingsParams {
  assistantId: string;
  /** Trade identifier (e.g. "plumber"). Drives the spoken industry label and the booking tool description. */
  industry: string;
  companyName?: string;
  businessAddress?: string;
  /** A custom prompt used verbatim. When omitted/blank, the prompt is regenerated from the other fields. */
  systemPrompt?: string;
  baseUrl?: string;
}

/** Generic industry used when a business is reset to a clean slate (no trade chosen). */
const RESET_INDUSTRY = 'service';

/**
 * Server-only: syncs a deployed assistant's name, greeting, system prompt and
 * booking tool to the owner's edited business settings via
 * `PATCH https://api.vapi.ai/assistant/{id}`. The caller-timezone block
 * appended by `updateAssistantTimezone` is preserved so editing a prompt never
 * silently drops the timezone anchoring. Throws `VapiApiError` on any failure.
 */
export async function updateAssistantSettings({
  assistantId,
  industry,
  companyName,
  businessAddress,
  systemPrompt,
  baseUrl,
}: UpdateAssistantSettingsParams): Promise<VapiAssistant> {
  const apiKey = process.env.VAPI_PRIVATE_API_KEY;
  if (!apiKey) {
    throw new VapiApiError('Server misconfiguration: VAPI_PRIVATE_API_KEY is not set.');
  }

  const trimmedAssistantId = assistantId.trim();
  if (!trimmedAssistantId) {
    throw new VapiApiError('An `assistantId` is required to update the assistant.');
  }

  const trimmedIndustry = industry.trim();
  if (!trimmedIndustry) {
    throw new VapiApiError('An `industry` value (e.g. "plumber", "roofer") is required to update the assistant.');
  }

  const industryLabel = resolveIndustryLabel(trimmedIndustry);
  const trimmedCompanyName = companyName?.trim();

  const assistant = await fetchVapiAssistant(trimmedAssistantId, apiKey);
  const model = assistant.model as
    | { messages?: { role?: string; content?: string }[]; tools?: Record<string, unknown>[] }
    | undefined;
  const existingMessages = model?.messages ?? [];
  const existingPrompt =
    existingMessages.find((m) => m.role === 'system' && typeof m.content === 'string')?.content ?? '';

  // Universal booking rules are re-enforced on every save, custom prompt or not.
  let nextPrompt = withBookingRules(
    systemPrompt?.trim() || buildSystemPrompt(industryLabel, trimmedCompanyName, businessAddress),
    businessAddress
  );

  // Preserve the live timezone anchor unless the caller's prompt already carries one.
  const timezoneIndex = existingPrompt.indexOf(TIMEZONE_BLOCK_START);
  if (timezoneIndex !== -1 && !nextPrompt.includes(TIMEZONE_BLOCK_START)) {
    nextPrompt = `${nextPrompt}${existingPrompt.slice(timezoneIndex)}`;
  }

  const hasSystemMessage = existingMessages.some((m) => m.role === 'system');
  const nextMessages = hasSystemMessage
    ? existingMessages.map((m) => (m.role === 'system' ? { ...m, content: nextPrompt } : m))
    : [{ role: 'system', content: nextPrompt }, ...existingMessages];

  // Refresh the booking tool's industry wording while keeping any other tools intact.
  const freshBookingTool = buildBookAppointmentTool(industryLabel, baseUrl) as unknown as Record<string, unknown>;
  const existingTools = Array.isArray(model?.tools) ? model.tools : [];
  const isBookingTool = (tool: Record<string, unknown>) =>
    (tool as { function?: { name?: string } }).function?.name === 'book_appointment';
  const nextTools = existingTools.some(isBookingTool)
    ? existingTools.map((tool) => (isBookingTool(tool) ? freshBookingTool : tool))
    : [...existingTools, freshBookingTool];

  const resolvedName = (
    trimmedCompanyName ? `${trimmedCompanyName} — FluxFox Receptionist` : `FluxFox Receptionist — ${industryLabel}`
  ).slice(0, 40);

  const firstMessage = trimmedCompanyName
    ? `Thanks for calling ${trimmedCompanyName}! I can help you schedule ${industryLabel} service. What can I help you with today?`
    : `Thanks for calling! I can help you schedule ${industryLabel} service. What can I help you with today?`;

  let response: Response;
  try {
    response = await fetch(`${VAPI_API_BASE_URL}/assistant/${trimmedAssistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: resolvedName,
        firstMessage,
        model: { ...model, messages: nextMessages, tools: nextTools },
        ...getVapiServerConfig(baseUrl),
      }),
    });
  } catch (networkError) {
    throw new VapiApiError(
      `Failed to reach the Vapi API while updating assistant ${trimmedAssistantId}: ${
        networkError instanceof Error ? networkError.message : 'unknown network error'
      }.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new VapiApiError(
      `Vapi API responded with ${response.status} while updating assistant ${trimmedAssistantId}${
        errorBody ? `: ${errorBody}` : ` ${response.statusText}`
      }`,
      response.status
    );
  }

  const data = (await response.json()) as VapiAssistant;
  if (!data || typeof data.id !== 'string' || !data.id) {
    throw new VapiApiError('Vapi API returned a response without a valid assistant id after the settings update.');
  }

  return data;
}


/**
 * Server-only: resets a deployed assistant to a clean, generic receptionist
 * (no business name, no address, default prompt, generic greeting) via
 * `PATCH /assistant/{id}`. The assistant id and its linked phone number are
 * kept, so calls keep being answered while the owner reconfigures.
 */
export async function resetAssistantToDefaults(assistantId: string, baseUrl?: string): Promise<VapiAssistant> {
  return updateAssistantSettings({ assistantId, industry: RESET_INDUSTRY, baseUrl });
}

/**
 * Server-only: reads the live system prompt currently on a deployed assistant
 * (used to pre-fill the dashboard editor when no copy is stored locally).
 * Returns an empty string if the assistant has no system message.
 */
export async function fetchAssistantSystemPrompt(assistantId: string): Promise<string> {
  const apiKey = process.env.VAPI_PRIVATE_API_KEY;
  if (!apiKey) {
    throw new VapiApiError('Server misconfiguration: VAPI_PRIVATE_API_KEY is not set.');
  }
  const assistant = await fetchVapiAssistant(assistantId.trim(), apiKey);
  const model = assistant.model as { messages?: { role?: string; content?: string }[] } | undefined;
  const content = model?.messages?.find((m) => m.role === 'system')?.content;
  return typeof content === 'string' ? content : '';
}

