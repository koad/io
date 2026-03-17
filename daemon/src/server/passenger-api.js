import { WebApp } from 'meteor/webapp';
import bodyParser from 'body-parser';

// Create a new instance of the connect app
const app = WebApp.connectHandlers;

// Use bodyParser to parse JSON data from the POST body
app.use(bodyParser.json());

app.use('/passenger/post', (req, res, next) => {
  if (req.method === 'POST') {
    // Handle your POST request here
    console.log('Received POST from passenger:', req.body);

    // const payload = req.body;
    // console.log({payload})
    // Perform action based on the payload
    // For example, interact with your Meteor collections or call a method

    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust as needed for security
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    // Respond to the request
    res.writeHead(200); // HTTP status code 200: OK
    res.end(JSON.stringify({ status: 'success', message: 'Action processed successfully' }));
  } else {
    // Not a POST request, let other handlers or middleware process it
    return next();
  }
});

// Ensure Meteor knows to use this for incoming HTTP requests
WebApp.rawConnectHandlers.use(app);
