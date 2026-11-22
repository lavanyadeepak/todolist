const app = require('./app');

const port = Number(process.env.PORT) || 3000;
// Single-user, no auth: listen on localhost only unless HOST is set explicitly.
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => console.log(`ToDoList Web running at http://${host}:${port}`));
