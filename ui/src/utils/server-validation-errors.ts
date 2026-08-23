/**
 * Maps a `ValidationPipe` 400's `message` array onto the DTO fields it
 * actually failed on. class-validator's default message template is
 * `"<property> <constraint text>"` (e.g. `"full_name should not be empty"`,
 * `"email must be an email"`) — there's no structured `{ field, message }`
 * shape on the wire (see `ApiErrorBody`'s own comment on why), so this
 * matches each message's leading token against a caller-supplied allowlist
 * of known field names rather than guessing at arbitrary property names.
 * A message that doesn't start with any known field (a root-level error,
 * or a constraint whose text doesn't lead with the property) is dropped —
 * it still reaches the user via the mutation's own generic error message,
 * just not pinned to one input.
 */
export function parseValidationFieldErrors(
  messages: string[],
  knownFields: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const message of messages) {
    const field = knownFields.find(
      (candidate) => message === candidate || message.startsWith(`${candidate} `),
    );
    if (field) result[field] = message;
  }
  return result;
}
