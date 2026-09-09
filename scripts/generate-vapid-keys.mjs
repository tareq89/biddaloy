#!/usr/bin/env node
/**
 * Generates a VAPID keypair for Web Push (#552).
 *
 * Usage: node scripts/generate-vapid-keys.mjs
 *
 * Paste the printed values into server/.env as VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY. VAPID_SUBJECT is not generated — set it yourself to
 * a mailto: address or https: URL that identifies this deployment.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
