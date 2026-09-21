import XCTest
@testable import CoopBench

final class BoundaryTests: XCTestCase {
    func testOriginAndOwnerRoutes() throws {
        XCTAssertEqual(try Endpoint.base("https://example.test/"),"https://example.test/api/v1")
        for url in ["http://example.test", "https://user:password@example.test", "https://example.test/?key=secret", "https://example.test/other"] {
            XCTAssertThrowsError(try Endpoint.base(url))
        }
        for path in ["/api/v1/auth/password", "/api/v1/episodes/game/actions", "/api/v1/rooms/a/../identity", "//elsewhere/", "/api/v1/rooms/%2e%2e/identity"] {
            XCTAssertThrowsError(try Endpoint.path(path,method:"POST",owner:true))
        }
        XCTAssertEqual(try Endpoint.path("/api/v1/rollouts?limit=20",method:"GET",owner:true),"/api/v1/rollouts?limit=20")
    }
    func testKeychainAndSeatStorageBindings() throws {
        let id="unit-"+UUID().uuidString
        defer { try? Vault.save(id,nil) }
        try Vault.save(id,["apiKey":"synthetic-key"])
        XCTAssertEqual(try Vault.load(id)?["apiKey"] as? String,"synthetic-key")
        XCTAssertNil(try Vault.load(id+"-other-account"))
        let a=try SeatFile(binding:id+"/p1"),b=try SeatFile(binding:id+"/p2")
        try a.save(["cursor":42,"pendingAction":["key":"unchanged-idempotency-key"]])
        XCTAssertEqual(try a.load()["cursor"] as? Int,42)
        XCTAssertNil(try b.load()["cursor"])
    }
}
