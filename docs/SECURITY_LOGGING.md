# Security Logging Guide

**Version:** 1.0  
**Date:** 20 февраля 2026 г.  
**Status:** Production Ready

---

## Overview

NewZoneCore включает специализированную систему security audit logging для:
- Регистрации событий безопасности
- Compliance требованиям (SOC 2, ISO 27001)
- Forensic анализа после инцидентов
- Real-time мониторинга угроз

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Audit Logger                     │
├─────────────────────────────────────────────────────────────┤
│  Event Types           │  Severity Levels                   │
│  ├─ Authentication     │  ├─ LOW (informational)            │
│  ├─ Authorization      │  ├─ MEDIUM (potentially important) │
│  ├─ Account Mgmt       │  ├─ HIGH (security relevant)       │
│  ├─ Key Management     │  └─ CRITICAL (immediate action)    │
│  ├─ Trust Management   │                                    │
│  └─ Security Incidents │  Output: JSON lines file           │
└─────────────────────────────────────────────────────────────┘
```

---

## Event Types

### Authentication Events

| Event | Severity | Description |
|-------|----------|-------------|
| `auth:login:success` | LOW | Успешная аутентификация |
| `auth:login:failed` | MEDIUM | Неудачная попытка входа |
| `auth:logout` | LOW | Выход из системы |
| `auth:token:refresh` | LOW | Обновление токена |
| `auth:token:revoked` | MEDIUM | Токен отозван |

### Authorization Events

| Event | Severity | Description |
|-------|----------|-------------|
| `auth:access:granted` | LOW | Доступ разрешён |
| `auth:access:denied` | MEDIUM | Доступ запрещён |
| `auth:permission:changed` | HIGH | Изменение прав |

### Key Management Events

| Event | Severity | Description |
|-------|----------|-------------|
| `key:generated` | HIGH | Ключ сгенерирован |
| `key:imported` | HIGH | Ключ импортирован |
| `key:exported` | HIGH | Ключ экспортирован |
| `key:rotated` | HIGH | Ключ ротирован |
| `key:revoked` | CRITICAL | Ключ отозван |

### Security Incident Events

| Event | Severity | Description |
|-------|----------|-------------|
| `security:rate:limit` | MEDIUM | Сработал rate limiter |
| `security:brute:force` | CRITICAL | Обнаружен brute force |
| `security:invalid:input` | MEDIUM | Неверный input |
| `security:tampering` | CRITICAL | Попытка взлома |
| `security:anomaly` | HIGH | Аномальное поведение |

---

## Usage

### Basic Logging

```javascript
import { getSecurityAuditLogger, AuditEventType } from '../utils/security-audit.js';

const auditLogger = getSecurityAuditLogger();

// Log authentication success
await auditLogger.logAuthSuccess({
  userId: 'user-123',
  method: 'password',
  mfa: true,
  ip: '192.168.1.1',
  sessionId: 'sess-abc'
});

// Log authentication failure
await auditLogger.logAuthFailure({
  userId: 'user-123',
  method: 'password',
  reason: 'invalid_credentials',
  attemptNumber: 3,
  ip: '192.168.1.1'
});

// Log access denied
await auditLogger.logAccessDenied({
  resource: '/api/admin',
  action: 'POST',
  userId: 'user-456',
  reason: 'insufficient_permissions',
  ip: '192.168.1.1'
});

// Log security incident
await auditLogger.logSecurityIncident({
  type: 'sql_injection_attempt',
  description: 'Detected SQL in input field',
  severity: 'high',
  evidence: { input: "'; DROP TABLE users;--" },
  ip: '192.168.1.1'
});
```

### Custom Events

```javascript
await auditLogger.log(AuditEventType.TRUST_PEER_ADDED, {
  peerId: 'peer-123',
  trustLevel: 3,
  addedBy: 'user-456'
}, {
  ip: '192.168.1.1',
  userId: 'user-456'
});
```

---

## Configuration

### Constructor Options

```javascript
const auditLogger = new SecurityAuditLogger({
  enabled: true,                    // Включить логирование
  logPath: './logs/security.log',   // Путь к файлу
  maxFileSize: 10 * 1024 * 1024,    // 10 MB max
  maxFiles: 5,                      // 5 файлов ротации
  bufferSize: 10,                   // Flush after 10 entries
  flushTimeout: 5000,               // Or every 5 seconds
  includeStackTrace: false,         // Не включать stack trace
  severityMap: {                    // Custom severity mapping
    'custom:event': 'high'
  }
});
```

---

## Log Format

### Entry Structure

```json
{
  "timestamp": "2026-02-20T12:00:00.000Z",
  "event": "auth:login:success",
  "severity": "low",
  "details": {
    "userId": "user-123",
    "method": "password",
    "mfa": true
  },
  "context": {
    "ip": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "sessionId": "sess-abc",
    "userId": "user-123"
  },
  "checksum": "a1b2c3d4e5f6"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO 8601 | Время события |
| `event` | string | Тип события |
| `severity` | enum | Уровень важности |
| `details` | object | Детали события (sanitized) |
| `context` | object | Контекст (IP, session, user) |
| `checksum` | hex16 |Checksum для целостности |

---

## Log Management

### Rotation

```javascript
// Manual rotation
const result = await auditLogger.rotate();
console.log('Rotated to:', result.path);
// Output: Rotated to: ./logs/security.log.2026-02-20T12-00-00-000Z
```

### Integrity Verification

```javascript
// Verify log integrity
const results = await auditLogger.verifyLogIntegrity();
console.log(`Valid: ${results.valid}, Invalid: ${results.invalid}`);

// Output:
// Valid: 1000, Invalid: 0
```

### Statistics

```javascript
// Get audit statistics
const stats = await auditLogger.getStats();
console.log(stats);

// Output:
// {
//   total: 1000,
//   byType: {
//     'auth:login:success': 500,
//     'auth:login:failed': 100,
//     ...
//   },
//   bySeverity: {
//     low: 800,
//     medium: 150,
//     high: 45,
//     critical: 5
//   },
//   timeRange: {
//     start: '2026-02-01T00:00:00.000Z',
//     end: '2026-02-20T23:59:59.000Z'
//   }
// }
```

### Search

```javascript
// Search audit logs
const results = await auditLogger.search({
  eventType: 'auth:login:failed',
  severity: 'medium',
  ip: '192.168.1.1'
});

console.log(`Found ${results.length} failed logins from this IP`);
```

---

## Real-time Monitoring

### Event Subscription

```javascript
const auditLogger = getSecurityAuditLogger();

// Subscribe to all events
auditLogger.on('event', (entry) => {
  if (entry.severity === 'critical') {
    // Send alert
    sendAlert(entry);
  }
});

// Subscribe to specific events
auditLogger.on('logged', ({ eventType, details }) => {
  console.log(`Event: ${eventType}`, details);
});

// Subscribe to flush events
auditLogger.on('flushed', ({ count }) => {
  console.log(`Flushed ${count} entries to disk`);
});
```

---

## Security Considerations

### Sensitive Data Redaction

Автоматически redactятся поля:
- `password`
- `secret`
- `token`
- `key`
- `private`
- `accessToken`, `refreshToken`, `apiKey`
- `mnemonic`

Пример:
```javascript
await auditLogger.logAuthSuccess({
  password: 'my-secret-password' // Будет заменено на [REDACTED]
});

// Log entry:
// { "details": { "password": "[REDACTED]" } }
```

### Integrity Protection

Каждая запись содержит checksum для обнаружения модификаций:
```javascript
checksum = SHA256(timestamp + event + details).slice(0, 16)
```

При верификации:
- Вычисляется новый checksum
- Сравнивается с сохранённым
- Несоответствие = tampering detected

---

## Compliance

### SOC 2 Type II

Security audit logging покрывает требования:
- **CC6.1** — Logical access security
- **CC6.2** — Prior to access authorization
- **CC6.3** — Internal and external users
- **CC7.1** — Detection of unauthorized activities
- **CC7.2** — Monitoring of system components

### ISO 27001

Покрытие требований:
- **A.12.4.1** — Event logging
- **A.12.4.2** — Protection of log information
- **A.12.4.3** — Administrator and operator logs

---

## Best Practices

### 1. Включить логирование всех событий безопасности

```javascript
// ✅ Good
await auditLogger.logAuthSuccess({...});
await auditLogger.logAuthFailure({...});
await auditLogger.logAccessDenied({...});

// ❌ Bad - missing audit trail
if (authenticated) {
  grantAccess();
}
```

### 2. Включать контекст (IP, session)

```javascript
// ✅ Good
await auditLogger.logAuthSuccess({
  userId: 'user-123',
  ip: req.ip,
  sessionId: req.sessionId
});

// ❌ Bad - no context for forensics
await auditLogger.logAuthSuccess({ userId: 'user-123' });
```

### 3. Использовать правильную severity

```javascript
// ✅ Good - failed login is MEDIUM
await auditLogger.logAuthFailure({...}); // severity: 'medium'

// ❌ Bad - don't use 'low' for security events
await auditLogger.log(AuditEventType.AUTH_LOGIN_FAILED, {...}, {...});
// Default severity is 'medium', which is correct
```

### 4. Регулярная ротация логов

```bash
# Daily rotation via cron
0 0 * * * /usr/bin/node /path/to/rotate-audit-logs.js
```

### 5. Мониторинг критических событий

```javascript
auditLogger.on('event', (entry) => {
  if (entry.severity === 'critical') {
    // Immediate alert
    slack.notify(`🚨 Critical security event: ${entry.event}`, entry);
  }
});
```

---

## Troubleshooting

### Logs not being written

1. Check `enabled` option
2. Verify directory permissions
3. Check disk space
4. Review error events: `auditLogger.on('error', ...)`

### High memory usage

1. Reduce `bufferSize` (default: 10)
2. Reduce `flushTimeout` (default: 5000ms)
3. Enable streaming to disk

### Checksum mismatches

1. Check for disk corruption
2. Verify no manual edits
3. Check for race conditions with multiple writers

---

## API Reference

### Methods

| Method | Description |
|--------|-------------|
| `log(eventType, details, context)` | Log custom event |
| `logAuthSuccess(options)` | Log auth success |
| `logAuthFailure(options)` | Log auth failure |
| `logAccessDenied(options)` | Log access denied |
| `logSecurityIncident(options)` | Log security incident |
| `logRateLimit(options)` | Log rate limit |
| `verifyLogIntegrity()` | Verify checksums |
| `rotate()` | Rotate log file |
| `getStats(timeRange)` | Get statistics |
| `search(query)` | Search logs |
| `close()` | Close and flush |

### Events

| Event | Description |
|-------|-------------|
| `logged` | Entry logged |
| `event` | New event entry |
| `flushed` | Buffer flushed |
| `rotated` | Log rotated |
| `error` | Error occurred |
| `closed` | Logger closed |

---

*Document Version: 1.0*  
*Last Updated: 20 февраля 2026 г.*
