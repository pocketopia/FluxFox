import Twilio from 'twilio';

const VAPI_INBOUND_WEBHOOK_URL = 'https://api.vapi.ai/twilio/inbound_call';

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
 * Re-points an ALREADY-OWNED Twilio number (no purchase) at Vapi's inbound
 * webhook by setting `voiceUrl` + `voiceMethod: 'POST'`. Used to repair a
 * number that plays "An application error has occurred" and to make
 * `/api/phone/provision` idempotent. Throws `TwilioApiError` if the number
 * isn't in this Twilio account or the update fails.
 */
export async function relinkOwnedPhoneNumber(phoneNumber: string): Promise<ProvisionedTwilioNumber> {
  const e164 = phoneNumber.trim();
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
    throw new TwilioApiError('`phoneNumber` must be an E.164 number, e.g. "+13605551234".', 400);
  }

  const client = getTwilioClient();

  try {
    const [owned] = await client.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });

    if (!owned) {
      throw new TwilioApiError(`${e164} is not an incoming phone number on this Twilio account.`, 400);
    }

    const updated = await client.incomingPhoneNumbers(owned.sid).update({
      voiceUrl: VAPI_INBOUND_WEBHOOK_URL,
      voiceMethod: 'POST',
    });

    return {
      sid: updated.sid,
      phoneNumber: updated.phoneNumber,
      voiceUrl: updated.voiceUrl ?? null,
    };
  } catch (err) {
    if (err instanceof TwilioApiError) throw err;
    throw new TwilioApiError(
      `Failed to update Twilio number ${e164}: ${err instanceof Error ? err.message : 'unknown Twilio error'}`,
      (err as { status?: number })?.status
    );
  }
}

/**
 * Purchases the first available local number in the given area code and
 * binds its inbound `VoiceUrl` (POST) to Vapi's Twilio inbound webhook.
 * The number must then be imported into Vapi (see `linkPhoneNumberToAssistant`)
 * so Vapi knows which assistant answers. Throws `TwilioApiError` on any
 * failure — no fallback or mock number is ever returned.
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

  try {
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl: VAPI_INBOUND_WEBHOOK_URL,
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
