import SwiftUI
import WebKit

@main struct CoopBenchApp: App {
    @StateObject private var model=AppModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene { WindowGroup {
        WebSurface(view:model.host.view)
            .preferredColorScheme(.light)
            .fullScreenCover(isPresented:$model.playerShown) {
                VStack(spacing:0) { HStack { Button("返回大厅") { Task { await model.session.returnToLobby() } };Spacer();Text("我的席位").font(.subheadline) }.padding(.horizontal,16).frame(minHeight:44);WebSurface(view:model.player.view) }
            }
            .onOpenURL { model.invitation($0) }
            .onChange(of:phase) { _,value in
                // System dialogs can make the app inactive without backgrounding it.
                if value == .background { model.session.foreground(false) }
                else if value == .active { model.session.foreground(true) }
            }
    } }
}
struct WebSurface: UIViewRepresentable {
    let view: WKWebView
    func makeUIView(context: Context) -> WKWebView { view }
    func updateUIView(_ uiView: WKWebView,context: Context) {}
}
@MainActor final class AppModel: ObservableObject {
    @Published var playerShown=false
    let session=HostSession()
    lazy var host=WebBridge(role:"host",session:session)
    lazy var player=WebBridge(role:"player",session:session)
    init() {
        session.showPlayer={ [weak self] in self?.playerShown=true }
        session.showLobby={ [weak self] in self?.playerShown=false }
        session.playerChanged={ [weak self] value in self?.player.emit("state",value) }
        #if DEBUG && targetEnvironment(simulator)
        Task { [weak self] in guard let self else { return };await IOSSmoke.run(self) }
        #endif
    }
    func invitation(_ url: URL) {
        guard url.scheme == "coopbench",url.host == "join",url.user == nil,url.password == nil,url.query == nil,let fragment=url.fragment,
              let query=URLComponents(string:"https://invitation.invalid/?"+fragment)?.queryItems,
              let room=query.first(where:{$0.name == "room"})?.value,UUID(uuidString:room) != nil,
              let api=query.first(where:{$0.name == "api"})?.value,(try? Endpoint.base(api)) != nil else { return }
        session.incoming=url.absoluteString;host.emit("invitation",url.absoluteString)
    }
}
@MainActor final class WebBridge: NSObject,WKScriptMessageHandler,WKNavigationDelegate,WKDownloadDelegate {
    let role: String,session: HostSession,root: URL,page: URL
    var view: WKWebView!
    private var tasks:[String:Task<Void,Never>]=[:],requests:[String:String]=[:],downloads:[ObjectIdentifier:URL]=[:]
    init(role: String,session: HostSession) {
        self.role=role;self.session=session
        root=Bundle.main.resourceURL!.appendingPathComponent("Web",isDirectory:true);page=root.appendingPathComponent(role == "host" ? "index.html":"player.html")
        super.init()
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically=false
        let script=(try? String(contentsOf:root.appendingPathComponent("ios-bridge.js"),encoding:.utf8)) ?? ""
        config.userContentController.addUserScript(WKUserScript(source:"window.__coopRole='\(role)';\n"+script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        config.userContentController.add(self,name:"coop")
        view=WKWebView(frame:.zero,configuration:config);view.navigationDelegate=self;view.isOpaque=false;view.backgroundColor = .systemBackground
        #if DEBUG
        view.isInspectable=true
        #endif
        view.loadFileURL(page,allowingReadAccessTo:root)
    }
    func emit(_ event: String,_ value: Any) {
        guard let eventText=try? jsonString(event),let body=try? jsonString(value) else { return }
        view.evaluateJavaScript("window.__coopEvent?.(\(eventText),\(body))",completionHandler:nil)
    }
    private func isLocalPage(_ url: URL?) -> Bool {
        guard let url,url.isFileURL,var parts=URLComponents(url:url,resolvingAgainstBaseURL:false) else { return false }
        // Replay selection updates the hash without navigating away from the bundle.
        parts.fragment=nil;parts.query=nil
        return parts.url?.standardizedFileURL == page.standardizedFileURL
    }
    func userContentController(_ userContentController: WKUserContentController,didReceive message: WKScriptMessage) {
        guard message.webView === view,message.frameInfo.isMainFrame,isLocalPage(message.frameInfo.request.url),
              let body=message.body as? JSON,let id=body["id"] as? String,let name=body["name"] as? String,id.count<100,
              let bytes=try? jsonData(body),bytes.count<=262144 else { return }
        let input=body["input"] as? JSON ?? [:]
        if name == "request",let requestID=input["id"] as? String { requests[requestID]=id }
        tasks[id]=Task { [weak self] in guard let self else { return };defer { self.tasks.removeValue(forKey:id);if let requestID=input["id"] as? String { self.requests.removeValue(forKey:requestID) } }
            do {
                let value=try await (self.role == "host" ? self.host(name,input,raw:body["input"]):self.player(name,input))
                self.reply(id,value,nil)
            } catch { self.reply(id,nil,publicFailure(error).record) }
        }
    }
    private func reply(_ id: String,_ value: Any?,_ error: JSON?) {
        guard let arguments=try? [jsonString(id),jsonString(value ?? null),jsonString(error as Any? ?? null)].joined(separator:",") else { return }
        view.evaluateJavaScript("window.__coopReply(\(arguments))",completionHandler:nil)
    }
    private func host(_ name: String,_ input: JSON,raw: Any?) async throws -> Any {
        switch name {
        case "getConnection":return await session.getConnection()
        case "login":return try await session.login(input)
        case "register":return try await session.register(input)
        case "operatorCommand":return try await session.operatorCommand(input)
        case "connect":return try await session.login(input,personal:true)
        case "getAccount":return try await session.account()
        case "setPassword":return try await session.password(input)
        case "disconnect":return try await session.disconnect()
        case "request":return try await session.request(input)
        case "cancelRequest":if let id=raw as? String,let task=requests[id] { tasks[task]?.cancel() };return [:]
        case "copyText":guard let text=raw as? String,text.utf8.count<=65536 else { throw ClientFailure("INVALID_REQUEST","复制内容过大。") };UIPasteboard.general.string=text;return [:]
        case "openPlayer":return try await session.openPlayer(input)
        case "hostSeat":return try await session.hostSeat(input["name"] as? String ?? "",input["input"] as? JSON ?? [:])
        case "incomingInvitation":return session.incoming
        default:throw ClientFailure("FORBIDDEN","此操作不可用。")
        }
    }
    private func player(_ name: String,_ input: JSON) async throws -> Any {
        if name == "incoming-invitation" { return "" }
        if name == "status" { return session.player?.snapshot() ?? ["status":"disconnected","lobbyManaged":true,"mode":"human"] }
        if name == "disconnect" { await session.returnToLobby();return ["status":"disconnected","lobbyManaged":true,"mode":"human"] }
        guard let runtime=session.player else { throw ClientFailure("NO_SEAT","请返回大厅加入房间。") }
        switch name {
        case "act":_ = try await runtime.act(input["action"] as? JSON ?? [:],observationID:input["observationId"] as? String ?? "",decisionSummary:input["decisionSummary"] as? String)
        case "ready":try await runtime.ready()
        case "start","kick":_ = try await runtime.roomCommand(name,input)
        case "leave":_ = try await runtime.roomCommand("leave");runtime.suspend();session.player=nil;try Vault.save("human-"+(try session.scope()),nil);return ["status":"disconnected","lobbyManaged":true]
        case "invite":var query=URLComponents();query.queryItems=[URLQueryItem(name:"api",value:runtime.api),URLQueryItem(name:"room",value:runtime.roomID)];UIPasteboard.general.string="coopbench://join#"+(query.percentEncodedQuery ?? "");return ["copied":true]
        default:throw ClientFailure("FORBIDDEN","玩家页面只允许本席操作。")
        }
        return runtime.snapshot()
    }
    func webView(_ webView: WKWebView,decidePolicyFor navigationAction: WKNavigationAction,decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        let url=navigationAction.request.url
        if url?.scheme == "blob" && navigationAction.shouldPerformDownload { decisionHandler(.download) }
        else { decisionHandler(isLocalPage(url) ? .allow:.cancel) }
    }
    func webView(_ webView: WKWebView,navigationAction: WKNavigationAction,didBecome download: WKDownload) { download.delegate=self }
    func download(_ download: WKDownload,decideDestinationUsing response: URLResponse,suggestedFilename: String,completionHandler: @escaping (URL?)->Void) {
        let name=String(suggestedFilename.split(separator:"/").last ?? "attachment").replacingOccurrences(of:"\\",with:"_").prefix(100)
        let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+"-"+name);downloads[ObjectIdentifier(download)]=file;completionHandler(file)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let url=downloads.removeValue(forKey:ObjectIdentifier(download)) else { return }
        let share=UIActivityViewController(activityItems:[url],applicationActivities:nil)
        var controller=view.window?.rootViewController;while let presented=controller?.presentedViewController { controller=presented }
        share.popoverPresentationController?.sourceView=view;share.popoverPresentationController?.sourceRect=CGRect(x:view.bounds.midX,y:view.bounds.midY,width:1,height:1);controller?.present(share,animated:true)
    }
}
