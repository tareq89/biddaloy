/** True only when `MESSAGE_SINK=mailpit`: every medium goes to the Mailpit test inbox. */
export const isMessageSink = (): boolean => process.env.MESSAGE_SINK === 'mailpit';

/** Provider tag used as the `provider_message_id` prefix and in `metadata.raw.provider`. */
export const MESSAGE_SINK_PROVIDER = 'mailpit-sink';
