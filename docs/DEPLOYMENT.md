# NewZoneCore Deployment Guide

**Version:** 1.0.0  
**Last Updated:** 20 февраля 2026 г.  
**Status:** Production Ready

---

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running in Production](#running-in-production)
- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Monitoring](#monitoring)
- [Backup and Recovery](#backup-and-recovery)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| CPU | 1 core |
| RAM | 256 MB |
| Disk | 1 GB |
| Node.js | >= 18.0.0 |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| CPU | 2+ cores |
| RAM | 512 MB+ |
| Disk | 10 GB+ SSD |
| Network | 100 Mbps+ |

### Operating Systems

- ✅ Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- ✅ macOS (11+)
- ✅ Windows (10+, WSL2 recommended)
- ✅ Docker (any platform)

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

### From NPM (when published)

```bash
npm install -g nzcore
```

### Using Docker

```bash
docker pull newzoneproject/nzcore:latest
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (production/development) | `development` |
| `API_PORT` | HTTP API port | `3000` |
| `API_HOST` | HTTP API host | `127.0.0.1` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `localhost` |
| `NZCORE_DEBUG` | Enable debug logging | `false` |
| `NZCORE_DATA_DIR` | Data directory | `./env` |
| `NZCORE_LOGS_DIR` | Logs directory | `./logs` |

### Configuration File

Create `config.json` in the project root:

```json
{
  "api": {
    "port": 3000,
    "host": "127.0.0.1",
    "cors": ["http://localhost:3000"]
  },
  "security": {
    "rateLimit": {
      "maxAttempts": 5,
      "windowMs": 900000
    }
  },
  "storage": {
    "maxFileSize": 1048576,
    "maxKeySize": 102400
  },
  "network": {
    "dht": {
      "bootstrapNodes": ["node1.newzone.io", "node2.newzone.io"]
    }
  }
}
```

---

## Running in Production

### 1. Initial Setup

```bash
# Set production environment
export NODE_ENV=production

# Create data directory with secure permissions
mkdir -p /var/lib/nzcore
chmod 700 /var/lib/nzcore

# Initialize with strong password
nzcore init --password "YOUR_STRONG_PASSWORD"
```

### 2. Start as System Service

#### systemd (Linux)

Create `/etc/systemd/system/nzcore.service`:

```ini
[Unit]
Description=NewZoneCore Distributed Trust System
After=network.target

[Service]
Type=simple
User=nzcore
Group=nzcore
WorkingDirectory=/opt/nzcore
Environment=NODE_ENV=production
Environment=NZCORE_DATA_DIR=/var/lib/nzcore
ExecStart=/usr/bin/node /opt/nzcore/core.js
Restart=on-failure
RestartSec=10

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/nzcore /var/log/nzcore

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable nzcore
sudo systemctl start nzcore
sudo systemctl status nzcore
```

### 3. Verify Installation

```bash
# Check health
curl http://localhost:3000/health

# Check metrics
curl http://localhost:3000/metrics

# Check logs
journalctl -u nzcore -f
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 nzcore && \
    adduser -u 1001 -G nzcore -D nzcore

# Set working directory
WORKDIR /app

# Copy package files
COPY --chown=nzcore:nzcore package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY --chown=nzcore:nzcore . .

# Switch to non-root user
USER nzcore

# Expose ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
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
      - "127.0.0.1:3000:3000"
    volumes:
      - nzcore_data:/var/lib/nzcore
      - nzcore_logs:/var/log/nzcore
    environment:
      - NODE_ENV=production
      - NZCORE_DATA_DIR=/var/lib/nzcore
      - NZCORE_LOGS_DIR=/var/log/nzcore
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  nzcore_data:
  nzcore_logs:
```

```bash
# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f nzcore

# Stop
docker-compose down
```

---

## Kubernetes Deployment

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nzcore
  labels:
    app: nzcore
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nzcore
  template:
    metadata:
      labels:
        app: nzcore
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
      containers:
      - name: nzcore
        image: newzoneproject/nzcore:latest
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: NZCORE_DATA_DIR
          value: "/data"
        volumeMounts:
        - name: data
          mountPath: /data
        - name: logs
          mountPath: /var/log/nzcore
        livenessProbe:
          httpGet:
            path: /live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: nzcore-data
      - name: logs
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: nzcore
spec:
  selector:
    app: nzcore
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

---

## Monitoring

### Prometheus Metrics

NewZoneCore exposes Prometheus-compatible metrics at `/metrics`:

```bash
curl http://localhost:3000/metrics
```

**Available Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `nzcore_uptime_seconds` | Counter | System uptime |
| `nzcore_memory_heap_used_bytes` | Gauge | Heap memory used |
| `nzcore_auth_attempts_total` | Counter | Authentication attempts |
| `nzcore_security_events_total` | Counter | Security events |
| `nzcore_network_messages_total` | Counter | Network messages |
| `nzcore_network_peers_connected` | Gauge | Connected peers |
| `nzcore_services_running` | Gauge | Running services |
| `nzcore_dht_routing_table_size` | Gauge | DHT table size |

### Grafana Dashboard

Import the provided Grafana dashboard from `docs/monitoring/grafana-dashboard.json`.

### Health Endpoints

| Endpoint | Description |
|----------|-------------|
| `/health` | Overall health status |
| `/ready` | Readiness probe |
| `/live` | Liveness probe |

---

## Backup and Recovery

### Backup Procedure

```bash
# 1. Stop the service
sudo systemctl stop nzcore

# 2. Backup data directory
tar -czf nzcore-backup-$(date +%Y%m%d).tar.gz /var/lib/nzcore

# 3. Backup configuration
cp config.json nzcore-config-backup-$(date +%Y%m%d).json

# 4. Restart service
sudo systemctl start nzcore

# 5. Verify backup
tar -tzf nzcore-backup-$(date +%Y%m%d).tar.gz
```

### Automated Backups

Create `/etc/cron.daily/nzcore-backup`:

```bash
#!/bin/bash
BACKUP_DIR="/backup/nzcore"
DATE=$(date +%Y%m%d)

# Create backup
tar -czf $BACKUP_DIR/nzcore-backup-$DATE.tar.gz /var/lib/nzcore

# Keep only last 7 backups
find $BACKUP_DIR -name "nzcore-backup-*.tar.gz" -mtime +7 -delete
```

```bash
chmod +x /etc/cron.daily/nzcore-backup
```

### Recovery Procedure

```bash
# 1. Stop the service
sudo systemctl stop nzcore

# 2. Restore data
tar -xzf nzcore-backup-20260220.tar.gz -C /

# 3. Set permissions
chown -R nzcore:nzcore /var/lib/nzcore
chmod 700 /var/lib/nzcore

# 4. Start service
sudo systemctl start nzcore

# 5. Verify
curl http://localhost:3000/health
```

---

## Troubleshooting

### Common Issues

#### 1. Service Won't Start

```bash
# Check logs
journalctl -u nzcore -n 50

# Check configuration
node -e "console.log(require('./config.json'))"

# Check permissions
ls -la /var/lib/nzcore
```

#### 2. High Memory Usage

```bash
# Check memory metrics
curl http://localhost:3000/metrics | grep memory

# Enable GC logging
export NODE_OPTIONS="--trace-gc"

# Consider increasing limits
export NODE_OPTIONS="--max-old-space-size=512"
```

#### 3. Network Connectivity Issues

```bash
# Check network status
curl http://localhost:3000/metrics | grep network

# Check firewall
sudo ufw status

# Check port binding
netstat -tlnp | grep 3000
```

#### 4. Authentication Failures

```bash
# Check security logs
grep "auth" /var/log/nzcore/*.log

# Check rate limiting
curl http://localhost:3000/metrics | grep auth_attempts

# Reset rate limits (if needed)
# Restart service
sudo systemctl restart nzcore
```

### Getting Help

- **Documentation:** https://github.com/NewZoneProject/NewZoneCore/docs
- **Issues:** https://github.com/NewZoneProject/NewZoneCore/issues
- **Security:** security@newzonecore.dev

---

*Document Version: 1.0*  
*Last Updated: 20 февраля 2026 г.*
