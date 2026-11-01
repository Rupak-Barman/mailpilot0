// config/passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import { setupDefaultLabels } from "../services/gmail.service.js";
import { OAUTH_CALLBACK_URL } from "./env.js";
import { encryptToken } from "../utils/crypto.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: OAUTH_CALLBACK_URL
    },
    async (_accessToken, refreshToken, profile, done) => {
      try {
        const existing = await User.findOne({ googleId: profile.id });

        const encryptedRefreshToken = refreshToken
          ? encryptToken(refreshToken)
          : existing?.refreshToken;

        const user = await User.findOneAndUpdate(
          { googleId: profile.id },
          {
            email: profile.emails[0].value,
            name: profile.displayName,
            refreshToken: encryptedRefreshToken,
            needsRelogin: false,
            syncStatus: "idle",
            syncError: null
          },
          { upsert: true, returnDocument: "after" }
        );

        // Default Labels
        await setupDefaultLabels(user);

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

export default passport;
