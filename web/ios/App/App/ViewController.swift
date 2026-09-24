import UIKit
import WebKit
import Capacitor

// ViewController is the app's root screen: Capacitor's bridge, with a swipe in from the left edge
// that runs the app's own Back, and the app's own plugins.
class ViewController: CAPBridgeViewController {
    // webView returns the web view the app runs in, which on a Mac has no top safe area or on-screen
    // keyboard, and keeps keyboard focus.
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        if ProcessInfo.processInfo.isiOSAppOnMac {
            MacWebView.addFloatingAssistantBottomPadding()
            return MacWebView(frame: frame, configuration: configuration)
        }
        return super.webView(with: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSignInPlugin())

        let swipe = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(swipedBack(_:)))
        swipe.edges = .left
        webView?.addGestureRecognizer(swipe)
    }

    // swipedBack sends a swipe that ends moving inward, or past halfway, to the web app as the
    // "swipeback" window event (web/src/hooks/useNativeBack.ts). One pulled back toward the edge is
    // dropped.
    @objc private func swipedBack(_ swipe: UIScreenEdgePanGestureRecognizer) {
        guard swipe.state == .ended else { return }
        let movingIn = swipe.velocity(in: view).x > 0
        let pastHalfway = swipe.translation(in: view).x > view.bounds.width / 2
        guard movingIn || pastHalfway else { return }
        bridge?.triggerWindowJSEvent(eventName: "swipeback")
    }
}

// MacWebView is the web view on a Mac, fitted to a window with a title bar and no on-screen keyboard.
private class MacWebView: WKWebView {
    // noKeyboard is the empty input view that stands in for the on-screen keyboard.
    private let noKeyboard = UIView()

    // safeAreaInsets drops the top inset, which the title bar above the app holds nothing for.
    override var safeAreaInsets: UIEdgeInsets {
        var insets = super.safeAreaInsets
        insets.top = 0
        return insets
    }

    // inputView returns WebKit's own input view, or else noKeyboard in place of the on-screen
    // keyboard, which a Mac draws as an empty bar along the bottom of the window.
    override var inputView: UIView? {
        super.inputView ?? noKeyboard
    }

    // resignFirstResponder keeps keyboard focus on the page, which a Mac otherwise loses whenever it
    // puts the keyboard away, and gives it up only to a screen presented over the app.
    override func resignFirstResponder() -> Bool {
        guard window?.rootViewController?.presentedViewController != nil else { return false }
        return super.resignFirstResponder()
    }

    // addFloatingAssistantBottomPadding supplies the floating keyboard bar's bottom padding, which
    // UIKit's Mac build asks for once noKeyboard stands in for the keyboard but doesn't implement.
    // It returns iPadOS's value, and leaves alone an implementation a later macOS ships.
    static func addFloatingAssistantBottomPadding() {
        guard let assistant = NSClassFromString("UISystemInputAssistantViewController"),
              let metaclass = object_getClass(assistant) else { return }
        let padding: @convention(block) (AnyObject) -> CGFloat = { _ in 24 }
        class_addMethod(metaclass, NSSelectorFromString("floatingAssistantBottomPadding"),
                        imp_implementationWithBlock(padding), "d@:")
    }
}
