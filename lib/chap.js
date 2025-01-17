"use strict";
const CryptoJS = require("crypto-js");
const crypto = require("crypto");
const md4 = require('js-md4');
var chap;
(function (chap) {
    let CHAP;
    (function (CHAP) {
        // See http://tools.ietf.org/html/rfc1994#section-2 and https://tools.ietf.org/html/rfc2865#section-7.2
        function ChallengeResponse(id, password, challenge) {
            var md5 = crypto.createHash("md5");
            md5.update(id.slice(0, 1)); // Take only the first octet as the CHAP ID.
            md5.update(password);
            md5.update(challenge);
            return md5.digest();
        }
        CHAP.ChallengeResponse = ChallengeResponse;
    })(CHAP = chap.CHAP || (chap.CHAP = {}));
    let MSCHAPv1;
    (function (MSCHAPv1) {
        // See http://tools.ietf.org/html/rfc2433  -  Appendix A
        function LmPasswordHash(password) {
            var ucasePassword = password.toUpperCase();
            var passwordBuffer = new Buffer(ucasePassword); // This should be OEM, but maybe utf8/unicode will do?
            var finalPasswordBuffer = new Buffer(14);
            finalPasswordBuffer.fill(0);
            passwordBuffer.copy(finalPasswordBuffer);
            var passwordHash1 = DesHash(passwordBuffer.slice(0, 7));
            var passwordHash2 = DesHash(passwordBuffer.slice(7, 14));
            var passwordHash = new Buffer(16);
            passwordHash1.copy(passwordHash, 0);
            passwordHash2.copy(passwordHash, 8);
            return passwordHash;
        }
        MSCHAPv1.LmPasswordHash = LmPasswordHash;
        function NtPasswordHash(password) {
            var passwordBuffer = new Buffer(password, "utf16le");
            var md4Hash;
            // md4Hash = crypto.createHash("md4");
            // md4Hash.update(passwordBuffer);
            // let m1 = md4Hash.digest();
            //
            // md4Hash = md4.create()
            // md4Hash.update(passwordBuffer);
            // let m2 = Buffer.from(md4Hash.arrayBuffer())
            // console.log(m1.toJSON(), m2.toJSON());
            // 20231003 mrh: these are equal
            try {
                md4Hash = crypto.createHash("md4");
                md4Hash.update(passwordBuffer);
                return md4Hash.digest();
            }
            catch (e) {
                md4Hash = md4.create();
                md4Hash.update(passwordBuffer);
                return Buffer.from(md4Hash.arrayBuffer());
            }
        }
        MSCHAPv1.NtPasswordHash = NtPasswordHash;
        function LmChallengeResponse(challenge, password) {
            var passwordHash = LmPasswordHash(password);
            return ChallengeResponse(challenge, passwordHash);
        }
        MSCHAPv1.LmChallengeResponse = LmChallengeResponse;
        function NtChallengeResponse(challenge, password) {
            var passwordHash = NtPasswordHash(password);
            return ChallengeResponse(challenge, passwordHash);
        }
        MSCHAPv1.NtChallengeResponse = NtChallengeResponse;
        function ChallengeResponse(challenge, passwordHash) {
            var zPasswordHash = new Buffer(21);
            zPasswordHash.fill(0);
            passwordHash.copy(zPasswordHash);
            var res1 = DesEncrypt(challenge, zPasswordHash.slice(0, 7)); //   1st 7 octets of zPasswordHash as key.
            var res2 = DesEncrypt(challenge, zPasswordHash.slice(7, 14)); //  2nd 7 octets of zPasswordHash as key.
            var res3 = DesEncrypt(challenge, zPasswordHash.slice(14, 21)); // 3rd 7 octets of zPasswordHash as key.
            var resBuffer = new Buffer(24);
            res1.copy(resBuffer, 0);
            res2.copy(resBuffer, 8);
            res3.copy(resBuffer, 16);
            return resBuffer;
        }
        MSCHAPv1.ChallengeResponse = ChallengeResponse;
        function DesHash(key) {
            return DesEncrypt(new Buffer("KGS!@#$%", "ascii"), key);
        }
        MSCHAPv1.DesHash = DesHash;
        function DesEncrypt(clear, key) {
            try {
                var des = crypto.createCipheriv("des-ecb", _ParityKey(key), new Buffer(0));
                des.setAutoPadding(false);
                return Buffer.concat([des.update(clear), des.final()]);
            }
            catch (e) {
                const encObject = CryptoJS.DES.encrypt(CryptoJS.enc.Base64.parse(clear.toString('base64')), CryptoJS.enc.Base64.parse(_ParityKey(key).toString('base64')), {
                    mode: CryptoJS.mode.ECB,
                    padding: CryptoJS.pad.NoPadding,
                });
                // @ts-ignore
                const encrypted = encObject.ciphertext.toString(CryptoJS.enc.Base64);
                //console.log('DesEncryptLib', encrypted)
                return Buffer.from(encrypted, 'base64');
                // return Buffer.from(
                //   CryptoJS.DES.encrypt(
                //     CryptoJS.lib.WordArray.create(clear),
                //     CryptoJS.lib.WordArray.create(_ParityKey(key)),
                //     { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
                //   ).toString()
                // )
            }
        }
        MSCHAPv1.DesEncrypt = DesEncrypt;
        function _ParityKey(key) {
            var parityKey = new Buffer(8);
            var next = 0;
            var working = 0;
            for (var i = 0; i < 7; i++) {
                working = key[i];
                parityKey[i] = (working >> i) | next | 1;
                next = working << (7 - i);
            }
            parityKey[i] = next | 1;
            return parityKey;
        }
        //#region "MPPE methods"
        /***
         * This is to generate a Session key for MPPE.
         *
         * See: https://www.ietf.org/rfc/rfc3079.txt Section 2 (esp. 2.4) for use information.
         *
         * @param initialSessionKey The initial key, derived from the LmPassword or the NtPassword (depending on 40, 56 or 128 bit key).
         * @param currentSessionKey If this is for a new session, then the current key is the same as the initial key.
         * @param lengthOfKey 8 for 40 and 56 bit keys, 16 for 128 bit keys.
         */
        function GetKey(initialSessionKey, currentSessionKey, lengthOfKey) {
            var SHApad1 = new Buffer(40);
            var SHApad2 = new Buffer(40);
            SHApad1.fill(0);
            SHApad2.fill(0xf2);
            var sha1 = crypto.createHash("sha1");
            sha1.update(initialSessionKey.slice(0, lengthOfKey));
            sha1.update(SHApad1);
            sha1.update(currentSessionKey.slice(0, lengthOfKey));
            sha1.update(SHApad2);
            return sha1.digest().slice(0, lengthOfKey);
        }
        MSCHAPv1.GetKey = GetKey;
        /**
         * This is to generate an initial key for a 128-bit Session key for MPPE.
         *
         * See: https://www.ietf.org/rfc/rfc3079.txt Section 2 (esp. 2.4) for use information.
         */
        function GetStartKey(challenge, ntPasswordHashHash) {
            var sha1 = crypto.createHash("sha1");
            sha1.update(ntPasswordHashHash.slice(0, 16));
            sha1.update(ntPasswordHashHash.slice(0, 16));
            sha1.update(challenge.slice(0, 8));
            return sha1.digest().slice(0, 16);
        }
        MSCHAPv1.GetStartKey = GetStartKey;
        function _getKey_8(lmPassword, currentSessionKey) {
            var lmPasswordHash = LmPasswordHash(lmPassword);
            return GetKey(lmPasswordHash, currentSessionKey || lmPasswordHash, 8);
        }
        /**
         * Generate a 40-bit session key, as per the specs: https://www.ietf.org/rfc/rfc3079.txt Section 2.1
         */
        function GetKey_40bit(lmPassword, currentSessionKey) {
            var sessionKey = _getKey_8(lmPassword, currentSessionKey);
            sessionKey[0] = 0xd1;
            sessionKey[1] = 0x26;
            sessionKey[2] = 0x9e;
            return sessionKey;
        }
        MSCHAPv1.GetKey_40bit = GetKey_40bit;
        /**
         * Generate a 56-bit session key, as per the specs: https://www.ietf.org/rfc/rfc3079.txt Section 2.2
         */
        function GetKey_56bit(lmPassword, currentSessionKey) {
            var sessionKey = _getKey_8(lmPassword, currentSessionKey);
            sessionKey[0] = 0xd1;
            return sessionKey;
        }
        MSCHAPv1.GetKey_56bit = GetKey_56bit;
        /**
         * Generate a 128-bit session key, as per the specs: https://www.ietf.org/rfc/rfc3079.txt Section 2.3
         */
        function GetKey_128bit(challenge, ntPassword, currentSessionKey) {
            var ntPasswordHash = NtPasswordHash(ntPassword);
            var ntPasswordHashHash = NtPasswordHash(ntPasswordHash.slice(0, 16));
            var initialSessionKey = GetStartKey(challenge, ntPasswordHashHash);
            var sessionKey = GetKey(initialSessionKey, currentSessionKey || initialSessionKey, 16);
            return sessionKey;
        }
        MSCHAPv1.GetKey_128bit = GetKey_128bit;
        //#endregion
    })(MSCHAPv1 = chap.MSCHAPv1 || (chap.MSCHAPv1 = {}));
    let MSCHAPv2;
    (function (MSCHAPv2) {
        // See http://tools.ietf.org/html/rfc2759#section-8.7
        function NtPasswordHash(password) {
            return MSCHAPv1.NtPasswordHash(password);
        }
        MSCHAPv2.NtPasswordHash = NtPasswordHash;
        function GenerateNTResponse(authChallenge, peerChallenge, username, password) {
            var challenge = MSCHAPv2.ChallengeHash(peerChallenge, authChallenge, username);
            var passwordHash = MSCHAPv1.NtPasswordHash(password);
            return MSCHAPv2.ChallengeResponse(challenge, passwordHash);
        }
        MSCHAPv2.GenerateNTResponse = GenerateNTResponse;
        function ChallengeHash(peerChallenge, authChallenge, username) {
            var sha1 = crypto.createHash("sha1");
            sha1.update(peerChallenge.slice(0, 16));
            sha1.update(authChallenge.slice(0, 16));
            sha1.update(new Buffer(username, "ascii"));
            return sha1.digest().slice(0, 8);
        }
        MSCHAPv2.ChallengeHash = ChallengeHash;
        function ChallengeResponse(challenge, passwordHash) {
            return MSCHAPv1.ChallengeResponse(challenge.slice(0, 8), passwordHash.slice(0, 16));
        }
        MSCHAPv2.ChallengeResponse = ChallengeResponse;
        /**
         * Generate an authenticator response for MS-CHAPv2.
         *
         * @param password                Password max length is 256 Unicode characters.
         * @param NT_response             An array of 24 Buffer bytes.
         * @param peer_challenge          An array of 16 Buffer bytes.
         * @param authenticator_challenge An array of 16 Buffer bytes.
         * @param username                Username max length is 256 ASCII characters.
         * @returns {string}              The authenticator response as "S=" followed by 40 hexadecimal digits.
         */
        function GenerateAuthenticatorResponse(password, NT_response, peer_challenge, authenticator_challenge, username) {
            password = password || "";
            username = username || "";
            if (NT_response.length < 24 || peer_challenge.length < 16 || authenticator_challenge.length < 16)
                return null;
            var Magic1 = new Buffer([0x4D, 0x61, 0x67, 0x69, 0x63, 0x20, 0x73, 0x65, 0x72, 0x76,
                0x65, 0x72, 0x20, 0x74, 0x6F, 0x20, 0x63, 0x6C, 0x69, 0x65,
                0x6E, 0x74, 0x20, 0x73, 0x69, 0x67, 0x6E, 0x69, 0x6E, 0x67,
                0x20, 0x63, 0x6F, 0x6E, 0x73, 0x74, 0x61, 0x6E, 0x74]);
            var Magic2 = new Buffer([0x50, 0x61, 0x64, 0x20, 0x74, 0x6F, 0x20, 0x6D, 0x61, 0x6B,
                0x65, 0x20, 0x69, 0x74, 0x20, 0x64, 0x6F, 0x20, 0x6D, 0x6F,
                0x72, 0x65, 0x20, 0x74, 0x68, 0x61, 0x6E, 0x20, 0x6F, 0x6E,
                0x65, 0x20, 0x69, 0x74, 0x65, 0x72, 0x61, 0x74, 0x69, 0x6F,
                0x6E]);
            var passwordHash = MSCHAPv1.NtPasswordHash(password);
            var passwordHashHash = MSCHAPv1.NtPasswordHash(passwordHash);
            var sha1 = crypto.createHash("sha1");
            sha1.update(passwordHashHash);
            sha1.update(NT_response.slice(0, 24));
            sha1.update(Magic1);
            var passwordDigest = sha1.digest();
            sha1 = crypto.createHash("sha1");
            sha1.update(peer_challenge.slice(0, 16));
            sha1.update(authenticator_challenge.slice(0, 16));
            sha1.update(username, "ascii");
            var challenge = sha1.digest().slice(0, 8); // Return the first 8 bytes from the SHA1 digest.
            sha1 = crypto.createHash("sha1");
            sha1.update(passwordDigest);
            sha1.update(challenge);
            sha1.update(Magic2);
            var authenticatorResponse = sha1.digest("hex");
            return "S=" + authenticatorResponse.toUpperCase();
        }
        MSCHAPv2.GenerateAuthenticatorResponse = GenerateAuthenticatorResponse;
        //#region "MPPE methods"
        function GetMasterKey(passwordHashHash, NT_response) {
            var Magic1 = new Buffer([
                0x54, 0x68, 0x69, 0x73, 0x20, 0x69, 0x73, 0x20, 0x74,
                0x68, 0x65, 0x20, 0x4d, 0x50, 0x50, 0x45, 0x20, 0x4d,
                0x61, 0x73, 0x74, 0x65, 0x72, 0x20, 0x4b, 0x65, 0x79
            ]);
            var sha = crypto.createHash("sha1");
            sha.update(passwordHashHash.slice(0, 16));
            sha.update(NT_response.slice(0, 24));
            sha.update(Magic1);
            return sha.digest().slice(0, 16);
        }
        MSCHAPv2.GetMasterKey = GetMasterKey;
        function GetAsymmetricStartKey(masterKey, keyLength, isSend, isServer) {
            var SHApad1 = new Buffer(40);
            var SHApad2 = new Buffer(40);
            SHApad1.fill(0);
            SHApad2.fill(0xf2);
            var Magic2 = new Buffer([
                0x4f, 0x6e, 0x20, 0x74, 0x68, 0x65, 0x20, 0x63, 0x6c, 0x69,
                0x65, 0x6e, 0x74, 0x20, 0x73, 0x69, 0x64, 0x65, 0x2c, 0x20,
                0x74, 0x68, 0x69, 0x73, 0x20, 0x69, 0x73, 0x20, 0x74, 0x68,
                0x65, 0x20, 0x73, 0x65, 0x6e, 0x64, 0x20, 0x6b, 0x65, 0x79,
                0x3b, 0x20, 0x6f, 0x6e, 0x20, 0x74, 0x68, 0x65, 0x20, 0x73,
                0x65, 0x72, 0x76, 0x65, 0x72, 0x20, 0x73, 0x69, 0x64, 0x65,
                0x2c, 0x20, 0x69, 0x74, 0x20, 0x69, 0x73, 0x20, 0x74, 0x68,
                0x65, 0x20, 0x72, 0x65, 0x63, 0x65, 0x69, 0x76, 0x65, 0x20,
                0x6b, 0x65, 0x79, 0x2e
            ]);
            var Magic3 = new Buffer([
                0x4f, 0x6e, 0x20, 0x74, 0x68, 0x65, 0x20, 0x63, 0x6c, 0x69,
                0x65, 0x6e, 0x74, 0x20, 0x73, 0x69, 0x64, 0x65, 0x2c, 0x20,
                0x74, 0x68, 0x69, 0x73, 0x20, 0x69, 0x73, 0x20, 0x74, 0x68,
                0x65, 0x20, 0x72, 0x65, 0x63, 0x65, 0x69, 0x76, 0x65, 0x20,
                0x6b, 0x65, 0x79, 0x3b, 0x20, 0x6f, 0x6e, 0x20, 0x74, 0x68,
                0x65, 0x20, 0x73, 0x65, 0x72, 0x76, 0x65, 0x72, 0x20, 0x73,
                0x69, 0x64, 0x65, 0x2c, 0x20, 0x69, 0x74, 0x20, 0x69, 0x73,
                0x20, 0x74, 0x68, 0x65, 0x20, 0x73, 0x65, 0x6e, 0x64, 0x20,
                0x6b, 0x65, 0x79, 0x2e
            ]);
            var s = isSend == isServer ? Magic3 : Magic2;
            var sha = crypto.createHash("sha1");
            sha.update(masterKey.slice(0, 16));
            sha.update(SHApad1);
            sha.update(s);
            sha.update(SHApad2);
            return sha.digest().slice(0, keyLength);
        }
        MSCHAPv2.GetAsymmetricStartKey = GetAsymmetricStartKey;
        function GetNewKeyFromSHA(startKey, sessionKey, keyLength) {
            var SHApad1 = new Buffer(40);
            var SHApad2 = new Buffer(40);
            SHApad1.fill(0);
            SHApad2.fill(0xf2);
            var sha1 = crypto.createHash("sha1");
            sha1.update(startKey.slice(0, keyLength));
            sha1.update(SHApad1);
            sha1.update(sessionKey.slice(0, keyLength));
            sha1.update(SHApad2);
            return sha1.digest().slice(0, keyLength);
        }
        MSCHAPv2.GetNewKeyFromSHA = GetNewKeyFromSHA;
        function _getSessionKeys(password, NT_response, keyLength) {
            var passwordHash = NtPasswordHash(password);
            var passwordHashHash = NtPasswordHash(passwordHash.slice(0, 16));
            var masterKey = GetMasterKey(passwordHashHash, NT_response);
            var masterSendKey = GetAsymmetricStartKey(masterKey, keyLength, true, true);
            var masterRecvKey = GetAsymmetricStartKey(masterKey, keyLength, false, true);
            var sessionKeys = {
                SendSessionKey: masterSendKey,
                RecvSessionKey: masterRecvKey,
            };
            return sessionKeys;
        }
        /**
         * Generate 64-bit send and receive start session keys for use in 40-bit and 56-bit session keys, as per the specs: https://www.ietf.org/rfc/rfc3079.txt Section 3.2
         *
         * If prevSessionKey parameter is not given then it is assumed that the session has just started without a previous session key.
         */
        function GetSessionKeys_64bit(password, NT_response) {
            var sessionKeys = _getSessionKeys(password, NT_response, 8);
            return sessionKeys;
        }
        MSCHAPv2.GetSessionKeys_64bit = GetSessionKeys_64bit;
        /**
         * Generate 128-bit send and receive start session keys, as per the specs: https://www.ietf.org/rfc/rfc3079.txt Section 3.3
         *
         * If prevSessionKey parameter is not given then it is assumed that the session has just started without a previous session key.
         */
        function GetSessionKeys_128bit(password, NT_response) {
            return _getSessionKeys(password, NT_response, 16);
        }
        MSCHAPv2.GetSessionKeys_128bit = GetSessionKeys_128bit;
        //#endregion
    })(MSCHAPv2 = chap.MSCHAPv2 || (chap.MSCHAPv2 = {}));
})(chap || (chap = {}));
module.exports = chap;
//# sourceMappingURL=chap.js.map