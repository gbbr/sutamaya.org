import UIKit
import Capacitor

// ViewController is the app's root screen: Capacitor's bridge, with a swipe in from the left edge
// that runs the app's own Back, and the app's own plugins.
class ViewController: CAPBridgeViewController {
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
