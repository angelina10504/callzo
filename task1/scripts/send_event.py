import argparse
import hmac
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a signed Callzo webhook")
    parser.add_argument("payload", type=Path, help="File containing the exact request bytes")
    parser.add_argument("--url", default="http://127.0.0.1:8000/webhooks/calls")
    parser.add_argument("--signature", choices=("valid", "wrong", "missing"), default="valid")
    args = parser.parse_args()

    body = args.payload.read_bytes()
    headers = {"Content-Type": "application/json"}
    if args.signature == "valid":
        secret = os.environ.get("WEBHOOK_SECRET", "")
        if not secret.strip():
            parser.error("Set WEBHOOK_SECRET in the environment")
        headers["X-Signature"] = hmac.digest(secret.encode("utf-8"), body, "sha256").hex()
    elif args.signature == "wrong":
        headers["X-Signature"] = "0" * 64

    request = Request(args.url, data=body, headers=headers, method="POST")
    try:
        response = urlopen(request, timeout=10)
    except HTTPError as error:
        response = error  # HTTP errors also provide a status and response body.
    except URLError as error:
        parser.exit(1, f"Request failed: {error.reason}\n")
    with response:
        print(f"HTTP {response.status}")
        print(response.read().decode("utf-8"))


if __name__ == "__main__":
    main()
