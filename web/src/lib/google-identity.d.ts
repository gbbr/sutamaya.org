// Minimal typings for the subset of Google Identity Services (accounts.google.com/gsi/client)
// used in AuthContext.tsx — loaded via a plain <script> tag in index.html, not an npm package.
interface GoogleIdCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (response: GoogleIdCredentialResponse) => void }): void;
  prompt(): void;
  renderButton(
    parent: HTMLElement,
    options: { type?: 'standard' | 'icon'; theme?: string; size?: string; shape?: string; width?: number; text?: string }
  ): void;
}

interface Window {
  google?: { accounts: { id: GoogleIdApi } };
}
