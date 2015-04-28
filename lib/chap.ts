﻿/// <reference path="../typings/node/node.d.ts" />
import crypto = require("crypto");

module chap {
  export type Password = string|Buffer;

  export class CHAP {
    // See http://tools.ietf.org/html/rfc1994#section-2 and https://tools.ietf.org/html/rfc2865#section-7.2
    static ChallengeResponse(id: number, password: string, challenge: Buffer): Buffer {
      var md5 = crypto.createHash("md5");
      md5.update(id);
      md5.update(password);
      md5.update(challenge);
      return md5.digest();
    }
  }

  export class MSCHAPv1 {
    // See http://tools.ietf.org/html/rfc2433  -  Appendix A

    static LmChallengeResponse(challenge: Buffer, password: string): Buffer {
      var ucasePassword = password.toUpperCase();

      ucasePassword = ucasePassword;

      var passwordBuffer = new Buffer(ucasePassword); // This should be OEM, but maybe utf8/unicode will do?
      var finalPasswordBuffer = new Buffer(14);

      passwordBuffer.copy(finalPasswordBuffer);

      var passwordHash1 = this.DesHash(passwordBuffer.slice(0, 6));
      var passwordHash2 = this.DesHash(passwordBuffer.slice(7, 13));

      var passwordHash = new Buffer(16);
      passwordHash1.copy(passwordHash, 0);
      passwordHash2.copy(passwordHash, 8);

      return this.ChallengeResponse(challenge, passwordHash);
    }

    static NtChallengeResponse(challenge: Buffer, password: Password): Buffer {
      var passwordBuffer: Buffer = new Buffer(<Buffer>password);
      
      var md4 = crypto.createHash("md4");
      md4.update(password, "utf8");

      var passwordHash = md4.digest();

      return this.ChallengeResponse(challenge, passwordHash);
    }

    static ChallengeResponse(challenge: Buffer, passwordHash: Buffer): Buffer {
      var zPasswordHash = new Buffer(21);
      zPasswordHash.fill(0);
      passwordHash.copy(zPasswordHash);

      var des1 = crypto.createCipher("des", zPasswordHash.slice(0, 6)); //   1st 7 octets of zPasswordHash as key.
      var des2 = crypto.createCipher("des", zPasswordHash.slice(7, 13)); //  2nd 7 octets of zPasswordHash as key.
      var des3 = crypto.createCipher("des", zPasswordHash.slice(14, 20)); // 3rd 7 octets of zPasswordHash as key.

      des1.update(challenge);
      des2.update(challenge);
      des3.update(challenge);

      var res1 = des1.final();
      var res2 = des2.final();
      var res3 = des3.final();

      var resBuffer = new Buffer(24);

      res1.copy(resBuffer, 0);
      res2.copy(resBuffer, 8);
      res2.copy(resBuffer, 16);

      return resBuffer;
    }

    private static DesHash(clear: Buffer): Buffer {
      var des = crypto.createCipher("des", clear);
      des.update("KGS!@#$%");
      return des.final();
    }
  }

  export class MSCHAPv2 {
    // See http://tools.ietf.org/html/rfc2759#section-8.7

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
    static generateAuthenticatorResponse(password: string, NT_response: Buffer, peer_challenge: Buffer, authenticator_challenge: Buffer, username: string): string {
      password = password || "";
      username = username || "";
      if (NT_response.length !== 24 || peer_challenge.length !== 16 || authenticator_challenge.length !== 16) return null;

      var Magic1 = new Buffer(
        [0x4D, 0x61, 0x67, 0x69, 0x63, 0x20, 0x73, 0x65, 0x72, 0x76,
        0x65, 0x72, 0x20, 0x74, 0x6F, 0x20, 0x63, 0x6C, 0x69, 0x65,
        0x6E, 0x74, 0x20, 0x73, 0x69, 0x67, 0x6E, 0x69, 0x6E, 0x67,
        0x20, 0x63, 0x6F, 0x6E, 0x73, 0x74, 0x61, 0x6E, 0x74]);
      var Magic2 = new Buffer(
        [0x50, 0x61, 0x64, 0x20, 0x74, 0x6F, 0x20, 0x6D, 0x61, 0x6B,
        0x65, 0x20, 0x69, 0x74, 0x20, 0x64, 0x6F, 0x20, 0x6D, 0x6F,
        0x72, 0x65, 0x20, 0x74, 0x68, 0x61, 0x6E, 0x20, 0x6F, 0x6E,
        0x65, 0x20, 0x69, 0x74, 0x65, 0x72, 0x61, 0x74, 0x69, 0x6F,
        0x6E]);

      var md4 = crypto.createHash("md4");
      md4.update(password, "utf8");
      var passwordHash = md4.digest();

      md4 = crypto.createHash("md4");
      md4.update(passwordHash);
      var passwordHashHash = md4.digest();

      var sha1 = crypto.createHash("sha1");
      sha1.update(passwordHashHash);
      sha1.update(NT_response);
      sha1.update(Magic1);
      var passwordDigest = sha1.digest();


      sha1 = crypto.createHash("sha1");
      sha1.update(peer_challenge);
      sha1.update(authenticator_challenge);
      sha1.update(username, "ascii");
      var challenge = sha1.digest().slice(0, 8); // Return the first 8 bytes from the SHA1 digest.

      sha1 = crypto.createHash("sha1");
      sha1.update(passwordDigest);
      sha1.update(challenge);
      sha1.update(Magic2);
      var authenticatorResponse = sha1.digest("hex");


      return "S=" + authenticatorResponse;
    }
  }
}


export = chap;