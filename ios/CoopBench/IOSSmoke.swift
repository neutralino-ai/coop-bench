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
            let origin=String(base.dropLast("/api/v1".count)),began=Date()
            do { _=try await HTTP.shared.raw(origin+"/_ios/slow",timeout:0.2);throw ClientFailure("SMOKE_FAILED","slow response exceeded its budget") }
            catch { try check(publicFailure(error).code == "TIMEOUT" && Date().timeIntervalSince(began)<3,"streaming-request-deadline") }
            do { _=try await HTTP.shared.raw(origin+"/_ios/redirect",token:"synthetic-secret");throw ClientFailure("SMOKE_FAILED","redirect accepted") }
            catch { try check(publicFailure(error).code == "REDIRECT_REJECTED","redirect-rejected") }
            try await wait("login-page",{try await js("return Boolean(window.CoopLobby && document.querySelector('#connect-button') && !document.querySelector('#connect-button').disabled)",app.host) as? Bool == true})
            try await snapshot("login",app.host)
            _=try await js("document.querySelector('#credential-mode').click();document.querySelector('#api-address').value=\(jsonString(base));document.querySelector('#admin-token').value=\(jsonString(config["registrationToken"] ?? ""));document.querySelector('#login-user-id').value='owner';document.querySelector('#login-password').value=\(jsonString(config["password"] ?? ""));document.querySelector('#login-form').requestSubmit();return true",app.host)
            try await wait("registration-and-password-session",{app.session.identity != nil && app.session.token.hasPrefix("hs1_")})
            try await wait("lobby-and-replays",{try await js("return !!document.querySelector('.lobby-home') && document.querySelectorAll('#episode-list button').length>0",app.host) as? Bool == true})
            try check(app.session.identity?["role"] as? String == "member","registration-produces-member-identity")
            try check(try await js("return document.querySelector('#operator-open').hidden && !document.querySelector('#annotation-form')",app.host) as? Bool == true,"member-has-no-management-or-annotation-controls")
            try check(try await js("return document.querySelector('#connection-status').dataset.state==='connected' && document.querySelector('#auth-panel').hidden",app.host) as? Bool == true,"member-registration-enters-lobby")
            _=try await js("await disconnect();setLoginMode('password');document.querySelector('#login-user-id').value='owner';document.querySelector('#login-password').value=\(jsonString(config["password"] ?? ""));document.querySelector('#login-form').requestSubmit();return true",app.host)
            try await wait("member-password-login-enters-lobby",{try await js("return document.querySelector('#connection-status').dataset.state==='connected' && document.querySelector('#auth-panel').hidden && document.querySelectorAll('#episode-list button').length>0",app.host) as? Bool == true})
            try await snapshot("lobby",app.host)
            _=try await js("document.querySelector('#episode-list button').click();return true",app.host)
            try await wait("replay-rendered",{try await js("return !document.querySelector('#detail').hidden && document.querySelectorAll('#player-grid .player-panel').length>0",app.host) as? Bool == true})
            try await snapshot("replay",app.host)
            try check(try await js("return !document.querySelector('.replay-deadline') && ![...document.querySelectorAll('.player-panel button')].some(b=>b.textContent.includes('跳到这一步'))",app.host) as? Bool == true,"completed-replay-hides-live-clock-and-jump-links")
            try check(try await js("return getComputedStyle(document.querySelector('#connection-status')).display==='none' && !!document.querySelector('.topbar #connection-quick-check') && !!document.querySelector('#timeline-track #timeline') && document.querySelector('#focus-step-title').hidden",app.host) as? Bool == true,"compact-menu-connection-and-numbered-timeline")
            _=try await js("const t=document.querySelector('#timeline');t.value='1';t.dispatchEvent(new Event('input'));return true",app.host)
            try await wait("compact-trace-cards",{try await js("return document.querySelector('.trace-current')?.dataset.category==='call' && new Set([...document.querySelectorAll('.trace-block')].map(b=>b.dataset.category)).size===5",app.host) as? Bool == true})
            try check(try await js("return [...document.querySelectorAll('.trace-block')].every(b=>b.getBoundingClientRect().height<=90) && !document.querySelector('.trace-detail[open]')",app.host) as? Bool == true,"five-compact-trace-types-current-tool-use")
            _=try await js("document.querySelector('.trace-reasoning summary').click();return true",app.host)
            try await wait("full-thinking-detail",{try await js("return document.querySelector('.trace-reasoning .trace-expanded')?.textContent.includes('原文结束标记')",app.host) as? Bool == true})
            _=try await js("document.querySelector('.trace-reasoning summary').click();return true",app.host)
            try await snapshot("compact-trace",app.host)
            try check(try await js("const r=await window.coopTransport.request('/api/v1/rollouts');return r.ok",app.host) as? Bool == true,"owner-bridge-after-replay-hash")
            _=try await js("document.querySelector('#open-library').click();return true",app.host)
            _=try await js("document.querySelector('#open-create').click();document.querySelector('#create-players').value='2';document.querySelector('#create-name').value='iPhone 验收房间';return true",app.host)
            try await snapshot("create-room",app.host)
            _=try await js("document.querySelector('#create-room').click();return true",app.host)
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
            app.playerShown=false
            _=try await js("document.querySelector('#create-dialog').showModal();return true",app.host)
            try await wait("start-enabled-in-ui",{try await js("return !!document.querySelector('#start-room') && !document.querySelector('#start-room').disabled",app.host) as? Bool == true})
            _=try await js("document.querySelector('#start-room').click();return true",app.host)
            try await wait("game-started-in-ui",{try await js("return document.querySelector('#end-room')?.textContent==='强制结束游戏'",app.host) as? Bool == true})
            try check(try await js("return !document.querySelector('#room-open-replay') && !document.querySelector('#room-open-messages')",app.host) as? Bool == true,"room-only-manages-seats")
            let started=try await app.session.owner("/rooms/\(roomID)/admin")
            try check(started["episodeId"] is String,"owner-starts-game")
            _=try await js("document.querySelector('#create-dialog').close();return true",app.host);app.playerShown=true
            try await wait("seat-observation",{app.session.player?.observation != nil})
            try await wait("agent-submits-action",{app.session.agents.values.first?.data["lastActionResult"] != nil})
            try await wait("model-failure-is-visible",{app.session.agents.values.first?.warning?.contains("停止") == true})
            let runtime=app.session.player!
            try check(runtime.snapshot()["decisionToken"] == nil && (runtime.snapshot()["observation"] as? JSON)?["decisionToken"] == nil,"snapshot-hides-decision-capability")
            _=try await runtime.act(["type":"hint","target":"p2","kind":"color","value":"red"],observationID:runtime.observation!["observationId"] as! String,decisionSummary:"合成 iOS 理由：提示红色。")
            try check(runtime.data["pendingAction"] == nil,"human-action-acknowledged")
            try check(try await js("return !document.querySelector('#dictate-reason').hidden && !!document.querySelector('#decision-reason')",app.player) as? Bool == true,"human-reason-and-native-dictation-visible")
            try check((runtime.data["messages"] as? [JSON] ?? []).contains { (($0["message"] as? JSON)?["raw"] as? JSON)?["decisionSummary"] as? String == "合成 iOS 理由：提示红色。" },"human-reason-preserved-in-action-trace")
            app.playerShown=false
            _=try await js("await selectEpisode(\(jsonString(runtime.episode!)));return true",app.host)
            try check(try await js("return state.rollout.summary.status==='active' && !!document.querySelector('.acting .replay-deadline') && document.querySelector('#focus-timing').textContent.includes('实时')",app.host) as? Bool == true,"live-replay-highlights-required-seat-and-deadline")
            try await snapshot("replay-live",app.host)
            _=try await js("selectFrame(0);return true",app.host)
            try check(try await js("return !document.querySelector('.replay-deadline')",app.host) as? Bool == true,"historical-replay-hides-live-clock")
            app.playerShown=true
            runtime.suspend();runtime.start()
            try await wait("resume-refreshes-seat",{runtime.status != "disconnected"})
            try await wait("trace-upload",{(runtime.data["acked"] as? Int ?? 0)>0})
            let captured: JSON=["synthetic":true,"text":String(repeating:"fragment 中文 ",count:4000),"value":1e-7]
            try runtime.record("tool-result",captured)
            let messages=runtime.data["messages"] as! [JSON]
            let lastCapture=(messages.last?["message"] as? JSON)?["capture"] as? JSON
            let logical=lastCapture?["logicalId"] as? String
            let fragments=messages.filter{ (($0["message"] as? JSON)?["capture"] as? JSON)?["logicalId"] as? String == logical }
            try jsonData(fragments).write(to:directory.appendingPathComponent("capture-fragments.json"),options:.atomic)
            try await snapshot("game",app.player)
            _=try await js("document.querySelector('#rules-button').click();return true",app.player)
            try check(try await js("return document.querySelector('#rules-dialog').open && document.querySelector('#rules-content').textContent.includes('Synthetic')",app.player) as? Bool == true,"player-rules-open")
            _=try await js("document.querySelector('#close-rules').click();return true",app.player)
            await app.session.returnToLobby()
            try check(app.session.player == nil,"return-to-lobby-stops-only-local-player")
            _=try await app.session.openPlayer(["roomId":roomID])
            try await wait("account-restores-original-seat",{app.session.player?.observation != nil})
            try check(app.session.player?.config["playerToken"] as? String == key,"human-recovery-keeps-original-seat-token")
            let membership=try await app.session.owner("/lobby/mine")
            try check((membership["participating"] as? [JSON] ?? []).contains{$0["roomId"] as? String == roomID},"account-lists-participating-room")
            let oldAgent=app.session.agents[roomID+"/p2"]!,oldHistory=oldAgent.data["modelHistory"] as? [JSON] ?? []
            let recoveredProof=try await app.session.hostSeat("testModel",["baseUrl":modelBase,"model":"synthetic-recovered-model","apiKey":"synthetic-provider-key"]) as! JSON
            _=try await app.session.hostSeat("resume",["roomId":roomID,"playerId":"p2","verificationId":recoveredProof["verificationId"]!])
            let recovered=app.session.agents[roomID+"/p2"]!
            try check(recovered !== oldAgent && recovered.config["playerToken"] as? String == oldAgent.config["playerToken"] as? String,"agent-recovery-keeps-original-seat")
            try check(!oldHistory.isEmpty && (recovered.data["modelHistory"] as? [JSON] ?? []).count >= oldHistory.count,"agent-recovery-keeps-model-context")
            try check(try await app.session.seatKey(roomID,"p1") == key,"copy-occupied-seat-after-start")
            _=try await app.session.owner("/rooms/\(roomID)/admin-end",["reason":"synthetic iPhone acceptance"])
            let ended=try await app.session.owner("/rooms/\(roomID)/admin")
            try check(ended["status"] as? String == "truncated","host-can-end-with-preserved-records")
            app.playerShown=false
            _=try await js("await disconnect();document.querySelector('#api-address').value=\(jsonString(config["operatorApiUrl"] ?? ""));setLoginMode('password');document.querySelector('#login-user-id').value='owner';document.querySelector('#login-password').value=\(jsonString(config["password"] ?? ""));document.querySelector('#login-form').requestSubmit();return true",app.host)
            try await wait("operator-login-management-entry",{try await js("return !document.querySelector('#operator-open').hidden && document.querySelector('#connection-status').dataset.state==='connected'",app.host) as? Bool == true})
            _=try await js("document.querySelector('#operator-open').click();return true",app.host)
            try await wait("operator-user-list",{try await js("return document.querySelectorAll('#operator-users-body tr').length===3",app.host) as? Bool == true})
            try await snapshot("operator-users",app.host)
            _=try await js("document.querySelector('[data-tab=invitations]').click();return true",app.host)
            try await wait("operator-invite-tab",{try await js("return !document.querySelector('#operator-invitations').hidden",app.host) as? Bool == true})
            _=try await js("document.querySelector('#operator-invite-count').value='2';document.querySelector('#operator-invite-form').requestSubmit();return true",app.host)
            try await wait("operator-generates-invitations",{try await js("return document.querySelector('#operator-invite-result').value.includes('2. ')",app.host) as? Bool == true})
            try await snapshot("operator-invitations",app.host)
            _=try await js("document.querySelector('#operator-close').click();return true",app.host)
            try check(try await js("return !document.querySelector('#operator-dialog').open && document.querySelector('#operator-invite-result').value==='';",app.host) as? Bool == true,"operator-close-clears-invitations")
            report=["ok":true,"checks":checks,"evidence":"iPhone simulator, synthetic HTTP/model fixture; no real game engine or model"]
        } catch {
            report=["ok":false,"checks":checks,"error":publicFailure(error).record]
            if let ui = try? await js("return {view:document.body.dataset.view,loading:document.querySelector('#replay-loading-detail')?.textContent,connection:document.querySelector('#connection-status')?.dataset.state,message:document.querySelector('#message')?.textContent}",app.host) { report["ui"]=ui }
        }
        try? jsonData(report).write(to:directory.appendingPathComponent("ios-smoke.json"),options:.atomic)
    }
}
#endif
