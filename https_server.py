#!/usr/bin/env python3
"""Serve this project over local HTTPS for WebXR secure-context testing."""

from __future__ import annotations

import argparse
import functools
import ipaddress
import re
import socket
import shutil
import ssl
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_CERT_DIR = PROJECT_ROOT / ".certs"
DEFAULT_CERT = DEFAULT_CERT_DIR / "localhost.pem"
DEFAULT_KEY = DEFAULT_CERT_DIR / "localhost-key.pem"


def configure_output_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


class QuietStaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".wasm": "application/wasm",
    }

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the project root over HTTPS for WebXR prototypes.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8443, help="Bind port. Default: 8443")
    parser.add_argument("--root", type=Path, default=PROJECT_ROOT, help="Static root. Default: project root")
    parser.add_argument("--cert", type=Path, default=DEFAULT_CERT, help="TLS certificate path")
    parser.add_argument("--key", type=Path, default=DEFAULT_KEY, help="TLS private key path")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="Bind to 0.0.0.0 and advertise this computer's LAN IP for headset access.",
    )
    parser.add_argument(
        "--public-host",
        action="append",
        default=[],
        help="Reachable host/IP to include in the certificate and printed URLs. Can be repeated.",
    )
    parser.add_argument(
        "--story-path",
        action="append",
        default=[],
        help="Story URL path to advertise first. Can be repeated.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show bind, root, alternate-host, and discovered-story details at startup.",
    )
    return parser.parse_args()


def detect_lan_ip() -> str | None:
    """Return the preferred LAN address, with Wi-Fi taking priority."""
    addresses = detect_lan_ips()
    return addresses[0] if addresses else None


def detect_lan_ips() -> list[str]:
    """Return active LAN IPv4 addresses ordered Wi-Fi, Ethernet, then other."""
    ifconfig_output = command_output(["ifconfig"])
    interface_addresses = parse_ifconfig_ipv4_interfaces(ifconfig_output)

    hardware_output = command_output(["networksetup", "-listallhardwareports"])
    wifi_interfaces, ethernet_interfaces = parse_networksetup_interfaces(hardware_output)
    if not wifi_interfaces:
        wifi_interfaces = parse_system_profiler_wifi_interfaces(
            command_output(["system_profiler", "SPAirPortDataType", "-detailLevel", "mini"]),
        )

    ordered_interfaces = [
        *wifi_interfaces,
        *ethernet_interfaces,
        *interface_addresses,
    ]
    addresses = unique_values(
        address
        for interface in ordered_interfaces
        for address in interface_addresses.get(interface, [])
    )

    route_address = detect_default_route_ip()
    if route_address and route_address not in addresses:
        addresses.append(route_address)
    return addresses


def command_output(command: list[str]) -> str:
    executable = shutil.which(command[0])
    if not executable:
        return ""
    result = subprocess.run(
        [executable, *command[1:]],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else ""


def parse_networksetup_interfaces(output: str) -> tuple[list[str], list[str]]:
    wifi_interfaces = []
    ethernet_interfaces = []
    hardware_port = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if line.startswith("Hardware Port:"):
            hardware_port = line.partition(":")[2].strip().lower()
            continue
        if not line.startswith("Device:") or not hardware_port:
            continue
        interface = line.partition(":")[2].strip()
        if not interface:
            continue
        if re.search(r"\b(wi-?fi|airport)\b", hardware_port):
            wifi_interfaces.append(interface)
        elif "ethernet" in hardware_port:
            ethernet_interfaces.append(interface)
    return unique_values(wifi_interfaces), unique_values(ethernet_interfaces)


def parse_system_profiler_wifi_interfaces(output: str) -> list[str]:
    interfaces = []
    in_interfaces = False
    for raw_line in output.splitlines():
        stripped = raw_line.strip()
        if stripped == "Interfaces:":
            in_interfaces = True
            continue
        if not in_interfaces:
            continue
        match = re.match(r"^(en\d+):$", stripped)
        if match:
            interfaces.append(match.group(1))
    return unique_values(interfaces)


def parse_ifconfig_ipv4_interfaces(output: str) -> dict[str, list[str]]:
    interfaces: dict[str, list[str]] = {}
    matches = list(re.finditer(r"(?m)^([^\s:]+):\s+flags=.*$", output))
    for index, match in enumerate(matches):
        interface = match.group(1)
        end = matches[index + 1].start() if index + 1 < len(matches) else len(output)
        block = output[match.start():end]
        if re.search(r"(?m)^\s*status:\s*inactive\s*$", block):
            continue
        addresses = []
        for address_match in re.finditer(r"(?m)^\s*inet\s+([^\s]+)", block):
            address = address_match.group(1)
            try:
                parsed = ipaddress.ip_address(address)
            except ValueError:
                continue
            if not isinstance(parsed, ipaddress.IPv4Address):
                continue
            if parsed.is_loopback or parsed.is_link_local or parsed.is_unspecified or parsed.is_multicast:
                continue
            addresses.append(address)
        if addresses:
            interfaces[interface] = unique_values(addresses)
    return interfaces


def detect_default_route_ip() -> str | None:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            address = sock.getsockname()[0]
            parsed = ipaddress.ip_address(address)
            if parsed.is_loopback or parsed.is_link_local or parsed.is_unspecified:
                return None
            return address
        except OSError:
            return None


def unique_values(values) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def normalized_hosts(bind_host: str, public_hosts: list[str]) -> list[str]:
    hosts = ["localhost", "127.0.0.1", *public_hosts]
    if bind_host not in {"0.0.0.0", "::", ""}:
        hosts.append(bind_host)
    seen: set[str] = set()
    result = []
    for host in hosts:
        host = host.strip()
        if host and host not in seen:
            seen.add(host)
            result.append(host)
    return result


def display_hosts(bind_host: str, public_hosts: list[str], prefer_public: bool) -> list[str]:
    local_hosts = ["localhost", "127.0.0.1"]
    if bind_host not in {"0.0.0.0", "::", "", "127.0.0.1", "localhost"}:
        local_hosts.append(bind_host)
    values = [*public_hosts, *local_hosts] if prefer_public and public_hosts else [*local_hosts, *public_hosts]
    return unique_values(host.strip() for host in values)


def normalized_story_paths(story_paths: list[str]) -> list[str]:
    return unique_values(f"/{value.strip().strip('/')}/" for value in story_paths if value.strip().strip("/"))


def print_story_urls(base_url: str, story_paths: list[str], prefix: str = "WebXR URL") -> None:
    for index, story_path in enumerate(story_paths):
        label = prefix if index == 0 else "Additional WebXR URL"
        print(f"{label}: {base_url}{story_path}", flush=True)


def cert_alt_names(hosts: list[str]) -> str:
    names = []
    seen: set[str] = set()
    for host in hosts:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            entry = f"DNS:{host}"
        else:
            entry = f"IP:{host}"
        if entry not in seen:
            seen.add(entry)
            names.append(entry)
    return ",".join(names)


def cert_matches_hosts(cert: Path, hosts: list[str]) -> bool:
    if not cert.exists():
        return False
    openssl = shutil.which("openssl")
    if not openssl:
        return False
    result = subprocess.run(
        [openssl, "x509", "-in", str(cert), "-noout", "-ext", "subjectAltName"],
        check=False,
        capture_output=True,
        text=True,
    )
    output = result.stdout + result.stderr
    if result.returncode != 0:
        return False
    for host in hosts:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if f"DNS:{host}" not in output:
                return False
        else:
            if f"IP Address:{host}" not in output and f"IP:{host}" not in output:
                return False
    return True


def ensure_cert(cert: Path, key: Path, hosts: list[str]) -> None:
    if cert.exists() and key.exists() and cert_matches_hosts(cert, hosts):
        return

    openssl = shutil.which("openssl")
    if not openssl:
        raise SystemExit(
            "openssl is required to generate a local self-signed certificate. "
            "Install openssl or pass --cert and --key for an existing certificate."
        )

    cert.parent.mkdir(parents=True, exist_ok=True)
    key.parent.mkdir(parents=True, exist_ok=True)
    command = [
        openssl,
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "3650",
        "-nodes",
        "-keyout",
        str(key),
        "-out",
        str(cert),
        "-subj",
        "/CN=localhost",
        "-addext",
        f"subjectAltName={cert_alt_names(hosts)}",
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Generated local self-signed certificate: {cert}", flush=True)
    print(f"Generated local private key: {key}", flush=True)


def discover_jingchen_stories(root: Path) -> list[tuple[str, str]]:
    collection_root = root / "Jingchen-10-stories"
    if not collection_root.is_dir():
        return []

    stories: list[tuple[str, str]] = []
    for story_dir in sorted(collection_root.glob("Story_*")):
        if not story_dir.is_dir():
            continue
        for index_path in sorted(story_dir.glob("*/webxr-adaptation/index.html")):
            story_slug = index_path.parent.parent.name
            stories.append((story_dir.name, story_slug))
    return stories


def print_jingchen_urls(base_url: str, stories: list[tuple[str, str]]) -> None:
    if not stories:
        return

    print("Jingchen story static build URLs:", flush=True)
    for story_folder, story_slug in stories:
        story_path = f"/Jingchen-10-stories/{story_folder}/{story_slug}"
        print(f"  {story_folder}: {base_url}{story_path}/dist-webxr-adaptation/", flush=True)
    print("Jingchen story source URLs use the same prefix with /webxr-adaptation/.", flush=True)


def main() -> int:
    configure_output_encoding()
    args = parse_args()
    public_hosts = list(args.public_host)
    bind_host = args.host
    if args.lan:
        bind_host = "0.0.0.0"
        public_hosts = unique_values([*detect_lan_ips(), *public_hosts])

    root = args.root.resolve()
    cert = args.cert.resolve()
    key = args.key.resolve()
    cert_hosts = normalized_hosts(bind_host, public_hosts)
    advertised_hosts = display_hosts(bind_host, public_hosts, prefer_public=args.lan)
    story_paths = normalized_story_paths(args.story_path) or ["/global-migration/webxr-adaptation/"]

    if not root.exists() or not root.is_dir():
        raise SystemExit(f"Static root does not exist or is not a directory: {root}")

    ensure_cert(cert, key, cert_hosts)

    handler = functools.partial(QuietStaticHandler, directory=str(root))
    httpd = ReusableThreadingHTTPServer((bind_host, args.port), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(cert), keyfile=str(key))
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    base_url = f"https://{advertised_hosts[0]}:{args.port}"
    if args.verbose:
        print(f"Serving {root}", flush=True)
        print(f"Bind address: {bind_host}:{args.port}", flush=True)
        print(f"Root URL: {base_url}/", flush=True)
    print_story_urls(base_url, story_paths)

    if args.lan and not public_hosts:
        print("No active LAN IPv4 address detected; only local URLs are available.", flush=True)

    if args.verbose:
        discovered_stories = discover_jingchen_stories(root)
        print_jingchen_urls(base_url, discovered_stories)
        if args.lan and public_hosts:
            print(f"Preferred headset host: {public_hosts[0]} (Wi-Fi when active)", flush=True)
        for host in advertised_hosts[1:]:
            alternate_url = f"https://{host}:{args.port}"
            print_story_urls(alternate_url, story_paths, prefix="Also available")
            print_jingchen_urls(alternate_url, discovered_stories)
        print("The browser may show a certificate warning because this is a local self-signed certificate.", flush=True)
    print("Press Ctrl+C to stop.", flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping HTTPS server.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
