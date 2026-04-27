# Security

If you find a security issue in Hunch It, please report it privately instead of posting it publicly.

Email the maintainers with:

- What you found
- Steps to reproduce it
- Any relevant logs, screenshots, or transaction links
- Why you think it matters

## Notes

- Hunch uses Privy for authentication and wallet access. Private keys should never touch the Hunch server.
- Keep API keys, database URLs, and `WS_CRON_SECRET` out of client bundles and public commits.
- Use small amounts when testing live trading flows.
