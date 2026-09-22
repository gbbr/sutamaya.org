import AuthenticationServices
import Capacitor

// AppleSignInPlugin shows the system Sign in with Apple sheet and resolves with the authorization
// code the Worker redeems (POST /api/auth/apple/native), the app's bundle id the code was issued
// to, and the name Apple shares on an Apple ID's first sign-in. A cancelled sheet rejects with the
// code "canceled".
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    // The call waiting on the sheet, and the controller showing it.
    private var pendingCall: CAPPluginCall?
    private var controller: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingCall?.reject("Superseded by a newer sign-in", "canceled")
            self.pendingCall = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    public func authorizationController(
        controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let call = finish() else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let codeData = credential.authorizationCode,
            let code = String(data: codeData, encoding: .utf8)
        else {
            call.reject("Apple returned no authorization code", "failed")
            return
        }
        var result: JSObject = ["code": code]
        if let clientId = Bundle.main.bundleIdentifier { result["clientId"] = clientId }
        if let givenName = credential.fullName?.givenName { result["givenName"] = givenName }
        if let familyName = credential.fullName?.familyName { result["familyName"] = familyName }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = finish() else { return }
        let canceled = (error as? ASAuthorizationError)?.code == .canceled
        call.reject(error.localizedDescription, canceled ? "canceled" : "failed", error)
    }

    // finish returns the waiting call and lets go of the sheet.
    private func finish() -> CAPPluginCall? {
        let call = pendingCall
        pendingCall = nil
        controller = nil
        return call
    }
}
