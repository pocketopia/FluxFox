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
function buildSystemPrompt(industryLabel: string, companyName?: string): string {
  const trimmedCompanyName = companyName?.trim();
  const businessPhrase = trimmedCompanyName
    ? `${trimmedCompanyName}, a professional ${industryLabel} business`
    : `a professional ${industryLabel} business`;

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
6. If any required detail is missing, unclear, or unconfirmed, ask a direct clarifying question. Never invent, guess, or assume a value on the caller's behalf.

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
export function generateSuggestedPrompt(industry: string, companyName: string): string {
  const trimmedIndustry = industry.trim();
  if (!trimmedIndustry) {
    throw new VapiApiError('An `industry` value (e.g. "plumber", "roofer") is required to generate a prompt.');
  }
  return buildSystemPrompt(resolveIndustryLabel(trimmedIndustry), companyName);
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
        'Call this only after the caller has verbally confirmed every field below.',
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
        },
        required: ['customer_name', 'customer_phone', 'customer_email', 'project_type', 'date_time'],
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
  const resolvedSystemPrompt = trimmedSystemPrompt || buildSystemPrompt(industryLabel, trimmedCompanyName);

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

  const updatedMessages = model.messages.map((m) =>
    m.role === 'system' ? { ...m, content: appendTimezoneInstructions(currentPrompt, trimmedTimezone) } : m
  );

  // Populate the tool-level `server.url` on every existing tool (the
  // assistant's own tool list is preserved) so both Vapi's newer tool-level
  // server and the assistant-level `serverUrl` point at our webhook.
  const webhookUrl = resolveWebhookUrl(baseUrl);
  const updatedTools =
    webhookUrl && Array.isArray(model.tools)
      ? model.tools.map((tool) => ({ ...tool, server: { url: webhookUrl } }))
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

