import Capacitor

// ViewController is the app's root screen: Capacitor's bridge, with the edge swipe for Back and Forward on.
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        webView?.allowsBackForwardNavigationGestures = true
    }
}
