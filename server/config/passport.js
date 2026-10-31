//config/passport.js
import 'dotenv/config'; 
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/User.js";
import { setupDefaultLabels } from "../services/gmail.service.js";

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback",
},
async (accessToken, refreshToken, profile, done) => {
  const existing = await User.findOne({ googleId: profile.id });

  const user = await User.findOneAndUpdate(
    { googleId: profile.id },
    {
      email: profile.emails[0].value,
      name: profile.displayName,
      accessToken,
      refreshToken: refreshToken || existing?.refreshToken
    },
    { upsert: true, new: true }
  );
  
  // Default Labels
  await setupDefaultLabels(user);

  done(null, user);
}));

export default passport;
