# keylink-sdk

Python client for a [Keylink](../../README.md) server. The standard library is enough; there is nothing to install beyond this package.

```bash
pip install -e packages/sdk-python
```

```python
from keylink import Keylink

keylink = Keylink("http://localhost:4780", api_key="kl_live_...")

keylink.upsert_user("user_123", display_name="Ada Lovelace")
session = keylink.create_session("user_123", purpose="enroll")
# Give session["clientToken"] to the browser widget.

status = keylink.get_user("user_123")
result = keylink.verify_code("user_123", "123456")
keylink.consume_session(session["sessionId"])
```

`KeylinkError` carries `status`, `code`, and `message` from the API.
