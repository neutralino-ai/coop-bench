import Foundation

@MainActor final class SeatRuntime {
    let config: JSON, store: SeatFile;let agent: ModelAgent?
    var room: JSON?,rules: JSON?,observation: JSON?,status="disconnected",warning: String?,changed: ((JSON)->Void)?
    var data: JSON, clockOffset: Double=0
    var agentPhase="waiting",lastActivityAt=Date().timeIntervalSince1970*1000,requestStartedAt:Double?
    private var loop: Task<Void,Never>?,decision: Task<Void,Never>?,upload: Task<Void,Never>?
    private var running=UUID(),uploadGeneration=UUID(),actionBusy=false,lastDecision="",agentFailed=false
    var api: String { config["apiUrl"] as! String };var token: String { config["playerToken"] as! String };var roomID: String { config["roomId"] as! String }
    var episode: String? { room?["episodeId"] as? String };var cursor: Int { data["cursor"] as? Int ?? 0 }
    init(config: JSON,agent: ModelAgent? = nil) throws {
        let base=try Endpoint.base(config["apiUrl"] as? String ?? "")
        try require(UUID(uuidString:config["roomId"] as? String ?? "") != nil && matches(config["playerToken"] as? String ?? "","^[A-Za-z0-9_-]{43,128}$"),"保存的席位配置无效，请重新加入房间。")
        self.config=config.merging(["apiUrl":base]){_,new in new};self.agent=agent
        store=try SeatFile(binding:(config["apiUrl"] as? String ?? "")+"\n"+(config["roomId"] as? String ?? "")+"\n"+(config["playerToken"] as? String ?? ""));data=try store.load()
        observation=data["observation"] as? JSON
    }
    func save() throws { try store.save(data) }
    func snapshot() -> JSON {
        var safe=observation;safe?.removeValue(forKey:"decisionToken")
        let displayRules=(rules?["metadata"] as? JSON ?? [:]).merging(rules ?? [:]){_,new in new}
        return ["status":status,"room":room as Any? ?? null,"observation":safe as Any? ?? null,"visibleHistory":data["visibleHistory"] ?? [],"rules":displayRules,"mode":agent == nil ? "human":"model","autoReady":true,"lobbyManaged":true,"canResume":true,"clockOffsetMs":clockOffset,"warning":warning as Any? ?? null,
          "trace":["acknowledgedThrough":(data["traceBase"] as? Int ?? 0)+(data["acked"] as? Int ?? 0)-1,"pendingMessages":(data["messages"] as? [JSON] ?? []).count-(data["acked"] as? Int ?? 0),"sealed":data["sealed"] as? Bool ?? false,"completeness":"partial"]]
    }
    func notify(_ state: String? = nil) { if let state { status=state };lastActivityAt=Date().timeIntervalSince1970*1000;changed?(snapshot()) }
    func request(_ path: String,_ body: JSON? = nil,key: String? = nil,timeout: Double=35) async throws -> JSON { try await HTTP.shared.json(api+path,token:token,body:body,key:key,timeout:timeout) }
    func connect() async throws {
        notify("connecting")
        do { room=try await request("/rooms/"+roomID) } catch {
            guard (error as? ClientFailure)?.status == 401 else { throw error }
            room=try await request("/rooms/\(roomID)/join",["name":config["name"] ?? "玩家","playerToken":token])
        }
        rules=try await request("/games/"+(room?["gameId"] as? String ?? ""));notify("waiting")
    }
    func roomCommand(_ name: String,_ input: JSON = [:]) async throws -> JSON {
        try require(["ready","start","kick","leave","invite"].contains(name),"无效房间操作。")
        let result=try await request("/rooms/\(roomID)/\(name)",input);if name != "invite" { room=result;notify("waiting") };return result
    }
    func ready() async throws { _=try await roomCommand("ready",["ready":true,"rosterVersion":room?["rosterVersion"] ?? 0]) }
    func start() {
        if data["sealed"] as? Bool == true { notify("ended");return }
        guard loop == nil else { return };let generation=UUID();running=generation;agentFailed=false;lastDecision=""
        loop=Task { [weak self] in guard let self else { return };defer { if self.running == generation { self.loop=nil } }
            var failures=0
            while !Task.isCancelled && self.running == generation {
                do {
                    if self.episode == nil { self.room=try await self.request("/rooms/"+self.roomID);self.notify("waiting") }
                    if let episode=self.episode {
                        if self.data["traceBase"] == nil {
                            var after = -1;var more=true
                            while more {
                                let page=try await self.request("/episodes/\(episode)/messages?after=\(after)&limit=500")
                                after=page["nextAfter"] as? Int ?? after;more=page["hasMore"] as? Bool ?? false
                                if page["completion"] is JSON { throw ClientFailure("TRACE_SEALED","本席轨迹已封存，不能继续写入。") }
                            }
                            self.data["traceBase"]=after+1;try self.save()
                        }
                        if self.data["rulesOpened"] as? Bool != true { self.rules=try await self.request("/episodes/\(episode)/rules");self.data["rulesOpened"]=true;self.data["rules"]=self.rules;try self.save() }
                        if self.rules == nil || self.data["rulesOpened"] as? Bool == true { self.rules=self.data["rules"] as? JSON ?? self.rules }
                        if self.data["pendingAction"] != nil && !self.actionBusy { do { _=try await self.sendPending() } catch { if (error as? ClientFailure)?.status != 409 { throw error } } }
                        var more=true
                        while more && !Task.isCancelled {
                            let packet=try await self.request("/episodes/\(episode)/wait?after=\(self.cursor)&timeoutMs=\(self.observation?["hasMore"] as? Bool == true ? 0:25000)")
                            try Task.checkCancellation();try self.accept(packet);more=self.observation?["hasMore"] as? Bool ?? false
                        }
                        self.flushSoon()
                        if self.observation?["status"] as? String != "active" {
                            self.decision?.cancel();await self.decision?.value;self.decision=nil
                            self.data["terminal"]=true;try self.save();self.notify("ended");self.flushSoon();return
                        }
                        self.wakeAgent()
                    } else if let room=self.room {
                        if ["expired","cancelled"].contains(room["status"] as? String ?? "") { self.notify("room-closed");return }
                        let members=room["members"] as? [JSON] ?? [],me=members.first{ $0["playerId"] as? String == room["playerId"] as? String }
                        if members.count == room["playerCount"] as? Int && me?["ready"] as? Bool != true { do { try await self.ready() } catch { if (error as? ClientFailure)?.code != "STALE_ROSTER" { throw error } } }
                    }
                    if failures>0 && !self.agentFailed { self.warning=nil;self.notify() };failures=0
                } catch {
                    if Task.isCancelled { return }
                    let failure=publicFailure(error);self.warning=failure.message
                    if [401,403,404].contains(failure.status ?? 0) || ["TRACE_SEALED","STORAGE_LIMIT"].contains(failure.code) { self.notify("access-denied");return }
                    failures=min(failures+1,5);self.notify("reconnecting")
                }
                let delay=failures>0 ? min(10,pow(2,Double(failures-1))) : self.episode == nil ? 1:0.3
                try? await Task.sleep(nanoseconds:UInt64(delay*1_000_000_000))
            }
        }
    }
    func suspend() { running=UUID();uploadGeneration=UUID();loop?.cancel();loop=nil;decision?.cancel();decision=nil;upload?.cancel();upload=nil;notify("disconnected") }
    func suspendAndWait() async { let pending=[loop,decision,upload];suspend();for task in pending { await task?.value };agentPhase="stopped" }
    private func accept(_ packet: JSON) throws {
        var next=packet["observation"] as? JSON ?? packet
        guard let id=next["observationId"] as? String else { throw ClientFailure("INVALID_RESPONSE","观察响应无效。") }
        let more=packet["hasMore"] as? Bool ?? next["hasMore"] as? Bool ?? false
        let position=packet["nextCursor"] as? Int ?? next["nextCursor"] as? Int ?? next["updateCursor"] as? Int ?? cursor
        try require(position>=0 && (!more || position>cursor),"观察历史分页没有推进。")
        if let serverTime=packet["serverTime"] as? Double { clockOffset=serverTime-Date().timeIntervalSince1970*1000 }
        let updates=next["updates"] as? [JSON] ?? [];try require(updates.allSatisfy{ ($0["seq"] as? Int ?? Int.max)<=position },"观察历史游标不一致。")
        var pending=data["updates"] as? [JSON] ?? [],seen=Set(pending.compactMap{ $0["seq"] as? Int })
        for update in updates { if let seq=update["seq"] as? Int,seen.insert(seq).inserted { pending.append(update) } }
        let previous=data
        var history=data["visibleHistory"] as? [JSON] ?? [],historySeen=Set(history.compactMap{$0["seq"] as? Int})
        for update in updates { if let seq=update["seq"] as? Int,historySeen.insert(seq).inserted { history.append(["seq":seq,"preparedAt":update["preparedAt"] ?? null,"status":update["status"] ?? null,"event":(update["view"] as? JSON)?["lastEvent"] ?? null]) } }
        next["nextCursor"]=position;next["hasMore"]=more;data["cursor"]=max(cursor,position);data["updates"]=pending;data["observation"]=next;data["visibleHistory"]=history
        do {
            if observation?["observationId"] as? String != id || !updates.isEmpty { try record("tool-result",["tool":"wait","observation":next],observationID:id) }
            try save()
        } catch { data=previous;throw error }
        observation=next
        notify(next["status"] as? String != "active" ? "ended" : (next["control"] as? JSON)?["required"] as? Bool == true ? "your-turn":"waiting")
    }
    func act(_ action: JSON,observationID: String) async throws -> JSON {
        try require(!actionBusy,"动作正在提交，请稍候。")
        try require(data["pendingAction"] == nil,"上一个动作结果尚未确认，正在使用原请求重试。","ACTION_PENDING")
        try require(observation?["status"] as? String == "active" && observation?["hasMore"] as? Bool != true,"请等待完整的最新观察。")
        try require(observation?["observationId"] as? String == observationID,"局面已改变，请使用最新观察。","STALE_OBSERVATION")
        if data["pendingAction"] == nil {
            guard let decisionToken=observation?["decisionToken"] as? String else { throw ClientFailure("INVALID_RESPONSE","观察缺少决策令牌。") }
            let key=UUID().uuidString;data["pendingAction"]=["key":key,"command":["observationId":observationID,"decisionToken":decisionToken,"action":action]]
            try record("tool-call",["tool":"act","action":action],observationID:observationID,requestID:key);try save()
        }
        return try await sendPending()
    }
    private func sendPending() async throws -> JSON {
        try require(!actionBusy,"动作正在提交。")
        guard let pending=data["pendingAction"] as? JSON,let command=pending["command"] as? JSON,let key=pending["key"] as? String,let episode else { return [:] }
        actionBusy=true;defer { actionBusy=false };notify("submitting")
        do {
            let response=try await request("/episodes/\(episode)/actions",command,key:key)
            try record("tool-result",response,observationID:command["observationId"] as? String,requestID:key)
            data.removeValue(forKey:"pendingAction");data["lastActionResult"]=["accepted":true];try save()
            // Action receipt is not a history acknowledgement: the next wait drains history.
            notify("waiting");return response
        } catch {
            let failure=publicFailure(error)
            if let status=failure.status,status<500 && status != 429 {
                data.removeValue(forKey:"pendingAction");data["lastActionResult"]=["accepted":false,"error":failure.record]
                try record("tool-result",["accepted":false,"error":failure.record],observationID:command["observationId"] as? String,requestID:key);try save()
            }
            throw error
        }
    }
    func record(_ kind: String,_ raw: Any,observationID: String?=nil,requestID: String?=nil,reasoning: String="not-provided") throws {
        func redact(_ value: Any) -> Any {
            if let dict=value as? JSON { return dict.reduce(into:JSON()){ result,pair in if !["authorization","apikey","token","playertoken","seattoken","invitetoken","decisiontoken","password"].contains(pair.key.lowercased()) { result[pair.key]=redact(pair.value) } } }
            if let array=value as? [Any] { return array.map(redact) };return value
        }
        try require(data["sealed"] as? Bool != true,"本席轨迹已经封存。","TRACE_SEALED")
        let clean=redact(raw),bytes=try canonicalData(clean),logical=UUID().uuidString
        var messages=data["messages"] as? [JSON] ?? []
        var nodes=0
        func fits(_ value: Any,_ depth: Int=0) -> Bool {
            nodes+=1;if depth>24 || nodes>4000 { return false }
            if let dict=value as? JSON { return dict.allSatisfy{!["__proto__","constructor","prototype"].contains($0.key) && fits($0.value,depth+1)} }
            if let array=value as? [Any] { return array.allSatisfy{fits($0,depth+1)} }
            return true
        }
        let inline=bytes.count<=24000 && fits(clean),fragmentBytes=16384
        let count=inline ? 1:max(1,Int(ceil(Double(bytes.count)/Double(fragmentBytes))))
        let capture: JSON=["schema":"coop-agent-capture/v1","logicalId":logical,"serialization":"canonical-json/v1","event":kind,"totalBytes":bytes.count,"sha256":hashBytes(bytes)]
        for index in 0..<count {
            var item: JSON=["sequence":(data["traceBase"] as? Int ?? 0)+messages.count,"messageId":"\(logical):\(index)","kind":kind,"clientAt":ISO8601DateFormatter().string(from:Date()),"reasoningAvailability":reasoning]
            if let observationID { item["observationId"]=observationID };if let requestID { item["requestId"]=requestID }
            if let agent { item["model"]=agent.model;item["provider"]=agent.base }
            let role=kind == "model-input" ? "model-request":kind == "tool-result" ? "tool":"assistant"
            if inline { item["message"]=["role":role,"capture":capture.merging(["encoding":"json"]){_,new in new},"raw":clean] }
            else { item["message"]=["role":role,"capture":capture.merging(["encoding":"base64","fragment":true,"index":index,"count":count]){_,new in new},"dataBase64":bytes.subdata(in:index*fragmentBytes..<min((index+1)*fragmentBytes,bytes.count)).base64EncodedString()] }
            messages.append(item)
        }
        data["messages"]=messages;if ["provided","summary-only"].contains(reasoning) { data["reasoningAvailability"]=reasoning };try save()
    }
    private func flushSoon() {
        guard upload == nil,data["sealed"] as? Bool != true,let episode else { return }
        let generation=UUID();uploadGeneration=generation
        upload=Task { [weak self] in guard let self else { return };defer { if self.uploadGeneration == generation { self.upload=nil } }
            for attempt in 0..<3 { do {
                while !Task.isCancelled {
                    let messages=self.data["messages"] as? [JSON] ?? [],acked=self.data["acked"] as? Int ?? 0
                    if acked>=messages.count {
                        if self.data["terminal"] as? Bool == true {
                            let completion: JSON=["scope":"iOS seat-visible HTTP tools and actual Responses requests/replies. Credentials are excluded.","completeness":"partial","reasoningAvailability":self.data["reasoningAvailability"] ?? "not-provided","unavailable":["Provider hidden reasoning and external-agent internals are not available."]]
                            let receipt=try await self.request("/episodes/\(episode)/messages/complete",completion,timeout:8)
                            try require(receipt["lastSequence"] as? Int == (self.data["traceBase"] as? Int ?? 0)+messages.count-1,"轨迹封存回执不匹配。")
                            self.data["sealed"]=true;try self.save()
                        }
                        return
                    }
                    let receipt=try await self.request("/episodes/\(episode)/messages",messages[acked],timeout:8)
                    try Task.checkCancellation()
                    try require(receipt["sequence"] as? Int == messages[acked]["sequence"] as? Int && receipt["messageId"] as? String == messages[acked]["messageId"] as? String,"轨迹上传回执不匹配，保留原记录。")
                    self.data["acked"]=acked+1;try self.save()
                }
            } catch {
                if Task.isCancelled { return }
                self.warning="轨迹上传待重试，原记录已保留在手机。";self.notify()
                if attempt<2 { try? await Task.sleep(nanoseconds:2_000_000_000) }
            } }
        }
    }
    private func wakeAgent() {
        guard let agent,let observation,decision == nil,!agentFailed,!actionBusy,data["pendingAction"] == nil,observation["hasMore"] as? Bool != true,!(observation["legalActions"] as? [JSON] ?? []).isEmpty,let id=observation["observationId"] as? String,id != lastDecision else { return }
        lastDecision=id;let generation=running
        decision=Task { [weak self] in guard let self else { return };defer { if self.running == generation { self.decision=nil } }
            await self.runDecision(agent,observation:observation,id:id,generation:generation)
        }
    }
    private func runDecision(_ agent: ModelAgent,observation: JSON,id: String,generation: UUID) async {
        agentPhase="requesting";requestStartedAt=Date().timeIntervalSince1970*1000
        defer { if running == generation { agentPhase=agentFailed ? "failed":"waiting";notify() } }
        do {
            notify("thinking")
            var safe=observation;safe.removeValue(forKey:"decisionToken");safe["updates"]=data["updates"] ?? []
            let context: JSON=["protocol":"coop-player/v1","rules":rules ?? [:],"observation":safe,"lastActionResult":data["lastActionResult"] ?? null]
            let control=observation["control"] as? JSON ?? [:]
            let deadlines:[Double]=[control["deadlineAt"],control["episodeDeadlineAt"]].compactMap{ $0 as? Double }
            let now=Date().timeIntervalSince1970*1000+clockOffset
            let timeoutAt=deadlines.min() ?? (now+180000)
            let remaining: Double=min(120,(timeoutAt-now)/1000)
            let answer=try await agent.decide(context,runtime:self,timeout:max(0.1,remaining))
            try Task.checkCancellation();try require(running == generation,"运行已暂停。","CANCELLED")
            if let action=answer["action"] as? JSON { _=try await act(action,observationID:id) }
        } catch {
            if !Task.isCancelled {
                let failure=publicFailure(error);warning=failure.message
                if data["pendingAction"] == nil && !["STALE_OBSERVATION","STALE_DECISION"].contains(failure.code) { agentFailed=true;warning="内置 Agent 已停止：\(failure.message) 超时将由服务器执行默认动作。" }
                notify("waiting")
            }
        }
    }
}
