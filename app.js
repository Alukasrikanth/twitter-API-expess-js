const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());
let database = null;
const initializeDBToServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error:${error.message}`);
    process.exit(1);
  }
};
initializeDBToServer();

const validatePassWord = (password) => {
  return password.length > 6;
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authorization = request.headers["authorization"];
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "My_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
}
app.post("/register/", async (request, response) => {
  const { username, password, gender, name } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserExistQuery = `
        SELECT 
            *
        FROM 
            user
        WHERE 
            username = "${username}";`;
  const exitUser = await database.get(getUserExistQuery);
  if (exitUser === undefined) {
    const createUserQuery = `
            INSERT INTO 
                user (username,password,gender,name)
            VALUES (
                "${username}",
                "${hashedPassword}",
                "${gender}",
                "${name}");`;
    if (validatePassWord(password)) {
      await database.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send(" Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API-2 user login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserExistQuery = `
        SELECT 
            *
        FROM 
            user
        WHERE 
            username = "${username}";`;
  const exitUser = await database.get(getUserExistQuery);
  if (exitUser !== undefined) {
    const isPassWordMatched = await bcrypt.compare(password, exitUser.password);
    if (isPassWordMatched === true) {
      const payload = { username: username };
      let jwtToken = jwt.sign(payload, "My_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

const convertDBResponseToTweetResponse = (obj) => {
  return {
    username: obj.username,
    tweet: obj.tweet,
    dateTime: obj.date_time,
  };
};
//API-3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweetQuery = `
        SELECT 
            tweet.user_id,
            tweet.tweet,
            tweet.date_time
        FROM 
           (user left join tweet on User.user_id = Tweet.user_id) 
           AS T left join Follower on T.user_id = Follower.follower_user_id
        WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username = "${request.username}")
        ORDER BY 
            T.date_time DESC
        LIMIT 4`;
  const tweet = await database.all(latestTweetQuery);
  response.send(tweet.map((item) => convertDBResponseToTweetResponse(item)));
});

// API-4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const getUserFollowerQuery = `
        SELECT 
           user.name
        FROM 
            user left join follower on user.user_id = follower.follower_user_id
        WHERE 
            follower.follower_user_id=(SELECT user_id FROM user WHERE username = "${request.username}"); `;

  const userFollower = await database.all(getUserFollowerQuery);
  response.send(userFollower);
});

//API-5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const getWhoFollowerUserQuery = `
        SELECT 
            user.name
            FROM 
                user left join follower on user.user_id = follower.follower_user_id
            WHERE 
                follower.follower_user_id=(SELECT user_id FROM user WHERE username = "${request.username}"); `;

  const followerUser = await database.all(getWhoFollowerUserQuery);
  response.send(followerUser);
});

//API-6
const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let following = `
        SELECT 
            *
        FROM 
            follower
        WHERE
            follower_user_id = (select user_id from user where username ="${request.username}")
            and 
            following_user_id =(select user.user_id from tweet natural join user where tweet_id = ${tweetId})
    
    `;
  if (following === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time, likes, replies } = request.body;
    const getUserRequestQuery = `
    SELECT 
        tweet,
        tweet.data_date AS dateTime,
        like.count(like_id) AS likes,
        reply.count(reply_id) AS replies

    FROM 
        (Tweet left join Reply on Tweet.tweet_id = Reply.tweet_id) AS T left join Like on T.tweet_id = Like.tweet_id
    WHERE 
        tweet_d = ${tweetId};
   `;
    const tweetFollower = await database.get(getUserRequestQuery);
    response.send({ tweetFollower });
  }
);

//API-7

app.get(
  "/tweets/:tweetId/likes/",
  follows,
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const getUserTwitted = `
        SELECT 
            
        FROM
            (like left join user on like.user_id = user.user_id)AS T left join tweet on T.user_id = tweet.user_id
        WHERE 
             like.tweet_id =${tweetId};`;
    const userLikedTweet = await database.all(getUserTwitted);
    response.send({
      likes: userLikedTweet.map((item) => {
        item.username;
      }),
    });
  }
);

//API-8

app.get(
  "/tweets/:tweetId/replies/",
  follows,
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const getReplies = `
        SELECT 
            T.reply AS replies
        FROM 
            (reply left join user on reply.user_id = user.user_id) AS left join tweet on T.user_id = tweet.user_id
        WHERE 
            tweet.tweet_id = ${tweetId}
    `;
    const replies = await database.all(getReplies);
    response.send({ replies });
  }
);

//API-9

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const getAllTweets = `
        SELECT 
            T.tweet,
            count(T.like_id) AS likes,
            count(reply.reply_id) AS likes
            T.data_time AS dateTime

        FROM 
            (tweet left join like on tweet.tweet_id = like.tweet_id) AS T left join reply on T.tweet_id = reply.tweet_id 
        WHERE 
            T.user_id=(SELECT user_id from user WHERE username ="{request.username}")
        GROUP BY 
            T.tweet_id
    `;
  const listOfTweets = await database.all(getAllTweets);
  response.send(listOfTweets);
});

//AP1-10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet, date_time } = request.body;
  const { tweet_id } = request.params;
  const { userId } = `
        SELECT 
            user_id
        FROM 
            user
        WHERE
            username="${request.username}";
    `;
  await database.get({ userId });
  const createTweet = `
        INSERT INTO 
            tweet (tweet,tweet_id,user_id,date_time)
        VALUES 
            ("${tweet}",
              ${tweetId},
              ${userId},
              ${data_time});
    `;
  await database.run(createTweet);
  response.send("Created a Tweet");
});

//API-11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userRequestDelQuery = `
        SELECT 
            tweet_id,user_id
        FROM 
            tweet
        WHERE 
            tweet_id = ${tweetId}
            and user_id =(SELECT user_id FROM user WHERE username='${request.username}');
    `;
    if (userRequestDelQuery === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
            DELETE from 
            WHERE tweet_id = ${tweetId};
        `;
      const deleteTweet = await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
