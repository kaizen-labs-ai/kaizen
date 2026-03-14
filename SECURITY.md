# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Kaizen, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email us at: **security@kaizen-agent.ai**

Please include:
- A description of the vulnerability
- Steps to reproduce
- Any potential impact

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Practices

- Secrets are stored in an encrypted local vault (AES-256-GCM), never in environment variables or source code
- No telemetry or data collection
- All AI API calls go through your own API keys
- The application runs entirely locally
