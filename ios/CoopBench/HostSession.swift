import Foundation
import UIKit

@MainActor final class HostSession {
    var api=apiDefault, token="", identity: JSON?; var remembered=false; var epoch=UUID()
    var player: SeatRuntime?; var agents: [String:SeatRuntime]=[:]
    var showPlayer: (()->Void)?; var playerChanged: ((JSON)->Void)?
    private var verified: [String:(ModelAgent,Date,UUID)]=[:], starting=Set<String>()
    private var probe: Task<ModelAgent,Error>?
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
        epoch=UUID();probe?.cancel();probe=nil;verified.removeAll();starting.removeAll()
        player?.suspend();player=nil;for agent in agents.values { agent.suspend() };agents.removeAll();identity=nil;token="";remembered=false
    }
    private func accept(_ id: JSON,key: String,remember: Bool) throws {
        try require(id["id"] is String && ["operator","coordinator","auditor"].contains(id["role"] as? String ?? ""),"身份验证响应格式不正确。")
        if remember { try Vault.save("connection",["apiUrl":api,"token":key]) } else { try Vault.save("connection",nil) }
        token=key;identity=id;remembered=remember
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
        let origin=String(api.dropLast("/api/v1".count)),(bytes,response)=try await HTTP.shared.raw(origin+path,token:token,body:body,method:method)
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
        let result=try await HTTP.shared.json(api+path,token:token,body:body)
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
        }
    }
    func seatKey(_ room: String,_ player: String) async throws -> String {
        try require(identity?["role"] as? String == "operator","请使用房主账号登录。")
        try require(UUID(uuidString:room) != nil && matches(player,"^p[1-9][0-9]*$"),"无效房间或席位。")
        let binding=try scope(),state=try await owner("/rooms/\(room)/admin"),members=state["members"] as? [JSON] ?? []
        try require(state["status"] as? String == "waiting" && state["allowHumans"] as? Bool == true && !members.contains{ $0["playerId"] as? String == player },"席位已有人加入，或房间已经开始。")
        var keys=try Vault.load("seats-"+binding) ?? [:]
        if keys[room+"/"+player] == nil { _=try await owner("/rooms/\(room)/admin-seat-tokens",["playerId":player]);keys=try Vault.load("seats-"+binding) ?? [:] }
        guard let key=keys[room+"/"+player] as? String else { throw ClientFailure("MISSING_SEAT","无法取得房主发放的席位密钥。") };return key
    }
    func openPlayer(_ input: JSON) async throws -> JSON {
        let binding=try scope(),generation=epoch
        if let player, input["roomId"] == nil || input["roomId"] as? String == player.config["roomId"] as? String {
            if let supplied=input["seatToken"] as? String { try require(supplied == player.config["playerToken"] as? String,"请使用原席位密钥或先断开当前席位。") };showPlayer?();return ["opened":true]
        }
        try require(player == nil,"请先在玩家页面断开当前席位。")
        var config=try Vault.load("human-"+binding)
        if let room=input["roomId"] as? String {
            let key=input["seatToken"] as? String ?? "",name=input["name"] as? String ?? "玩家"
            try require(UUID(uuidString:room) != nil && matches(key,"^[A-Za-z0-9_-]{43,128}$") && !name.isEmpty && name.count<=60,"请输入房间ID、名字和房主发放的 seat token。")
            _=try await owner("/lobby/\(room)/join",["name":name,"playerToken":key]);config=["apiUrl":api,"roomId":room,"playerToken":key,"name":name]
        }
        guard let config else { throw ClientFailure("NO_SEAT","没有可恢复的席位，请从大厅加入房间。") }
        let runtime=try SeatRuntime(config:config);try await runtime.connect()
        try require(generation == epoch,"登录已改变。","CANCELLED")
        try Vault.save("human-"+binding,config);player=runtime;runtime.changed={ [weak self] value in self?.playerChanged?(value) };runtime.start();showPlayer?();return ["opened":true]
    }
    func hostSeat(_ name: String,_ input: JSON) async throws -> Any {
        let binding=try scope()
        if name == "status" { return agents.values.filter{ $0.config["roomId"] as? String == input["roomId"] as? String }.map{ ["playerId":$0.room?["playerId"] as Any? ?? null,"status":$0.status,"warning":$0.warning as Any? ?? null] as JSON } }
        if name == "modelConfig" { let saved=try Vault.load("model-"+binding) ?? [:];return ["baseUrl":saved["baseUrl"] ?? "https://api.deepseek.com","model":saved["model"] ?? "deepseek-flash","hasApiKey":saved["apiKey"] != nil,"canRememberKey":true] }
        if name == "cancelModelTest" { probe?.cancel();probe=nil;verified.removeAll();return [:] }
        if name == "forgetModel" { probe?.cancel();verified.removeAll();try Vault.save("model-"+binding,nil);return ["forgotten":true] }
        if name == "testModel" {
            probe?.cancel();verified.removeAll();let generation=epoch
            let url=try Endpoint.base(input["baseUrl"] as? String ?? "",model:true),model=input["model"] as? String ?? "",saved=try Vault.load("model-"+binding)
            let typed=input["apiKey"] as? String ?? "",key = !typed.isEmpty ? typed : saved?["baseUrl"] as? String == url ? saved?["apiKey"] as? String ?? "" : ""
            let agent=try ModelAgent(base:url,key:key,model:model)
            let task=Task { try await agent.test();return agent };probe=task
            let tested=try await task.value;try require(generation == epoch && !task.isCancelled,"测试已取消，请重新测试。","CANCELLED")
            if input["rememberKey"] as? Bool != false { try Vault.save("model-"+binding,["baseUrl":url,"apiKey":key,"model":model]) }
            let id=UUID().uuidString;verified[id]=(tested,Date(),epoch);probe=nil;return ["verificationId":id,"keySaved":input["rememberKey"] as? Bool != false,"ok":true]
        }
        let room=input["roomId"] as? String ?? "",player=input["playerId"] as? String ?? "",id=room+"/"+player
        if name == "key" { return ["seatToken":try await seatKey(room,player)] }
        if name == "start" {
            guard let proof=verified.removeValue(forKey:input["verificationId"] as? String ?? ""),proof.1.timeIntervalSinceNow > -300,proof.2 == epoch else { throw ClientFailure("MODEL_TEST_REQUIRED","先测试模型连接与连续工具调用，再加入席位。") }
            try require(agents[id] == nil && !starting.contains(id),"本席已有内置Agent。");starting.insert(id);defer { starting.remove(id) };let generation=epoch
            let key=try await seatKey(room,player),runtime=try SeatRuntime(config:["apiUrl":api,"roomId":room,"playerToken":key,"name":"AI · \(proof.0.model)"],agent:proof.0)
            try await runtime.connect();try require(generation == epoch,"登录已改变。","CANCELLED");agents[id]=runtime;runtime.start();return ["started":true]
        }
        throw ClientFailure("UNKNOWN_COMMAND","不支持的房主操作。")
    }
    func foreground(_ active: Bool) { for runtime in Array(agents.values)+(player.map{[$0]} ?? []) { if active { runtime.start() } else { runtime.suspend() } } }
}
