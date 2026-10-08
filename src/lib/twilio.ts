import Twilio from 'twilio';

const VAPI_INBOUND_WEBHOOK_URL = 'https://outbound.vapi.ai/api/twilio/inbound';

/**
 * Thrown for any failure interacting with the Twilio REST API: missing
 * server configuration, invalid input, a network failure, or a non-2xx
 * response from Twilio. Callers should map this to a strict HTTP 400
 * (invalid input) or 500 (everything else).
 */
export class TwilioApiError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TwilioApiError';
    this.status = status;
  }
}

/** The subset of a Twilio "available local number" resource this module relies on. */
export interface AvailableTwilioNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
}

/** The subset of a purchased Twilio "incoming phone number" resource this module relies on. */
export interface ProvisionedTwilioNumber {
  sid: string;
  phoneNumber: string;
  voiceUrl: string | null;
}

function getTwilioClient(): Twilio.Twilio {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new TwilioApiError(
      'Server misconfiguration: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set.'
    );
  }

  return Twilio(accountSid, authToken);
}

/**
 * Builds the Vapi inbound webhook URL for a given assistant, appending the
 * assistant id as a query parameter so inbound calls to the purchased
 * Twilio number route to the correct Vapi assistant.
 */
function buildVapiVoiceUrl(vapiAssistantId: string): string {
  const url = new URL(VAPI_INBOUND_WEBHOOK_URL);
  url.searchParams.set('assistantId', vapiAssistantId);
  return url.toString();
}

/**
 * Searches Twilio for available local incoming phone numbers in the given
 * US area code. Throws `TwilioApiError` on invalid input, network failure,
 * or a Twilio API error — never returns a mocked/fallback number list.
 */
export async function searchAvailableNumbers(
  areaCode: string
): Promise<AvailableTwilioNumber[]> {
  const trimmedAreaCode = areaCode.trim();

  if (!/^\d{3}$/.test(trimmedAreaCode)) {
    throw new TwilioApiError('`areaCode` must be a 3-digit US area code, e.g. "415".', 400);
  }

  const client = getTwilioClient();

  try {
    const numbers = await client
      .availablePhoneNumbers('US')
      .local.list({ areaCode: Number(trimmedAreaCode), limit: 10 });

    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality ?? null,
      region: n.region ?? null,
    }));
  } catch (err) {
    throw new TwilioApiError(
      `Failed to search Twilio for available numbers in area code ${trimmedAreaCode}: ${
        err instanceof Error ? err.message : 'unknown Twilio error'
      }`,
      (err as { status?: number })?.status
    );
  }
}

/**
 * Purchases the first available local number in the given area code and
 * binds its inbound `VoiceUrl` to Vapi's Twilio webhook, appending the
 * user's Vapi assistant id so inbound calls route to the correct
 * assistant. Throws `TwilioApiError` on any failure — no fallback or mock
 * number is ever returned.
 */
export async function provisionPhoneNumber(
  areaCode: string,
  vapiAssistantId: string
): Promise<ProvisionedTwilioNumber> {
  const trimmedAssistantId = vapiAssistantId.trim();
  if (!trimmedAssistantId) {
    throw new TwilioApiError('A `vapiAssistantId` is required to provision a phone number.', 400);
  }

  const available = await searchAvailableNumbers(areaCode);

  if (available.length === 0) {
    throw new TwilioApiError(
      `No available Twilio numbers were found in area code ${areaCode.trim()}.`,
      400
    );
  }

  const client = getTwilioClient();
  const voiceUrl = buildVapiVoiceUrl(trimmedAssistantId);

  try {
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl,
      voiceMethod: 'POST',
    });

    return {
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      voiceUrl: purchased.voiceUrl ?? null,
    };
  } catch (err) {
    throw new TwilioApiError(
      `Failed to purchase Twilio number ${available[0].phoneNumber}: ${
        err instanceof Error ? err.message : 'unknown Twilio error'
      }`,
      (err as { status?: number })?.status
    );
  }
}
