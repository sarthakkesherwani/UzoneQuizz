# UzoneQuiz

Full-stack quiz application with a zero-dependency Node.js API, MongoDB storage, student/teacher roles, and JWT authentication.

## Requirements

- Node.js 18+
- MongoDB

## Run locally

```bash
# Optional; defaults to mongodb://127.0.0.1:27017/uzonequiz
export MONGODB_URI="mongodb://127.0.0.1:27017/uzonequiz"
export JWT_SECRET="replace-with-a-long-random-secret"
npm start
```

Open <http://localhost:5050>.

For local development, `npm run dev` attempts to start a local MongoDB instance and then runs the app.

## Demo accounts

- Student: `demo@uzonequiz.app` / `demopass`
- Teacher: `teacher@uzonequiz.app` / `teachpass`

## Features

- Register, login, authenticated profile, role-aware access, and server-side logout/revocation
- Teacher quiz create/update/delete and publishing
- Student attempts scored on the server
- Leaderboards, analytics, student summaries, bookmarks, and notifications
- MongoDB persistence and automatic seed data
- Static frontend hosting and health endpoint at `/api/health`

## Commands

```bash
npm start       # run server
npm test        # run all backend tests
npm run seed    # seed an empty database
npm run reseed  # force reseeding
```

## Deployment

Set `MONGODB_URI` and `JWT_SECRET` in the hosting environment. A `render.yaml` is included.
