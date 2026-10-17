# Security

Keylink stores second-factor secrets. Report vulnerabilities through a private GitHub security advisory on this repository, not in a public issue.

Include the version, a reproduction, and what an attacker would gain. Give maintainers a chance to ship a fix before you publish details.

The development master key and `dev-admin-password` are not vulnerabilities when you have not set `NODE_ENV=production`. Production startup refuses to run without `KEYLINK_MASTER_KEY` and `KEYLINK_ADMIN_PASSWORD`.
