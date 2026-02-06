# HTTPS/TLS Setup

Next.js does not handle TLS termination directly. Use a reverse proxy for HTTPS.

## Option 1: Caddy (Simplest)

Caddy handles TLS certificates automatically, including Let's Encrypt provisioning and renewal.

```
# /etc/caddy/Caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}
```

For local network access with a custom domain:

```
memory-loop.local {
    tls internal
    reverse_proxy localhost:3000
}
```

## Option 2: nginx

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (disable buffering for streaming responses)
        proxy_buffering off;
        proxy_cache off;
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

## Option 3: Self-Signed Certificate with mkcert (Development)

For local development with trusted certificates:

```bash
# Install mkcert (https://github.com/FiloSottile/mkcert)
mkcert -install
mkcert localhost 192.168.1.100

# Use with caddy or nginx as above
```

## Linux Privileged Ports

On Linux, binding to ports below 1024 (like 80 and 443) requires elevated privileges. If your reverse proxy needs low ports:

**sysctl (simplest for personal systems):**
```bash
sudo sysctl net.ipv4.ip_unprivileged_port_start=80
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-unprivileged-ports.conf
```

**Port forwarding (app stays on high ports):**
```bash
sudo nft add table nat
sudo nft add chain nat prerouting { type nat hook prerouting priority 0 \; }
sudo nft add rule nat prerouting tcp dport 80 redirect to :8080
sudo nft add rule nat prerouting tcp dport 443 redirect to :8443
```
