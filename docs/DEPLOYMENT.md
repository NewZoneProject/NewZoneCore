# NewZoneCore Deployment Guide

**Version:** 0.3.0
**Last Updated:** 21 февраля 2026 г.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running NewZoneCore](#running-newzonecore)
5. [Production Deployment](#production-deployment)
6. [Docker Deployment](#docker-deployment)
7. [Backup and Recovery](#backup-and-recovery)
8. [Monitoring and Observability](#monitoring-and-observability)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 1 core | 2+ cores |
| RAM | 256 MB | 512+ MB |
| Disk | 1 GB | 5+ GB |
| Node.js | 18.0.0 | 20.0.0+ |

### Supported Platforms

- ✅ Linux (Ubuntu, Debian, CentOS, Alpine)
- ✅ macOS
- ✅ Windows (WSL2 recommended)
- ✅ Docker / Docker Compose
- ✅ Termux (Android)

---

## Installation

### From Source

```bash
# Clone repository
git clone https://github.com/NewZoneProject/NewZoneCore.git
cd NewZoneCore

# Install dependencies
npm install

# Initialize environment
npm run bootstrap
```

### Using NPM

```bash
npm install -g nzcore

# Initialize
nzcore init
```

### Using Docker

```bash
docker pull newzoneproject/nzcore:latest

docker run -d \
  --name nzcore \
  -p 3000:3000 \
  -v nzcore-data:/app/env \
  newzoneproject/nzcore:latest
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `API_HOST` | HTTP API host | `127.0.0.1` |
| `API_PORT` | HTTP API port | `3000` |
| `IPC_PATH` | IPC socket path | `./nzcore.ipc` |
| `ENV_DIR` | Environment directory | `./env` |
| `LOG_LEVEL` | Logging level | `info` |
| `BACKUP_DIR` | Backup directory | `./backups` |
| `METRICS_ENABLED` | Enable metrics | `true` |

### Configuration File

Create `config.json` in the environment directory:

```json
{
  "node": {
    "name": "my-node",
    "environment": "production"
  },
  "api": {
    "host": "127.0.0.1",
    "port": 3000,
    "cors": ["http://localhost:3000"]
  },
  "security": {
    "rateLimit": {
      "enabled": true,
      "maxAttempts": 5,
      "windowMs": 900000
    }
  },
  "backup": {
    "enabled": true,
    "dir": "./backups",
    "schedule": {
      "full": "0 0 * * 0",
      "incremental": "0 0 * * *"
    }
  },
  "observability": {
    "metrics": {
      "enabled": true,
      "port": 9090
    },
    "tracing": {
      "enabled": true,
      "exporter": "http://localhost:4318/v1/traces"
    },
    "alerts": {
      "enabled": true,
      "webhook": "https://hooks.example.com/alerts"
    }
  }
}
```

---

## Running NewZoneCore

### Development Mode

```bash
# Start with default configuration
npm start

# Start with custom config
nzcore start --config ./custom-config.json
```

### Production Mode

```bash
# Set environment
export NODE_ENV=production
export API_HOST=0.0.0.0

# Start
nzcore start
```

### As a Service (systemd)

Create `/etc/systemd/system/nzcore.service`:

```ini
[Unit]
Description=NewZoneCore Node
After=network.target

[Service]
Type=simple
User=nzcore
WorkingDirectory=/opt/nzcore
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/nzcore/core.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl enable nzcore
sudo systemctl start nzcore
sudo systemctl status nzcore
```

---

## Production Deployment

### Security Hardening

#### 1. File Permissions

```bash
# Set restrictive permissions
chmod 700 env/
chmod 600 env/master.key
chmod 600 env/seed.enc
chmod 600 env/trust.json
chmod 600 env/keys/*.json

# Set ownership
chown -R nzcore:nzcore /opt/nzcore
```

#### 2. Firewall Configuration

```bash
# Allow only necessary ports
ufw default deny incoming
ufw allow 22/tcp        # SSH
ufw allow 3000/tcp      # API (if external access needed)
ufw enable
```

#### 3. Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name nzcore.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /metrics {
        proxy_pass http://127.0.0.1:9090;
        auth_basic "Metrics";
        auth_basic_user_file /etc/nginx/.metrics_htpasswd;
    }
}
```

#### 4. TLS/SSL

```bash
# Let's Encrypt
certbot --nginx -d nzcore.example.com
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create non-root user
RUN addgroup -g 1001 nzcore && \
    adduser -u 1001 -G nzcore -s /bin/sh -D nzcore && \
    chown -R nzcore:nzcore /app

USER nzcore

# Expose ports
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "core.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  nzcore:
    build: .
    container_name: nzcore
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "9090:9090"
    volumes:
      - nzcore-data:/app/env
      - nzcore-backups:/app/backups
      - nzcore-logs:/app/logs
    environment:
      - NODE_ENV=production
      - API_HOST=0.0.0.0
      - LOG_LEVEL=info
    networks:
      - nzcore-network

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    networks:
      - nzcore-network
    depends_on:
      - nzcore

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3001:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    networks:
      - nzcore-network
    depends_on:
      - prometheus

volumes:
  nzcore-data:
  nzcore-backups:
  nzcore-logs:
  prometheus-data:
  grafana-data:

networks:
  nzcore-network:
    driver: bridge
```

---

## Backup and Recovery

### Manual Backup

```bash
# Create full backup
nzcore backup:create --type full --description "Manual backup"

# List backups
nzcore backup:list

# Verify backup
nzcore backup:verify <backup-id>

# Restore from backup
nzcore backup:restore <backup-id>
```

### Scheduled Backups

Enable automatic backups in configuration:

```json
{
  "backup": {
    "enabled": true,
    "schedule": {
      "full": "0 0 * * 0",
      "incremental": "0 0 * * *"
    },
    "retention": {
      "maxBackups": 10,
      "maxAge": "30d"
    }
  }
}
```

### Disaster Recovery

1. **Install NewZoneCore** on new system
2. **Restore from backup**:
   ```bash
   nzcore backup:restore <backup-id>
   ```
3. **Verify restoration**:
   ```bash
   nzcore doctor
   ```
4. **Start node**:
   ```bash
   nzcore start
   ```

---

## Monitoring and Observability

### Metrics Endpoints

| Endpoint | Description |
|----------|-------------|
| `/metrics` | Prometheus-format metrics |
| `/health` | Health status |
| `/ready` | Readiness probe |
| `/live` | Liveness probe |

### Key Metrics

```
# System metrics
nzcore_uptime_seconds
nzcore_memory_heap_used_bytes
nzcore_memory_rss_bytes

# Security metrics
nzcore_auth_attempts_total
nzcore_security_events_total
nzcore_rate_limited_connections

# Network metrics
nzcore_network_messages_total
nzcore_network_peers_connected
nzcore_dht_routing_table_size

# Service metrics
nzcore_services_running
nzcore_service_restarts_total
```

### Alerting

Configure alerts in configuration:

```json
{
  "alerts": {
    "enabled": true,
    "channels": [
      {
        "type": "webhook",
        "url": "https://hooks.example.com/alerts",
        "severities": ["critical", "high"]
      },
      {
        "type": "email",
        "recipients": ["admin@example.com"],
        "severities": ["critical"]
      }
    ],
    "rules": {
      "highMemory": {
        "threshold": 0.85,
        "severity": "high"
      },
      "authFailures": {
        "threshold": 10,
        "severity": "critical"
      }
    }
  }
}
```

### Distributed Tracing

Enable tracing for request tracking:

```json
{
  "tracing": {
    "enabled": true,
    "samplingRate": 0.1,
    "exporter": {
      "type": "http",
      "url": "http://jaeger:4318/v1/traces"
    }
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. Node Won't Start

**Symptoms:**
```
Error: Master key not found
```

**Solution:**
```bash
# Check environment directory
ls -la env/

# Reinitialize if needed
nzcore init
```

#### 2. High Memory Usage

**Symptoms:**
```
Memory usage exceeds threshold
```

**Solution:**
```bash
# Check memory metrics
curl http://localhost:3000/metrics | grep memory

# Restart service
sudo systemctl restart nzcore

# Check for memory leaks in logs
tail -f logs/error.log
```

#### 3. Backup Fails

**Symptoms:**
```
Backup failed: ENOSPC
```

**Solution:**
```bash
# Check disk space
df -h

# Cleanup old backups
nzcore backup:cleanup --max-age 7d

# Expand storage if needed
```

#### 4. Connection Issues

**Symptoms:**
```
Failed to connect to peer
```

**Solution:**
```bash
# Check firewall
ufw status

# Verify network configuration
nzcore network:status

# Check NAT traversal
nzcore nat:test
```

### Logs

| Log File | Description |
|----------|-------------|
| `logs/nzcore.log` | Main application log |
| `logs/error.log` | Error log |
| `logs/security-audit.log` | Security audit log |
| `logs/crashes/` | Crash reports |

### Debug Mode

```bash
# Enable verbose logging
export LOG_LEVEL=debug
nzcore start

# Or use CLI flag
nzcore start --verbose
```

### Support

- **Documentation:** https://github.com/NewZoneProject/NewZoneCore/tree/main/docs
- **Issues:** https://github.com/NewZoneProject/NewZoneCore/issues
- **Security:** security@newzonecore.dev

---

*For more information, see README.md and ARCHITECTURE.md*
