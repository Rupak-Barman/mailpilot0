import User from "../models/User.js";
import { encryptToken } from "../utils/crypto.js";

/**
 * Boot-time idempotent migration:
 * 1. Encrypt existing plaintext refresh tokens in place (skip any starting with 'enc:v1:')
 * 2. $unset the stored accessToken field on all users
 * 3. Log counts only (never log secrets)
 */
export async function migrateTokens(UserModel = User) {
  try {
    // 1. Find users with non-empty refreshToken
    const users = await UserModel.find({
      refreshToken: { $exists: true, $ne: null }
    });

    let encryptedCount = 0;
    for (const user of users) {
      if (user.refreshToken && !user.refreshToken.startsWith("enc:v1:")) {
        user.refreshToken = encryptToken(user.refreshToken);
        await user.save();
        encryptedCount++;
      }
    }

    // 2. Unset accessToken on all user documents in MongoDB
    const unsetResult = await UserModel.updateMany(
      { accessToken: { $exists: true } },
      { $unset: { accessToken: "" } }
    );

    const unsetCount = unsetResult.modifiedCount ?? unsetResult.nModified ?? 0;

    if (encryptedCount > 0 || unsetCount > 0) {
      console.log(
        `[migration] Boot-time token migration complete: ${encryptedCount} refresh tokens encrypted, ${unsetCount} access tokens unset.`
      );
    }

    return { encryptedCount, unsetCount };
  } catch (err) {
    console.error("[migration] Error during token migration:", err.message);
    throw err;
  }
}

