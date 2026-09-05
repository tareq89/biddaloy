/**
 * D7 (epic #409): the one password-strength rule shared by every endpoint
 * that ever sets a password — `ChangePasswordDto.new_password` and
 * `account-access`'s `ActivateDto.password` both import this rather than
 * each spelling out their own minimum, so the two can never disagree.
 */
export const PASSWORD_MIN_LENGTH = 8;
