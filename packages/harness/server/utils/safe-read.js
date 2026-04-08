const fs = require('fs');

KoadHarnessUtils = {};

KoadHarnessUtils.readFile = function (filePath, encoding = 'utf8') {
  return new Promise((resolve) => {
    fs.readFile(filePath, encoding, (err, data) => {
      resolve(err ? null : data);
    });
  });
};

KoadHarnessUtils.readBinary = function (filePath) {
  return new Promise((resolve) => {
    fs.readFile(filePath, (err, data) => {
      resolve(err ? null : data);
    });
  });
};

KoadHarnessUtils.readDir = function (dirPath) {
  return new Promise((resolve) => {
    fs.readdir(dirPath, (err, files) => {
      resolve(err ? [] : files);
    });
  });
};
