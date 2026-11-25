const app = require('./app');

const port = Number(process.env.PORT) || 3000;
// Listen on localhost unless HOST is set explicitly; use HTTPS when exposing it.
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => console.log(`ToDoList Web running at http://${host}:${port}`));
