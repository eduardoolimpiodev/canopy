import hashlib
import json
import pathlib
import socket
import ssl
import subprocess
import time


DOMAIN = "canopy.eduardoolimpio.com"
CERTIFICATE = pathlib.Path("/etc/letsencrypt/live") / DOMAIN / "cert.pem"


def served_fingerprint():
    context = ssl.create_default_context()
    with socket.create_connection(("127.0.0.1", 443), timeout=5) as connection:
        with context.wrap_socket(connection, server_hostname=DOMAIN) as secured:
            return hashlib.sha256(secured.getpeercert(binary_form=True)).hexdigest()


def renew():
    subprocess.run(
        ["certbot", "renew", "--cert-name", DOMAIN, "--non-interactive", "--quiet"],
        check=True,
        timeout=240,
    )
    desired = hashlib.sha256(
        ssl.PEM_cert_to_DER_cert(CERTIFICATE.read_text())
    ).hexdigest()
    try:
        current = served_fingerprint()
    except ssl.SSLCertVerificationError as error:
        print(json.dumps({"current_certificate_invalid": True, "verify_code": error.verify_code}), flush=True)
        current = None
    if current == desired:
        print(json.dumps({"certificate_verified": True, "reload_needed": False}))
        return
    subprocess.run(["docker", "exec", "nginx-proxy", "nginx", "-t"], check=True, timeout=15)
    subprocess.run(["docker", "exec", "nginx-proxy", "nginx", "-s", "reload"], check=True, timeout=15)
    last_error = None
    for attempt in range(10):
        try:
            if served_fingerprint() == desired:
                print(json.dumps({"certificate_verified": True, "reload_needed": True}))
                return
        except ssl.SSLCertVerificationError as error:
            last_error = error
        if attempt < 9:
            time.sleep(0.3)
    raise RuntimeError("O proxy não apresentou o certificado renovado após o reload") from last_error


if __name__ == "__main__":
    renew()
