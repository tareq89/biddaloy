/** [75.1] Masked contact values: enough for the owner to recognise a number/address, not enough to copy it. */

/** `+8801712345321` -> `+88017••••321`; `j@x.com` -> `j•••@x.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '••••';
  return `${email[0]}•••${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 6) return `${phone.slice(0, 1)}••••`;
  return `${phone.slice(0, 6)}••••${phone.slice(-3)}`;
}
