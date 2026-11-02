"""Minimal external Google OIDC edge used only by the black-box proof."""

from __future__ import annotations

import base64
import os
import secrets
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from flask import Flask, jsonify, make_response, redirect, request


app = Flask(__name__)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
rogue_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
codes: dict[str, dict] = {}
issuer = os.environ.get("PROOF_GOOGLE_ISSUER", "http://fake-google:9000")
client_id = os.environ.get("PROOF_GOOGLE_CLIENT_ID", "proof-client")
client_secret = os.environ.get("PROOF_GOOGLE_CLIENT_SECRET", "proof-secret-canary")


PERSONAS = {
    "user": ("proof-user", "user@example.com", "Registry User", "example.com"),
    "contributor": (
        "proof-contributor",
        "contributor@example.com",
        "Registry Contributor",
        "example.com",
    ),
    "admin": ("proof-admin", "admin@example.com", "Registry Administrator", "example.com"),
    "outsider": ("proof-outsider", "person@outside.example", "Outside User", "outside.example"),
    "unverified": ("proof-unverified", "unverified@example.com", "Unverified User", "example.com"),
    "badnonce": ("proof-badnonce", "badnonce@example.com", "Bad Nonce", "example.com"),
    "badaudience": ("proof-badaudience", "badaudience@example.com", "Bad Audience", "example.com"),
    "badissuer": ("proof-badissuer", "badissuer@example.com", "Bad Issuer", "example.com"),
    "badsignature": ("proof-badsignature", "badsignature@example.com", "Bad Signature", "example.com"),
    "badalgorithm": ("proof-badalgorithm", "badalgorithm@example.com", "Bad Algorithm", "example.com"),
    "expired": ("proof-expired", "expired@example.com", "Expired Token", "example.com"),
    "missinghd": ("proof-missinghd", "missinghd@example.com", "Missing Domain", "example.com"),
}


def b64(value: int) -> str:
    size = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(size, "big")).rstrip(b"=").decode()


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/select/<persona>")
def select(persona: str):
    if persona not in PERSONAS:
        return "unknown persona", 404
    response = redirect(request.args["next"])
    response.set_cookie("proof_google_persona", persona, httponly=True, samesite="Lax")
    return response


@app.get("/authorize")
def authorize():
    assert request.args.get("client_id") == client_id
    assert request.args.get("response_type") == "code"
    assert request.args.get("scope") == "openid email profile"
    code = secrets.token_urlsafe(24)
    codes[code] = {
        "redirect_uri": request.args["redirect_uri"],
        "nonce": request.args["nonce"],
        "persona": request.cookies.get("proof_google_persona", "user"),
    }
    query = {"code": code, "state": request.args["state"]}
    return redirect(f"{request.args['redirect_uri']}?{__import__('urllib.parse', fromlist=['urlencode']).urlencode(query)}")


@app.post("/token")
def token():
    if request.form.get("client_id") != client_id or request.form.get("client_secret") != client_secret:
        return jsonify({"error": "invalid_client"}), 401
    record = codes.pop(request.form.get("code", ""), None)
    if record is None or record["redirect_uri"] != request.form.get("redirect_uri"):
        return jsonify({"error": "invalid_grant"}), 400
    subject, email, name, domain = PERSONAS[record["persona"]]
    now = int(time.time())
    claims = {
        "iss": issuer,
        "sub": subject,
        "aud": client_id,
        "iat": now,
        "exp": now + 300,
        "nonce": record["nonce"],
        "email": email,
        "email_verified": True,
        "hd": domain,
        "name": name,
    }
    persona = record["persona"]
    if persona == "unverified":
        claims["email_verified"] = False
    elif persona == "badnonce":
        claims["nonce"] = "attacker-controlled-nonce"
    elif persona == "badaudience":
        claims["aud"] = "different-client"
    elif persona == "badissuer":
        claims["iss"] = "https://attacker.example"
    elif persona == "expired":
        claims["exp"] = now - 10
    elif persona == "missinghd":
        claims.pop("hd")
    if persona == "badalgorithm":
        encoded = jwt.encode(claims, "proof-hmac-secret", algorithm="HS256", headers={"kid": "proof-key"})
        return jsonify({"access_token": "discarded-google-token", "token_type": "Bearer", "expires_in": 300, "id_token": encoded})
    signing_key = rogue_key if persona == "badsignature" else key
    return jsonify({"access_token": "discarded-google-token", "token_type": "Bearer", "expires_in": 300, "id_token": jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "proof-key"})})


@app.get("/jwks")
def jwks():
    numbers = key.public_key().public_numbers()
    return jsonify({"keys": [{"kty": "RSA", "kid": "proof-key", "use": "sig", "alg": "RS256", "n": b64(numbers.n), "e": b64(numbers.e)}]})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000, debug=False)
