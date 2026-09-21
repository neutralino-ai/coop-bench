#if DEBUG && targetEnvironment(simulator)
import Foundation
import WebKit

/// Compiled only for Debug simulators. All input is a loopback synthetic fixture.
@MainActor enum IOSSmoke {
    static func run(_ app: AppModel) async {
        let args=ProcessInfo.processInfo.arguments
        guard let index=args.firstIndex(of:"--smoke"),args.count>index+1,
              let bytes=Data(base64Encoded:args[index+1]),let config=(try? JSONSerialization.jsonObject(with:bytes)) as? JSON,
              let base=config["apiUrl"] as? String,URL(string:base)?.host == "127.0.0.1" else { return }
        var checks=[String](),report: JSON=[:]
        let directory=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0]
        func check(_ condition: Bool,_ label: String) throws { try require(condition,label,"SMOKE_FAILED");checks.append(label) }
        func js(_ script: String,_ bridge: WebBridge) async throws -> Any? {
            try await bridge.view.callAsyncJavaScript(script,arguments:[:],in:nil,contentWorld:.page)
        }
        func wait(_ label: String,_ condition: () async throws -> Bool) async throws {
            for _ in 0..<200 { if try await condition() { checks.append(label);return };try await Task.sleep(nanoseconds:100_000_000) }
            throw ClientFailure("SMOKE_TIMEOUT",label)
        }
        func snapshot(_ name: String,_ bridge: WebBridge) async throws {
            let image=try await bridge.view.takeSnapshot(configuration:nil)
            try image.pngData()?.write(to:directory.appendingPathComponent(name+".png"),options:.atomic)
            try check(try await js("return document.documentElement.scrollWidth <= innerWidth+2",bridge) as? Bool == true,name+"-fits-phone")
        }
        do {
            try Vault.save("connection",nil)
            try await wait("login-page",{try await js("return Boolean(window.CoopLobby && document.querySelector('#connect-button') && !document.querySelector('#connect-button').disabled)",app.host) as? Bool == true})
            try await snapshot("login",app.host)
            _=try await js("document.querySelector('#api-address').value=\(jsonString(base));document.querySelector('#login-password').value=\(jsonString(config["password"] ?? ""));document.querySelector('#login-form').requestSubmit();return true",app.host)
            try await wait("password-login",{app.session.identity != nil})
            try await wait("lobby-and-replays",{try await js("return !!document.querySelector('.lobby-home') && document.querySelectorAll('#episode-list button').length>0",app.host) as? Bool == true})
            try await snapshot("lobby",app.host)
            _=try await js("document.querySelector('#open-create').click();document.querySelector('#create-players').value='2';document.querySelector('#create-name').value='iPhone 验收房间';document.querySelector('#create-room').click();return true",app.host)
            try await wait("room-created-in-ui",{try await js("return document.querySelectorAll('.host-seat.vacant').length===2",app.host) as? Bool == true})
            let rooms=try await app.session.owner("/rooms")
            let room=(rooms["rooms"] as! [JSON]).first{$0["name"] as? String == "iPhone 验收房间"}!
            let roomID=room["roomId"] as! String
            let key=try await app.session.seatKey(roomID,"p1")
            try check(key.count>=43,"owner-issued-seat-token")
            try check(try await js("return document.querySelector('#start-room').disabled",app.host) as? Bool == true,"start-disabled-before-full")
            _=try await js("document.querySelector('[data-action=claude][data-seat=p1]').click();return true",app.host)
            try await wait("claude-prompt-copied",{let text=UIPasteboard.general.string ?? "";return text.contains(roomID) && text.contains(key) && text.contains("/player.md")})
            try await snapshot("room",app.host)
            _=try await js("document.querySelector('#create-dialog').close();window.CoopLobby.join({roomId:\(jsonString(roomID))});document.querySelector('#lobby-seat-token').value=\(jsonString(key));document.querySelector('#join-seat').click();return true",app.host)
            try await wait("human-joined-in-ui",{app.session.player != nil})
            try await wait("player-rendered",{try await js("return !!window.coopPlayer && !!document.querySelector('#connection')",app.player) as? Bool == true})
            try check(try await js("return !window.coopDesktop",app.player) as? Bool == true,"player-has-no-owner-bridge")
            try check(try await js("try {await window.coopPlayer.command('request',{path:'/api/v1/rollouts'});return false;}catch(e){return e.code==='FORBIDDEN'}",app.player) as? Bool == true,"native-rejects-owner-command-from-player")
            do { _=try await app.session.hostSeat("start",["roomId":roomID,"playerId":"p2"]);throw ClientFailure("SMOKE_FAILED","agent joined without a probe") }
            catch { try check((error as? ClientFailure)?.code == "MODEL_TEST_REQUIRED","agent-requires-preflight") }
            let modelBase=String(base.dropLast("/api/v1".count))+"/model"
            do { _=try await app.session.hostSeat("testModel",["baseUrl":modelBase,"model":"synthetic-thinking-model","apiKey":"wrong-synthetic-key"]);throw ClientFailure("SMOKE_FAILED","bad key accepted") }
            catch { try check((error as? ClientFailure)?.code == "MODEL_HTTP_401","bad-model-key-rejected") }
            let verified=try await app.session.hostSeat("testModel",["baseUrl":modelBase,"model":"synthetic-thinking-model","apiKey":"synthetic-provider-key"]) as! JSON
            try check(verified["ok"] as? Bool == true,"responses-two-tool-preflight")
            let saved=try await app.session.hostSeat("modelConfig",[:]) as! JSON
            try check(saved["hasApiKey"] as? Bool == true && saved["apiKey"] == nil,"model-key-saved-without-renderer-exposure")
            _=try await app.session.hostSeat("start",["roomId":roomID,"playerId":"p2","verificationId":verified["verificationId"]!])
            try await wait("both-seats-ready",{let state=try await app.session.owner("/rooms/\(roomID)/admin");return (state["members"] as? [JSON] ?? []).count == 2 && (state["members"] as? [JSON] ?? []).allSatisfy{$0["ready"] as? Bool == true}})
            let started=try await app.session.owner("/rooms/\(roomID)/admin-start",[:])
            try check(started["episodeId"] is String,"owner-starts-game")
            try await wait("seat-observation",{app.session.player?.observation != nil})
            try await wait("agent-submits-action",{app.session.agents.values.first?.data["lastActionResult"] != nil})
            try await wait("model-failure-is-visible",{app.session.agents.values.first?.warning?.contains("停止") == true})
            let runtime=app.session.player!
            try check(runtime.snapshot()["decisionToken"] == nil && (runtime.snapshot()["observation"] as? JSON)?["decisionToken"] == nil,"snapshot-hides-decision-capability")
            _=try await runtime.act(["type":"hint","target":"p2","kind":"color","value":"red"],observationID:runtime.observation!["observationId"] as! String)
            try check(runtime.data["pendingAction"] == nil,"human-action-acknowledged")
            runtime.suspend();runtime.start()
            try await wait("resume-refreshes-seat",{runtime.status != "disconnected"})
            try await wait("trace-upload",{(runtime.data["acked"] as? Int ?? 0)>0})
            try await snapshot("game",app.player)
            _=try await js("document.querySelector('#rules-button').click();return true",app.player)
            try check(try await js("return document.querySelector('#rules-dialog').open && document.querySelector('#rules-content').textContent.includes('Synthetic')",app.player) as? Bool == true,"player-rules-open")
            _=try await js("document.querySelector('#close-rules').click();return true",app.player)
            report=["ok":true,"checks":checks,"evidence":"iPhone simulator, synthetic HTTP/model fixture; no real game engine or model"]
        } catch { report=["ok":false,"checks":checks,"error":publicFailure(error).record] }
        try? jsonData(report).write(to:directory.appendingPathComponent("ios-smoke.json"),options:.atomic)
    }
}
#endif
