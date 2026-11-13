# Contributing to Jotna

Thank you for contributing to Jotna.

## Scope

Jotna is a real-world delivery escrow product for social sellers. Contributions should improve trust, security, seller experience, or the buyer release flow.

## How to contribute

1. Fork the repository and create your feature branch.
2. Follow the repository coding standards.
3. Keep changes small and focused.
4. Update relevant documentation when the product or workflow changes.
5. Open a pull request with a clear summary and validation notes.

## Local development

```bash
npm install
npm run dev:stack
npm run dev:api
npm run dev:web
```

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm run build
```

## Coding standards

- Prefer explicit, durable business logic.
- Keep security-sensitive flows auditable.
- Do not add pooled funds or custody assumptions.
- Preserve idempotency in wallet and order-sensitive operations.
- Add or update tests when behavior changes.

## Pull request expectations

- Explain the business problem and the technical fix.
- Include validation output.
- Describe edge cases and security implications.
- Keep the scope narrow and reviewable.

## Community expectations

Follow the project code of conduct and treat all contributors with respect.
