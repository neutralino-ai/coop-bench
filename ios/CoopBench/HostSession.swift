import Foundation
import UIKit

@MainActor final class HostSession {
    var api=apiDefault, token="", identity: JSON?; var remembered=false; var epoch=UUID()
    var player: SeatRuntime?; var agents: [String:SeatRuntime]=[:]
    var showPlayer: (()->Void)?;var showLobby: (()->Void)?; var playerChanged: ((JSON)->Void)?
    private var hostTokens:[String:String]=[:]
    private var verified: [String:(ModelAgent,Date,UUID,Bool)]=[:], starting=Set<String>()
    private var probe: Task<ModelAgent,Error>?
    private var restoring: Task<Void,Never>?,restoreWarnings:[String:String]=[:]
    private var restorationGeneration=UUID()
    private var foregroundActive=true
    private var changingPlayer=false
    private func updateScreenAwake() {
        UIApplication.shared.isIdleTimerDisabled=foregroundActive && (Array(agents.values)+(player.map{[$0]} ?? [])).contains{!["ended","disconnected","room-closed","access-denied"].contains($0.status)}
    }
    var incoming=""
    func info() -> JSON { ["apiUrl":api,"connected":identity != nil,"identity":identity as Any? ?? null,"remembered":remembered] }
    func scope() throws -> String { guard let id=identity?["id"] as? String, !token.isEmpty else { throw ClientFailure("LOGIN_REQUIRED","请先登录。") };return hashID(api+"\n"+id) }
    func getConnection() async -> JSON {
        if identity != nil { return info() }
        do { if let saved=try Vault.load("connection"),let url=saved["apiUrl"] as? String,let key=saved["token"] as? String {
            api=try Endpoint.base(url);let generation=epoch
            let id=try await HTTP.shared.json(api+"/identity",token:key)
            try require(generation == epoch,"登录已改变，请重新连接。","CANCELLED")
            try accept(id,key:key,remember:true);return info()
        } } catch { var result=info();result["connectionError"]=publicFailure(error).record;return result }
        return info()
    }
    private func stop() {
        epoch=UUID();restorationGeneration=UUID();probe?.cancel();probe=nil;restoring?.cancel();restoring=nil;restoreWarnings.removeAll();verified.removeAll();starting.removeAll()
        player?.suspend();player=nil;for agent in agents.values { agent.suspend() };agents.removeAll();identity=nil;token="";remembered=false;hostTokens.removeAll();updateScreenAwake()
    }
    private func accept(_ id: JSON,key: String,remember: Bool) throws {
        try require(id["id"] is String && ["operator","coordinator","auditor","member"].contains(id["role"] as? String ?? ""),"身份验证响应格式不正确。")
        if remember { try Vault.save("connection",["apiUrl":api,"token":key]) } else { try Vault.save("connection",nil) }
        token=key;identity=id;remembered=remember
        restoreAgents()
    }
    func login(_ input: JSON, personal: Bool = false) async throws -> JSON {
        stop();try Vault.save("connection",nil);api=try Endpoint.base(input["apiUrl"] as? String ?? apiDefault);let generation=epoch
        let endpoint=api
        _=try await HTTP.shared.json(endpoint+"/health")
        try require(generation == epoch,"登录已改变，请重试。","CANCELLED")
        var key=input["token"] as? String ?? ""
        if !personal {
            let user=input["userId"] as? String ?? "",password=input["password"] as? String ?? ""
            try require(matches(user,"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$") && !password.isEmpty && password.utf8.count<=512,"请输入有效账号和密码。")
            let auth=try await HTTP.shared.json(endpoint+"/auth/login",body:["userId":user,"password":password]);key=auth["token"] as? String ?? ""
        }
        try require(key.count>=24 && key.count<=256,"登录凭证格式无效。")
        try require(generation == epoch,"登录已改变，请重试。","CANCELLED")
        let id=try await HTTP.shared.json(endpoint+"/identity",token:key)
        try require(generation == epoch,"登录已改变，请重试。","CANCELLED")
        try accept(id,key:key,remember:input["remember"] as? Bool == true);return info()
    }
    func account() async throws -> JSON { _=try scope();return try await HTTP.shared.json(api+"/auth/account",token:token) }
    func register(_ input:JSON) async throws -> JSON {
        stop();try Vault.save("connection",nil);api=try Endpoint.base(input["apiUrl"] as? String ?? apiDefault);let generation=epoch
        let user=input["userId"] as? String ?? "",password=input["password"] as? String ?? "",registrationToken=input["registrationToken"] as? String ?? ""
        try require(matches(user,"^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$") && password.count>=12 && password.count<=128 && password.utf8.count<=512 && registrationToken.count>=24,"请填写用户名、至少12字符的密码及注册 token。")
        let auth=try await HTTP.shared.json(api+"/auth/register",body:["userId":user,"password":password,"registrationToken":registrationToken])
        try require(generation == epoch,"登录已改变，请使用新账号登录。","CANCELLED")
        guard let key=auth["token"] as? String else { throw ClientFailure("REGISTERED_RELOGIN","账号已创建，请使用用户名和密码登录。") }
        let id=try await HTTP.shared.json(api+"/identity",token:key);try require(generation == epoch,"登录已改变，请重试。","CANCELLED")
        try accept(id,key:key,remember:input["remember"] as? Bool == true);return info()
    }
    private func hostToken(_ path:String,method:String) async throws -> String? {
        let parts=path.split(separator:"/");guard method == "POST",parts.count==5,parts[2]=="rooms",parts[4].hasPrefix("admin-") else { return nil }
        let room=String(parts[3]);try require(UUID(uuidString:room) != nil,"房间ID无效。")
        if let key=hostTokens[room] { return key };let generation=epoch,value=try await HTTP.shared.json(api+"/rooms/\(room)/host",token:token)
        try require(generation == epoch,"登录已改变。","CANCELLED");guard let key=value["hostToken"] as? String else { throw ClientFailure("FORBIDDEN","没有房主权限。") };hostTokens[room]=key;return key
    }
    func returnToLobby() async { await player?.suspendAndWait();player=nil;updateScreenAwake();showLobby?() }
    func password(_ input: JSON) async throws -> JSON {
        _=try scope();let generation=epoch,password=input["password"] as? String ?? ""
        try require(password.count>=12 && password.count<=128 && password.utf8.count<=512,"新密码至少12个字符，最多128个字符。")
        var body: JSON=["password":password];if let current=input["currentPassword"] as? String { body["currentPassword"]=current }
        let auth=try await HTTP.shared.json(api+"/auth/password",token:token,body:body)
        try require(generation == epoch,"登录已改变，请重新登录。","CANCELLED")
        guard let key=auth["token"] as? String else { throw ClientFailure("INVALID_RESPONSE","密码响应缺少新会话。") }
        token=key;try Vault.save("connection",nil);let id=try await HTTP.shared.json(api+"/identity",token:key)
        try require(generation == epoch,"登录已改变，请重新登录。","CANCELLED")
        try accept(id,key:key,remember:input["remember"] as? Bool == true);return info()
    }
    func disconnect() async throws -> JSON {
        let old=token,url=api;stop();try Vault.save("connection",nil)
        if old.hasPrefix("hs1_") { do { _=try await HTTP.shared.json(url+"/auth/logout",token:old,body:[:]) } catch { if (error as? ClientFailure)?.status != 401 { return ["logoutWarning":true] } } }
        return [:]
    }
    func request(_ input: JSON) async throws -> JSON {
        _=try scope();let generation=epoch,method=input["method"] as? String ?? "GET"
        let path=try Endpoint.path(input["path"] as? String ?? "",method:method,owner:true),body=input["body"] as? JSON
        try require(method != "POST" || body != nil,"POST 需要 JSON 对象。")
        if let body { try require(try jsonData(body).count<=65536,"请求体超过64KiB。") }
        let host=try await hostToken(path,method:method)
        let origin=String(api.dropLast("/api/v1".count)),(bytes,response)=try await HTTP.shared.raw(origin+path,token:token,body:body,method:method,hostToken:host)
        try require(generation == epoch,"登录已改变。","CANCELLED")
        if (200..<300).contains(response.statusCode),let value=(try? JSONSerialization.jsonObject(with:bytes)) as? JSON {
            try capture(path:path,input:body ?? [:],value:value)
        }
        var headers: [String:String]=[:]
        for name in ["Content-Type","Content-Disposition","Retry-After"] { if let value=response.value(forHTTPHeaderField:name) { headers[name]=value } }
        return ["status":response.statusCode,"headers":headers,"bodyBase64":bytes.base64EncodedString()]
    }
    func owner(_ path: String,_ body: JSON? = nil) async throws -> JSON {
        _=try scope();let generation=epoch
        let host=try await hostToken("/api/v1"+path,method:body == nil ? "GET":"POST")
        let result=try await HTTP.shared.json(api+path,token:token,body:body,hostToken:host)
        try require(generation == epoch,"登录已改变。","CANCELLED")
        try capture(path:"/api/v1"+path,input:body ?? [:],value:result);return result
    }
    private func capture(path: String,input: JSON,value: JSON) throws {
        let binding=try scope();var keys=try Vault.load("seats-"+binding) ?? [:]
        if let room=value["roomId"] as? String,let seats=value["seatTokens"] as? [JSON] {
            for seat in seats { if let player=seat["playerId"] as? String,let key=seat["seatToken"] as? String { keys[room+"/"+player]=key } }
            try Vault.save("seats-"+binding,keys)
        }
        if path.hasSuffix("/admin-kick"),let room=value["roomId"] as? String,let player=input["playerId"] as? String {
            let id=room+"/"+player;agents.removeValue(forKey:id)?.suspend();keys.removeValue(forKey:id);try Vault.save("seats-"+binding,keys)
            var saved=try Vault.load("agents-"+binding) ?? [:];saved.removeValue(forKey:id);try Vault.save("agents-"+binding,saved);restoreWarnings.removeValue(forKey:id)
        }
    }
    func seatKey(_ room: String,_ player: String) async throws -> String {
        try require(["operator","member"].contains(identity?["role"] as? String ?? ""),"请使用房主账号登录。")
        try require(UUID(uuidString:room) != nil && matches(player,"^p[1-9][0-9]*$"),"无效房间或席位。")
        let binding=try scope(),state=try await owner("/rooms/\(room)/admin"),members=state["members"] as? [JSON] ?? []
        try require(["waiting","active"].contains(state["status"] as? String ?? "") && state["allowHumans"] as? Bool == true,"房间已经结束。")
        var keys=try Vault.load("seats-"+binding) ?? [:]
        _=try await owner("/rooms/\(room)/admin-seat-tokens",["playerId":player]);keys=try Vault.load("seats-"+binding) ?? [:]
        guard let key=keys[room+"/"+player] as? String else { throw ClientFailure("MISSING_SEAT","无法取得房主发放的席位密钥。") };return key
    }
    func openPlayer(_ input: JSON) async throws -> JSON {
        try require(!changingPlayer,"正在切换席位，请稍候。","PLAYER_BUSY");changingPlayer=true;defer { changingPlayer=false }
        let binding=try scope(),generation=epoch
        if let player, input["roomId"] == nil || input["roomId"] as? String == player.config["roomId"] as? String {
            if let supplied=input["seatToken"] as? String { try require(supplied == player.config["playerToken"] as? String,"请使用原席位密钥或先断开当前席位。") };showPlayer?();return ["opened":true]
        }
        if player != nil { await player?.suspendAndWait();player=nil }
        var config=try Vault.load("human-"+binding)
        if let room=input["roomId"] as? String,input["seatToken"] != nil {
            let key=input["seatToken"] as? String ?? "",name=input["name"] as? String ?? "玩家"
            try require(UUID(uuidString:room) != nil && matches(key,"^[A-Za-z0-9_-]{43,128}$") && !name.isEmpty && name.count<=60,"请输入房间ID、名字和房主发放的 seat token。")
            _=try await owner("/lobby/\(room)/join",["name":name,"playerToken":key]);config=["apiUrl":api,"roomId":room,"playerToken":key,"name":name]
        }
        else if let room=(input["roomId"] as? String) ?? (config?["roomId"] as? String) {
            try require(UUID(uuidString:room) != nil,"房间ID无效。")
            let restored=try await owner("/lobby/\(room)/resume",[:]);config=["apiUrl":api,"roomId":room,"playerToken":restored["playerToken"] ?? "","name":restored["name"] ?? "玩家"]
        }
        guard let config else { throw ClientFailure("NO_SEAT","没有可恢复的席位，请从大厅加入房间。") }
        let runtime=try SeatRuntime(config:config);try await runtime.connect()
        try require(generation == epoch,"登录已改变。","CANCELLED")
        try Vault.save("human-"+binding,config);player=runtime;runtime.changed={ [weak self] value in self?.playerChanged?(value);self?.updateScreenAwake() };runtime.start();showPlayer?();return ["opened":true]
    }
    func hostSeat(_ name: String,_ input: JSON) async throws -> Any {
        let binding=try scope()
        if name == "status" {
            let room=input["roomId"] as? String ?? ""
            let live=agents.values.filter{ $0.config["roomId"] as? String == room }.map{ ["playerId":$0.room?["playerId"] as Any? ?? null,"status":["requesting","failed"].contains($0.agentPhase) ? $0.agentPhase:$0.status,"warning":$0.warning as Any? ?? null,"lastActivityAt":$0.lastActivityAt,"requestStartedAt":$0.requestStartedAt as Any? ?? null,"canResume":true] as JSON }
            let saved=try Vault.load("agents-"+binding) ?? [:]
            return live+saved.keys.filter{$0.hasPrefix(room+"/") && agents[$0] == nil}.map{["playerId":String($0.split(separator:"/").last ?? ""),"status":"stopped","warning":restoreWarnings[$0] ?? "可从本设备保存的上下文恢复。","canResume":true] as JSON}
        }
        if name == "modelConfig" { let saved=try Vault.load("model-"+binding) ?? [:];return ["baseUrl":saved["baseUrl"] ?? "https://api.deepseek.com","model":saved["model"] ?? "deepseek-flash","hasApiKey":saved["apiKey"] != nil,"canRememberKey":true] }
        if name == "cancelModelTest" { probe?.cancel();probe=nil;verified.removeAll();return [:] }
        if name == "forgetModel" { probe?.cancel();verified.removeAll();restorationGeneration=UUID();restoring?.cancel();restoring=nil;try Vault.save("model-"+binding,nil);try Vault.save("agents-"+binding,nil);return ["forgotten":true] }
        if name == "testModel" {
            probe?.cancel();verified.removeAll();let generation=epoch
            let url=try Endpoint.base(input["baseUrl"] as? String ?? "",model:true),model=input["model"] as? String ?? "",saved=try Vault.load("model-"+binding)
            let typed=input["apiKey"] as? String ?? "",key = !typed.isEmpty ? typed : saved?["baseUrl"] as? String == url ? saved?["apiKey"] as? String ?? "" : ""
            let agent=try ModelAgent(base:url,key:key,model:model)
            let task=Task { try await agent.test();return agent };probe=task
            let tested=try await task.value;try require(generation == epoch && !task.isCancelled,"测试已取消，请重新测试。","CANCELLED")
            if input["rememberKey"] as? Bool != false { try Vault.save("model-"+binding,["baseUrl":url,"apiKey":key,"model":model]) }
            let remember=input["rememberKey"] as? Bool != false,id=UUID().uuidString;verified[id]=(tested,Date(),epoch,remember);probe=nil;return ["verificationId":id,"keySaved":remember,"ok":true]
        }
        let room=input["roomId"] as? String ?? "",player=input["playerId"] as? String ?? "",id=room+"/"+player
        if name == "key" { return ["seatToken":try await seatKey(room,player)] }
        if name == "start" || name == "resume" {
            guard let proof=verified.removeValue(forKey:input["verificationId"] as? String ?? ""),proof.1.timeIntervalSinceNow > -300,proof.2 == epoch else { throw ClientFailure("MODEL_TEST_REQUIRED","先测试模型连接与连续工具调用，再加入席位。") }
            let saved=try Vault.load("agents-"+binding) ?? [:]
            try require(!starting.contains(id) && (name == "resume" ? agents[id] != nil || saved[id] != nil:agents[id] == nil),"本席没有可恢复上下文，或已有内置Agent。");starting.insert(id);defer { starting.remove(id) };let generation=epoch
            let roomState=try await owner("/rooms/\(room)/admin")
            if name == "start" { try require(roomState["status"] as? String == "waiting" && !(roomState["members"] as? [JSON] ?? []).contains{$0["playerId"] as? String == player},"新 Agent 只能加入空席。") }
            if name == "resume" { await agents[id]?.suspendAndWait();agents.removeValue(forKey:id) }
            let key=try await seatKey(room,player),runtime=try SeatRuntime(config:["apiUrl":api,"roomId":room,"playerToken":key,"name":"AI · \(proof.0.model)"],agent:proof.0)
            try await runtime.connect();try require(generation == epoch,"登录已改变。","CANCELLED")
            if proof.3 { var saved=try Vault.load("agents-"+binding) ?? [:];saved[id]=["seat":runtime.config,"model":proof.0.persistedConfiguration];try Vault.save("agents-"+binding,saved) }
            agents[id]=runtime;restoreWarnings.removeValue(forKey:id);runtime.changed={ [weak self] _ in self?.updateScreenAwake() };runtime.start();return ["started":true]
        }
        throw ClientFailure("UNKNOWN_COMMAND","不支持的房主操作。")
    }
    private func restoreAgents() {
        guard restoring == nil,["operator","member"].contains(identity?["role"] as? String ?? ""),let binding=try? scope(),let saved=try? Vault.load("agents-"+binding),!saved.isEmpty else { return }
        let generation=epoch,restoration=UUID();restorationGeneration=restoration
        restoring=Task { [weak self] in guard let self else { return };defer { if self.restorationGeneration == restoration { self.restoring=nil } }
            for (id,value) in saved where self.agents[id] == nil && !self.starting.contains(id) {
                self.starting.insert(id);defer { self.starting.remove(id) }
                do {
                    try Task.checkCancellation();guard let entry=value as? JSON,let config=entry["seat"] as? JSON,let model=entry["model"] as? JSON,config["apiUrl"] as? String == self.api else { continue }
                    self.restoreWarnings[id]="正在恢复内置 Agent 并重新测试模型连接…"
                    let agent=try ModelAgent(base:model["baseUrl"] as? String ?? "",key:model["apiKey"] as? String ?? "",model:model["model"] as? String ?? "")
                    let runtime=try SeatRuntime(config:config,agent:agent);try await runtime.connect()
                    if runtime.data["sealed"] as? Bool == true { self.restoreWarnings.removeValue(forKey:id);continue }
                    try await agent.test();try Task.checkCancellation();try require(self.epoch == generation && self.restorationGeneration == restoration,"登录已改变。","CANCELLED")
                    self.agents[id]=runtime;self.restoreWarnings.removeValue(forKey:id);runtime.changed={ [weak self] _ in self?.updateScreenAwake() };runtime.start()
                } catch { if Task.isCancelled || self.epoch != generation { return };self.restoreWarnings[id]="内置 Agent 恢复失败："+publicFailure(error).message }
            }
        }
    }
    func foreground(_ active: Bool) {
        foregroundActive=active
        if active { restoreAgents() } else { restorationGeneration=UUID();restoring?.cancel();restoring=nil }
        for runtime in Array(agents.values)+(player.map{[$0]} ?? []) { if active { runtime.start() } else { runtime.suspend() } }
        updateScreenAwake()
    }
}
