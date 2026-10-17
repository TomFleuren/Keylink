import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from keylink import Keylink, KeylinkError


class Handler(BaseHTTPRequestHandler):
    def do_PUT(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        body = json.loads(raw)
        assert self.headers["Authorization"] == "Bearer kl_live_test"
        assert body["displayName"] == "Ada"
        payload = {
            "id": "user_1",
            "externalId": "ada",
            "displayName": "Ada",
            "enrolled": False,
            "lockedUntil": None,
            "failedAttempts": 0,
            "factors": [],
            "backupCodesRemaining": 0,
        }
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        payload = {"error": {"code": "invalid_code", "message": "That code was not accepted."}}
        data = json.dumps(payload).encode("utf-8")
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: object) -> None:
        return


class ClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address[:2]
        self.client = Keylink(f"http://{host}:{port}", "kl_live_test")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_upsert_user(self) -> None:
        user = self.client.upsert_user("ada", display_name="Ada")
        self.assertFalse(user["enrolled"])
        self.assertEqual(user["externalId"], "ada")

    def test_verify_error(self) -> None:
        with self.assertRaises(KeylinkError) as caught:
            self.client.verify_code("ada", "000000")
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(caught.exception.code, "invalid_code")


if __name__ == "__main__":
    unittest.main()
