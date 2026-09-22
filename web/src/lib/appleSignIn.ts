import { Capacitor, registerPlugin } from '@capacitor/core';

// The iOS app's own Sign in with Apple plugin (web/ios/App/App/AppleSignInPlugin.swift).
interface AppleSignInPlugin {
  // Shows the system sheet and resolves with the code the Worker redeems and the bundle id it was
  // issued to. Rejects with the code "canceled" when the reader closes the sheet.
  authorize(): Promise<{ code: string; clientId?: string; givenName?: string; familyName?: string }>;
}

export const AppleSignIn = registerPlugin<AppleSignInPlugin>('AppleSignIn');

// True when this shell carries the plugin: iOS builds that ship it, never Android.
export function hasNativeAppleSignIn(): boolean {
  return Capacitor.isPluginAvailable('AppleSignIn');
}
