# IPTV Viewer Production Deployment Guide

This guide covers deploying IPTV Viewer to production using Docker and Nginx Proxy Manager (NPM) with SSL.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [DNS Configuration](#dns-configuration)
3. [Firewall Configuration](#firewall-configuration)
4. [Docker Deployment](#docker-deployment)
5. [NPM Configuration for iptv.domain.com](#npm-configuration-for-iptvdomaincom)
6. [NPM Configuration for streams.domain.com](#npm-configuration-for-streamsdomaincom)
7. [Verification Checklist](#verification-checklist)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting deployment, ensure you have:

- [ ] A VPS with Docker and Docker Compose installed
- [ ] Nginx Proxy Manager (NPM) running on the VPS
- [ ] A domain name with DNS control
- [ ] Dispatcharr accessible at `10.8.0.2:9191` (via Wireguard VPN)
- [ ] Ports 80 and 443 available on the VPS

### Network Topology

```
Internet User
     │
     ▼
┌─────────────────────────────────────┐
│  NPM (Nginx Proxy Manager)          │
│  - iptv.domain.com:443              │
│  - streams.domain.com:443           │
└───────────────┬─────────────────────┘
                │
    ┌───────────┴───────────┐
    ▼                       ▼
┌─────────────┐       ┌─────────────────┐
│ Docker      │       │ Dispatcharr     │
│ Container   │       │ (via Wireguard) │
│ :8080       │       │ 10.8.0.2:9191   │
└─────────────┘       └─────────────────┘
```

---

## DNS Configuration

Create A records pointing to your VPS public IP address:

| Record Type | Name | Value | TTL |
|-------------|------|-------|-----|
| A | iptv | YOUR_VPS_IP | 3600 |
| A | streams | YOUR_VPS_IP | 3600 |

### Verify DNS Propagation

```bash
# Check DNS resolution
dig iptv.domain.com +short
dig streams.domain.com +short

# Both should return your VPS IP address
```

**Note:** DNS propagation can take up to 24-48 hours, but typically completes within minutes.

---

## Firewall Configuration

Ensure your VPS firewall allows incoming traffic on ports 80 and 443:

### UFW (Ubuntu/Debian)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
sudo ufw status
```

### iptables

```bash
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

### Cloud Provider Firewall

If using AWS, GCP, Azure, or similar, also configure:
- Security Groups (AWS)
- Firewall Rules (GCP)
- Network Security Groups (Azure)

---

## Docker Deployment

### 1. Clone and Configure

```bash
cd /path/to/deployment
git clone <repository-url> iptv_viewer2
cd iptv_viewer2
```

### 2. Create Environment File

```bash
cp .env.example .env
```

Edit `.env` with production values:

```env
# Backend Configuration
DISPATCHARR_URL=http://10.8.0.2:9191
JWT_SECRET=your-secure-random-secret-min-32-chars
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure-admin-password
VIEWER_USERNAME=viewer
VIEWER_PASSWORD=secure-viewer-password

# Frontend Configuration
VITE_API_URL=https://iptv.domain.com/api
VITE_WS_URL=wss://iptv.domain.com/api/ws
VITE_STREAM_BASE_URL=https://streams.domain.com
```

**Important:** Replace `domain.com` with your actual domain.

### 3. Start the Container

```bash
docker-compose up -d
```

### 4. Verify Container is Running

```bash
docker-compose ps
docker-compose logs -f
```

The container should be running on port 8080.

---

## NPM Configuration for iptv.domain.com

This configuration routes the main application through NPM with SSL.

### Step 1: Create Proxy Host

In NPM web interface, go to **Hosts > Proxy Hosts > Add Proxy Host**

### Step 2: Details Tab

| Field | Value |
|-------|-------|
| Domain Names | `iptv.domain.com` |
| Scheme | `http` |
| Forward Hostname / IP | `localhost` (or container IP if different network) |
| Forward Port | `8080` |
| Cache Assets | ❌ Disabled |
| Block Common Exploits | ✅ Enabled |
| Websockets Support | ✅ **Enabled** (Required for real-time sync) |

### Step 3: SSL Tab

| Field | Value |
|-------|-------|
| SSL Certificate | Request a new SSL Certificate |
| Force SSL | ✅ Enabled |
| HTTP/2 Support | ✅ Enabled |
| HSTS Enabled | ✅ Enabled |
| HSTS Subdomains | ❌ Disabled |
| Email for Let's Encrypt | your-email@domain.com |
| I Agree... | ✅ Checked |

### Step 4: Save

Click **Save**. NPM will:
1. Create the proxy host configuration
2. Request an SSL certificate from Let's Encrypt
3. Configure automatic certificate renewal

### WebSocket Support Details

NPM's "Websockets Support" toggle automatically adds these nginx headers:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

This enables WebSocket handshake for the `/api/ws` endpoint used for real-time channel synchronization.

---

## NPM Configuration for streams.domain.com

This configuration proxies video streams from Dispatcharr.

### Step 1: Create Proxy Host

In NPM web interface, go to **Hosts > Proxy Hosts > Add Proxy Host**

### Step 2: Details Tab

| Field | Value |
|-------|-------|
| Domain Names | `streams.domain.com` |
| Scheme | `http` |
| Forward Hostname / IP | `10.8.0.2` |
| Forward Port | `9191` |
| Cache Assets | ❌ Disabled |
| Block Common Exploits | ✅ Enabled |
| Websockets Support | ❌ Disabled (not needed for streams) |

### Step 3: SSL Tab

| Field | Value |
|-------|-------|
| SSL Certificate | Request a new SSL Certificate |
| Force SSL | ✅ Enabled |
| HTTP/2 Support | ✅ Enabled |
| HSTS Enabled | ✅ Enabled |
| Email for Let's Encrypt | your-email@domain.com |
| I Agree... | ✅ Checked |

### Step 4: Advanced Tab (CORS Configuration)

If video player experiences CORS issues, add this to the **Custom Nginx Configuration** field:

```nginx
add_header 'Access-Control-Allow-Origin' 'https://iptv.domain.com' always;
add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'Range, Accept-Encoding' always;
add_header 'Access-Control-Expose-Headers' 'Content-Length, Content-Range' always;

if ($request_method = 'OPTIONS') {
    return 204;
}
```

**Note:** Replace `iptv.domain.com` with your actual app domain.

### Step 5: Custom Location (Optional)

If you want to restrict access to only stream paths (recommended for security), add a custom location in the **Advanced Tab**:

```nginx
location /proxy/ts/stream/ {
    proxy_pass http://10.8.0.2:9191;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Step 6: Save

Click **Save** to apply the configuration.

---

## Verification Checklist

After completing the NPM configuration, verify the deployment:

### SSL Verification

- [ ] Browser shows padlock icon for `https://iptv.domain.com`
- [ ] Browser shows padlock icon for `https://streams.domain.com`
- [ ] HTTP redirects to HTTPS automatically

```bash
# Test SSL certificates
curl -I https://iptv.domain.com 2>/dev/null | head -5
curl -I https://streams.domain.com 2>/dev/null | head -5
```

### Application Verification

- [ ] `https://iptv.domain.com` loads the React application
- [ ] Login page appears and accepts credentials
- [ ] After login, channel list loads from API

### API Verification

- [ ] Open browser DevTools (F12) > Network tab
- [ ] `/api/*` requests return 200 status codes
- [ ] Token refresh works (check for `/api/auth/refresh` calls)

### WebSocket Verification

- [ ] In DevTools Network tab, filter by "WS"
- [ ] WebSocket connection to `/api/ws` shows "101 Switching Protocols"
- [ ] WebSocket status shows "Connected" (not closing/erroring)
- [ ] Admin channel changes reflect on viewer devices

### Video Playback Verification

- [ ] Click a channel to start playback
- [ ] Video loads from `streams.domain.com`
- [ ] No CORS errors in browser console
- [ ] HLS stream plays smoothly

### External Access Verification

- [ ] Test from a device NOT on your local network
- [ ] Use mobile phone on cellular data (not WiFi)
- [ ] Verify login, channel list, and video playback all work

---

## Troubleshooting

### SSL Certificate Errors

**Symptoms:** Browser shows "Not Secure" or certificate errors

**Solutions:**
1. Verify DNS is propagated: `dig iptv.domain.com`
2. Ensure ports 80 and 443 are open on firewall
3. Check NPM logs for Let's Encrypt errors
4. Wait 5-10 minutes for certificate provisioning

### WebSocket 502 Errors

**Symptoms:** Real-time sync doesn't work, browser shows WebSocket errors

**Solutions:**
1. Verify "Websockets Support" is enabled in NPM proxy host
2. Check Docker container is running: `docker-compose ps`
3. View container logs: `docker-compose logs -f`
4. Ensure port 8080 is not blocked internally

### Video Not Loading

**Symptoms:** Channel list works but video won't play

**Solutions:**
1. Verify `streams.domain.com` is accessible
2. Check Dispatcharr is running on `10.8.0.2:9191`
3. Verify Wireguard VPN connection is active on VPS
4. Check browser console for CORS errors
5. Add CORS headers to NPM advanced config if needed

### 502 Bad Gateway

**Symptoms:** NPM shows 502 error for all requests

**Solutions:**
1. Verify Docker container is running
2. Check container is listening on port 8080
3. If container is on different Docker network, use container IP instead of `localhost`
4. Check NPM can reach the container: `curl http://localhost:8080` from VPS

### CORS Errors

**Symptoms:** Browser console shows "Access-Control-Allow-Origin" errors

**Solutions:**
1. Add CORS headers to `streams.domain.com` advanced config (see above)
2. Ensure origin domain matches exactly (including https://)
3. Clear browser cache after config changes

### Authentication Issues

**Symptoms:** Login fails or tokens expire immediately

**Solutions:**
1. Verify `JWT_SECRET` is set in `.env` and at least 32 characters
2. Check backend logs for auth errors: `docker-compose logs -f`
3. Ensure cookies are being set (check browser DevTools > Application > Cookies)

---

## Quick Reference

### Domains and Ports

| Service | External URL | Internal Port |
|---------|--------------|---------------|
| App | https://iptv.domain.com | 8080 |
| Streams | https://streams.domain.com | 9191 (10.8.0.2) |
| NPM Admin | http://VPS_IP:81 | 81 |

### Common Commands

```bash
# View container status
docker-compose ps

# View logs
docker-compose logs -f

# Restart container
docker-compose restart

# Rebuild and restart
docker-compose up -d --build

# Check Wireguard status (for Dispatcharr access)
wg show
```

### Environment Variable Checklist

| Variable | Example | Required |
|----------|---------|----------|
| DISPATCHARR_URL | http://10.8.0.2:9191 | Yes |
| JWT_SECRET | random-32-char-string | Yes |
| ADMIN_USERNAME | admin | Yes |
| ADMIN_PASSWORD | secure-password | Yes |
| VIEWER_USERNAME | viewer | Yes |
| VIEWER_PASSWORD | secure-password | Yes |
| VITE_API_URL | https://iptv.domain.com/api | Yes |
| VITE_WS_URL | wss://iptv.domain.com/api/ws | Yes |
| VITE_STREAM_BASE_URL | https://streams.domain.com | Yes |

---

## Security Considerations

1. **Use strong passwords** for admin and viewer accounts
2. **Generate a secure JWT_SECRET**: `openssl rand -hex 32`
3. **Keep NPM updated** for security patches
4. **Monitor access logs** for suspicious activity
5. **Consider IP whitelisting** if only specific users need access
6. **Enable HSTS** to prevent downgrade attacks (included in config)

---

*Last Updated: 2025-12-28*
