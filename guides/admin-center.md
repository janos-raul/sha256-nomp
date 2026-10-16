# Admin Center

Back to the [README](../README.md).

SHA256-NOMP includes a web-based administration panel for managing your pool. Access it at `http://yourpool.com/admin`.

## Features

- View and manage active pools
- Monitor pool statistics
- Add/modify pool configurations
- Secure bcrypt password authentication

## Setting Up Admin Center

**Step 1: Generate a Password Hash**

For security, admin passwords are stored as bcrypt hashes, not plain text. Use the included tool to generate your hash:

```bash
cd nomp-password
node generate-password-hash.js
```

The tool will:

1. Prompt you to enter your desired password
2. Generate a secure bcrypt hash
3. Show you the hash to use in your config

Example output:

```
================================================================================
SHA256-NOMP Admin Password Hash Generator
================================================================================

Enter your desired admin password: ********

Generating bcrypt hash (this may take a moment)...

================================================================================
Password Hash Generated Successfully!
================================================================================

Your bcrypt hash is:

  $2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqvZjCn4Y5XpLz8DJDm7X8NlZPvDK

================================================================================
```

**Step 2: Configure config.json**

Add the hash to your `config.json`:

```javascript
"website": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 80,
    "stratumHost": "yourpool.com",
    "stats": {
        "updateInterval": 15,
        "historicalRetention": 43200,
        "hashrateWindow": 300
    },
    "adminCenter": {
        "enabled": true,
        "passwordHash": "$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqvZjCn4Y5XpLz8DJDm7X8NlZPvDK"
    }
}
```

> **IMPORTANT:** Use `"passwordHash"` (not `"password"`) to enable secure bcrypt authentication.

**Step 3: Access Admin Panel**

1. Navigate to `http://yourpool.com/admin`
2. Enter your original password (not the hash!)
3. Optionally check "Stay Logged In" to save session

## Security Notes

- **Never share your password hash publicly** (though it's much safer than plain text)
- Use a strong password (20+ characters recommended)
- Each hash generation produces a different result (this is normal and secure)
- If you forget your password, simply generate a new hash
- The admin panel uses cookies for session management
- For production, always use HTTPS to protect credentials in transit

## Legacy Plain Text Password (Not Recommended)

For backwards compatibility, you can still use plain text passwords:

```javascript
"adminCenter": {
    "enabled": true,
    "password": "your-plain-text-password"  // NOT RECOMMENDED
}
```

> **WARNING:** Plain text passwords are stored in your config file and could be exposed. Always use `passwordHash` for production deployments.
