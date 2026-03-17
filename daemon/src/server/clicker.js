const { exec } = require('child_process');

Meteor.methods({
  'open.pwa'(target) {
    const command = `"/usr/bin/google-chrome" --profile-directory=Default --app-id=${target}`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.chrome'() {
    const command = `"/usr/bin/google-chrome" --profile-directory=Default`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.brave'() {
    const command = `"/usr/bin/brave-browser" --profile-directory=Default`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.with.default.app'(targetUrl) {
    const command = `open ${targetUrl}`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.with.chrome'(targetUrl) {
    const command = `"/usr/bin/google-chrome" --profile-directory=Default ${targetUrl}`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.with.brave'(targetUrl) {
    const command = `"/usr/bin/brave-browser" --profile-directory=Default ${targetUrl}`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
  'open.pwa.with.brave'(target) {
    const command = `"/usr/bin/brave-browser" --profile-directory=Default --app-id=${target}`;
    console.log({command})
    exec(command, (err, stdout, stderr) => {
      if (err) return console.error('Error executing command:', err);
    });
  },
});
