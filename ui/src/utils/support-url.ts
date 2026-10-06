/**
 * [13.0] The school's "talk to us" link (`SUPPORT_CONTACT_URL`, via the
 * onboarding status) is rendered as an `href` in more than one place. Only
 * `https:` and `mailto:` are allowed, so a misconfigured value can never be a
 * `javascript:`, `data:` or plain-http link.
 */
export function isSafeSupportUrl(url: string | null | undefined): url is string {
  return !!url && /^(https:|mailto:)/i.test(url);
}
