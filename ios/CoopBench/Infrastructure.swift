import Foundation
import Security
import CryptoKit
import JavaScriptCore

typealias JSON = [String: Any]
let apiDefault = "https://coop.neutrinophysics.cn:34936/api/v1"
let null = NSNull()
func jsonData(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]) }
func jsonString(_ value: Any) throws -> String { String(decoding: try jsonData(value), as: UTF8.self) }
func hashID(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
func hashBytes(_ value: Data) -> String { SHA256.hash(data:value).map { String(format:"%02x",$0) }.joined() }
// Use the same JSON number/string/key ordering as the existing JS recorder.
// This isolated context evaluates a fixed function, never provider-supplied code.
func canonicalData(_ value: Any) throws -> Data {
    guard let context=JSContext() else { throw ClientFailure("CAPTURE_ERROR","无法序列化原始记录。") }
    context.setObject(try jsonString(value),forKeyedSubscript:"captureJSON" as NSString)
    let script="const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);canonical(JSON.parse(captureJSON));"
    guard let text=context.evaluateScript(script)?.toString(),context.exception == nil else { throw ClientFailure("CAPTURE_ERROR","无法序列化原始记录。") }
    return Data(text.utf8)
}
func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
func require(_ condition: Bool, _ message: String, _ code: String = "INVALID_REQUEST") throws { if !condition { throw ClientFailure(code, message) } }
struct ClientFailure: Error {
    let code: String; let message: String; let status: Int?
    init(_ code: String, _ message: String, _ status: Int? = nil) { self.code=code; self.message=message; self.status=status }
    var record: JSON { var result: JSON = ["code":code,"message":message]; if let status { result["status"]=status }; return result }
}
func publicFailure(_ error: Error) -> ClientFailure {
    if let error=error as? ClientFailure { return error }
    if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return ClientFailure("CANCELLED","操作已取消，请重新读取当前状态。") }
    if (error as NSError).code == NSURLErrorTimedOut { return ClientFailure("TIMEOUT","连接超时，请检查服务器地址和网络。") }
    return ClientFailure("CONNECTION_ERROR","无法完成连接或保存数据，请检查网络和本机存储。")
}
enum Endpoint {
    static func base(_ value: String, model: Bool = false) throws -> String {
        guard var u=URLComponents(string:value), let host=u.host, !host.isEmpty else { throw ClientFailure("INVALID_URL","请输入有效的 HTTPS 地址。") }
        var permitted=u.scheme == "https"
        #if DEBUG && targetEnvironment(simulator)
        permitted = permitted || (u.scheme == "http" && ["127.0.0.1","localhost","::1"].contains(host))
        #endif
        try require(permitted && u.user == nil && u.password == nil && u.query == nil && u.fragment == nil && !value.contains("\\"),"服务地址必须为 HTTPS，不包含凭证、查询参数或片段。")
        if !model { try require(["","/","/api/v1","/api/v1/"].contains(u.path),"API 路径应为 /api/v1。"); u.path="/api/v1" }
        return u.string!.trimmingCharacters(in: CharacterSet(charactersIn:"/"))
    }
    static func path(_ value: String, method: String, owner: Bool) throws -> String {
        let path=String(value.split(separator:"?",maxSplits:1).first ?? "")
        try require(value.count<4096 && !value.contains("#") && !matches(value,"[\\x00-\\x20\\x7f]") && !matches(path,"[\\\\%]") && !path.contains("..") && !path.contains("//"),"API 路径无效。")
        try require(["GET","POST"].contains(method),"不支持的请求方法。")
        if owner {
            let id="[A-Za-z0-9_-]+"
            let get="^/api/v1/(health|identity|lobby|games(?:/\(id))?|rooms(?:/\(id)/admin)?|rollouts(?:/\(id)(?:/(?:observations|messages|artifacts(?:/\(id)/content)?))?)?|episodes/\(id)/(?:replay|training|audit))$"
            let post="^/api/v1/(lobby/\(id)/join|rooms|rooms/\(id)/admin-(?:start|kick|invite|seat-tokens)|episodes|episodes/\(id)/truncate|rollouts/\(id)/annotations)$"
            try require(matches(path,method == "GET" ? get : post),"此接口不属于大厅权限。")
        } else { try require(path.hasPrefix("/api/v1/"),"只能请求游戏 API。") }
        return value
    }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class HTTP: @unchecked Sendable {
    static let shared=HTTP()
    private let session: URLSession
    init() { let config=URLSessionConfiguration.ephemeral; config.httpCookieStorage=nil; config.urlCredentialStorage=nil; config.urlCache=nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData; session=URLSession(configuration:config,delegate:NoRedirect(),delegateQueue:nil) }
    func raw(_ url: String, token: String = "", body: JSON? = nil, method: String? = nil, key: String? = nil, timeout: Double = 35) async throws -> (Data,HTTPURLResponse) {
        guard let target=URL(string:url) else { throw ClientFailure("INVALID_URL","无效地址。") }
        var request=URLRequest(url:target);request.httpMethod=method ?? (body == nil ? "GET":"POST");request.timeoutInterval=timeout
        if !token.isEmpty { request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization") }
        if let body { request.httpBody=try jsonData(body);request.setValue("application/json",forHTTPHeaderField:"Content-Type") }
        if let key { request.setValue(key,forHTTPHeaderField:"Idempotency-Key") }
        let (bytes,response)=try await withThrowingTaskGroup(of:(Data,URLResponse).self) { group in
            group.addTask { try await self.session.data(for:request) }
            group.addTask {
                try await Task.sleep(nanoseconds:UInt64(max(0.001,timeout)*1_000_000_000))
                throw ClientFailure("TIMEOUT","请求超过截止时间。")
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
        try require(bytes.count<=64*1024*1024,"响应过大，已拒绝读取。","RESPONSE_TOO_LARGE")
        guard let response=response as? HTTPURLResponse else { throw ClientFailure("INVALID_RESPONSE","服务器返回格式不正确。") }
        try require(!(300..<400).contains(response.statusCode),"服务器返回了重定向，凭证未转发。","REDIRECT_REJECTED")
        return (bytes,response)
    }
    func json(_ url: String, token: String = "", body: JSON? = nil, key: String? = nil, timeout: Double = 35) async throws -> JSON {
        let (bytes,response)=try await raw(url,token:token,body:body,key:key,timeout:timeout)
        guard let value=(try? JSONSerialization.jsonObject(with:bytes)) as? JSON else { throw ClientFailure("INVALID_RESPONSE","未收到有效 JSON 响应。",response.statusCode) }
        guard (200..<300).contains(response.statusCode) else {
            let code=(value["error"] as? JSON)?["code"] as? String ?? "HTTP_\(response.statusCode)"
            let labels=["INVALID_SEAT_TOKEN":"Seat token 无效或已被房主重新发放。","STALE_ROSTER":"成员已变化，请重新读取房间。","STALE_OBSERVATION":"局面已变化，请根据最新观察操作。","NOT_READY":"等待所有玩家入席并准备。","ROOM_FULL":"房间已满。","ROOM_CLOSED":"房间已开始或已过期。","BUILD_MISMATCH":"房间属于旧版服务，请创建新房间。"]
            throw ClientFailure(code,labels[code] ?? (response.statusCode == 401 ? "凭证或密码无效，请重新登录。":"服务拒绝请求（HTTP \(response.statusCode)，\(code)）。"),response.statusCode)
        }
        return value
    }
}
enum Vault {
    static let service="org.coopbench.ios"
    static func load(_ key: String) throws -> JSON? {
        let query: JSON=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var value: CFTypeRef?;let status=SecItemCopyMatching(query as CFDictionary,&value)
        if status == errSecItemNotFound { return nil }
        try require(status == errSecSuccess,"钥匙串暂不可用，请解锁手机（\(status)）。","KEYCHAIN")
        return try JSONSerialization.jsonObject(with:value as! Data) as? JSON
    }
    static func save(_ key: String, _ value: JSON?) throws {
        let query: JSON=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        if let value {
            let data=try jsonData(value),changes: JSON=[kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            var status=SecItemUpdate(query as CFDictionary,changes as CFDictionary)
            if status == errSecItemNotFound { status=SecItemAdd(query.merging(changes){_,b in b} as CFDictionary,nil) }
            try require(status == errSecSuccess,"无法安全保存凭证（\(status)）。","KEYCHAIN")
        } else { let status=SecItemDelete(query as CFDictionary);try require(status == errSecSuccess || status == errSecItemNotFound,"无法清除钥匙串凭证（\(status)）。","KEYCHAIN") }
    }
}
final class SeatFile {
    let url: URL
    init(binding: String) throws {
        var directory=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("Seats",isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        var resource=URLResourceValues();resource.isExcludedFromBackup=true;try directory.setResourceValues(resource)
        url=directory.appendingPathComponent(hashID(binding)+".json")
    }
    func load() throws -> JSON { if !FileManager.default.fileExists(atPath:url.path) { return [:] };let bytes=try Data(contentsOf:url);try require(bytes.count<=64*1024*1024,"本席记录达到本地容量限制，保留记录并停止新增。","STORAGE_LIMIT");return try JSONSerialization.jsonObject(with:bytes) as? JSON ?? [:] }
    func save(_ value: JSON) throws { let bytes=try jsonData(value);try require(bytes.count<=64*1024*1024,"本席记录达到本地容量限制，保留记录并停止新增。","STORAGE_LIMIT");try bytes.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) }
}
