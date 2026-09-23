/**
 * PocketBase Server Hook: Email OTP Vault Protection & Per-Email Master Vault Key Backup
 * Features:
 * - /api/sync-user-vault: Saves/updates encrypted master vault payload per user email
 * - /api/request-vault-otp: Generates 6-digit OTP code, hashes it, & sends via PocketBase SMTP
 * - /api/verify-vault-otp: Verifies OTP, checks 5-min TTL, limits to 3 attempts, sends Admin Alert email on intrusion
 */

// 1. Endpoint: Sync Master Vault to Server (Per-Email Storage)
routerAdd("POST", "/api/sync-user-vault", (c) => {
    try {
        const info = $apis.requestInfo(c);
        const data = info.data || {};
        const email = (data.email || "").trim().toLowerCase();
        const encryptedVaultBase64 = data.vault || "";
        const saltBase64 = data.salt || "";

        if (!email || !encryptedVaultBase64) {
            return c.json(400, { message: "Email and vault payload are required." });
        }

        // Find existing record or create new
        let record;
        try {
            record = $app.dao().findFirstRecordByData("user_vault_keys", "email", email);
        } catch (_) {
            record = null;
        }

        const collection = $app.dao().findCollectionByNameOrId("user_vault_keys");

        if (!record) {
            record = new Record(collection);
            record.set("email", email);
        }

        record.set("encryptedVault", encryptedVaultBase64);
        record.set("salt", saltBase64);
        record.set("updatedAt", new Date().toISOString());

        $app.dao().saveRecord(record);

        return c.json(200, { success: true, message: "Master vault synced successfully." });
    } catch (err) {
        return c.json(500, { message: "Failed to sync vault: " + err.message });
    }
});

// 2. Endpoint: Request Email OTP for Key Recovery
routerAdd("POST", "/api/request-vault-otp", (c) => {
    try {
        const info = $apis.requestInfo(c);
        const data = info.data || {};
        const email = (data.email || "").trim().toLowerCase();

        if (!email) {
            return c.json(400, { message: "Email address is required." });
        }

        // Verify that a vault exists for this email
        let vaultRecord;
        try {
            vaultRecord = $app.dao().findFirstRecordByData("user_vault_keys", "email", email);
        } catch (_) {
            vaultRecord = null;
        }

        if (!vaultRecord) {
            return c.json(404, { message: "No cloud vault backup found for this account." });
        }

        // Generate 6-digit random code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpSalt = "SCRAP_VAULT_OTP_SALT_2026";
        const otpHash = $security.hs256(otpCode, otpSalt);

        // Delete any existing OTP records for this email
        try {
            const oldRecords = $app.dao().findRecordsByFilter("otp_verifications", "email = {:email}", "-created", 100, 0, { email: email });
            for (let i = 0; i < oldRecords.length; i++) {
                $app.dao().deleteRecord(oldRecords[i]);
            }
        } catch (_) {}

        // Save new OTP record with 5-minute expiration
        const otpCollection = $app.dao().findCollectionByNameOrId("otp_verifications");
        const otpRecord = new Record(otpCollection);
        otpRecord.set("email", email);
        otpRecord.set("otpHash", otpHash);
        otpRecord.set("attempts", 0);
        otpRecord.set("expiresAt", new Date(Date.now() + 5 * 60 * 1000).toISOString()); // +5 mins

        $app.dao().saveRecord(otpRecord);

        // Send Email via PocketBase SMTP Client
        const htmlBody = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f0a1c; border-radius: 16px; padding: 32px; color: #ffffff; border: 1px solid rgba(255,255,255,0.1);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h1 style="color: #fbbf24; font-size: 24px; margin: 0; font-weight: 800;">🔒 Scrap App Security OTP</h1>
                    <p style="color: #9ca3af; font-size: 13px; margin-top: 6px;">Key Vault Protection & Recovery Code</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 24px; text-align: center; border: 1px solid rgba(251, 191, 36, 0.2);">
                    <p style="color: #e5e7eb; font-size: 14px; margin-bottom: 12px;">Your 6-digit verification code is:</p>
                    <div style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #39ff14; font-family: monospace; padding: 12px 0;">${otpCode}</div>
                    <p style="color: #9ca3af; font-size: 11px; margin-top: 12px;">⏱ Code expires in <strong>5 minutes</strong>. Do not share this code with anyone.</p>
                </div>
                <p style="color: #6b7280; font-size: 11px; text-align: center; margin-top: 24px;">If you did not request key recovery, please ignore this email.</p>
            </div>
        `;

        const message = new MailerMessage({
            from: {
                address: $app.settings().meta.senderAddress || "noreply@myscrapmemories.com",
                name: $app.settings().meta.senderName || "Scrap App Security"
            },
            to: [{ address: email }],
            subject: "🔒 Your Scrap App Vault Verification Code: " + otpCode,
            html: htmlBody,
        });

        $app.newMailClient().send(message);

        return c.json(200, { success: true, otpId: otpRecord.id, message: "OTP sent to email successfully." });
    } catch (err) {
        return c.json(500, { message: "Failed to send OTP email: " + err.message });
    }
});

// 3. Endpoint: Verify OTP & Return Encrypted Master Vault Package
routerAdd("POST", "/api/verify-vault-otp", (c) => {
    try {
        const info = $apis.requestInfo(c);
        const data = info.data || {};
        const email = (data.email || "").trim().toLowerCase();
        const otpCode = (data.otpCode || "").trim();
        const otpId = data.otpId || "";
        const clientIp = info.remoteIP || "Unknown IP";

        if (!email || !otpCode) {
            return c.json(400, { message: "Email and OTP code are required." });
        }

        // Find active OTP record
        let otpRecord;
        try {
            if (otpId) {
                otpRecord = $app.dao().findRecordById("otp_verifications", otpId);
            } else {
                otpRecord = $app.dao().findFirstRecordByData("otp_verifications", "email", email);
            }
        } catch (_) {
            otpRecord = null;
        }

        if (!otpRecord) {
            return c.json(400, { message: "No active OTP request found. Please request a new code." });
        }

        // Check Expiration
        const expiresAt = new Date(otpRecord.get("expiresAt")).getTime();
        if (Date.now() > expiresAt) {
            $app.dao().deleteRecord(otpRecord);
            return c.json(400, { message: "OTP code has expired. Please request a new code." });
        }

        // Check Attempts Counter (Max 3 failed attempts)
        let attempts = otpRecord.getInt("attempts") + 1;
        otpRecord.set("attempts", attempts);
        $app.dao().saveRecord(otpRecord);

        const otpSalt = "SCRAP_VAULT_OTP_SALT_2026";
        const inputHash = $security.hs256(otpCode, otpSalt);

        if (inputHash !== otpRecord.getString("otpHash")) {
            // INTRUSION DETECTION: If 3 consecutive failed attempts occur, trigger Emergency Admin Alert Email!
            if (attempts >= 3) {
                $app.dao().deleteRecord(otpRecord); // Destroy OTP

                // Send Security Intrusion Alert Email to PocketBase Admin
                try {
                    const adminEmail = $app.settings().meta.senderAddress || "admin@myscrapmemories.com";
                    const alertBody = `
                        <div style="font-family: Arial, sans-serif; padding: 20px; background: #7f1d1d; color: #ffffff; border-radius: 8px;">
                            <h2>🚨 SECURITY ALERT: Unauthorized Vault Access Attempt Detected!</h2>
                            <p>An invalid OTP was entered 3 consecutive times for account:</p>
                            <p><strong>Target Email:</strong> ${email}</p>
                            <p><strong>Client IP Address:</strong> ${clientIp}</p>
                            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                            <hr style="border-color: rgba(255,255,255,0.2);" />
                            <p>The active OTP code has been immediately invalidated and access was blocked.</p>
                        </div>
                    `;
                    const alertMsg = new MailerMessage({
                        from: { address: adminEmail, name: "Scrap Intrusion Shield" },
                        to: [{ address: adminEmail }],
                        subject: "🚨 SECURITY INTRUSION ALERT: Max Failed OTP Attempts for " + email,
                        html: alertBody,
                    });
                    $app.newMailClient().send(alertMsg);
                } catch (adminMailErr) {
                    console.warn("Failed to send admin intrusion alert email:", adminMailErr);
                }

                return c.json(429, { message: "Too many failed attempts! Security alert triggered. Please request a new OTP." });
            }

            return c.json(400, { message: `Incorrect OTP code. (${3 - attempts} attempt(s) remaining)` });
        }

        // OTP VERIFIED SUCCESSFULLY! Fetch Master Vault record
        let vaultRecord;
        try {
            vaultRecord = $app.dao().findFirstRecordByData("user_vault_keys", "email", email);
        } catch (_) {
            vaultRecord = null;
        }

        if (!vaultRecord) {
            return c.json(404, { message: "Vault record not found for this account." });
        }

        // Delete OTP record immediately (Single-use security)
        $app.dao().deleteRecord(otpRecord);

        return c.json(200, {
            success: true,
            vault: vaultRecord.getString("encryptedVault"),
            salt: vaultRecord.getString("salt")
        });

    } catch (err) {
        return c.json(500, { message: "OTP verification failed: " + err.message });
    }
});
