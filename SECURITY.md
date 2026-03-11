# Security Policy

## Supported Versions

Current active branch: `main`

## Reporting a Vulnerability

If you find a security issue, please **do not open a public issue with exploit details**.

Recommended contact path:

1. Open a GitHub issue with minimal description and mark it as security-related.
2. Or contact repository owner directly via GitHub profile message.
3. Include:
   - affected endpoint / file
   - reproduction steps
   - impact assessment
   - suggested fix (if available)

## Secret Handling Rules

- Never commit real API keys, tokens, passwords, private keys, or credentials.
- Use environment variables for secrets.
- Keep `.env` and local machine configs out of git.
- Before commit, run:

```bash
npm run check:secrets
```

A pre-commit hook is provided to block common leaked-secret patterns.
Install it once per clone:

```bash
npm run hooks:install
```
