/**
 * [15.6.1] Moved to `shared/src/sms/segments.ts` so the server's SMS send
 * path can use the exact same GSM-7/UCS-2 segment calculator instead of
 * its own ASCII-only heuristic. Re-exported here so every existing
 * `ui/src/utils` importer (and `ui/src/utils/index.ts`) keeps working
 * unchanged.
 */
export { countSmsSegments, type SmsEncoding, type SmsSegmentInfo } from '@biddaloy/shared';
