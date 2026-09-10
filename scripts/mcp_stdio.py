#!/usr/bin/env python3
"""Optional dependency-free stdio bridge. No shell execution; no credentials required to discover/join."""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="DASN HTTPS MCP endpoint (loopback HTTP allowed locally)")
    args = parser.parse_args()
    parsed = urllib.parse.urlparse(args.url)
    if parsed.username or parsed.password or parsed.fragment or parsed.query:
        parser.error("Use an endpoint URL without credentials, query, or fragment")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")):
        parser.error("Use HTTPS, or loopback HTTP for local testing")
    # No proxy credentials and no forwarding to redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    while True:
        line = sys.stdin.buffer.readline(40002)
        if not line:
            break
        if len(line) > 40000:
            print("MCP message too large", file=sys.stderr)
            return 1
        message = None
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("MCP message must be an object")
            params = message.get("params", {})
            version = params.get("_meta", {}).get("io.modelcontextprotocol/protocolVersion", "2025-11-25")
            headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": version, "Mcp-Method": message.get("method", ""), "User-Agent": "DASN/0.2.0 stdio-bridge"}
            if "name" in params:
                headers["Mcp-Name"] = params["name"]
            request = urllib.request.Request(args.url, data=line, headers=headers, method="POST")
            try:
                with opener.open(request, timeout=30) as response:
                    data = response.read(2_000_001)
            except urllib.error.HTTPError as error:
                data = error.read(2_000_001)
            if data and "id" in message:
                decoded = json.loads(data)
                if decoded.get("jsonrpc") != "2.0":
                    raise ValueError("Endpoint returned an HTTP error")
                print(json.dumps(decoded, separators=(",", ":")), flush=True)
        except Exception:
            if isinstance(message, dict) and "id" in message:
                print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": "DASN connection failed. Check the endpoint and retry with the same idempotency key."}}), flush=True)
            else:
                print("Invalid MCP notification or connection failure", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
