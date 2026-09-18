#!/usr/bin/env python3
"""One-seat local API example. Python 3.9+, standard library only.

The caller supplies one player's credential. This program never reads the
coordinator's connection.json, creates games, or reads other seats/audits.
"""

import argparse
import json
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler


def api_base(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("Use a local HTTP URL, e.g. http://127.0.0.1:8788/api/v1")
    return value.rstrip("/")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class PlayerClient:
    """A reusable client restricted to a single episode and seat credential."""

    def __init__(self, base_url, episode_id, seat_token, timeout=10):
        self.base_url = base_url.rstrip("/")
        self.episode_id = quote(episode_id, safe="")
        self.seat_token = seat_token
        self.timeout = timeout
        self.latest = None
        # A local connection should not go through an environment HTTP proxy.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def _request(self, path, *, authenticated=True, payload=None, request_id=None):
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.seat_token
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if request_id:
            headers["Idempotency-Key"] = request_id
        # payload is already encoded. Every retry sends precisely the same bytes.
        request = Request(self.base_url + path, data=payload, headers=headers,
                          method="POST" if payload is not None else "GET")
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")
                if error.code >= 500 and attempt < 2:
                    time.sleep(0.25 * (attempt + 1))
                    continue
                raise RuntimeError("HTTP {}: {}".format(error.code, detail)) from error
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise
                time.sleep(0.25 * (attempt + 1))
        raise AssertionError("unreachable")

    def read_rules(self, game_id):
        return self._request("/games/" + quote(game_id, safe=""), authenticated=False)

    def observe(self):
        cursor = self.latest.get("updateCursor", 0) if self.latest else 0
        self.latest = self._request("/episodes/{}/observation?after={}".format(self.episode_id, cursor))
        return self.latest

    def prepare(self, action):
        if self.latest is None:
            raise RuntimeError("Call observe() before prepare().")
        if not isinstance(action, dict):
            raise ValueError("The action must be a JSON object.")
        command = {"observationId": self.latest["observationId"],
                   "decisionToken": self.latest["decisionToken"], "action": action}
        return {"requestId": str(uuid.uuid4()),
                "payload": json.dumps(command, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                "decisionToken": command["decisionToken"]}

    def submit(self, prepared):
        """On an uncertain network result, reuse prepared; do not call prepare again."""
        result = self._request("/episodes/{}/actions".format(self.episode_id),
                               payload=prepared["payload"], request_id=prepared["requestId"])
        # An old idempotent receipt must not rewind a newer observation.
        if "observation" in result and (self.latest is None or
                self.latest["decisionToken"] == prepared["decisionToken"]):
            self.latest = result["observation"]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", type=api_base, default="http://127.0.0.1:8788/api/v1")
    parser.add_argument("--episode-id", required=True)
    parser.add_argument("--seat-token", required=True, help="Only this player's token; never the coordinator token")
    parser.add_argument("--game-id", help="Optionally read this game's rules before observing")
    parser.add_argument("--action", help="Optional JSON action, following the current legalActions schema")
    args = parser.parse_args()
    client = PlayerClient(args.base_url, args.episode_id, args.seat_token)
    if args.game_id:
        print(json.dumps({"rules": client.read_rules(args.game_id)}, ensure_ascii=False))
    print(json.dumps({"observation": client.observe()}, ensure_ascii=False))
    if args.action:
        # Prepare exactly once. The HTTP helper retries this same command/key.
        prepared = client.prepare(json.loads(args.action))
        print(json.dumps({"result": client.submit(prepared)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, URLError, TimeoutError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
