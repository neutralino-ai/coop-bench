import Foundation

@MainActor final class ModelAgent {
    let base: String,model: String;private let key: String
    var persistedConfiguration: JSON { ["baseUrl":base,"model":model,"apiKey":key] }
    init(base: String,key: String,model: String) throws {
        self.base=try Endpoint.base(base,model:true)
        try require(!key.isEmpty && key.utf8.count<=4096 && !model.isEmpty && model.count<=200 && base.count<=200,"请输入模型地址、模型名称和 API key（地址与模型名称不超过200字符）。")
        self.key=key;self.model=model
    }
    private func complete(_ input: [JSON],tools: [JSON],deadline: Date,runtime: SeatRuntime?=nil,id: String?=nil,probe: Bool=false) async throws -> JSON {
        var body: JSON=["model":model,"input":input,"tools":tools,"store":false];if probe { body["max_output_tokens"]=4096 }
        for attempt in 0..<2 {
            try Task.checkCancellation();try require(deadline.timeIntervalSinceNow>0,"模型未在截止时间前完成。","MODEL_TIMEOUT")
            try runtime?.record("model-input",body,observationID:id)
            if let runtime { runtime.data["updates"]=[];try runtime.save() }
            do {
                let (bytes,response)=try await HTTP.shared.raw(base+"/responses",token:key,body:body,timeout:min(60,deadline.timeIntervalSinceNow))
                let parsed=try? JSONSerialization.jsonObject(with:bytes),raw=parsed as? JSON
                let output=raw?["output"] as? [JSON] ?? []
                let reasoning=output.contains{ item in (item["content"] as? [JSON] ?? []).contains{ $0["type"] as? String == "reasoning_text" } }
                let summary=output.contains{ $0["type"] as? String == "reasoning" && !(($0["summary"] as? [Any] ?? []).isEmpty) }
                try runtime?.record("model-output",raw ?? ["httpStatus":response.statusCode,"bodyText":String(decoding:bytes,as:UTF8.self)],observationID:id,reasoning:reasoning ? "provided":summary ? "summary-only":"not-provided")
                try require((200..<300).contains(response.statusCode),"模型接口返回 HTTP \(response.statusCode)，请检查地址、密钥、模型和额度。","MODEL_HTTP_\(response.statusCode)")
                guard let raw else { throw ClientFailure("MODEL_FORMAT","模型接口未返回有效 JSON。") }
                try require(raw["status"] as? String == "completed","模型未完成响应，可能达到输出限制。","MODEL_INCOMPLETE")
                return raw
            } catch {
                let failure=publicFailure(error)
                try runtime?.record("tool-result",["source":"model-api","outcome":"request-failed","error":failure.record],observationID:id)
                if attempt == 0 && !Task.isCancelled && (failure.code == "CONNECTION_ERROR" || failure.code == "TIMEOUT" || matches(failure.code,"^MODEL_HTTP_(429|5[0-9][0-9])$")) {
                    try await Task.sleep(nanoseconds:500_000_000);continue
                }
                throw failure
            }
        }
        throw ClientFailure("MODEL_FAILED","模型请求失败。")
    }
    private func calls(_ raw: JSON) -> [JSON] { (raw["output"] as? [JSON] ?? []).filter{ $0["type"] as? String == "function_call" } }
    private func receipt(_ call: JSON,_ value: Any) throws -> JSON { ["type":"function_call_output","call_id":call["call_id"] ?? "","output":try jsonString(value)] }
    func test() async throws {
        let nonce=UUID().uuidString,deadline=Date().addingTimeInterval(60)
        let tool: JSON=["type":"function","name":"connection_check","description":"Return the supplied nonce.","parameters":["type":"object","properties":["nonce":["type":"string","enum":[nonce]]],"required":["nonce"],"additionalProperties":false]]
        var history: [JSON]=[["role":"user","content":"Connectivity test only. Call connection_check exactly once with nonce \(nonce)."]]
        for _ in 0..<2 {
            let response=try await complete(history,tools:[tool],deadline:deadline,probe:true),functions=calls(response)
            guard functions.count == 1,let call=functions.first,call["name"] as? String == "connection_check",call["call_id"] is String,let args=call["arguments"] as? String,let bytes=args.data(using:.utf8),let parameters=(try? JSONSerialization.jsonObject(with:bytes)) as? JSON,parameters["nonce"] as? String == nonce else { throw ClientFailure("MODEL_TOOL_FORMAT","模型未正确执行工具调用，请检查模型兼容性。") }
            history += response["output"] as? [JSON] ?? [];history.append(try receipt(call,["ok":true]));history.append(["role":"user","content":"Receipt received. Verify one more call with the same nonce \(nonce)."])
        }
    }
    func decide(_ context: JSON,runtime: SeatRuntime,timeout: Double) async throws -> JSON {
        let deadline=Date().addingTimeInterval(timeout),id=(context["observation"] as? JSON)?["observationId"] as? String
        var history=runtime.data["modelHistory"] as? [JSON] ?? [["role":"system","content":"You are one Coop Bench player. Use only the supplied service API rules, your own observation and legalActions. Read every visible update. Never use external rules, hidden information, or side-channel communication. Call exactly one act with a legal JSON action, or wait only when strategic waiting is legal. New rooms default to 3 minutes: obey the actual control.deadlineAt and control.decisionTimeoutSeconds. Waiting does not extend deadlines. With default-action-v1 the server executes control.timeoutAction on timeout and continues. Hanabi discards the first card when legal, otherwise uses a legal hint. Refresh observation after timeout; never replay stale actions. Official clocks and episode limits still apply."]]
        if let pending=runtime.data["modelPending"] as? [JSON] {
            for call in pending { history.append(try receipt(call,call["name"] as? String == "wait" ? ["waiting":true] : runtime.data["lastActionResult"] ?? ["accepted":false])) }
            runtime.data.removeValue(forKey:"modelPending")
        }
        history.append(["role":"user","content":try jsonString(context)])
        let tools: [JSON]=[["type":"function","name":"act","description":"Submit one legal action. actionJson contains its entire JSON object.","parameters":["type":"object","properties":["actionJson":["type":"string"]],"required":["actionJson"],"additionalProperties":false]],
                          ["type":"function","name":"wait","description":"Wait only when strategic waiting is legal.","parameters":["type":"object","properties":[:],"additionalProperties":false]]]
        for _ in 0..<2 {
            runtime.data["modelHistory"]=history;try runtime.save()
            let response=try await complete(history,tools:tools,deadline:deadline,runtime:runtime,id:id),functions=calls(response)
            history += response["output"] as? [JSON] ?? [];runtime.data["modelHistory"]=history
            var answer: JSON?
            if functions.count == 1,let call=functions.first,call["call_id"] is String {
                if call["name"] as? String == "wait",((context["observation"] as? JSON)?["control"] as? JSON)?["required"] as? Bool != true { answer=["wait":true] }
                else if call["name"] as? String == "act",let text=call["arguments"] as? String,let args=(try? JSONSerialization.jsonObject(with:Data(text.utf8))) as? JSON,let actionText=args["actionJson"] as? String,let action=(try? JSONSerialization.jsonObject(with:Data(actionText.utf8))) as? JSON,action["type"] is String { answer=["action":action] }
            }
            if let answer { runtime.data["modelPending"]=functions;try runtime.save();return answer }
            for call in functions { history.append(try receipt(call,["accepted":false,"error":"Call exactly one legal act; wait is not allowed when required."])) }
            history.append(["role":"user","content":"Return one valid tool call from the provided legal actions. There is no deadline extension."])
            runtime.data["modelHistory"]=history;try runtime.save()
        }
        throw ClientFailure("MODEL_TOOL_FORMAT","模型连续未给出有效动作。")
    }
}
