import { BUILD_COMMIT_ID } from './buildInfo';
import { platformName, type Platform } from './platform';

// The address readers write to with bugs, questions and suggestions.
export const CONTACT_EMAIL = 'metta@sutamaya.org';

// Each platform's name in a feedback email.
const PLATFORM_LABEL: Record<Platform, string> = {
  web: 'web',
  ios: 'iOS app',
  android: 'Android app',
};

// feedbackMailto returns a mail link to CONTACT_EMAIL with the subject filled in, and the build and
// device the reader is on below the room left for their message.
export function feedbackMailto(): string {
  const body = [
    '',
    '',
    '',
    '—',
    `Version: ${BUILD_COMMIT_ID || 'unknown'} (${PLATFORM_LABEL[platformName()]})`,
    `Device: ${navigator.userAgent}`,
  ].join('\r\n');
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Feedback on sutamaya')}&body=${encodeURIComponent(body)}`;
}
