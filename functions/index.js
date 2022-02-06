require("dotenv").config();
const prompts = require("./prompts.json");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const dbRef = admin.firestore().doc("tokens/demo");

const twitterAPI = require("twitter-api-v2").default;
const twitterClient = new twitterAPI({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

const callbackURL =
  "http://127.0.0.1:5000/tweets-generator-a39af/us-central1/callback";

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  organization: process.env.OPENAI_ORGANIZATION,
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

exports.auth = functions.https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    {
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    }
  );

  await dbRef.set({ codeVerifier, state });

  response.redirect(url);
});

exports.callback = functions.https.onRequest(async (request, response) => {
  const { state, code } = request.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  if (state !== storedState) {
    return response.status(400).send("Invalid state");
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });

  await dbRef.set({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me();

  response.send(data);
});

exports.tweet = functions.https.onRequest(async (request, response) => {
  const { refreshToken } = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  const nextTweet = await openai.createCompletion("text-davinci-001", {
    prompt: prompts[Math.floor(Math.random() * prompts.length)],
    max_tokens: 64,
  });

  const { data } = await refreshedClient.v2.tweet(
    nextTweet.data.choices[0].text
  );

  return response.send(data);
});
