var ALY = require('aliyun-sdk');
var co = require('co');

function createSLS(credentials, endpoint) {
  return new ALY.SLS({
    "accessKeyId": credentials.accessKeyId,
    "secretAccessKey": credentials.accessKeySecret,
    "securityToken": credentials.securityToken,
    endpoint: endpoint,
    apiVersion: '2015-06-01'
  });
}

function pullLogs(SLS, projectConfig, cursor) {
  return new Promise(function (resolve, reject) {
    SLS.batchGetLogs({
      projectName: projectConfig.projectName,
      logStoreName: projectConfig.logstoreName,
      ShardId: projectConfig.shardId,
      cursor: cursor,
      count: 1,
    }, function (err, res) {
      if (err) {
        console.error('get sls log error', err);
        reject(err);
      }
      var nextCursor = res.headers['x-log-cursor'];

      resolve({
        data: res.body.logGroupList,
        nextCursor: nextCursor,
      });
    });
  });
}

function processNginxLogs(content) {
  var match = /(\S+)\s-\s-\s\[(\S+)\s[^\]]+\]\s\\?"(\S+)\s(\S+)\s(\S+)\\?"\s(\S+)\s(\S+)\s\\?"([^"]+)\\?"\s\\?"([^"]+)\\?"/g.exec(content);
  if (match) {
    return [
      { key: 'ip', value: match[1] },
      { key: 'time', value: match[2] },
      { key: 'method', value: match[3] },
      { key: 'url', value: match[4] },
      { key: 'version', value: match[5] },
      { key: 'status', value: match[6] },
      { key: 'res_size', value: match[7] },
      { key: 'referer', value: match[8] },
      { key: 'user_agent', value: match[9] }
    ];
  }
  return null;
}

function processLogs(targetSLS, targetConfig, logObj) {
  return new Promise(function (resolve, reject) {
    if (!logObj) {
      resolve();
    }
    var log = logObj.log;
    var source = logObj.source;

    var logContents = log.contents.reduce(function (arr, o) {
      if (o.key === 'log') {
        var nginxLogs = processNginxLogs(o.value);
        if (nginxLogs) {
          return arr.concat(nginxLogs);
        } else {
          arr.push(o);
        }
      }
      return arr;
    }, []);

    console.info('log contents, %o', logContents);

    if (logContents.length) {
      var logGroup = {
        logs: [{
          time: log.time,
          contents: logContents,
        }],
        topic: logObj.topic,
        source: source,
      };

      var logStore = logContents.length > 1 ? targetConfig.logStore : targetConfig.errorLogStore;

      if (logStore) {
        targetSLS.putLogs({
          //必选字段
          projectName: targetConfig.project,
          logStoreName: logStore,
          logGroup: logGroup
        }, function (err, data) {
  
          if (err) {
            console.error('error:', err);
            reject(err);
          } else {
            console.info('log wrote to %s', logStore);
            resolve({
              log: logContents,
              res: data,
            });
          }
  
        });
      } else {
        console.info('no log store specied. skip');
        resolve();
      }
    } else {
      console.info('empty log: %s', JSON.stringify(log));
      resolve();
    }
  });
}


module.exports.handler = function (event, context, callback) {

  var config = JSON.parse(event.toString());
  var sourceConfig = config.source;
  var targetConfig = config.parameter.target;

  console.setLogLevel(config.parameter.logLevel || 'error');
  
  console.info('event', config);
  console.info('context', context);
  
  if (!targetConfig) {
    callback(new Error('target config not valid.'));
  }

  var sourceSLS = createSLS(context.credentials, sourceConfig.endpoint);
  var targetSLS = createSLS(context.credentials, targetConfig.endpoint);

  co(function* () {
    var nextCursor = sourceConfig.beginCursor;

    while (nextCursor) {
      var ret = yield pullLogs(sourceSLS, sourceConfig, nextCursor);
      console.info('got log group list. length: ', ret.data.length);
      var logs = ret.data.reduce(function (arr, logGroup) {
        return arr.concat(logGroup.logs.map(function (log) {
          var logObj = {
            source: logGroup.source,
            topic: logGroup.topic,
            log: log,
          };
          console.info('got log: ', JSON.stringify(logObj));
          return logObj;
        }));
      }, []);

      yield logs.map(function (logObj) {
        return processLogs(targetSLS, targetConfig, logObj);
      });

      if (ret.nextCursor === sourceConfig.endCursor) {
        nextCursor = null;
      } else {
        nextCursor = ret.nextCursor;
      }
    }
  }).then(function () {
    callback(null, 'All log processed');
  }).catch(callback);
};
