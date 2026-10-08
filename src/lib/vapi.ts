const VAPI_API_BASE_URL = 'https://api.vapi.ai';

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
 */
function buildSystemPrompt(industryLabel: string): string {
  return `You are the AI phone receptionist for a professional ${industryLabel} business. You handle inbound calls to schedule, reschedule, and confirm service appointments on the business owner's behalf.

CURRENT DATE AND TIME
The current date and time is {{now}}. Always resolve relative dates and times ("tomorrow", "next Tuesday", "in two weeks", "this afternoon") against this anchor. Never assume a fixed year, month, or day — always derive it from {{now}}.

DATE FORMATTING — STRICT
Whenever you call the book_appointment function, the date_time argument MUST be a single strict ISO-8601 timestamp with a timezone offset or a "Z" (UTC) suffix, formatted exactly as YYYY-MM-DDTHH:mm:ssZ (for example: 2026-03-14T15:30:00Z). Never output date_time in natural language, never omit the time component, never omit the timezone designator, and never guess a value the caller has not explicitly confirmed.

CONVERSATION FLOW
1. Greet the caller warmly and ask how you can help.
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
 * Builds the exact function-calling JSON schema Vapi will use to trigger a
 * calendar booking. Field names and required set are fixed by design:
 * customer_name, customer_phone, customer_email, project_type, date_time.
 */
function buildBookAppointmentTool(industryLabel: string) {
  return {
    type: 'function' as const,
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

  const payload = {
    name: `FluxFox Receptionist — ${industryLabel}`,
    firstMessage: `Thanks for calling! I can help you schedule ${industryLabel} service. What can I help you with today?`,
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(industryLabel),
        },
      ],
      tools: [buildBookAppointmentTool(industryLabel)],
    },
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
export async function updateAssistantTimezone(assistantId: string, timezone: string): Promise<VapiAssistant> {
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

  const model = assistant.model as { messages?: { role?: string; content?: string }[] } | undefined;
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
        },
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
