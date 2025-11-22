# NOMP Admin Password Hash Generator

## Overview

This tool generates secure bcrypt password hashes for your SHA256-NOMP admin panel. Using password hashing instead of plain text passwords significantly improves security.

## Password Generation Process

### Step 1: Generate Your Password Hash

Run the password hash generator:

```bash
node generate-password-hash.js
```

You will be prompted to enter your desired admin password. The tool will then generate a bcrypt hash.

**Example output:**
```
================================================================================
SHA256-NOMP Admin Password Hash Generator
================================================================================

This tool will generate a secure bcrypt hash for your admin password.
The hash will be stored in your config file instead of the plain text password.

Enter your desired admin password: [type your password]

Generating bcrypt hash (this may take a moment)...

================================================================================
Password Hash Generated Successfully!
================================================================================

Your bcrypt hash is:

  $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
```

### Step 2: Update Your Configuration

Open your `config.json` file and locate the `adminCenter` section.

**Replace this (plain text - not secure):**
```json
"adminCenter": {
    "enabled": true,
    "password": "mySecretPassword123"
}
```

**With this (hashed - secure):**
```json
"adminCenter": {
    "enabled": true,
    "passwordHash": "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
}
```

**Important:**
- Change the field name from `"password"` to `"passwordHash"`
- Paste the **entire** hash (starts with `$2a$`)
- Remove the old `"password"` line

### Step 3: Restart Your Pool

```bash
npm start
```

### Step 4: Test Admin Login

1. Navigate to your admin panel: `http://your-pool-address:port/admin`
2. Enter your **original password** (not the hash)
3. You should be logged in successfully

## Important Notes

- ✓ You log in with your **original password**, not the hash
- ✓ The hash cannot be reversed to get the password
- ✓ Each time you generate a hash for the same password, it will be different (this is normal - it's called "salting")
- ✓ If you forget your password, run this tool again to generate a new hash
- ✓ Store your password securely (use a password manager)

## Password Requirements (Recommended)

- **Minimum:** 12 characters
- **Recommended:** 20+ characters
- **Mix:** Uppercase, lowercase, numbers, and symbols

**Good example:**
```
xK9#mP2$vL8@qR5&wN3!tY7^nB4%
```

**Bad examples:**
```
password123
admin
MyPoolPassword
```

## Security Benefits

✓ Password is no longer stored in plain text
✓ Config file theft doesn't reveal your password
✓ Industry-standard bcrypt encryption
✓ Brute force attacks are extremely slow

## Backward Compatibility

The pool still supports the old `"password"` field for backward compatibility. However, you will see a warning in the logs:

```
[WARNING] Using legacy plain text password - consider upgrading to passwordHash
```

You can upgrade to `passwordHash` whenever you're ready - no rush!

## Troubleshooting

**Problem:** Login fails with correct password
**Solution:**
- Verify you changed `"password"` to `"passwordHash"` in config
- Make sure the entire hash was copied (should start with `$2a$`)
- Check logs for specific error messages

**Problem:** "No password or passwordHash configured in adminCenter"
**Solution:** Make sure your config has either `"password"` or `"passwordHash"` field

**Problem:** Want to change password
**Solution:**
1. Run: `node generate-password-hash.js`
2. Enter new password
3. Replace `passwordHash` value in config
4. Restart pool

---