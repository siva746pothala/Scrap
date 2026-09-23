/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/r2-presign", (c) => {
    const filename = c.queryParam("filename");
    if (!filename) {
        return c.json(400, { error: "filename query param is required" });
    }

    const method = (c.queryParam("method") || "PUT").toUpperCase();

    const accessKey = $os.getenv("R2_ACCESS_KEY_ID");
    const secretKey = $os.getenv("R2_SECRET_ACCESS_KEY");
    const endpoint = $os.getenv("R2_ENDPOINT");
    const bucket = $os.getenv("R2_BUCKET");

    if (!accessKey || !secretKey || !endpoint || !bucket) {
        return c.json(500, { error: "R2 credentials missing on server." });
    }

    try {
        // --- Standard AWS SigV4 Cryptographic Core ---
        function sha256(data) {
            return hmac(data, null, false);
        }

        function hmac(data, key, isRaw) {
            function core_sha256(words, len) {
                const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
                const K = [
                    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
                    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
                    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
                    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
                    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
                    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
                    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
                    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
                ];

                const w = new Array(64);
                words[len >> 5] |= 0x80 << (24 - (len % 32));
                words[(((len + 64) >> 9) << 4) + 15] = len;

                for (let i = 0; i < words.length; i += 16) {
                    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

                    for (let j = 0; j < 64; j++) {
                        if (j < 16) {
                            w[j] = words[i + j] | 0;
                        } else {
                            const gamma0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3);
                            const gamma1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10);
                            w[j] = (gamma0 + w[j - 7] + gamma1 + w[j - 16]) | 0;
                        }

                        const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                        const ch = (e & f) ^ (~e & g);
                        const t1 = (h + s1 + ch + K[j] + w[j]) | 0;
                        const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                        const maj = (a & b) ^ (a & c) ^ (b & c);
                        const t2 = (s0 + maj) | 0;

                        h = g; g = f; f = e; e = (d + t1) | 0;
                        d = c; c = b; b = a; a = (t1 + t2) | 0;
                    }

                    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
                    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
                    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
                    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
                }
                return H;
            }

            function str2binb(str) {
                const bin = [];
                for (let i = 0; i < str.length * 8; i += 8) {
                    bin[i >> 5] |= (str.charCodeAt(i / 8) & 0xFF) << (24 - (i % 32));
                }
                return { words: bin, sigBytes: str.length };
            }

            const dataObj = (typeof data === "string") ? str2binb(data) : { words: data.slice(0), sigBytes: data.length * 4 };

            if (!key) {
                const hashWords = core_sha256(dataObj.words.slice(0), dataObj.sigBytes * 8);
                if (isRaw) return hashWords;
                return hashWords.map(w => ('00000000' + (w >>> 0).toString(16)).slice(-8)).join('');
            }

            let keyObj = (typeof key === "string") ? str2binb(key) : { words: key.slice(0), sigBytes: key.length * 4 };
            if (keyObj.sigBytes > 64) {
                keyObj.words = core_sha256(keyObj.words, keyObj.sigBytes * 8);
                keyObj.sigBytes = 32;
            }

            const ipad = new Array(16), opad = new Array(16);
            for (let i = 0; i < 16; i++) {
                ipad[i] = (keyObj.words[i] || 0) ^ 0x36363636;
                opad[i] = (keyObj.words[i] || 0) ^ 0x5c5c5c5c;
            }

            const innerHash = core_sha256(ipad.concat(dataObj.words), 512 + dataObj.sigBytes * 8);
            const outerHash = core_sha256(opad.concat(innerHash), 512 + 256);

            if (isRaw) return outerHash;
            return outerHash.map(w => ('00000000' + (w >>> 0).toString(16)).slice(-8)).join('');
        }

        // --- SigV4 Presign URL Construction ---
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const datestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
        const amzDate = `${datestamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

        const host = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const region = "auto";
        const service = "s3";

        const cleanFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        const canonicalUri = `/${bucket}/${cleanFilename}`;
        const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
        const fullCredential = `${accessKey}/${credentialScope}`;

        function encodeRfc3986(str) {
            return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        }

        const queryParamsMap = {
            'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': fullCredential,
            'X-Amz-Date': amzDate,
            'X-Amz-Expires': '900',
            'X-Amz-SignedHeaders': 'host'
        };

        const sortedKeys = Object.keys(queryParamsMap).sort();
        const canonicalQueryString = sortedKeys
            .map(k => `${encodeRfc3986(k)}=${encodeRfc3986(queryParamsMap[k])}`)
            .join('&');

        const canonicalHeaders = `host:${host}\n`;
        const signedHeaders = `host`;
        const payloadHash = "UNSIGNED-PAYLOAD";

        const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
        const hashedCanonicalRequest = sha256(canonicalRequest);

        const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hashedCanonicalRequest}`;

        // Binary derived keys
        const kDate = hmac(datestamp, "AWS4" + secretKey, true);
        const kRegion = hmac(region, kDate, true);
        const kService = hmac(service, kRegion, true);
        const kSigning = hmac("aws4_request", kService, true);
        const signature = hmac(stringToSign, kSigning, false);

        const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

        return c.json(200, {
            uploadUrl: uploadUrl,
            key: cleanFilename
        });
    } catch (err) {
        return c.json(500, { error: err.message || "Failed to generate presigned URL" });
    }
});
