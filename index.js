'use strict';
//
// Program exit handlers to close redis connections
//
var Sync = require('sync');
process.stdin.resume(); //so the program will not close instantly

function connectionsclose() {
    redisPub.end();
    redisSub.end();
    console.log("Redis connections closed");
    process.exit();
}

function exitHandler(options, err) {
    if (options.cleanup) {
        Sync(function() {
            connectionsclose();
        });
    }
    if (err) {
        Sync(function() {
            connectionsclose();
        });
    }
    if (options.exit) {
        process.exit();
    };
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {
    exit: true
}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
    cleanup: true
}));
process.on('SIGTERM', exitHandler.bind(null, {
    cleanup: true
}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
    cleanup: true
}));

//
// Start logging
//
var path = require('path');
var bunyan = require('bunyan');

var port = process.env.PORT || 3000;
var basename = path.basename(__filename, '.js');
var log = bunyan.createLogger({
    name: basename,
    streams: [{
        level: 'debug',
        stream: process.stdout
    }, {
        level: 'info',
        path: path.resolve('./logs/' + basename + '.log'),
    }]
});

//
// Do your express magic.
//
var express = require('express');
var app = express();

app.set('port', port);
app.use(express.static(__dirname + '/public'));
app.get('/keepalive', function(req, res) {
    res.send('OK');
});

//
// Create Primus server
//
var http = require('http');
var Primus = require('primus');

var server = http.createServer(app);

var primus = new Primus(server, {
    transformer: 'websockets',
    parser: 'JSON',
});

primus.save(__dirname + '/public/primus.js');

primus.on('connection', function(spark) {

    log.debug("Client connected id: " + spark.id);

    spark.on('data', function(data) {
        data = data || {};
        log.trace("Client id: " + spark.id + " message: " + JSON.stringify(data));

        switch (data.command) {
            case 'join':
                redisSub.subscribe(data.room);
                break;
            case 'leave':
                redisSub.unsubscribe(data.room);
                break;
            default:
                log.debug("Client " + spark.id + " wrote " + JSON.stringify(message));
        }

    });

});

primus.on('disconnection', function(spark) {
    log.debug("Client disconnected id: " + spark.id);
    // unsubscribe from all the previously subscribed channels
    redisSub.unsubscribe();
});

server.listen(app.get('port'), function() {
    log.info('Server running on port ' + app.get('port'));
});

//
// Connect to redis  server
//
//For localhost password at /etc/redis/redis.conf at requirepass
var redis = require('redis');
//redis.debug_mode = true;

var url = require('url');
//process.env['REDISLOCAL_URL'] = 'redis://ckir:123456@ckir.homeip.net:6379';
//process.env['REDISCLOUD_URL'] = 'redis://rediscloud:l9O33oesv1ZXwLD3@pub-redis-10891.us-east-1-2.1.ec2.garantiadata.com:10891';

if (typeof process.env.REDISLOCAL_URL !== "undefined") {
    var redisURL = url.parse(process.env.REDISLOCAL_URL);
} else {
    var redisURL = url.parse(process.env.REDISCLOUD_URL);
}

var redisPub = redis.createClient(redisURL.port, redisURL.hostname, {
    no_ready_check: true
});
redisPub.auth(redisURL.auth.split(":")[1], function() {
    log.debug("Redis Pub authenticated");
});
redisPub.on("ready", function(err) {
    log.debug("Redis Pub ready on " + redisURL.hostname);
});
redisPub.on("error", function(err) {
    log.error("Redis Error " + err);
});
redisPub.on("end", function() {
    log.error("Redis Pub connection closed ");
});

var redisSub = redis.createClient(redisURL.port, redisURL.hostname, {
    no_ready_check: true
});
redisSub.auth(redisURL.auth.split(":")[1], function() {
    log.debug("Redis Sub authenticated");
});
redisSub.on("ready", function() {
    log.debug("Redis Sub ready on " + redisURL.hostname);
});

redisSub.on("error", function(err) {
    log.error("Redis Error " + err);
});

redisSub.on("subscribe", function(channel, count) {
    log.debug("Client subscribed to " + channel + ", " + count + " total subscriptions");
});

redisSub.on("unsubscribe", function(channel, count) {
    log.debug("Client unsubscribed from " + channel + ", " + count + " total subscriptions");
});

redisSub.on("message", function(channel, message) {
    log.trace("Client channel " + channel + ": " + message);
    primus.write({
        room: channel,
        msg: message
    });
});

redisSub.on("end", function() {
    log.error("Redis Sub connection closed ");
});

// A time channel for debugging
setInterval(function() {
    redisPub.publish('time', new Date().toISOString(), function() {});
}, 5000);
