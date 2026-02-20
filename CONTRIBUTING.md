# Contributing to NewZoneCore

**Version:** 1.0  
**Last Updated:** 20 февраля 2026 г.

Thank you for your interest in contributing to NewZoneCore! This document provides guidelines and instructions for contributing.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Security](#security)
- [Pull Request Process](#pull-request-process)
- [Documentation](#documentation)

---

## Code of Conduct

### Our Pledge

We pledge to make participation in NewZoneCore a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

Examples of behavior that contributes to creating a positive environment:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

Examples of unacceptable behavior:

- The use of sexualized language or imagery and unwelcome sexual attention
- Trolling, insulting/derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission
- Other conduct which could reasonably be considered inappropriate

---

## Getting Started

### 1. Fork the Repository

```bash
# Click "Fork" on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/NewZoneCore.git
cd NewZoneCore
```

### 2. Set Up Upstream

```bash
# Add the original repository as upstream
git remote add upstream https://github.com/NewZoneProject/NewZoneCore.git
git fetch upstream
```

### 3. Create a Branch

```bash
# Always work on a feature branch
git checkout -b feature/your-feature-name
```

**Branch naming conventions:**
- `feature/description` — New features
- `fix/description` — Bug fixes
- `security/description` — Security improvements
- `docs/description` — Documentation
- `test/description` — Tests
- `refactor/description` — Code refactoring

---

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or bun
- Git

### Installation

```bash
# Install dependencies
npm install

# Initialize development environment
npm run bootstrap

# Verify setup
npm test
```

### Project Structure

```
NewZoneCore/
├── core/                    # Core modules
│   ├── crypto/             # Cryptographic functions
│   ├── api/                # HTTP and IPC APIs
│   ├── utils/              # Utilities (validator, audit)
│   └── ...
├── tests/                   # Test suites
├── docs/                    # Documentation
├── network/                 # Network layer
└── ...
```

---

## Code Style

### JavaScript Style Guide

We follow modern ES6+ conventions with JSDoc documentation.

#### General Rules

```javascript
// ✅ DO: Use ES6+ features
const value = compute();
async function fetchData() { }

// ✅ DO: Use JSDoc comments
/**
 * Derive encryption key from master key.
 * @param {Buffer} masterKey - Master key (32 bytes)
 * @param {Buffer} nonce - Nonce for this encryption
 * @returns {Buffer} Derived encryption key
 */
function deriveEncryptionKey(masterKey, nonce) { }

// ✅ DO: Use const/let, not var
const CONSTANT = 'value';
let mutable = 'can change';

// ✅ DO: Use template literals
const message = `Hello, ${name}!`;

// ❌ DON'T: Don't use var
var old = 'style';  // Wrong!

// ❌ DON'T: Don't use string concatenation
const wrong = 'Hello, ' + name + '!';  // Use template literals!
```

#### Error Handling

```javascript
// ✅ DO: Use try-catch for async operations
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', { error: error.message });
  throw error;
}

// ✅ DO: Use custom error classes
import { ValidationError } from './utils/error.js';

if (!isValid) {
  throw new ValidationError('Invalid input', { field: 'email' });
}

// ❌ DON'T: Don't swallow errors
try {
  operation();
} catch (error) {
  // Silent - WRONG!
}
```

#### Naming Conventions

```javascript
// Classes: PascalCase
class SecureBuffer { }

// Functions/variables: camelCase
function deriveKey() { }
const masterKey = Buffer.alloc(32);

// Constants: UPPER_SNAKE_CASE
const MAX_PEERS = 1000;
const ALGORITHM = 'chacha20-poly1305';

// Private fields: underscore prefix
this._buffer = Buffer.alloc(32);

// Files: lowercase with hyphens
// security-audit.js, not SecurityAudit.js
```

### Security-Specific Guidelines

```javascript
// ✅ DO: Validate all input
import { validatePeerId } from './utils/validator.js';

validatePeerId(peerId);  // Always validate!

// ✅ DO: Use SecureBuffer for sensitive data
const secretBuf = new SecureBuffer(32);
try {
  // Use secret
} finally {
  secretBuf.free();  // Always clean up!
}

// ✅ DO: Log security events
await auditLogger.logAuthSuccess({ userId, ip });

// ❌ DON'T: Never log sensitive data
logger.error('Auth failed', { password });  // NEVER!
```

---

## Testing

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Security tests only
npm run test:security

# With coverage
npm run test:coverage
```

### Writing Tests

We use Vitest for testing.

```javascript
// tests/example.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { SecureBuffer } from '../core/crypto/keys.js';

describe('SecureBuffer', () => {
  let buf;

  beforeEach(() => {
    buf = new SecureBuffer(32);
  });

  it('should create buffer of specified size', () => {
    expect(buf.length).toBe(32);
  });

  it('should throw error after free', () => {
    buf.free();
    expect(() => buf.buffer).toThrow('SecureBuffer has been freed');
  });
});
```

### Test Requirements

- **New features:** Must include tests
- **Bug fixes:** Must include regression tests
- **Security code:** Must have 90%+ coverage
- **Minimum coverage:** 80% overall

### Test Categories

1. **Unit Tests** — Test individual functions
2. **Integration Tests** — Test module interactions
3. **Security Tests** — Test security controls
4. **Performance Tests** — Test performance characteristics

---

## Security

### Security Requirements

All contributions MUST:

1. **Not introduce security vulnerabilities**
2. **Follow security best practices**
3. **Include security tests if modifying security code**
4. **Pass security review**

### Security Review Process

```
PR Submitted → Automated Checks → Security Review → Approval → Merge
                    ↓                   ↓
               Tests pass         Security team
               Lint pass          review
               Coverage ok
```

### Reporting Security Issues

**DO NOT** create public issues for security vulnerabilities.

**DO:**
- Email: security@newzonecore.dev
- GitHub Security Advisories: https://github.com/NewZoneProject/NewZoneCore/security/advisories

See [SECURITY.md](./SECURITY.md) for details.

---

## Pull Request Process

### Before Submitting

```bash
# 1. Update your branch
git fetch upstream
git rebase upstream/main

# 2. Run tests
npm test

# 3. Run linter
npm run lint

# 4. Check coverage
npm run test:coverage

# 5. Update documentation
# - README.md if API changed
# - JSDoc comments
# - Add changelog entry
```

### PR Checklist

Before submitting your PR, ensure:

- [ ] Tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Coverage is adequate (>80%)
- [ ] Code follows style guide
- [ ] JSDoc comments added
- [ ] Documentation updated
- [ ] Security review completed (if applicable)
- [ ] Commit messages are clear

### Commit Message Format

We use conventional commits:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `style` — Formatting
- `refactor` — Code refactoring
- `test` — Tests
- `security` — Security improvements

**Examples:**

```bash
# Good commits
feat(storage): add encryption for trust.json
fix(auth): prevent timing attack in token validation
docs(security): add security logging guide
test(crypto): add HKDF test vectors
security(master-key): remove hardcoded salt

# Bad commits
fixed stuff
updated code
WIP
```

### PR Review

1. **Automated Checks** — Tests, linting, coverage
2. **Code Review** — At least 1 maintainer approval
3. **Security Review** — For security-related changes
4. **Final Check** — Maintainer merges

### Review Timeline

- **Bug fixes:** 1-3 days
- **Features:** 3-7 days
- **Security fixes:** 24-48 hours (expedited)

---

## Documentation

### Code Documentation

```javascript
/**
 * Derive master key from password using scrypt.
 *
 * SECURITY: Uses per-user unique salt to prevent rainbow table attacks.
 *
 * @param {string} password - User password (min 8 characters)
 * @param {Buffer} salt - 32-byte unique salt
 * @returns {Promise<{key: Buffer, salt: Buffer}>}
 * @throws {Error} If password is empty or salt is missing
 *
 * @example
 * const { key, salt } = await deriveMasterKey('password', salt);
 */
export async function deriveMasterKey(password, salt) { }
```

### README Updates

Update README.md when:

- Adding new features
- Changing API
- Adding configuration options
- Changing installation process

### Documentation Files

- `README.md` — Main documentation
- `docs/` — Detailed documentation
- `docs/audits/` — Security audit reports
- `SECURITY.md` — Security policy
- `CONTRIBUTING.md` — This file

---

## Additional Resources

### Learning Resources

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cryptographic Right Answers](https://latacora.micro.blog/2018/04/03/cryptographic-right-answers.html)

### Tools

- **ESLint** — Code linting
- **Vitest** — Testing framework
- **Node.js crypto** — Cryptographic operations

### Getting Help

- **GitHub Issues** — For bugs and feature requests
- **GitHub Discussions** — For questions
- **Email** — For security issues (security@newzonecore.dev)

---

## Recognition

Contributors are recognized in:

- **README.md** — Notable contributors section
- **Release Notes** — Major contributions
- **GitHub Contributors** — Automatic tracking

---

## Questions?

If you have questions:

1. Check existing documentation
2. Search GitHub Issues/Discussions
3. Ask in GitHub Discussions
4. For security questions, email security@newzonecore.dev

---

*Thank you for contributing to NewZoneCore!*

*This document is based on best practices from the open-source community.*

*Last updated: 20 февраля 2026 г.*
