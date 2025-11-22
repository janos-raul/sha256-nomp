#!/usr/bin/env node
/**
 * Password Hash Generator for SHA256-NOMP Admin Panel
 *
 * Usage:
 *   node generate-password-hash.js
 *
 * This script will:
 * 1. Prompt you to enter a password
 * 2. Generate a bcrypt hash of that password
 * 3. Show you the hash to put in your config file
 */

const bcrypt = require("bcryptjs");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log(
  "\n================================================================================"
);
console.log("SHA256-NOMP Admin Password Hash Generator");
console.log(
  "================================================================================\n"
);
console.log(
  "This tool will generate a secure bcrypt hash for your admin password."
);
console.log(
  "The hash will be stored in your config file instead of the plain text password.\n"
);

rl.question("Enter your desired admin password: ", (password) => {
  if (!password || password.trim() === "") {
    console.error("\nERROR: Password cannot be empty!");
    rl.close();
    process.exit(1);
  }

  // Validate password strength
  if (password.length < 12) {
    console.warn("\nWARNING: Your password is less than 12 characters.");
    console.warn(
      "For better security, consider using a longer password (20+ characters recommended).\n"
    );
  }

  // Generate salt and hash
  const saltRounds = 10; // Good balance between security and performance
  console.log("\nGenerating bcrypt hash (this may take a moment)...\n");

  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      console.error("\nERROR generating hash:", err.message);
      rl.close();
      process.exit(1);
    }

    console.log(
      "================================================================================"
    );
    console.log("Password Hash Generated Successfully!");
    console.log(
      "================================================================================\n"
    );
    console.log("Your bcrypt hash is:\n");
    console.log("  " + hash + "\n");
    console.log(
      "================================================================================"
    );
    console.log("NEXT STEPS:");
    console.log(
      "================================================================================\n"
    );
    console.log("1. Open your config.json file (or config_example.json)");
    console.log("\n2. Find the adminCenter section:\n");
    console.log('   "adminCenter": {');
    console.log('       "enabled": true,');
    console.log('       "password": "your-old-password"');
    console.log("   }\n");
    console.log("3. Replace it with:\n");
    console.log('   "adminCenter": {');
    console.log('       "enabled": true,');
    console.log('       "passwordHash": "' + hash + '"');
    console.log("   }\n");
    console.log('   NOTE: Change "password" to "passwordHash"\n');
    console.log("4. Save the config file");
    console.log("\n5. Restart your pool server:\n");
    console.log("   npm start\n");
    console.log(
      "6. Test admin login with your original password (not the hash!)"
    );
    console.log(
      "\n================================================================================"
    );
    console.log("IMPORTANT SECURITY NOTES:");
    console.log(
      "================================================================================\n"
    );
    console.log("- Keep your original password secret and secure");
    console.log("- The hash cannot be reversed to get the original password");
    console.log(
      "- If you forget your password, generate a new hash with this tool"
    );
    console.log(
      "- Each time you run this tool, you get a different hash (this is normal)"
    );
    console.log(
      "- Never share the hash publicly, though it's much safer than plain text"
    );
    console.log(
      "\n================================================================================\n"
    );

    rl.close();
  });
});

rl.on("close", () => {
  process.exit(0);
});
