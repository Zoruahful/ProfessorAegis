# Security

Do not commit real Discord tokens, database passwords, private server IDs, local `.env` files, generated databases, logs, or exported archives.

If a credential was ever committed or shared publicly, rotate it from the original provider before continuing:

- Discord bot tokens: reset the token in the Discord Developer Portal.
- Database passwords: change the local or hosted database user password.
- GitHub tokens or SSH keys: revoke and recreate them from GitHub settings.

For vulnerability reports, open an issue with reproduction steps only. Do not include working credentials, private tokens, private server links, or raw `.env` values.
