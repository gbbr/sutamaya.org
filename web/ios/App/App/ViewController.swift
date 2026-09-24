import UIKit
import WebKit
import Capacitor

// ViewController is the app's root screen: Capacitor's bridge, with a swipe in from the left edge
// that runs the app's own Back, and the app's own plugins.
class ViewController: CAPBridgeViewController {
    // webView returns the web view the app runs in, one without a top safe area on a Mac.
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        if ProcessInfo.processInfo.isiOSAppOnMac {
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

// MacWebView is the web view on a Mac, where the window's title bar sits above the app and the top
// safe area the system reports holds nothing.
private class MacWebView: WKWebView {
    override var safeAreaInsets: UIEdgeInsets {
        var insets = super.safeAreaInsets
        insets.top = 0
        return insets
    }
}
