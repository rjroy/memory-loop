# HTTPS/TLS Setup

For secure access (required for some mobile browsers and recommended for remote access), configure TLS certificates.

## Environment Variables

```bash
# Both required to enable HTTPS
TLS_CERT=/path/to/certificate.pem
TLS_KEY=/path/to/private-key.pem

# Optional: passphrase for encrypted private keys
TLS_PASSPHRASE=your-passphrase

# Optional: HTTP redirect port (default: 80)
# When TLS is enabled, a second server starts on this port
# and redirects all HTTP requests to HTTPS
HTTP_PORT=80
```

## Option 1: Self-Signed Certificate (Local Network)

For local network access where you control all devices:

```bash
# Generate a self-signed certificate (valid 365 days)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/CN=memory-loop" \
  -addext "subjectAltName=DNS:localhost,IP:YOUR_LOCAL_IP"

# Set environment variables
export TLS_CERT=/path/to/cert.pem
export TLS_KEY=/path/to/key.pem
```

You'll need to accept the browser security warning on first visit, or add the certificate to your device's trusted store.

## Option 2: Let's Encrypt (Public Domain)

For a publicly accessible domain with automatic certificate renewal:

```bash
# Install certbot
sudo apt install certbot  # Debian/Ubuntu

# Get a certificate (standalone mode)
sudo certbot certonly --standalone -d yourdomain.com

# Certificates are stored in /etc/letsencrypt/live/yourdomain.com/
export TLS_CERT=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
export TLS_KEY=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

Note: Let's Encrypt certificates need renewal every 90 days. Set up a cron job or systemd timer for `certbot renew`.

## Option 3: mkcert (Development)

For development with locally-trusted certificates:

```bash
# Install mkcert (https://github.com/FiloSottile/mkcert)
# macOS: brew install mkcert
# Linux: see mkcert GitHub for installation

# Create and install local CA
mkcert -install

# Generate certificate for your domains
mkcert localhost 192.168.1.100 memory-loop.local

# Use the generated files
export TLS_CERT=./localhost+2.pem
export TLS_KEY=./localhost+2-key.pem
```

mkcert certificates are trusted by browsers on machines where you ran `mkcert -install`.

## Verifying HTTPS

After starting the server with TLS configured, you should see:

```
Memory Loop Backend running at https://localhost:3000
WebSocket available at wss://localhost:3000/ws
TLS enabled - connections are encrypted
HTTP redirect server running at http://localhost:80 -> https://localhost:3000
```

## Linux Privileged Ports

On Linux, binding to ports below 1024 (like 80 and 443) requires elevated privileges. Several options exist:

**Option 1: sysctl (simplest)**

Lower the unprivileged port threshold system-wide:

```bash
# Allow binding to ports >= 80
sudo sysctl net.ipv4.ip_unprivileged_port_start=80

# Make permanent across reboots
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-unprivileged-ports.conf
```

This is safe for personal systems where you're the only user.

**Option 2: Capability on bun binary**

Grant bun the specific capability to bind low ports:

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which bun)
```

Note: Must be re-run after bun updates.

**Option 3: Port forwarding (app stays on high ports)**

Use nftables to redirect standard ports to high ports:

```bash
sudo nft add table nat
sudo nft add chain nat prerouting { type nat hook prerouting priority 0 \; }
sudo nft add rule nat prerouting tcp dport 80 redirect to :3080
sudo nft add rule nat prerouting tcp dport 443 redirect to :3443
```

Then configure:
```bash
export PORT=3443
export HTTP_PORT=3080
```

**Option 4: Reverse proxy**

Use nginx or caddy on ports 80/443 to proxy to Memory Loop on high ports. This is the standard production approach and allows multiple services to share ports.
